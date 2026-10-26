import { describe, expect, it } from 'vitest';
import {
  collectResources,
  DecoderRegistry,
  GrantSet,
  parse,
  renderHtml,
  resolveDocument,
  type Decoder,
  type ResourceNode,
} from '../src/index.js';
import { asResource } from './helpers.js';

/** Additional §12 cases not covered elsewhere. */
const td = new TextDecoder();
const resources = (src: string) => parse(src).children.filter((c): c is ResourceNode => c.kind === 'resource');
const payload = (n: ResourceNode | undefined) => td.decode(n?.resource.payload);

const fakeAge: Decoder = {
  id: 'age',
  position: 'any',
  capability: 'key',
  decode: (input) => Promise.resolve(input),
};
const ageRegistry = () => {
  const r = new DecoderRegistry();
  r.register(fakeAge);
  return r;
};

describe('A. terminators', () => {
  it('A.3 a different token does not close; the same token closes at its first match', () => {
    expect(payload(resources('<<<A type="text/markdown"\n<<<B type="a/b"\nx\nB\nA\n')[0])).toBe(
      '<<<B type="a/b"\nx\nB',
    );
    const doc = parse('<<<A type="a/b"\n<<<A type="a/b"\nx\nA\ny\nA\n');
    expect(payload(doc.children[0] as ResourceNode)).toBe('<<<A type="a/b"\nx');
    expect(doc.children[1]).toMatchObject({ kind: 'prose', text: 'y\nA\n' });
  });
  it('A.6 CRLF and LF give identical payloads', () => {
    expect(payload(resources('<<<S type="a/b"\r\nx\r\nS\r\n')[0])).toBe(
      payload(resources('<<<S type="a/b"\nx\nS\n')[0]),
    );
  });
});

describe('B. attributes', () => {
  it('B.8 title and filename do not affect handler selection', async () => {
    const src = '<<<T type="text/plain" title="x.png" filename="x.png"\nhi\nT\n';
    const out = await renderHtml(await resolveDocument(parse(src)));
    expect(out).toContain('<pre class="m2-text">hi</pre>');
    expect(out).not.toContain('<img');
  });
});

describe('C. decoder stacks', () => {
  it('C.6 children stay absent while the parent is locked', async () => {
    const [r] = await resolveDocument(parse('<<<E type="text/markdown" encoding="age"\n<<<I type="a/b"\nx\nI\nE\n'), {
      registry: ageRegistry(),
    });
    expect(asResource(r).result.state).toBe('locked');
    expect(asResource(r).children).toBeUndefined();
  });
});

describe('D. frontmatter', () => {
  it('D.3 --- not at offset 0 is not frontmatter', () => {
    expect(resources('para\n\n---\nx\n')).toHaveLength(0);
    expect(resources('\n---\ntitle: x\n---\n')).toHaveLength(0);
  });
  it('D.4 nested documents carry their own frontmatter', async () => {
    const [r] = await resolveDocument(parse('<<<M type="text/markdown"\n---\nt: 1\n---\nbody\nM\n'));
    const meta = asResource(asResource(r).children?.[0]);
    expect(meta.node).toMatchObject({ rel: 'metadata', syntax: 'frontmatter', id: '0/0' });
    expect(meta.result.state).toBe('decoded');
  });
});

describe('E. nesting and placement', () => {
  it('E.1 three levels of text/markdown', async () => {
    const src = '<<<A type="text/markdown"\n<<<B type="text/markdown"\n<<<C type="text/plain"\ndeep\nC\nB\nA\n';
    const all = collectResources(await resolveDocument(parse(src)));
    expect(all.map((e) => [e.node.id, e.result.state])).toEqual([
      ['0', 'decoded'],
      ['0/0', 'decoded'],
      ['0/0/0', 'decoded'],
    ]);
  });

  it('E.2 unlocking the outer document leaves the inner one locked', async () => {
    const doc = parse(
      '<<<O type="text/markdown" encoding="age" title="Outer"\n<<<I type="text/plain" encoding="age"\nsecret\nI\nO\n',
    );
    const grants = new GrantSet();
    grants.grant(doc.children[0] as ResourceNode, 0);
    const resolved = await resolveDocument(doc, { registry: ageRegistry(), grants });
    expect(collectResources(resolved).map((e) => [e.node.id, e.result.state])).toEqual([
      ['0', 'decoded'],
      ['0/0', 'locked'],
    ]);
    expect(await renderHtml(resolved)).not.toContain('secret');
  });

  it('E.6 a resource inside a nested document inside a list item', async () => {
    const src = '- item\n\n  <<<M type="text/markdown"\n  <<<T type="text/plain"\n  hi\n  T\n  M\n';
    const all = collectResources(await resolveDocument(parse(src)));
    expect(all.map((e) => e.node.id)).toEqual(['1', '1/0']);
    expect(td.decode(all[1]?.result.bytes)).toBe('hi');
  });
});
