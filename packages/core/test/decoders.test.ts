import { describe, expect, it } from 'vitest';
import {
  DecoderRegistry,
  GrantSet,
  isForbiddenAddress,
  parse,
  resolveDocument,
  type Decoder,
  type ResolveOptions,
  type ResourceNode,
} from '../src/index.js';
import { asResource } from './helpers.js';

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([new Uint8Array(data)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

const fakeAge: Decoder = {
  id: 'age',
  position: 'any',
  capability: 'key',
  decode(input) {
    return Promise.resolve(input);
  },
};

const one = async (src: string, opts: ResolveOptions = {}) => asResource((await resolveDocument(parse(src), opts))[0]);

describe('C. decoder stacks', () => {
  it('base64 with whitespace', async () => {
    const r = await one('<<<B type="text/plain" encoding="base64"\naGVs\nbG8=\nB\n');
    expect(new TextDecoder().decode(r.result.bytes)).toBe('hello');
  });
  it('invalid base64 fails', async () => {
    expect((await one('<<<B type="a/b" encoding="base64"\n!!!!\nB\n')).result.state).toBe('failed');
  });
  it('unknown → unsupported, precedence', async () => {
    expect((await one('<<<B type="a/b" encoding="frob"\nB\n')).result.state).toBe('unsupported');
    expect((await one('<<<B type="a/b" encoding="frob uri"\nB\n')).result).toMatchObject({
      state: 'failed',
      error: 'uri-not-first',
    });
    const registry = new DecoderRegistry();
    registry.register(fakeAge);
    expect((await one('<<<B type="a/b" encoding="base64 frob age"\nB\n', { registry })).result.state).toBe(
      'unsupported',
    );
  });
  it('uri locked by default', async () => {
    expect((await one('<<<U type="image/png" encoding="uri"\nfile:///etc/passwd\nU\n')).result.state).toBe('locked');
  });
  it('base64 gzip and bomb', async () => {
    const z = await gzip(new TextEncoder().encode('hi'));
    const r = await one(`<<<G type="text/plain" encoding="base64 gzip"\n${b64(z)}\nG\n`);
    expect(new TextDecoder().decode(r.result.bytes)).toBe('hi');
    const bomb = await gzip(new Uint8Array(4 * 1024 * 1024));
    const r2 = await one(`<<<G type="a/b" encoding="base64 gzip"\n${b64(bomb)}\nG\n`, {
      limits: { maxDecodedBytes: 1024 * 1024 },
    });
    expect(r2.result).toMatchObject({ state: 'failed', error: 'limit-exceeded' });
  });
  it('layered encryption needs both grants', async () => {
    const registry = new DecoderRegistry();
    registry.register(fakeAge);
    const doc = parse('<<<E type="text/plain" encoding="utf-8 age age"\nx\nE\n');
    const node = doc.children[0] as ResourceNode;
    const grants = new GrantSet();
    grants.grant(node, 1);
    expect(asResource((await resolveDocument(doc, { registry, grants }))[0]).result.state).toBe('locked');
    grants.grant(node, 2);
    expect(asResource((await resolveDocument(doc, { registry, grants }))[0]).result.state).toBe('decoded');
  });
});

describe('E/G/H runtime', () => {
  it('nested markdown resolves recursively', async () => {
    const r = await one('<<<A type="text/markdown"\n<<<B type="text/markdown"\ninner\nB\nA\n');
    expect(asResource(r.children?.[0]).children?.[0]).toMatchObject({ kind: 'prose', text: 'inner' });
  });
  it('depth limit', async () => {
    const r = await one('<<<A type="text/markdown"\n<<<B type="text/markdown"\nx\nB\nA\n', { limits: { maxDepth: 1 } });
    expect(asResource(r.children?.[0]).result).toMatchObject({ state: 'failed', error: 'limit-exceeded' });
  });
  it('did you mean, no correction', async () => {
    const r = await one('<<<I type="image/jpg"\nx\nI\n');
    expect(r.fallback?.suggestion).toBe('image/jpeg');
    expect(r.node.resource.type).toBe('image/jpg');
  });
  it('SSRF guard', () => {
    expect(isForbiddenAddress('127.0.0.1')).toBe(true);
    expect(isForbiddenAddress('192.168.1.5')).toBe(true);
    expect(isForbiddenAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isForbiddenAddress('93.184.216.34')).toBe(false);
  });
});
