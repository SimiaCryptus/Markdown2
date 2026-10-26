import { escapeHtml } from './html.js';

/**
 * Safe prose renderer: a DOM-free subset of CommonMark (spec-issues #17).
 *
 * Blocks: ATX/setext headings, thematic breaks, fenced and indented code,
 * block quotes (with lazy continuation), bullet and ordered lists.
 * Inlines: emphasis/strong (CommonMark delimiter algorithm), code spans,
 * backslash escapes, entities, inline links, autolinks, images, hard breaks.
 *
 * Security properties:
 * - Raw HTML is never passed through; everything is escaped.
 * - Links are limited to http:, https:, mailto: and relative references.
 * - Prose images are rendered as links and are never fetched: rendering a
 *   document never grants network access (§5.5, §11).
 * - Nesting, delimiter counts and link-tail scans are bounded, so hostile
 *   input cannot trigger deep recursion or quadratic work.
 *
 * Not supported (rendered as text): reference links, HTML blocks, GFM tables.
 */

export interface MarkdownOptions {
  /** Render a fenced code block. Defaults to escaped `<pre><code>`. */
  fence?: (info: string, body: string) => Promise<string>;
}

const MAX_NESTING = 32;
const MAX_DELIMITERS = 2000;
const MAX_LINK_PARENS = 32;
const SCAN_LIMIT = 4096;
const REL = 'noopener noreferrer nofollow';

type Block =
  | { t: 'p'; text: string }
  | { t: 'h'; level: number; text: string }
  | { t: 'hr' }
  | { t: 'code'; info: string; body: string; fenced: boolean }
  | { t: 'quote'; children: Block[] }
  | { t: 'list'; ordered: boolean; start: number; tight: boolean; items: Block[][] };

const BLANK = /^[ \t]*$/;
const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const CLOSING_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const ATX = /^ {0,3}(#{1,6})(?=[ \t]|$)(.*)$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const ITEM = /^( {0,3})([-+*]|\d{1,9}[.)])(?:( +)(.*))?$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;

/** Expand tabs in leading whitespace to 4-column tab stops. */
function expandTabs(line: string): string {
  const lead = /^[ \t]*/.exec(line)?.[0] ?? '';
  if (!lead.includes('\t')) return line;
  let out = '';
  for (const ch of lead) out += ch === '\t' ? ' '.repeat(4 - (out.length % 4)) : ' ';
  return out + line.slice(lead.length);
}

function leadingSpaces(line: string): number {
  return /^ */.exec(line)?.[0].length ?? 0;
}

function stripSpaces(line: string, n: number): string {
  return line.slice(Math.min(n, leadingSpaces(line)));
}

interface FenceStart {
  indent: number;
  run: string;
  info: string;
}

function fenceStart(line: string): FenceStart | null {
  const m = FENCE_OPEN.exec(line);
  if (!m) return null;
  const run = m[2] ?? '';
  const info = (m[3] ?? '').trim();
  if (run.startsWith('`') && info.includes('`')) return null;
  return { indent: (m[1] ?? '').length, run, info };
}

function isFenceClose(line: string, run: string): boolean {
  const close = CLOSING_FENCE.exec(line)?.[1];
  return close !== undefined && close.startsWith(run.charAt(0)) && close.length >= run.length;
}

interface ItemStart {
  ordered: boolean;
  /** Bullet character, or the delimiter (`.` / `)`) of an ordered item. */
  bullet: string;
  start: number;
  col: number;
  content: string;
}

function itemStart(line: string): ItemStart | null {
  const m = ITEM.exec(line);
  if (!m) return null;
  const indent = (m[1] ?? '').length;
  const marker = m[2] ?? '';
  let pad = (m[3] ?? '').length;
  let content = m[4] ?? '';
  if (content === '') pad = 1;
  else if (pad > 4) {
    // Content starts with indented code: only one space belongs to the marker.
    content = ' '.repeat(pad - 1) + content;
    pad = 1;
  }
  const ordered = /\d/.test(marker.charAt(0));
  return {
    ordered,
    bullet: ordered ? marker.slice(-1) : marker,
    start: ordered ? Number.parseInt(marker, 10) : 1,
    col: indent + marker.length + pad,
    content,
  };
}

function interruptsParagraph(line: string): boolean {
  if (fenceStart(line) !== null || ATX.test(line) || HR.test(line) || QUOTE.test(line)) return true;
  const it = itemStart(line);
  return it !== null && it.content.trim() !== '' && (!it.ordered || it.start === 1);
}

function nested(lines: readonly string[], depth: number): Block[] {
  if (depth >= MAX_NESTING) return [{ t: 'p', text: lines.join('\n').trim() }];
  return parseBlocks(lines, depth + 1);
}

/** Does an item contain a blank line between two of its direct child blocks? */
function hasLooseGap(item: readonly string[]): boolean {
  let fence: string | null = null;
  let sawBlank = false;
  let sawContent = false;
  for (const l of item) {
    if (fence !== null) {
      if (isFenceClose(l, fence)) fence = null;
      continue;
    }
    if (BLANK.test(l)) {
      if (sawContent) sawBlank = true;
      continue;
    }
    if (sawBlank && leadingSpaces(l) === 0) return true;
    sawBlank = false;
    sawContent = true;
    const f = fenceStart(l);
    if (f) fence = f.run;
  }
  return false;
}

function parseList(
  lines: readonly string[],
  start: number,
  first: ItemStart,
  depth: number,
): { block: Block; next: number } {
  const items: string[][] = [];
  let cur: string[] = [first.content];
  let col = first.col;
  let blank = false;
  let loose = false;
  let i = start + 1;
  while (i < lines.length) {
    const l = lines[i] ?? '';
    if (BLANK.test(l)) {
      cur.push('');
      blank = true;
      i++;
      continue;
    }
    if (leadingSpaces(l) >= col) {
      cur.push(l.slice(col));
      blank = false;
      i++;
      continue;
    }
    const it = HR.test(l) ? null : itemStart(l);
    if (it?.ordered === first.ordered && it.bullet === first.bullet) {
      if (blank) loose = true;
      items.push(cur);
      cur = [it.content];
      col = it.col;
      blank = false;
      i++;
      continue;
    }
    const prev = cur.at(-1);
    if (!blank && prev !== undefined && !BLANK.test(prev) && !interruptsParagraph(l)) {
      cur.push(l); // lazy paragraph continuation
      i++;
      continue;
    }
    break;
  }
  items.push(cur);
  const trimmed = items.map((it) => {
    const c = [...it];
    while (c.length > 0 && BLANK.test(c.at(-1) ?? '')) c.pop();
    return c;
  });
  const tight = !loose && !trimmed.some(hasLooseGap);
  return {
    block: {
      t: 'list',
      ordered: first.ordered,
      start: first.start,
      tight,
      items: trimmed.map((it) => nested(it, depth)),
    },
    next: i,
  };
}

function parseBlocks(lines: readonly string[], depth: number): Block[] {
  const out: Block[] = [];
  const line = (k: number): string => lines[k] ?? '';
  let i = 0;
  while (i < lines.length) {
    const l = line(i);
    if (BLANK.test(l)) {
      i++;
      continue;
    }

    const fence = fenceStart(l);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !isFenceClose(line(i), fence.run)) {
        body.push(stripSpaces(line(i), fence.indent));
        i++;
      }
      i++; // closing fence, or past the end
      out.push({ t: 'code', info: fence.info, body: body.join('\n'), fenced: true });
      continue;
    }

    if (leadingSpaces(l) >= 4) {
      const body: string[] = [];
      while (i < lines.length && (leadingSpaces(line(i)) >= 4 || BLANK.test(line(i)))) {
        body.push(stripSpaces(line(i), 4));
        i++;
      }
      while (body.length > 0 && BLANK.test(body.at(-1) ?? '')) body.pop();
      out.push({ t: 'code', info: '', body: body.join('\n'), fenced: false });
      continue;
    }

    const atx = ATX.exec(l);
    if (atx) {
      const text = (atx[2] ?? '').replace(/(?:^|[ \t]+)#+[ \t]*$/, '').trim();
      out.push({ t: 'h', level: (atx[1] ?? '#').length, text });
      i++;
      continue;
    }

    if (HR.test(l)) {
      out.push({ t: 'hr' });
      i++;
      continue;
    }

    if (QUOTE.test(l)) {
      const inner: string[] = [];
      while (i < lines.length) {
        const q = line(i);
        if (QUOTE.test(q)) {
          inner.push(q.replace(QUOTE, ''));
          i++;
          continue;
        }
        const prev = inner.at(-1);
        if (prev !== undefined && !BLANK.test(prev) && !BLANK.test(q) && !interruptsParagraph(q)) {
          inner.push(q); // lazy continuation
          i++;
          continue;
        }
        break;
      }
      out.push({ t: 'quote', children: nested(inner, depth) });
      continue;
    }

    const first = itemStart(l);
    if (first) {
      const r = parseList(lines, i, first, depth);
      out.push(r.block);
      i = r.next;
      continue;
    }

    const para: string[] = [l.replace(/^[ \t]+/, '')];
    let heading: number | null = null;
    i++;
    while (i < lines.length) {
      const n = line(i);
      if (BLANK.test(n)) break;
      const st = SETEXT.exec(n);
      if (st) {
        heading = (st[1] ?? '=').startsWith('=') ? 1 : 2;
        i++;
        break;
      }
      if (interruptsParagraph(n)) break;
      para.push(n.replace(/^[ \t]+/, ''));
      i++;
    }
    const text = para.join('\n').replace(/[ \t]+$/, '');
    out.push(heading === null ? { t: 'p', text } : { t: 'h', level: heading, text });
  }
  return out;
}

// ------------------------------------------------------------------ inlines

interface DelimTok {
  k: 'delim';
  ch: '*' | '_';
  n: number;
  orig: number;
  open: boolean;
  close: boolean;
}
type Tok = { k: 'text'; s: string } | { k: 'html'; s: string } | DelimTok;

const ESCAPABLE = /[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/;
const UNESCAPE = /\\([\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e])/g;
const SPECIAL = /[\\`<&!\x5b*_\n]/g;
const AUTOLINK = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/y;
const EMAIL =
  /<([A-Za-z0-9.!#$%&'*+\x2f=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/y;
const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/y;
const WS = /\s/;
const PUNCT = /[\p{P}\p{S}]/u;

const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', '\u00a0'],
  ['copy', '©'],
  ['reg', '®'],
  ['hellip', '…'],
  ['mdash', '—'],
  ['ndash', '–'],
]);

const SAFE_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'mailto']);

/**
 * Link target filter. Returns null for anything that could run script or
 * reach a non-web scheme. Relative references and fragments are allowed.
 */
export function safeHref(url: string): string | null {
  const u = url.trim();
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(u)) return null;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(u)?.[1];
  if (scheme !== undefined && !SAFE_SCHEMES.has(scheme.toLowerCase())) return null;
  return u.replace(/ /g, '%20');
}

function unescapeMd(s: string): string {
  return s.replace(UNESCAPE, '$1');
}

function runLength(src: string, i: number, ch: string): number {
  let k = i;
  while (src.charAt(k) === ch) k++;
  return k - i;
}

function classify(c: string): 'ws' | 'punct' | 'other' {
  if (c === '' || WS.test(c)) return 'ws';
  return PUNCT.test(c) ? 'punct' : 'other';
}

function decodeEntity(m: RegExpExecArray): string | null {
  const [, dec, hex, name] = m;
  if (name !== undefined) return NAMED_ENTITIES.get(name) ?? null;
  const cp = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex ?? '', 16);
  if (cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '\ufffd';
  return String.fromCodePoint(cp);
}

/** Index of maximal backtick runs; lookups must use increasing `from`. */
function backtickIndex(src: string): (len: number, from: number) => number {
  const groups = new Map<number, number[]>();
  for (let k = 0; k < src.length;) {
    if (src.charAt(k) !== '`') {
      k++;
      continue;
    }
    const n = runLength(src, k, '`');
    const g = groups.get(n);
    if (g) g.push(k);
    else groups.set(n, [k]);
    k += n;
  }
  const ptr = new Map<number, number>();
  return (len, from) => {
    const g = groups.get(len);
    if (!g) return -1;
    let p = ptr.get(len) ?? 0;
    while (p < g.length && (g[p] ?? Infinity) < from) p++;
    ptr.set(len, p);
    return g[p] ?? -1;
  };
}

function matchBrackets(src: string): Map<number, number> {
  const out = new Map<number, number>();
  const stack: number[] = [];
  for (let k = 0; k < src.length; k++) {
    const c = src.charAt(k);
    if (c === '\\') {
      k++;
      continue;
    }
    if (c === '[') stack.push(k);
    else if (c === ']') {
      const o = stack.pop();
      if (o !== undefined) out.set(o, k);
    }
  }
  return out;
}

function skipWs(src: string, from: number): number {
  let q = from;
  while (q < src.length && ' \t\n'.includes(src.charAt(q))) q++;
  return q;
}

interface LinkTail {
  dest: string;
  title: string | undefined;
  end: number;
}

/** Parse `(dest "title")` starting at the `(` at position `p`. */
function parseLinkTail(src: string, p: number): LinkTail | null {
  let q = skipWs(src, p + 1);
  let dest: string;
  if (src.charAt(q) === '<') {
    const limit = Math.min(src.length, q + 1 + SCAN_LIMIT);
    let e = q + 1;
    while (e < limit && src.charAt(e) !== '>') {
      const ch = src.charAt(e);
      if (ch === '\n' || ch === '<') return null;
      e += ch === '\\' ? 2 : 1;
    }
    if (e >= limit) return null;
    dest = src.slice(q + 1, e);
    q = e + 1;
  } else {
    const st = q;
    let depth = 0;
    while (q < src.length) {
      const c = src.charAt(q);
      if (c === '\\' && q + 1 < src.length) {
        q += 2;
        continue;
      }
      if (WS.test(c)) break;
      if (c === '(') {
        depth++;
        if (depth > MAX_LINK_PARENS) return null;
      } else if (c === ')') {
        if (depth === 0) break;
        depth--;
      }
      q++;
    }
    if (depth !== 0) return null;
    dest = src.slice(st, q);
  }
  const afterDest = q;
  q = skipWs(src, q);
  let title: string | undefined;
  const t = src.charAt(q);
  if (q > afterDest && (t === '"' || t === "'" || t === '(')) {
    const closeCh = t === '(' ? ')' : t;
    const limit = Math.min(src.length, q + 1 + SCAN_LIMIT);
    let e = q + 1;
    while (e < limit && src.charAt(e) !== closeCh) e += src.charAt(e) === '\\' ? 2 : 1;
    if (e >= limit) return null;
    title = unescapeMd(src.slice(q + 1, e));
    q = skipWs(src, e + 1);
  }
  if (src.charAt(q) !== ')') return null;
  return { dest: unescapeMd(dest), title, end: q + 1 };
}

function titleAttr(title: string | undefined): string {
  return title === undefined ? '' : ` title="${escapeHtml(title)}"`;
}

function linkHtml(inner: string, tail: LinkTail, depth: number): string {
  const text = renderInline(inner, depth + 1, false);
  const href = safeHref(tail.dest);
  if (href === null) return text;
  return `<a href="${escapeHtml(href)}"${titleAttr(tail.title)} rel="${REL}">${text}</a>`;
}

/** Prose images are never fetched: they render as a link to the target. */
function imageHtml(inner: string, tail: LinkTail, depth: number): string {
  const alt = renderInline(inner, depth + 1, false).replace(/<[^>]*>/g, '');
  const label = alt === '' ? escapeHtml(tail.dest) : alt;
  const href = safeHref(tail.dest);
  if (href === null) return `<span class="m2-prose-image">${label}</span>`;
  return `<a class="m2-prose-image" href="${escapeHtml(href)}"${titleAttr(tail.title)} rel="${REL}">${label}</a>`;
}

/** CommonMark "process emphasis" over the token list. */
function processEmphasis(toks: Tok[]): void {
  let c = 0;
  while (c < toks.length) {
    const closer = toks[c];
    if (closer?.k !== 'delim' || !closer.close || closer.n === 0) {
      c++;
      continue;
    }
    let o = c - 1;
    let opener: DelimTok | undefined;
    for (; o >= 0; o--) {
      const t = toks[o];
      if (t?.k !== 'delim' || t.ch !== closer.ch || !t.open || t.n === 0) continue;
      if (
        (t.close || closer.open) &&
        (t.orig + closer.orig) % 3 === 0 &&
        !(t.orig % 3 === 0 && closer.orig % 3 === 0)
      ) {
        continue;
      }
      opener = t;
      break;
    }
    if (!opener) {
      c++;
      continue;
    }
    const use = opener.n >= 2 && closer.n >= 2 ? 2 : 1;
    opener.n -= use;
    closer.n -= use;
    const tag = use === 2 ? 'strong' : 'em';
    for (let k = o + 1; k < c; k++) {
      const t = toks[k];
      if (t?.k === 'delim') toks[k] = { k: 'text', s: t.ch.repeat(t.n) };
    }
    toks.splice(c, 0, { k: 'html', s: `</${tag}>` });
    toks.splice(o + 1, 0, { k: 'html', s: `<${tag}>` });
    c += 2;
    if (opener.n === 0) {
      toks.splice(o, 1);
      c--;
    }
    if (closer.n === 0) toks.splice(c, 1);
  }
}

function renderInline(src: string, depth: number, allowLinks: boolean): string {
  const toks: Tok[] = [];
  let buf = '';
  const flush = (): void => {
    if (buf !== '') {
      toks.push({ k: 'text', s: buf });
      buf = '';
    }
  };
  const emit = (s: string): void => {
    flush();
    toks.push({ k: 'html', s });
  };
  const closingTicks = backtickIndex(src);
  const brackets = depth < MAX_NESTING ? matchBrackets(src) : new Map<number, number>();
  let delims = 0;
  let i = 0;

  while (i < src.length) {
    const c = src.charAt(i);

    if (c === '\\') {
      const n = src.charAt(i + 1);
      if (n === '\n') {
        buf = buf.replace(/ +$/, '');
        emit('<br>\n');
        i += 2;
        continue;
      }
      if (n !== '' && ESCAPABLE.test(n)) {
        buf += n;
        i += 2;
        continue;
      }
      buf += c;
      i++;
      continue;
    }

    if (c === '`') {
      const run = runLength(src, i, '`');
      const close = closingTicks(run, i + run);
      if (close !== -1) {
        let code = src.slice(i + run, close).replace(/\n/g, ' ');
        if (code.length >= 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') {
          code = code.slice(1, -1);
        }
        emit(`<code>${escapeHtml(code)}</code>`);
        i = close + run;
        continue;
      }
      buf += '`'.repeat(run);
      i += run;
      continue;
    }

    if (c === '<') {
      AUTOLINK.lastIndex = i;
      const m = AUTOLINK.exec(src);
      if (m) {
        const url = m[1] ?? '';
        const href = safeHref(url);
        if (href === null) buf += m[0];
        else emit(`<a href="${escapeHtml(href)}" rel="${REL}">${escapeHtml(url)}</a>`);
        i += m[0].length;
        continue;
      }
      EMAIL.lastIndex = i;
      const e = EMAIL.exec(src);
      if (e) {
        const addr = e[1] ?? '';
        emit(`<a href="mailto:${escapeHtml(addr)}" rel="${REL}">${escapeHtml(addr)}</a>`);
        i += e[0].length;
        continue;
      }
      buf += c;
      i++;
      continue;
    }

    if (c === '&') {
      ENTITY.lastIndex = i;
      const m = ENTITY.exec(src);
      const ch = m ? decodeEntity(m) : null;
      if (m && ch !== null) {
        buf += ch;
        i += m[0].length;
        continue;
      }
      buf += c;
      i++;
      continue;
    }

    if (c === '[' || (c === '!' && src.charAt(i + 1) === '[')) {
      const image = c === '!';
      const open = image ? i + 1 : i;
      const close = brackets.get(open);
      if ((image || allowLinks) && close !== undefined && src.charAt(close + 1) === '(') {
        const tail = parseLinkTail(src, close + 1);
        if (tail) {
          const inner = src.slice(open + 1, close);
          emit(image ? imageHtml(inner, tail, depth) : linkHtml(inner, tail, depth));
          i = tail.end;
          continue;
        }
      }
      buf += c;
      i++;
      continue;
    }

    if (c === '*' || c === '_') {
      const n = runLength(src, i, c);
      const before = classify(i === 0 ? '' : src.charAt(i - 1));
      const after = classify(src.charAt(i + n));
      const left = after !== 'ws' && (after !== 'punct' || before !== 'other');
      const right = before !== 'ws' && (before !== 'punct' || after !== 'other');
      const ch = c === '*' ? '*' : '_';
      const open = ch === '*' ? left : left && (!right || before === 'punct');
      const close = ch === '*' ? right : right && (!left || after === 'punct');
      flush();
      toks.push({ k: 'delim', ch, n, orig: n, open, close });
      delims++;
      i += n;
      continue;
    }

    if (c === '\n') {
      const hard = / {2,}$/.test(buf);
      buf = buf.replace(/ +$/, '');
      if (hard) emit('<br>\n');
      else buf += '\n';
      i++;
      continue;
    }

    SPECIAL.lastIndex = i + 1;
    const m = SPECIAL.exec(src);
    const end = m ? m.index : src.length;
    buf += src.slice(i, end);
    i = end;
  }
  flush();
  if (delims <= MAX_DELIMITERS) processEmphasis(toks);
  return toks
    .map((t) => (t.k === 'html' ? t.s : t.k === 'text' ? escapeHtml(t.s) : escapeHtml(t.ch.repeat(t.n))))
    .join('');
}

// ------------------------------------------------------------------ render

const defaultFence = (info: string, body: string): Promise<string> => {
  const lang = info.split(/\s+/)[0] ?? '';
  const cls = lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`;
  return Promise.resolve(`<pre><code${cls}>${escapeHtml(body)}</code></pre>`);
};

type FenceFn = (info: string, body: string) => Promise<string>;

async function renderBlock(b: Block, fence: FenceFn, tight: boolean): Promise<string> {
  switch (b.t) {
    case 'p': {
      const html = renderInline(b.text, 0, true);
      return tight ? html : `<p>${html}</p>`;
    }
    case 'h':
      return `<h${b.level}>${renderInline(b.text, 0, true)}</h${b.level}>`;
    case 'hr':
      return '<hr>';
    case 'code':
      return b.fenced ? await fence(b.info, b.body) : `<pre><code>${escapeHtml(b.body)}</code></pre>`;
    case 'quote':
      return `<blockquote>\n${await renderBlocks(b.children, fence, false)}\n</blockquote>`;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      const startAttr = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
      const items: string[] = [];
      for (const it of b.items) items.push(`<li>${await renderBlocks(it, fence, b.tight)}</li>`);
      return `<${tag}${startAttr}>\n${items.join('\n')}\n</${tag}>`;
    }
  }
}

async function renderBlocks(blocks: readonly Block[], fence: FenceFn, tight: boolean): Promise<string> {
  const out: string[] = [];
  for (const b of blocks) out.push(await renderBlock(b, fence, tight));
  return out.join('\n');
}

/** One top-level block. `heading` is set for headings, so sections can be derived (style.md §4.2). */
export interface RenderedBlock {
  html: string;
  heading?: number;
}

/** Render Markdown prose into its top-level blocks. Everything is escaped. */
export async function renderMarkdownBlocks(text: string, opts: MarkdownOptions = {}): Promise<RenderedBlock[]> {
  const lines = text.split(/\r?\n/).map(expandTabs);
  const fence = opts.fence ?? defaultFence;
  const out: RenderedBlock[] = [];
  for (const b of parseBlocks(lines, 0)) {
    const html = await renderBlock(b, fence, false);
    out.push(b.t === 'h' ? { html, heading: b.level } : { html });
  }
  return out;
}

/** Render Markdown prose to an HTML fragment. Everything is escaped. */
export async function renderMarkdown(text: string, opts: MarkdownOptions = {}): Promise<string> {
  return (await renderMarkdownBlocks(text, opts)).map((b) => b.html).join('\n');
}
