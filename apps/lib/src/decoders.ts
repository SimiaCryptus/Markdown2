import {
  DecodeError,
  DecoderRegistry,
  KeyRejected,
  LimitExceeded,
  type Decoder,
  type PermissionPolicy,
  type UriPolicy,
} from '@markdown2/core';

/** Grant value for an `age` stage. Held in memory only. */
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
 * `age` profile (§5.4), lazy-loaded. Every decryption failure is reported as
 * a rejected key: the resource stays locked and no bytes reach a handler.
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
    ctx.quota.charge(out.length);
    return out;
  },
};

/** Core decoders, `age`, then any extra decoders (later ids override earlier ones). */
export function createRegistry(extra: readonly Decoder[] = []): DecoderRegistry {
  const r = new DecoderRegistry();
  r.register(ageDecoder);
  for (const d of extra) r.register(d);
  return r;
}

export interface ResolveUriOptions {
  /** Allow plain `http:` URIs (or check against an explicit `http:` rule in `policy`). */
  allowHttp?: boolean;
  policy?: PermissionPolicy;
}

export interface UriDiagnosis {
  url: URL | null;
  reason?: string;
}

/**
 * Resolve a `uri` payload and explain why it was rejected if it returns `null`.
 */
export function diagnoseRemoteUri(uri: string, base: URL | null, opts: ResolveUriOptions = {}): UriDiagnosis {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    if (base === null) {
      return {
        url: null,
        reason: `Relative URI "${uri}" cannot be resolved without baseUrl. Pass baseUrl (e.g. baseUrl: location.href) and whitelist 'self'.`,
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
        reason: `Relative URI "${uri}" resolved to a different origin ("${u.origin}") than baseUrl ("${base.origin}").`,
      };
    }
  }
  if (u.username !== '' || u.password !== '') {
    return { url: null, reason: `URI "${uri}" contains embedded credentials, which are not permitted.` };
  }
  if (u.protocol === 'https:') return { url: u };
  if (u.protocol === 'http:') {
    if (
      opts.allowHttp === true ||
      opts.policy?.allowsHttpUrl(u, 'fetch') === true ||
      (base !== null && u.origin === base.origin)
    ) {
      return { url: u };
    }
    return {
      url: null,
      reason: `Plain http: URI "${u.href}" is blocked by default. To allow it, explicitly whitelist "${u.origin}" in permissions.allowOrigins (or set permissions.allowHttp: true).`,
    };
  }
  return {
    url: null,
    reason: `Unsupported URI scheme "${u.protocol}" in "${uri}". Only https: (or explicitly whitelisted http:) URIs can be fetched.`,
  };
}

/**
 * The address a `uri` payload points at, or null if it may not be fetched.
 * Absolute `https:` without credentials; relative references only against
 * `base`, and only to its own origin; `http:` if explicitly whitelisted or on `base`'s origin.
 */
export function resolveRemoteUri(uri: string, base: URL | null, opts: ResolveUriOptions = {}): URL | null {
  return diagnoseRemoteUri(uri, base, opts).url;
}

export interface BrowserUriPolicyOptions {
  /** Origins allowed without a per-resource grant. */
  origins?: () => ReadonlySet<string>;
  /** Unified permission policy (supports wildcards, `'self'`, `'*'`, explicit `http:`, and `allowFetch`). */
  policy?: PermissionPolicy;
  base?: () => URL | null;
  maxBytes?: number;
}

/**
 * `uri` policy for browsers (§5.5). Nothing is allowed by default; requests
 * send no cookies and no referrer; the response type is ignored.
 */
export function createBrowserUriPolicy(opts: BrowserUriPolicyOptions): UriPolicy {
  const maxBytes = opts.maxBytes ?? 16 * 1024 * 1024;
  const resolveOpts: ResolveUriOptions = opts.policy ? { policy: opts.policy } : {};
  const target = (uri: string): UriDiagnosis => diagnoseRemoteUri(uri, opts.base?.() ?? null, resolveOpts);
  return {
    allows(uri) {
      const { url } = target(uri);
      if (url === null) return false;
      if (opts.policy?.allowsFetch(url) === true) return true;
      return opts.origins?.().has(url.origin) === true;
    },
    async resolve(uri, signal) {
      const diag = target(uri);
      const u = diag.url;
      if (u === null) {
        throw new DecodeError(diag.reason ?? 'only https: URIs, or references relative to the document, can be fetched');
      }
      let res: Response;
      try {
        res = await fetch(u, {
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
          redirect: 'follow',
          ...(signal ? { signal } : {}),
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new DecodeError(
          `Network error fetching "${u.href}": ${msg}. Check CORS (Access-Control-Allow-Origin) on "${u.origin}" and your page's Content-Security-Policy (connect-src).`,
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