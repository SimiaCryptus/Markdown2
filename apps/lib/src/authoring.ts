import { encodeBase64 } from '@markdown2/core';

/**
 * Authoring helpers: build resource blocks and their payloads.
 * Payloads are base64-wrapped at 76 columns so diffs stay line-oriented (§7.4).
 */

const TOKEN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export function wrap76(b64: string): string {
  return b64.replace(/.{76}/g, '$&\n').replace(/\n$/, '');
}

/** gzip, then base64: use with `encoding="base64 gzip"`. */
export async function gzipBase64(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter();
  w.write(new Uint8Array(bytes)).catch(() => undefined);
  w.close().catch(() => undefined);
  const buf = await new Response(cs.readable).arrayBuffer();
  return wrap76(encodeBase64(new Uint8Array(buf)));
}

export interface EncryptOptions {
  /** scrypt work factor (log2 N). Lower is faster to unlock and easier to brute-force. */
  workFactor?: number;
}

/** age-encrypt with a passphrase, then base64: use with `encoding="base64 age"`. */
export async function encryptAge(input: string | Uint8Array, passphrase: string, opts: EncryptOptions = {}): Promise<string> {
  const { Encrypter } = await import('age-encryption');
  const e = new Encrypter();
  e.setPassphrase(passphrase);
  if (opts.workFactor !== undefined) {
    (e as unknown as { setScryptWorkFactor?: (n: number) => void }).setScryptWorkFactor?.(opts.workFactor);
  }
  const ct = await e.encrypt(typeof input === 'string' ? input : new Uint8Array(input));
  return wrap76(encodeBase64(ct));
}

/** A terminator token that no payload line equals (§4.1). */
export function pickToken(payload: string, base = 'RES'): string {
  if (!TOKEN.test(base)) throw new Error(`invalid token: ${base}`);
  const lines = new Set(payload.split(/\r?\n/).map((l) => l.replace(/[ \t]+$/, '')));
  let t = base;
  for (let n = 2; lines.has(t); n++) t = `${base}${n}`;
  return t;
}

function attr(name: string, value: string): string {
  if (/[\r\n]/.test(value)) throw new Error(`attribute ${name} cannot contain a line break`);
  if (!value.includes('"')) return ` ${name}="${value}"`;
  if (!value.includes("'")) return ` ${name}='${value}'`;
  throw new Error(`attribute ${name} cannot contain both quote characters`);
}

export interface ResourceSpec {
  type: string;
  payload: string;
  encoding?: string;
  rel?: string;
  title?: string;
  filename?: string;
  attributes?: Readonly<Record<string, string>>;
  /** Preferred token; a suffix is added if a payload line equals it. */
  token?: string;
  /** Wrap in the compatibility comment (§7.1). */
  wrap?: boolean;
}

/** Build a resource block. */
export function resource(spec: ResourceSpec): string {
  const token = pickToken(spec.payload, spec.token ?? 'RES');
  let attrs = attr('type', spec.type);
  if (spec.encoding !== undefined) attrs += attr('encoding', spec.encoding);
  if (spec.rel !== undefined) attrs += attr('rel', spec.rel);
  if (spec.title !== undefined) attrs += attr('title', spec.title);
  if (spec.filename !== undefined) attrs += attr('filename', spec.filename);
  for (const [k, v] of Object.entries(spec.attributes ?? {})) attrs += attr(k, v);
  const block = `<<<${token}${attrs}\n${spec.payload}\n${token}`;
  return spec.wrap === true ? `<!--\n${block}\n-->` : block;
}