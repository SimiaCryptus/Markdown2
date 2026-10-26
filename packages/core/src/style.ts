import { LimitExceeded, type ByteQuota } from './decoders.js';
import { effectiveRel } from './rel.js';
import { typeEssence, type ResolvedNode, type ResolvedResource } from './runtime.js';
import type { DecodeState, Diagnostic, DiagnosticCode } from './types.js';

/**
 * Markdown2 Style Sheets (style.md).
 *
 * - Document stylesheets are `rel="stylesheet"` resources of type `text/css`.
 * - Each applied sheet is sanitised (§8.1), scoped to its own `md2-document` (§5.3)
 *   and placed in the author layer.
 * - The three CSS origins are mapped onto cascade layers
 *   `m2-ua < m2-user < m2-author` (§6.1). For normal declarations later layers
 *   win; for `!important` earlier layers win, exactly as for CSS origins.
 */

/** Appendix A baseline, plus containment of the top-level document (§8.2). */
export const UA_STYLESHEET = `md2-document,
md2-section,
md2-resource,
md2-view,
md2-fallback { display: block; }

md2-resource[rel="metadata"],
md2-resource[rel="stylesheet"] { display: none; }

md2-fallback {
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
  border: 1px solid;
  padding: 0.5em 0.75em;
}

md2-label  { display: inline; font-weight: bold; }
md2-detail { display: block; font-size: 0.875em; }

md2-document[data-m2-root] {
  display: block !important;
  position: relative !important;
  contain: layout paint !important;
  overflow: clip !important;
}`;

export interface DocStylesheet {
  /** Node id of the stylesheet resource. */
  id: string;
  /** Node id of the nested resource whose document this sheet belongs to; `''` for the top level. */
  scope: string;
  /** Title of the nested resource, for grouping in reader controls (§5.3). */
  scopeLabel?: string;
  title?: string;
  group?: string;
  defaultOn?: boolean;
  media?: string;
  state: DecodeState;
  /** Decoded CSS, or null when the sheet cannot be applied (not decoded, wrong type, bad media). */
  css: string | null;
}

export interface StyleGroup {
  key: string;
  scope: string;
  scopeLabel?: string;
  name: string;
  /** A group of one is a toggle, a group of many is a choice (§5.2). */
  kind: 'toggle' | 'alternatives';
  members: DocStylesheet[];
}

export interface StyleModel {
  sheets: DocStylesheet[];
  groups: StyleGroup[];
  diagnostics: Diagnostic[];
}

/** Group key → selected member id (alternatives) or on/off (toggle). */
export type StyleSelection = Map<string, string | boolean>;

/** Remembered reader preferences, matched by exact group name and title (§6.2). */
export interface StylePreferences {
  choices: ReadonlyMap<string, string>;
  toggles: ReadonlyMap<string, boolean>;
}

const MEDIA = /^[A-Za-z0-9\s(),:./<>=-]+$/;

function nodeLabel(e: ResolvedResource): string {
  const a = e.node.resource.attributes;
  return a.get('title') ?? a.get('filename') ?? e.node.id;
}

function toSheet(
  e: ResolvedResource,
  scope: string,
  scopeLabel: string | undefined,
  diagnostics: Diagnostic[],
): DocStylesheet {
  const { node, result } = e;
  const a = node.resource.attributes;
  const report = (code: DiagnosticCode, message: string): void => {
    diagnostics.push({ code, message, line: node.startLine, nodeId: node.id });
  };

  let css: string | null = null;
  if (typeEssence(node.resource.type) !== 'text/css') {
    report('stylesheet-not-css', `Stylesheet has type ${node.resource.type ?? '(none)'}, not text/css; not applied`);
  } else if (result.state === 'decoded' && result.bytes !== undefined) {
    try {
      css = new TextDecoder('utf-8', { fatal: true }).decode(result.bytes);
    } catch {
      report('invalid-utf-8', 'Stylesheet is not valid UTF-8; not applied');
    }
  }

  let defaultOn: boolean | undefined;
  const def = a.get('md2-default');
  if (def === 'on') defaultOn = true;
  else if (def === 'off') defaultOn = false;
  else if (def !== undefined) report('stylesheet-bad-default', `md2-default="${def}" ignored; use "on" or "off"`);

  const media = a.get('md2-media');
  if (media !== undefined && !MEDIA.test(media)) {
    report('stylesheet-bad-media', 'md2-media is not a plain media query list; stylesheet not applied');
    css = null;
  }

  const group = a.get('md2-group');
  const title = a.get('title');
  if (group !== undefined && title === undefined) {
    report('stylesheet-missing-title', `Member of group "${group}" has no title`);
  }

  return {
    id: node.id,
    scope,
    state: result.state,
    css,
    ...(scopeLabel !== undefined ? { scopeLabel } : {}),
    ...(title !== undefined ? { title } : {}),
    ...(group !== undefined ? { group } : {}),
    ...(defaultOn !== undefined ? { defaultOn } : {}),
    ...(media !== undefined ? { media } : {}),
  };
}

/** Collect every document stylesheet in pre-order (§5.4) and derive groups (§5.2). */
export function collectStyles(nodes: readonly ResolvedNode[]): StyleModel {
  const sheets: DocStylesheet[] = [];
  const diagnostics: Diagnostic[] = [];
  const walk = (level: readonly ResolvedNode[], scope: string, scopeLabel: string | undefined): void => {
    for (const n of level) {
      if (n.kind !== 'resource') continue;
      if (effectiveRel(n.node.rel) === 'stylesheet') sheets.push(toSheet(n, scope, scopeLabel, diagnostics));
      if (n.children) walk(n.children, n.node.id, nodeLabel(n));
    }
  };
  walk(nodes, '', undefined);

  const byKey = new Map<string, StyleGroup>();
  for (const s of sheets) {
    if (s.group === undefined) continue;
    const key = JSON.stringify([s.scope, s.group]);
    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        scope: s.scope,
        name: s.group,
        kind: 'toggle',
        members: [],
        ...(s.scopeLabel !== undefined ? { scopeLabel: s.scopeLabel } : {}),
      };
      byKey.set(key, g);
    }
    g.members.push(s);
  }
  const groups = [...byKey.values()];
  for (const g of groups) g.kind = g.members.length === 1 ? 'toggle' : 'alternatives';
  return { sheets, groups, diagnostics };
}

/** The document's initial choice for a group (§5.2). */
export function groupDefault(g: StyleGroup): string | boolean {
  if (g.kind === 'toggle') return g.members[0]?.defaultOn !== false;
  return (g.members.find((m) => m.defaultOn === true) ?? g.members[0])?.id ?? '';
}

/**
 * Selection for a model: document defaults, overridden by remembered
 * preferences that match by exact group name and title (§6.2).
 */
export function selectionFor(model: StyleModel, prefs?: StylePreferences): StyleSelection {
  const sel: StyleSelection = new Map();
  for (const g of model.groups) {
    sel.set(g.key, groupDefault(g));
    if (!prefs) continue;
    if (g.kind === 'toggle') {
      const on = prefs.toggles.get(g.name);
      if (on !== undefined) sel.set(g.key, on);
    } else {
      const title = prefs.choices.get(g.name);
      const m = title === undefined ? undefined : g.members.find((x) => x.title === title);
      if (m) sel.set(g.key, m.id);
    }
  }
  return sel;
}

/** Sheets to apply, in document order. Selection never reorders sheets (§5.4). */
export function appliedSheets(model: StyleModel, selection: ReadonlyMap<string, string | boolean>): DocStylesheet[] {
  const groupOf = new Map<string, StyleGroup>();
  for (const g of model.groups) for (const m of g.members) groupOf.set(m.id, g);
  return model.sheets.filter((s) => {
    if (s.css === null) return false;
    const g = groupOf.get(s.id);
    if (g === undefined) return true;
    const sel = selection.get(g.key) ?? groupDefault(g);
    return g.kind === 'toggle' ? sel === true : sel === s.id;
  });
}

/** Scope root of a document: the top-level `md2-document`, or the one inside a nested resource. */
export function scopeSelector(scope: string): string {
  if (scope === '') return 'md2-document[data-m2-root]';
  return `md2-resource[data-m2-id="${scope.replace(/["\\]/g, '\\$&')}"] > md2-document`;
}

// ------------------------------------------------------------------ sanitiser

export interface SanitizeOptions {
  /** Keep non-`data:` URLs (user origin only; §8 permits relaxing for users). */
  allowRemoteUrls?: boolean;
  /** Rewrite `:root` to `:scope` (top-level document stylesheets). */
  rootToScope?: boolean;
  /** `data:` URL bytes are charged here (§8.1). */
  quota?: ByteQuota;
}

export interface SanitizedCss {
  css: string;
  /** What was removed, for diagnostics. */
  removed: string[];
}

/** At-rules that fetch, or that could break out of the scope wrapper. */
const DROPPED_AT_RULES: ReadonlySet<string> = new Set(['import', 'namespace', 'charset', 'scope']);
/** Functions that fetch from strings, reference other elements or run script. */
const BLOCKED_FUNCTIONS: ReadonlySet<string> = new Set([
  'image-set',
  '-webkit-image-set',
  'image',
  'cross-fade',
  '-webkit-cross-fade',
  'src',
  'element',
  '-moz-element',
  'expression',
  'paint',
]);
/** Script-bearing legacy properties (§8.2). */
const BLOCKED_PROPERTIES: ReadonlySet<string> = new Set(['behavior', '-moz-binding']);

const isHex = (c: string): boolean => /^[0-9a-fA-F]$/.test(c);
const isWs = (c: string): boolean => c === ' ' || c === '\t' || c === '\n';
const isNameStart = (c: string): boolean => c !== '' && (/[A-Za-z_]/.test(c) || c.charCodeAt(0) >= 0x80);
const isNameChar = (c: string): boolean => isNameStart(c) || /[0-9-]/.test(c);
const validEscape = (s: string, i: number): boolean =>
  s.charAt(i) === '\\' && i + 1 < s.length && s.charAt(i + 1) !== '\n';
const openFor = (c: string): string => (c === ')' ? '(' : c === ']' ? '[' : '{');
const closeFor = (c: string): string => (c === '(' ? ')' : c === '[' ? ']' : '}');

function startsIdent(s: string, i: number): boolean {
  const c = s.charAt(i);
  if (c === '-') {
    const d = s.charAt(i + 1);
    return isNameStart(d) || d === '-' || validEscape(s, i + 1);
  }
  return isNameStart(c) || validEscape(s, i);
}

/** Decode the escape at `s[i] === '\\'`. Returns the character and the end index. */
function readEscape(s: string, i: number): [string, number] {
  let j = i + 1;
  if (isHex(s.charAt(j))) {
    let hex = '';
    while (hex.length < 6 && isHex(s.charAt(j))) {
      hex += s.charAt(j);
      j++;
    }
    if (isWs(s.charAt(j))) j++;
    const cp = Number.parseInt(hex, 16);
    const bad = cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff);
    return [bad ? '\ufffd' : String.fromCodePoint(cp), j];
  }
  return [s.charAt(j), j + 1];
}

function readName(s: string, i: number): { value: string; end: number } {
  let value = '';
  let j = i;
  for (;;) {
    const c = s.charAt(j);
    if (isNameChar(c)) {
      value += c;
      j++;
    } else if (validEscape(s, j)) {
      const [ch, e] = readEscape(s, j);
      value += ch;
      j = e;
    } else {
      return { value, end: j };
    }
  }
}

/** Read a string; an unescaped newline ends it (and is left in the stream). Output is always closed. */
function readString(s: string, i: number): { raw: string; value: string; end: number } {
  const q = s.charAt(i);
  let j = i + 1;
  let raw = q;
  let value = '';
  while (j < s.length) {
    const c = s.charAt(j);
    if (c === q) {
      j++;
      break;
    }
    if (c === '\n') break;
    if (c === '\\') {
      if (j + 1 >= s.length) {
        j++;
        break;
      }
      if (s.charAt(j + 1) === '\n') {
        j += 2; // line continuation
        continue;
      }
      const [ch, e] = readEscape(s, j);
      raw += s.slice(j, e);
      value += ch;
      j = e;
      continue;
    }
    raw += c;
    value += c;
    j++;
  }
  return { raw: raw + q, value, end: j };
}

function skipComment(s: string, i: number): number {
  const e = s.indexOf('*/', i + 2);
  return e < 0 ? s.length : e + 2;
}

/** Index just past the `)` matching the `(` at `i`. */
function skipParens(s: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < s.length) {
    const c = s.charAt(j);
    if (c === '/' && s.charAt(j + 1) === '*') {
      j = skipComment(s, j);
      continue;
    }
    if (c === '"' || c === "'") {
      j = readString(s, j).end;
      continue;
    }
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return j + 1;
    }
    j++;
  }
  return s.length;
}

/** Skip an at-rule statement: up to `;`, through its block, or up to the enclosing `}`. */
function skipStatement(s: string, i: number): number {
  const stack: string[] = [];
  let j = i;
  while (j < s.length) {
    const c = s.charAt(j);
    if (c === '/' && s.charAt(j + 1) === '*') {
      j = skipComment(s, j);
      continue;
    }
    if (c === '"' || c === "'") {
      j = readString(s, j).end;
      continue;
    }
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === '{' || c === '(' || c === '[') stack.push(c);
    else if (c === '}' || c === ')' || c === ']') {
      if (stack.length === 0) {
        if (c === '}') return j;
      } else if (stack.at(-1) === openFor(c)) {
        stack.pop();
        if (c === '}' && stack.length === 0) return j + 1;
      }
    } else if (c === ';' && stack.length === 0) return j + 1;
    j++;
  }
  return s.length;
}

/** Read the argument of `url(` starting just after the `(`. `value` is null for a bad URL. */
function readUrl(s: string, i: number): { value: string | null; end: number } {
  let j = i;
  while (isWs(s.charAt(j))) j++;
  const first = s.charAt(j);
  if (first === '"' || first === "'") {
    const str = readString(s, j);
    let k = str.end;
    while (isWs(s.charAt(k))) k++;
    if (s.charAt(k) === ')') return { value: str.value, end: k + 1 };
    return { value: null, end: skipParens(s, i - 1) };
  }
  let value = '';
  while (j < s.length) {
    const ch = s.charAt(j);
    if (ch === ')') return { value, end: j + 1 };
    if (isWs(ch)) {
      let k = j;
      while (isWs(s.charAt(k))) k++;
      if (s.charAt(k) === ')') return { value, end: k + 1 };
      break;
    }
    const code = ch.charCodeAt(0);
    const control = code <= 8 || code === 11 || (code >= 14 && code <= 31) || code === 127;
    if (ch === '"' || ch === "'" || ch === '(' || control) break;
    if (ch === '\\') {
      if (!validEscape(s, j)) break;
      const [d, e] = readEscape(s, j);
      value += d;
      j = e;
      continue;
    }
    value += ch;
    j++;
  }
  // Bad URL: consume the remnants up to ")".
  while (j < s.length) {
    if (s.charAt(j) === ')') return { value: null, end: j + 1 };
    j = validEscape(s, j) ? readEscape(s, j)[1] : j + 1;
  }
  return { value: null, end: s.length };
}

function cssString(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ')}"`;
}

/**
 * Sanitise untrusted CSS (§8.1, §8.2).
 *
 * The output is re-serialised from our own tokenisation and is always
 * balanced: stray closers are dropped and open blocks are closed at the end.
 * Wrapping it in `@scope { … }` can therefore never be escaped.
 */
export function sanitizeCss(input: string, opts: SanitizeOptions = {}): SanitizedCss {
  const s = input
    .replace(/\r\n?|\f/g, '\n')
    .split('\0')
    .join('\ufffd');
  const removed: string[] = [];
  const stack: string[] = [];
  const charge = (n: number): boolean => {
    if (!opts.quota) return true;
    try {
      opts.quota.charge(n);
      return true;
    } catch (e) {
      if (e instanceof LimitExceeded) return false;
      throw e;
    }
  };
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s.charAt(i);
    if (c === '/' && s.charAt(i + 1) === '*') {
      i = skipComment(s, i);
      out += ' ';
      continue;
    }
    if (c === '"' || c === "'") {
      const str = readString(s, i);
      out += str.raw;
      i = str.end;
      continue;
    }
    if (c === '{' || c === '(' || c === '[') {
      stack.push(c);
      out += c;
      i++;
      continue;
    }
    if (c === '}' || c === ')' || c === ']') {
      if (stack.at(-1) === openFor(c)) {
        stack.pop();
        out += c;
      } else {
        removed.push(`unbalanced ${c}`);
      }
      i++;
      continue;
    }
    if (c === '@' && startsIdent(s, i + 1)) {
      const name = readName(s, i + 1);
      const lower = name.value.toLowerCase();
      if (DROPPED_AT_RULES.has(lower)) {
        removed.push(`@${lower}`);
        i = skipStatement(s, name.end);
        continue;
      }
      out += s.slice(i, name.end);
      i = name.end;
      continue;
    }
    if (c === '\\' && !validEscape(s, i)) {
      i++; // stray backslash before a newline or the end
      continue;
    }
    if (startsIdent(s, i)) {
      const name = readName(s, i);
      const lower = name.value.toLowerCase();
      const raw = s.slice(i, name.end);
      if (s.charAt(name.end) === '(') {
        if (lower === 'url') {
          const u = readUrl(s, name.end + 1);
          i = u.end;
          const v = u.value?.trim();
          if (v !== undefined && /^data:/i.test(v) && charge(v.length)) out += `url(${cssString(v)})`;
          else if (v !== undefined && !/^data:/i.test(v) && opts.allowRemoteUrls === true)
            out += `url(${cssString(v)})`;
          else {
            removed.push('url()');
            out += 'none';
          }
          continue;
        }
        if (BLOCKED_FUNCTIONS.has(lower)) {
          removed.push(`${lower}()`);
          out += 'none';
          i = skipParens(s, name.end);
          continue;
        }
        out += raw;
        i = name.end;
        continue;
      }
      if (lower === 'root' && opts.rootToScope === true && out.endsWith(':') && !out.endsWith('::')) {
        out += 'scope';
        i = name.end;
        continue;
      }
      if (BLOCKED_PROPERTIES.has(lower) && /^[ \t\n]*:/.test(s.slice(name.end, name.end + 64))) {
        removed.push(lower);
        out += `--m2-blocked-${lower.replace(/^-+/, '')}`; // custom property: inert
        i = name.end;
        continue;
      }
      out += raw;
      i = name.end;
      continue;
    }
    out += c;
    i++;
  }
  for (let k = stack.length - 1; k >= 0; k--) out += closeFor(stack[k] ?? '{');
  return { css: out, removed };
}

/** Sanitise, scope (§5.3) and media-wrap one sheet. */
export function scopedCss(css: string, scope: string, media?: string, quota?: ByteQuota): string {
  const body = sanitizeCss(css, { rootToScope: scope === '', ...(quota ? { quota } : {}) }).css;
  const scoped = `@scope (${scopeSelector(scope)}) {\n${body}\n}`;
  return media === undefined || !MEDIA.test(media) ? scoped : `@media ${media} {\n${scoped}\n}`;
}

export interface CascadeOptions {
  /** Applied document stylesheets, in document order. Empty when document styles are disabled. */
  author?: readonly DocStylesheet[];
  /** Global user stylesheets, in user-chosen order (§6.2). */
  user?: readonly string[];
  /** Remaining decoded-size quota for `data:` URLs in author sheets. */
  quota?: ByteQuota;
}

/** Full cascade: UA, user and author origins as ordered layers (§6.1). */
export function composeCascade(o: CascadeOptions = {}): string {
  const author = (o.author ?? []).map((s) => scopedCss(s.css ?? '', s.scope, s.media, o.quota));
  const user = (o.user ?? []).map((css) => scopedCss(css, ''));
  return [
    '@layer m2-ua, m2-user, m2-author;',
    `@layer m2-ua {\n${UA_STYLESHEET}\n}`,
    `@layer m2-user {\n${user.join('\n')}\n}`,
    `@layer m2-author {\n${author.join('\n')}\n}`,
  ].join('\n');
}
