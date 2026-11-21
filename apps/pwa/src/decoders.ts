import {
  DecodeError,
  DecoderRegistry,
  KeyRejected,
  LimitExceeded,
  type Decoder,
  type PermissionPolicy,
  type UriPolicy,
} from '@markdown2/core';

/** Grant value for an `age` stage. Held in memory only (plan §8). */
export interface KeyGrant {
  kind: 'passphrase' | 'identity';
  value: string;
}

export function isKeyGrant(g: unknown): g is KeyGrant {
  if (typeof g !== 'object' || g === null) return false;
  const r = g as Record<string, unknown>;
  return (r.kind === 'passphrase' || r.kind === 'identity') && typeof r.value === 'string';
}

/**
 * `age` profile (§5.4). Lazy-loads the library. Every decryption failure is
 * reported as a rejected key (spec-issues #21): the resource stays locked and
 * no bytes reach a handler.
 */
export const ageDecoder: Decoder = {
  id: 'age',
  position: 'any',
  capability: 'key',
  async decode(input, ctx) {
    const grant = ctx.grant;
    if (!isKeyGrant(grant)) throw new KeyRejected('no key granted');
    const { Decrypter } = await import('age-encryption');
    const d = new Decrypter();
    if (grant.kind === 'passphrase') d.addPassphrase(grant.value);
    else d.addIdentity(grant.value);
    let out: Uint8Array;
    try {
      out = await d.decrypt(new Uint8Array(input));
    } catch {
      throw new KeyRejected('key rejected');
    }
    // Plaintext is never larger than the ciphertext, which is already bounded.
    ctx.quota.charge(out.length);
    return out;
  },
};

export function createRegistry(): DecoderRegistry {
  const r = new DecoderRegistry();
  r.register(ageDecoder);
  return r;
}

export type FetchLike = (url: URL, init: RequestInit) => Promise<Response>;

export interface BrowserUriPolicyOptions {
  /** User-configured origins allowed without a per-resource grant. */
  origins?: () => ReadonlySet<string>;
  /** Unified permission policy (supports wildcards, `'self'`, `'*'`, explicit `http:`, and `allowFetch`). */
  policy?: () => PermissionPolicy;
  /**
   * Address of the open document, when it has one (opened by URL). Relative
   * references resolve against it and must stay on its origin (spec-issues #33).
   */
  base?: () => URL | null;
  fetch?: FetchLike;
  /** Response body cap, enforced while streaming. Default 16 MiB. */
  maxBytes?: number;
}

export interface UriDiagnosis {
  url: URL | null;
  reason?: string;
}

export function diagnoseRemoteUri(uri: string, base: URL | null, policy?: PermissionPolicy): UriDiagnosis {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    if (base === null) {
      return {
        url: null,
        reason: `Relative URI "${uri}" cannot be resolved without a document URL (open the document by URL or use an absolute https: URI).`,
      };
    }
    try {
      u = new URL(uri, base);
    } catch {
      return { url: null, reason: `Malformed URI "${uri}".` };
    }
    if (u.origin !== base.origin) {
      return {
        url: null,
        reason: `Relative URI "${uri}" resolved to a different origin ("${u.origin}") than the document ("${base.origin}").`,
      };
    }
  }
  if (u.username !== '' || u.password !== '') {
    return { url: null, reason: `URI "${uri}" contains embedded credentials, which are not permitted.` };
  }
  if (u.protocol === 'https:') return { url: u };
  if (u.protocol === 'http:') {
    if (policy?.allowsHttpUrl(u, 'fetch') === true || (base !== null && u.origin === base.origin)) {
      return { url: u };
    }
    return {
      url: null,
      reason: `Plain http: URI "${u.href}" is blocked by default. To allow it, explicitly add "${u.origin}" in Remote… (or permissions.allowOrigins).`,
    };
  }
  return {
    url: null,
    reason: `Unsupported URI scheme "${u.protocol}" in "${uri}". Only https: (or explicitly whitelisted http:) URIs can be fetched.`,
  };
}

/**
 * The address a `uri` payload points at, or null if it may not be fetched.
 *
 * - Absolute `https:` URIs without credentials are allowed.
 * - Relative references resolve against `base` only, and only to its own origin.
 * - Plain `http:` is allowed on the base's own origin or when explicitly whitelisted in `policy`.
 */
export function resolveRemoteUri(uri: string, base: URL | null, policy?: PermissionPolicy): URL | null {
  return diagnoseRemoteUri(uri, base, policy).url;
}

/**
 * Browser `uri` policy (§5.5). Nothing is allowed by default. Browsers cannot
 * see resolved addresses, so the SSRF rules are out of reach (spec-issues #22).
 * The response `Content-Type` is ignored: the declared type stays authoritative.
 */
export function createBrowserUriPolicy(opts: BrowserUriPolicyOptions): UriPolicy {
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
  const maxBytes = opts.maxBytes ?? 16 * 1024 * 1024;
  const target = (uri: string): UriDiagnosis => diagnoseRemoteUri(uri, opts.base?.() ?? null, opts.policy?.());
  return {
    allows(uri) {
      const { url } = target(uri);
      if (url === null) return false;
      if (opts.policy?.().allowsFetch(url) === true) return true;
      return opts.origins?.().has(url.origin) === true;
    },
    async resolve(uri, signal) {
      const diag = target(uri);
      const u = diag.url;
      if (u === null) {
        throw new DecodeError(diag.reason ?? 'only https: URIs, or references relative to this document, can be fetched');
      }
      let res: Response;
      try {
        res = await doFetch(u, {
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
          redirect: 'follow',
          ...(signal ? { signal } : {}),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new DecodeError(
          `Network error fetching "${u.href}": ${msg}. Check CORS (Access-Control-Allow-Origin) on "${u.origin}" and Content-Security-Policy (connect-src).`,
        );
      }
      if (!res.ok) {
        throw new DecodeError(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''} fetching "${u.href}"`);
      }
      if (res.body === null) return new Uint8Array(0);
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        for (; ;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > maxBytes) throw new LimitExceeded(`response from "${u.href}" exceeds ${maxBytes} bytes`);
          chunks.push(value);
        }
      } catch (e) {
        await reader.cancel().catch(() => undefined);
        throw e;
      }
      const out = new Uint8Array(total);
      let o = 0;
      for (const c of chunks) {
        out.set(c, o);
        o += c.length;
      }
      return out;
    },
  };
}