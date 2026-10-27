/**
 * Interactive data grids over rendered tables: sortable columns, row filter,
 * hidable columns, resizable columns and rows.
 *
 * Applies to `table.m2-grid` (CSV/TSV resources) and to Markdown tables in
 * prose. The table's cells are never rewritten; only order, visibility and
 * sizes change. The toolbar lives in a closed shadow root, so document styles
 * cannot relabel its controls. State survives live re-renders, keyed by the
 * table's position and headings, and is cleared when another document opens.
 */

interface GridState {
  sort: { col: number; dir: 1 | -1 } | null;
  hidden: Set<number>;
  filter: string;
  filterCol: number;
  widths: number[] | null;
}

const MIN_W = 48;
const MIN_H = 24;
const EDGE = 5;

const states = new Map<string, GridState>();

/** Forget sort, filter and sizes, for example when another document opens. */
export function resetGridState(): void {
  states.clear();
}

const NUMBER = /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?%?$/;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** A cell's numeric value, if it reads as a number (`1,234.5`, `12%`). */
export function cellNumber(s: string): number | null {
  const t = s.trim();
  if (t === '' || !/\d/.test(t) || !NUMBER.test(t)) return null;
  const n = Number(t.replace(/[,%]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Sort order for two cells. Numbers compare numerically; empty cells always sort last. */
export function compareCells(a: string, b: string, dir: 1 | -1): number {
  const ea = a.trim() === '';
  const eb = b.trim() === '';
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  const na = cellNumber(a);
  const nb = cellNumber(b);
  const base = na !== null && nb !== null ? na - nb : collator.compare(a, b);
  return base * dir;
}

let sheet: CSSStyleSheet | undefined;
function toolbarSheet(): CSSStyleSheet {
  if (sheet) return sheet;
  sheet = new CSSStyleSheet();
  sheet.replaceSync(`
:host { all: initial; display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 0.6rem; margin: 0 0 0.5rem;
  font: 500 0.78rem/1.3 var(--sans, system-ui, sans-serif); color: var(--paper-ink, #25222c); }
input, select, button, summary { font: inherit; color: inherit; }
input[type='search'] { flex: 1 1 12rem; min-width: 8rem; padding: 0.38rem 0.6rem; border-radius: 7px;
  border: 1px solid var(--rule-strong, #cbbfa9); background: var(--paper, #fff); }
select { padding: 0.35rem 0.45rem; border-radius: 7px; border: 1px solid var(--rule-strong, #cbbfa9); background: var(--paper, #fff); }
details { position: relative; }
summary { list-style: none; cursor: pointer; padding: 0.38rem 0.7rem; border-radius: 7px;
  border: 1px solid var(--rule-strong, #cbbfa9); background: var(--surface, #fbf8f2); }
summary::-webkit-details-marker { display: none; }
summary::after { content: ' ▾'; }
.cols { position: absolute; z-index: 5; top: calc(100% + 4px); left: 0; min-width: 13rem; max-height: 16rem; overflow: auto;
  display: grid; gap: 0.15rem; padding: 0.5rem; border-radius: 10px; border: 1px solid var(--rule, #e0d7c7);
  background: var(--surface, #fbf8f2); box-shadow: 0 12px 30px -12px rgb(20 14 6 / 0.4); }
label { display: flex; align-items: center; gap: 0.45rem; padding: 0.2rem 0.3rem; border-radius: 6px; cursor: pointer; }
label:hover { background: var(--surface-2, #f3eee4); }
input[type='checkbox'] { accent-color: var(--teal, #0f6b5f); margin: 0; }
.count { color: var(--muted, #706979); font-variant-numeric: tabular-nums; }
button { padding: 0.38rem 0.7rem; border-radius: 7px; border: 1px solid var(--rule-strong, #cbbfa9);
  background: var(--surface, #fbf8f2); cursor: pointer; }
button:hover, summary:hover { border-color: var(--gold, #b0802a); }
:is(input, select, button, summary):focus-visible { outline: 2px solid var(--gold, #b0802a); outline-offset: 2px; }
@media print { :host { display: none; } }
`);
  return sheet;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Enhance every data table and prose table under `root`. Safe to call after each render. */
export function enhanceTables(root: HTMLElement): void {
  let index = 0;
  for (const t of root.querySelectorAll<HTMLTableElement>('table')) {
    if (t.dataset.m2Grid !== undefined) continue;
    const parent = t.parentElement?.localName;
    const prose = parent === 'md2-document' || parent === 'md2-section';
    if (!t.classList.contains('m2-grid') && !prose) continue;
    enhance(t, index++);
  }
}

function enhance(table: HTMLTableElement, index: number): void {
  const head = table.tHead?.rows[0];
  if (!head) return;
  const ths = Array.from(head.cells);
  const ncol = ths.length;
  const body = table.tBodies[0] ?? table.createTBody();
  const rows = Array.from(body.rows);
  const raw = rows.map((r) => Array.from({ length: ncol }, (_, c) => r.cells[c]?.textContent ?? ''));
  const lower = raw.map((r) => r.map((s) => s.toLowerCase()));
  const names = ths.map((th, c) => (th.textContent ?? '').trim() || `Column ${c + 1}`);

  const key = `${index}|${names.join('\u001f')}`;
  const st = states.get(key) ?? { sort: null, hidden: new Set<number>(), filter: '', filterCol: -1, widths: null };
  states.set(key, st);

  // Structure: toolbar, then a scroll box holding the unchanged table.
  table.dataset.m2Grid = '';
  const scroll = el('div', 'm2-grid-scroll');
  table.before(scroll);
  scroll.append(table);
  const host = document.createElement('m2-grid-tools');
  const root = host.attachShadow({ mode: 'closed' });
  root.adoptedStyleSheets = [toolbarSheet()];
  scroll.before(host);

  const filter = el('input');
  filter.type = 'search';
  filter.placeholder = 'Filter rows…';
  filter.setAttribute('aria-label', 'Filter rows');
  const scope = el('select');
  scope.setAttribute('aria-label', 'Column to filter');
  scope.append(new Option('in all columns', '-1'));
  names.forEach((n, c) => scope.append(new Option(`in ${n}`, String(c))));
  const details = el('details');
  details.append(el('summary', undefined, 'Columns'));
  const colList = el('div', 'cols');
  const boxes = names.map((n, c) => {
    const label = el('label');
    const box = el('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => {
      if (!box.checked && ncol - st.hidden.size <= 1) {
        box.checked = true; // keep at least one column
        return;
      }
      if (box.checked) st.hidden.delete(c);
      else st.hidden.add(c);
      applyHidden();
      applyFilter();
    });
    label.append(box, el('span', undefined, n));
    colList.append(label);
    return box;
  });
  details.append(colList);
  const count = el('span', 'count');
  count.setAttribute('aria-live', 'polite');
  const reset = el('button', undefined, 'Reset');
  reset.type = 'button';
  reset.title = 'Restore order, filter, columns and sizes';
  root.append(filter, scope, details, count, reset);

  // ------------------------------------------------------------ behaviour
  const fitWidth = (): void => {
    if (!st.widths) return;
    const w = st.widths.reduce((s, x, c) => (st.hidden.has(c) ? s : s + x), 0);
    table.style.width = `${w}px`;
  };
  const applyWidths = (): void => {
    if (!st.widths) {
      delete table.dataset.m2Fixed;
      table.style.width = '';
      for (const th of ths) th.style.width = '';
      return;
    }
    table.dataset.m2Fixed = '';
    ths.forEach((th, c) => {
      th.style.width = `${st.widths?.[c] ?? MIN_W}px`;
    });
    fitWidth();
  };
  /** Switch to fixed layout using the widths the browser chose. Needs the table to be visible. */
  const freeze = (): number[] => {
    if (!st.widths) {
      st.widths = ths.map((th) => Math.max(MIN_W, Math.round(th.getBoundingClientRect().width)));
      applyWidths();
    }
    return st.widths;
  };
  const setWidth = (c: number, w: number): void => {
    const widths = freeze();
    widths[c] = Math.max(MIN_W, Math.round(w));
    const th = ths[c];
    if (th) th.style.width = `${widths[c]}px`;
    fitWidth();
  };

  const applyHidden = (): void => {
    for (const r of [head, ...rows]) {
      for (let c = 0; c < ncol; c++) {
        const cell = r.cells[c];
        if (cell) cell.hidden = st.hidden.has(c);
      }
    }
    boxes.forEach((b, c) => {
      b.checked = !st.hidden.has(c);
    });
    fitWidth();
  };

  const applySort = (): void => {
    ths.forEach((th, c) => {
      const dir = st.sort?.col === c ? st.sort.dir : 0;
      th.setAttribute('aria-sort', dir === 1 ? 'ascending' : dir === -1 ? 'descending' : 'none');
    });
    const order = rows.map((_, i) => i);
    const s = st.sort;
    if (s) order.sort((a, b) => compareCells(raw[a]?.[s.col] ?? '', raw[b]?.[s.col] ?? '', s.dir) || a - b);
    const frag = document.createDocumentFragment();
    for (const i of order) {
      const r = rows[i];
      if (r) frag.append(r);
    }
    body.append(frag);
  };

  const applyFilter = (): void => {
    const q = st.filter.trim().toLowerCase();
    let shown = 0;
    rows.forEach((r, i) => {
      const cells = lower[i] ?? [];
      const ok =
        q === '' ||
        (st.filterCol >= 0
          ? (cells[st.filterCol] ?? '').includes(q)
          : cells.some((t, c) => !st.hidden.has(c) && t.includes(q)));
      r.hidden = !ok;
      if (ok) shown++;
    });
    const n = rows.length;
    count.textContent = q === '' ? `${n.toLocaleString()} row${n === 1 ? '' : 's'}` : `${shown.toLocaleString()} of ${n.toLocaleString()} rows`;
  };

  filter.addEventListener('input', () => {
    st.filter = filter.value;
    applyFilter();
  });
  scope.addEventListener('change', () => {
    st.filterCol = Number(scope.value);
    applyFilter();
  });
  reset.addEventListener('click', () => {
    st.sort = null;
    st.hidden.clear();
    st.filter = '';
    st.filterCol = -1;
    st.widths = null;
    filter.value = '';
    scope.value = '-1';
    for (const r of rows) {
      r.style.height = '';
      delete r.dataset.m2Tall;
    }
    applyHidden();
    applyWidths();
    applySort();
    applyFilter();
  });

  // Column headings: click to sort, drag the edge to resize, Alt+arrows to resize from the keyboard.
  ths.forEach((th, c) => {
    th.tabIndex = 0;
    th.title = 'Sort by this column. Drag the right edge to resize.';
    const cycle = (): void => {
      st.sort = st.sort?.col !== c ? { col: c, dir: 1 } : st.sort.dir === 1 ? { col: c, dir: -1 } : null;
      applySort();
    };
    th.addEventListener('click', (e) => {
      if (e.target instanceof Element && e.target.closest('a')) return;
      cycle();
    });
    th.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        cycle();
      } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        const widths = freeze();
        setWidth(c, (widths[c] ?? MIN_W) + (e.key === 'ArrowRight' ? 16 : -16));
      }
    });

    const grip = el('span', 'm2-col-resize');
    grip.setAttribute('aria-hidden', 'true');
    th.append(grip);
    grip.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    grip.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      st.widths = null;
      applyWidths();
    });
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = freeze()[c] ?? MIN_W;
      grip.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent): void => {
        setWidth(c, startW + ev.clientX - startX);
      };
      const up = (): void => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', up);
        grip.removeEventListener('pointercancel', up);
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
      grip.addEventListener('pointercancel', up);
    });
  });

  // Rows: drag the bottom edge of a row to resize it; double-click the edge to reset.
  let dragging = false;
  const rowAt = (e: MouseEvent): HTMLTableRowElement | null => {
    const tr = e.target instanceof Element ? e.target.closest('tr') : null;
    if (!tr || tr.parentElement !== body) return null;
    return e.clientY >= tr.getBoundingClientRect().bottom - EDGE ? tr : null;
  };
  body.addEventListener('pointermove', (e) => {
    if (!dragging) body.style.cursor = rowAt(e) ? 'row-resize' : '';
  });
  body.addEventListener('pointerleave', () => {
    if (!dragging) body.style.cursor = '';
  });
  body.addEventListener('pointerdown', (e) => {
    const tr = e.button === 0 ? rowAt(e) : null;
    if (!tr) return;
    e.preventDefault();
    dragging = true;
    const startY = e.clientY;
    const startH = tr.getBoundingClientRect().height;
    tr.dataset.m2Tall = '';
    body.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent): void => {
      tr.style.height = `${Math.max(MIN_H, Math.round(startH + ev.clientY - startY))}px`;
    };
    const up = (): void => {
      dragging = false;
      body.removeEventListener('pointermove', move);
      body.removeEventListener('pointerup', up);
      body.removeEventListener('pointercancel', up);
    };
    body.addEventListener('pointermove', move);
    body.addEventListener('pointerup', up);
    body.addEventListener('pointercancel', up);
  });
  body.addEventListener('dblclick', (e) => {
    const tr = rowAt(e);
    if (!tr) return;
    tr.style.height = '';
    delete tr.dataset.m2Tall;
  });

  // Restore state from before the last re-render.
  filter.value = st.filter;
  scope.value = String(st.filterCol);
  applyHidden();
  applyWidths();
  applySort();
  applyFilter();
}