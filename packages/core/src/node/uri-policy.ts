import type { LookupAddress } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { isForbiddenAddress } from '../address.js';
import { DecodeError, LimitExceeded, type UriPolicy } from '../decoders.js';

/**
 * Server-side `uri` policy (§5.5).
 *
 * - Only the configured schemes are allowed (default: `https:` only).
 * - Credentials in the URI are refused.
 * - Literal IP hosts are checked before connecting.
 * - Host names are checked at connect time through a custom `lookup`. The
 *   socket connects to exactly the address that was checked, so a DNS answer
 *   that changes between check and connect (rebinding) cannot slip through.
 *   A host is refused if *any* of its addresses is forbidden.
 * - Every redirect goes through the same checks.
 * - Connections are never pooled. A socket opened by unguarded code must not
 *   be reused for a guarded request.
 * - The body is size-capped while it streams.
 * - The response `Content-Type` is ignored: the declared type stays authoritative.
 */

export type HostResolver = (hostname: string) => Promise<readonly LookupAddress[]>;

export interface ServerUriPolicyOptions {
  /** Permitted URL schemes, including the colon. Default `['https:']`. */
  schemes?: readonly string[];
  /** Additional host allowlist check. Default: every public host. */
  allowHost?: (hostname: string) => boolean;
  /** Maximum number of redirects followed. Default 5. */
  maxRedirects?: number;
  /** Maximum response body size in bytes. Default 16 MiB. */
  maxBytes?: number;
  /** Socket inactivity timeout in milliseconds. Default 10 000. */
  timeoutMs?: number;
  /** Host name resolver. Default: `dns.lookup` with `all: true`. */
  resolveHost?: HostResolver;
  /**
   * Address predicate. **Testing only**: never relax this in production.
   * Default {@link isForbiddenAddress}.
   */
  isForbidden?: (ip: string) => boolean;
}

/** Raised when a URI, redirect target or resolved address is refused. */
export class ForbiddenAddressError extends DecodeError {}

const defaultResolver: HostResolver = (hostname) => dnsLookup(hostname, { all: true });

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const unbracket = (host: string): string => (host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host);

function guardedLookup(resolveHost: HostResolver, forbidden: (ip: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    resolveHost(hostname).then(
      (addresses) => {
        const first = addresses[0];
        const bad = addresses.find((a) => forbidden(a.address));
        if (first === undefined || bad !== undefined) {
          const detail = bad ? ` (${bad.address})` : '';
          callback(new ForbiddenAddressError(`${hostname} resolves to a forbidden address${detail}`), []);
          return;
        }
        if (options.all) callback(null, [...addresses]);
        else callback(null, first.address, first.family);
      },
      (err: unknown) => {
        callback(new DecodeError(`cannot resolve ${hostname}: ${message(err)}`), []);
      },
    );
  };
}

type Hop = { body: Uint8Array } | { location: string };

interface FetchOptions {
  lookup: LookupFunction;
  maxBytes: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

function fetchOnce(url: URL, o: FetchOptions): Promise<Hop> {
  return new Promise<Hop>((resolve, reject) => {
    const options: http.RequestOptions = {
      method: 'GET',
      agent: false, // never reuse pooled sockets
      lookup: o.lookup,
      timeout: o.timeoutMs,
      headers: { accept: '*/*', 'accept-encoding': 'identity' },
      ...(o.signal ? { signal: o.signal } : {}),
    };
    const onResponse = (res: http.IncomingMessage): void => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location !== undefined) {
        res.resume();
        resolve({ location });
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        reject(new DecodeError(`HTTP status ${status}`));
        return;
      }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > o.maxBytes) {
        reject(new LimitExceeded(`response of ${declared} bytes exceeds ${o.maxBytes}`));
        req.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > o.maxBytes) {
          reject(new LimitExceeded(`response exceeds ${o.maxBytes} bytes`));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        resolve({ body: new Uint8Array(Buffer.concat(chunks)) });
      });
      res.on('error', (e) => {
        reject(new DecodeError(`response failed: ${e.message}`));
      });
    };
    const req =
      url.protocol === 'https:' ? https.request(url, options, onResponse) : http.request(url, options, onResponse);
    req.on('timeout', () => {
      req.destroy(new DecodeError('request timed out'));
    });
    req.on('error', (e) => {
      reject(
        e instanceof DecodeError || e instanceof LimitExceeded ? e : new DecodeError(`request failed: ${e.message}`),
      );
    });
    req.end();
  });
}

export function createServerUriPolicy(opts: ServerUriPolicyOptions = {}): UriPolicy {
  const schemes = new Set((opts.schemes ?? ['https:']).map((s) => s.toLowerCase()));
  const forbidden = opts.isForbidden ?? isForbiddenAddress;
  const allowHost = opts.allowHost ?? (() => true);
  const maxRedirects = opts.maxRedirects ?? 5;
  const maxBytes = opts.maxBytes ?? 16 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const lookup = guardedLookup(opts.resolveHost ?? defaultResolver, forbidden);

  const parseUrl = (uri: string): URL | null => {
    try {
      return new URL(uri);
    } catch {
      return null; // relative references have no base on a server
    }
  };

  /** Static checks; returns a reason when the URL is refused. */
  const problem = (url: URL): string | null => {
    if (!schemes.has(url.protocol)) return `scheme ${url.protocol} not permitted`;
    if (url.username !== '' || url.password !== '') return 'credentials in URI not permitted';
    const host = unbracket(url.hostname);
    if (host === '') return 'URI has no host';
    if (isIP(host) !== 0 && forbidden(host)) return `forbidden address ${host}`;
    if (!allowHost(url.hostname)) return `host ${url.hostname} not permitted`;
    return null;
  };

  return {
    allows(uri) {
      const url = parseUrl(uri);
      return url !== null && problem(url) === null;
    },
    async resolve(uri, signal) {
      let url = parseUrl(uri);
      if (url === null) throw new DecodeError('invalid or relative URI');
      for (let hop = 0; ; hop++) {
        const reason = problem(url);
        if (reason !== null) throw new ForbiddenAddressError(reason);
        const res = await fetchOnce(url, { lookup, maxBytes, timeoutMs, ...(signal ? { signal } : {}) });
        if ('body' in res) return res.body;
        if (hop >= maxRedirects) throw new DecodeError(`too many redirects (more than ${maxRedirects})`);
        const next = parseRedirect(res.location, url);
        if (next === null) throw new DecodeError('invalid redirect location');
        url = next;
      }
    },
  };
}

function parseRedirect(location: string, base: URL): URL | null {
  try {
    return new URL(location, base);
  } catch {
    return null;
  }
}
