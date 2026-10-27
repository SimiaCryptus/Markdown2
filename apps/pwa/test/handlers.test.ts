import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GrantSet } from '@markdown2/core';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../src/decoders.js';
import {
  GCHART_ORIGIN,
  codeFence,
  createHandlers,
  monacoLanguage,
  pageTarget,
  remoteNeed,
   x3dHandler,
} from '../src/handlers.js';
import { runPipeline } from '../src/pipeline.js';

const handlers = createHandlers();
const run = (src: string) =>
  runPipeline(src, { registry: createRegistry(), grants: new GrantSet(), handlers, codeFence });
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

const svgsIn = (html: string): string[] =>
  [...html.matchAll(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g)].map((m) => atob(m[1] ?? ''));

describe('code blocks (Monaco)', () => {
  it('maps info strings to languages', () => {
    expect(monacoLanguage('TS')).toBe('typescript');
    expect(monacoLanguage('bash')).toBe('shell');
    expect(monacoLanguage('constructor')).toBeUndefined();
  });
  it('keeps pre > code, escapes the fallback and sandboxes the frame', async () => {
    const { html } = await run('```ts\nconst a = "<b>";\n```\n');
    expect(html).toContain('<pre class="m2-frame-host m2-code"><code class="language-ts">');
    expect(html).toContain('const a = &quot;&lt;b&gt;&quot;;');
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain('allow-same-origin');
    expect(html).toContain('data-m2-lang="typescript"');
  });
  it('unknown languages stay plain code', async () => {
    expect((await run('```klingon\nx\n```\n')).html).toContain('<pre><code class="language-klingon">x</code></pre>');
  });
  it('code resources get the same view', async () => {
    const { html } = await run('<<<J type="text/javascript"\nlet x = 1;\nJ\n');
    expect(html).toContain('data-m2-lang="javascript"');
  });
});

describe('Mermaid', () => {
  it('fences and resources become sandboxed frames with a source fallback', async () => {
    const fence = (await run('```mermaid\ngraph TD\n  A-->B\n```\n')).html;
    expect(fence).toContain('src="/sandbox/mermaid.html"');
    expect(fence).toContain('A--&gt;B');
    const res = (await run('<<<D type="text/vnd.mermaid" title="Flow"\ngraph TD\nD\n')).html;
    expect(res).toContain('data-m2-frame="mermaid"');
    expect(res).toContain('title="Flow"');
  });
  it('invalid UTF-8 is a handler error', async () => {
    expect((await run('<<<D type="text/vnd.mermaid" encoding="base64"\n/w==\nD\n')).html).toContain('handler-error');
  });
});

describe('MathJax', () => {
  it('renders TeX and MathML to SVG shown through <img>', async () => {
    const tex = await run('```math\n\\frac{a}{b}\n```\n');
    const mml = await run('<<<M type="application/mathml+xml"\n<math><mi>x</mi></math>\nM\n');
    for (const { html } of [tex, mml]) {
      expect(html).toContain('<img class="m2-math"');
      const [svg] = svgsIn(html);
      expect(svg).toMatch(/^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      expect(svg).not.toContain('<script');
    }
  });
});

describe('developer docs page', () => {
   it('demonstrates code, diagrams, graphs, timing diagrams, maths and 3D scenes', async () => {
    const src = readFileSync(fileURLToPath(new URL('../public/docs/developer.md', import.meta.url)), 'utf8');
    const { html } = await run(src);
    expect(html).toContain('data-m2-frame="code"');
    expect(html).toContain('data-m2-frame="mermaid"');
     expect(html).toContain('data-m2-frame="x3d"');
    // Graphviz: both fence names and a resource with a non-default engine.
    expect(html.match(/data-m2-frame="graphviz"/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(html).toContain('data-m2-lang="neato"');
    // WaveDrom: a timing diagram fence and a register resource, both rendered (no handler-error).
    expect(html.match(/<img class="m2-wavedrom"/g)?.length ?? 0).toBe(2);
    expect(html).not.toContain('handler-error');
    // Maths (4) and WaveDrom (2) are inline SVG images.
    expect(svgsIn(html).length).toBeGreaterThanOrEqual(6);
  });
});
describe('X3D', () => {
   it('resources and fences become sandboxed frames with an escaped source fallback', async () => {
     const res = (await run('<<<S type="model/x3d+xml" title="Scene"\n<X3D><Scene/></X3D>\nS\n')).html;
     expect(res).toContain('data-m2-frame="x3d"');
     expect(res).toContain('src="/sandbox/x3d.html"');
     expect(res).toContain('&lt;X3D&gt;&lt;Scene/&gt;&lt;/X3D&gt;');
     expect(res).toContain('sandbox="allow-scripts"');
     expect(res).not.toContain('allow-same-origin');
     expect((await run('```x3d\n<X3D/>\n```\n')).html).toContain('data-m2-frame="x3d"');
     const vrml = (await run('<<<V type="model/x3d-vrml"\n#X3D V4.0 utf8\nShape {}\nV\n')).html;
     expect(vrml).toContain('data-m2-lang="vrml"');
     expect(x3dHandler.types).toContain('model/vrml');
   });
   it('invalid UTF-8 is a handler error', async () => {
     expect((await run('<<<S type="model/x3d+xml" encoding="base64"\n/w==\nS\n')).html).toContain('handler-error');
   });
});
describe('embedded pages', () => {
  const src = '<<<P type="text/uri-list" title="Map"\n# a comment\nhttps://maps.example/embed?x=1\nP\n';
  it('stay unloaded until allowed', async () => {
    const { html } = await run(src);
    expect(html).toContain('m2-embed-pending');
    expect(html).not.toContain('<iframe');
  });
  it('frame the page once allowed, sandboxed and without top navigation', async () => {
    const allowed = createHandlers({ remoteAllowed: () => true, appOrigin: 'https://md2.example' });
    const { html } = await runPipeline(src, { registry: createRegistry(), grants: new GrantSet(), handlers: allowed });
    expect(html).toContain('src="https://maps.example/embed?x=1"');
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"');
    expect(html).not.toContain('allow-top-navigation');
  });
  it('accept only https pages on other sites', () => {
    expect(pageTarget(enc('http://x.example/'))).toBeNull();
    expect(pageTarget(enc('https://md2.example/x'), 'https://md2.example')).toBeNull();
    expect(pageTarget(enc('https://u:p@x.example/'))).toBeNull();
    expect(pageTarget(enc('# only a comment\n'))).toBeNull();
    expect(remoteNeed('text/uri-list', enc('https://x.example/a'))?.origin).toBe('https://x.example');
  });
});
describe('Google Charts', () => {
  const chart = '{"chartType":"PieChart","data":[["Region","Revenue"],["North",42],["<b>",1]]}';
  const src = `<<<C type="application/vnd.google.charts+json" title="Revenue"\n${chart}\nC\n`;
  it('show their data as an escaped table until allowed', async () => {
    const { html } = await run(src);
    expect(html).toContain('<table class="m2-chart-data">');
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('data-m2-frame="gchart"');
  });
  it('draw in an opaque-origin frame once allowed', async () => {
    const allowed = createHandlers({ remoteAllowed: (_n, origin) => origin === GCHART_ORIGIN });
    const { html } = await runPipeline(src, { registry: createRegistry(), grants: new GrantSet(), handlers: allowed });
    expect(html).toContain('data-m2-frame="gchart"');
    expect(html).not.toContain('allow-same-origin');
    expect(remoteNeed('application/vnd.google.charts+json', enc(chart))?.origin).toBe(GCHART_ORIGIN);
  });
  it('reject invalid descriptions', async () => {
    const bad = '<<<C type="application/vnd.google.charts+json"\n{"chartType":"x y","data":[[1]]}\nC\n';
    expect((await run(bad)).html).toContain('handler-error');
  });
});