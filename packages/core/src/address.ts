/**
 * SSRF guard for server-side renderers (§5.5).
 *
 * Call this on the resolved address of the initial request and of every
 * redirect. Addresses are parsed numerically, never compared as strings, so
 * alternative spellings such as `0:0:0:0:0:0:0:1` or `::ffff:7f00:1` cannot
 * slip through. Input that cannot be parsed is treated as forbidden
 * (fail closed, spec-issues #13).
 */

type V4 = readonly [number, number, number, number];

const OCTET = /^(0|[1-9]\d{0,2})$/; // no leading zeros: avoids octal ambiguity
const HEXTET = /^[0-9a-f]{1,4}$/;

function parseV4(s: string): V4 | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!OCTET.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  const [a = 0, b = 0, c = 0, d = 0] = out;
  return [a, b, c, d];
}

function forbiddenV4([a, b, c]: V4): boolean {
  return (
    a === 0 || // "this" network
    a === 10 || // private
    a === 127 || // loopback
    a >= 224 || // multicast, reserved, broadcast
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) // benchmarking
  );
}

function parseGroups(h: string): number[] | null {
  if (h === '') return [];
  const out: number[] = [];
  for (const g of h.split(':')) {
    if (!HEXTET.test(g)) return null;
    out.push(Number.parseInt(g, 16));
  }
  return out;
}

/** Parse an IPv6 address into exactly eight 16-bit groups. */
function parseV6(input: string): number[] | null {
  let s = input.toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);

  // Embedded dotted IPv4 tail, e.g. ::ffff:10.0.0.1 → ::ffff:a00:1
  const embedded = /^(.*:)([^:]*\.[^:]*)$/.exec(s);
  if (embedded) {
    const v4 = parseV4(embedded[2] ?? '');
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    s = `${embedded[1] ?? ''}${hi}:${lo}`;
  }

  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = parseGroups(halves[0] ?? '');
  const tail = halves.length === 2 ? parseGroups(halves[1] ?? '') : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...tail];
}

function forbiddenV6(h: readonly number[]): boolean {
  const g = (k: number): number => h[k] ?? 0;
  const v4At = (k: number): V4 => [g(k) >> 8, g(k) & 0xff, g(k + 1) >> 8, g(k + 1) & 0xff];
  const zero = (from: number, to: number) => h.slice(from, to).every((x) => x === 0);

  // ::, ::1 and the deprecated IPv4-compatible range ::/96.
  if (zero(0, 6)) return true;
  // IPv4-mapped ::ffff:0:0/96.
  if (zero(0, 5) && g(5) === 0xffff) return forbiddenV4(v4At(6));
  // NAT64 64:ff9b::/96.
  if (g(0) === 0x64 && g(1) === 0xff9b && zero(2, 6)) return forbiddenV4(v4At(6));
  // 6to4 2002::/16 embeds an IPv4 address in groups 1–2.
  if (g(0) === 0x2002) return forbiddenV4(v4At(1));

  const top = g(0);
  return (
    (top & 0xfe00) === 0xfc00 || // unique local fc00::/7
    (top & 0xffc0) === 0xfe80 || // link-local fe80::/10
    (top & 0xffc0) === 0xfec0 || // deprecated site-local fec0::/10
    (top & 0xff00) === 0xff00 || // multicast ff00::/8
    (top === 0x2001 && (g(1) === 0 || g(1) === 0x0db8)) // Teredo, documentation
  );
}

export function isForbiddenAddress(ip: string): boolean {
  const s = ip.trim();
  if (s.includes(':')) {
    const h = parseV6(s);
    return h === null || forbiddenV6(h);
  }
  const v4 = parseV4(s);
  return v4 === null || forbiddenV4(v4);
}
