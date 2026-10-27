/**
 * Plotly figures and Vega-Lite specifications, checked as data and never
 * evaluated. DOM-free, so the handlers and the sandbox frames share it.
 *
 * Charts carry their data inline. Anything that would reach the network is
 * refused here, and the frames' CSP and loaders refuse it again.
 */
export const PLOTLY_TYPE = 'application/vnd.plotly.v1+json';
export const VEGALITE_TYPE = 'application/vnd.vegalite.v5+json';

const MAX_SPEC_CHARS = 2_000_000;
const MAX_TRACES = 200;
const MAX_FRAMES = 500;
const MAX_NESTING = 64;
const DEFAULT_HEIGHT = 450;

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `__proto__` stays out of parsed specs, so it can never reach a library's merge code. */
const dropProto = (key: string, value: unknown): unknown => (key === '__proto__' ? undefined : value);

function parseJsonObject(text: string, what: string): Record<string, unknown> {
  if (text.length > MAX_SPEC_CHARS) throw new Error(`${what} is too large`);
  const raw: unknown = JSON.parse(text, dropProto);
  if (!isObject(raw)) throw new Error(`${what} is a JSON object`);
  return raw;
}

// ------------------------------------------------------------------ Plotly

export interface PlotlySpec {
  data: Record<string, unknown>[];
  layout: Record<string, unknown> & { height: number };
  config: Record<string, unknown>;
  frames: Record<string, unknown>[];
}

/** The only config keys a document may set. Everything else (server URLs, tokens, …) is ignored. */
const CONFIG_KEYS = ['staticPlot', 'scrollZoom', 'displayModeBar', 'doubleClick'] as const;

/** Validate a Plotly figure `{ data, layout, config, frames }`. Throws on anything unusable. */
export function parsePlotly(text: string): PlotlySpec {
  const raw = parseJsonObject(text, 'a Plotly figure');
  const data = raw.data;
  if (!Array.isArray(data) || data.length > MAX_TRACES || !data.every(isObject)) {
    throw new Error(`data must be an array of at most ${MAX_TRACES} traces`);
  }
  const layoutIn = raw.layout ?? {};
  if (!isObject(layoutIn)) throw new Error('layout must be an object');
  const layout: Record<string, unknown> = { ...layoutIn };
  delete layout.width; // the chart fills its frame
  const h = layout.height;
  const height = typeof h === 'number' && Number.isFinite(h) ? Math.min(2000, Math.max(150, Math.round(h))) : DEFAULT_HEIGHT;

  const configIn = raw.config ?? {};
  if (!isObject(configIn)) throw new Error('config must be an object');
  const config: Record<string, unknown> = {
    responsive: true,
    displaylogo: false,
    showLink: false,
    showSendToCloud: false,
    showEditInChartStudio: false,
    plotlyServerURL: '',
  };
  for (const k of CONFIG_KEYS) {
    const v = configIn[k];
    if (typeof v === 'boolean' || typeof v === 'string') config[k] = v;
  }

  const frames = Array.isArray(raw.frames) ? raw.frames.filter(isObject).slice(0, MAX_FRAMES) : [];
  return {
    data: data as Record<string, unknown>[],
    layout: { ...layout, autosize: true, height },
    config,
    frames,
  };
}

// ------------------------------------------------------------------ Vega-Lite

const TOP_LEVEL = ['mark', 'layer', 'concat', 'hconcat', 'vconcat', 'facet', 'repeat'];
/** Inline data. Its contents are data, whatever they are called. */
const INLINE_DATA: ReadonlySet<string> = new Set(['values', 'datasets']);
/** Keys that make a spec reach for something outside itself. */
const EXTERNAL_KEYS: ReadonlySet<string> = new Set(['url', 'href']);

function checkInline(v: unknown, depth: number): void {
  if (depth > MAX_NESTING) throw new Error('the specification is nested too deeply');
  if (Array.isArray(v)) {
    for (const x of v) checkInline(x, depth + 1);
    return;
  }
  if (!isObject(v)) return;
  for (const [k, x] of Object.entries(v)) {
    if (INLINE_DATA.has(k)) continue;
    if (EXTERNAL_KEYS.has(k)) {
      throw new Error(`"${k}" is not supported: charts carry their data inline (data.values), and links are not followed`);
    }
    checkInline(x, depth + 1);
  }
}

/** Validate a Vega-Lite specification. Throws on anything unusable. */
export function parseVegaLite(text: string): Record<string, unknown> {
  const spec = parseJsonObject(text, 'a Vega-Lite specification');
  const schema = spec.$schema;
  if (typeof schema === 'string' && /\/schema\/vega\//.test(schema)) {
    throw new Error('this is a Vega specification; only Vega-Lite is supported');
  }
  if (!TOP_LEVEL.some((k) => k in spec)) {
    throw new Error('not a Vega-Lite specification: it needs a mark, layer, concat, facet or repeat');
  }
  checkInline(spec, 0);
  return spec;
}