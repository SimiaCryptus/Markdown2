import { GrantSet, defaultHandlers, parse, type ResourceNode } from '@markdown2/core';
import { Encrypter } from 'age-encryption';
import { describe, expect, it, vi } from 'vitest';
import { createBrowserUriPolicy, createRegistry, type FetchLike } from '../src/decoders.js';
import { nextGate, runPipeline } from '../src/pipeline.js';
import { SAMPLE } from '../src/sample.js';
import { planSave } from '../src/save-plan.js';

const b64 = (u: Uint8Array): string => btoa(String.fromCharCode(...u));
const handlers = defaultHandlers();

async function encrypt(text: string, passphrase: string): Promise<Uint8Array> {
  const e = new Encrypter();
  e.setScryptWorkFactor(10); // keep the test fast
  e.setPassphrase(passphrase);
  return e.encrypt(text);
}

describe('sample document', () => {
  it('renders with a locked remote image and a type hint', async () => {
    const r = await runPipeline(SAMPLE, { registry: createRegistry(), grants: new GrantSet(), handlers });
    expect(r.html).toContain('Did you mean');
    expect([...r.resources.values()].some((e) => e.result.state === 'locked')).toBe(true);
  });
});

describe('age unlock flow', () => {
  it('stays locked without a key, rejects a wrong key, decodes with the right one', async () => {
    const ct = await encrypt('hello secret', 'pw');
    const src = `<<<V type="text/plain" encoding="base64 age" title="Vault"\n${b64(ct)}\nV\n`;
    const registry = createRegistry();
    const grants = new GrantSet();
    const node = parse(src).children[0] as ResourceNode;

    let r = await runPipeline(src, { registry, grants, handlers });
    expect(r.resources.get('0')?.result.state).toBe('locked');
    expect(r.html).not.toContain('hello secret');

    const gate = nextGate(node, registry, grants);
    expect(gate?.stage).toBe(1);
    grants.grant(node, 1, { kind: 'passphrase', value: 'wrong' });
    r = await runPipeline(src, { registry, grants, handlers });
    expect(r.resources.get('0')?.result).toMatchObject({ state: 'locked', error: 'key-rejected' });

    expect(nextGate(node, registry, grants)?.stage).toBe(1); // rejected grant was revoked
    grants.grant(node, 1, { kind: 'passphrase', value: 'pw' });
    r = await runPipeline(src, { registry, grants, handlers });
    expect(r.resources.get('0')?.result.state).toBe('decoded');
    expect(r.html).toContain('hello secret');
  });
});

describe('browser uri policy', () => {
  const src = '<<<U type="image/png" encoding="uri"\nhttps://example.org/x.png\nU\n';
  const fakeFetch = (body: string) =>
    vi.fn<FetchLike>(() => Promise.resolve(new Response(body, { headers: { 'content-type': 'text/html' } })));

  it('is locked by default and never fetches', async () => {
    const f = fakeFetch('<b>x</b>');
    const uriPolicy = createBrowserUriPolicy({ origins: () => new Set(), fetch: f });
    const r = await runPipeline(src, { registry: createRegistry(), grants: new GrantSet(), handlers, uriPolicy });
    expect(r.resources.get('0')?.result.state).toBe('locked');
    expect(f).not.toHaveBeenCalled();
  });

  it('fetches for allowed origins and ignores Content-Type', async () => {
    const uriPolicy = createBrowserUriPolicy({ origins: () => new Set(['https://example.org']), fetch: fakeFetch('<b>x</b>') });
    const r = await runPipeline(src, { registry: createRegistry(), grants: new GrantSet(), handlers, uriPolicy });
    expect(r.resources.get('0')?.result.state).toBe('decoded');
    expect(r.html).toContain('data:image/png;base64,');
    expect(r.html).not.toContain('<b>');
  });

  it('fetches for a per-resource grant; relative references fail', async () => {
    const uriPolicy = createBrowserUriPolicy({ origins: () => new Set(), fetch: fakeFetch('x') });
    const grants = new GrantSet();
    grants.grant(parse(src).children[0] as ResourceNode, 0);
    let r = await runPipeline(src, { registry: createRegistry(), grants, handlers, uriPolicy });
    expect(r.resources.get('0')?.result.state).toBe('decoded');

    const rel = '<<<U type="image/png" encoding="uri"\nlogo.png\nU\n';
    const g2 = new GrantSet();
    g2.grant(parse(rel).children[0] as ResourceNode, 0);
    r = await runPipeline(rel, { registry: createRegistry(), grants: g2, handlers, uriPolicy });
    expect(r.resources.get('0')?.result.state).toBe('failed');
  });

  it('caps the body while streaming', async () => {
    const uriPolicy = createBrowserUriPolicy({
      origins: () => new Set(['https://example.org']),
      fetch: fakeFetch('x'.repeat(4096)),
      maxBytes: 1024,
    });
    const r = await runPipeline(src, { registry: createRegistry(), grants: new GrantSet(), handlers, uriPolicy });
    expect(r.resources.get('0')?.result).toMatchObject({ state: 'failed', error: 'limit-exceeded' });
  });
});

describe('save plan (§6.2, H.4)', () => {
  it('never defaults to an active extension', async () => {
    const src = '<<<H type="text/html" filename="page.html"\n<b>x</b>\nH\n';
    const r = await runPipeline(src, { registry: createRegistry(), grants: new GrantSet(), handlers });
    const entry = r.resources.get('0');
    if (!entry) throw new Error('missing resource');
    expect(planSave(entry, 'decoded')).toMatchObject({ name: 'page.bin', requested: 'page.html' });
    expect(planSave(entry, 'raw')).toMatchObject({ name: 'page.txt' });
  });
  it('locked resources cannot be saved decoded', async () => {
    const src = '<<<U type="image/png" encoding="uri"\nhttps://example.org/x\nU\n';
    const r = await runPipeline(src, { registry: createRegistry(), grants: new GrantSet(), handlers });
    const entry = r.resources.get('0');
    if (!entry) throw new Error('missing resource');
    expect(planSave(entry, 'decoded')).toBeNull();
    expect(planSave(entry, 'raw')?.bytes.length).toBeGreaterThan(0);
  });
});