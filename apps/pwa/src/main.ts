import {
  appliedSheets,
  applyBatchGrant,
  batchScope,
  ByteQuota,
  collectResources,
  composeCascade,
  defaultHandlers,
  GrantSet,
  selectionFor,
  type DecodeState,
  type Diagnostic,
  type ResolvedResource,
  type StyleModel,
  type StyleSelection,
} from '@markdown2/core';
import { createBrowserUriPolicy, createRegistry, type KeyGrant } from './decoders.js';
import { downloadBytes, fromFile, fromHandle, openDocument, saveDocument, type OpenedDocument } from './files.js';
import { describeNode, nextGate, runPipeline, type PipelineResult } from './pipeline.js';
import { SAMPLE } from './sample.js';
import { planSave } from './save-plan.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

const editor = $<HTMLTextAreaElement>('editor');
const preview = $('preview');
const statusEl = $('status');
const diagList = $('diag-list');
const fileInput = $<HTMLInputElement>('file-input');

const DRAFT_KEY = 'm2.draft';
const ORIGINS_KEY = 'm2.uri-origins';
const STYLE_PREFS_KEY = 'm2.style-prefs';
const USER_CSS_KEY = 'm2.user-css';
const DOC_STYLES_KEY = 'm2.doc-styles';

// ---------------------------------------------------------------- state
const registry = createRegistry();
const handlers = defaultHandlers();
let grants = new GrantSet(); // in memory only; cleared on tab close
let origins = loadOrigins();
const uriPolicy = createBrowserUriPolicy({ origins: () => origins });
let current: PipelineResult | null = null;
let controller: AbortController | null = null;
let seq = 0;
let fileName = 'untitled.md';
let fileHandle: FileSystemFileHandle | undefined;

// Styles (style.md §6). Constructable stylesheets are not subject to CSP style-src.
const cascadeSheet = new CSSStyleSheet();
document.adoptedStyleSheets = [...document.adoptedStyleSheets, cascadeSheet];
let docStyles = localStorage.getItem(DOC_STYLES_KEY) !== 'off';
let overrides = new Map<string, string | boolean>();
const prefs = loadPrefs();
let userCss = localStorage.getItem(USER_CSS_KEY) ?? '';

function setStatus(s: string): void {
  statusEl.textContent = s;
}

function loadOrigins(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ORIGINS_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
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

// ---------------------------------------------------------------- pipeline
async function refresh(): Promise<void> {
  controller?.abort();
  const ctl = new AbortController();
  controller = ctl;
  const mine = ++seq;
  try {
    const r = await runPipeline(editor.value, { registry, grants, handlers, uriPolicy, signal: ctl.signal });
    if (mine !== seq) return; // a newer run superseded this one
    current = r;
    preview.innerHTML = r.html; // renderHtml escapes everything it emits
    applyStyles();
    renderStylePanel(r.styles);
    renderResourcePanel(r);
    showDiagnostics(r.diagnostics);
  } catch (e) {
    if (mine === seq) setStatus(`Render failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
function schedule(): void {
  clearTimeout(timer);
  timer = setTimeout(() => {
    localStorage.setItem(DRAFT_KEY, editor.value);
    void refresh();
  }, 250);
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
  const unstyled = $('unstyled');
  unstyled.setAttribute('aria-pressed', String(!docStyles));
  if (!current) return;
  const author = docStyles ? appliedSheets(current.styles, currentSelection(current.styles)) : [];
  const quota = new ByteQuota(Math.max(0, current.quota.limit - current.quota.used));
  try {
    cascadeSheet.replaceSync(composeCascade({ author, user: userCss.trim() === '' ? [] : [userCss], quota }));
  } catch (e) {
    setStatus(`Styles not applied: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function checkboxRow(text: string, checked: boolean, onChange: (on: boolean) => void): HTMLLabelElement {
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.addEventListener('change', () => {
    onChange(box.checked);
  });
  label.append(box, ` ${text}`);
  return label;
}

/** Style controls live in reader chrome, outside the styled surface (§8.3). */
function renderStylePanel(model: StyleModel): void {
  const panel = $('style-controls');
  panel.replaceChildren();
  const sel = currentSelection(model);
  panel.append(
    checkboxRow('Use document styles', docStyles, (on) => {
      docStyles = on;
      applyStyles();
    }),
    checkboxRow('Off by default for every document', localStorage.getItem(DOC_STYLES_KEY) === 'off', (on) => {
      localStorage.setItem(DOC_STYLES_KEY, on ? 'off' : 'on');
    }),
  );
  if (model.groups.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'This document offers no style choices.';
    panel.append(p);
    return;
  }
  for (const g of model.groups) {
    const prefix = g.scopeLabel === undefined ? '' : `${g.scopeLabel} › `;
    if (g.kind === 'toggle') {
      const unavailable = g.members[0]?.css === null ? ' (unavailable)' : '';
      panel.append(
        checkboxRow(`${prefix}${g.name}${unavailable}`, sel.get(g.key) === true, (on) => {
          overrides.set(g.key, on);
          prefs.toggles.set(g.name, on);
          savePrefs();
          applyStyles();
        }),
      );
      continue;
    }
    const label = document.createElement('label');
    label.textContent = `${prefix}${g.name} `;
    const select = document.createElement('select');
    for (const m of g.members) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = `${m.title ?? `(untitled ${m.id})`}${m.css === null ? ' (unavailable)' : ''}`;
      o.selected = sel.get(g.key) === m.id;
      select.append(o);
    }
    select.addEventListener('change', () => {
      overrides.set(g.key, select.value);
      const m = g.members.find((x) => x.id === select.value);
      if (m?.title !== undefined) prefs.choices.set(g.name, m.title);
      savePrefs();
      applyStyles();
    });
    label.append(select);
    panel.append(label);
  }
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
    },
    { once: true },
  );
  dialog.showModal();
}

// ---------------------------------------------------------------- resource actions
const ICON: Record<DecodeState, string> = { decoded: '✅', locked: '🔒', unsupported: '❔', failed: '⚠️' };

function addButton(bar: HTMLElement, text: string, label: string, onClick: () => void): void {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  bar.append(b);
}

/**
 * Decode states and grant controls are shown in reader chrome, never inside
 * the styled preview, where document CSS could fake or hide them (§8.3).
 */
function renderResourcePanel(r: PipelineResult): void {
  const list = $('res-list');
  list.replaceChildren();
  $('res-title').textContent = `Resources (${r.resources.size})`;
  for (const entry of r.resources.values()) {
    const li = document.createElement('li');
    const label = describeNode(entry.node);
    const { state, error } = entry.result;
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'link';
    go.textContent = `${ICON[state]} ${label}: ${error === undefined ? state : `${state} (${error})`}`;
    go.addEventListener('click', () => {
      document.getElementById(`m2-${entry.node.id}`)?.scrollIntoView({ block: 'nearest' });
    });
    li.append(go);
    if (state === 'locked') addButton(li, 'Unlock…', `Unlock ${label}`, () => void unlock(entry));
    if (state === 'decoded') addButton(li, 'Save', `Save ${label}`, () => save(entry, 'decoded'));
    addButton(li, 'Save raw', `Save raw payload of ${label}`, () => save(entry, 'raw'));
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
    if (!confirm(`Fetch "${label}" from\n${uri}\n\nThe server will learn that you opened this document. Only this resource is allowed.`)) return;
    grants.grant(node, gate.stage);
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
    setStatus(`Key rejected for ${label}`);
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

// ---------------------------------------------------------------- diagnostics
function jumpToLine(line: number): void {
  const lines = editor.value.split('\n');
  let start = 0;
  for (let k = 0; k < line && k < lines.length; k++) start += (lines[k]?.length ?? 0) + 1;
  editor.focus();
  editor.setSelectionRange(start, start + (lines[line]?.length ?? 0));
  const lh = Number.parseFloat(getComputedStyle(editor).lineHeight) || 20;
  editor.scrollTop = Math.max(0, line * lh - editor.clientHeight / 3);
}

function showDiagnostics(diags: readonly Diagnostic[]): void {
  diagList.replaceChildren();
  $('diag-title').textContent = `Diagnostics (${diags.length})`;
  for (const d of diags) {
    const li = document.createElement('li');
    const where = d.nodeId === undefined ? '' : ` [${d.nodeId}]`;
    const text = `${d.line + 1}: ${d.code}${where}: ${d.message}`;
    // Lines of nested documents are relative to their own payload: no jump.
    if (d.nodeId === undefined || !d.nodeId.includes('/')) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'link';
      b.textContent = text;
      b.addEventListener('click', () => {
        jumpToLine(d.line);
      });
      li.append(b);
    } else {
      li.textContent = text;
    }
    diagList.append(li);
  }
}

// ---------------------------------------------------------------- documents
function load(doc: OpenedDocument): void {
  editor.value = doc.text;
  fileName = doc.name;
  fileHandle = doc.handle;
  grants = new GrantSet(); // keys never carry over to another document
  overrides = new Map(); // per-document selections start from defaults and preferences
  docStyles = localStorage.getItem(DOC_STYLES_KEY) !== 'off';
  document.title = `${doc.name} · Markdown2`;
  localStorage.setItem(DRAFT_KEY, doc.text);
  setStatus('');
  void refresh();
}

async function saveDoc(): Promise<void> {
  try {
    fileHandle = (await saveDocument(editor.value, fileName, fileHandle)) ?? fileHandle;
    setStatus('Saved');
  } catch (e) {
    setStatus(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function editPolicy(): void {
  const answer = prompt(
    'Origins allowed to serve remote resources (https only, space separated).\nLeave empty to keep every uri resource locked.',
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
  void refresh();
}

// ---------------------------------------------------------------- wiring
editor.addEventListener('input', schedule);
editor.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    void saveDoc();
  }
});
$('open').addEventListener('click', () => {
  void openDocument(fileInput).then((d) => {
    if (d) load(d);
  });
});
$('save-doc').addEventListener('click', () => void saveDoc());
$('policy').addEventListener('click', editPolicy);
$('forget').addEventListener('click', () => {
  grants = new GrantSet();
  setStatus('Keys forgotten');
  void refresh();
});
// One command to reach an unstyled view (style.md §6.2).
$('unstyled').addEventListener('click', () => {
  docStyles = !docStyles;
  applyStyles();
  if (current) renderStylePanel(current.styles);
});
$('user-styles').addEventListener('click', editUserStyles);

document.addEventListener('dragover', (e) => {
  e.preventDefault();
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files[0];
  if (f) void fromFile(f).then(load);
});

window.launchQueue?.setConsumer((params) => {
  const h = params.files[0];
  if (h?.kind === 'file') void fromHandle(h as FileSystemFileHandle).then(load);
});

// Share target (GET) and initial content.
const params = new URLSearchParams(location.search);
const shared = params.get('text');
if (shared !== null) {
  history.replaceState(null, '', location.pathname);
  load({ name: `${params.get('title') ?? 'shared'}.md`, text: shared });
} else {
  editor.value = localStorage.getItem(DRAFT_KEY) ?? SAMPLE;
  void refresh();
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