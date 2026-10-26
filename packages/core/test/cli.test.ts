import { describe, expect, it } from 'vitest';
import { normaliseDocument, parse } from '../src/index.js';
import { main } from '../src/node/index.js';

async function run(argv: string[], files: Record<string, string> = {}) {
  let out = '';
  let err = '';
  const code = await main(argv, {
    stdout: (s) => {
      out += s;
    },
    stderr: (s) => {
      err += s;
    },
    readFile: (p) => {
      const f = files[p];
      return f === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(f);
    },
  });
  return { code, out, err };
}

const good = '# Title\n<<<S type="text/plain"\nhi\nS\n';
const bad = '<<<S type="a/b"\nsecret\n';

describe('m2 CLI', () => {
  it('tree prints the normalised parse tree', async () => {
    const r = await run(['tree', 'doc.md'], { 'doc.md': good });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual(normaliseDocument(parse(good)));
  });

  it('resolve includes decode states', async () => {
    const r = await run(['resolve', 'doc.md'], { 'doc.md': good });
    expect(r.code).toBe(0);
    expect(r.out).toContain('"state": "decoded"');
  });
  it('render prints HTML', async () => {
    const r = await run(['render', 'doc.md'], { 'doc.md': good });
    expect(r.code).toBe(0);
    expect(r.out).toContain('<p># Title</p>');
    expect(r.out).toContain('<pre class="m2-text">hi</pre>');
  });

  it('validate reports structural and decode diagnostics', async () => {
    expect(await run(['validate', 'doc.md'], { 'doc.md': good })).toMatchObject({ code: 0, out: '' });
    const r = await run(['validate', 'bad.md'], { 'bad.md': bad });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/^bad\.md:1: unterminated-resource \[0\]:/);
    const b64 = await run(['validate', 'b.md'], { 'b.md': '<<<B type="a/b" encoding="base64"\n!!!!\nB\n' });
    expect(b64.code).toBe(1);
    expect(b64.out).toContain('decode-error');
  });

  it('applies limits from the command line', async () => {
    const src = '<<<A type="a/b"\nA\n<<<B type="a/b"\nB\n';
    const r = await run(['validate', '--max-resources', '1', 'd.md'], { 'd.md': src });
    expect(r.code).toBe(1);
    expect(r.out).toContain('limit-exceeded');
  });

  it('usage and I/O errors exit with 2', async () => {
    expect((await run(['frob', 'x.md'])).code).toBe(2);
    expect((await run(['tree'])).code).toBe(2);
    expect((await run(['tree', '--max-depth', '0', 'x.md'], { 'x.md': '' })).code).toBe(2);
    expect((await run(['tree', '--nope', 'x.md'])).code).toBe(2);
    const missing = await run(['tree', 'missing.md']);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain('cannot read missing.md');
  });

  it('help exits with 0', async () => {
    const r = await run(['--help']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('Usage: m2');
  });
});
