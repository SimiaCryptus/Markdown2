import { isCloser, parseEncoding, parseOpener, type ParsedOpener } from './opener.js';
import {
  DEFAULT_LIMITS,
  type Diagnostic,
  type DocNode,
  type Document,
  type ErrorCode,
  type Limits,
  type ResourceNode,
} from './types.js';

interface Line {
  text: string;
  eol: string;
}

interface Prefix {
  quotes: number;
  indent: number;
}

export interface ParseOptions {
  idPrefix?: string;
  limits?: Partial<Limits>;
  /** Shared counter so nested documents count towards one resource limit. */
  counter?: { resources: number };
}

const encoder = new TextEncoder();

/** Bounds-checked index; callers only use indices they have already range-checked. */
function at<T>(arr: readonly T[], k: number): T {
  const v = arr[k];
  if (v === undefined) throw new RangeError(`line index ${k} out of range`);
  return v;
}

function splitLines(src: string): Line[] {
  const out: Line[] = [];
  const re = /\r\n|\n/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out.push({ text: src.slice(last, m.index), eol: m[0] });
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last), eol: '' });
  return out;
}

/** Remove up to `n` block quote markers. Returns [count, rest]. */
function stripQuotes(text: string, max: number): [number, string] {
  let rest = text;
  let n = 0;
  while (n < max) {
    const m = /^ {0,3}> ?/.exec(rest);
    if (!m) break;
    rest = rest.slice(m[0].length);
    n++;
  }
  return [n, rest];
}

/**
 * Strip the container prefix (§4.1 Placement). Returns null if the line
 * does not carry the full prefix, which ends the container.
 */
function stripPrefix(text: string, p: Prefix): string | null {
  const [q, rest] = stripQuotes(text, p.quotes);
  if (q < p.quotes) return null;
  if (p.indent === 0) return rest;
  if (rest.startsWith(' '.repeat(p.indent))) return rest.slice(p.indent);
  if (/^[ \t]*$/.test(rest)) return ''; // empty line or bare `>` exception
  return null;
}

function joinPayload(lines: Line[]): Uint8Array {
  const s = lines.map((l, k) => (k < lines.length - 1 ? l.text + l.eol : l.text)).join('');
  return encoder.encode(s);
}

const LIST_MARKER = /^( {0,3})([-+*]|\d{1,9}[.)])( {1,4})/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

export function parse(src: string, opts: ParseOptions = {}): Document {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const counter = opts.counter ?? { resources: 0 };
  const idPrefix = opts.idPrefix ?? '';
  const lines = splitLines(src.startsWith('\uFEFF') ? src.slice(1) : src);
  const children: DocNode[] = [];
  const diagnostics: Diagnostic[] = [];
  let prose: Line[] = [];
  let proseStart = 0;

  const flushProse = () => {
    if (prose.length > 0) {
      children.push({ kind: 'prose', text: prose.map((l) => l.text + l.eol).join(''), startLine: proseStart });
      prose = [];
    }
  };
  const addProse = (i: number) => {
    if (prose.length === 0) proseStart = i;
    prose.push(at(lines, i));
  };
  const nextId = () => `${idPrefix}${children.length}`;

  const pushResource = (n: Omit<ResourceNode, 'kind' | 'id'>) => {
    flushProse();
    counter.resources++;
    const node: ResourceNode = { kind: 'resource', id: nextId(), ...n };
    if (counter.resources > limits.maxResources && !node.structuralError) {
      node.structuralError = 'limit-exceeded';
    }
    if (node.structuralError) {
      diagnostics.push({
        code: node.structuralError,
        message: `Resource ${node.token ?? '(frontmatter)'}: ${node.structuralError}`,
        line: node.startLine,
        nodeId: node.id,
      });
    }
    children.push(node);
  };

  let i = 0;

  // §4.2 Frontmatter shorthand at byte offset 0.
  if (lines[0]?.text === '---') {
    const close = lines.findIndex((l, k) => k > 0 && (l.text === '---' || l.text === '...'));
    const terminated = close !== -1;
    const end = terminated ? close : lines.length;
    const body = lines.slice(1, end);
    const node: Omit<ResourceNode, 'kind' | 'id'> = {
      rel: 'metadata',
      resource: {
        type: 'application/yaml',
        encoding: ['utf-8'],
        payload: joinPayload(body),
        attributes: new Map([
          ['type', 'application/yaml'],
          ['rel', 'metadata'],
        ]),
      },
      token: null,
      syntax: 'frontmatter',
      startLine: 0,
      endLine: terminated ? end : lines.length - 1,
    };
    if (!terminated) node.structuralError = 'unterminated-frontmatter';
    pushResource(node);
    i = terminated ? end + 1 : lines.length;
  }

  const listCols: number[] = [];
  let fence: { char: string; len: number; prefix: Prefix } | null = null;
  let inHtmlComment = false;

  /** Scan a resource whose opener is at line `start`. Returns index after the block. */
  const scanResource = (start: number, op: ParsedOpener, prefix: Prefix, syntax: 'block' | 'wrapped'): number => {
    const body: Line[] = [];
    let j = start + 1;
    let closed = false;
    for (; j < lines.length; j++) {
      const line = at(lines, j);
      const stripped = stripPrefix(line.text, prefix);
      if (stripped === null) break; // container ended → unterminated
      if (isCloser(stripped, op.token)) {
        closed = true;
        break;
      }
      body.push({ text: stripped, eol: line.eol });
    }
    let error: ErrorCode | undefined = op.error;
    if (!closed) error = 'unterminated-resource';
    if (!error) {
      const enc = parseEncoding(op.attributes);
      if (enc.indexOf('uri') > 0) error = 'uri-not-first';
    }
    const node: Omit<ResourceNode, 'kind' | 'id'> = {
      rel: op.attributes.get('rel') ?? 'inline',
      resource: {
        type: op.attributes.get('type'),
        encoding: parseEncoding(op.attributes),
        payload: joinPayload(body),
        attributes: op.attributes,
      },
      token: op.token,
      syntax,
      startLine: start,
      endLine: closed ? j : j - 1,
    };
    if (error) node.structuralError = error;
    pushResource(node);
    return closed ? j + 1 : j;
  };

  while (i < lines.length) {
    const raw = at(lines, i).text;

    if (fence) {
      const s = stripPrefix(raw, fence.prefix);
      const run = s === null ? undefined : CLOSING_FENCE.exec(s)?.[1];
      if (s === null || (run?.startsWith(fence.char) && run.length >= fence.len)) fence = null;
      addProse(i++);
      continue;
    }
    if (inHtmlComment) {
      if (raw.includes('-->')) inHtmlComment = false;
      addProse(i++);
      continue;
    }

    const [quotes, afterQuotes] = stripQuotes(raw, Infinity);
    if (/^[ \t]*$/.test(afterQuotes)) {
      addProse(i++);
      continue;
    }
    // Not blank, so a non-space character exists.
    const indent = afterQuotes.search(/[^ ]/);
    while ((listCols.at(-1) ?? -1) > indent) listCols.pop();

    let contentCol = indent;
    let content = afterQuotes.slice(indent);
    const lm = LIST_MARKER.exec(afterQuotes);
    if (lm && indent === (listCols.at(-1) ?? 0)) {
      contentCol = lm[0].length;
      listCols.push(contentCol);
      content = afterQuotes.slice(contentCol);
    } else if (indent !== 0 && indent !== listCols.at(-1)) {
      addProse(i++); // indented code or continuation text: not a block position
      continue;
    }
    const prefix: Prefix = { quotes, indent: contentCol };

    const openRun = FENCE.exec(content)?.[1];
    if (openRun !== undefined) {
      fence = { char: openRun.charAt(0), len: openRun.length, prefix };
      addProse(i++);
      continue;
    }

    // §7.1 compatibility wrapper.
    if (content === '<!--') {
      const next = lines[i + 1];
      const nextContent = next ? stripPrefix(next.text, prefix) : null;
      const op = nextContent === null ? null : parseOpener(nextContent);
      if (op) {
        let after = scanResource(i + 1, op, prefix, 'wrapped');
        const closeLine = lines[after];
        if (closeLine && stripPrefix(closeLine.text, prefix) === '-->') after++;
        else
          diagnostics.push({ code: 'wrapper-unclosed', message: 'Expected "-->" after wrapped resource', line: after });
        i = after;
        continue;
      }
    }
    if (content.startsWith('<!--')) {
      if (!content.includes('-->', 4)) inHtmlComment = true;
      addProse(i++);
      continue;
    }

    const op = parseOpener(content);
    if (op) {
      i = scanResource(i, op, prefix, 'block');
      continue;
    }
    addProse(i++);
  }
  flushProse();
  return { children, diagnostics };
}
