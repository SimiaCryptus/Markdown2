import {
  buildTable,
  encodeBase64,
  escapeHtml,
  headerPresent,
  HandlerRegistry,
  logBlockedEmbed,
  markdownHandler,
  MAX_TABLE_BYTES,
  parseCsv,
  parseTsv,
  tableHtml,
  typeEssence,
  type PermissionPolicy,
  type ResourceNode,
} from '@markdown2/core';
import { waveToSvg } from '../../../packages/core/src/wavedrom.js';

/** What a handler is told about the resource it draws. */
export interface Md2HandlerContext {
  /** Lower-cased essence of the declared type that selected this handler. */
  type: string;
  /** Absent for compatibility fences (§7.2), which are not resources. */
  node?: ResourceNode;
  /** Whether this view may contact `origin`. False unless the app or the user allowed it. */
  remoteAllowed: (origin: string) => boolean;
  /** Active permission policy, if configured. */
  policy?: PermissionPolicy;
}

/** Network access a view needs for given bytes. */
export interface RemoteNeed {
  origin: string;
  label: string;
}

/**
 * A handler: decoded bytes in, HTML out. Selected by exact declared type
 * (no sniffing). Return a string to work in synchronous `marked.parse()`;
 * a Promise only works with `async: true` and `mount()`. Throwing means the
 * bytes are unusable and the resource shows its fallback (`handler-error`).
 */
export interface Md2Handler {
  types: readonly string[];
  render(bytes: Uint8Array, ctx: Md2HandlerContext): string | Promise<string>;
  /** Network access the view would need, so readers can ask first. */
  remote?: (bytes: Uint8Array, type: string, policy?: PermissionPolicy) => RemoteNeed | null;
}

const lenient = new TextDecoder('utf-8');
const strictUtf8 = (b: Uint8Array): string => new TextDecoder('utf-8', { fatal: true }).decode(b);
const MAX_WAVE = 256 * 1024;

export const textHandler: Md2Handler = {
  types: ['text/plain'],
  render: (b) => `<pre class="m2-text">${escapeHtml(lenient.decode(b))}</pre>`,
};

export const jsonHandler: Md2Handler = {
  types: ['application/json'],
  render: (b) => {
    const v: unknown = JSON.parse(strictUtf8(b));
    return `<pre class="m2-json">${escapeHtml(JSON.stringify(v, null, 2))}</pre>`;
  },
};

/** YAML is shown as text and never parsed, so no tag can be instantiated (§4.2). */
export const yamlHandler: Md2Handler = {
  types: ['application/yaml'],
  render: (b) => `<pre class="m2-yaml">${escapeHtml(lenient.decode(b))}</pre>`,
};

/** Raster images and SVG, shown through <img> only: scripts in SVG never run. */
export const imageHandler: Md2Handler = {
  types: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml'],
  render: (b, ctx) => {
    const a = ctx.node?.resource.attributes;
    const alt = a?.get('title') ?? a?.get('filename') ?? '';
    return `<img class="m2-image" alt="${escapeHtml(alt)}" src="data:${escapeHtml(ctx.type)};base64,${encodeBase64(b)}">`;
  },
};

/** CSV (RFC 4180, `header=absent` honoured) and TSV, as an escaped table. */
export const tableHandler: Md2Handler = {
  types: ['text/csv', 'text/tab-separated-values'],
  render: (b, ctx) => {
    if (b.length > MAX_TABLE_BYTES) throw new Error('table too large');
    const text = strictUtf8(b);
    const kind = ctx.type === 'text/tab-separated-values' ? 'tsv' : 'csv';
    const cells = kind === 'tsv' ? parseTsv(text) : parseCsv(text);
    return tableHtml(buildTable(cells, headerPresent(ctx.node?.resource.type)), kind);
  },
};

/** WaveDrom: WaveJSON is parsed as data, never evaluated; the SVG is shown through <img>. */
export const wavedromHandler: Md2Handler = {
  types: ['text/vnd.wavedrom'],
  render: (b, ctx) => {
    const src = strictUtf8(b);
    if (src.length > MAX_WAVE) throw new Error('diagram too large');
    const svg = waveToSvg(src);
    const title = ctx.node?.resource.attributes.get('title') ?? 'WaveDrom diagram';
    return `<div class="m2-wave-block"><img class="m2-wavedrom" alt="${escapeHtml(title)}" src="data:image/svg+xml;base64,${encodeBase64(new TextEncoder().encode(svg))}"></div>`;
  },
};

export const PAGE_TYPE = 'text/uri-list';
/** No top navigation, so an embedded page can never replace the host page. */
const PAGE_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-presentation';

function appOrigin(): string | undefined {
  return typeof location === 'undefined' ? undefined : location.origin;
}

export interface PageTargetOptions {
  appOrigin?: string;
  policy?: PermissionPolicy;
}

export interface PageTargetDiagnosis {
  url: URL | null;
  reason?: string;
}

/** Validate an embedded page URL (`text/uri-list`) and explain why it was rejected if invalid. */
export function diagnosePageTarget(bytes: Uint8Array, opts: PageTargetOptions = {}): PageTargetDiagnosis {
  const app = opts.appOrigin !== undefined ? opts.appOrigin : appOrigin();
  let text: string;
  try {
    text = strictUtf8(bytes);
  } catch {
    return { url: null, reason: 'Embedded page payload is not valid UTF-8.' };
  }
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l !== '' && !l.startsWith('#'));
  if (line === undefined) return { url: null, reason: 'No URL found in text/uri-list payload.' };
  let u: URL;
  try {
    u = new URL(line);
  } catch {
    return { url: null, reason: `Malformed URL "${line}" in text/uri-list.` };
  }
  if (u.username !== '' || u.password !== '') {
    return { url: null, reason: `Embedded page URL "${line}" contains credentials, which are not permitted.` };
  }
  const isHttps = u.protocol === 'https:';
  const isAllowedHttp = u.protocol === 'http:' && opts.policy?.allowsHttpUrl(u, 'embed') === true;
  if (!isHttps && !isAllowedHttp) {
    return {
      url: null,
      reason:
        u.protocol === 'http:'
          ? `Plain http: embedded page "${u.href}" is blocked by default. To allow it, explicitly whitelist "${u.origin}" in permissions.allowOrigins (or allowEmbed) or set permissions.allowHttp: true.`
          : `Unsupported scheme "${u.protocol}" for embedded page "${line}". Only https: (or explicitly whitelisted http:) pages can be embedded.`,
    };
  }
  if (app !== undefined && u.origin === app && opts.policy?.allowSameOriginEmbed !== true) {
    return {
      url: null,
      reason: `Same-origin embedded page "${u.href}" is blocked by default to prevent embedded frames from reaching host page state. To allow it, set permissions: { allowOrigins: ['self'], allowSameOriginEmbed: true }.`,
    };
  }
  return { url: u };
}

/** The page an embed points at: first non-comment line, `https:` only (unless whitelisted), never the host page's own origin (unless opted in). */
export function pageTarget(bytes: Uint8Array, appOrOpts?: string | PageTargetOptions): URL | null {
  const opts: PageTargetOptions = typeof appOrOpts === 'string' ? { appOrigin: appOrOpts } : (appOrOpts ?? {});
  return diagnosePageTarget(bytes, opts).url;
}

/**
 * Embedded web pages (`text/uri-list`). The view reaches the network, so it
 * is drawn only when allowed; until then it shows its address and a load slot.
 */
export const pageHandler: Md2Handler = {
  types: [PAGE_TYPE],
  remote: (bytes, _type, policy) => {
    const u = pageTarget(bytes, policy ? { policy } : undefined);
    return u === null ? null : { origin: u.origin, label: u.host };
  },
  render: (bytes, ctx) => {
    const diag = diagnosePageTarget(bytes, ctx.policy ? { policy: ctx.policy } : undefined);
    const u = diag.url;
    if (u === null) throw new Error(diag.reason ?? 'not an https: page on another site');
    const href = escapeHtml(u.href);
    if (!ctx.remoteAllowed(u.origin)) {
      if (ctx.policy) logBlockedEmbed(ctx.policy, ctx.node, u.origin, u.host);
      return `<div class="m2-embed m2-embed-pending"><span class="m2-embed-host">🌐 ${escapeHtml(u.host)}</span><span>Embedded page, not loaded.</span><a href="${href}" target="_blank" rel="noopener noreferrer nofollow">${href}</a><span class="m2-load-slot"></span></div>`;
    }
    const title = ctx.node?.resource.attributes.get('title') ?? u.host;
    return `<div class="m2-embed"><iframe class="m2-embed-frame" src="${href}" title="${escapeHtml(title)}" sandbox="${PAGE_SANDBOX}" allow="fullscreen; picture-in-picture" allowfullscreen referrerpolicy="no-referrer" credentialless loading="lazy"></iframe></div>`;
  },
};

/** The handlers every instance starts with. Later handlers for the same type win. */
export function builtinHandlers(): Md2Handler[] {
  return [textHandler, jsonHandler, yamlHandler, imageHandler, tableHandler, wavedromHandler, pageHandler];
}

/** Type essence → handler, for synchronous lookup. Later entries win. */
export function handlerMap(list: readonly Md2Handler[]): Map<string, Md2Handler> {
  const m = new Map<string, Md2Handler>();
  for (const h of list) {
    for (const t of h.types) {
      const e = typeEssence(t);
      if (e !== undefined && e !== '') m.set(e, h);
    }
  }
  return m;
}

/** Adapt handlers to the core registry used by the async pipeline. */
export function coreRegistry(
  list: readonly Md2Handler[],
  remoteAllowed: (node: ResourceNode | undefined, origin: string) => boolean,
  policy?: PermissionPolicy,
): HandlerRegistry {
  const r = new HandlerRegistry([markdownHandler]);
  for (const h of list) {
    r.register({
      types: h.types,
      capabilities: ['view'],
      render: (bytes, ctx) =>
        new Promise<string>((resolve) => {
          resolve(
            h.render(bytes, {
              type: ctx.type,
              ...(ctx.node ? { node: ctx.node } : {}),
              remoteAllowed: (origin) => remoteAllowed(ctx.node, origin),
              ...(policy ? { policy } : {}),
            }),
          );
        }),
    });
  }
  return r;
}