import { DecodeError, DecoderRegistry, KeyRejected, LimitExceeded, type Decoder, type UriPolicy } from '@markdown2/core';

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

/**
 * The address a `uri` payload points at, or null if it may not be fetched.
 * Absolute `https:` without credentials; relative references only against
 * `base`, and only to its own origin.
 */
export function resolveRemoteUri(uri: string, base: URL | null): URL | null {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    if (base === null) return null;
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

export interface BrowserUriPolicyOptions {
  /** Origins allowed without a per-resource grant. */
  origins: () => ReadonlySet<string>;
  base?: () => URL | null;
  maxBytes?: number;
}

/**
 * `uri` policy for browsers (§5.5). Nothing is allowed by default; requests
 * send no cookies and no referrer; the response type is ignored.
 */
export function createBrowserUriPolicy(opts: BrowserUriPolicyOptions): UriPolicy {
  const maxBytes = opts.maxBytes ?? 16 * 1024 * 1024;
  const target = (uri: string): URL | null => resolveRemoteUri(uri, opts.base?.() ?? null);
  return {
    allows(uri) {
      const u = target(uri);
      return u !== null && opts.origins().has(u.origin);
    },
    async resolve(uri, signal) {
      const u = target(uri);
      if (u === null) throw new DecodeError('only https: URIs, or references relative to the document, can be fetched');
      const res = await fetch(u, {
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