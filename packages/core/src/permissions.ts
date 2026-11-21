import type { ResourceNode } from './types.js';

/**
 * Upfront permission whitelisting and actionable console diagnostics.
 *
 * Defaults remain fail-closed (nothing fetched, framed, or unlocked without
 * explicit permission). Consuming pages and integrating apps can whitelist
 * origins, remote views, and decryption keys upfront — via JS options,
 * `<markdown2-view>` attributes, or `<meta name="markdown2-permissions">`.
 */

/**
 * An origin whitelist rule:
 * - `'self'` — the host/page origin (from `baseUrl` or `location.origin`)
 * - `'*'` or `'https:'` — any `https:` origin (plus `http:` when `allowHttp` is true)
 * - `'http:'` — any `http:` origin
 * - `'https://example.com'` — exact origin
 * - `'https://*.example.com'` — subdomain wildcard (matches `a.example.com`, `a.b.example.com`)
 * - `'http://localhost:3000'` — explicit `http:` origin (allowed when explicitly listed)
 */
export type OriginRule = string;

export type LogLevel = 'silent' | 'warn' | 'debug';

export interface KeyRule {
  /** Key value passed to the decoder (e.g. `{ kind: 'passphrase', value: '...' }` for `age`). */
  grant: unknown;
  /** Optional decoder id filter (e.g. `'age'`). Default: matches any key-gated decoder. */
  decoder?: string;
  /** Optional resource id, title, or filename filter. */
  resource?: string;
}

export interface PermissionsConfig {
  /** Origins allowed for BOTH `encoding="uri"` fetches and remote views/embeds. */
  allowOrigins?: Iterable<OriginRule>;
  /** Origins allowed specifically for `encoding="uri"` network fetches. */
  allowFetch?: Iterable<OriginRule>;
  /** Origins allowed specifically for remote views/embeds (`text/uri-list`, charts, maps, etc.). */
  allowEmbed?: Iterable<OriginRule>;
  /** Allow plain `http:` origins with `'*'` or relative/remote URLs. Explicit `http://...` rules work regardless. */
  allowHttp?: boolean;
  /** Allow framing same-origin pages in `text/uri-list` embeds when `'self'` or app origin is whitelisted. */
  allowSameOriginEmbed?: boolean;
  /**
   * Upfront decryption keys to try automatically on locked key-gated resources.
   * Accepts `KeyRule` objects or raw grant values (e.g. `{ kind: 'passphrase', value: '...' }`).
   * Held in memory only; never logged.
   */
  keys?: Iterable<unknown>;
  /** Whether upfront `keys` also apply to nested documents revealed after decryption. Default true. */
  unlockNested?: boolean;
  /** Allow document-provided stylesheets (`rel="stylesheet"`). Default true. */
  documentStyles?: boolean;
  /** Custom predicate for remote fetches (`encoding="uri"`). */
  canFetch?: (url: URL, node?: ResourceNode) => boolean;
  /** Custom predicate for remote views/embeds. */
  canEmbed?: (origin: string, node?: ResourceNode) => boolean;
  /** Console logging level for blocked permissions and load failures. Default `'warn'`. */
  logLevel?: LogLevel;
}

export interface PermissionEnv {
  /** Origin of the consuming page / app (e.g. `location.origin`). */
  selfOrigin?: string | null;
  /** Optional custom logger (defaults to `console`). */
  logger?: Pick<Console, 'warn' | 'error' | 'info' | 'debug'>;
}

type CompiledRule =
  | { kind: 'all'; raw: string }
  | { kind: 'scheme'; scheme: 'https:' | 'http:'; raw: string }
  | { kind: 'self'; raw: string }
  | { kind: 'exact'; origin: string; scheme: 'https:' | 'http:'; raw: string }
  | { kind: 'wildcard'; scheme: 'https:' | 'http:'; suffix: string; port: string; raw: string };

export interface ParsedOriginRule {
  ok: true;
  rule: CompiledRule;
  normalized: string;
}

export interface InvalidOriginRule {
  ok: false;
  raw: string;
  warning: string;
}

const WILDCARD_RE = /^(https?):\/\/\*\.([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)(?::(\d+))?\/?$/i;

export function parseOriginRule(raw: string): ParsedOriginRule | InvalidOriginRule {
  const s = raw.trim();
  if (s === '') {
    return { ok: false, raw, warning: 'Empty origin rule ignored.' };
  }
  const lower = s.toLowerCase();
  if (lower === '*') {
    return { ok: true, rule: { kind: 'all', raw: '*' }, normalized: '*' };
  }
  if (lower === 'self' || lower === "'self'") {
    return { ok: true, rule: { kind: 'self', raw: 'self' }, normalized: 'self' };
  }
  if (lower === 'https:' || lower === 'https://*') {
    return { ok: true, rule: { kind: 'scheme', scheme: 'https:', raw: 'https:' }, normalized: 'https:' };
  }
  if (lower === 'http:' || lower === 'http://*') {
    return { ok: true, rule: { kind: 'scheme', scheme: 'http:', raw: 'http:' }, normalized: 'http:' };
  }
  const wc = WILDCARD_RE.exec(s);
  if (wc?.[1] !== undefined && wc[2] !== undefined) {
    const scheme = `${wc[1].toLowerCase()}:` as 'https:' | 'http:';
    const host = wc[2].toLowerCase();
    const port = wc[3] ?? '';
    const normalized = `${scheme}//*.${host}${port === '' ? '' : `:${port}`}`;
    return {
      ok: true,
      rule: { kind: 'wildcard', scheme, suffix: `.${host}`, port, raw: normalized },
      normalized,
    };
  }
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return {
        ok: false,
        raw: s,
        warning: `Ignored origin rule "${s}": only https: and http: origins are supported (got "${u.protocol}").`,
      };
    }
    return {
      ok: true,
      rule: { kind: 'exact', origin: u.origin, scheme: u.protocol, raw: u.origin },
      normalized: u.origin,
    };
  } catch {
    return {
      ok: false,
      raw: s,
      warning: `Ignored invalid origin rule "${s}". Include the scheme (e.g. "https://${s.replace(/^\/+/, '')}"), use a subdomain wildcard ("https://*.example.com"), "self", or "*".`,
    };
  }
}

function matchesCompiled(rule: CompiledRule, target: URL, selfOrigin: string | null, allowHttp: boolean): boolean {
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return false;
  switch (rule.kind) {
    case 'all':
      return target.protocol === 'https:' || allowHttp;
    case 'scheme':
      return target.protocol === rule.scheme;
    case 'self':
      return selfOrigin !== null && target.origin === selfOrigin;
    case 'exact':
      return target.origin === rule.origin;
    case 'wildcard': {
      if (target.protocol !== rule.scheme) return false;
      if (rule.port !== '' && target.port !== rule.port) return false;
      if (rule.port === '' && target.port !== '') return false;
      const host = target.hostname.toLowerCase();
      return host.endsWith(rule.suffix) && host.length > rule.suffix.length;
    }
  }
}

function isKeyRule(v: unknown): v is KeyRule {
  if (typeof v !== 'object' || v === null) return false;
  return 'grant' in v && (v as Record<string, unknown>).grant !== undefined;
}

function nodeLabel(node: ResourceNode): string {
  const a = node.resource.attributes;
  return a.get('title') ?? a.get('filename') ?? node.resource.type ?? `(resource #${node.id})`;
}

export interface PermissionPolicy {
  readonly logLevel: LogLevel;
  readonly allowHttp: boolean;
  readonly allowSameOriginEmbed: boolean;
  readonly documentStyles: boolean;
  readonly unlockNested: boolean;
  readonly selfOrigin: string | null;
  /** Whether an `encoding="uri"` fetch to `url` is whitelisted. */
  allowsFetch(url: URL, node?: ResourceNode): boolean;
  /** Whether a remote view/embed from `origin` (or URL) is whitelisted. */
  allowsEmbed(originOrUrl: string | URL, node?: ResourceNode): boolean;
  /** Whether an `http:` URL is explicitly whitelisted (either via `allowHttp` or an explicit `http:` rule). */
  allowsHttpUrl(url: URL, kind: 'fetch' | 'embed'): boolean;
  /** Upfront key grants matching `node` and `decoderId`. Never returns keys for nested nodes if `unlockNested` is false. */
  keysFor(node: ResourceNode, decoderId: string): unknown[];
  /** Dynamically add an origin rule (for both fetch and embed). */
  allowOrigin(rule: OriginRule): { ok: boolean; normalized?: string; warning?: string };
  /** Dynamically remove an origin rule. */
  revokeOrigin(rule: OriginRule): void;
  /** Snapshot of all currently configured origin rules (normalized). */
  allowedOrigins(): string[];
  /** Emit a `[Markdown2]` warning (unless `logLevel === 'silent'`). */
  warn(message: string): void;
  /** Emit a `[Markdown2]` error (unless `logLevel === 'silent'`). */
  error(message: string): void;
  /** Emit a `[Markdown2]` debug message (only when `logLevel === 'debug'`). */
  debug(message: string): void;
}

export function createPermissionPolicy(config: PermissionsConfig = {}, env: PermissionEnv = {}): PermissionPolicy {
  const logLevel: LogLevel = config.logLevel ?? 'warn';
  const allowHttp = config.allowHttp === true;
  const allowSameOriginEmbed = config.allowSameOriginEmbed === true;
  const documentStyles = config.documentStyles !== false;
  const unlockNested = config.unlockNested !== false;
  const selfOrigin =
    env.selfOrigin !== undefined
      ? env.selfOrigin
      : typeof location !== 'undefined' && location.origin !== 'null'
        ? location.origin
        : null;
  const logger = env.logger ?? console;

  const warn = (msg: string): void => {
    if (logLevel !== 'silent') logger.warn(`[Markdown2] ${msg}`);
  };
  const error = (msg: string): void => {
    if (logLevel !== 'silent') logger.error(`[Markdown2] ${msg}`);
  };
  const debug = (msg: string): void => {
    if (logLevel === 'debug') logger.debug(`[Markdown2] ${msg}`);
  };

  const sharedRules = new Map<string, CompiledRule>();
  const fetchRules = new Map<string, CompiledRule>();
  const embedRules = new Map<string, CompiledRule>();

  const addTo = (
    map: Map<string, CompiledRule>,
    raw: OriginRule,
  ): { ok: boolean; normalized?: string; warning?: string } => {
    const parsed = parseOriginRule(raw);
    if (!parsed.ok) {
      warn(parsed.warning);
      return { ok: false, warning: parsed.warning };
    }
    map.set(parsed.normalized, parsed.rule);
    return { ok: true, normalized: parsed.normalized };
  };

  for (const r of config.allowOrigins ?? []) addTo(sharedRules, r);
  for (const r of config.allowFetch ?? []) addTo(fetchRules, r);
  for (const r of config.allowEmbed ?? []) addTo(embedRules, r);

  const keyRules: KeyRule[] = [];
  for (const k of config.keys ?? []) {
    if (k === null || k === undefined) continue;
    keyRules.push(isKeyRule(k) ? k : { grant: k });
  }

  const rulesFor = (kind: 'fetch' | 'embed'): Iterable<CompiledRule> => [
    ...sharedRules.values(),
    ...(kind === 'fetch' ? fetchRules.values() : embedRules.values()),
  ];

  const toUrl = (originOrUrl: string | URL): URL | null => {
    if (originOrUrl instanceof URL) return originOrUrl;
    try {
      return new URL(originOrUrl);
    } catch {
      return null;
    }
  };

  return {
    logLevel,
    allowHttp,
    allowSameOriginEmbed,
    documentStyles,
    unlockNested,
    selfOrigin,

    allowsFetch(url: URL, node?: ResourceNode): boolean {
      if (config.canFetch?.(url, node) === true) return true;
      for (const r of rulesFor('fetch')) {
        if (matchesCompiled(r, url, selfOrigin, allowHttp)) return true;
      }
      return false;
    },

    allowsEmbed(originOrUrl: string | URL, node?: ResourceNode): boolean {
      const u = toUrl(originOrUrl);
      if (u === null) return false;
      if (config.canEmbed?.(u.origin, node) === true) return true;
      for (const r of rulesFor('embed')) {
        if (matchesCompiled(r, u, selfOrigin, allowHttp)) return true;
      }
      return false;
    },

    allowsHttpUrl(url: URL, kind: 'fetch' | 'embed'): boolean {
      if (url.protocol !== 'http:') return false;
      if (allowHttp) return true;
      for (const r of rulesFor(kind)) {
        if (r.kind === 'exact' && r.scheme === 'http:' && r.origin === url.origin) return true;
        if (r.kind === 'scheme' && r.scheme === 'http:') return true;
        if (r.kind === 'wildcard' && r.scheme === 'http:' && matchesCompiled(r, url, selfOrigin, true)) return true;
        if (r.kind === 'self' && selfOrigin === url.origin) return true;
      }
      return false;
    },

    keysFor(node: ResourceNode, decoderId: string): unknown[] {
      if (keyRules.length === 0) return [];
      if (!unlockNested && node.id.includes('/')) return [];
      const id = decoderId.toLowerCase();
      const title = node.resource.attributes.get('title');
      const filename = node.resource.attributes.get('filename');
      const out: unknown[] = [];
      for (const kr of keyRules) {
        if (kr.decoder !== undefined && kr.decoder.toLowerCase() !== id) continue;
        if (kr.resource !== undefined && kr.resource !== node.id && kr.resource !== title && kr.resource !== filename) {
          continue;
        }
        out.push(kr.grant);
      }
      return out;
    },

    allowOrigin(rule: OriginRule) {
      return addTo(sharedRules, rule);
    },

    revokeOrigin(rule: OriginRule): void {
      const parsed = parseOriginRule(rule);
      const key = parsed.ok ? parsed.normalized : rule.trim();
      sharedRules.delete(key);
      fetchRules.delete(key);
      embedRules.delete(key);
    },

    allowedOrigins(): string[] {
      return [...new Set([...sharedRules.keys(), ...fetchRules.keys(), ...embedRules.keys()])];
    },

    warn,
    error,
    debug,
  };
}

/**
 * Parse a `<meta name="markdown2-permissions" content="...">` value.
 *
 * Accepts either:
 * 1. JSON: `{"allowOrigins":["self","https://example.com"],"allowHttp":true}`
 * 2. CSP-like directives separated by `;`:
 *    `allow-origins self https://example.com; allow-fetch https://cdn.example.com; allow-embed https://www.openstreetmap.org; allow-http; allow-same-origin-embed; document-styles false; log-level debug`
 */
export function parsePermissionsMeta(content: string): PermissionsConfig {
  const trimmed = content.trim();
  if (trimmed === '') return {};
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
      const r = parsed as Record<string, unknown>;
      const strArr = (v: unknown): string[] | undefined =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
      const allowOrigins = strArr(r.allowOrigins);
      const allowFetch = strArr(r.allowFetch);
      const allowEmbed = strArr(r.allowEmbed);
      const logLevel =
        r.logLevel === 'silent' || r.logLevel === 'warn' || r.logLevel === 'debug' ? r.logLevel : undefined;
      return {
        ...(allowOrigins ? { allowOrigins } : {}),
        ...(allowFetch ? { allowFetch } : {}),
        ...(allowEmbed ? { allowEmbed } : {}),
        ...(typeof r.allowHttp === 'boolean' ? { allowHttp: r.allowHttp } : {}),
        ...(typeof r.allowSameOriginEmbed === 'boolean' ? { allowSameOriginEmbed: r.allowSameOriginEmbed } : {}),
        ...(typeof r.documentStyles === 'boolean' ? { documentStyles: r.documentStyles } : {}),
        ...(logLevel ? { logLevel } : {}),
      };
    } catch {
      return {};
    }
  }

  const allowOrigins: string[] = [];
  const allowFetch: string[] = [];
  const allowEmbed: string[] = [];
  const out: PermissionsConfig = {};

  for (const rawPart of trimmed.split(';')) {
    const tokens = rawPart.trim().split(/\s+/).filter(Boolean);
    const directive = tokens[0]?.toLowerCase();
    if (!directive) continue;
    const args = tokens.slice(1);
    switch (directive) {
      case 'allow-origins':
        allowOrigins.push(...args);
        break;
      case 'allow-fetch':
        allowFetch.push(...args);
        break;
      case 'allow-embed':
        allowEmbed.push(...args);
        break;
      case 'allow-http':
        out.allowHttp = args[0]?.toLowerCase() !== 'false';
        break;
      case 'allow-same-origin-embed':
        out.allowSameOriginEmbed = args[0]?.toLowerCase() !== 'false';
        break;
      case 'document-styles':
        out.documentStyles = args[0]?.toLowerCase() !== 'false';
        break;
      case 'log-level': {
        const lvl = args[0]?.toLowerCase();
        if (lvl === 'silent' || lvl === 'warn' || lvl === 'debug') out.logLevel = lvl;
        break;
      }
      default:
        break;
    }
  }
  if (allowOrigins.length > 0) out.allowOrigins = allowOrigins;
  if (allowFetch.length > 0) out.allowFetch = allowFetch;
  if (allowEmbed.length > 0) out.allowEmbed = allowEmbed;
  return out;
}

export interface MetaQueryRoot {
  querySelectorAll(selector: string): ArrayLike<{ getAttribute(name: string): string | null }>;
}

/** Read `<meta name="markdown2-permissions">` from the host document, if present. */
export function readPagePermissions(doc?: MetaQueryRoot): PermissionsConfig | null {
  const target: MetaQueryRoot | undefined = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!target) return null;
  const metas = Array.from(target.querySelectorAll('meta[name="markdown2-permissions"]'));
  if (metas.length === 0) return null;
  const configs = metas
    .map((m) => m.getAttribute('content'))
    .filter((c): c is string => c !== null && c.trim() !== '')
    .map(parsePermissionsMeta);
  return configs.length === 0 ? null : mergePermissions(...configs);
}

/** Merge multiple `PermissionsConfig` objects. Origin lists and keys accumulate; booleans and logLevel take the last defined value. */
export function mergePermissions(...configs: (PermissionsConfig | undefined | null)[]): PermissionsConfig {
  const allowOrigins: OriginRule[] = [];
  const allowFetch: OriginRule[] = [];
  const allowEmbed: OriginRule[] = [];
  const keys: unknown[] = [];
  const canFetches: ((url: URL, node?: ResourceNode) => boolean)[] = [];
  const canEmbeds: ((origin: string, node?: ResourceNode) => boolean)[] = [];
  const out: PermissionsConfig = {};

  for (const c of configs) {
    if (!c) continue;
    if (c.allowOrigins) allowOrigins.push(...c.allowOrigins);
    if (c.allowFetch) allowFetch.push(...c.allowFetch);
    if (c.allowEmbed) allowEmbed.push(...c.allowEmbed);
    if (c.keys) keys.push(...c.keys);
    if (c.allowHttp !== undefined) out.allowHttp = c.allowHttp;
    if (c.allowSameOriginEmbed !== undefined) out.allowSameOriginEmbed = c.allowSameOriginEmbed;
    if (c.unlockNested !== undefined) out.unlockNested = c.unlockNested;
    if (c.documentStyles !== undefined) out.documentStyles = c.documentStyles;
    if (c.logLevel !== undefined) out.logLevel = c.logLevel;
    if (c.canFetch) canFetches.push(c.canFetch);
    if (c.canEmbed) canEmbeds.push(c.canEmbed);
  }

  if (allowOrigins.length > 0) out.allowOrigins = allowOrigins;
  if (allowFetch.length > 0) out.allowFetch = allowFetch;
  if (allowEmbed.length > 0) out.allowEmbed = allowEmbed;
  if (keys.length > 0) out.keys = keys;
  const firstFetch = canFetches[0];
  if (canFetches.length === 1 && firstFetch) out.canFetch = firstFetch;
  else if (canFetches.length > 1) out.canFetch = (u, n) => canFetches.some((fn) => fn(u, n));
  const firstEmbed = canEmbeds[0];
  if (canEmbeds.length === 1 && firstEmbed) out.canEmbed = firstEmbed;
  else if (canEmbeds.length > 1) out.canEmbed = (o, n) => canEmbeds.some((fn) => fn(o, n));
  return out;
}

// ------------------------------------------------------------------ actionable logging helpers

export function formatResourceRef(node: ResourceNode): string {
  const label = nodeLabel(node);
  const type = node.resource.type ?? 'untyped';
  return `resource #${node.id} ("${label}", type="${type}", line ${node.startLine + 1})`;
}

export function logBlockedFetch(
  policy: PermissionPolicy,
  node: ResourceNode,
  rawUri: string,
  origin: string | null,
  reason?: string,
): void {
  const ref = formatResourceRef(node);
  if (origin !== null) {
    const isHttp = origin.startsWith('http://');
    const fix = isHttp
      ? `Whitelist it upfront with permissions: { allowOrigins: ['${origin}'] } (or allowFetch: ['${origin}']), or on <markdown2-view allow-origins="${origin}">, or <meta name="markdown2-permissions" content="allow-origins ${origin}">.`
      : `Whitelist it upfront with permissions: { allowOrigins: ['${origin}'] } (or allowFetch: ['${origin}']), or on <markdown2-view allow-origins="${origin}">, or <meta name="markdown2-permissions" content="allow-origins ${origin}">.`;
    policy.warn(`Blocked remote fetch for ${ref}: "${rawUri}" (origin "${origin}" is not whitelisted). ${fix}`);
  } else {
    policy.warn(
      `Blocked remote fetch for ${ref}: "${rawUri}". ${reason ?? 'URI could not be resolved.'} ` +
        `If this is a relative URI, pass baseUrl (e.g. baseUrl: location.href) and whitelist 'self' in permissions.allowOrigins.`,
    );
  }
}

export function logBlockedEmbed(
  policy: PermissionPolicy,
  node: ResourceNode | undefined,
  origin: string,
  label: string,
): void {
  const ref = node ? formatResourceRef(node) : `fenced block (${label})`;
  policy.warn(
    `Blocked remote view/embed for ${ref}: requires origin "${origin}" (${label}), which is not whitelisted. ` +
      `Whitelist it upfront with permissions: { allowOrigins: ['${origin}'] } (or allowEmbed: ['${origin}']), ` +
      `or on <markdown2-view allow-origins="${origin}">, or <meta name="markdown2-permissions" content="allow-origins ${origin}">.`,
  );
}

export function logLockedKey(policy: PermissionPolicy, node: ResourceNode, decoderId: string, rejected = false): void {
  const ref = formatResourceRef(node);
  const why = rejected
    ? `Key was rejected for ${ref} (encoding="${decoderId}").`
    : `${ref.charAt(0).toUpperCase()}${ref.slice(1)} is encrypted (encoding="${decoderId}") and locked.`;
  policy.warn(
    `${why} To unlock upfront, pass permissions: { keys: [{ kind: 'passphrase', value: '...' }] } ` +
      `(or { kind: 'identity', value: 'AGE-SECRET-KEY-1...' }) to mount()/marked.parse({ async: true }), or call view.unlock('${node.id}', key).`,
  );
}

export function logDecodeFailure(
  policy: PermissionPolicy,
  node: ResourceNode,
  errorCode: string,
  detail?: string,
): void {
  const ref = formatResourceRef(node);
  const msg = detail ? `${errorCode}: ${detail}` : errorCode;
  policy.warn(`Failed to decode ${ref} (${msg}).`);
}

export function logHandlerError(
  policy: PermissionPolicy,
  info: { node?: ResourceNode; type: string; error: unknown; fence?: boolean },
): void {
  const ref = info.node ? formatResourceRef(info.node) : `fenced block (type="${info.type}")`;
  const msg = info.error instanceof Error ? info.error.message : String(info.error);
  policy.warn(`Handler for "${info.type}" failed on ${ref}: ${msg}`);
}

export function logRequiresAsync(policy: PermissionPolicy, node: ResourceNode): void {
  const ref = formatResourceRef(node);
  const enc = node.resource.encoding.join(' ');
  policy.warn(
    `Cannot decode/render ${ref} (encoding="${enc}") in synchronous marked.parse(). ` +
      `Use await marked.parse(src, { async: true }) or mount(el, src).`,
  );
}

export function logUnsupportedResource(
  policy: PermissionPolicy,
  node: ResourceNode,
  reason: 'encoding' | 'type',
  suggestion?: string,
): void {
  const ref = formatResourceRef(node);
  if (reason === 'encoding') {
    policy.warn(
      `Unsupported encoding "${node.resource.encoding.join(' ')}" on ${ref}. ` +
        `Register a decoder for it via decoders: [{ id: '...', position: 'any', decode: ... }].`,
    );
  } else {
    const hint = suggestion ? ` Did you mean "${suggestion}"?` : '';
    policy.warn(
      `No handler registered for media type "${node.resource.type ?? '(none)'}" on ${ref}.${hint} ` +
        `Register one via handlers: [{ types: ['${node.resource.type ?? '...'}'], render: ... }].`,
    );
  }
}
