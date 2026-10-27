import { describe, expect, it } from 'vitest';
import {
  MAX_TABLE_ROWS,
  buildTable,
  headerPresent,
  isNumericCell,
  parse,
  parseCsv,
  parseTsv,
  renderHtml,
  resolveDocument,
} from '../src/index.js';

const render = async (src: string) => renderHtml(await resolveDocument(parse(src)));

describe('data tables', () => {
  it('parses RFC 4180 CSV', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n1,\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['1', ''],
    ]);
    expect(parseCsv('"multi\nline",z')).toEqual([['multi\nline', 'z']]);
    expect(parseCsv('a\n\nb')).toEqual([['a'], ['b']]);
    expect(parseCsv('a"b,c')).toEqual([['a"b', 'c']]);
  });
  it('parses TSV without quoting', () => {
    expect(parseTsv('a\tb\n"x"\t\n')).toEqual([
      ['a', 'b'],
      ['"x"', ''],
    ]);
  });
  it('honours the header parameter', () => {
    expect(headerPresent('text/csv')).toBe(true);
    expect(headerPresent('text/csv; header=absent')).toBe(false);
    expect(headerPresent('text/csv; charset=utf-8; header="ABSENT"')).toBe(false);
    expect(buildTable([['1', '2']], false).head).toEqual(['Column 1', 'Column 2']);
  });
  it('detects numeric columns and pads rows', () => {
    expect(isNumericCell('1,234.5')).toBe(true);
    expect(isNumericCell('12%')).toBe(true);
    expect(isNumericCell('abc')).toBe(false);
    const t = buildTable([['n', 's'], ['1'], ['2', 'x']], true);
    expect(t.rows).toEqual([
      ['1', ''],
      ['2', 'x'],
    ]);
    expect(t.numeric).toEqual([true, false]);
  });
  it('bounds rows and columns', () => {
    const many = [['h'], ...Array.from({ length: MAX_TABLE_ROWS + 5 }, (_, i) => [String(i)])];
    expect(buildTable(many, true).omitted).toBe(5);
    expect(() => buildTable([Array.from({ length: 300 }, () => 'x')], true)).toThrow(/columns/);
  });
  it('renders an escaped grid for CSV and TSV resources', async () => {
    const out = await render(
      '<<<C type="text/csv"\nname,qty\n"<b>",3\nC\n<<<T type="text/tab-separated-values"\na\tb\nT\n',
    );
    expect(out).toContain('<table class="m2-grid" data-m2-source="csv">');
    expect(out).toContain('<td>&lt;b&gt;</td>');
    expect(out).toContain('<th align="right" data-m2-type="number">qty</th>');
    expect(out).toContain('data-m2-source="tsv"');
    expect(await render('<<<E type="text/csv"\nE\n')).toContain('This table is empty.');
  });
  it('csv fences are compatibility aliases', async () => {
    expect(await render('```csv\na,b\n1,2\n```\n')).toContain('class="m2-grid"');
  });
});
