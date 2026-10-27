import {
  appliedSheets,
  applyBatchGrant,
  batchScope,
  ByteQuota,
  collectResources,
  composeCascade,
  GrantSet,
  selectionFor,
  type DecodeState,
  type Diagnostic,
  type ResolvedResource,
  type ResourceNode,
  type StyleModel,
  type StyleSelection,
  type StyleGroup,
} from '@markdown2/core';
import { createBrowserUriPolicy, createRegistry, type KeyGrant } from './decoders.js';
import { DOCS } from './docs.js';
import { downloadBytes, fromFile, fromHandle, openDocument, saveDocument, type OpenedDocument } from './files.js';
import { installFrameHost } from './frames.js';
import { codeFence, createHandlers, remoteNeed, type RemoteNeed } from './handlers.js';
import { describeNode, gatedStages, nextGate, runPipeline, type PipelineResult } from './pipeline.js';
import { docLinkTarget, docNameFor, fetchDocument, resolveDocUrl } from './remote-doc.js';
import { SAMPLE } from './sample.js';
import { planSave } from './save-plan.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

const editor = $<HTMLTextAreaElement>('editor');
const preview = $('preview');
const statusEl = $('status');
const diagList = $('diag-list');
const fileInput = $<HTMLInputElement>('file-input');
const gutterLines = $('gutter-lines');
const cursorEl = $('cursor');
const wordsEl = $('words');
const saveStateEl = $('save-state');
const docNameEl = $('doc-name');
const diagSummary = $<HTMLButtonElement>('diag-summary');
const dropEl = $('drop');
const helpBtn = $<HTMLButtonElement>('help-btn');
const helpMenu = $('help-menu');

const DRAFT_KEY = 'm2.draft';
const ORIGINS_KEY = 'm2.uri-origins';
const STYLE_PREFS_KEY = 'm2.style-prefs';
const USER_CSS_KEY = 'm2.user-css';
const DOC_STYLES_KEY = 'm2.doc-styles';
const VIEW_KEY = 'm2.view';
const INSPECTOR_KEY = 'm2.inspector';
const THEME_KEY = 'm2.theme';

const MOD = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? '⌘' : 'Ctrl';
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const narrow = window.matchMedia('(max-width: 900px)');

// ---------------------------------------------------------------- state
const registry = createRegistry();
const handlers = createHandlers({ remoteAllowed, appOrigin: location.origin });
let grants = new GrantSet(); // in memory only; cleared on tab close
/** Per-resource permission to load embedded pages and charts (§5.5). In memory only. */
let embeds = new GrantSet();
let origins = loadOrigins();
const uriPolicy = createBrowserUriPolicy({ origins: () => origins });
let current: PipelineResult | null = null;
let controller: AbortController | null = null;
let seq = 0;
let fileName = 'untitled.md';
let fileHandle: FileSystemFileHandle | undefined;
/** Text as last opened from or saved to a file; null for a local draft. */
let savedText: string | null = null;
/** Where the open document came from, when it was opened through `?url=`. */
let docUrl: URL | null = null;
/** Whether edits are autosaved as the local draft. Off for documents opened by URL. */
let autosave = true;
/** Address of the open document, restored when a Back/Forward navigation is cancelled. */
let currentHref = location.href;

// Styles (style.md §6). Constructable stylesheets are not subject to CSP style-src.
const cascadeSheet = new CSSStyleSheet();
document.adoptedStyleSheets = [...document.adoptedStyleSheets, cascadeSheet];
let docStyles = localStorage.getItem(DOC_STYLES_KEY) !== 'off';
let overrides = new Map<string, string | boolean>();
const prefs = loadPrefs();
let userCss = localStorage.getItem(USER_CSS_KEY) ?? '';

let statusTimer: ReturnType<typeof setTimeout> | undefined;
function setStatus(s: string, sticky = false): void {
  clearTimeout(statusTimer);
  statusEl.textContent = s;
  statusEl.classList.remove('flash');
  if (s === '') return;
  void statusEl.offsetWidth; // restart the animation
  statusEl.classList.add('flash');
  if (!sticky) {
    statusTimer = setTimeout(() => {
      statusEl.textContent = '';
    }, 6000);
  }
}

function loadOrigins(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ORIGINS_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}
/** Embedded pages and charts load only with a per-resource grant or a user-allowed origin. */
function remoteAllowed(node: ResourceNode | undefined, origin: string): boolean {
  return (node !== undefined && embeds.has(node, 0)) || origins.has(origin);
}
/** "Always allow this site": adds the origin to the user's list, which Remote… edits. */
function allowOrigin(origin: string): void {
  origins = new Set([...origins, origin]);
  localStorage.setItem(ORIGINS_KEY, JSON.stringify([...origins]));
  setStatus(`Always allowing ${new URL(origin).host}. Manage the list with Remote…`);
}
function httpsUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.username === '' && u.password === '' ? u : null;
  } catch {
    return null;
  }
}


function loadPrefs(): { choices: Map<string, string>; toggles: Map<string, boolean> } {
  const out = { choices: new Map<string, string>(), toggles: new Map<string, boolean>() };
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STYLE_PREFS_KEY) ?? '{}');
    if (typeof raw !== 'object' || raw === null) return out;
    const r = raw as Record<string, unknown>;
    if (Array.isArray(r.choices)) {
      for (const e of r.choices as unknown[]) {
        if (Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string') out.choices.set(e[0], e[1]);
      }
    }
    if (Array.isArray(r.toggles)) {
      for (const e of r.toggles as unknown[]) {
        if (Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'boolean') out.toggles.set(e[0], e[1]);
      }
    }
  } catch {
    // ignore corrupt preferences
  }
  return out;
}

function savePrefs(): void {
  localStorage.setItem(STYLE_PREFS_KEY, JSON.stringify({ choices: [...prefs.choices], toggles: [...prefs.toggles] }));
}

// ---------------------------------------------------------------- workspace: theme, layout, inspector
type Theme = 'auto' | 'light' | 'dark';
const storedTheme = localStorage.getItem(THEME_KEY);
let theme: Theme = storedTheme === 'light' || storedTheme === 'dark' ? storedTheme : 'auto';

function applyTheme(): void {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const name = theme.charAt(0).toUpperCase() + theme.slice(1);
  $('theme-label').textContent = name;
  $('theme').title = `Theme: ${name} (click to change)`;
}
function isDark(): boolean {
  return theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}
installFrameHost(isDark);

type View = 'write' | 'split' | 'read';
const isView = (v: unknown): v is View => v === 'write' || v === 'split' || v === 'read';

function setView(v: View): void {
  document.body.dataset.view = v;
  localStorage.setItem(VIEW_KEY, v);
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-set-view]')) {
    b.setAttribute('aria-pressed', String(b.dataset.setView === v));
  }
  if (v === 'write' || v === 'split') editor.focus({ preventScroll: true });
}

function setInspector(open: boolean, remember = true): void {
  document.body.dataset.inspector = open ? 'open' : 'closed';
  $('inspector-toggle').setAttribute('aria-pressed', String(open));
  if (remember) localStorage.setItem(INSPECTOR_KEY, open ? 'open' : 'closed');
}

type Tab = 'diag' | 'res' | 'style';
const TABS: Tab[] = ['diag', 'res', 'style'];

function selectTab(t: Tab, focus = false): void {
  for (const x of TABS) {
    const tab = $(`tab-${x}`);
    const on = x === t;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $(`panel-${x}`).hidden = !on;
    if (on && focus) tab.focus();
  }
}

function openInspectorAt(t: Tab): void {
  setInspector(true);
  selectTab(t, true);
}

// ---------------------------------------------------------------- editor: gutter, cursor, counts
let gutterCount = 0;
let currentLine = 0;
let diagLines = new Map<number, string[]>();

function renderGutter(force = false): void {
  const n = editor.value.split('\n').length;
  if (!force && n === gutterCount) return;
  gutterCount = n;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const d = el('div', 'gl', String(i + 1));
    const msgs = diagLines.get(i);
    if (msgs) {
      d.classList.add('diag');
      d.title = msgs.join('\n');
      d.dataset.line = String(i);
    }
    if (i === currentLine) d.classList.add('current');
    frag.append(d);
  }
  gutterLines.replaceChildren(frag);
}

function syncGutter(): void {
  gutterLines.style.transform = `translateY(${-editor.scrollTop}px)`;
}

function updateCursor(): void {
  const pos = editor.selectionStart;
  const before = editor.value.slice(0, pos);
  const line = before.split('\n').length - 1;
  const col = pos - (before.lastIndexOf('\n') + 1);
  const selected = editor.selectionEnd - editor.selectionStart;
  cursorEl.textContent = `Ln ${line + 1}, Col ${col + 1}${selected > 0 ? ` · ${selected} selected` : ''}`;
  if (line !== currentLine) {
    gutterLines.children[currentLine]?.classList.remove('current');
    currentLine = line;
    gutterLines.children[line]?.classList.add('current');
  }
}

function updateCounts(): void {
  const t = editor.value.trim();
  const words = t === '' ? 0 : t.split(/\s+/).length;
  wordsEl.textContent = `${words.toLocaleString()} word${words === 1 ? '' : 's'} · ${editor.value.length.toLocaleString()} chars`;
}

function updateSaveState(): void {
   if (docUrl !== null) {
     const dirty = savedText !== editor.value;
     saveStateEl.dataset.state = dirty ? 'dirty' : 'saved';
     saveStateEl.textContent = dirty
       ? `Edited copy from ${docUrl.host} · not autosaved`
       : `Opened from ${docUrl.host} · edits not autosaved`;
     return;
   }
  if (savedText === null) {
    saveStateEl.dataset.state = 'draft';
    saveStateEl.textContent = 'Local draft · autosaved';
  } else if (savedText === editor.value) {
    saveStateEl.dataset.state = 'saved';
    saveStateEl.textContent = 'Saved';
  } else {
    saveStateEl.dataset.state = 'dirty';
    saveStateEl.textContent = 'Unsaved changes · draft autosaved';
  }
}

function setDocName(name: string): void {
  fileName = name;
  docNameEl.textContent = name;
  document.title = `${name} · Markdown2`;
}

// ---------------------------------------------------------------- pipeline
async function refresh(): Promise<void> {
  controller?.abort();
  const ctl = new AbortController();
  controller = ctl;
  const mine = ++seq;
  try {
    const r = await runPipeline(editor.value, { registry, grants, handlers, uriPolicy, codeFence, signal: ctl.signal });
    if (mine !== seq) return; // a newer run superseded this one
    current = r;
    preview.innerHTML = r.html; // renderHtml escapes everything it emits
    applyStyles();
    renderStylePanel(r.styles);
    renderResourcePanel(r);
    decoratePreview(r);
    showDiagnostics(r.diagnostics);
  } catch (e) {
    if (mine === seq) setStatus(`Render failed: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
function schedule(): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
     timer = undefined;
     if (autosave) localStorage.setItem(DRAFT_KEY, editor.value);
    updateCounts();
    void refresh();
  }, 250);
}
/** Write a pending autosave now, before the editor content is replaced. */
function flushDraft(): void {
   if (timer === undefined) return;
   clearTimeout(timer);
   timer = undefined;
   if (autosave) localStorage.setItem(DRAFT_KEY, editor.value);
}

// ---------------------------------------------------------------- styles
function currentSelection(model: StyleModel): StyleSelection {
  const sel = selectionFor(model, prefs);
  for (const g of model.groups) {
    const o = overrides.get(g.key);
    if (o === undefined) continue;
    const valid = g.kind === 'toggle' ? typeof o === 'boolean' : g.members.some((m) => m.id === o);
    if (valid) sel.set(g.key, o);
  }
  return sel;
}

function applyStyles(): void {
  $('unstyled').setAttribute('aria-pressed', String(!docStyles));
  const tag = $('style-state');
  tag.textContent = docStyles ? 'Document styles' : 'Unstyled';
  tag.dataset.off = String(!docStyles);
  if (!current) return;
  const author = docStyles ? appliedSheets(current.styles, currentSelection(current.styles)) : [];
  const quota = new ByteQuota(Math.max(0, current.quota.limit - current.quota.used));
  try {
    cascadeSheet.replaceSync(composeCascade({ author, user: userCss.trim() === '' ? [] : [userCss], quota }));
  } catch (e) {
    setStatus(`Styles not applied: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

function toggleUnstyled(): void {
  docStyles = !docStyles;
  applyStyles();
  if (current) {
    renderStylePanel(current.styles);
    renderInlineStyles(current.styles);
  }
  setStatus(docStyles ? 'Document styles on' : 'Unstyled view');
}

function checkboxRow(text: string, checked: boolean, onChange: (on: boolean) => void): HTMLLabelElement {
  const label = el('label', 'opt');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.addEventListener('change', () => {
    onChange(box.checked);
  });
  label.append(box, el('span', undefined, text));
  return label;
}

/** Style controls live in reader chrome, outside the styled surface (§8.3). */
function renderStylePanel(model: StyleModel): void {
  const panel = $('style-controls');
  panel.replaceChildren();
  const sel = currentSelection(model);
  panel.append(
    el('h3', 'panel-sub', 'Reader'),
    checkboxRow('Use document styles', docStyles, (on) => {
      docStyles = on;
      applyStyles();
      if (current) renderInlineStyles(current.styles);
    }),
    checkboxRow('Off by default for every document', localStorage.getItem(DOC_STYLES_KEY) === 'off', (on) => {
      localStorage.setItem(DOC_STYLES_KEY, on ? 'off' : 'on');
    }),
    el('h3', 'panel-sub', 'This document'),
  );
  if (model.groups.length === 0) {
    panel.append(el('p', 'panel-note', 'This document offers no style choices.'));
    return;
  }
  for (const g of model.groups) {
    const prefix = g.scopeLabel === undefined ? '' : `${g.scopeLabel} › `;
    if (g.kind === 'toggle') {
      const unavailable = g.members[0]?.css === null ? ' (unavailable)' : '';
      panel.append(
        checkboxRow(`${prefix}${g.name}${unavailable}`, sel.get(g.key) === true, (on) => {
          setToggle(g, on, 'panel');
        }),
      );
      continue;
    }
    const label = el('label', 'opt');
    label.append(el('span', undefined, `${prefix}${g.name}`));
    const select = el('select');
    for (const m of g.members) {
      const o = el('option', undefined, `${m.title ?? `(untitled ${m.id})`}${m.css === null ? ' (unavailable)' : ''}`);
      o.value = m.id;
      o.selected = sel.get(g.key) === m.id;
      select.append(o);
    }
    select.addEventListener('change', () => {
      setChoice(g, select.value, 'panel');
    });
    label.append(select);
    panel.append(label);
  }
}
// ---------------------------------------------------------------- inline controls in the page
/**
* Inline controls sit next to the resource or stylesheet they act on. They
* live in closed shadow roots, so document styles can hide or move the host
* but cannot relabel or restyle its contents. They never grant anything
* themselves: every grant still goes through a dialog in reader chrome
* (style.md §8.3), and the inspector panels remain the authoritative view.
*/
const inlineSheet = new CSSStyleSheet();
inlineSheet.replaceSync(`
:host { all: initial; display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem 0.6rem;
  font: 600 0.78rem/1.25 var(--sans, system-ui, sans-serif); color: var(--paper-ink, #25222c); }
:host([kind='actions']) { margin-top: 0.65rem; }
:host([kind='style']) { width: fit-content; max-width: 100%; box-sizing: border-box; margin: 0 0 1rem;
  padding: 0.4rem 0.7rem; border: 1px solid var(--rule, #e0d7c7); border-radius: 10px;
  background: var(--surface, #fbf8f2); font-weight: 500; }
button { font: inherit; font-weight: 600; padding: 0.45rem 0.85rem; border-radius: 7px;
  border: 1px solid var(--teal, #0f6b5f); background: var(--teal, #0f6b5f); color: var(--on-teal, #fff); cursor: pointer; }
button:hover { filter: brightness(1.08); }
.k { font-size: 0.62rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted, #706979); font-weight: 600; }
label { display: inline-flex; align-items: center; gap: 0.5rem; cursor: pointer; }
input { accent-color: var(--teal, #0f6b5f); width: 1rem; height: 1rem; margin: 0; }
select { font: inherit; padding: 0.3rem 0.45rem; border-radius: 7px; border: 1px solid var(--rule-strong, #cbbfa9);
  background: var(--paper, #fff); color: inherit; }
:is(button, input, select):focus-visible { outline: 2px solid var(--gold, #b0802a); outline-offset: 2px; }
@media print { :host { display: none; } }
`);
function shadowHost(tag: string, kind: 'actions' | 'style'): [HTMLElement, ShadowRoot] {
  const host = document.createElement(tag);
  host.setAttribute('kind', kind);
  const root = host.attachShadow({ mode: 'closed' });
  root.adoptedStyleSheets = [inlineSheet];
  return [host, root];
}
type StyleSource = 'panel' | 'inline';
let inlineStyleSync: (() => void)[] = [];
function setToggle(g: StyleGroup, on: boolean, from: StyleSource): void {
  overrides.set(g.key, on);
  prefs.toggles.set(g.name, on);
  savePrefs();
  styleChanged(from);
}
function setChoice(g: StyleGroup, id: string, from: StyleSource): void {
  overrides.set(g.key, id);
  const m = g.members.find((x) => x.id === id);
  if (m?.title !== undefined) prefs.choices.set(g.name, m.title);
  savePrefs();
  styleChanged(from);
}
/** Apply, then bring the other set of controls up to date without stealing focus. */
function styleChanged(from: StyleSource): void {
  applyStyles();
  if (from === 'inline' && current) renderStylePanel(current.styles);
  for (const sync of inlineStyleSync) sync();
}
/** One control per group, placed where the group's first stylesheet sits in its document. */
function renderInlineStyles(model: StyleModel): void {
  for (const e of preview.querySelectorAll('m2-style-control')) e.remove();
  inlineStyleSync = [];
  if (!docStyles) return; // the controls would do nothing
  for (const g of model.groups) {
    const first = g.members[0];
    if (!first) continue;
    document.getElementById(`m2-${first.id}`)?.before(styleControl(model, g));
  }
}
function styleControl(model: StyleModel, g: StyleGroup): HTMLElement {
  const [host, root] = shadowHost('m2-style-control', 'style');
  const label = el('label');
  const name = el('span', undefined, g.name);
  if (g.kind === 'toggle') {
    const box = el('input');
    box.type = 'checkbox';
    box.disabled = g.members[0]?.css === null;
    const sync = (): void => {
      box.checked = currentSelection(model).get(g.key) === true;
    };
    sync();
    inlineStyleSync.push(sync);
    box.addEventListener('change', () => {
      setToggle(g, box.checked, 'inline');
    });
    label.append(box, name);
  } else {
    const select = el('select');
    for (const m of g.members) {
      const o = el('option', undefined, `${m.title ?? `(untitled ${m.id})`}${m.css === null ? ' (unavailable)' : ''}`);
      o.value = m.id;
      select.append(o);
    }
    const sync = (): void => {
      const v = currentSelection(model).get(g.key);
      if (typeof v === 'string') select.value = v;
    };
    sync();
    inlineStyleSync.push(sync);
    select.addEventListener('change', () => {
      setChoice(g, select.value, 'inline');
    });
    label.append(name, select);
  }
  root.append(el('span', 'k', 'Style'), label);
  return host;
}

function editUserStyles(): void {
  const dialog = $<HTMLDialogElement>('user-css');
  const text = $<HTMLTextAreaElement>('user-css-text');
  text.value = userCss;
  dialog.returnValue = '';
  dialog.addEventListener(
    'close',
    () => {
      if (dialog.returnValue !== 'ok') return;
      userCss = text.value;
      localStorage.setItem(USER_CSS_KEY, userCss);
      applyStyles();
      setStatus('Your styles were saved');
    },
    { once: true },
  );
  dialog.showModal();
}

// ---------------------------------------------------------------- resource actions
const STATE_LABEL: Record<DecodeState, string> = {
  decoded: 'Decoded',
  locked: 'Locked',
  unsupported: 'Unsupported',
  failed: 'Failed',
};

function addButton(bar: HTMLElement, text: string, label: string, onClick: () => void, primary = false): void {
  const b = el('button', primary ? 'btn primary' : 'btn', text);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  bar.append(b);
}

function emptyState(text: string, code?: string): HTMLLIElement {
  const li = el('li', 'empty', text);
  if (code !== undefined) {
    li.append(el('br'), el('code', undefined, code));
  }
  return li;
}

/** Scroll the preview to a resource and let it glow briefly. */
function revealInPreview(id: string): void {
  if (document.body.dataset.view === 'write') setView('split');
  if (narrow.matches) setInspector(false, false);
  const target = document.getElementById(`m2-${id}`);
  if (!target) return;
  target.scrollIntoView({ block: 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  if (!reduceMotion.matches) {
    target.animate(
      [
        { boxShadow: '0 0 0 0 rgba(200, 151, 63, 0)' },
        { boxShadow: '0 0 0 6px rgba(200, 151, 63, 0.45)' },
        { boxShadow: '0 0 0 0 rgba(200, 151, 63, 0)' },
      ],
      { duration: 1400, easing: 'ease-out' },
    );
  }
}

/**
 * Decode states and grant controls are shown in reader chrome, never inside
 * the styled preview, where document CSS could fake or hide them (§8.3).
 */
function renderResourcePanel(r: PipelineResult): void {
  const list = $('res-list');
  list.replaceChildren();
  const count = $('res-count');
  count.textContent = String(r.resources.size);
  const locked = [...r.resources.values()].some((e) => e.result.state === 'locked');
  if (locked) count.dataset.tone = 'bad';
  else delete count.dataset.tone;
  if (r.resources.size === 0) {
    list.append(emptyState('No resources yet. Embed one with', '<<<NAME type="text/plain"'));
    return;
  }
  for (const entry of r.resources.values()) {
    const li = el('li', 'res');
    const label = describeNode(entry.node);
    const { state, error } = entry.result;
    li.dataset.state = state;

    const go = el('button', 'res-name');
    go.type = 'button';
    go.title = 'Show in the page';
    const seal = el('span', 'seal');
    seal.setAttribute('aria-hidden', 'true');
    go.append(seal, el('span', undefined, label));
    go.setAttribute('aria-label', `${label}: ${state}${error === undefined ? '' : ` (${error})`}. Show in the page.`);
    go.addEventListener('click', () => {
      revealInPreview(entry.node.id);
    });

    const meta = el('div', 'res-meta');
    meta.append(el('span', 'chip', STATE_LABEL[state]));
    if (error !== undefined) meta.append(el('span', 'chip err', error));
    const enc = entry.node.resource.encoding.join(' ');
    meta.append(el('span', undefined, `${entry.node.resource.type ?? '(no type)'}${enc === 'utf-8' ? '' : ` · ${enc}`}`));

    const actions = el('div', 'res-actions');
    if (state === 'locked') addButton(actions, 'Unlock…', `Unlock ${label}`, () => void unlock(entry), true);
    const need =
      state === 'decoded' && entry.result.bytes !== undefined
        ? remoteNeed(entry.node.resource.type, entry.result.bytes, location.origin)
        : null;
    if (need !== null && !remoteAllowed(entry.node, need.origin)) {
      meta.append(el('span', 'chip', 'Not loaded'));
      addButton(actions, 'Load…', `Load ${label} from ${need.label}`, () => void allowRemote(entry, need), true);
    }
    if (state === 'decoded') addButton(actions, 'Save', `Save ${label}`, () => save(entry, 'decoded'));
    addButton(actions, 'Save raw', `Save raw payload of ${label}`, () => save(entry, 'raw'));

    li.append(go, meta, actions);
    list.append(li);
  }
}

function save(entry: ResolvedResource, form: 'raw' | 'decoded'): void {
  const plan = planSave(entry, form);
  if (!plan) return;
  let name = plan.name;
  if (
    plan.requested !== undefined &&
    confirm(
      `The document asks to save this as "${plan.requested}".\n\nThat extension may execute or render actively when opened. Use it instead of "${plan.name}"?`,
    )
  ) {
    name = plan.requested;
  }
  downloadBytes(plan.bytes, name);
  setStatus(`Downloaded ${name}`);
}
/** Permission for a view that reaches the network: this resource once, or the whole site from now on. */
async function allowRemote(entry: ResolvedResource, need: RemoteNeed): Promise<void> {
  const label = describeNode(entry.node);
  const choice = await askRemote(
    label,
    need.label,
    new URL(need.origin).host,
    'Its content runs in a sandboxed frame and cannot reach this app.',
  );
  if (choice === null) return;
  if (choice === 'always') allowOrigin(need.origin);
  else embeds.grant(entry.node, 0);
  await refresh();
}

type RemoteChoice = 'once' | 'always';

/** One dialog, in reader chrome, for every remote load. `alwaysHost` null hides "always allow". */
function askRemote(label: string, where: string, alwaysHost: string | null, detail: string): Promise<RemoteChoice | null> {
  const dialog = $<HTMLDialogElement>('remote');
  $('remote-title').textContent = `Load from ${where}?`;
  $('remote-desc').textContent = `“${label}” wants to load content from ${where}. That site will learn that you opened this document. ${detail}`;
  const always = $<HTMLButtonElement>('remote-always');
  always.hidden = alwaysHost === null;
  always.textContent = alwaysHost === null ? 'Always allow this site' : `Always allow ${alwaysHost}`;
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        const v = dialog.returnValue;
        resolve(v === 'once' ? 'once' : v === 'always' && alwaysHost !== null ? 'always' : null);
      },
      { once: true },
    );
    dialog.returnValue = '';
    dialog.showModal();
  });
}


function askKey(description: string): Promise<KeyGrant | null> {
  const dialog = $<HTMLDialogElement>('unlock');
  const form = dialog.querySelector('form');
  if (!form) return Promise.resolve(null);
  $('unlock-desc').textContent = description;
  form.reset();
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        const data = new FormData(form);
        form.reset(); // do not leave the key in the DOM
        if (dialog.returnValue !== 'ok') {
          resolve(null);
          return;
        }
        const kind = data.get('kind') === 'identity' ? 'identity' : 'passphrase';
        const raw = data.get('key');
        const value = typeof raw === 'string' ? (kind === 'identity' ? raw.trim() : raw) : '';
        resolve(value === '' ? null : { kind, value });
      },
      { once: true },
    );
    dialog.returnValue = '';
    dialog.showModal();
  });
}

/** Per-resource unlock (§5.5). Never triggered automatically. */
async function unlock(entry: ResolvedResource): Promise<void> {
  const { node } = entry;
  const gate = nextGate(node, registry, grants);
  if (!gate) return;
  const label = describeNode(node);

  if (gate.decoder.id === 'uri') {
    const uri = new TextDecoder().decode(node.resource.payload).trim();
    const u = httpsUrl(uri);
    const choice = await askRemote(
      label,
      u?.host ?? uri,
      u === null ? null : u.host,
      'Whatever it sends is treated as the declared type, nothing else.',
    );
    if (choice === null) return;
    if (choice === 'always' && u !== null) allowOrigin(u.origin);
    else grants.grant(node, gate.stage);
    await refresh();
    return;
  }

  const keyStages = node.resource.encoding
    .map((id, stage) => ({ id, stage }))
    .filter(({ id }) => registry.get(id)?.capability === 'key');
  const layer = keyStages.findIndex((s) => s.stage === gate.stage) + 1;
  const key = await askKey(`${label}: layer ${layer} of ${keyStages.length} (${gate.decoder.id})`);
  if (!key) return;
  grants.grant(node, gate.stage, key);
  await refresh();
  if (current?.resources.get(node.id)?.result.error === 'key-rejected') {
    setStatus(`Key rejected for ${label}`, true);
    return;
  }
  setStatus('');
  await offerBatch(node.id, gate.decoder.id, key);
}

/** Explicit batch grant with its scope shown first; children revealed later are excluded. */
async function offerBatch(exceptId: string, decoderId: string, key: KeyGrant): Promise<void> {
  if (!current) return;
  const nodes = collectResources(current.resolved)
    .filter((e) => e.result.state === 'locked' && e.node.id !== exceptId)
    .map((e) => e.node);
  const scope = batchScope(nodes, decoderId, grants);
  if (scope.length === 0) return;
  const names = [...new Set(scope.map((t) => describeNode(t.node)))];
  if (
    !confirm(
      `Use the same key for ${names.length} other locked resource(s)?\n\n${names.join('\n')}\n\nResources revealed later are not included.`,
    )
  )
    return;
  applyBatchGrant(grants, scope, key);
  await refresh();
}
interface InlineAction {
  text: string;
  label: string;
  run: () => void;
}
/** What a resource's inline button should offer, if anything. */
function inlineActions(entry: ResolvedResource): InlineAction[] {
  const { node, result } = entry;
  const label = describeNode(node);
  if (result.state === 'locked') {
    const gate = gatedStages(node, registry, grants)[0];
    if (gate?.decoder.id === 'uri') {
      const host = httpsUrl(new TextDecoder().decode(node.resource.payload).trim())?.host ?? 'the web';
      return [{ text: `Load from ${host}…`, label: `Load ${label} from ${host}`, run: () => void unlock(entry) }];
    }
    return [{ text: '🔒 Unlock…', label: `Unlock ${label}`, run: () => void unlock(entry) }];
  }
  if (result.state === 'decoded' && result.bytes !== undefined) {
    const need = remoteNeed(node.resource.type, result.bytes, location.origin);
    if (need !== null && !remoteAllowed(node, need.origin)) {
      const host = new URL(need.origin).host;
      return [{ text: `Load from ${host}…`, label: `Load ${label} from ${need.label}`, run: () => void allowRemote(entry, need) }];
    }
  }
  return [];
}
/** Put load/unlock buttons next to each resource, and style controls next to their stylesheets. */
function decoratePreview(r: PipelineResult): void {
  for (const entry of r.resources.values()) {
    const actions = inlineActions(entry);
    if (actions.length === 0) continue;
    const res = document.getElementById(`m2-${entry.node.id}`);
    if (!res || res.dataset.m2Shown !== undefined) continue;
    const slot = res.querySelector(':scope > md2-view .m2-load-slot') ?? res.querySelector(':scope > md2-fallback');
    if (!slot) continue;
    const [host, root] = shadowHost('m2-actions', 'actions');
    for (const a of actions) {
      const b = el('button', undefined, a.text);
      b.type = 'button';
      b.setAttribute('aria-label', a.label);
      b.addEventListener('click', a.run);
      root.append(b);
    }
    slot.append(host);
  }
  renderInlineStyles(r.styles);
}

// ---------------------------------------------------------------- diagnostics
function jumpToLine(line: number): void {
  if (document.body.dataset.view === 'read') setView('split');
  const lines = editor.value.split('\n');
  let start = 0;
  for (let k = 0; k < line && k < lines.length; k++) start += (lines[k]?.length ?? 0) + 1;
  editor.focus();
  editor.setSelectionRange(start, start + (lines[line]?.length ?? 0));
  const lh = Number.parseFloat(getComputedStyle(editor).lineHeight) || 22;
  editor.scrollTop = Math.max(0, line * lh - editor.clientHeight / 3);
  syncGutter();
  updateCursor();
}

function showDiagnostics(diags: readonly Diagnostic[]): void {
  diagList.replaceChildren();
  diagLines = new Map();
  const n = diags.length;
  const count = $('diag-count');
  count.textContent = String(n);
  count.dataset.tone = n > 0 ? 'bad' : 'ok';
  diagSummary.textContent = n === 0 ? '✓ Well-formed' : `${n} diagnostic${n === 1 ? '' : 's'}`;
  diagSummary.dataset.tone = n > 0 ? 'bad' : 'ok';
  if (n === 0) diagList.append(emptyState('No diagnostics. The document is well-formed.'));

  for (const d of diags) {
    // Lines of nested documents are relative to their own payload: no jump.
    const jumpable = d.nodeId === undefined || !d.nodeId.includes('/');
    const li = el('li');
    const line = el('span', 'diag-line', jumpable ? `L${d.line + 1}` : `↳${d.line + 1}`);
    const code = el('span', 'diag-code', d.nodeId === undefined ? d.code : `${d.code} · ${d.nodeId}`);
    const msg = el('span', 'diag-msg', d.message);
    if (jumpable) {
      const arr = diagLines.get(d.line) ?? [];
      arr.push(`${d.code}: ${d.message}`);
      diagLines.set(d.line, arr);
      const b = el('button', 'diag');
      b.type = 'button';
      b.setAttribute('aria-label', `Line ${d.line + 1}: ${d.code}. ${d.message}. Jump to line.`);
      b.addEventListener('click', () => {
        jumpToLine(d.line);
      });
      b.append(line, code, msg);
      li.append(b);
    } else {
      const div = el('div', 'diag static');
      div.title = 'Line numbers inside nested documents are relative to their own payload.';
      div.append(line, code, msg);
      li.append(div);
    }
    diagList.append(li);
  }
  renderGutter(true);
}

// ---------------------------------------------------------------- documents
type DocSource = { kind: 'file' } | { kind: 'share' } | { kind: 'draft' } | { kind: 'url'; url: URL };

function load(doc: OpenedDocument, source: DocSource = { kind: 'file' }): void {
   flushDraft();
  editor.value = doc.text;
  setDocName(doc.name);
  fileHandle = doc.handle;
   docUrl = source.kind === 'url' ? source.url : null;
   // Documents opened by URL (such as the help pages) never overwrite the local draft.
   autosave = source.kind !== 'url';
   savedText = source.kind === 'file' || source.kind === 'url' ? doc.text : null;
  grants = new GrantSet(); // keys never carry over to another document
  embeds = new GrantSet();
  overrides = new Map(); // per-document selections start from defaults and preferences
  docStyles = localStorage.getItem(DOC_STYLES_KEY) !== 'off';
   if (source.kind === 'file' || source.kind === 'share') localStorage.setItem(DRAFT_KEY, doc.text);
   if (source.kind !== 'url' && new URLSearchParams(location.search).has('url')) {
     history.replaceState(null, '', location.pathname);
   }
   currentHref = location.href;
  editor.scrollTop = 0;
  editor.setSelectionRange(0, 0);
  syncGutter();
  renderGutter(true);
  updateCursor();
  updateCounts();
  updateSaveState();
   setStatus(source.kind === 'draft' ? 'Back to your draft' : `Opened ${doc.name}`);
  void refresh();
}

function openDoc(): void {
  void openDocument(fileInput).then((d) => {
    if (d) load(d);
  });
}

async function saveDoc(): Promise<void> {
  const text = editor.value;
  try {
    const outcome = await saveDocument(text, fileName, fileHandle);
    if (outcome.kind === 'cancelled') {
      setStatus('Save cancelled');
      return;
    }
    if (outcome.kind === 'file') {
      fileHandle = outcome.handle;
      setDocName(outcome.handle.name);
    }
     if (docUrl !== null) {
       // Saved: from now on this is an ordinary document with an autosaved draft.
       docUrl = null;
       autosave = true;
       localStorage.setItem(DRAFT_KEY, text);
       history.replaceState(null, '', location.pathname);
       currentHref = location.href;
     }
    savedText = text;
    updateSaveState();
    setStatus(outcome.kind === 'file' ? `Saved ${fileName}` : `Downloaded ${fileName}`);
  } catch (e) {
    setStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`, true);
  }
}

function editPolicy(): void {
  const answer = prompt(
    'Origins allowed to serve remote resources, embedded pages and charts (https only, space separated).\nFor Google Charts, add https://www.gstatic.com.\nLeave empty to keep everything remote locked.',
    [...origins].join(' '),
  );
  if (answer === null) return;
  const next = new Set<string>();
  const bad: string[] = [];
  for (const part of answer.split(/\s+/).filter(Boolean)) {
    try {
      const u = new URL(part);
      if (u.protocol !== 'https:') throw new Error('not https');
      next.add(u.origin);
    } catch {
      bad.push(part);
    }
  }
  if (bad.length > 0) alert(`Ignored: ${bad.join(', ')}`);
  origins = next;
  localStorage.setItem(ORIGINS_KEY, JSON.stringify([...next]));
  setStatus(next.size === 0 ? 'Every remote resource stays locked' : `${next.size} origin(s) allowed`);
  void refresh();
}

function openKeys(): void {
  const dialog = $<HTMLDialogElement>('help');
  if (!dialog.open) dialog.showModal();
}
// ---------------------------------------------------------------- documents by URL, help menu
type Nav = 'push' | 'replace' | 'none';
/** Unsaved edits to a URL document are not autosaved; ask before discarding them. */
function confirmDiscard(): boolean {
   if (autosave || savedText === null || savedText === editor.value) return true;
   return confirm('This document was opened from a URL and your edits are not autosaved. Discard them?');
}
function urlParamFor(u: URL): string {
   const v = u.origin === location.origin ? `${u.pathname}${u.search}` : u.href;
   return encodeURIComponent(v).replace(/%2F/gi, '/').replace(/%3A/gi, ':');
}
let opening: AbortController | null = null;
/**
  * Open a document by URL. Same-origin documents open directly; others ask
  * first. Opening a document never unlocks or fetches anything inside it.
  */
async function openUrl(raw: string, nav: Nav): Promise<boolean> {
   const u = resolveDocUrl(raw, location.href);
   if (u === null) {
     setStatus(`Cannot open "${raw}": use a path on this site or an https: URL`, true);
     return false;
   }
   const same = u.origin === location.origin;
   if (
     !same &&
     !confirm(
       `Open the document at\n${u.href}?\n\nThat server will learn that you opened it. Nothing inside the document is unlocked or fetched.`,
     )
   ) {
     setStatus('Not opened');
     return false;
   }
   opening?.abort();
   const ctl = new AbortController();
   opening = ctl;
   setStatus(`Opening ${same ? u.pathname : u.href}…`, true);
   try {
     const text = await fetchDocument(u, { sameOrigin: same, signal: ctl.signal });
     if (opening !== ctl) return false;
     const target = `${location.pathname}?url=${urlParamFor(u)}`;
     if (nav === 'push') history.pushState(null, '', target);
     else if (nav === 'replace') history.replaceState(null, '', target);
     load({ name: docNameFor(u), text }, { kind: 'url', url: u });
     currentHref = location.href;
     return true;
   } catch (e) {
     if (opening === ctl) setStatus(`Could not open ${u.href}: ${e instanceof Error ? e.message : String(e)}`, true);
     return false;
   } finally {
     if (opening === ctl) opening = null;
   }
}
function navigateTo(raw: string): void {
   if (confirmDiscard()) void openUrl(raw, 'push');
}
function openDraft(nav: Nav): void {
   if (nav === 'push') history.pushState(null, '', location.pathname);
   else if (nav === 'replace') history.replaceState(null, '', location.pathname);
   load({ name: 'untitled.md', text: localStorage.getItem(DRAFT_KEY) ?? SAMPLE }, { kind: 'draft' });
}
function promptUrl(): void {
   const raw = prompt('Open a Markdown2 document from a URL.\nA path on this site (/docs/guide.md) or an https: address.', '');
   if (raw !== null && raw.trim() !== '') navigateTo(raw.trim());
}
function menuItem(title: string, sub: string | undefined, onClick: () => void): HTMLButtonElement {
   const b = el('button', 'menu-item');
   b.type = 'button';
   b.tabIndex = -1;
   b.setAttribute('role', 'menuitem');
   b.append(el('span', 'menu-title', title));
   if (sub !== undefined) b.append(el('span', 'menu-sub', sub));
   b.addEventListener('click', () => {
     closeHelpMenu();
     onClick();
   });
   return b;
}
function buildHelpMenu(): void {
   const here = docUrl !== null && docUrl.origin === location.origin ? docUrl.pathname : null;
   helpMenu.replaceChildren(el('div', 'menu-head', 'Documentation'));
   for (const d of DOCS) {
     const item = menuItem(d.title, d.summary, () => {
       navigateTo(d.path);
     });
     if (d.path === here) item.setAttribute('aria-current', 'page');
     helpMenu.append(item);
   }
   const sep = el('div', 'menu-sep');
   sep.setAttribute('role', 'separator');
   helpMenu.append(sep);
   if (docUrl !== null) {
     helpMenu.append(
       menuItem('Back to my draft', 'Your autosaved local draft', () => {
         if (confirmDiscard()) openDraft('push');
       }),
     );
   }
   helpMenu.append(menuItem('Open a URL…', 'A path on this site or an https: address', promptUrl));
   helpMenu.append(menuItem('Keyboard shortcuts', 'Press ? at any time', openKeys));
}
function openHelpMenu(): void {
   buildHelpMenu();
   helpMenu.hidden = false;
   helpBtn.setAttribute('aria-expanded', 'true');
   helpMenu.querySelector<HTMLButtonElement>('.menu-item')?.focus();
}
function closeHelpMenu(focusButton = false): void {
   if (helpMenu.hidden) return;
   helpMenu.hidden = true;
   helpBtn.setAttribute('aria-expanded', 'false');
   if (focusButton) helpBtn.focus();
}

// ---------------------------------------------------------------- wiring
editor.addEventListener('input', () => {
  renderGutter();
  updateCursor();
  updateSaveState();
  schedule();
});
for (const type of ['keyup', 'click', 'select', 'focus'] as const) editor.addEventListener(type, updateCursor);
editor.addEventListener('scroll', syncGutter, { passive: true });
gutterLines.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('.gl.diag');
  if (t?.dataset.line !== undefined) jumpToLine(Number(t.dataset.line));
});

$('open').addEventListener('click', openDoc);
$('save-doc').addEventListener('click', () => void saveDoc());
$('policy').addEventListener('click', editPolicy);
$('forget').addEventListener('click', () => {
  grants = new GrantSet();
  embeds = new GrantSet();
  setStatus('Keys forgotten');
  void refresh();
});
// One command to reach an unstyled view (style.md §6.2).
$('unstyled').addEventListener('click', toggleUnstyled);
$('user-styles').addEventListener('click', editUserStyles);
$('inspector-toggle').addEventListener('click', () => {
  setInspector(document.body.dataset.inspector !== 'open');
});
$('theme').addEventListener('click', () => {
  theme = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto';
  localStorage.setItem(THEME_KEY, theme);
  applyTheme();
  void refresh(); // frames pick up the new theme
});
helpBtn.addEventListener('click', () => {
   if (helpMenu.hidden) openHelpMenu();
   else closeHelpMenu();
});
helpMenu.addEventListener('keydown', (e) => {
   const items = [...helpMenu.querySelectorAll<HTMLButtonElement>('.menu-item')];
   if (items.length === 0) return;
   const at = items.findIndex((b) => b === document.activeElement);
   let next: number;
   if (e.key === 'ArrowDown') next = (at + 1) % items.length;
   else if (e.key === 'ArrowUp') next = at <= 0 ? items.length - 1 : at - 1;
   else if (e.key === 'Home') next = 0;
   else if (e.key === 'End') next = items.length - 1;
   else if (e.key === 'Escape') {
     e.preventDefault();
     closeHelpMenu(true);
     return;
   } else if (e.key === 'Tab') {
     closeHelpMenu();
     return;
   } else return;
   e.preventDefault();
   items[next]?.focus();
});
document.addEventListener('pointerdown', (e) => {
   if (helpMenu.hidden) return;
   const t = e.target;
   if (t instanceof Node && !helpMenu.contains(t) && !helpBtn.contains(t)) closeHelpMenu();
});
diagSummary.addEventListener('click', () => {
  openInspectorAt('diag');
});
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-set-view]')) {
  b.addEventListener('click', () => {
    if (isView(b.dataset.setView)) setView(b.dataset.setView);
  });
}
for (const x of TABS) {
  $(`tab-${x}`).addEventListener('click', () => {
    selectTab(x);
  });
}
$('inspector')
  .querySelector('[role="tablist"]')
  ?.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    const at = TABS.findIndex((x) => $(`tab-${x}`).getAttribute('aria-selected') === 'true');
    let next = at;
    if (ke.key === 'ArrowRight') next = (at + 1) % TABS.length;
    else if (ke.key === 'ArrowLeft') next = (at - 1 + TABS.length) % TABS.length;
    else if (ke.key === 'Home') next = 0;
    else if (ke.key === 'End') next = TABS.length - 1;
    else return;
    ke.preventDefault();
    const t = TABS[next];
    if (t) selectTab(t, true);
  });

const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLInputElement ||
  t instanceof HTMLTextAreaElement ||
  t instanceof HTMLSelectElement ||
  (t instanceof HTMLElement && t.isContentEditable);

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
   if (e.key === 'Escape' && !helpMenu.hidden) {
     closeHelpMenu(true);
     return;
   }
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && e.shiftKey && !e.altKey && key === 'u') {
    e.preventDefault();
    toggleUnstyled();
    return;
  }
  if (mod && !e.shiftKey && !e.altKey) {
    const views: Record<string, View> = { '1': 'write', '2': 'split', '3': 'read' };
    const v = Object.hasOwn(views, key) ? views[key] : undefined;
    if (v) {
      e.preventDefault();
      setView(v);
      return;
    }
    if (key === 's') {
      e.preventDefault();
      void saveDoc();
    } else if (key === 'o') {
      e.preventDefault();
      openDoc();
    } else if (key === '.') {
      e.preventDefault();
      setInspector(document.body.dataset.inspector !== 'open');
    }
    return;
  }
  if (e.key === '?' && !isTyping(e.target)) {
    e.preventDefault();
     openKeys();
  }
});

// Drag and drop, with an overlay that says what will happen. Drags that start
// inside the app (an image, a link, text in the page) never drop back into it:
// the browser would otherwise open the dragged image as a document, or navigate
// a frame to it, with no way back.
let dragDepth = 0;
let dragSource: 'outside' | 'editor' | 'app' = 'outside';
const hasFiles = (e: DragEvent): boolean => e.dataTransfer?.types.includes('Files') ?? false;
document.addEventListener('dragstart', (e) => {
  dragSource = e.target === editor ? 'editor' : 'app';
  document.body.dataset.dragging = ''; // frames ignore the pointer while dragging
});
document.addEventListener('dragend', () => {
  dragSource = 'outside';
  delete document.body.dataset.dragging;
});
document.addEventListener('dragenter', (e) => {
  if (dragSource !== 'outside' || !hasFiles(e)) return;
  dragDepth++;
  dropEl.hidden = false;
});
document.addEventListener('dragleave', (e) => {
  if (dragSource !== 'outside' || !hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropEl.hidden = true;
});
document.addEventListener('dragover', (e) => {
  if (dragSource === 'app') {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'; // no drop target anywhere
    return;
  }
  // Text dragged within or into the editor is ordinary editing.
  if (dragSource === 'editor' || (e.target === editor && !hasFiles(e))) return;
  e.preventDefault();
});
document.addEventListener('drop', (e) => {
  const fromApp = dragSource !== 'outside';
  if (e.target === editor && !hasFiles(e) && dragSource !== 'app') return;
  e.preventDefault();
  dragDepth = 0;
  dropEl.hidden = true;
  if (fromApp) return;
  const f = e.dataTransfer?.files[0];
  if (f) void fromFile(f).then((d) => load(d));
});

window.launchQueue?.setConsumer((params) => {
  const h = params.files[0];
  if (h?.kind === 'file') void fromHandle(h as FileSystemFileHandle).then((d) => load(d));
});
// Links between documents opened by URL stay in the app; Back and Forward work.
preview.addEventListener('click', (e) => {
   if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
   const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
   if (!(a instanceof HTMLAnchorElement)) return;
   const target = docLinkTarget(a.getAttribute('href') ?? '', docUrl, location.href);
   if (target === null) return;
   e.preventDefault();
   navigateTo(target);
});
window.addEventListener('popstate', () => {
   if (!confirmDiscard()) {
     history.pushState(null, '', currentHref);
     return;
   }
   const p = new URLSearchParams(location.search).get('url');
   if (p !== null && p !== '') void openUrl(p, 'none');
   else openDraft('none');
});

// ---------------------------------------------------------------- start
for (const b of document.querySelectorAll<HTMLElement>('[data-tip]')) {
  const sc = b.dataset.shortcut;
  const tip = b.dataset.tip ?? '';
  b.title = sc === undefined ? tip : `${tip} (${sc.replace('Mod', MOD)})`;
}
for (const k of document.querySelectorAll('.kbd-mod')) k.textContent = MOD;

applyTheme();
const storedView = localStorage.getItem(VIEW_KEY);
setView(isView(storedView) ? storedView : 'split');
const storedInspector = localStorage.getItem(INSPECTOR_KEY);
setInspector(storedInspector === null ? !narrow.matches : storedInspector === 'open', false);
selectTab('diag');

// Share target (GET), `?url=` and initial content.
const params = new URLSearchParams(location.search);
const shared = params.get('text');
const urlParam = params.get('url');

function startDraft(): void {
  editor.value = localStorage.getItem(DRAFT_KEY) ?? SAMPLE;
  setDocName(fileName);
  renderGutter(true);
  updateCursor();
  updateCounts();
  updateSaveState();
  void refresh();
}
if (shared !== null) {
   history.replaceState(null, '', location.pathname);
   load({ name: `${params.get('title') ?? 'shared'}.md`, text: shared }, { kind: 'share' });
} else if (urlParam !== null && urlParam !== '') {
   setDocName(fileName);
   void openUrl(urlParam, 'replace').then((ok) => {
     if (ok) return;
     history.replaceState(null, '', location.pathname);
     currentHref = location.href;
     startDraft();
   });
} else {
   startDraft();
}

// Offline support and update prompt.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  let updating = false;
  const updateBtn = $('update');
  void navigator.serviceWorker.register('/sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          updateBtn.hidden = false;
          updateBtn.onclick = () => {
            updating = true;
            w.postMessage('skip-waiting');
          };
        }
      });
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updating) location.reload();
  });
}