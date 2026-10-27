import type { FetchLike } from './decoders.js';

/** Upper bound for a document opened through `?url=`. */
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/**
 * Resolve a `?url=` value against the app address. Same-origin http(s) URLs
 * and absolute `https:` URLs are allowed; everything else (other schemes,
 * plain `http:` elsewhere, embedded credentials) is refused.
 */
export function resolveDocUrl(raw: string, appHref: string): URL | null {
  const s = raw.trim();
  if (s === '') return null;
  let app: URL;
  let u: URL;
  try {
    app = new URL(appHref);
    u = new URL(s, app);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username !== '' || u.password !== '') return null;
  u.hash = '';
  if (u.origin === app.origin) return u;
  return u.protocol === 'https:' ? u : null;
}

/**
 * Where a link in the rendered preview should go, if it should stay in the app.
 *
 * - `?url=…` and links to the app itself with `?url=` open that document.
 * - Relative links to `.md` files, inside a document opened by URL, resolve
 *   against that document and open in the app.
 * - Everything else returns null and keeps the browser's default behaviour.
 */
export function docLinkTarget(href: string, docUrl: URL | null, appHref: string): string | null {
  const h = href.trim();
  if (h === '' || h.startsWith('#')) return null;
  if (h.startsWith('?')) return new URLSearchParams(h).get('url') || null;
  let app: URL;
  let u: URL;
  try {
    app = new URL(appHref);
    u = new URL(h, docUrl ?? app);
  } catch {
    return null;
  }
  if (u.origin === app.origin && u.pathname === app.pathname && u.searchParams.has('url')) {
    return u.searchParams.get('url') || null;
  }
  if (docUrl === null || SCHEME.test(h) || h.startsWith('//')) return null;
  return /\.(?:md|markdown)$/i.test(u.pathname) ? u.href : null;
}

/** A display and save name for a document URL. */
export function docNameFor(u: URL): string {
  let seg = u.pathname.split('/').pop() ?? '';
  try {
    seg = decodeURIComponent(seg);
  } catch {
    // keep the raw segment
  }
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  seg = seg.replace(/[\u0000-\u001f\u007f/\\]/g, '').trim();
  return seg === '' ? 'document.md' : seg;
}

export interface FetchDocumentOptions {
  /** Same-origin requests may send cookies; cross-origin requests never do. */
  sameOrigin: boolean;
  fetch?: FetchLike;
  maxBytes?: number;
  signal?: AbortSignal;
}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (res.body === null) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) throw new Error(`the document is larger than ${maxBytes} bytes`);
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
}

/**
 * Fetch a Markdown2 document as text. This is the document itself, opened by
 * an explicit user action; nothing inside it is unlocked or fetched.
 */
export async function fetchDocument(url: URL, o: FetchDocumentOptions): Promise<string> {
  const doFetch: FetchLike = o.fetch ?? ((u, init) => fetch(u, init));
  const maxBytes = o.maxBytes ?? MAX_DOCUMENT_BYTES;
  const res = await doFetch(url, {
    credentials: o.sameOrigin ? 'same-origin' : 'omit',
    referrerPolicy: 'no-referrer',
    redirect: 'follow',
    headers: { accept: 'text/markdown, text/plain;q=0.9, */*;q=0.1' },
    ...(o.signal ? { signal: o.signal } : {}),
  });
  if (!res.ok) throw new Error(`HTTP status ${res.status}`);
  // Guards against SPA fallbacks that answer unknown paths with the app shell.
  if (/^\s*text\/html\b/i.test(res.headers.get('content-type') ?? '')) {
    throw new Error('the server returned an HTML page, not a Markdown document');
  }
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`the document is larger than ${maxBytes} bytes`);
  }
  const bytes = await readCapped(res, maxBytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('the document is not valid UTF-8');
  }
}