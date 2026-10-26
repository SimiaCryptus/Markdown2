import { defaultHandlers, fenceAliasType, type HandlerRegistry } from './handlers.js';
import { escapeHtml, sandboxFrame } from './html.js';
import { renderMarkdownBlocks, type RenderedBlock } from './markdown.js';
import { analyseRels, effectiveRel, relToken, type KnownRel } from './rel.js';
import { fallbackFor, typeEssence, type Fallback, type ResolvedNode, type ResolvedResource } from './runtime.js';
import { safeSaveName } from './save.js';

/**
 * Renders the M2SS styling tree (style.md §4): `md2-document`, `md2-section`,
 * `md2-resource`, `md2-view` and `md2-fallback` over CommonMark HTML.
 */
export interface RenderOptions {
  handlers?: HandlerRegistry;
}

const encoder = new TextEncoder();

/**
 * Fallback stub (§6.2, style.md §4.2). Shows label, type, encoding, state,
 * error, size and any "did you mean?" hint. Never contains payload bytes.
 */
export function fallbackHtml(f: Fallback): string {
  const icon = f.state === 'locked' ? '🔒' : f.state === 'decoded' ? '📄' : '⚠️';
  const state = f.error === undefined ? f.state : `${f.state}: ${f.error}`;
  const detail = [f.type ?? '(no type)', f.encoding, state, `${f.size} bytes`].filter((p) => p !== '').join(' · ');
  const summary = [f.label, detail].filter((p): p is string => p !== undefined && p !== '').join(' · ');
  const hint =
    f.suggestion === undefined
      ? ''
      : ` <span class="m2-hint">Did you mean <code>${escapeHtml(f.suggestion)}</code>?</span>`;
  return `<md2-fallback role="group" aria-label="${escapeHtml(summary)}"><md2-label>${escapeHtml(f.label ?? '')}</md2-label><md2-detail><span aria-hidden="true">${icon}</span> ${escapeHtml(detail)}${hint}</md2-detail></md2-fallback>`;
}

function renderable(e: ResolvedResource, handlers: HandlerRegistry): boolean {
  return e.result.state === 'decoded' && handlers.can('view', e.node.resource.type);
}

interface Child {
  html: string;
  error?: string;
}

function fallbackChild(entry: ResolvedResource, error?: string): Child {
  const f = fallbackFor(entry.node, entry.result);
  const e = error ?? f.error;
  return { html: fallbackHtml(e === undefined ? f : { ...f, error: e }), ...(e === undefined ? {} : { error: e }) };
}

function attachmentChild(entry: ResolvedResource): Child {
  const f = fallbackFor(entry.node, entry.result);
  if (f.state !== 'decoded') return fallbackChild(entry);
  const save = safeSaveName(entry.node, 'decoded').name;
  return {
    html: `<md2-view><div class="m2-attachment" data-m2-save-name="${escapeHtml(save)}">📎 ${escapeHtml(f.label ?? save)} · ${escapeHtml(f.type ?? '(no type)')} · ${f.size} bytes</div></md2-view>`,
  };
}

async function renderChild(entry: ResolvedResource, handlers: HandlerRegistry, rel: KnownRel): Promise<Child> {
  const { node, result } = entry;
  // Metadata is consumed and stylesheets are applied; neither is rendered inline.
  if (rel === 'metadata' || rel === 'stylesheet') {
    return result.state === 'decoded' ? { html: '<md2-view></md2-view>' } : fallbackChild(entry);
  }
  if (rel === 'attachment') return attachmentChild(entry);

  const type = typeEssence(node.resource.type);
  const handler = result.state === 'decoded' ? handlers.get('view', node.resource.type) : undefined;
  if (handler === undefined || result.bytes === undefined || type === undefined) return fallbackChild(entry);

  const children = (): Promise<string> => renderDocument(entry.children ?? [], handlers, '');
  // A decoded text/markdown resource has an md2-document as its only child.
  if (type === 'text/markdown' && entry.children !== undefined) return { html: await children() };
  try {
    const html = await handler.render(result.bytes, { type, node, children });
    const inner = handler.sandbox === true ? sandboxFrame(html, node.resource.attributes.get('title') ?? type) : html;
    return { html: `<md2-view>${inner}</md2-view>` };
  } catch {
    return fallbackChild(entry, 'handler-error');
  }
}

/** Fenced code in prose: compatibility aliases (§7.2) select a handler, else plain code. */
async function renderFence(info: string, body: string, handlers: HandlerRegistry): Promise<string> {
  const lang = info.split(/\s+/)[0] ?? '';
  const type = fenceAliasType(lang);
  const handler = type === undefined ? undefined : handlers.get('view', type);
  if (handler !== undefined && type !== undefined) {
    try {
      const html = await handler.render(encoder.encode(body), { type, children: () => Promise.resolve('') });
      return handler.sandbox === true ? sandboxFrame(html, lang) : html;
    } catch {
      // Not usable by the aliased handler: show it as ordinary code.
    }
  }
  const cls = lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`;
  return `<pre><code${cls}>${escapeHtml(body)}</code></pre>`;
}

function attrString(attrs: readonly (readonly [string, string])[]): string {
  return attrs.map(([k, v]) => ` ${k}="${escapeHtml(v)}"`).join('');
}

function resourceAttrs(
  n: ResolvedResource,
  shown: ResolvedResource,
  rel: KnownRel,
  error: string | undefined,
): [string, string][] {
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
  out.push(['state', shown.result.state]);
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

async function renderItems(nodes: readonly ResolvedNode[], handlers: HandlerRegistry): Promise<RenderedBlock[]> {
  const { associations, orphans } = analyseRels(nodes.map((n) => (n.kind === 'prose' ? n : n.node)));
  const orphanSet = new Set(orphans);
  const byId = new Map<string, ResolvedResource>();
  for (const n of nodes) if (n.kind === 'resource') byId.set(n.node.id, n);

  const alternates = new Map<string, ResolvedResource[]>();
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

  const fence = (info: string, body: string): Promise<string> => renderFence(info, body, handlers);
  const items: RenderedBlock[] = [];
  for (const n of nodes) {
    if (n.kind === 'prose') {
      if (/\S/.test(n.text)) items.push(...(await renderMarkdownBlocks(n.text, { fence })));
      continue;
    }
    const id = n.node.id;
    if (suppressed.has(id)) continue;
    const rel = orphanSet.has(id) ? 'inline' : effectiveRel(n.node.rel);

    // "Render at most one of the two" (A.1, spec-issues #18).
    const candidates = rel === 'metadata' || rel === 'stylesheet' ? [n] : [n, ...(alternates.get(id) ?? [])];
    const shown = candidates.find((c) => renderable(c, handlers)) ?? n;
    const child = await renderChild(shown, handlers, rel);

    const attrs = resourceAttrs(n, shown, rel, child.error);
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

/**
 * Derive sections (style.md §4.2): each top-level heading opens an
 * `md2-section` that runs to the next heading of the same or smaller level.
 */
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

async function renderDocument(
  nodes: readonly ResolvedNode[],
  handlers: HandlerRegistry,
  attrs: string,
): Promise<string> {
  return `<md2-document${attrs}>${sectionize(await renderItems(nodes, handlers))}</md2-document>`;
}

/** Render a resolved tree to the M2SS styling tree, as an HTML fragment. DOM-free. */
export function renderHtml(nodes: readonly ResolvedNode[], opts: RenderOptions = {}): Promise<string> {
  return renderDocument(nodes, opts.handlers ?? defaultHandlers(), ' data-m2-root');
}
