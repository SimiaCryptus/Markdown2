import { describe, expect, it } from 'vitest';
import {
  applyBatchGrant,
  batchScope,
  collectResources,
  DecoderRegistry,
  GrantSet,
  KeyRejected,
  normaliseDocument,
  normaliseResolved,
  parse,
  resolveDocument,
  type Decoder,
  type Diagnostic,
  type ResourceNode,
  type UriPolicy,
} from '../src/index.js';
import { asResource } from './helpers.js';

const fakeAge: Decoder = {
  id: 'age',
  position: 'any',
  capability: 'key',
  decode(input, ctx) {
    return ctx.grant === 'bad' ? Promise.reject(new KeyRejected('nope')) : Promise.resolve(input);
  },
};
const registry = () => {
  const r = new DecoderRegistry();
  r.register(fakeAge);
  return r;
};

describe('diagnostics during resolution', () => {
  it('surfaces nested parse diagnostics', async () => {
    const diagnostics: Diagnostic[] = [];
    await resolveDocument(parse('<<<A type="text/markdown"\n<<<B type="a/b"\nopen\nA\n'), { diagnostics });
    expect(diagnostics.map((d) => d.code)).toContain('unterminated-resource');
    expect(diagnostics[0]!.nodeId).toBe('0/0');
  });
  it('rejected key stays locked with diagnostic', async () => {
    const doc = parse('<<<E type="a/b" encoding="age"\nx\nE\n');
    const grants = new GrantSet();
    grants.grant(doc.children[0] as ResourceNode, 0, 'bad');
    const diagnostics: Diagnostic[] = [];
    const [r] = await resolveDocument(doc, { registry: registry(), grants, diagnostics });
    expect(asResource(r).result).toMatchObject({ state: 'locked', error: 'key-rejected' });
    expect(diagnostics[0]!.code).toBe('key-rejected');
  });
});

describe('batch grants', () => {
  it('apply individually and never reach children revealed later', async () => {
    const src =
      '<<<A type="text/markdown" encoding="age"\n<<<B type="a/b" encoding="age"\nx\nB\nA\n<<<C type="a/b" encoding="age"\ny\nC\n';
    const doc = parse(src);
    const grants = new GrantSet();
    const scope = batchScope(
      doc.children.filter((c): c is ResourceNode => c.kind === 'resource'),
      'AGE',
      grants,
    );
    expect(scope).toHaveLength(2);
    applyBatchGrant(grants, scope);
    const all = collectResources(await resolveDocument(doc, { registry: registry(), grants }));
    expect(all.map((r) => [r.node.id, r.result.state])).toEqual([
      ['0', 'decoded'],
      ['0/0', 'locked'],
      ['1', 'decoded'],
    ]);
  });
});

describe('handler lookup', () => {
  it('text/markdown with parameters has no fallback', async () => {
    const [r] = await resolveDocument(parse('<<<A type="Text/Markdown; charset=utf-8"\nhi\nA\n'));
    const res = asResource(r);
    expect(res.children).toBeDefined();
    expect(res.fallback).toBeUndefined();
  });
});
describe('uri resolution (C.10)', () => {
  it('retrieved bytes never change the declared type', async () => {
    const html = new TextEncoder().encode('<script>alert(1)</script>');
    const uriPolicy: UriPolicy = { allows: () => true, resolve: () => Promise.resolve(html) };
    const [r] = await resolveDocument(parse('<<<U type="image/png" encoding="uri"\nhttps://example.org/x\nU\n'), {
      uriPolicy,
      handledTypes: new Set(['image/png']),
    });
    const res = asResource(r);
    expect(res.result.state).toBe('decoded');
    expect(res.node.resource.type).toBe('image/png');
  });
  it('a per-node grant authorises resolution through the policy', async () => {
    const uriPolicy: UriPolicy = { allows: () => false, resolve: () => Promise.resolve(new Uint8Array([1])) };
    const doc = parse('<<<U type="a/b" encoding="uri"\nhttps://example.org/x\nU\n');
    const grants = new GrantSet();
    expect(asResource((await resolveDocument(doc, { uriPolicy, grants }))[0]).result.state).toBe('locked');
    grants.grant(doc.children[0] as ResourceNode, 0);
    expect(asResource((await resolveDocument(doc, { uriPolicy, grants }))[0]).result.state).toBe('decoded');
  });
});

describe('normalised tree', () => {
  it('is stable and marks binary payloads', async () => {
    const doc = parse('<<<S type="a/b" z="1" acme-a="2"\nhi\nS\n');
    const [first] = normaliseDocument(doc);
    expect(first).toMatchObject({
      kind: 'resource',
      payload: 'hi',
      attributes: { 'acme-a': '2', type: 'a/b', z: '1' },
    });
    if (first?.kind !== 'resource') throw new Error('expected a resource node');
    expect(Object.keys(first.attributes)).toEqual(['acme-a', 'type', 'z']);
    const resolved = normaliseResolved(await resolveDocument(doc));
    expect(resolved[0]).toMatchObject({ state: 'decoded' });
  });
});
