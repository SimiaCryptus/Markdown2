describe('Graphviz', () => {
  it('fences and resources become sandboxed frames with a source fallback', async () => {
    const fence = (await run('```dot\ndigraph { a -> b }\n```\n')).html;
    expect(fence).toContain('data-m2-frame="graphviz"');
    expect(fence).toContain('src="/sandbox/graphviz.html"');
    expect(fence).toContain('a -&gt; b');
    expect(fence).not.toContain('allow-same-origin');
    expect((await run('```graphviz\ngraph { a -- b }\n```\n')).html).toContain('data-m2-frame="graphviz"');
    const res = (await run('<<<G type="text/vnd.graphviz" layout="neato"\ngraph { a -- b }\nG\n')).html;
    expect(res).toContain('data-m2-lang="neato"');
    const odd = (await run('<<<G type="text/vnd.graphviz" layout="rm -rf"\ngraph { a }\nG\n')).html;
    expect(odd).toContain('data-m2-lang="dot"');
  });
});

describe('WaveDrom', () => {
  it('renders WaveJSON (relaxed JSON) to SVG shown through <img>', async () => {
    const { html } = await run('```wavedrom\n{ signal: [{ name: "clk", wave: "p...." }] }\n```\n');
    expect(html).toContain('<img class="m2-wavedrom"');
    const [svg] = svgsIn(html);
    expect(svg).toMatch(/^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  });
  it('never evaluates the source', async () => {
    const { html } = await run('<<<W type="text/vnd.wavedrom"\n(function(){ return {signal:[]} })()\nW\n');
    expect(html).toContain('handler-error');
  });
});

describe('MathJax', () => {