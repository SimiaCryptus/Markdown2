import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normaliseResolved, parse, resolveDocument, toFixtureJson } from '../src/index.js';

/**
 * Language-neutral conformance fixtures (plan §1, spec §12).
 *
 * Each `name.md` has an expected `name.tree.json`: the resolved tree with
 * default options (no grants, `uri` locked, default limits).
 * Regenerate with `UPDATE_FIXTURES=1 npx vitest run test/conformance.test.ts`
 * and review the diff.
 *
 * Comparison is byte-exact after canonicalising line endings to LF and the
 * file end to exactly one newline. Editors and VCS settings disagree on
 * final newlines; fixture consumers in other languages should do the same.
 */
const dir = fileURLToPath(new URL('./fixtures/', import.meta.url));
const update = process.env.UPDATE_FIXTURES === '1';
const cases = readdirSync(dir)
  .filter((f) => f.endsWith('.md'))
  .sort();
const treeName = (name: string): string => name.replace(/\.md$/, '.tree.json');
/** Canonical fixture text: LF line endings, exactly one trailing newline. */
export const canonical = (s: string): string => s.replace(/\r\n/g, '\n').trimEnd() + '\n';

describe('conformance fixtures', () => {
  it('has fixtures', () => {
    expect(cases.length).toBeGreaterThan(0);
  });
  it('every fixture has an expected tree', () => {
    const files = new Set(readdirSync(dir));
    expect(cases.filter((c) => !files.has(treeName(c)))).toEqual([]);
  });

  it.each(cases)('%s', async (name) => {
    const src = readFileSync(path.join(dir, name), 'utf8');
    const actual = canonical(toFixtureJson(normaliseResolved(await resolveDocument(parse(src)))));
    const treePath = path.join(dir, treeName(name));
    if (update) writeFileSync(treePath, actual);
    expect(actual).toBe(canonical(readFileSync(treePath, 'utf8')));
  });
});
