import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GrantSet, defaultHandlers } from '@markdown2/core';
import { describe, expect, it, vi } from 'vitest';
import { createRegistry, type FetchLike } from '../src/decoders.js';
import { DOCS } from '../src/docs.js';
import { runPipeline } from '../src/pipeline.js';
import { docLinkTarget, docNameFor, fetchDocument, resolveDocUrl } from '../src/remote-doc.js';

const APP = 'https://md2.example/';
const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../public${path}`, import.meta.url)), 'utf8');

describe('resolveDocUrl', () => {
  it('allows same-origin paths and https elsewhere', () => {
    expect(resolveDocUrl('/docs/index.md', APP)?.href).toBe('https://md2.example/docs/index.md');
    expect(resolveDocUrl('https://other.example/a.md', APP)?.href).toBe('https://other.example/a.md');
    expect(resolveDocUrl('https://other.example/a.md#x', APP)?.hash).toBe('');
  });
  it('refuses everything else', () => {
    for (const raw of ['', 'http://other.example/a.md', 'javascript:alert(1)', 'data:text/plain,x', 'https://u:p@x.example/a.md']) {
      expect(resolveDocUrl(raw, APP), raw).toBeNull();
    }
  });
});

describe('docLinkTarget', () => {
  const doc = new URL('https://md2.example/docs/index.md');
  it('keeps document links in the app', () => {
    expect(docLinkTarget('?url=/docs/guide.md', null, APP)).toBe('/docs/guide.md');
    expect(docLinkTarget('guide.md', doc, APP)).toBe('https://md2.example/docs/guide.md');
    expect(docLinkTarget('https://md2.example/?url=/docs/x.md', null, APP)).toBe('/docs/x.md');
  });
  it('leaves other links alone', () => {
    expect(docLinkTarget('guide.md', null, APP)).toBeNull();
    expect(docLinkTarget('#top', doc, APP)).toBeNull();
    expect(docLinkTarget('https://other.example/x.md', doc, APP)).toBeNull();
    expect(docLinkTarget('picture.png', doc, APP)).toBeNull();
  });
});

describe('docNameFor', () => {
  it('uses the last path segment', () => {
    expect(docNameFor(new URL('https://x.example/a/My%20Notes.md'))).toBe('My Notes.md');
    expect(docNameFor(new URL('https://x.example/'))).toBe('document.md');
  });
});

describe('fetchDocument', () => {
  const ok = (body: BodyInit, type = 'text/markdown') =>
    vi.fn<FetchLike>(() => Promise.resolve(new Response(body, { headers: { 'content-type': type } })));

  it('omits credentials across origins', async () => {
    const f = ok('# hi');
    expect(await fetchDocument(new URL('https://other.example/a.md'), { sameOrigin: false, fetch: f })).toBe('# hi');
    expect(f.mock.calls[0]?.[1].credentials).toBe('omit');
  });
  it('rejects HTML pages, bad status, oversize and invalid UTF-8', async () => {
    const u = new URL('https://md2.example/x.md');
    await expect(fetchDocument(u, { sameOrigin: true, fetch: ok('<html>', 'text/html') })).rejects.toThrow(/HTML/);
    const notFound = vi.fn<FetchLike>(() => Promise.resolve(new Response('x', { status: 404 })));
    await expect(fetchDocument(u, { sameOrigin: true, fetch: notFound })).rejects.toThrow(/404/);
    await expect(fetchDocument(u, { sameOrigin: true, fetch: ok('x'.repeat(100)), maxBytes: 10 })).rejects.toThrow(/larger/);
    await expect(fetchDocument(u, { sameOrigin: true, fetch: ok(new Uint8Array([0xff, 0xfe])) })).rejects.toThrow(/UTF-8/);
  });
});

describe('built-in documentation', () => {
  const handlers = defaultHandlers();
  const forbidden = new Set([
    'unterminated-resource',
    'unterminated-frontmatter',
    'malformed-opener',
    'duplicate-attribute',
    'wrapper-unclosed',
    'decode-error',
    'invalid-utf-8',
    'stylesheet-not-css',
    'stylesheet-bad-default',
    'stylesheet-bad-media',
    'stylesheet-missing-title',
  ]);
  const paths = new Set(DOCS.map((d) => d.path));

  it.each(DOCS.map((d) => d.path))('%s parses cleanly and links only to existing pages', async (path) => {
    const r = await runPipeline(read(path), { registry: createRegistry(), grants: new GrantSet(), handlers });
    expect(r.diagnostics.filter((d) => forbidden.has(d.code))).toEqual([]);
    const docUrl = new URL(path, APP);
    for (const m of r.html.matchAll(/href="([^"]+)"/g)) {
      const target = docLinkTarget(m[1] ?? '', docUrl, APP);
      if (target === null) continue;
      const u = resolveDocUrl(target, APP);
      expect(u?.origin).toBe(new URL(APP).origin);
      expect(paths.has(u?.pathname ?? '')).toBe(true);
    }
  });

  it('the styles page offers a choice and a switch', async () => {
    const r = await runPipeline(read('/docs/styles.md'), { registry: createRegistry(), grants: new GrantSet(), handlers });
    expect(r.styles.groups.map((g) => [g.name, g.kind])).toEqual([
      ['Page tint', 'alternatives'],
      ['Summary mode', 'toggle'],
    ]);
  });
});