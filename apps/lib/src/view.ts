import {
  appliedSheets,
  applyBatchGrant,
  batchScope,
  ByteQuota,
  collectResources,
  collectStyles,
  composeCascade,
  DEFAULT_LIMITS,
  GrantSet,
  parse,
  renderHtml,
  resolveDocument,
  safeSaveName,
  selectionFor,
  typeEssence,
  type DecodeState,
  type Decoder,
  type DecoderRegistry,
  type Diagnostic,
  type Limits,
  type ResolvedResource,
  type ResourceNode,
  type StyleModel,
  type UriPolicy,
} from '@markdown2/core';
import { defaultCss } from './css.js';
import { createBrowserUriPolicy, createRegistry, isKeyGrant, resolveRemoteUri, type KeyGrant } from './decoders.js';
import { builtinHandlers, coreRegistry, handlerMap, type Md2Handler, type RemoteNeed } from './handlers.js';

/**
 * A live, permission-aware Markdown2 view.
 *
 * - Nothing unlocks or fetches on its own (§5.5). Each key, fetch and remote
 *   view needs an explicit grant, given through `consent` (built-in dialogs by
 *   default) or by the app calling `unlock()` / `load()` / `allowOrigin()`.
 * - Grants are per resource, bound to the payload, never inherited by children.
 * - The document renders in a shadow root: its stylesheets are sanitised and
 *   scoped, and cannot reach the host page. Inline buttons live in closed
 *   shadow roots, and consent dialogs sit outside the styled surface.
 */

export interface ResourceInfo {
  id: string;
  /** Title, else filename, else type. */
  label: string;
  title?: string;
  type?: string;
  encoding: string[];
  rel: string;
  state: DecodeState;
  error?: string;
  size: number;
  /** What the resource waits for, if anything. */
  needs: 'key' | 'remote' | null;
  remote?: { origin: string | null; host: string };
  line: number;
  /** Inside a nested document. */
  nested: boolean;
}

export type ConsentRequest =
  | { kind: 'key'; resource: ResourceInfo; layer: number; layers: number; decoder: string }
  | { kind: 'remote'; resource: ResourceInfo; origin: string | null; host: string; reason: 'fetch' | 'view' }
  | { kind: 'batch'; resources: ResourceInfo[]; decoder: string }
  | { kind: 'save-name'; resource: ResourceInfo; safeName: string; requested: string };

/** key → KeyGrant | null · remote → 'once' | 'always' | null · batch / save-name → boolean */
export type ConsentAnswer = KeyGrant | 'once' | 'always' | boolean | null;
export type ConsentHandler = (request: ConsentRequest) => Promise<ConsentAnswer>;

export interface ViewState {
  resources: ResourceInfo[];
  diagnostics: Diagnostic[];
  origins: string[];
}

export interface MountOptions {
  handlers?: readonly Md2Handler[];
  decoders?: readonly Decoder[];
  /** `https:` origins trusted without asking (uri fetches and remote views). */
  allowOrigins?: Iterable<string>;
  /** Base for relative `uri` references. */
  baseUrl?: string | URL;
  limits?: Partial<Limits>;
  /** Replace the built-in consent dialogs. */
  consent?: ConsentHandler;
  /** Show Unlock… / Load… buttons on resources. Default true. */
  inlineControls?: boolean;
  /** Apply the document's own stylesheets. Default true (shadow mode only). */
  documentStyles?: boolean;
  theme?: 'auto' | 'light' | 'dark';
  /** Render inside a shadow root. Default true. */
  shadow?: boolean;
  onChange?: (state: ViewState) => void;
}

export interface Markdown2View {
  readonly root: ShadowRoot | HTMLElement;
  /** Settles after the first render. */
  readonly ready: Promise<void>;
  update(src: string): Promise<void>;
  refresh(): Promise<void>;
  state(): ViewState;
  /** Grant the next gated stage: a key (prompted unless given) or a fetch. Resolves true when granted and accepted. */
  unlock(id: string, key?: KeyGrant): Promise<boolean>;
  /** Allow a decoded resource's view to reach the network: this resource once, or its whole origin. */
  load(id: string, scope?: 'once' | 'always'): Promise<boolean>;
  allowOrigin(origin: string): Promise<void>;
  revokeOrigin(origin: string): Promise<void>;
  /** Drop every key and per-resource grant. Allowed origins stay. */
  forget(): Promise<void>;
  /** Download raw or decoded bytes, never under an active extension without consent (§6.2). */
  download(id: string, form: 'raw' | 'decoded'): Promise<void>;
  setDocumentStyles(on: boolean): void;
  destroy(): void;
}

interface Gate {
  stage: number;
  decoder: Decoder;
}

function gatedStages(node: ResourceNode, registry: DecoderRegistry, grants: GrantSet): Gate[] {
  const out: Gate[] = [];
  node.resource.encoding.forEach((id, stage) => {
    const decoder = registry.get(id);
    if (decoder?.capability !== undefined && !grants.has(node, stage)) out.push({ stage, decoder });
  });
  return out;
}

/** Next stage to grant. If every gate is granted yet the node is locked, a key was rejected: start over. */
function nextGate(node: ResourceNode, registry: DecoderRegistry, grants: GrantSet): Gate | null {
  const pending = gatedStages(node, registry, grants);
  if (pending[0]) return pending[0];
  node.resource.encoding.forEach((id, stage) => {
    if (registry.get(id)?.capability !== undefined) grants.revoke(node, stage);
  });
  return gatedStages(node, registry, grants)[0] ?? null;
}

function firstCapability(node: ResourceNode, registry: DecoderRegistry): Gate | null {
  for (const [stage, id] of node.resource.encoding.entries()) {
    const decoder = registry.get(id);
    if (decoder?.capability !== undefined) return { stage, decoder };
  }
  return null;
}

function describeNode(node: ResourceNode): string {
  const a = node.resource.attributes;
  return a.get('title') ?? a.get('filename') ?? node.resource.type ?? '(untyped resource)';
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls !== undefined) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function normaliseOrigin(o: string): string | null {
  try {
    const u = new URL(o);
    return u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** Download bytes as `application/octet-stream`, so the browser never renders them by type. */
export function downloadBytes(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }));
  const a = el('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

// ------------------------------------------------------------------ shared sheets

let themeSheet: CSSStyleSheet | null = null;
function sharedTheme(): CSSStyleSheet {
  if (!themeSheet) {
    themeSheet = new CSSStyleSheet();
    themeSheet.replaceSync(defaultCss);
  }
  return themeSheet;
}

const ACTIONS_CSS = `
:host { all: initial; display: flex; flex-wrap: wrap; gap: 0.45rem; margin-top: 0.6rem; }
button { font: 600 0.78rem/1.2 system-ui, -apple-system, 'Segoe UI', sans-serif; padding: 0.45rem 0.85rem; border-radius: 7px;
  border: 1px solid #0f6b5f; background: #0f6b5f; color: #fff; cursor: pointer; }
button:hover { filter: brightness(1.1); }
button:focus-visible { outline: 2px solid #b0802a; outline-offset: 2px; }
@media print { :host { display: none; } }
`;
let actionsSheet: CSSStyleSheet | null = null;
function sharedActions(): CSSStyleSheet {
  if (!actionsSheet) {
    actionsSheet = new CSSStyleSheet();
    actionsSheet.replaceSync(ACTIONS_CSS);
  }
  return actionsSheet;
}

interface InlineAction {
  text: string;
  label: string;
  run: () => Promise<unknown>;
}

function actionHost(actions: readonly InlineAction[]): HTMLElement {
  const host = document.createElement('m2-actions');
  const root = host.attachShadow({ mode: 'closed' });
  root.adoptedStyleSheets = [sharedActions()];
  for (const a of actions) {
    const b = el('button', undefined, a.text);
    b.type = 'button';
    b.setAttribute('aria-label', a.label);
    b.addEventListener('click', () => {
      void a.run();
    });
    root.append(b);
  }
  return host;
}

// ------------------------------------------------------------------ built-in consent dialogs

const DIALOG_CSS = `
:host { all: initial; }
dialog { box-sizing: border-box; width: min(30rem, 92vw); border: 1px solid #d9cfbd; border-radius: 14px; padding: 1.4rem 1.6rem;
  background: #fbf8f2; color: #25222c; font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif;
  box-shadow: 0 30px 80px -20px rgb(0 0 0 / 0.45); }
dialog::backdrop { background: rgb(18 16 24 / 0.5); }
h2 { margin: 0 0 0.45rem; font: 600 1.2rem/1.3 Georgia, serif; }
p { margin: 0 0 0.8rem; color: #5d5766; }
ul { margin: 0 0 0.8rem; padding-left: 1.2rem; }
label { display: flex; gap: 0.5rem; align-items: center; margin: 0.35rem 0; }
input[type='password'] { flex: 1; font: 14px ui-monospace, Menlo, monospace; padding: 0.5rem 0.6rem; border-radius: 8px; border: 1px solid #cbbfa9; background: #fff; color: inherit; }
.row { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }
button { font: 600 13px system-ui, sans-serif; padding: 0.5rem 0.9rem; border-radius: 8px; border: 1px solid #cbbfa9; background: #fff; color: inherit; cursor: pointer; }
button.primary { background: #0f6b5f; border-color: #0f6b5f; color: #fff; }
:is(button, input):focus-visible { outline: 2px solid #b0802a; outline-offset: 2px; }
small { color: #706979; }
@media (prefers-color-scheme: dark) {
  dialog { background: #1b1a22; color: #e6e0d3; border-color: #443f4f; }
  p, small { color: #9c94a5; }
  button, input[type='password'] { background: #22202a; border-color: #443f4f; }
  button.primary { background: #57c0ac; border-color: #57c0ac; color: #10201d; }
}
`;

let consentShadow: ShadowRoot | null = null;
function consentRoot(): ShadowRoot {
  if (consentShadow?.host.isConnected === true) return consentShadow;
  const host = document.createElement('markdown2-consent');
  const root = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(DIALOG_CSS);
  root.adoptedStyleSheets = [sheet];
  document.body.append(host);
  consentShadow = root;
  return root;
}

/** Built-in consent dialogs, outside every document surface. */
export function defaultConsent(req: ConsentRequest): Promise<ConsentAnswer> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  const root = consentRoot();
  const dialog = el('dialog');
  const form = el('form');
  form.method = 'dialog';
  const row = el('div', 'row');
  const button = (text: string, value: string, primary = false): void => {
    const b = el('button', primary ? 'primary' : undefined, text);
    b.value = value;
    if (value === 'cancel') b.formNoValidate = true;
    row.append(b);
  };
  let read: (value: string) => ConsentAnswer = () => null;

  switch (req.kind) {
    case 'key': {
      form.append(
        el('h2', undefined, `Unlock “${req.resource.label}”?`),
        el(
          'p',
          undefined,
          `Layer ${req.layer} of ${req.layers} is encrypted (${req.decoder}). The key stays in this page's memory and is never stored.`,
        ),
      );
      const radio = (value: 'passphrase' | 'identity', text: string, checked: boolean): HTMLInputElement => {
        const label = el('label');
        const input = el('input');
        input.type = 'radio';
        input.name = 'kind';
        input.value = value;
        input.checked = checked;
        label.append(input, el('span', undefined, text));
        form.append(label);
        return input;
      };
      radio('passphrase', 'Passphrase', true);
      const identity = radio('identity', 'age identity (AGE-SECRET-KEY-1…)', false);
      const field = el('label');
      const key = el('input');
      key.type = 'password';
      key.autocomplete = 'off';
      key.required = true;
      key.setAttribute('aria-label', 'Key');
      field.append(key);
      form.append(field);
      button('Cancel', 'cancel');
      button('Unlock', 'ok', true);
      read = (v) => {
        const kind = identity.checked ? 'identity' : 'passphrase';
        const value = kind === 'identity' ? key.value.trim() : key.value;
        key.value = '';
        return v === 'ok' && value !== '' ? { kind, value } : null;
      };
      break;
    }
    case 'remote': {
      const what =
        req.reason === 'fetch'
          ? 'wants to fetch its content from'
          : 'wants to show content from';
      form.append(
        el('h2', undefined, `Load content from ${req.host}?`),
        el(
          'p',
          undefined,
          `“${req.resource.label}” ${what} ${req.host}. That site will learn that you opened this page. ${
            req.reason === 'fetch'
              ? 'Whatever it sends is treated as the declared type, nothing else.'
              : 'It runs in a sandboxed frame and cannot reach this page.'
          }`,
        ),
      );
      button('Not now', 'cancel');
      if (req.origin !== null) button(`Always allow ${req.host}`, 'always');
      button('Load this one', 'once', true);
      read = (v) => (v === 'once' ? 'once' : v === 'always' && req.origin !== null ? 'always' : null);
      break;
    }
    case 'batch': {
      form.append(
        el('h2', undefined, `Try the same key on ${req.resources.length} more?`),
        el('p', undefined, 'These locked resources accept the same kind of key. Resources revealed later are not included.'),
      );
      const ul = el('ul');
      for (const r of req.resources) ul.append(el('li', undefined, r.label));
      form.append(ul);
      button('No', 'cancel');
      button('Use the key', 'ok', true);
      read = (v) => v === 'ok';
      break;
    }
    case 'save-name': {
      form.append(
        el('h2', undefined, 'Use the name the document asks for?'),
        el(
          'p',
          undefined,
          `The document asks to save this as “${req.requested}”. That extension may run or render actively when opened. The safe name is “${req.safeName}”.`,
        ),
      );
      button(`Save as ${req.safeName}`, 'cancel', true);
      button(`Use ${req.requested}`, 'ok');
      read = (v) => v === 'ok';
      break;
    }
  }

  form.append(row);
  dialog.append(form);
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        const answer = read(dialog.returnValue);
        dialog.remove();
        resolve(answer);
      },
      { once: true },
    );
    root.append(dialog);
    dialog.showModal();
  });
}

// ------------------------------------------------------------------ the view

class View implements Markdown2View {
  readonly root: ShadowRoot | HTMLElement;
  readonly ready: Promise<void>;
  private readonly host: HTMLElement;
  private readonly surface: HTMLElement;
  private readonly cascade: CSSStyleSheet | null;
  private readonly registry: DecoderRegistry;
  private readonly handlerList: Md2Handler[];
  private readonly handlerByType: Map<string, Md2Handler>;
  private readonly uriPolicy: UriPolicy;
  private readonly limits: Limits;
  private readonly baseUrl: URL | null;
  private readonly consent: ConsentHandler;
  private readonly inline: boolean;
  private grants = new GrantSet();
  private embeds = new GrantSet();
  private readonly origins = new Set<string>();
  private entries = new Map<string, ResolvedResource>();
  private diagnostics: Diagnostic[] = [];
  private styles: StyleModel | null = null;
  private quotaLeft = 0;
  private docStyles: boolean;
  private seq = 0;
  private ctl: AbortController | null = null;
  private destroyed = false;

  constructor(
    private readonly target: Element,
    private src: string,
    private readonly opts: MountOptions,
  ) {
    for (const o of opts.allowOrigins ?? []) {
      const n = normaliseOrigin(o);
      if (n !== null) this.origins.add(n);
    }
    this.handlerList = [...builtinHandlers(), ...(opts.handlers ?? [])];
    this.handlerByType = handlerMap(this.handlerList);
    this.registry = createRegistry(opts.decoders ?? []);
    this.limits = { ...DEFAULT_LIMITS, ...opts.limits };
    let base: URL | null = null;
    if (opts.baseUrl !== undefined) {
      try {
        base = new URL(String(opts.baseUrl));
      } catch {
        base = null;
      }
    }
    this.baseUrl = base;
    this.uriPolicy = createBrowserUriPolicy({ origins: () => this.origins, base: () => this.baseUrl });
    this.consent = opts.consent ?? defaultConsent;
    this.inline = opts.inlineControls !== false;
    this.docStyles = opts.documentStyles !== false;

    this.host = el('div', 'markdown2-host');
    target.replaceChildren(this.host);
    if (opts.shadow === false) {
      this.root = this.host;
      this.cascade = null;
    } else {
      const shadow = this.host.attachShadow({ mode: 'open' });
      this.cascade = new CSSStyleSheet();
      shadow.adoptedStyleSheets = [sharedTheme(), this.cascade];
      this.root = shadow;
    }
    this.surface = el('div', 'md2-surface');
    this.surface.setAttribute('part', 'surface');
    if (opts.theme === 'light' || opts.theme === 'dark') this.surface.dataset.md2Theme = opts.theme;
    this.root.append(this.surface);
    this.ready = this.render();
  }

  // ---------------------------------------------------------------- rendering

  private remoteAllowed(node: ResourceNode | undefined, origin: string): boolean {
    return (node !== undefined && this.embeds.has(node, 0)) || this.origins.has(origin);
  }

  private async render(): Promise<void> {
    if (this.destroyed) return;
    this.ctl?.abort();
    const ctl = new AbortController();
    this.ctl = ctl;
    const mine = ++this.seq;
    try {
      const doc = parse(this.src, { limits: this.limits });
      const diagnostics: Diagnostic[] = [...doc.diagnostics];
      const quota = new ByteQuota(this.limits.maxDecodedBytes);
      const handlers = coreRegistry(this.handlerList, (node, origin) => this.remoteAllowed(node, origin));
      const resolved = await resolveDocument(doc, {
        registry: this.registry,
        grants: this.grants,
        uriPolicy: this.uriPolicy,
        limits: this.limits,
        handledTypes: handlers.types('view'),
        diagnostics,
        quota,
        signal: ctl.signal,
      });
      const html = await renderHtml(resolved, { handlers });
      if (mine !== this.seq || this.destroyed) return;
      const styles = collectStyles(resolved);
      diagnostics.push(...styles.diagnostics);
      this.entries = new Map(collectResources(resolved).map((e) => [e.node.id, e] as const));
      this.diagnostics = diagnostics;
      this.styles = styles;
      this.quotaLeft = Math.max(0, quota.limit - quota.used);
      this.surface.innerHTML = html; // renderHtml escapes everything it emits
      this.applyStyles();
      this.decorate();
      this.emit();
    } catch (e) {
      if (mine !== this.seq || this.destroyed) return;
      this.surface.textContent = `Markdown2 could not render this document: ${message(e)}`;
    }
  }

  private applyStyles(): void {
    if (!this.cascade || !this.styles) return;
    const author = this.docStyles ? appliedSheets(this.styles, selectionFor(this.styles)) : [];
    try {
      this.cascade.replaceSync(composeCascade({ author, quota: new ByteQuota(this.quotaLeft) }));
    } catch {
      this.cascade.replaceSync('');
    }
  }

  private remoteNeed(e: ResolvedResource): RemoteNeed | null {
    if (e.result.state !== 'decoded' || e.result.bytes === undefined) return null;
    const type = typeEssence(e.node.resource.type);
    if (type === undefined) return null;
    return this.handlerByType.get(type)?.remote?.(e.result.bytes, type) ?? null;
  }

  private uriTarget(node: ResourceNode): { origin: string | null; host: string } {
    const uri = new TextDecoder().decode(node.resource.payload).trim();
    const u = resolveRemoteUri(uri, this.baseUrl);
    return u === null ? { origin: null, host: uri } : { origin: u.origin, host: u.host };
  }

  private info(e: ResolvedResource): ResourceInfo {
    const { node, result } = e;
    const a = node.resource.attributes;
    const title = a.get('title');
    let needs: ResourceInfo['needs'] = null;
    let remote: ResourceInfo['remote'];
    if (result.state === 'locked') {
      const gate = gatedStages(node, this.registry, this.grants)[0] ?? firstCapability(node, this.registry);
      if (gate?.decoder.id === 'uri') {
        needs = 'remote';
        remote = this.uriTarget(node);
      } else {
        needs = 'key';
      }
    } else {
      const need = this.remoteNeed(e);
      if (need !== null && !this.remoteAllowed(node, need.origin)) {
        needs = 'remote';
        remote = { origin: need.origin, host: new URL(need.origin).host };
      }
    }
    return {
      id: node.id,
      label: describeNode(node),
      ...(title !== undefined ? { title } : {}),
      ...(node.resource.type !== undefined ? { type: node.resource.type } : {}),
      encoding: [...node.resource.encoding],
      rel: node.rel,
      state: result.state,
      ...(result.error !== undefined ? { error: result.error } : {}),
      size: result.bytes?.length ?? node.resource.payload.length,
      needs,
      ...(remote !== undefined ? { remote } : {}),
      line: node.startLine,
      nested: node.id.includes('/'),
    };
  }

  private actionsFor(e: ResolvedResource): InlineAction[] {
    const i = this.info(e);
    if (i.needs === 'key') return [{ text: '🔒 Unlock…', label: `Unlock ${i.label}`, run: () => this.unlock(i.id) }];
    if (i.needs === 'remote' && i.remote) {
      const host = i.remote.host;
      const run = e.result.state === 'locked' ? () => this.unlock(i.id) : () => this.load(i.id);
      return [{ text: `Load from ${host}…`, label: `Load ${i.label} from ${host}`, run }];
    }
    return [];
  }

  private decorate(): void {
    if (!this.inline) return;
    for (const e of this.entries.values()) {
      const actions = this.actionsFor(e);
      if (actions.length === 0) continue;
      const res = this.surface.querySelector<HTMLElement>(`md2-resource[data-m2-id="${CSS.escape(e.node.id)}"]`);
      if (!res || res.dataset.m2Shown !== undefined) continue;
      const slot = res.querySelector(':scope > md2-view .m2-load-slot') ?? res.querySelector(':scope > md2-fallback');
      slot?.append(actionHost(actions));
    }
  }

  private emit(): void {
    const s = this.state();
    this.opts.onChange?.(s);
    this.target.dispatchEvent(new CustomEvent('markdown2:change', { detail: s }));
  }

  // ---------------------------------------------------------------- public API

  state(): ViewState {
    return {
      resources: [...this.entries.values()].map((e) => this.info(e)),
      diagnostics: [...this.diagnostics],
      origins: [...this.origins],
    };
  }

  update(src: string): Promise<void> {
    this.src = src;
    return this.render();
  }

  refresh(): Promise<void> {
    return this.render();
  }

  async unlock(id: string, key?: KeyGrant): Promise<boolean> {
    const e = this.entries.get(id);
    if (e?.result.state !== 'locked') return false;
    const { node } = e;
    const gate = nextGate(node, this.registry, this.grants);
    if (!gate) return false;

    if (gate.decoder.id === 'uri') {
      const t = this.uriTarget(node);
      const ans = await this.consent({ kind: 'remote', resource: this.info(e), origin: t.origin, host: t.host, reason: 'fetch' });
      if (ans === 'always' && t.origin !== null) this.origins.add(t.origin);
      else if (ans === 'once' || ans === 'always') this.grants.grant(node, gate.stage);
      else return false;
      await this.render();
      return this.entries.get(id)?.result.state === 'decoded';
    }

    const keyStages = node.resource.encoding
      .map((d, stage) => ({ d, stage }))
      .filter(({ d }) => this.registry.get(d)?.capability === 'key');
    const layer = keyStages.findIndex((s) => s.stage === gate.stage) + 1;
    const answer =
      key ??
      (await this.consent({
        kind: 'key',
        resource: this.info(e),
        layer,
        layers: keyStages.length,
        decoder: gate.decoder.id,
      }));
    if (!isKeyGrant(answer)) return false;
    this.grants.grant(node, gate.stage, answer);
    await this.render();
    if (this.entries.get(id)?.result.error === 'key-rejected') return false;
    if (key === undefined) await this.offerBatch(id, gate.decoder.id, answer);
    return true;
  }

  private async offerBatch(exceptId: string, decoderId: string, key: KeyGrant): Promise<void> {
    const locked = [...this.entries.values()].filter((x) => x.result.state === 'locked' && x.node.id !== exceptId);
    const scope = batchScope(
      locked.map((x) => x.node),
      decoderId,
      this.grants,
    );
    if (scope.length === 0) return;
    const ids = new Set(scope.map((t) => t.node.id));
    const resources = locked.filter((x) => ids.has(x.node.id)).map((x) => this.info(x));
    const ok = await this.consent({ kind: 'batch', resources, decoder: decoderId });
    if (ok !== true) return;
    applyBatchGrant(this.grants, scope, key);
    await this.render();
  }

  async load(id: string, scope?: 'once' | 'always'): Promise<boolean> {
    const e = this.entries.get(id);
    if (!e) return false;
    const need = this.remoteNeed(e);
    if (need === null) return false;
    if (this.remoteAllowed(e.node, need.origin)) return true;
    const ans =
      scope ??
      (await this.consent({
        kind: 'remote',
        resource: this.info(e),
        origin: need.origin,
        host: new URL(need.origin).host,
        reason: 'view',
      }));
    if (ans === 'always') this.origins.add(need.origin);
    else if (ans === 'once') this.embeds.grant(e.node, 0);
    else return false;
    await this.render();
    return true;
  }

  async allowOrigin(origin: string): Promise<void> {
    const n = normaliseOrigin(origin);
    if (n === null) throw new Error(`not an https: origin: ${origin}`);
    this.origins.add(n);
    await this.render();
  }

  async revokeOrigin(origin: string): Promise<void> {
    const n = normaliseOrigin(origin);
    if (n !== null) this.origins.delete(n);
    await this.render();
  }

  async forget(): Promise<void> {
    this.grants = new GrantSet();
    this.embeds = new GrantSet();
    await this.render();
  }

  async download(id: string, form: 'raw' | 'decoded'): Promise<void> {
    const e = this.entries.get(id);
    if (!e) return;
    const { name, requested } = safeSaveName(e.node, form);
    let bytes: Uint8Array;
    if (form === 'raw') bytes = e.node.resource.payload;
    else {
      if (e.result.state !== 'decoded' || e.result.bytes === undefined) return;
      bytes = e.result.bytes;
    }
    let finalName = name;
    if (requested !== undefined) {
      const ok = await this.consent({ kind: 'save-name', resource: this.info(e), safeName: name, requested });
      if (ok === true) finalName = requested;
    }
    downloadBytes(bytes, finalName);
  }

  setDocumentStyles(on: boolean): void {
    this.docStyles = on;
    this.applyStyles();
  }

  destroy(): void {
    this.destroyed = true;
    this.ctl?.abort();
    this.host.remove();
  }
}

/** Render `src` into `target` with permission controls. */
export function mount(target: Element, src: string, options: MountOptions = {}): Markdown2View {
  return new View(target, src, options);
}

/** Remove common indentation and surrounding blank lines (for sources inlined in HTML). */
export function dedent(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length > 0 && (lines[0] ?? '').trim() === '') lines.shift();
  while (lines.length > 0 && (lines.at(-1) ?? '').trim() === '') lines.pop();
  const indents = lines.filter((l) => l.trim() !== '').map((l) => /^[ \t]*/.exec(l)?.[0].length ?? 0);
  const cut = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((l) => l.slice(cut)).join('\n') + '\n';
}

/**
 * Define `<markdown2-view>`. Its source is the text of a child
 * `<script type="text/markdown">` (HTML would otherwise parse `<<<TOKEN` as a tag).
 *
 * Attributes: `theme`, `allow-origins` (space-separated), `inline-controls="false"`,
 * `document-styles="false"`. The live view is on `element.view`.
 */
export function defineElement(name = 'markdown2-view', defaults: MountOptions = {}): void {
  if (typeof customElements === 'undefined' || customElements.get(name) !== undefined) return;
  class Markdown2Element extends HTMLElement {
    #view: Markdown2View | null = null;
    #src = '';

    get view(): Markdown2View | null {
      return this.#view;
    }
    get source(): string {
      return this.#src;
    }
    set source(v: string) {
      this.#src = v;
      void this.#view?.update(v);
    }

    connectedCallback(): void {
      if (this.#view) return;
      const script = this.querySelector('script[type="text/markdown"], script[type="text/markdown2"]');
      if (script) this.#src = dedent(script.textContent ?? '');
      const theme = this.getAttribute('theme');
      const origins = (this.getAttribute('allow-origins') ?? '').split(/\s+/).filter((s) => s !== '');
      const container = document.createElement('div');
      this.replaceChildren(container);
      this.#view = mount(container, this.#src, {
        ...defaults,
        ...(theme === 'light' || theme === 'dark' || theme === 'auto' ? { theme } : {}),
        allowOrigins: [...(defaults.allowOrigins ?? []), ...origins],
        ...(this.getAttribute('inline-controls') === 'false' ? { inlineControls: false } : {}),
        ...(this.getAttribute('document-styles') === 'false' ? { documentStyles: false } : {}),
      });
    }

    disconnectedCallback(): void {
      this.#view?.destroy();
      this.#view = null;
    }
  }
  customElements.define(name, Markdown2Element);
}