import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GrantSet } from '@markdown2/core';
import { describe, expect, it } from 'vitest';
import { PLOTLY_TYPE, VEGALITE_TYPE, parsePlotly, parseVegaLite } from '../src/charts.js';
import { createRegistry } from '../src/decoders.js';
import { codeFence, createHandlers, remoteNeed } from '../src/handlers.js';
import { runPipeline } from '../src/pipeline.js';

const handlers = createHandlers();
const run = (src: string) =>
  runPipeline(src, { registry: createRegistry(), grants: new GrantSet(), handlers, codeFence });
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

const figure = '{"data":[{"type":"bar","name":"<b>x</b>","x":["a"],"y":[1]}],"layout":{"title":{"text":"T"}}}';
const bars = '{"data":{"values":[{"a":"A","b":1}]},"mark":"bar","encoding":{"x":{"field":"a","type":"nominal"}}}';

describe('Plotly figures', () => {
  it('normalise layout and allowlist config', () => {
    const s = parsePlotly(
      '{"data":[{"type":"bar"}],"layout":{"width":900,"height":9999},"config":{"scrollZoom":true,"plotlyServerURL":"https://evil.example","topojsonURL":"https://evil.example"}}',
    );
    expect(s.layout).toMatchObject({ height: 2000, autosize: true });
    expect(s.layout).not.toHaveProperty('width');
    expect(s.config).toMatchObject({ scrollZoom: true, plotlyServerURL: '', displaylogo: false });
    expect(s.config).not.toHaveProperty('topojsonURL');
    expect(parsePlotly('{"data":[]}').layout.height).toBe(450);
  });
  it('drops __proto__ keys', () => {
    const s = parsePlotly('{"data":[],"layout":{"__proto__":{"polluted":1},"title":"t"}}');
    expect(Object.hasOwn(s.layout, '__proto__')).toBe(false);
    expect(s.layout.title).toBe('t');
  });
  it('reject anything that is not a figure', () => {
    for (const bad of ['[]', '{}', '{"data":{}}', '{"data":[1]}', '{"data":[],"layout":[]}', 'not json']) {
      expect(() => parsePlotly(bad), bad).toThrow();
    }
    const many = JSON.stringify({ data: Array.from({ length: 201 }, () => ({ type: 'scatter' })) });
    expect(() => parsePlotly(many)).toThrow(/at most/);
  });
});

describe('Vega-Lite specifications', () => {
  it('accept inline data, even a field called url', () => {
    expect(parseVegaLite(bars).mark).toBe('bar');
    expect(() => parseVegaLite('{"mark":"point","data":{"values":[{"url":"fine","href":"also fine"}]}}')).not.toThrow();
    expect(() => parseVegaLite('{"datasets":{"d":[{"url":1}]},"data":{"name":"d"},"mark":"bar"}')).not.toThrow();
  });
  it('refuse anything that reaches outside the spec', () => {
    for (const bad of [
      '{"mark":"bar","data":{"url":"https://x.example/d.json"}}',
      '{"mark":{"type":"image","url":"https://x.example/i.png"}}',
      '{"layer":[{"mark":"bar","data":{"url":"data.csv"}}]}',
      '{"mark":"point","encoding":{"href":{"field":"link"}}}',
    ]) {
      expect(() => parseVegaLite(bad), bad).toThrow(/inline/);
    }
  });
  it('refuse non-Vega-Lite input', () => {
    expect(() => parseVegaLite('[]')).toThrow();
    expect(() => parseVegaLite('{}')).toThrow(/not a Vega-Lite/);
    expect(() => parseVegaLite('{"$schema":"https://vega.github.io/schema/vega/v5.json","mark":"bar"}')).toThrow(/Vega/);
  });
  it('drop __proto__ keys', () => {
    const s = parseVegaLite('{"mark":"bar","__proto__":{"polluted":1}}');
    expect(Object.hasOwn(s, '__proto__')).toBe(false);
  });
});

describe('chart handlers', () => {
  it('Plotly resources become sandboxed frames with an escaped source fallback', async () => {
    const { html } = await run(`<<<P type="${PLOTLY_TYPE}" title="Bars"\n${figure}\nP\n`);
    expect(html).toContain('data-m2-frame="plotly"');
    expect(html).toContain('src="/sandbox/plotly.html"');
    expect(html).toContain('title="Bars"');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain('allow-same-origin');
    expect(html).not.toContain('<b>x</b>');
  });
  it('Vega-Lite resources become sandboxed frames', async () => {
    const { html } = await run(`<<<V type="${VEGALITE_TYPE}"\n${bars}\nV\n`);
    expect(html).toContain('data-m2-frame="vega"');
    expect(html).toContain('src="/sandbox/vega.html"');
    expect(html).not.toContain('allow-same-origin');
  });
  it('need no network, so nothing waits for permission', () => {
    expect(remoteNeed(PLOTLY_TYPE, enc(figure))).toBeNull();
    expect(remoteNeed(VEGALITE_TYPE, enc(bars))).toBeNull();
  });
  it('fences are compatibility aliases', async () => {
    expect((await run(`\`\`\`plotly\n${figure}\n\`\`\`\n`)).html).toContain('data-m2-frame="plotly"');
    expect((await run(`\`\`\`vega-lite\n${bars}\n\`\`\`\n`)).html).toContain('data-m2-frame="vega"');
    expect((await run(`\`\`\`vegalite\n${bars}\n\`\`\`\n`)).html).toContain('data-m2-frame="vega"');
  });
  it('invalid charts are handler errors; invalid fences stay code', async () => {
    const external = '{"mark":"bar","data":{"url":"https://x.example/d.json"}}';
    expect((await run(`<<<V type="${VEGALITE_TYPE}"\n${external}\nV\n`)).html).toContain('handler-error');
    expect((await run(`<<<P type="${PLOTLY_TYPE}"\n{"data":3}\nP\n`)).html).toContain('handler-error');
    expect((await run(`<<<P type="${PLOTLY_TYPE}" encoding="base64"\n/w==\nP\n`)).html).toContain('handler-error');
    const fence = (await run('```plotly\n{"data":3}\n```\n')).html;
    expect(fence).toContain('<code class="language-plotly">');
    expect(fence).not.toContain('data-m2-frame');
  });
});

describe('charts help page', () => {
  it('demonstrates resources and fences for both libraries', async () => {
    const page = readFileSync(fileURLToPath(new URL('../public/docs/charts.md', import.meta.url)), 'utf8');
    const { html, diagnostics } = await run(page);
    expect(html.match(/data-m2-frame="plotly"/g)?.length ?? 0).toBe(4);
    expect(html.match(/data-m2-frame="vega"/g)?.length ?? 0).toBe(4);
    expect(html).not.toContain('handler-error');
    expect(html).not.toContain('allow-same-origin');
    expect(diagnostics.filter((d) => d.code !== 'stylesheet-not-css')).toEqual([]);
  });
});