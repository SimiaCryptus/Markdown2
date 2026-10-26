import { describe, expect, it } from 'vitest';
import { normaliseDocument, parse, type ResourceNode } from '../src/index.js';

const td = new TextDecoder();
const res = (src: string) => parse(src).children.filter((c): c is ResourceNode => c.kind === 'resource');
const text = (n: ResourceNode) => td.decode(n.resource.payload);

describe('A. terminators', () => {
  it('preserves backticks', () => {
    const [n] = res('<<<S type="text/markdown"\n```js\nx\n````\nS\n');
    expect(text(n!)).toBe('```js\nx\n````');
  });
  it('trailing whitespace closes, leading does not', () => {
    expect(text(res('<<<S type="a/b"\nx\nS \t\n')[0]!)).toBe('x');
    expect(res('<<<S type="a/b"\n S\n')[0]!.structuralError).toBe('unterminated-resource');
  });
  it('empty payload', () => {
    expect(res('<<<S type="a/b"\nS\n')[0]!.resource.payload.length).toBe(0);
  });
  it('unterminated fails closed', () => {
    const doc = parse('<<<S type="a/b"\nsecret\n');
    expect(doc.children).toHaveLength(1);
    expect((doc.children[0] as ResourceNode).structuralError).toBe('unterminated-resource');
    expect(doc.diagnostics).toHaveLength(1);
  });
  it('case sensitive', () => {
    expect(res('<<<end type="a/b"\nEND\n')[0]!.structuralError).toBe('unterminated-resource');
  });
  it('interrupts paragraph', () => {
    const doc = parse('para\n<<<S type="a/b"\nx\nS\n');
    expect(doc.children.map((c) => c.kind)).toEqual(['prose', 'resource']);
  });
  it('CRLF', () => {
    expect(text(res('<<<S type="a/b"\r\nx\r\ny\r\nS\r\n')[0]!)).toBe('x\r\ny');
  });
});

describe('B. openers', () => {
  it('missing type fails but stays opaque', () => {
    const doc = parse('<<<S\n# not a heading\nS\nafter\n');
    expect((doc.children[0] as ResourceNode).structuralError).toBe('missing-type');
    expect(doc.children[1]).toMatchObject({ kind: 'prose', text: 'after\n' });
  });
  it('duplicate and malformed', () => {
    expect(res('<<<S type="a/b" type="c/d"\nS\n')[0]!.structuralError).toBe('duplicate-attribute');
    expect(res('<<<S type="a/b\nx\nS\n')[0]!.structuralError).toBe('malformed-opener');
  });
  it('non-tokens are text', () => {
    expect(res('<<< X\n<<<9X\n')).toHaveLength(0);
  });
  it('nested quotes and defaults', () => {
    const [n] = res(`<<<S type='text/plain; charset="utf-8"' acme-x="1"\nS\n`);
    expect(n!.resource.type).toBe('text/plain; charset="utf-8"');
    expect(n!.resource.encoding).toEqual(['utf-8']);
    expect(n!.resource.attributes.get('acme-x')).toBe('1');
  });
});

describe('D. frontmatter', () => {
  it('normalises', () => {
    const [n] = res('---\ntitle: x\n...\n');
    expect(n!.rel).toBe('metadata');
    expect(n!.resource.type).toBe('application/yaml');
    expect(text(n!)).toBe('title: x');
  });
  it('unterminated', () => {
    expect(res('---\ntitle: x\n')[0]!.structuralError).toBe('unterminated-frontmatter');
  });
});

describe('E. placement', () => {
  it('list item prefix is stripped', () => {
    const [n] = res('1. Step\n\n   <<<N type="a/b"\n   abc\n\n   def\n   N\n');
    expect(text(n!)).toBe('abc\n\ndef');
  });
  it('block quote prefix and bare >', () => {
    const [n] = res('> <<<Q type="a/b"\n> abc\n>\n> Q\n');
    expect(text(n!)).toBe('abc\n');
  });
  it('missing quote prefix ends resource', () => {
    const [n] = res('> <<<Q type="a/b"\nabc\nQ\n');
    expect(n!.structuralError).toBe('unterminated-resource');
  });
  it('ignored inside fenced code', () => {
    expect(res('```\n<<<S type="a/b"\n```\n')).toHaveLength(0);
  });
});
describe('H. limits', () => {
  it('excess resources fail, the rest of the document continues', () => {
    const doc = parse('<<<A type="a/b"\nA\n<<<B type="a/b"\nB\n<<<C type="a/b"\nC\ntail\n', {
      limits: { maxResources: 2 },
    });
    const nodes = doc.children.filter((c): c is ResourceNode => c.kind === 'resource');
    expect(nodes.map((n) => n.structuralError)).toEqual([undefined, undefined, 'limit-exceeded']);
    expect(doc.children.at(-1)).toMatchObject({ kind: 'prose', text: 'tail\n' });
  });
});

describe('wrapper', () => {
  it('consumes comment lines', () => {
    const doc = parse('<!--\n<<<T type="a/b"\nx\nT\n-->\nafter\n');
    expect((doc.children[0] as ResourceNode).syntax).toBe('wrapped');
    expect(doc.children[1]).toMatchObject({ kind: 'prose', text: 'after\n' });
  });
  it('F.4: wrapped and unwrapped trees are identical apart from syntax', () => {
    const strip = (src: string) =>
      normaliseDocument(parse(src)).map((n) => (n.kind === 'resource' ? { ...n, syntax: undefined } : n));
    expect(strip('<!--\n<<<T type="a/b"\nx\nT\n-->\nafter\n')).toEqual(strip('<<<T type="a/b"\nx\nT\nafter\n'));
  });
  it('missing --> emits a diagnostic', () => {
    const doc = parse('<!--\n<<<T type="a/b"\nx\nT\nafter\n');
    expect(doc.diagnostics.map((d) => d.code)).toEqual(['wrapper-unclosed']);
  });
});
describe('normalised tree', () => {
  it('reports non-UTF-8 payloads as base64', () => {
    const doc = parse('<<<B type="a/b"\n\uFFFF\nB\n');
    const node = doc.children[0] as ResourceNode;
    // Replace the payload with invalid UTF-8 to exercise the binary path.
    const binary = { ...node, resource: { ...node.resource, payload: new Uint8Array([0xff, 0xfe]) } };
    const [n] = normaliseDocument({ children: [binary], diagnostics: [] });
    expect(n).toMatchObject({ kind: 'resource', payloadBase64: '//4=' });
    expect(n).not.toHaveProperty('payload');
  });
});
