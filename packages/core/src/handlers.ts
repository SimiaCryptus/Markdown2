import { encodeBase64 } from './base64.js';
import { escapeHtml } from './html.js';
import { typeEssence } from './runtime.js';
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

export const textHandler: Handler = {
  types: ['text/plain'],
  capabilities: ['view'],
  render: (bytes) => Promise.resolve(`<pre class="m2-text">${escapeHtml(lenientUtf8.decode(bytes))}</pre>`),
};

/** The Markdown2 handler: renders the nested document (§3.3). */
export const markdownHandler: Handler = {
  types: ['text/markdown'],
  capabilities: ['view'],
  render: (_bytes, ctx) => ctx.children().then((html) => `<div class="m2-document">${html}</div>`),
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

export function defaultHandlers(): HandlerRegistry {
  return new HandlerRegistry([textHandler, markdownHandler, jsonHandler, yamlHandler, imageHandler]);
}

/**
 * Compatibility aliases for fenced code info strings (§7.2). They are not
 * part of the format and only influence handler selection; aliased fences
 * remain fenced code in the parse tree.
 */
export const FENCE_ALIASES: Readonly<Record<string, string>> = {
  mermaid: 'text/vnd.mermaid',
  json: 'application/json',
  math: 'application/x-tex',
};

export function fenceAliasType(info: string): string | undefined {
  const lang = info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return Object.hasOwn(FENCE_ALIASES, lang) ? FENCE_ALIASES[lang] : undefined;
}
