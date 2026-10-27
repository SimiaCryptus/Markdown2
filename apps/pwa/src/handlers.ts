import {
  defaultHandlers,
  encodeBase64,
  escapeHtml,
  type CodeFenceRenderer,
  type Handler,
  type HandlerRegistry,
} from '@markdown2/core';

/**
 * Developer handlers for the PWA:
 *
 * - code: read-only Monaco editor in a sandboxed, opaque-origin frame;
 * - text/vnd.mermaid: Mermaid in a sandboxed frame;
 * - application/x-tex, application/mathml+xml: MathJax to SVG, shown through <img>.
 *
 * Frames always carry the escaped source as a fallback, which stays visible
 * until the frame reports that it has drawn (offline, blocked or failed).
 */

const MAX_CODE = 200_000;
const MAX_DIAGRAM = 50_000;
const MAX_MATH = 20_000;

export type FrameKind = 'code' | 'mermaid';

/** Fence info-string names → Monaco language ids (basic languages only). */
const LANGS: Readonly<Record<string, string>> = {
  js: 'javascript',
  javascript: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  py: 'python',
  python: 'python',
  sh: 'shell',
  bash: 'shell',
  shell: 'shell',
  zsh: 'shell',
  rs: 'rust',
  rust: 'rust',
  go: 'go',
  golang: 'go',
  java: 'java',
  kt: 'kotlin',
  kotlin: 'kotlin',
  cs: 'csharp',
  csharp: 'csharp',
  c: 'cpp',
  h: 'cpp',
  cpp: 'cpp',
  'c++': 'cpp',
  hpp: 'cpp',
  swift: 'swift',
  rb: 'ruby',
  ruby: 'ruby',
  php: 'php',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  html: 'html',
  xml: 'xml',
  svg: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  markdown: 'markdown',
  dockerfile: 'dockerfile',
  ps1: 'powershell',
  powershell: 'powershell',
  lua: 'lua',
  r: 'r',
  scala: 'scala',
  dart: 'dart',
  graphql: 'graphql',
  ini: 'ini',
  perl: 'perl',
};

/** Declared code media types → Monaco language ids, for code embedded as a resource. */
const CODE_TYPES: Readonly<Record<string, string>> = {
  'text/javascript': 'javascript',
  'text/css': 'css',
  'application/sql': 'sql',
  'application/xml': 'xml',
  'text/x-python': 'python',
  'application/x-sh': 'shell',
};

export function monacoLanguage(lang: string): string | undefined {
  const k = lang.toLowerCase();
  return Object.hasOwn(LANGS, k) ? LANGS[k] : undefined;
}

/** An opaque-origin frame. The source travels as an inert attribute and is posted on request. */
export function frameHtml(kind: FrameKind, source: string, title: string, lang?: string): string {
  const payload = encodeBase64(new TextEncoder().encode(source));
  const langAttr = lang === undefined ? '' : ` data-m2-lang="${escapeHtml(lang)}"`;
  return `<iframe class="m2-frame" data-m2-frame="${kind}" sandbox="allow-scripts" referrerpolicy="no-referrer" src="/sandbox/${kind}.html" title="${escapeHtml(title)}" data-m2-payload="${payload}"${langAttr}></iframe>`;
}

/** Keeps `pre > code.language-x` (style.md §4.1); the editor is drawn inside it. */
function codeHost(lang: string, monacoId: string, body: string): string {
  const cls = lang === '' ? '' : ` class="language-${escapeHtml(lang)}"`;
  return `<pre class="m2-frame-host m2-code"><code${cls}><span class="m2-frame-fallback">${escapeHtml(body)}</span>${frameHtml('code', body, `${lang} code`, monacoId)}</code></pre>`;
}

export const codeFence: CodeFenceRenderer = (lang, body) => {
  const id = monacoLanguage(lang);
  return Promise.resolve(id === undefined || body.length > MAX_CODE ? null : codeHost(lang, id, body));
};

const strictUtf8 = (b: Uint8Array): string => new TextDecoder('utf-8', { fatal: true }).decode(b);

export const codeHandler: Handler = {
  types: Object.keys(CODE_TYPES),
  capabilities: ['view'],
  render: (bytes, ctx) =>
    new Promise<string>((resolve) => {
      // A throw inside the executor rejects: handler-error fallback.
      const src = strictUtf8(bytes);
      if (src.length > MAX_CODE) throw new Error('code too large');
      const id = Object.hasOwn(CODE_TYPES, ctx.type) ? (CODE_TYPES[ctx.type] ?? 'plaintext') : 'plaintext';
      resolve(codeHost(id, id, src));
    }),
};

export const mermaidHandler: Handler = {
  types: ['text/vnd.mermaid'],
  capabilities: ['view'],
  render: (bytes, ctx) =>
    new Promise<string>((resolve) => {
      const src = strictUtf8(bytes);
      if (src.length > MAX_DIAGRAM) throw new Error('diagram too large');
      const title = ctx.node?.resource.attributes.get('title') ?? 'Mermaid diagram';
      resolve(
        `<div class="m2-frame-host m2-diagram"><pre class="m2-frame-fallback"><code class="language-mermaid">${escapeHtml(src)}</code></pre>${frameHtml('mermaid', src, title)}</div>`,
      );
    }),
};

export const mathHandler: Handler = {
  types: ['application/x-tex', 'application/mathml+xml'],
  capabilities: ['view'],
  async render(bytes, ctx) {
    const src = strictUtf8(bytes);
    if (src.length > MAX_MATH) throw new Error('formula too large');
    const { mathToSvg } = await import('./math.js'); // lazy: MathJax is large
    const svg = mathToSvg(src, ctx.type === 'application/mathml+xml' ? 'mathml' : 'tex');
    const data = encodeBase64(new TextEncoder().encode(svg));
    return `<div class="m2-math-block"><img class="m2-math" alt="${escapeHtml(src)}" src="data:image/svg+xml;base64,${data}"></div>`;
  },
};

export function createHandlers(): HandlerRegistry {
  const r = defaultHandlers();
  for (const h of [codeHandler, mermaidHandler, mathHandler]) r.register(h);
  return r;
}