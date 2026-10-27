import { escapeHtml } from './html.js';

/**
 * Delimited data tables: `text/csv` (RFC 4180) and `text/tab-separated-values`.
 * Parsing is lenient but bounded; rendering is a plain, escaped HTML table that
 * readers may enhance (sorting, filtering) without changing its content.
 */

export const MAX_TABLE_BYTES = 8 * 1024 * 1024;
export const MAX_TABLE_ROWS = 10_000;
export const MAX_TABLE_COLUMNS = 256;

export type Delimited = 'csv' | 'tsv';

export interface DataTable {
  head: string[];
  rows: string[][];
  /** Columns whose non-empty cells are all numbers. */
  numeric: boolean[];
  /** Rows beyond {@link MAX_TABLE_ROWS}, not included in `rows`. */
  omitted: number;
}

/**
 * RFC 4180 CSV: quoted fields, doubled quotes inside them, CRLF or LF.
 * Lenient: a quote inside an unquoted field is literal, and an unclosed
 * quote runs to the end of the input. Blank lines are skipped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let atStart = true;
  const endField = (): void => {
    row.push(field);
    field = '';
    atStart = true;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (quoted) {
      if (c !== '"') field += c;
      else if (text.charAt(i + 1) === '"') {
        field += '"';
        i++;
      } else quoted = false;
      continue;
    }
    if (c === '"' && atStart) {
      quoted = true;
      atStart = false;
      continue;
    }
    if (c === ',') {
      endField();
      continue;
    }
    if (c === '\n' || c === '\r') {
      if (c === '\r' && text.charAt(i + 1) === '\n') i++;
      endField();
      rows.push(row);
      row = [];
      continue;
    }
    field += c;
    atStart = false;
  }
  if (!atStart || row.length > 0) {
    endField();
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** IANA `text/tab-separated-values`: fields separated by tabs, no quoting. Blank lines are skipped. */
export function parseTsv(text: string): string[][] {
  return text
    .split(/\r\n|\n|\r/)
    .filter((l) => l !== '')
    .map((l) => l.split('\t'));
}

/** RFC 4180 `header` parameter: present unless the type says `header=absent`. */
export function headerPresent(type: string | undefined): boolean {
  const m = /;\s*header\s*=\s*"?([A-Za-z]+)"?/i.exec(type ?? '');
  return m?.[1]?.toLowerCase() !== 'absent';
}

const NUMBER = /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?%?$/;

export function isNumericCell(s: string): boolean {
  const t = s.trim();
  return t !== '' && /\d/.test(t) && NUMBER.test(t);
}

/** Shape parsed cells into a table: a header row, padded rows, numeric columns. */
export function buildTable(cells: readonly (readonly string[])[], header: boolean): DataTable {
  const width = cells.reduce((w, r) => Math.max(w, r.length), 0);
  if (width > MAX_TABLE_COLUMNS) throw new Error(`more than ${MAX_TABLE_COLUMNS} columns`);
  const fit = (r: readonly string[]): string[] => Array.from({ length: width }, (_, k) => r[k] ?? '');
  const first = cells[0];
  const head = header && first !== undefined ? fit(first) : Array.from({ length: width }, (_, k) => `Column ${k + 1}`);
  const body = header ? cells.slice(1) : cells;
  const rows = body.slice(0, MAX_TABLE_ROWS).map(fit);
  const numeric = head.map((_, k) => {
    let any = false;
    for (const r of rows) {
      const v = r[k] ?? '';
      if (v.trim() === '') continue;
      if (!isNumericCell(v)) return false;
      any = true;
    }
    return any;
  });
  return { head, rows, numeric, omitted: Math.max(0, body.length - MAX_TABLE_ROWS) };
}

/** Escaped HTML for a data table (style.md §4.1: ordinary table elements). */
export function tableHtml(t: DataTable, kind: Delimited): string {
  if (t.head.length === 0) return '<p class="m2-grid-note">This table is empty.</p>';
  const attrs = (k: number): string => (t.numeric[k] === true ? ' align="right"' : '');
  const head = t.head
    .map((h, k) => `<th${attrs(k)}${t.numeric[k] === true ? ' data-m2-type="number"' : ''}>${escapeHtml(h)}</th>`)
    .join('');
  const body = t.rows.map((r) => `<tr>${r.map((v, k) => `<td${attrs(k)}>${escapeHtml(v)}</td>`).join('')}</tr>`);
  const note =
    t.omitted > 0
      ? `\n<p class="m2-grid-note">Showing the first ${t.rows.length} rows; ${t.omitted} more are not shown.</p>`
      : '';
  return `<table class="m2-grid" data-m2-source="${kind}">\n<thead>\n<tr>${head}</tr>\n</thead>\n<tbody>\n${body.join('\n')}\n</tbody>\n</table>${note}`;
}
