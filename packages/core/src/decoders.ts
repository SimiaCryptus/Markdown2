export class LimitExceeded extends Error {}
export class DecodeError extends Error {
  constructor(
    message: string,
    readonly code: 'decode-error' | 'invalid-utf-8' = 'decode-error',
  ) {
    super(message);
  }
}
export class KeyRejected extends Error {}

/** Shared quota, charged while bytes are produced (§6.3). */
export class ByteQuota {
  used = 0;
  constructor(readonly limit: number) {}
  charge(n: number): void {
    this.used += n;
    if (this.used > this.limit) throw new LimitExceeded(`quota of ${this.limit} bytes exceeded`);
  }
}

export interface UriPolicy {
  allows(uri: string): boolean;
  resolve(uri: string, signal?: AbortSignal): Promise<Uint8Array>;
}

export interface DecodeContext {
  quota: ByteQuota;
  signal?: AbortSignal;
  grant?: unknown;
  uriPolicy?: UriPolicy;
}

export type Capability = 'key' | 'network';

export interface Decoder {
  id: string;
  position: 'first' | 'any';
  capability?: Capability;
  decode(input: Uint8Array, ctx: DecodeContext): Promise<Uint8Array>;
}

/** Swallow a rejection whose error is surfaced through another path. */
const ignore = (): undefined => undefined;

function assertUtf8(input: Uint8Array): Uint8Array {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(input);
  } catch {
    throw new DecodeError('invalid UTF-8', 'invalid-utf-8');
  }
  return input;
}

export const utf8Decoder: Decoder = {
  id: 'utf-8',
  position: 'any',
  decode(input) {
    // A throw inside the executor rejects the promise.
    return new Promise((resolve) => {
      resolve(assertUtf8(input));
    });
  },
};

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64 = new Int16Array(256).fill(-1);
for (let i = 0; i < B64_ALPHABET.length; i++) B64[B64_ALPHABET.charCodeAt(i)] = i;
const EQ = 0x3d;

function isB64Space(b: number): boolean {
  return b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d || b === 0x0c;
}

function decodeBase64(input: Uint8Array, quota: ByteQuota): Uint8Array {
  const chars = input.filter((b) => !isB64Space(b));
  if (chars.length % 4 !== 0) throw new DecodeError('base64 length is not a multiple of 4');
  const pad = chars.at(-1) === EQ ? (chars.at(-2) === EQ ? 2 : 1) : 0;
  const outLen = (chars.length / 4) * 3 - pad;
  quota.charge(outLen);
  const out = new Uint8Array(outLen);
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (const c of chars.subarray(0, chars.length - pad)) {
    const d = B64[c] ?? -1;
    if (d < 0) throw new DecodeError('invalid base64 character');
    acc = (acc << 6) | d;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
      acc &= (1 << bits) - 1;
    }
  }
  return out;
}

export const base64Decoder: Decoder = {
  id: 'base64',
  position: 'any',
  decode(input, ctx) {
    return new Promise((resolve) => {
      resolve(decodeBase64(input, ctx.quota));
    });
  },
};

export const gzipDecoder: Decoder = {
  id: 'gzip',
  position: 'any',
  async decode(input, ctx) {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    // Copy into an ArrayBuffer-backed view: streams do not accept SharedArrayBuffer views.
    writer.write(new Uint8Array(input)).catch(ignore);
    writer.close().catch(ignore);
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        if (ctx.signal?.aborted) throw new DecodeError('aborted');
        const { done, value } = await reader.read();
        if (done) break;
        ctx.quota.charge(value.length); // abort as soon as quota is exceeded
        chunks.push(value);
        total += value.length;
      }
    } catch (e) {
      await reader.cancel().catch(ignore);
      if (e instanceof LimitExceeded || e instanceof DecodeError) throw e;
      throw new DecodeError('corrupt gzip data');
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

export const uriDecoder: Decoder = {
  id: 'uri',
  position: 'first',
  capability: 'network',
  async decode(input, ctx) {
    const uri = new TextDecoder().decode(input).trim();
    const policy = ctx.uriPolicy;
    // Either a per-node grant (§5.5) or the reader policy authorises resolution.
    // Resolution itself always goes through the policy, which keeps its own checks.
    if (policy === undefined || (ctx.grant === undefined && !policy.allows(uri))) {
      throw new DecodeError('uri not permitted');
    }
    const bytes = await policy.resolve(uri, ctx.signal);
    ctx.quota.charge(bytes.length);
    return bytes; // bytes only: the declared type stays authoritative
  },
};

/** Default policy: every scheme stays locked (§5.5). */
export const lockedUriPolicy = (): UriPolicy => ({
  allows: () => false,
  resolve: () => Promise.reject(new DecodeError('uri resolution disabled')),
});

export class DecoderRegistry {
  private readonly map = new Map<string, Decoder>();
  constructor(decoders: Decoder[] = [utf8Decoder, base64Decoder, gzipDecoder, uriDecoder]) {
    for (const d of decoders) this.register(d);
  }
  register(d: Decoder): void {
    this.map.set(d.id.toLowerCase(), d);
  }
  get(id: string): Decoder | undefined {
    return this.map.get(id.toLowerCase());
  }
}
