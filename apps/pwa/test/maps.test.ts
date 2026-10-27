import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GrantSet } from '@markdown2/core';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../src/decoders.js';
import { basemapFor, parseGeoJson } from '../src/geo.js';
import { codeFence, createHandlers, MAP_ORIGIN, remoteNeed } from '../src/handlers.js';
import { runPipeline } from '../src/pipeline.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const run = (src: string, handlers = createHandlers()) =>
  runPipeline(src, { registry: createRegistry(), grants: new GrantSet(), handlers, codeFence });

const walk = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: '<b>Pier</b>' }, geometry: { type: 'Point', coordinates: [-0.01, 51.48] } },
    {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: [[-0.01, 51.48], [0.02, 51.47]] },
    },
  ],
});

describe('GeoJSON parsing', () => {
  it('summarises features and bounds', () => {
    const g = parseGeoJson(walk);
    expect(g.features).toEqual([
      { name: '<b>Pier</b>', geometry: 'Point' },
      { name: '', geometry: 'LineString' },
    ]);
    expect(g.bounds).toEqual([-0.01, 51.47, 0.02, 51.48]);
    expect(parseGeoJson('{"type":"Point","coordinates":[1,2]}').bounds).toEqual([1, 2, 1, 2]);
  });
  it('rejects anything that is not GeoJSON', () => {
    for (const bad of ['[]', '{"type":"Circle"}', '{"type":"Point","coordinates":[200,0]}', '{"type":"FeatureCollection"}']) {
      expect(() => parseGeoJson(bad), bad).toThrow();
    }
  });
  it('picks known basemaps only', () => {
    expect(basemapFor('Positron')).toBe('positron');
    expect(basemapFor('../evil')).toBe('liberty');
    expect(basemapFor(undefined)).toBe('liberty');
  });
});

describe('map handler', () => {
  const src = `<<<M type="application/geo+json" basemap="positron" title="Walk"\n${walk}\nM\n`;
  it('lists escaped features until allowed', async () => {
    const { html } = await run(src);
    expect(html).toContain('m2-geo');
    expect(html).toContain('&lt;b&gt;Pier&lt;/b&gt;');
    expect(html).toContain('2 features');
    expect(html).not.toContain('data-m2-frame="map"');
    expect(remoteNeed('application/geo+json', enc(walk))?.origin).toBe(MAP_ORIGIN);
  });
  it('draws in an opaque-origin frame once allowed', async () => {
    const allowed = createHandlers({ remoteAllowed: (_n, origin) => origin === MAP_ORIGIN });
    const { html } = await run(src, allowed);
    expect(html).toContain('data-m2-frame="map"');
    expect(html).toContain('src="/sandbox/map.html"');
    expect(html).toContain('data-m2-lang="positron"');
    expect(html).not.toContain('allow-same-origin');
  });
  it('fences are compatibility aliases; invalid data is a handler error', async () => {
    expect((await run('```geojson\n{"type":"Point","coordinates":[0,51.5]}\n```\n')).html).toContain('m2-geo');
    expect((await run('<<<M type="application/geo+json"\n{"type":"Nope"}\nM\n')).html).toContain('handler-error');
  });
});

describe('maps help page', () => {
  it('demonstrates resources, a basemap and a fence', async () => {
    const page = readFileSync(fileURLToPath(new URL('../public/docs/maps.md', import.meta.url)), 'utf8');
    const { html } = await run(page);
    expect(html.match(/m2-frame-host m2-geo/g)?.length ?? 0).toBe(3);
    expect(html).not.toContain('handler-error');
    expect(html).not.toContain('data-m2-frame="map"');
  });
});