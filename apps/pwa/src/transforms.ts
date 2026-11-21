import {
  base64Decoder,
  ByteQuota,
  encodeBase64,
  gzipDecoder,
  parse,
  type ResourceNode,
} from '@markdown2/core';
import { ageDecoder, type KeyGrant } from './decoders.js';

/**
 * Source-level authoring transforms for Markdown2 documents.
 * All functions are DOM-free so they can be unit-tested directly.
 */

const TOKEN_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const DEFAULT_QUOTA = 32 * 1024 * 1024;

export type EncryptKey =
  | { kind: 'passphrase'; value: string }
  | { kind: 'recipient'; value: string };

export interface ResourceSpan {
  node: ResourceNode;
  /** 0-based line of `<<<TOKEN`. */
  startLine: number;
  /** 0-based line of closing `TOKEN`. */
  endLine: number;
  /** 0-based first line including `<!--` wrapper if present. */
  outerStartLine: number;
  /** 0-based last line including `-->` wrapper if present. */
  outerEndLine: number;
  /** True when wrapped in `<!-- ... -->` compatibility comment (§7.1). */
  wrapped: boolean;
}

export interface ResourceBlockSpec {
  type: string;
  payload: string;
  encoding?: string | undefined;
  rel?: string | undefined;
  title?: string | undefined;
  filename?: string | undefined;
  attributes?: ReadonlyMap<string, string> | Readonly<Record<string, string>> | undefined;
  token?: string | undefined;
  wrapped?: boolean | undefined;
}

export type EncodeOp =
  | {
      kind: 'wrap';
      type?: string | undefined;
      title?: string | undefined;
      token?: string | undefined;
      wrapped?: boolean | undefined;
    }
  | {
      kind: 'base64';
      type?: string | undefined;
      title?: string | undefined;
      token?: string | undefined;
      wrapped?: boolean | undefined;
    }
  | {
      kind: 'gzip';
      type?: string | undefined;
      title?: string | undefined;
      token?: string | undefined;
      wrapped?: boolean | undefined;
    }
  | {
      kind: 'age';
      key: EncryptKey;
      compress?: boolean | undefined;
      type?: string | undefined;
      title?: string | undefined;
      token?: string | undefined;
      wrapped?: boolean | undefined;
      workFactor?: number | undefined;
    };

export interface DecodeBlockOptions {
  mode: 'unwrap' | 'in-place';
  getKey?: (layer: number, total: number) => Promise<KeyGrant | null>;
}

export type DecodeBlockResult =
  | { cancelled: true }
  | { cancelled: false; text: string };

/** Wrap a base64 string at 76 columns so diffs stay line-oriented (§7.4). */
export function wrap76(b64: string): string {
  return b64.replace(/.{76}/g, '$&\n').replace(/\n$/, '');
}

/** Pick a terminator token that no payload line equals (§4.1). */
export function pickToken(payload: string, base = 'RES'): string {
  const cleanBase = TOKEN_RE.test(base) ? base : 'RES';
  const lines = new Set(payload.split(/\r?\n/).map((l) => l.replace(/[ \t]+$/, '')));
  let t = cleanBase;
  for (let n = 2; lines.has(t); n++) t = `${cleanBase}${n}`;
  return t;
}

function formatAttr(name: string, value: string): string {
  if (/[\r\n]/.test(value)) throw new Error(`Attribute "${name}" cannot contain a line break`);
  if (!value.includes('"')) return ` ${name}="${value}"`;
  if (!value.includes("'")) return ` ${name}='${value}'`;
  throw new Error(`Attribute "${name}" cannot contain both quote characters`);
}

/** Build a Markdown2 resource block string. */
export function formatResourceBlock(spec: ResourceBlockSpec): string {
  const token = pickToken(spec.payload, spec.token ?? 'RES');
  let attrs = formatAttr('type', spec.type);
  if (spec.encoding !== undefined && spec.encoding !== '' && spec.encoding !== 'utf-8') {
    attrs += formatAttr('encoding', spec.encoding);
  }
  if (spec.rel !== undefined && spec.rel !== '' && spec.rel !== 'inline') {
    attrs += formatAttr('rel', spec.rel);
  }
  if (spec.title !== undefined && spec.title !== '') {
    attrs += formatAttr('title', spec.title);
  }
  if (spec.filename !== undefined && spec.filename !== '') {
    attrs += formatAttr('filename', spec.filename);
  }
  const reserved = new Set(['type', 'encoding', 'rel', 'title', 'filename']);
  if (spec.attributes !== undefined) {
    const entries =
      spec.attributes instanceof Map ? [...spec.attributes.entries()] : Object.entries(spec.attributes);
    for (const [k, v] of entries) {
      if (!reserved.has(k.toLowerCase())) attrs += formatAttr(k, v);
    }
  }
  const body = spec.payload === '' ? '' : `${spec.payload}\n`;
  const block = `<<<${token}${attrs}\n${body}${token}`;
  return spec.wrapped === true ? `<!--\n${block}\n-->` : block;
}

/** Base64-encode bytes and wrap at 76 columns. */
export function base64Encode(bytes: Uint8Array): string {
  return wrap76(encodeBase64(bytes));
}

/** Decode base64 text into bytes. */
export async function base64Decode(text: string): Promise<Uint8Array> {
  return base64Decoder.decode(new TextEncoder().encode(text), {
    quota: new ByteQuota(DEFAULT_QUOTA),
  });
}

/** Compress bytes with gzip. */
export async function gzipCompress(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter();
  w.write(new Uint8Array(bytes)).catch(() => undefined);
  w.close().catch(() => undefined);
  const buf = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(buf);
}

/** Decompress gzip bytes. */
export async function gzipDecompress(bytes: Uint8Array): Promise<Uint8Array> {
  return gzipDecoder.decode(bytes, { quota: new ByteQuota(DEFAULT_QUOTA) });
}

/** Encrypt bytes using `age` (passphrase or `age1…` recipient). */
export async function ageEncrypt(
  bytes: Uint8Array,
  key: EncryptKey,
  workFactor?: number,
): Promise<Uint8Array> {
  const { Encrypter } = await import('age-encryption');
  const e = new Encrypter();
  if (key.kind === 'passphrase') {
    e.setPassphrase(key.value);
    if (workFactor !== undefined) e.setScryptWorkFactor(workFactor);
  } else {
    e.addRecipient(key.value.trim());
  }
  return e.encrypt(new Uint8Array(bytes));
}

/** Decrypt `age` ciphertext using a passphrase or `AGE-SECRET-KEY-1…` identity. */
export async function ageDecrypt(bytes: Uint8Array, key: KeyGrant): Promise<Uint8Array> {
  return ageDecoder.decode(bytes, {
    quota: new ByteQuota(DEFAULT_QUOTA),
    grant: key,
  });
}

/** True if a resource node has non-default encoding stages (anything other than plain `utf-8`). */
export function isEncodedResource(node: ResourceNode): boolean {
  const enc = node.resource.encoding;
  return !(enc.length === 1 && enc[0] === 'utf-8');
}

/**
 * Find the top-level non-frontmatter resource block containing 0-based `line0`.
 * Accounts for `<!-- ... -->` compatibility wrapper lines when `syntax === 'wrapped'`.
 */
export function findResourceAtLine(src: string, line0: number): ResourceSpan | null {
  const doc = parse(src);
  const lines = src.split(/\r?\n/);
  for (const child of doc.children) {
    if (child.kind !== 'resource' || child.syntax === 'frontmatter') continue;
    const wrapped = child.syntax === 'wrapped';
    const outerStartLine = wrapped && child.startLine > 0 ? child.startLine - 1 : child.startLine;
    const hasCloser =
      wrapped && child.endLine + 1 < lines.length && lines[child.endLine + 1]?.trim() === '-->';
    const outerEndLine = hasCloser ? child.endLine + 1 : child.endLine;
    if (line0 >= outerStartLine && line0 <= outerEndLine) {
      return {
        node: child,
        startLine: child.startLine,
        endLine: child.endLine,
        outerStartLine,
        outerEndLine,
        wrapped,
      };
    }
  }
  return null;
}

/** Encode arbitrary selected text into a new Markdown2 resource block. */
export async function encodeSelection(text: string, op: EncodeOp): Promise<string> {
  const type = op.type?.trim() || 'text/markdown';
  const title = op.title?.trim() || undefined;
  const raw = new TextEncoder().encode(text);

  if (op.kind === 'wrap') {
    return formatResourceBlock({
      type,
      title,
      token: op.token ?? 'RES',
      payload: text,
      wrapped: op.wrapped ?? false,
    });
  }

  if (op.kind === 'base64') {
    return formatResourceBlock({
      type,
      encoding: 'base64',
      title,
      token: op.token ?? 'DATA',
      payload: base64Encode(raw),
      wrapped: op.wrapped ?? true,
    });
  }

  if (op.kind === 'gzip') {
    const gz = await gzipCompress(raw);
    return formatResourceBlock({
      type,
      encoding: 'base64 gzip',
      title,
      token: op.token ?? 'GZIP',
      payload: base64Encode(gz),
      wrapped: op.wrapped ?? true,
    });
  }

  // age (optionally compressed first)
  const payloadBytes = op.compress === true ? await gzipCompress(raw) : raw;
  const ct = await ageEncrypt(payloadBytes, op.key, op.workFactor);
  const encoding = op.compress === true ? 'base64 age gzip' : 'base64 age';
  return formatResourceBlock({
    type,
    encoding,
    title,
    token: op.token ?? 'SECRET',
    payload: base64Encode(ct),
    wrapped: op.wrapped ?? true,
  });
}

/**
 * Apply an encoding transform to an existing Markdown2 resource block in-place.
 * Preserves type, rel, title, filename, custom attributes, and token.
 * Avoids redundant double-base64 when stacking encodings onto an already base64-encoded block.
 */
export async function encodeResourceBlock(
  node: ResourceNode,
  wrapped: boolean,
  op: Exclude<EncodeOp, { kind: 'wrap' }>,
): Promise<string> {
  const existingEnc = node.resource.encoding.map((e) => e.toLowerCase());
  if (existingEnc.includes('uri')) {
    throw new Error('Cannot encode a remote uri resource in-place');
  }

  // Unwrap an existing outer base64 layer so we don't produce `base64 age base64 gzip`.
  let bytes: Uint8Array = node.resource.payload;
  let remainingEnc = existingEnc.filter((e) => e !== 'utf-8');
  if (remainingEnc[0] === 'base64') {
    bytes = await base64Decode(new TextDecoder().decode(bytes));
    remainingEnc = remainingEnc.slice(1);
  }

  let newStages: string[];
  if (op.kind === 'base64') {
    newStages = ['base64', ...remainingEnc];
  } else if (op.kind === 'gzip') {
    bytes = await gzipCompress(bytes);
    newStages = ['base64', 'gzip', ...remainingEnc];
  } else {
    if (op.compress === true) {
      bytes = await gzipCompress(bytes);
      bytes = await ageEncrypt(bytes, op.key, op.workFactor);
      newStages = ['base64', 'age', 'gzip', ...remainingEnc];
    } else {
      bytes = await ageEncrypt(bytes, op.key, op.workFactor);
      newStages = ['base64', 'age', ...remainingEnc];
    }
  }

  return formatResourceBlock({
    type: node.resource.type ?? op.type ?? 'text/plain',
    encoding: newStages.join(' '),
    rel: node.rel,
    title: op.title !== undefined && op.title !== '' ? op.title : node.resource.attributes.get('title'),
    filename: node.resource.attributes.get('filename'),
    attributes: node.resource.attributes,
    token: node.token ?? op.token ?? 'RES',
    payload: base64Encode(bytes),
    wrapped: op.wrapped ?? wrapped,
  });
}

function decodeUtf8Strict(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Decoded bytes are binary (not valid UTF-8 text)');
  }
}

/**
 * Decode (decrypt / decompress / base64-decode) a Markdown2 resource block.
 * Supports both unwrapping to plain text and decoding the payload in-place.
 */
export async function decodeResourceBlock(
  node: ResourceNode,
  wrapped: boolean,
  opts: DecodeBlockOptions,
): Promise<DecodeBlockResult> {
  const stages = node.resource.encoding.map((s) => s.toLowerCase());
  const ageTotal = stages.filter((s) => s === 'age').length;
  let ageIndex = 0;
  let bytes: Uint8Array = node.resource.payload;

  for (const stage of stages) {
    if (stage === 'utf-8') continue;
    if (stage === 'uri') {
      throw new Error('Cannot decode a remote uri resource in the editor');
    }
    if (stage === 'base64') {
      bytes = await base64Decode(new TextDecoder().decode(bytes));
      continue;
    }
    if (stage === 'gzip') {
      bytes = await gzipDecompress(bytes);
      continue;
    }
    if (stage === 'age') {
      ageIndex++;
      const key = opts.getKey ? await opts.getKey(ageIndex, ageTotal) : null;
      if (key === null) return { cancelled: true };
      bytes = await ageDecrypt(bytes, key);
      continue;
    }
    throw new Error(`Unsupported encoding stage "${stage}"`);
  }

  const text = decodeUtf8Strict(bytes);
  if (opts.mode === 'unwrap') {
    return { cancelled: false, text };
  }

  return {
    cancelled: false,
    text: formatResourceBlock({
      type: node.resource.type ?? 'text/plain',
      rel: node.rel,
      title: node.resource.attributes.get('title'),
      filename: node.resource.attributes.get('filename'),
      attributes: node.resource.attributes,
      token: node.token ?? 'RES',
      payload: text,
      wrapped,
    }),
  };
}

/** Decode raw selected base64 (or base64+gzip) text outside a resource block. */
export async function decodeRawSelection(text: string, kind: 'base64' | 'gzip'): Promise<string> {
  let bytes = await base64Decode(text);
  if (kind === 'gzip') bytes = await gzipDecompress(bytes);
  return decodeUtf8Strict(bytes);
}

/** Toggle the `<!-- ... -->` compatibility wrapper around a resource span. */
export function toggleCompatWrapper(
  src: string,
  span: ResourceSpan,
): { startLine: number; endLine: number; text: string } {
  const lines = src.split(/\r?\n/);
  const inner = lines.slice(span.startLine, span.endLine + 1).join('\n');
  if (span.wrapped) {
    return { startLine: span.outerStartLine, endLine: span.outerEndLine, text: inner };
  }
  return {
    startLine: span.startLine,
    endLine: span.endLine,
    text: `<!--\n${inner}\n-->`,
  };
}
