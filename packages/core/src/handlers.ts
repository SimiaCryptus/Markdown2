import { encodeBase64 } from './base64.js';
import { escapeHtml } from './html.js';
import { typeEssence } from './runtime.js';
import { MAX_TABLE_BYTES, buildTable, headerPresent, parseCsv, parseTsv, tableHtml } from './table.js';
import type { ResourceNode } from './types.js';

export type HandlerCapability = 'view' | 'thumbnail' | 'validate';

export interface HandlerContext {
  /** Lower-cased essence of the declared type that selected this handler. */
  type: string;
  /** Absent for compatibility fences (§7.2), which are not resources. */
  node?: ResourceNode;
  /** Render the nested document of a decoded `text/markdown` resource. */
  children: () => Promise<string>;
}

export interface Handler {
  /** Exact media types, no wildcards (§6.1). */
  types: readonly string[];
  capabilities: readonly HandlerCapability[];
  /** Render inside an opaque-origin sandboxed iframe (§11 handler isolation). */
  sandbox?: boolean;
  /** Returns HTML. Rejecting means the handler could not use the bytes. */
  render(bytes: Uint8Array, ctx: HandlerContext): Promise<string>;
}

/**
 * Handler registry keyed by capability × media type (§9 Viewer API).
 * Lookup compares the lower-cased essence only (spec-issues #10); no content
 * is ever inspected and near misses such as `image/jpg` never match.
 */
export class HandlerRegistry {
  private readonly map = new Map<string, Handler>();

  constructor(handlers: readonly Handler[] = []) {
    for (const h of handlers) this.register(h);
  }

  private static key(cap: HandlerCapability, essence: string): string {
    return `${cap} ${essence}`;
  }

  register(h: Handler): void {
    for (const t of h.types) {
      const essence = typeEssence(t);
      if (essence === undefined || essence === '') continue;
      for (const c of h.capabilities) this.map.set(HandlerRegistry.key(c, essence), h);
    }
  }

  get(cap: HandlerCapability, type: string | undefined): Handler | undefined {
    const essence = typeEssence(type);
    return essence === undefined ? undefined : this.map.get(HandlerRegistry.key(cap, essence));
  }

  can(cap: HandlerCapability, type: string | undefined): boolean {
    return this.get(cap, type) !== undefined;
  }

  /** Type essences that have a handler for `cap`. */
  types(cap: HandlerCapability): Set<string> {
    const out = new Set<string>();
    for (const k of this.map.keys()) {
      const sp = k.indexOf(' ');
      if (k.slice(0, sp) === cap) out.add(k.slice(sp + 1));
    }
    return out;
  }
}

const lenientUtf8 = new TextDecoder('utf-8');
/** Largest diagram source accepted by the diagram handlers, in UTF-16 code units. */
const MAX_DIAGRAM = 256 * 1024;
/** Largest WaveJSON source accepted by the WaveDrom handler. */
const MAX_WAVE = 256 * 1024;
/** Decode strict UTF-8. Throws on invalid input, so a handler rejects and falls back. */
function strictUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
/**
 * Opaque-origin frame for a sandboxed renderer page (/sandbox/<kind>.html).
 * `allow-same-origin` is never granted. The reader passes `data-m2-source`
 * to the frame by postMessage. Until the frame draws, the sibling
 * `.m2-frame-fallback` shows the source.
 */
function frameHtml(kind: string, src: string, title: string, engine?: string): string {
  const engineAttr = engine === undefined ? '' : ` data-m2-engine="${escapeHtml(engine)}"`;
  return `<iframe class="m2-frame" sandbox="allow-scripts" referrerpolicy="no-referrer" src="/sandbox/${escapeHtml(kind)}.html" title="${escapeHtml(title)}" data-m2-frame="${escapeHtml(kind)}" data-m2-source="${escapeHtml(src)}"${engineAttr}></iframe>`;
}

export const textHandler: Handler = {
  types: ['text/plain'],
  capabilities: ['view'],
  render: (bytes) => Promise.resolve(`<pre class="m2-text">${escapeHtml(lenientUtf8.decode(bytes))}</pre>`),
};

/** The Markdown2 handler: renders the nested `md2-document` (§3.3, style.md §4.2). */
export const markdownHandler: Handler = {
  types: ['text/markdown'],
  capabilities: ['view'],
  render: (_bytes, ctx) => ctx.children(),
};

export const jsonHandler: Handler = {
  types: ['application/json'],
  capabilities: ['view', 'validate'],
  render: (bytes) =>
    new Promise<string>((resolve) => {
      // A throw inside the executor rejects: invalid JSON → handler-error fallback.
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      resolve(`<pre class="m2-json">${escapeHtml(JSON.stringify(value, null, 2))}</pre>`);
    }),
};

/**
 * YAML is shown as text and never parsed here, so no tag can be
 * instantiated (§4.2, H.3). A tree viewer with a safe schema comes later.
 */
export const yamlHandler: Handler = {
  types: ['application/yaml'],
  capabilities: ['view'],
  render: (bytes) => Promise.resolve(`<pre class="m2-yaml">${escapeHtml(lenientUtf8.decode(bytes))}</pre>`),
};

/**
 * Raster images and SVG. SVG is rendered through `<img>` only, a context in
 * which scripts never run; it is never inlined.
 */
export const imageHandler: Handler = {
  types: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml'],
  capabilities: ['view', 'thumbnail'],
  render: (bytes, ctx) => {
    const attrs = ctx.node?.resource.attributes;
    const alt = attrs?.get('title') ?? attrs?.get('filename') ?? '';
    return Promise.resolve(
      `<img class="m2-image" alt="${escapeHtml(alt)}" src="data:${escapeHtml(ctx.type)};base64,${encodeBase64(bytes)}">`,
    );
  },
};
/** Graphviz layout engines; anything else falls back to `dot`. */
const GRAPHVIZ_ENGINES: ReadonlySet<string> = new Set([
  'dot',
  'neato',
  'fdp',
  'sfdp',
  'circo',
  'twopi',
  'osage',
  'patchwork',
]);
/**
 * Graphviz graphs, drawn by Graphviz (WebAssembly) in an opaque-origin frame
 * (/sandbox/graphviz.html). The `layout` attribute picks the engine.
 */
export const graphvizHandler: Handler = {
  types: ['text/vnd.graphviz'],
  capabilities: ['view'],
  render: (bytes, ctx) =>
    new Promise<string>((resolve) => {
      // A throw inside the executor rejects: handler-error fallback.
      const src = strictUtf8(bytes);
      if (src.length > MAX_DIAGRAM) throw new Error('graph too large');
      const layout = ctx.node?.resource.attributes.get('layout');
      const engine = layout !== undefined && GRAPHVIZ_ENGINES.has(layout) ? layout : 'dot';
      const title = ctx.node?.resource.attributes.get('title') ?? 'Graphviz graph';
      resolve(
        `<div class="m2-frame-host m2-diagram m2-graphviz"><pre class="m2-frame-fallback"><code class="language-dot">${escapeHtml(src)}</code></pre>${frameHtml('graphviz', src, title, engine)}</div>`,
      );
    }),
};
/**
 * WaveDrom timing diagrams and register maps. WaveJSON is parsed as JSON5,
 * never evaluated; the SVG is shown through <img>.
 */
export const wavedromHandler: Handler = {
  types: ['text/vnd.wavedrom'],
  capabilities: ['view'],
  async render(bytes, ctx) {
    const src = strictUtf8(bytes);
    if (src.length > MAX_WAVE) throw new Error('diagram too large');
    // lazy: only when a diagram appears
    const { waveToSvg } = await import('./wavedrom.js');
    const svg = waveToSvg(src);
    const data = encodeBase64(new TextEncoder().encode(svg));
    const title = ctx.node?.resource.attributes.get('title') ?? 'WaveDrom diagram';
    return `<div class="m2-wave-block"><img class="m2-wavedrom" alt="${escapeHtml(title)}" src="data:image/svg+xml;base64,${data}"></div>`;
  },
};
/**
 * CSV (RFC 4180, honouring `header=absent`) and TSV, rendered as an escaped
 * `table.m2-grid`. Readers may add sorting and filtering on top.
 */
export const tableHandler: Handler = {
  types: ['text/csv', 'text/tab-separated-values'],
  capabilities: ['view', 'validate'],
  render: (bytes, ctx) =>
    new Promise<string>((resolve) => {
      // A throw inside the executor rejects: handler-error fallback.
      if (bytes.length > MAX_TABLE_BYTES) throw new Error('table too large');
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); // a leading BOM is dropped
      const kind = ctx.type === 'text/tab-separated-values' ? 'tsv' : 'csv';
      const cells = kind === 'tsv' ? parseTsv(text) : parseCsv(text);
      resolve(tableHtml(buildTable(cells, headerPresent(ctx.node?.resource.type)), kind));
    }),
};

export function defaultHandlers(): HandlerRegistry {
  return new HandlerRegistry([textHandler, markdownHandler, jsonHandler, yamlHandler, imageHandler, tableHandler]);
}

/**
 * Compatibility aliases for fenced code info strings (§7.2). They are not
 * part of the format and only influence handler selection; aliased fences
 * remain fenced code in the parse tree.
 */
export const FENCE_ALIASES: Readonly<Record<string, string>> = {
  mermaid: 'text/vnd.mermaid',
  dot: 'text/vnd.graphviz',
  graphviz: 'text/vnd.graphviz',
  wavedrom: 'text/vnd.wavedrom',
  json: 'application/json',
  math: 'application/x-tex',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  x3d: 'model/x3d+xml',
  geojson: 'application/geo+json',
};

export function fenceAliasType(info: string): string | undefined {
  const lang = info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return Object.hasOwn(FENCE_ALIASES, lang) ? FENCE_ALIASES[lang] : undefined;
}
