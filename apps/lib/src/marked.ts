import {
  DEFAULT_LIMITS,
  escapeHtml,
  GrantSet,
  parse as parseDocument,
  renderHtml,
  renderMarkdownInline,
  resolveDocument,
  type Decoder,
  type Diagnostic,
  type DocNode,
  type Document,
  type Limits,
  type ResourceNode,
  type UriPolicy,
} from '@markdown2/core';
import { createBrowserUriPolicy, createRegistry } from './decoders.js';
import { builtinHandlers, coreRegistry, handlerMap, type Md2Handler } from './handlers.js';
import { renderSyncHtml, resolveSync, type SyncOptions } from './sync.js';

/**
 * A marked.js-compatible API over Markdown2.
 *
 * Same names and shapes as marked: `marked(src)`, `marked.parse`,
 * `parseInline`, `use`, `setOptions`, `getDefaults`, `defaults`, `lexer`,
 * `parser`, `walkTokens`, `Marked`, `Lexer`, `Parser`, hooks, `async` and
 * `silent`.
 *
 * Differences, by design:
 * - Tokens are Markdown2 tokens: runs of prose and opaque resources.
 * - `renderer`, `tokenizer` and `extensions` are accepted and ignored: opaque
 *   resources never pass through Markdown tokenizers. Extend with `handlers`.
 * - Without `async: true`, resources whose decoding needs to await (gzip,
 *   granted keys, granted fetches) show a fallback with `requires-async`.
 * - Rendering grants nothing: locked resources stay locked in every mode.
 */

export interface Hooks {
  preprocess(markdown: string): string | Promise<string>;
  postprocess(html: string): string | Promise<string>;
  processAllTokens(tokens: TokensList): Token[] | Promise<Token[]>;
}

export interface MarkedOptions {
  /** Return a Promise from parse(), and run the full asynchronous pipeline. */
  async?: boolean;
  /** Return an error message as HTML instead of throwing. */
  silent?: boolean;
  /** Accepted for compatibility. GFM tables and strikethrough are always on. */
  gfm?: boolean;
  /** Accepted for compatibility; ignored. */
  breaks?: boolean;
  /** Accepted for compatibility; ignored. */
  pedantic?: boolean;
  hooks?: Partial<Hooks> | null;
  walkTokens?: ((token: Token) => void | Promise<void>) | null;
  /** Accepted and ignored (see module docs). */
  renderer?: unknown;
  /** Accepted and ignored. */
  tokenizer?: unknown;
  /** Accepted and ignored. */
  extensions?: unknown;

  // ---- Markdown2
  /** Extra handlers. Later handlers for a type win over built-ins. */
  handlers?: readonly Md2Handler[];
  /** Extra decoders (decoder profiles). */
  decoders?: readonly Decoder[];
  /** `https:` origins the embedding app trusts for remote content (uri fetches, embedded pages). */
  allowOrigins?: readonly string[];
  /** Per-node grants (keys, fetch permission). Only effective with `async: true`. */
  grants?: GrantSet;
  /** Custom `uri` policy. Default in browsers: allowed origins only, no cookies. */
  uriPolicy?: UriPolicy;
  /** Base for relative `uri` references. */
  baseUrl?: string | URL;
  limits?: Partial<Limits>;
  /** Mark blocks with `data-m2-line`. */
  sourceLines?: boolean;
  /** Prefix for node ids (and so for `id="m2-…"`), to keep several documents on one page apart. */
  idPrefix?: string;
  /** Receives parser and decoder diagnostics for each parse. */
  onDiagnostics?: ((diagnostics: Diagnostic[]) => void) | null;
}

export type MarkedExtension = MarkedOptions;

export interface ProseToken {
  type: 'markdown';
  raw: string;
  /** Prose to render. Edits made in walkTokens are honoured. */
  text: string;
  line: number;
}

export interface ResourceToken {
  type: 'resource';
  raw: string;
  id: string;
  token: string | null;
  syntax: 'block' | 'frontmatter' | 'wrapped';
  mediaType: string | undefined;
  encoding: string[];
  rel: string;
  attributes: Record<string, string>;
  payload: Uint8Array;
  error?: string;
  line: number;
  endLine: number;
  /** The parsed node. Treat as read-only. */
  node: ResourceNode;
}

export type Token = ProseToken | ResourceToken;
export type TokensList = Token[] & {
  links: Record<string, { href: string | null; title: string | null }>;
  diagnostics?: Diagnostic[];
};

export interface ParseFn {
  (src: string, options: MarkedOptions & { async: true }): Promise<string>;
  (src: string, options: MarkedOptions & { async: false }): string;
  (src: string, options?: MarkedOptions | null): string | Promise<string>;
}

export function getDefaults(): MarkedOptions {
  return {
    async: false,
    breaks: false,
    extensions: null,
    gfm: true,
    hooks: null,
    pedantic: false,
    renderer: null,
    silent: false,
    tokenizer: null,
    walkTokens: null,
    sourceLines: false,
    idPrefix: '',
  };
}

type Hook<T> = (v: T) => T | Promise<T>;

interface Chain {
  preprocess: Hook<string>[];
  postprocess: Hook<string>[];
  processAllTokens: ((t: TokensList) => Token[] | Promise<Token[]>)[];
  walkTokens: ((t: Token) => void | Promise<void>)[];
  handlers: Md2Handler[];
  decoders: Decoder[];
  allowOrigins: string[];
}

interface Effective {
  async: boolean;
  silent: boolean;
  preprocess: Hook<string>[];
  postprocess: Hook<string>[];
  processAllTokens: ((t: TokensList) => Token[] | Promise<Token[]>)[];
  walkTokens: ((t: Token) => void | Promise<void>)[];
  handlers: Md2Handler[];
  decoders: Decoder[];
  origins: Set<string>;
  grants: GrantSet;
  uriPolicy?: UriPolicy;
  baseUrl: URL | null;
  limits: Limits;
  sourceLines: boolean;
  idPrefix: string;
  onDiagnostics?: (d: Diagnostic[]) => void;
}

const REPORT = '\nPlease report this to https://github.com/SimiaCryptus/Markdown2.';
const noop = (): undefined => undefined;

function normaliseOrigin(o: string): string | null {
  try {
    const u = new URL(o);
    return u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}

function toUrl(u: string | URL | undefined): URL | null {
  if (u === undefined) return null;
  try {
    return new URL(String(u));
  } catch {
    return null;
  }
}

function expectSync<T>(v: T | Promise<T>, what: string): T {
  if (v instanceof Promise) {
    v.then(noop, noop);
    throw new Error(`${what} returned a Promise; set async: true`);
  }
  return v;
}

function asList(tokens: Token[], from: TokensList): TokensList {
  return Object.assign(tokens, {
    links: from.links,
    ...(from.diagnostics ? { diagnostics: from.diagnostics } : {}),
  });
}

function toToken(n: DocNode, lines: readonly string[]): Token {
  if (n.kind === 'prose') return { type: 'markdown', raw: n.text, text: n.text, line: n.startLine };
  return {
    type: 'resource',
    raw: lines.slice(n.startLine, n.endLine + 1).join('\n'),
    id: n.id,
    token: n.token,
    syntax: n.syntax,
    mediaType: n.resource.type,
    encoding: [...n.resource.encoding],
    rel: n.rel,
    attributes: Object.fromEntries(n.resource.attributes),
    payload: n.resource.payload,
    ...(n.structuralError ? { error: n.structuralError } : {}),
    line: n.startLine,
    endLine: n.endLine,
    node: n,
  };
}

function toDocument(tokens: TokensList): Document {
  return {
    children: tokens.map((t): DocNode => (t.type === 'markdown' ? { kind: 'prose', text: t.text, startLine: t.line } : t.node)),
    diagnostics: tokens.diagnostics ?? [],
  };
}

function errorHtml(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return `<p>An error occurred:</p><pre>${escapeHtml(msg + REPORT)}</pre>`;
}

function decorate(e: unknown): Error {
  const err = e instanceof Error ? e : new Error(String(e));
  if (!err.message.endsWith(REPORT)) err.message += REPORT;
  return err;
}

/** `Lexer.lex(src)`: Markdown2 tokens (runs of prose and resources). */
export class Lexer {
  constructor(private readonly options?: MarkedOptions | null) {}
  static lex(src: string, options?: MarkedOptions | null): TokensList {
    return (options ? new Marked(options) : markedInstance).lexer(src);
  }
  lex(src: string): TokensList {
    return Lexer.lex(src, this.options);
  }
}

/** `Parser.parse(tokens)`: synchronous rendering of tokens. */
export class Parser {
  constructor(private readonly options?: MarkedOptions | null) {}
  static parse(tokens: TokensList, options?: MarkedOptions | null): string {
    return (options ? new Marked(options) : markedInstance).parser(tokens);
  }
  parse(tokens: TokensList): string {
    return Parser.parse(tokens, this.options);
  }
}

export class Marked {
  defaults: MarkedOptions = getDefaults();
  readonly parse: ParseFn;
  readonly parseInline: ParseFn;
  readonly Lexer = Lexer;
  readonly Parser = Parser;
  private readonly chain: Chain = {
    preprocess: [],
    postprocess: [],
    processAllTokens: [],
    walkTokens: [],
    handlers: [],
    decoders: [],
    allowOrigins: [],
  };

  constructor(...args: MarkedExtension[]) {
    this.parse = ((src: string, options?: MarkedOptions | null) => this.run(src, options, false)) as ParseFn;
    this.parseInline = ((src: string, options?: MarkedOptions | null) => this.run(src, options, true)) as ParseFn;
    this.use = this.use.bind(this);
    this.setOptions = this.setOptions.bind(this);
    this.lexer = this.lexer.bind(this);
    this.parser = this.parser.bind(this);
    this.walkTokens = this.walkTokens.bind(this);
    this.use(...args);
  }

  /** Add extensions. Hooks and walkTokens chain (newest first); handlers, decoders and origins accumulate. */
  use(...args: MarkedExtension[]): this {
    for (const ext of args) {
      const {
        hooks,
        walkTokens,
        handlers,
        decoders,
        allowOrigins,
        renderer: _renderer,
        tokenizer: _tokenizer,
        extensions: _extensions,
        ...rest
      } = ext;
      this.defaults = { ...this.defaults, ...rest };
      if (hooks) {
        const h = hooks;
        const pre = h.preprocess;
        if (pre) this.chain.preprocess.unshift((v) => pre.call(h, v));
        const post = h.postprocess;
        if (post) this.chain.postprocess.unshift((v) => post.call(h, v));
        const all = h.processAllTokens;
        if (all) this.chain.processAllTokens.unshift((v) => all.call(h, v));
      }
      if (walkTokens) this.chain.walkTokens.unshift(walkTokens);
      if (handlers) this.chain.handlers.push(...handlers);
      if (decoders) this.chain.decoders.push(...decoders);
      if (allowOrigins) this.chain.allowOrigins.push(...allowOrigins);
    }
    return this;
  }

  setOptions(opt: MarkedOptions): this {
    this.defaults = { ...this.defaults, ...opt };
    return this;
  }

  lexer(src: string, options?: MarkedOptions | null): TokensList {
    return this.lex(src, this.effective(options));
  }

  parser(tokens: TokensList, options?: MarkedOptions | null): string {
    return this.renderTokens(tokens, this.effective(options));
  }

  walkTokens(tokens: readonly Token[], callback: (token: Token) => unknown): unknown[] {
    return tokens.map((t) => callback(t));
  }

  // ---------------------------------------------------------------- internals

  private effective(call?: MarkedOptions | null): Effective {
    const o: MarkedOptions = { ...this.defaults, ...(call ?? {}) };
    const preprocess = [...this.chain.preprocess];
    const postprocess = [...this.chain.postprocess];
    const processAllTokens = [...this.chain.processAllTokens];
    const walkTokens = [...this.chain.walkTokens];
    const h = o.hooks;
    if (h) {
      const pre = h.preprocess;
      if (pre) preprocess.unshift((v) => pre.call(h, v));
      const post = h.postprocess;
      if (post) postprocess.unshift((v) => post.call(h, v));
      const all = h.processAllTokens;
      if (all) processAllTokens.unshift((v) => all.call(h, v));
    }
    if (o.walkTokens) walkTokens.unshift(o.walkTokens);
    const origins = new Set<string>();
    for (const x of [...this.chain.allowOrigins, ...(o.allowOrigins ?? [])]) {
      const n = normaliseOrigin(x);
      if (n !== null) origins.add(n);
    }
    const baseUrl = toUrl(o.baseUrl);
    const uriPolicy =
      o.uriPolicy ??
      (typeof fetch === 'function' ? createBrowserUriPolicy({ origins: () => origins, base: () => baseUrl }) : undefined);
    return {
      async: o.async === true,
      silent: o.silent === true,
      preprocess,
      postprocess,
      processAllTokens,
      walkTokens,
      handlers: [...builtinHandlers(), ...this.chain.handlers, ...(o.handlers ?? [])],
      decoders: [...this.chain.decoders, ...(o.decoders ?? [])],
      origins,
      grants: o.grants ?? new GrantSet(),
      ...(uriPolicy ? { uriPolicy } : {}),
      baseUrl,
      limits: { ...DEFAULT_LIMITS, ...o.limits },
      sourceLines: o.sourceLines === true,
      idPrefix: o.idPrefix ?? '',
      ...(o.onDiagnostics ? { onDiagnostics: o.onDiagnostics } : {}),
    };
  }

  private lex(src: string, c: Effective): TokensList {
    const doc = parseDocument(src, { limits: c.limits, idPrefix: c.idPrefix });
    const lines = (src.startsWith('\uFEFF') ? src.slice(1) : src).split(/\r?\n/);
    const tokens = doc.children.map((n) => toToken(n, lines));
    return Object.assign(tokens, { links: {}, diagnostics: doc.diagnostics });
  }

  private syncOptions(c: Effective, diagnostics: Diagnostic[]): SyncOptions {
    return {
      handlers: handlerMap(c.handlers),
      registry: createRegistry(c.decoders),
      grants: c.grants,
      limits: c.limits,
      remoteAllowed: (_node, origin) => c.origins.has(origin),
      sourceLines: c.sourceLines,
      diagnostics,
    };
  }

  private renderTokens(tokens: TokensList, c: Effective): string {
    const doc = toDocument(tokens);
    const diagnostics = [...doc.diagnostics];
    const o = this.syncOptions(c, diagnostics);
    const html = renderSyncHtml(resolveSync(doc, o), o);
    c.onDiagnostics?.(diagnostics);
    return html;
  }

  private async renderTokensAsync(tokens: TokensList, c: Effective): Promise<string> {
    const doc = toDocument(tokens);
    const diagnostics = [...doc.diagnostics];
    const handlers = coreRegistry(c.handlers, (_node, origin) => c.origins.has(origin));
    const resolved = await resolveDocument(doc, {
      registry: createRegistry(c.decoders),
      grants: c.grants,
      limits: c.limits,
      handledTypes: handlers.types('view'),
      diagnostics,
      ...(c.uriPolicy ? { uriPolicy: c.uriPolicy } : {}),
    });
    const html = await renderHtml(resolved, { handlers, sourceLines: c.sourceLines });
    c.onDiagnostics?.(diagnostics);
    return html;
  }

  private run(src: string, options: MarkedOptions | null | undefined, inline: boolean): string | Promise<string> {
    let c: Effective;
    try {
      c = this.effective(options);
    } catch (e) {
      throw decorate(e);
    }
    if (typeof src !== 'string') {
      const err = new Error(`marked(): input parameter is of type ${Object.prototype.toString.call(src)}, string expected`);
      if (c.silent) return c.async ? Promise.resolve(errorHtml(err)) : errorHtml(err);
      if (c.async) return Promise.reject(decorate(err));
      throw decorate(err);
    }
    if (c.async) {
      return this.runAsync(src, c, inline).catch((e: unknown) => {
        if (c.silent) return errorHtml(e);
        throw decorate(e);
      });
    }
    try {
      return this.runSync(src, c, inline);
    } catch (e) {
      if (c.silent) return errorHtml(e);
      throw decorate(e);
    }
  }

  private runSync(src: string, c: Effective, inline: boolean): string {
    let md = src;
    for (const h of c.preprocess) md = expectSync(h(md), 'a preprocess hook');
    let html: string;
    if (inline) {
      html = renderMarkdownInline(md);
    } else {
      let tokens = this.lex(md, c);
      for (const h of c.processAllTokens) tokens = asList(expectSync(h(tokens), 'processAllTokens'), tokens);
      for (const t of tokens) for (const w of c.walkTokens) expectSync(w(t), 'walkTokens');
      html = this.renderTokens(tokens, c);
    }
    for (const h of c.postprocess) html = expectSync(h(html), 'a postprocess hook');
    return html;
  }

  private async runAsync(src: string, c: Effective, inline: boolean): Promise<string> {
    let md = src;
    for (const h of c.preprocess) md = await h(md);
    let html: string;
    if (inline) {
      html = renderMarkdownInline(md);
    } else {
      let tokens = this.lex(md, c);
      for (const h of c.processAllTokens) tokens = asList(await h(tokens), tokens);
      for (const t of tokens) for (const w of c.walkTokens) await w(t);
      html = await this.renderTokensAsync(tokens, c);
    }
    for (const h of c.postprocess) html = await h(html);
    return html;
  }
}

// ------------------------------------------------------------------ the global `marked`

const markedInstance = new Marked();

export interface MarkedFunction extends ParseFn {
  parse: ParseFn;
  parseInline: ParseFn;
  options(opt: MarkedOptions): MarkedFunction;
  setOptions(opt: MarkedOptions): MarkedFunction;
  use(...args: MarkedExtension[]): MarkedFunction;
  getDefaults(): MarkedOptions;
  readonly defaults: MarkedOptions;
  walkTokens(tokens: readonly Token[], callback: (token: Token) => unknown): unknown[];
  lexer(src: string, options?: MarkedOptions | null): TokensList;
  parser(tokens: TokensList, options?: MarkedOptions | null): string;
  Marked: typeof Marked;
  Lexer: typeof Lexer;
  Parser: typeof Parser;
}

/** Live binding, like marked's `defaults` export. */
// eslint-disable-next-line import/no-mutable-exports
export let defaults: MarkedOptions = markedInstance.defaults;

function markedImpl(src: string, options?: MarkedOptions | null): string | Promise<string> {
  return markedInstance.parse(src, options);
}

function setOptionsImpl(opt: MarkedOptions): MarkedFunction {
  markedInstance.setOptions(opt);
  defaults = markedInstance.defaults;
  return marked;
}

const assembled = Object.assign(markedImpl, {
  parse: markedImpl as ParseFn,
  parseInline: markedInstance.parseInline,
  options: setOptionsImpl,
  setOptions: setOptionsImpl,
  use: (...args: MarkedExtension[]): MarkedFunction => {
    markedInstance.use(...args);
    defaults = markedInstance.defaults;
    return marked;
  },
  getDefaults,
  walkTokens: markedInstance.walkTokens,
  lexer: (src: string, options?: MarkedOptions | null): TokensList => markedInstance.lexer(src, options),
  parser: (tokens: TokensList, options?: MarkedOptions | null): string => markedInstance.parser(tokens, options),
  Marked,
  Lexer,
  Parser,
});
Object.defineProperty(assembled, 'defaults', { get: () => markedInstance.defaults, enumerable: true });

export const marked = assembled as MarkedFunction;

export const parse: ParseFn = marked.parse;
export const parseInline: ParseFn = marked.parseInline;
export const options = marked.options;
export const setOptions = marked.setOptions;
export const use = marked.use;
export const walkTokens = marked.walkTokens;
export const lexer = marked.lexer;
export const parser = marked.parser;