import type { ErrorCode } from './types.js';

const OPENER_START = /^<<<([A-Za-z_][A-Za-z0-9_.-]*)(?=[ \t]|$)/;
const ATTRIBUTE = /^([A-Za-z][A-Za-z0-9-]*)=(?:"([^"]*)"|'([^']*)')/;

export interface ParsedOpener {
  token: string;
  attributes: Map<string, string>;
  error?: ErrorCode;
}

/**
 * Parse a line (without its line terminator, container prefix already removed).
 * Returns null when the line is not an opener. Any non-null result commits
 * the parser (§4.1 Commitment), even if `error` is set.
 */
export function parseOpener(line: string): ParsedOpener | null {
  const m = OPENER_START.exec(line);
  const token = m?.[1];
  if (m === null || token === undefined) return null;
  const attributes = new Map<string, string>();
  let i = m[0].length;

  while (i < line.length) {
    const ws = /^[ \t]+/.exec(line.slice(i));
    if (!ws) return { token, attributes, error: 'malformed-opener' };
    i += ws[0].length;
    if (i >= line.length) break;
    const am = ATTRIBUTE.exec(line.slice(i));
    const rawName = am?.[1];
    if (am === null || rawName === undefined) return { token, attributes, error: 'malformed-opener' };
    const name = rawName.toLowerCase();
    if (attributes.has(name)) return { token, attributes, error: 'duplicate-attribute' };
    attributes.set(name, am[2] ?? am[3] ?? '');
    i += am[0].length;
  }

  if (!attributes.has('type')) return { token, attributes, error: 'missing-type' };
  return { token, attributes };
}

export function parseEncoding(attrs: ReadonlyMap<string, string>): string[] {
  const raw = attrs.get('encoding');
  if (raw === undefined) return ['utf-8'];
  return raw
    .split(/[ \t]+/)
    .filter((s) => s.length > 0)
    .map((s) => s.toLowerCase());
}

export function isCloser(content: string, token: string): boolean {
  return content.replace(/[ \t]+$/, '') === token;
}
