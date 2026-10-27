import { describe, expect, it } from 'vitest';
import { wavedromHandler } from '../src/index.js';
import { waveToSvg } from '../src/wavedrom.js';

describe('WaveDrom', () => {
  it('draws a timing diagram from relaxed JSON, escaping text', () => {
    const svg = waveToSvg(
      `{ signal: [ {name: 'clk', wave: 'p...'}, {name: "<d>", wave: 'x.34|0', data: ['A','B']}, {}, ],
        head: {text: 'T & U'}, foot: {text: 'end'}, // a comment
        config: { hscale: 2 } }`,
    );
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain('&lt;d&gt;');
    expect(svg).toContain('T &amp; U');
    expect(svg).toContain('>A</text>');
    expect(svg).not.toContain('<script');
  });

  it('draws register maps, with lanes', () => {
    const one = waveToSvg(
      '{ reg: [ {bits: 1, name: "EN"}, {bits: 3, name: "MODE"}, {bits: 4}, {bits: 8, name: "DIV", attr: "RW"} ], config: {bits: 16} }',
    );
    expect(one).toContain('MODE');
    expect(one).toContain('>RW</text>');
    const two = waveToSvg('{ reg: [ {bits: 24, name: "wide"} ], config: {lanes: 2, hspace: 400} }');
    expect(two).toContain('wide');
  });

  it('reads JSON5 escapes and numbers, and keeps __proto__ as data', () => {
    const svg = waveToSvg(
      `{signal: [{name: 'a\\u0041\\x42', wave: '0'}], n: [0x10, -Infinity, .5, 1e2, true, null, NaN], "__proto__": 1}`,
    );
    expect(svg).toContain('aAB');
  });

  it('never evaluates the source', () => {
    expect(() => waveToSvg('{signal: (function(){ return [] })()}')).toThrow(/WaveJSON/);
    expect(() => waveToSvg('{signal: [{wave: "0"}]} trailing')).toThrow(/after the value/);
  });

  it('rejects unusable input', () => {
    for (const bad of [
      '{}',
      '[1]',
      '{signal: [',
      '{signal: [{wave: "01"}',
      '{reg: [{name: "x"}]}',
      '{reg: [1]}',
      "{a: 'x",
      `{signal: [{wave: "${'0'.repeat(600)}"}]}`,
    ]) {
      expect(() => waveToSvg(bad), bad).toThrow();
    }
  });

  it('the handler returns an <img> with an SVG data URL', async () => {
    const html = await wavedromHandler.render(new TextEncoder().encode('{signal:[{name:"a",wave:"01"}]}'), {
      type: 'text/vnd.wavedrom',
      children: () => Promise.resolve(''),
    });
    expect(html).toContain('<img class="m2-wavedrom"');
    expect(html).toContain('data:image/svg+xml;base64,');
  });
});
