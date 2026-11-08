import {
  analyseRels,
  ByteQuota,
  defaultFenceHtml,
  effectiveRel,
  escapeHtml,
  fallbackFor,
  fallbackHtml,
  fenceAliasType,
  LimitExceeded,
  parse,
  relToken,
  renderMarkdownBlocksSync,
  safeSaveName,
  staticState,
  typeEssence,
  type DecodeState,
  type DecoderRegistry,
  type Diagnostic,
  type Document,
  type ErrorCode,
  type Fallback,
  type GrantSet,
  type KnownRel,
  type Limits,
  type ProseNode,
  type RenderedBlock,
  type ResourceNode,
} from '@markdown2/core';
import type { Md2Handler } from './handlers.js';

/**
 * Synchronous resolution and rendering, for drop-in `marked.parse()`.
 *
 * Produces the same styling tree as core `renderHtml` (style.md §4). Only
 * what can be decoded without awaiting is decoded: `utf-8` and `base64`.
 * Anything else that would otherwise run (gzip, a granted key, a granted
 * fetch) is shown as `unsupported` with error `requires-async`. Capability
 * rules are unchanged: locked resources stay locked.
 */

export const REQUIRES_ASYNC = 'requires-async';

export interface SyncEntry {
  kind: 'resource';
  node: ResourceNode;
  state: DecodeState;
  error?: string;
  bytes?: Uint8Array;
  children?: SyncNode[];
}
export type SyncNode = ProseNode | SyncEntry;

export interface SyncOptions {
  handlers: ReadonlyMap<string, Md2Handler>;
  registry: DecoderRegistry;
  grants: GrantSet;
  limits: Limits;
  remoteAllowed: (node: ResourceNode | undefined, origin: string) => boolean;
  sourceLines: boolean;
  diagnostics: Diagnostic[];
}

const encoder = new TextEncoder();
const noop = (): undefined => undefined;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

function base64Sync(input: Uint8Array): Uint8Array {
  const s = new TextDecoder().decode(input).replace(/[ \t\n\r\f]/g, '');
  if (s.length % 4 !== 0 || !B64.test(s)) throw new Error('invalid base64');
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

type Decoded = { bytes: Uint8Array } | { state: DecodeState; error: ErrorCode };

function decodeSync(node: ResourceNode, quota: ByteQuota): Decoded | null {
  let bytes = node.resource.payload;
  for (const id of node.resource.encoding) {
    if (id === 'utf-8') {
      try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        return { state: 'failed', error: 'invalid-utf-8' };
      }
    } else if (id === 'base64') {
      try {
        bytes = base64Sync(bytes);
      } catch {
        return { state: 'failed', error: 'decode-error' };
      }
      try {
        quota.charge(bytes.length);
      } catch (e) {
        if (e instanceof LimitExceeded) return { state: 'failed', error: 'limit-exceeded' };
        throw e;
      }
    } else {
      return null;
    }
  }
  return { bytes };
}

export function resolveSync(doc: Document, o: SyncOptions): SyncNode[] {
  const quota = new ByteQuota(o.limits.maxDecodedBytes);
  const counter = { resources: doc.children.filter((c) => c.kind === 'resource').length };
  const report = (node: ResourceNode, code: ErrorCode, message: string): void => {
    o.diagnostics.push({ code, message, line: node.startLine, nodeId: node.id });
  };

  const walk = (d: Document, depth: number): SyncNode[] => {
    const out: SyncNode[] = [];
    for (const child of d.children) {
      if (child.kind === 'prose') {
        out.push(child);
        continue;
      }
      const base = { kind: 'resource' as const, node: child };
      let entry: SyncEntry;
      const st = staticState(child, { registry: o.registry, grants: o.grants });
      if (st !== 'runnable') {
        entry = { ...base, state: st.state, ...(st.error ? { error: st.error } : {}) };
      } else {
        const dec = decodeSync(child, quota);
        if (dec === null) entry = { ...base, state: 'unsupported', error: REQUIRES_ASYNC };
        else if ('bytes' in dec) entry = { ...base, state: 'decoded', bytes: dec.bytes };
        else {
          entry = { ...base, state: dec.state, error: dec.error };
          report(child, dec.error, `Decoding failed: ${dec.error}`);
        }
      }
      if (entry.state === 'decoded' && entry.bytes && typeEssence(child.resource.type) === 'text/markdown') {
        if (depth + 1 > o.limits.maxDepth) {
          entry = { ...base, state: 'failed', error: 'limit-exceeded' };
          report(child, 'limit-exceeded', 'Nesting depth limit exceeded');
        } else {
          let text: string | undefined;
          try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(entry.bytes);
          } catch {
            entry = { ...base, state: 'failed', error: 'invalid-utf-8' };
            report(child, 'invalid-utf-8', 'Nested text/markdown is not valid UTF-8');
          }
          if (text !== undefined) {
            const nested = parse(text, { idPrefix: `${child.id}/`, limits: o.limits, counter });
            o.diagnostics.push(...nested.diagnostics);
            entry.children = walk(nested, depth + 1);
          }
        }
      }
      out.push(entry);
    }
    return out;
  };
  return walk(doc, 0);
}

// ------------------------------------------------------------------ render

interface Child {
  html: string;
  error?: string;
}

function withLine(html: string, line: number): string {
  return html.replace(/^<([A-Za-z][A-Za-z0-9-]*)/, `<$1 data-m2-line="${line}"`);
}

function fallbackOf(e: SyncEntry, error?: string): Fallback {
  const base = fallbackFor(e.node, e.bytes ? { state: e.state, bytes: e.bytes } : { state: e.state });
  const err = error ?? e.error;
  return err === undefined ? base : { ...base, error: err };
}

function fallbackChild(e: SyncEntry, error?: string): Child {
  const f = fallbackOf(e, error);
  return { html: fallbackHtml(f), ...(f.error === undefined ? {} : { error: f.error }) };
}

function attachmentChild(e: SyncEntry): Child {
  if (e.state !== 'decoded') return fallbackChild(e);
  const f = fallbackOf(e);
  const save = safeSaveName(e.node, 'decoded').name;
  return {
    html: `<md2-view><div class="m2-attachment" data-m2-save-name="${escapeHtml(save)}">📎 ${escapeHtml(f.label ?? save)} · ${escapeHtml(f.type ?? '(no type)')} · ${f.size} bytes</div></md2-view>`,
  };
}

function renderable(e: SyncEntry, o: SyncOptions): boolean {
  if (e.state !== 'decoded') return false;
  const t = typeEssence(e.node.resource.type);
  if (t === undefined) return false;
  return t === 'text/markdown' ? e.children !== undefined : o.handlers.has(t);
}

function renderChild(e: SyncEntry, o: SyncOptions, rel: KnownRel, base: number): Child {
  if (rel === 'metadata' || rel === 'stylesheet') {
    return e.state === 'decoded' ? { html: '<md2-view></md2-view>' } : fallbackChild(e);
  }
  if (rel === 'attachment') return attachmentChild(e);
  if (e.state !== 'decoded' || e.bytes === undefined) return fallbackChild(e);
  const type = typeEssence(e.node.resource.type);
  if (type === undefined) return fallbackChild(e);
  if (type === 'text/markdown' && e.children !== undefined) {
    return { html: renderDocument(e.children, o, '', base + e.node.startLine + 1) };
  }
  const h = o.handlers.get(type);
  if (h === undefined) return fallbackChild(e);
  try {
    const out = h.render(e.bytes, { type, node: e.node, remoteAllowed: (origin) => o.remoteAllowed(e.node, origin) });
    if (typeof out !== 'string') {
      out.then(noop, noop);
      return fallbackChild(e, REQUIRES_ASYNC);
    }
    return { html: `<md2-view>${out}</md2-view>` };
  } catch {
    return fallbackChild(e, 'handler-error');
  }
}

/** Fenced code: compatibility aliases (§7.2) select a handler, else plain code. */
function fenceSync(o: SyncOptions): (info: string, body: string) => string {
  return (info, body) => {
    const lang = info.split(/\s+/)[0] ?? '';
    const type = fenceAliasType(lang);
    const h = type === undefined ? undefined : o.handlers.get(type);
    if (h !== undefined && type !== undefined) {
      try {
        const out = h.render(encoder.encode(body), {
          type,
          remoteAllowed: (origin) => o.remoteAllowed(undefined, origin),
        });
        if (typeof out === 'string') return out;
        out.then(noop, noop);
      } catch {
        // Not usable by the aliased handler: ordinary code.
      }
    }
    return defaultFenceHtml(info, body);
  };
}

function resourceAttrs(n: SyncEntry, shown: SyncEntry, rel: KnownRel, error: string | undefined): [string, string][] {
  const r = shown.node.resource;
  const a = r.attributes;
  const out: [string, string][] = [
    ['id', `m2-${n.node.id}`],
    ['data-m2-id', n.node.id],
  ];
  if (r.type !== undefined) out.push(['type', r.type]);
  const essence = typeEssence(r.type);
  if (essence !== undefined && essence !== '') out.push(['essence', essence]);
  const enc = a.get('encoding');
  if (enc !== undefined) out.push(['encoding', enc]);
  out.push(['rel', relToken(n.node.rel)]);
  out.push(['state', shown.state]);
  if (error !== undefined) out.push(['error', error]);
  for (const k of ['title', 'filename'] as const) {
    const v = a.get(k);
    if (v !== undefined) out.push([k, v]);
  }
  const cls = a.get('md2-class');
  if (cls !== undefined) out.push(['class', cls]);
  out.push(['data-m2-rel', rel]);
  return out;
}

function attrString(attrs: readonly (readonly [string, string])[]): string {
  return attrs.map(([k, v]) => ` ${k}="${escapeHtml(v)}"`).join('');
}

function renderItems(nodes: readonly SyncNode[], o: SyncOptions, base: number): RenderedBlock[] {
  const { associations, orphans } = analyseRels(nodes.map((n) => (n.kind === 'prose' ? n : n.node)));
  const orphanSet = new Set(orphans);
  const byId = new Map<string, SyncEntry>();
  for (const n of nodes) if (n.kind === 'resource') byId.set(n.node.id, n);

  const alternates = new Map<string, SyncEntry[]>();
  const descriptions = new Map<string, string[]>();
  const describes = new Map<string, string>();
  const suppressed = new Set<string>();
  for (const a of associations) {
    if (a.kind === 'alternate') {
      const alt = byId.get(a.nodeId);
      if (alt) {
        alternates.set(a.targetId, [...(alternates.get(a.targetId) ?? []), alt]);
        suppressed.add(a.nodeId);
      }
    } else {
      descriptions.set(a.targetId, [...(descriptions.get(a.targetId) ?? []), a.nodeId]);
      describes.set(a.nodeId, a.targetId);
    }
  }

  const fence = fenceSync(o);
  const items: RenderedBlock[] = [];
  for (const n of nodes) {
    if (n.kind === 'prose') {
      if (!/\S/.test(n.text)) continue;
      for (const b of renderMarkdownBlocksSync(n.text, { fence })) {
        items.push(o.sourceLines && b.line !== undefined ? { ...b, html: withLine(b.html, base + n.startLine + b.line) } : b);
      }
      continue;
    }
    const id = n.node.id;
    if (suppressed.has(id)) continue;
    const rel: KnownRel = orphanSet.has(id) ? 'inline' : effectiveRel(n.node.rel);
    const candidates = rel === 'metadata' || rel === 'stylesheet' ? [n] : [n, ...(alternates.get(id) ?? [])];
    const shown = candidates.find((c) => renderable(c, o)) ?? n;
    const child = renderChild(shown, o, rel, base);

    const attrs = resourceAttrs(n, shown, rel, child.error);
    if (o.sourceLines) attrs.push(['data-m2-line', String(base + n.node.startLine)]);
    if (shown !== n) attrs.push(['data-m2-shown', shown.node.id]);
    const target = describes.get(id);
    if (target !== undefined) {
      attrs.push(['role', 'note']);
      attrs.push(['data-m2-describes', target]);
    }
    const desc = descriptions.get(id);
    if (desc) attrs.push(['aria-describedby', desc.map((d) => `m2-${d}`).join(' ')]);
    items.push({ html: `<md2-resource${attrString(attrs)}>${child.html}</md2-resource>` });
  }
  return items;
}

function sectionize(items: readonly RenderedBlock[]): string {
  const out: string[] = [];
  const stack: number[] = [];
  for (const it of items) {
    if (it.heading !== undefined) {
      while ((stack.at(-1) ?? 0) >= it.heading) {
        out.push('</md2-section>');
        stack.pop();
      }
      out.push(`<md2-section level="${it.heading}">`);
      stack.push(it.heading);
    }
    out.push(it.html);
  }
  out.push(...stack.map(() => '</md2-section>'));
  return out.join('\n');
}

function renderDocument(nodes: readonly SyncNode[], o: SyncOptions, attrs: string, base: number): string {
  return `<md2-document${attrs}>${sectionize(renderItems(nodes, o, base))}</md2-document>`;
}

/** Render a synchronously resolved tree to the M2SS styling tree. */
export function renderSyncHtml(nodes: readonly SyncNode[], o: SyncOptions): string {
  return renderDocument(nodes, o, ' data-m2-root', 0);
}