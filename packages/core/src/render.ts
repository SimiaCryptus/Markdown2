import { defaultHandlers, fenceAliasType, type HandlerRegistry } from './handlers.js';
import { escapeHtml, sandboxFrame } from './html.js';
import { renderMarkdown } from './markdown.js';
import { analyseRels, effectiveRel } from './rel.js';
import { fallbackFor, typeEssence, type Fallback, type ResolvedNode, type ResolvedResource } from './runtime.js';
import { safeSaveName } from './save.js';

export interface RenderOptions {
  handlers?: HandlerRegistry;
}

const encoder = new TextEncoder();

/**
 * Fallback stub (§6.2). Shows label, type, encoding, state, error, size and
 * any "did you mean?" hint. Never contains payload bytes (§2.7 fail closed).
 */
export function fallbackHtml(f: Fallback): string {
  const icon = f.state === 'locked' ? '🔒' : f.state === 'decoded' ? '📄' : '⚠️';
  const state = f.error === undefined ? f.state : `${f.state}: ${f.error}`;
  const summary = [f.label, f.type ?? '(no type)', f.encoding, state, `${f.size} bytes`]
    .filter((p): p is string => p !== undefined && p !== '')
    .join(' · ');
  const hint =
    f.suggestion === undefined
      ? ''
      : ` <span class="m2-hint">Did you mean <code>${escapeHtml(f.suggestion)}</code>?</span>`;
  return `<div class="m2-fallback" role="group" aria-label="${escapeHtml(summary)}"><span class="m2-icon" aria-hidden="true">${icon}</span> ${escapeHtml(summary)}${hint}</div>`;
}

function renderable(e: ResolvedResource, handlers: HandlerRegistry): boolean {
  return e.result.state === 'decoded' && handlers.can('view', e.node.resource.type);
}

function attachmentHtml(entry: ResolvedResource): string {
  const f = fallbackFor(entry.node, entry.result);
  if (f.state !== 'decoded') return fallbackHtml(f);
  const save = safeSaveName(entry.node, 'decoded').name;
  return `<div class="m2-attachment" data-m2-save-name="${escapeHtml(save)}">📎 ${escapeHtml(f.label ?? save)} · ${escapeHtml(f.type ?? '(no type)')} · ${f.size} bytes</div>`;
}

async function renderResource(entry: ResolvedResource, handlers: HandlerRegistry): Promise<string> {
  const { node, result } = entry;
  const handler = result.state === 'decoded' ? handlers.get('view', node.resource.type) : undefined;
  const type = typeEssence(node.resource.type);
  if (handler === undefined || result.bytes === undefined || type === undefined) {
    return fallbackHtml(fallbackFor(node, result));
  }
  try {
    const html = await handler.render(result.bytes, {
      type,
      node,
      children: () => renderLevel(entry.children ?? [], handlers),
    });
    return handler.sandbox === true ? sandboxFrame(html, node.resource.attributes.get('title') ?? type) : html;
  } catch {
    return fallbackHtml({ ...fallbackFor(node, result), error: 'handler-error' });
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

function attrString(attrs: Readonly<Record<string, string>>): string {
  return Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${escapeHtml(v)}"`)
    .join('');
}

async function renderLevel(nodes: readonly ResolvedNode[], handlers: HandlerRegistry): Promise<string> {
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
  const out: string[] = [];
  for (const n of nodes) {
    if (n.kind === 'prose') {
      if (/\S/.test(n.text)) out.push(await renderMarkdown(n.text, { fence }));
      continue;
    }
    const id = n.node.id;
    if (suppressed.has(id)) continue;
    const rel = orphanSet.has(id) ? 'inline' : effectiveRel(n.node.rel);
    // Decoded metadata is consumed, not displayed (A.1). Failed or locked
    // metadata still shows its stub (spec-issues #19).
    if (rel === 'metadata' && n.result.state === 'decoded') continue;

    // "Render at most one of the two" (A.1, spec-issues #18).
    const candidates = [n, ...(alternates.get(id) ?? [])];
    const shown = candidates.find((c) => renderable(c, handlers)) ?? n;
    const inner = rel === 'attachment' ? attachmentHtml(shown) : await renderResource(shown, handlers);

    const attrs: Record<string, string> = {
      class: 'm2-resource',
      id: `m2-${id}`,
      'data-m2-id': id,
      'data-m2-rel': rel,
      'data-m2-state': shown.result.state,
    };
    if (shown !== n) attrs['data-m2-shown'] = shown.node.id;
    const target = describes.get(id);
    if (target !== undefined) {
      attrs.role = 'note';
      attrs['data-m2-describes'] = target;
    }
    const desc = descriptions.get(id);
    if (desc) attrs['aria-describedby'] = desc.map((d) => `m2-${d}`).join(' ');
    out.push(`<div${attrString(attrs)}>${inner}</div>`);
  }
  return out.join('\n');
}

/** Render a resolved tree to an HTML fragment. DOM-free. */
export function renderHtml(nodes: readonly ResolvedNode[], opts: RenderOptions = {}): Promise<string> {
  return renderLevel(nodes, opts.handlers ?? defaultHandlers());
}
