import {
  defaultHandlers,
  encodeBase64,
  escapeHtml,
  typeEssence,
  type CodeFenceRenderer,
  type Handler,
  type HandlerRegistry,
  type ResourceNode,
} from '@markdown2/core';
import { basemapFor, parseGeoJson, type GeoSummary } from './geo.js';

 /* Developer handlers for the PWA:
 *
 * - code: read-only Monaco editor in a sandboxed, opaque-origin frame;
 * - text/vnd.mermaid: Mermaid in a sandboxed frame;
 * - application/x-tex, application/mathml+xml: MathJax to SVG, shown through <img>;
  * - model/x3d+xml, model/x3d-vrml, model/vrml: X3D scenes drawn by X_ITE in a sandboxed frame;
 * - text/uri-list: an embedded web page in a sandboxed frame;
* - application/vnd.google.charts+json: Google Charts in a sandboxed frame;
* - application/geo+json: an interactive map (MapLibre GL JS, OpenFreeMap tiles) in a sandboxed frame.
 *
 * Frames always carry the escaped source as a fallback, which stays visible
 * until the frame reports that it has drawn (offline, blocked or failed).
 *
 * Embedded pages and charts reach the network, so they are drawn only when
 * `remoteAllowed` says so (§5.5: rendering never grants network access).
 */

const MAX_CODE = 200_000;
const MAX_DIAGRAM = 50_000;
const MAX_MATH = 20_000;
const MAX_SCENE = 2_000_000;
const MAX_CHART_BYTES = 200_000;
const MAX_CHART_ROWS = 5000;
const SHOWN_CHART_ROWS = 50;

export type FrameKind = 'code' | 'mermaid' | 'gchart' | 'x3d' | 'map';

/** Fence info-string names → Monaco language ids (basic languages only). */
const LANGS: Readonly<Record<string, string>> = {
  js: 'javascript',
  javascript: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  py: 'python',
  python: 'python',
  sh: 'shell',
  bash: 'shell',
  shell: 'shell',
  zsh: 'shell',
  rs: 'rust',
  rust: 'rust',
  go: 'go',
  golang: 'go',
  java: 'java',
  kt: 'kotlin',
  kotlin: 'kotlin',
  cs: 'csharp',
  csharp: 'csharp',
  c: 'cpp',
  h: 'cpp',
  cpp: 'cpp',
  'c++': 'cpp',
  hpp: 'cpp',
  swift: 'swift',
  rb: 'ruby',
  ruby: 'ruby',
  php: 'php',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  html: 'html',
  xml: 'xml',
  svg: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  markdown: 'markdown',
  dockerfile: 'dockerfile',
  ps1: 'powershell',
  powershell: 'powershell',
  lua: 'lua',
  r: 'r',
  scala: 'scala',
  dart: 'dart',
  graphql: 'graphql',
  ini: 'ini',
  perl: 'perl',
};

/** Declared code media types → Monaco language ids, for code embedded as a resource. */
const CODE_TYPES: Readonly<Record<string, string>> = {
  'text/javascript': 'javascript',
  'text/css': 'css',
  'application/sql': 'sql',
  'application/xml': 'xml',
  'text/x-python': 'python',
  'application/x-sh': 'shell',
};

export function monacoLanguage(lang: string): string | undefined {
  const k = lang.toLowerCase();
  return Object.hasOwn(LANGS, k) ? LANGS[k] : undefined;
}

/** An opaque-origin frame. The source travels as an inert attribute and is posted on request. */
export function frameHtml(kind: FrameKind, source: string, title: string, lang?: string): string {
  const payload = encodeBase64(new TextEncoder().encode(source));
  const langAttr = lang === undefined ? '' : ` data-m2-lang="${escapeHtml(lang)}"`;
  return `<iframe class="m2-frame" data-m2-frame="${kind}" sandbox="allow-scripts" referrerpolicy="no-referrer" src="/sandbox/${kind}.html" title="${escapeHtml(title)}" data-m2-payload="${payload}"${langAttr}></iframe>`;
}

/** Keeps `pre > code.language-x` (style.md §4.1); the editor is drawn inside it. */
function codeHost(lang: string, monacoId: string, body: string): string {
  const cls = lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`;
  return `<pre class="m2-frame-host m2-code"><code${cls}><span class="m2-frame-fallback">${escapeHtml(body)}</span>${frameHtml('code', body, `${lang} code`, monacoId)}</code></pre>`;
}

export const codeFence: CodeFenceRenderer = (lang, body) => {
  const id = monacoLanguage(lang);
  return Promise.resolve(id === undefined || body.length > MAX_CODE ? null : codeHost(lang, id, body));
};

const strictUtf8 = (b: Uint8Array): string => new TextDecoder('utf-8', { fatal: true }).decode(b);

export const codeHandler: Handler = {
  types: Object.keys(CODE_TYPES),
  capabilities: ['view'],
  render: (bytes, ctx) =>
    new Promise<string>((resolve) => {
      // A throw inside the executor rejects: handler-error fallback.
      const src = strictUtf8(bytes);
      if (src.length > MAX_CODE) throw new Error('code too large');
      const id = Object.hasOwn(CODE_TYPES, ctx.type) ? (CODE_TYPES[ctx.type] ?? 'plaintext') : 'plaintext';
      resolve(codeHost(id, id, src));
    }),
};

export const mermaidHandler: Handler = {
  types: ['text/vnd.mermaid'],
  capabilities: ['view'],
  render: (bytes, ctx) =>
    new Promise<string>((resolve) => {
      const src = strictUtf8(bytes);
      if (src.length > MAX_DIAGRAM) throw new Error('diagram too large');
      const title = ctx.node?.resource.attributes.get('title') ?? 'Mermaid diagram';
      resolve(
        `<div class="m2-frame-host m2-diagram"><pre class="m2-frame-fallback"><code class="language-mermaid">${escapeHtml(src)}</code></pre>${frameHtml('mermaid', src, title)}</div>`,
      );
    }),
};


export const X3D_TYPES: readonly string[] = ['model/x3d+xml', 'model/x3d-vrml', 'model/vrml'];
  /* X3D scenes, drawn by X_ITE in an opaque-origin frame (/sandbox/x3d.html).
  * The frame fetches nothing from the web; external references only work as
  * data: URLs. The escaped source stays visible until the scene has drawn.
  */
export const x3dHandler: Handler = {
   types: X3D_TYPES,
   capabilities: ['view'],
   render: (bytes, ctx) =>
     new Promise<string>((resolve) => {
       // A throw inside the executor rejects: handler-error fallback.
       const src = strictUtf8(bytes);
       if (src.length > MAX_SCENE) throw new Error('scene too large');
       const lang = ctx.type === 'model/x3d+xml' ? 'xml' : 'vrml';
       const title = ctx.node?.resource.attributes.get('title') ?? 'X3D scene';
       resolve(
         `<div class="m2-frame-host m2-x3d"><pre class="m2-frame-fallback"><code class="language-${lang}">${escapeHtml(src)}</code></pre>${frameHtml('x3d', src, title, lang)}</div>`,
       );
     }),
};

// ------------------------------------------------------------------ remote views

export interface PwaHandlerOptions {
  /**
   * Whether a resource may load content from `origin`. Default: never.
   * The PWA answers from per-resource grants and the user's origin list.
   */
  remoteAllowed?: (node: ResourceNode | undefined, origin: string) => boolean;
  /** The app's own origin. Pages from it are never framed: scripts there could reach the app. */
  appOrigin?: string;
}

export const PAGE_TYPE = 'text/uri-list';
export const GCHART_TYPE = 'application/vnd.google.charts+json';
export const GCHART_ORIGIN = 'https://www.gstatic.com';
export const GEOJSON_TYPE = 'application/geo+json';
/** OpenFreeMap serves styles, tiles, glyphs and sprites from this one origin. */
export const MAP_ORIGIN = 'https://tiles.openfreemap.org';
const MAX_GEOJSON_BYTES = 5_000_000;
const SHOWN_FEATURES = 50;

/** Sandbox for embedded pages. No top navigation, so a page can never replace the app. */
const PAGE_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-presentation';

/** The page an embed points at: the first non-comment line, `https:` only, never the app itself. */
export function pageTarget(bytes: Uint8Array, appOrigin?: string): URL | null {
  let text: string;
  try {
    text = strictUtf8(bytes);
  } catch {
    return null;
  }
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l !== '' && !l.startsWith('#'));
  if (line === undefined) return null;
  let u: URL;
  try {
    u = new URL(line);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '') return null;
  if (appOrigin !== undefined && u.origin === appOrigin) return null;
  return u;
}

export interface ChartSpec {
  chartType: string;
  data: unknown[][];
  options: Record<string, unknown>;
}

/** Validate a Google Charts description. Throws on anything unusable. */
export function parseChart(bytes: Uint8Array): ChartSpec {
  if (bytes.length > MAX_CHART_BYTES) throw new Error('chart too large');
  const raw: unknown = JSON.parse(strictUtf8(bytes));
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('a chart is a JSON object');
  const r = raw as Record<string, unknown>;
  const chartType = r.chartType;
  if (typeof chartType !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(chartType)) {
    throw new Error('chartType must be a chart name such as "PieChart"');
  }
  const data = r.data;
  if (!Array.isArray(data) || data.length === 0 || data.length > MAX_CHART_ROWS || !data.every(Array.isArray)) {
    throw new Error('data must be a non-empty array of rows');
  }
  const options = r.options ?? {};
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new Error('options must be an object');
  }
  return { chartType, data: data as unknown[][], options: options as Record<string, unknown> };
}

export interface RemoteNeed {
  /** Origin the view would contact. */
  origin: string;
  /** Human-readable name for prompts. */
  label: string;
}

/** What a decoded resource's view needs from the network, if anything. */
export function remoteNeed(type: string | undefined, bytes: Uint8Array, appOrigin?: string): RemoteNeed | null {
  const t = typeEssence(type);
  if (t === PAGE_TYPE) {
    const u = pageTarget(bytes, appOrigin);
    return u === null ? null : { origin: u.origin, label: u.host };
  }
  if (t === GCHART_TYPE) {
    try {
      parseChart(bytes);
      return { origin: GCHART_ORIGIN, label: 'Google Charts (www.gstatic.com)' };
    } catch {
      return null;
    }
  }
  if (t === GEOJSON_TYPE) {
    try {
      parseGeo(bytes);
      return { origin: MAP_ORIGIN, label: 'OpenFreeMap (tiles.openfreemap.org)' };
    } catch {
      return null;
    }
  }
  return null;
}

function pageHandler(o: PwaHandlerOptions): Handler {
  return {
    types: [PAGE_TYPE],
    capabilities: ['view'],
    render: (bytes, ctx) =>
      new Promise<string>((resolve) => {
        const u = pageTarget(bytes, o.appOrigin);
        if (u === null) throw new Error('not an https: page on another site');
        const title = ctx.node?.resource.attributes.get('title') ?? u.host;
        const href = escapeHtml(u.href);
        if (!(o.remoteAllowed?.(ctx.node, u.origin) ?? false)) {
          resolve(
            `<div class="m2-embed m2-embed-pending"><span class="m2-embed-host">🌐 ${escapeHtml(u.host)}</span><span>Embedded page, not loaded.</span><a href="${href}" target="_blank" rel="noopener noreferrer nofollow">${href}</a><span class="m2-load-slot"></span></div>`,
          );
          return;
        }
        resolve(
          `<div class="m2-embed"><iframe class="m2-embed-frame" src="${href}" title="${escapeHtml(title)}" sandbox="${PAGE_SANDBOX}" allow="fullscreen; picture-in-picture" allowfullscreen referrerpolicy="no-referrer" credentialless loading="lazy"></iframe></div>`,
        );
      }),
  };
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

/** The chart's data as a plain table: shown until the chart draws, and whenever it cannot. */
function dataTable(data: readonly unknown[][]): string {
  const [head = [], ...rows] = data;
  const row = (r: readonly unknown[], tag: 'th' | 'td'): string =>
    `<tr>${r.map((c) => `<${tag}>${escapeHtml(cellText(c))}</${tag}>`).join('')}</tr>`;
  const more =
    rows.length > SHOWN_CHART_ROWS
      ? `<tr><td colspan="${Math.max(1, head.length)}">… ${rows.length - SHOWN_CHART_ROWS} more rows</td></tr>`
      : '';
  return `<table class="m2-chart-data"><thead>${row(head, 'th')}</thead><tbody>${rows
    .slice(0, SHOWN_CHART_ROWS)
    .map((r) => row(r, 'td'))
    .join('')}${more}</tbody></table>`;
}

function chartHandler(o: PwaHandlerOptions): Handler {
  return {
    types: [GCHART_TYPE],
    capabilities: ['view'],
    render: (bytes, ctx) =>
      new Promise<string>((resolve) => {
        const spec = parseChart(bytes);
        const title = ctx.node?.resource.attributes.get('title') ?? spec.chartType;
        const allowed = o.remoteAllowed?.(ctx.node, GCHART_ORIGIN) ?? false;
        const note = allowed
          ? 'Drawing with Google Charts…'
          : 'Google Chart, not loaded. Its data is shown below.';
        const frame = allowed ? frameHtml('gchart', JSON.stringify(spec), title) : '';
        const slot = allowed ? '' : '<span class="m2-load-slot"></span>';
        resolve(
          `<div class="m2-frame-host m2-gchart"><div class="m2-frame-fallback"><p class="m2-chart-note">${escapeHtml(note)}</p>${slot}${dataTable(spec.data)}</div>${frame}</div>`,
        );
      }),
  };
}
// ------------------------------------------------------------------ maps
/** Validate GeoJSON bytes. Throws on anything unusable. */
export function parseGeo(bytes: Uint8Array): GeoSummary {
  if (bytes.length > MAX_GEOJSON_BYTES) throw new Error('GeoJSON too large');
  return parseGeoJson(strictUtf8(bytes));
}
/** What the map holds, as escaped text: shown until the map draws, and whenever it cannot. */
function geoSummaryHtml(geo: GeoSummary): string {
  const n = geo.features.length;
  const b = geo.bounds;
  const where =
    b === null
      ? ''
      : ` · west ${b[0].toFixed(4)}, south ${b[1].toFixed(4)}, east ${b[2].toFixed(4)}, north ${b[3].toFixed(4)}`;
  const rows = geo.features
    .slice(0, SHOWN_FEATURES)
    .map((f, k) => `<tr><td>${k + 1}</td><td>${escapeHtml(f.name)}</td><td>${escapeHtml(f.geometry)}</td></tr>`)
    .join('');
  const more = n > SHOWN_FEATURES ? `<tr><td colspan="3">… ${n - SHOWN_FEATURES} more features</td></tr>` : '';
  return `<p class="m2-geo-bounds">${n} feature${n === 1 ? '' : 's'}${where}</p><table class="m2-geo-data"><thead><tr><th>#</th><th>Name</th><th>Geometry</th></tr></thead><tbody>${rows}${more}</tbody></table>`;
}
function mapHandler(o: PwaHandlerOptions): Handler {
  return {
    types: [GEOJSON_TYPE],
    capabilities: ['view'],
    render: (bytes, ctx) =>
      new Promise<string>((resolve) => {
        // A throw inside the executor rejects: handler-error fallback.
        const geo = parseGeo(bytes);
        const attrs = ctx.node?.resource.attributes;
        const title = attrs?.get('title') ?? 'Map';
        const basemap = basemapFor(attrs?.get('basemap'));
        const allowed = o.remoteAllowed?.(ctx.node, MAP_ORIGIN) ?? false;
        const note = allowed ? 'Drawing the map…' : 'Map, not loaded. Its features are listed below.';
        const frame = allowed ? frameHtml('map', JSON.stringify(geo.json), title, basemap) : '';
        const slot = allowed ? '' : '<span class="m2-load-slot"></span>';
        resolve(
          `<div class="m2-frame-host m2-geo"><div class="m2-frame-fallback"><p class="m2-chart-note">${escapeHtml(note)}</p>${slot}${geoSummaryHtml(geo)}</div>${frame}</div>`,
        );
      }),
  };
}


export function createHandlers(o: PwaHandlerOptions = {}): HandlerRegistry {
  const r = defaultHandlers();
  for (const h of [codeHandler, mermaidHandler, x3dHandler, pageHandler(o), chartHandler(o), mapHandler(o)]) {
    r.register(h);
  }
  return r;
}