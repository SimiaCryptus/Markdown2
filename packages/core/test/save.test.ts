import { describe, expect, it } from 'vitest';
import { parse, safeSaveName, type ResourceNode } from '../src/index.js';

const node = (attrs: string): ResourceNode => {
  const c = parse(`<<<X ${attrs}\nX\n`).children[0];
  if (c?.kind !== 'resource') throw new Error('expected resource');
  return c;
};

describe('safe saving (§6.2, H.4)', () => {
  it('text/html never yields .html without confirmation', () => {
    expect(safeSaveName(node('type="text/html"'), 'decoded')).toEqual({ name: 'resource-0.bin' });
    expect(safeSaveName(node('type="text/html" filename="page.html"'), 'decoded')).toEqual({
      name: 'page.bin',
      requested: 'page.html',
    });
  });
  it('keeps passive extensions', () => {
    expect(safeSaveName(node('type="application/pdf" filename="Q3_Financials.pdf"'), 'decoded')).toEqual({
      name: 'Q3_Financials.pdf',
    });
    expect(safeSaveName(node('type="image/png"'), 'decoded')).toEqual({ name: 'resource-0.png' });
  });
  it('svg is active even when declared', () => {
    expect(safeSaveName(node('type="image/svg+xml"'), 'decoded').name).toBe('resource-0.bin');
  });
  it('strips paths, bidi controls and inner dots', () => {
    expect(safeSaveName(node('type="a/b" filename="../../etc/evil.exe"'), 'decoded')).toEqual({
      name: 'evil.bin',
      requested: 'evil.exe',
    });
    expect(safeSaveName(node('type="a/b" filename="invoice\u202egnp.exe"'), 'decoded').name).toBe('invoicegnp.bin');
    expect(safeSaveName(node('type="image/png" filename="photo.svg.png"'), 'decoded').name).toBe('photo_svg.png');
  });
  it('reserved device names and raw form', () => {
    expect(safeSaveName(node('type="text/plain" filename="CON.txt"'), 'decoded').name).toBe('_CON.txt');
    expect(safeSaveName(node('type="text/html" filename="page.html"'), 'raw')).toEqual({ name: 'page.txt' });
  });
});
