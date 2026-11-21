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

// ------------------------------------------------------------------ sandboxed rich handlers

export type SandboxFrameKind =
  | 'code'
  | 'mermaid'
  | 'graphviz'
  | 'math'
  | 'gchart'
  | 'x3d'
  | 'map'
  | 'plotly'
  | 'vega'
  | 'tartlet'
  | 'datacalc';

export interface SandboxHandlerOptions {
  /**
   * Base URL where the opaque-origin sandbox pages (`mermaid.html`, `graphviz.html`,
   * `math.html`, `tartlet.html`, `datacalc.html`, `plotly.html`, `vega.html`,
   * `gchart.html`, `map.html`, `x3d.html`, `code.html`) are hosted.
   * Defaults to `../sandbox/` relative to this module (e.g. `/sandbox/` when
   * `markdown2.js` is served from `/lib/markdown2.js`).
   */
  baseUrl?: string;
}

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
const TARTLET_SEED = /^[\w.-]{1,64}$/;
const BASEMAPS: ReadonlySet<string> = new Set(['liberty', 'bright', 'positron']);
const CODE_TYPES: Readonly<Record<string, string>> = {
  'text/javascript': 'javascript',
  'text/css': 'css',
  'application/sql': 'sql',
  'application/xml': 'xml',
  'text/x-python': 'python',
  'application/x-sh': 'shell',
};

const GCHART_ORIGIN = 'https://www.gstatic.com';
const MAP_ORIGIN = 'https://tiles.openfreemap.org';

function defaultSandboxBase(): string {
  try {
    return new URL(/* @vite-ignore */ '../sandbox/', import.meta.url).href;
  } catch {
    return '/sandbox/';
  }
}

function sandboxFrameHtml(base: string, kind: SandboxFrameKind, source: string, title: string, lang?: string): string {
  const normBase = base.endsWith('/') ? base : `${base}/`;
  const srcUrl = `${normBase}${kind}.html`;
  const payload = encodeBase64(new TextEncoder().encode(source));
  const langAttr = lang === undefined ? '' : ` data-m2-lang="${escapeHtml(lang)}"`;
  return `<iframe class="m2-frame" data-m2-frame="${kind}" sandbox="allow-scripts" referrerpolicy="no-referrer" src="${escapeHtml(srcUrl)}" title="${escapeHtml(title)}" data-m2-payload="${payload}"${langAttr}></iframe>`;
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    const r = v as Record<string, unknown>;
    if (typeof r.f === 'string') return r.f;
    if (typeof r.label === 'string') return r.label;
    if ('v' in r) return cellText(r.v);
    return JSON.stringify(v);
  }
  return String(v);
}

function gchartTable(data: readonly unknown[][]): string {
  const [head = [], ...rows] = data;
  const row = (r: readonly unknown[], tag: 'th' | 'td'): string =>
    `<tr>${r.map((c) => `<${tag}>${escapeHtml(cellText(c))}</${tag}>`).join('')}</tr>`;
  return `<table class="m2-chart-data"><thead>${row(head, 'th')}</thead><tbody>${rows
    .slice(0, 50)
    .map((r) => row(r, 'td'))
    .join('')}</tbody></table>`;
}

function parseGchartSpec(bytes: Uint8Array): { chartType: string; data: unknown[][]; options: Record<string, unknown> } {
  const raw: unknown = JSON.parse(strictUtf8(bytes));
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('a chart is a JSON object');
  const r = raw as Record<string, unknown>;
  const chartType = r.chartType;
  if (typeof chartType !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(chartType)) {
    throw new Error('chartType must be a chart name such as "PieChart"');
  }
  const data = r.data;
  if (!Array.isArray(data) || data.length === 0 || !data.every(Array.isArray)) {
    throw new Error('data must be a non-empty array of rows');
  }
  const options = r.options ?? {};
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new Error('options must be an object');
  }
  return { chartType, data: data as unknown[][], options: options as Record<string, unknown> };
}

function parseGeoFeatures(bytes: Uint8Array): { json: Record<string, unknown>; features: { name: string; geometry: string }[] } {
  const raw: unknown = JSON.parse(strictUtf8(bytes));
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('GeoJSON must be an object');
  const obj = raw as Record<string, unknown>;
  const list =
    obj.type === 'FeatureCollection' && Array.isArray(obj.features)
      ? (obj.features as Record<string, unknown>[])
      : obj.type === 'Feature'
        ? [obj]
        : typeof obj.type === 'string'
          ? [{ type: 'Feature', properties: {}, geometry: obj }]
          : null;
  if (list === null) throw new Error('not a valid GeoJSON object');
  const features = list.map((f, i) => {
    const props = (typeof f.properties === 'object' && f.properties !== null ? f.properties : {}) as Record<string, unknown>;
    const geom = (typeof f.geometry === 'object' && f.geometry !== null ? f.geometry : {}) as Record<string, unknown>;
    const name = typeof props.name === 'string' ? props.name : typeof props.title === 'string' ? props.title : `Feature ${i + 1}`;
    const geometry = typeof geom.type === 'string' ? geom.type : 'Unknown';
    return { name, geometry };
  });
  return { json: obj, features };
}

/**
 * Rich, sandboxed handlers matching the Markdown2 reader app:
 * Mermaid, Graphviz, MathJax (TeX & MathML), Tartlet music, DataCalculator,
 * Plotly, Vega-Lite, Google Charts, GeoJSON Maps, X3D 3D scenes and Monaco code.
 *
 * Each renders inside an opaque-origin `sandbox="allow-scripts"` iframe hosted at
 * `options.baseUrl` (default `../sandbox/`). Until a frame reports ready, its
 * escaped source or data summary stays visible.
 */
export function sandboxHandlers(options: SandboxHandlerOptions = {}): Md2Handler[] {
  const base = options.baseUrl ?? defaultSandboxBase();

  const mermaid: Md2Handler = {
    types: ['text/vnd.mermaid'],
    render: (bytes, ctx) => {
      const src = strictUtf8(bytes);
      const title = ctx.node?.resource.attributes.get('title') ?? 'Mermaid diagram';
      return `<div class="m2-frame-host m2-diagram"><pre class="m2-frame-fallback"><code class="language-mermaid">${escapeHtml(src)}</code></pre>${sandboxFrameHtml(base, 'mermaid', src, title)}</div>`;
    },
  };

  const graphviz: Md2Handler = {
    types: ['text/vnd.graphviz'],
    render: (bytes, ctx) => {
      const src = strictUtf8(bytes);
      const layout = ctx.node?.resource.attributes.get('layout');
      const engine = layout !== undefined && GRAPHVIZ_ENGINES.has(layout) ? layout : 'dot';
      const title = ctx.node?.resource.attributes.get('title') ?? 'Graphviz graph';
      return `<div class="m2-frame-host m2-diagram m2-graphviz"><pre class="m2-frame-fallback"><code class="language-dot">${escapeHtml(src)}</code></pre>${sandboxFrameHtml(base, 'graphviz', src, title, engine)}</div>`;
    },
  };

  const math: Md2Handler = {
    types: ['application/x-tex', 'application/mathml+xml'],
    render: (bytes, ctx) => {
      const src = strictUtf8(bytes);
      const kind = ctx.type === 'application/mathml+xml' ? 'mathml' : 'tex';
      const title = ctx.node?.resource.attributes.get('title') ?? 'Mathematics';
      return `<div class="m2-frame-host m2-math-block"><pre class="m2-frame-fallback"><code class="language-${kind}">${escapeHtml(src)}</code></pre>${sandboxFrameHtml(base, 'math', src, title, kind)}</div>`;
    },
  };

  const tartlet: Md2Handler = {
    types: ['text/vnd.tartlet'],
    render: (bytes, ctx) => {
      const src = strictUtf8(bytes);
      const attrs = ctx.node?.resource.attributes;
      const title = attrs?.get('title') ?? 'Tartlet sketch';
      const raw = attrs?.get('tartlet-seed');
      const seed = raw !== undefined && TARTLET_SEED.test(raw) ? raw : undefined;
      return `<div class="m2-frame-host m2-diagram m2-tartlet"><pre class="m2-frame-fallback"><code class="language-tartlet">${escapeHtml(src)}</code></pre>${sandboxFrameHtml(base, 'tartlet', src, title, seed)}</div>`;
    },
  };

  const datacalc: Md2Handler = {
    types: ['text/vnd.datacalc', 'application/vnd.datacalc+json'],
    render: (bytes, ctx) => {
      const src = strictUtf8(bytes);
      const json = ctx.type === 'application/vnd.datacalc+json';
      if (json) {
        const parsed: unknown = JSON.parse(src);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('a DataCalculator JSON workbook is an object');
        }
      }
      const title = ctx.node?.resource.attributes.get('title') ?? 'Calculator';
      return `<div class="m2-frame-host m2-calc"><pre class="m2-frame-fallback"><code class="language-${json ? 'json' : 'datacalc'}">${escapeHtml(src)}</code></pre>${sandboxFrameHtml(base, 'datacalc', src, title, json ? 'json' : 'text')}</div>`;
    },
  };

  const plotly: Md2Handler = {
    types: ['application/vnd.plotly.v1+json'],
    render: (bytes, ctx) => {
      const parsed: unknown = JSON.parse(strictUtf8(bytes));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || !Array.isArray((parsed as Record<string, unknown>).data)) {
        throw new Error('a Plotly figure is a JSON object with a data array');
      }
      const title = ctx.node?.resource.attributes.get('title') ?? 'Plotly chart';
      const pretty = JSON.stringify(parsed, null, 2);
      const shown = pretty.length > 4000 ? `${pretty.slice(0, 4000)}\n…` : pretty;
      return `<div class="m2-frame-host m2-diagram m2-chart m2-plotly"><pre class="m2-frame-fallback"><code class="language-json">${escapeHtml(shown)}</code></pre>${sandboxFrameHtml(base, 'plotly', JSON.stringify(parsed), title)}</div>`;
    },
  };

  const vega: Md2Handler = {
    types: ['application/vnd.vegalite.v5+json'],
    render: (bytes, ctx) => {
      const parsed: unknown = JSON.parse(strictUtf8(bytes));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('a Vega-Lite spec is a JSON object');
      }
      const title = ctx.node?.resource.attributes.get('title') ?? 'Vega-Lite chart';
      const pretty = JSON.stringify(parsed, null, 2);
      const shown = pretty.length > 4000 ? `${pretty.slice(0, 4000)}\n…` : pretty;
      return `<div class="m2-frame-host m2-diagram m2-chart m2-vega"><pre class="m2-frame-fallback"><code class="language-json">${escapeHtml(shown)}</code></pre>${sandboxFrameHtml(base, 'vega', JSON.stringify(parsed), title)}</div>`;
    },
  };

  const gchart: Md2Handler = {
    types: ['application/vnd.google.charts+json'],
    remote: (bytes) => {
      try {
        parseGchartSpec(bytes);
        return { origin: GCHART_ORIGIN, label: 'Google Charts (www.gstatic.com)' };
      } catch {
        return null;
      }
    },
    render: (bytes, ctx) => {
      const spec = parseGchartSpec(bytes);
      const title = ctx.node?.resource.attributes.get('title') ?? spec.chartType;
      const allowed = ctx.remoteAllowed(GCHART_ORIGIN);
      if (!allowed && ctx.policy) logBlockedEmbed(ctx.policy, ctx.node, GCHART_ORIGIN, 'Google Charts (www.gstatic.com)');
      const note = allowed ? 'Drawing with Google Charts…' : 'Google Chart, not loaded. Its data is shown below.';
      const frame = allowed ? sandboxFrameHtml(base, 'gchart', JSON.stringify(spec), title) : '';
      const slot = allowed ? '' : '<span class="m2-load-slot"></span>';
      return `<div class="m2-frame-host m2-gchart"><div class="m2-frame-fallback"><p class="m2-chart-note">${escapeHtml(note)}</p>${slot}${gchartTable(spec.data)}</div>${frame}</div>`;
    },
  };

  const map: Md2Handler = {
    types: ['application/geo+json'],
    remote: (bytes) => {
      try {
        parseGeoFeatures(bytes);
        return { origin: MAP_ORIGIN, label: 'OpenFreeMap (tiles.openfreemap.org)' };
      } catch {
        return null;
      }
    },
    render: (bytes, ctx) => {
      const geo = parseGeoFeatures(bytes);
      const attrs = ctx.node?.resource.attributes;
      const title = attrs?.get('title') ?? 'Map';
      const rawBase = attrs?.get('basemap');
      const basemap = rawBase !== undefined && BASEMAPS.has(rawBase) ? rawBase : 'liberty';
      const allowed = ctx.remoteAllowed(MAP_ORIGIN);
      if (!allowed && ctx.policy) logBlockedEmbed(ctx.policy, ctx.node, MAP_ORIGIN, 'OpenFreeMap (tiles.openfreemap.org)');
      const note = allowed ? 'Drawing the map…' : 'Map, not loaded. Its features are listed below.';
      const frame = allowed ? sandboxFrameHtml(base, 'map', JSON.stringify(geo.json), title, basemap) : '';
      const slot = allowed ? '' : '<span class="m2-load-slot"></span>';
      const rows = geo.features
        .slice(0, 50)
        .map((f, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(f.name)}</td><td>${escapeHtml(f.geometry)}</td></tr>`)
        .join('');
      const summary = `<p class="m2-geo-bounds">${geo.features.length} feature${geo.features.length === 1 ? '' : 's'}</p><table class="m2-geo-data"><thead><tr><th>#</th><th>Name</th><th>Geometry</th></tr></thead><tbody>${rows}</tbody></table>`;
      return `<div class="m2-frame-host m2-geo"><div class="m2-frame-fallback"><p class="m2-chart-note">${escapeHtml(note)}</p>${slot}${summary}</div>${frame}</div>`;
    },
  };

  const x3d: Md2Handler = {
    types: ['model/x3d+xml', 'model/x3d-vrml', 'model/vrml'],
    render: (bytes, ctx) => {
      const src = strictUtf8(bytes);
      const lang = ctx.type === 'model/x3d+xml' ? 'xml' : 'vrml';
      const title = ctx.node?.resource.attributes.get('title') ?? 'X3D scene';
      return `<div class="m2-frame-host m2-x3d"><pre class="m2-frame-fallback"><code class="language-${lang}">${escapeHtml(src)}</code></pre>${sandboxFrameHtml(base, 'x3d', src, title, lang)}</div>`;
    },
  };

  const code: Md2Handler = {
    types: Object.keys(CODE_TYPES),
    render: (bytes, ctx) => {
      const src = strictUtf8(bytes);
      const id = Object.hasOwn(CODE_TYPES, ctx.type) ? (CODE_TYPES[ctx.type] ?? 'plaintext') : 'plaintext';
      return `<pre class="m2-frame-host m2-code"><code class="language-${escapeHtml(id)}"><span class="m2-frame-fallback">${escapeHtml(src)}</span>${sandboxFrameHtml(base, 'code', src, `${id} code`, id)}</code></pre>`;
    },
  };

  return [mermaid, graphviz, math, tartlet, datacalc, plotly, vega, gchart, map, x3d, code];
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