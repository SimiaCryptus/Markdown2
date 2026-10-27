import maplibregl, { type ExpressionSpecification, type FilterSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoJSON } from 'geojson';
import { basemapFor, parseGeoJson } from '../geo.js';
import { serve } from './frame.js';

/**
 * GeoJSON on an interactive map: MapLibre GL JS over OpenFreeMap tiles.
 * Runs in an opaque-origin frame whose CSP allows only tiles.openfreemap.org.
 * Feature properties are shown as text, never as HTML.
 */
const TILES = 'https://tiles.openfreemap.org/styles/';
const HEIGHT = 420;
const TEAL = '#0f6b5f';
const GOLD = '#b0802a';
const LAYERS = ['m2-point', 'm2-line', 'm2-fill'];
/** simplestyle-spec keys: presentation, not content. */
const STYLE_KEYS = new Set([
  'marker-color',
  'marker-size',
  'marker-symbol',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'fill',
  'fill-opacity',
]);

const isGeometry = (...types: string[]): FilterSpecification =>
  ['match', ['geometry-type'], types, true, false] as FilterSpecification;
const color = (key: string, fallback: string): ExpressionSpecification =>
  ['to-color', ['get', key], fallback] as ExpressionSpecification;
const number = (key: string, fallback: number): ExpressionSpecification =>
  ['to-number', ['get', key], fallback] as ExpressionSpecification;

function popupContent(props: Record<string, unknown> | null): HTMLElement {
  const box = document.createElement('div');
  box.style.cssText = 'font: 13px/1.4 system-ui, sans-serif; max-width: 16rem; overflow-wrap: anywhere';
  const p = props ?? {};
  const name = p.name ?? p.title;
  if (name !== undefined && name !== null) {
    const b = document.createElement('strong');
    b.textContent = String(name);
    box.append(b);
  }
  let shown = 0;
  for (const [k, v] of Object.entries(p)) {
    if (k === 'name' || k === 'title' || STYLE_KEYS.has(k)) continue;
    if (++shown > 12) break;
    const row = document.createElement('div');
    row.textContent = `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`;
    box.append(row);
  }
  return box;
}

serve(async ({ source, lang }, root) => {
  const geo = parseGeoJson(source);
  root.style.height = `${HEIGHT}px`;
  const map = new maplibregl.Map({
    container: root,
    style: `${TILES}${basemapFor(lang)}`,
    center: [0, 20],
    zoom: 1,
    cooperativeGestures: true, // the page keeps scrolling; Ctrl/⌘ + scroll zooms
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');

  await new Promise<void>((resolve, reject) => {
    const onError = (e: { error: Error; sourceId?: string }): void => {
      if (e.sourceId !== undefined) return; // a missing tile is not fatal
      reject(e.error);
    };
    map.once('load', () => {
      map.off('error', onError);
      resolve();
    });
    map.on('error', onError);
  });

  map.addSource('m2', { type: 'geojson', data: geo.json as unknown as GeoJSON });
  map.addLayer({
    id: 'm2-fill',
    type: 'fill',
    source: 'm2',
    filter: isGeometry('Polygon', 'MultiPolygon'),
    paint: { 'fill-color': color('fill', TEAL), 'fill-opacity': number('fill-opacity', 0.25) },
  });
  map.addLayer({
    id: 'm2-line',
    type: 'line',
    source: 'm2',
    filter: isGeometry('LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'),
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': color('stroke', TEAL),
      'line-width': number('stroke-width', 3),
      'line-opacity': number('stroke-opacity', 1),
    },
  });
  map.addLayer({
    id: 'm2-point',
    type: 'circle',
    source: 'm2',
    filter: isGeometry('Point', 'MultiPoint'),
    paint: {
      'circle-color': color('marker-color', GOLD),
      'circle-radius': 7,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  });

  map.on('click', (e) => {
    const [f] = map.queryRenderedFeatures(e.point, { layers: LAYERS });
    if (!f) return;
    new maplibregl.Popup({ closeButton: true, maxWidth: '18rem' })
      .setLngLat(e.lngLat)
      .setDOMContent(popupContent(f.properties as Record<string, unknown> | null))
      .addTo(map);
  });
  map.on('mousemove', (e) => {
    const hit = map.queryRenderedFeatures(e.point, { layers: LAYERS }).length > 0;
    map.getCanvas().style.cursor = hit ? 'pointer' : '';
  });

  const b = geo.bounds;
  if (b !== null) {
    const [w, s, e, n] = b;
    if (w === e && s === n) map.jumpTo({ center: [w, s], zoom: 13 });
    else map.fitBounds([[w, s], [e, n]], { padding: 40, maxZoom: 15, duration: 0 });
  }
});