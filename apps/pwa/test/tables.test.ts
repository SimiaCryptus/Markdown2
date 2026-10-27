import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GrantSet } from '@markdown2/core';
import { describe, expect, it, vi } from 'vitest';
import { createBrowserUriPolicy, createRegistry, resolveRemoteUri, type FetchLike } from '../src/decoders.js';
import { cellNumber, compareCells } from '../src/grid.js';
import { codeFence, createHandlers } from '../src/handlers.js';
import { runPipeline } from '../src/pipeline.js';

const read = (p: string): string => readFileSync(fileURLToPath(new URL(`../public${p}`, import.meta.url)), 'utf8');

describe('grid sorting', () => {
  it('reads numbers', () => {
    expect(cellNumber('1,234.5')).toBe(1234.5);
    expect(cellNumber('12%')).toBe(12);
    expect(cellNumber('abc')).toBeNull();
  });
  it('compares numerically, naturally, and keeps empty cells last', () => {
    expect(compareCells('10', '9', 1)).toBeGreaterThan(0);
    expect(compareCells('10', '9', -1)).toBeLessThan(0);
    expect(compareCells('apple', 'Banana', 1)).toBeLessThan(0);
    expect(compareCells('IC 9', 'IC 10', 1)).toBeLessThan(0);
    expect(compareCells('', 'x', 1)).toBeGreaterThan(0);
    expect(compareCells('', 'x', -1)).toBeGreaterThan(0);
  });
});

describe('relative uri references', () => {
  const base = new URL('https://md2.example/docs/tables.md');
  it('resolve against the document, on its origin only', () => {
    expect(resolveRemoteUri('data/planets.csv', base)?.href).toBe('https://md2.example/docs/data/planets.csv');
    expect(resolveRemoteUri('data/planets.csv', null)).toBeNull();
    expect(resolveRemoteUri('//evil.example/x.csv', base)).toBeNull();
    expect(resolveRemoteUri('http://other.example/x.csv', base)).toBeNull();
    expect(resolveRemoteUri('http://localhost:5173/x', new URL('http://localhost:5173/docs/a.md'))?.origin).toBe(
      'http://localhost:5173',
    );
  });
});

describe('tables help page', () => {
  const handlers = createHandlers();
  it('renders grids, and the linked file loads once granted', async () => {
    const src = read('/docs/tables.md');
    const registry = createRegistry();
    const grants = new GrantSet();
    const csv = read('/docs/data/planets.csv');
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(new Response(csv)));
    const uriPolicy = createBrowserUriPolicy({
      origins: () => new Set(),
      base: () => new URL('https://md2.example/docs/tables.md'),
      fetch,
    });
    let r = await runPipeline(src, { registry, grants, handlers, uriPolicy, codeFence });
    expect(r.html.match(/class="m2-grid"/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    const linked = [...r.resources.values()].find((e) => e.node.resource.encoding.includes('uri'));
    if (!linked) throw new Error('missing linked table');
    expect(linked.result.state).toBe('locked');
    expect(fetch).not.toHaveBeenCalled();

    grants.grant(linked.node, 0);
    r = await runPipeline(src, { registry, grants, handlers, uriPolicy, codeFence });
    expect(r.resources.get(linked.node.id)?.result.state).toBe('decoded');
    expect(fetch.mock.calls[0]?.[0].href).toBe('https://md2.example/docs/data/planets.csv');
    expect(r.html).toContain('<td>Neptune</td>');
  });
});