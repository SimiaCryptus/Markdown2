/**
 * GeoJSON (RFC 7946), checked as data and never evaluated. DOM-free, so the
 * renderer and the map frame share it.
 */
export type Bounds = readonly [west: number, south: number, east: number, north: number];

export interface GeoFeature {
  /** `properties.name`, `properties.title` or the feature id; may be empty. */
  name: string;
  /** Geometry type, or `none` for a feature without geometry. */
  geometry: string;
}

export interface GeoSummary {
  json: Record<string, unknown>;
  features: GeoFeature[];
  bounds: Bounds | null;
}

export const MAX_GEO_FEATURES = 10_000;

/** OpenFreeMap styles a document may pick with `basemap="…"`. */
export const BASEMAPS: readonly string[] = ['liberty', 'bright', 'positron'];

export function basemapFor(v: string | undefined): string {
  const k = v?.trim().toLowerCase();
  return k !== undefined && BASEMAPS.includes(k) ? k : 'liberty';
}

const GEOMETRY: ReadonlySet<string> = new Set([
  'Point',
  'MultiPoint',
  'LineString',
  'MultiLineString',
  'Polygon',
  'MultiPolygon',
  'GeometryCollection',
]);
/** MultiPolygon is the deepest: polygons > rings > positions. */
const MAX_DEPTH = 4;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function label(f: Record<string, unknown>): string {
  const p = f.properties;
  if (isObject(p)) {
    for (const k of ['name', 'title']) {
      const v = p[k];
      if (typeof v === 'string' && v.trim() !== '') return v.trim();
      if (typeof v === 'number') return String(v);
    }
  }
  const id = f.id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : '';
}

/** Validate GeoJSON and summarise it. Throws on anything that is not GeoJSON. */
export function parseGeoJson(text: string): GeoSummary {
  const json: unknown = JSON.parse(text);
  if (!isObject(json)) throw new Error('GeoJSON is a JSON object');
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  const coords = (c: unknown, depth: number): void => {
    if (!Array.isArray(c)) throw new Error('coordinates must be arrays');
    if (typeof c[0] === 'number') {
      const [x, y] = c as unknown[];
      if (
        typeof x !== 'number' ||
        typeof y !== 'number' ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < -180 ||
        x > 180 ||
        y < -90 ||
        y > 90
      ) {
        throw new Error('a position is [longitude, latitude] in degrees');
      }
      west = Math.min(west, x);
      east = Math.max(east, x);
      south = Math.min(south, y);
      north = Math.max(north, y);
      return;
    }
    if (depth >= MAX_DEPTH) throw new Error('coordinates are nested too deeply');
    for (const p of c) coords(p, depth + 1);
  };

  const geometry = (g: unknown, depth: number): string => {
    if (g === null || g === undefined) return 'none';
    if (!isObject(g) || typeof g.type !== 'string' || !GEOMETRY.has(g.type)) {
      throw new Error('not a GeoJSON geometry');
    }
    if (g.type === 'GeometryCollection') {
      if (!Array.isArray(g.geometries) || depth > 2) throw new Error('invalid GeometryCollection');
      for (const x of g.geometries) geometry(x, depth + 1);
    } else {
      coords(g.coordinates, 0);
    }
    return g.type;
  };

  const features: GeoFeature[] = [];
  const feature = (f: unknown): void => {
    if (!isObject(f) || f.type !== 'Feature') throw new Error('features must be GeoJSON Features');
    features.push({ name: label(f), geometry: geometry(f.geometry, 0) });
  };

  if (json.type === 'FeatureCollection') {
    if (!Array.isArray(json.features)) throw new Error('a FeatureCollection has a features array');
    if (json.features.length > MAX_GEO_FEATURES) throw new Error(`more than ${MAX_GEO_FEATURES} features`);
    for (const f of json.features) feature(f);
  } else if (json.type === 'Feature') {
    feature(json);
  } else {
    features.push({ name: '', geometry: geometry(json, 0) });
  }

  const bounds: Bounds | null = west <= east ? [west, south, east, north] : null;
  return { json, features, bounds };
}