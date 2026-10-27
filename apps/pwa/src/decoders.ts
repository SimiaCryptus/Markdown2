import { DecodeError, DecoderRegistry, KeyRejected, LimitExceeded, type Decoder, type UriPolicy } from '@markdown2/core';

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
  origins: () => ReadonlySet<string>;
  /**
   * Address of the open document, when it has one (opened by URL). Relative
   * references resolve against it and must stay on its origin (spec-issues #33).
   */
  base?: () => URL | null;
  fetch?: FetchLike;
  /** Response body cap, enforced while streaming. Default 16 MiB. */
  maxBytes?: number;
}

/**
 * The address a `uri` payload points at, or null if it may not be fetched.
 *
 * - Absolute `https:` URIs without credentials are allowed.
 * - Relative references resolve against `base` only, and only to its own origin.
 * - Plain `http:` is allowed only on the base's own origin (local development).
 */
export function resolveRemoteUri(uri: string, base: URL | null): URL | null {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    if (base === null) return null; // relative references need a trusted base
    try {
      u = new URL(uri, base);
    } catch {
      return null;
    }
    if (u.origin !== base.origin) return null;
  }
  if (u.username !== '' || u.password !== '') return null;
  if (u.protocol === 'https:') return u;
  return u.protocol === 'http:' && base !== null && u.origin === base.origin ? u : null;
}

/**
 * Browser `uri` policy (§5.5). Nothing is allowed by default. Browsers cannot
 * see resolved addresses, so the SSRF rules are out of reach (spec-issues #22).
 * The response `Content-Type` is ignored: the declared type stays authoritative.
 */
export function createBrowserUriPolicy(opts: BrowserUriPolicyOptions): UriPolicy {
  const doFetch: FetchLike = opts.fetch ?? ((url, init) => fetch(url, init));
  const maxBytes = opts.maxBytes ?? 16 * 1024 * 1024;
  const target = (uri: string): URL | null => resolveRemoteUri(uri, opts.base?.() ?? null);
  return {
    allows(uri) {
      const u = target(uri);
      return u !== null && opts.origins().has(u.origin);
    },
    async resolve(uri, signal) {
      const u = target(uri);
      if (u === null) throw new DecodeError('only https: URIs, or references relative to this document, can be fetched');
      const res = await doFetch(u, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        redirect: 'follow',
        ...(signal ? { signal } : {}),
      });
      if (!res.ok) throw new DecodeError(`HTTP status ${res.status}`);
      if (res.body === null) return new Uint8Array(0);
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > maxBytes) throw new LimitExceeded(`response exceeds ${maxBytes} bytes`);
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