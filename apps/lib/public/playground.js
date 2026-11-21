import {
  $,
  allHandlers,
  debounce,
  defaultConsent,
  encryptAge,
  h,
  initChrome,
  marked,
  mount,
  ms,
  PASS,
  resource,
  run,
  showDiagnostics,
  WORK_FACTOR,
} from './shared.js';

initChrome();

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

## Opaque bytes, typed views

<<<SAME type="application/json" title="Typed as application/json"
{"note": "# still not a heading", "list": ["- not", "- a list"]}
SAME
`;

const NESTING = `# Documents inside documents

<<<CASE type="text/markdown" title="Case file 41-B"
## Case file 41-B

Filed by the night desk. Ordinary Markdown: **bold**, *italic*, a [link](https://commonmark.org).

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

Back in the case file: plain paragraphs again.
CASE
`;

const DIAGRAMS = `# Diagrams: Mermaid, Graphviz, WaveDrom & SVG

<<<FLOW type="text/vnd.mermaid" title="Mermaid flowchart"
flowchart LR
  P[payload] --> B[base64] --> G[gzip] --> H{handler?}
  H -- yes --> V[view]
  H -- no --> F[fallback]
FLOW

<<<NET type="text/vnd.graphviz" layout="neato" title="Graphviz (neato)"
graph network {
  node [shape=circle, style=filled, fillcolor="#d8ece7"];
  edge [color="#b0802a"];
  hub [shape=doublecircle, fillcolor="#f3e4c3"];
  hub -- a; hub -- b; hub -- c; hub -- d;
  a -- b; c -- d;
}
NET

\`\`\`wavedrom
{ signal: [
  { name: "clk",  wave: "p......" },
  { name: "req",  wave: "0.1..0." },
  { name: "ack",  wave: "0..1..0" }
] }
\`\`\`

<<<ORBIT type="image/svg+xml" title="Inert SVG (script never runs)"
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><ellipse cx="100" cy="50" rx="80" ry="30" fill="none" stroke="#b0802a" stroke-width="2" stroke-dasharray="4 4"/><circle cx="100" cy="50" r="14" fill="#f4d796"/><circle cx="172" cy="40" r="7" fill="#0f6b5f"/><script>alert('never runs')</script></svg>
ORBIT
`;

const MATH = `# Mathematics with MathJax

\`\`\`math
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
\`\`\`

<<<MAXWELL type="application/x-tex" title="Maxwell's equations"
\\begin{aligned}
\\nabla \\cdot \\mathbf{E} &= \\frac{\\rho}{\\varepsilon_0} \\\\
\\nabla \\times \\mathbf{B} &= \\mu_0 \\mathbf{J} + \\mu_0 \\varepsilon_0 \\frac{\\partial \\mathbf{E}}{\\partial t}
\\end{aligned}
MAXWELL

<<<QUADRATIC type="application/mathml+xml" title="Quadratic formula (MathML)"
<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mi>x</mi><mo>=</mo><mfrac><mrow><mo>−</mo><mi>b</mi><mo>±</mo><msqrt><msup><mi>b</mi><mn>2</mn></msup><mo>−</mo><mn>4</mn><mi>a</mi><mi>c</mi></msqrt></mrow><mrow><mn>2</mn><mi>a</mi></mrow></mfrac></math>
QUADRATIC
`;

const MUSIC = `# Tartlet music sketches

Press play inside a sketch to synthesize it locally (zero network).

<<<GROOVE type="text/vnd.tartlet" title="D-minor groove"
setcpm(92/4)
$: s("bd*2 [~ bd] sd ~, hh*8").gain(.8)
$: note("<d2 d2 f2 c2>").s("sawtooth").lpf(600).release(.2)
$: n("<0 2 4 6>").scale("D:minor").s("triangle").room(.4).slow(2)
GROOVE

<<<CHANCE type="text/vnd.tartlet" title="Seeded variation" tartlet-seed="take-2"
setcpm(124/4)
$: s("bd*4, hh*16?0.4")
$: note("c3 eb3 g3 bb3").s("triangle").degradeBy(.3).release(.1)
CHANCE
`;

const CHARTS = `# Charts: Plotly, Vega-Lite & Google Charts

<<<BARS type="application/vnd.plotly.v1+json" title="Plotly bar chart (offline)"
{
  "data": [{ "type": "bar", "x": ["Mercury", "Venus", "Earth", "Mars"], "y": [4879, 12104, 12756, 6792], "marker": { "color": "#0f6b5f" } }],
  "layout": { "title": { "text": "Rocky planet diameters (km)" }, "height": 300 }
}
BARS

<<<VEGA type="application/vnd.vegalite.v5+json" title="Vega-Lite (offline)"
{
  "width": "container",
  "height": 180,
  "data": { "values": [{ "q": "Q1", "v": 28 }, { "q": "Q2", "v": 41 }, { "q": "Q3", "v": 53 }, { "q": "Q4", "v": 67 }] },
  "mark": { "type": "area", "line": true, "color": "#b0802a" },
  "encoding": { "x": { "field": "q", "type": "ordinal" }, "y": { "field": "v", "type": "quantitative" } }
}
VEGA

<<<PIE type="application/vnd.google.charts+json" title="Google Chart (waits for consent)"
{
  "chartType": "PieChart",
  "data": [["Kind", "Count"], ["Tables", 8], ["Diagrams", 6], ["Charts", 5]],
  "options": { "pieHole": 0.4, "height": 260 }
}
PIE
`;

const CALCULATORS = `# Live Calculators (DataCalculator)

<<<MORTGAGE type="text/vnd.datacalc" title="Mortgage"
input principal: money(USD) = 300000 { min: 0 }
input annualRate: percent = 6.5% { min: 0, max: 30% }
input years: integer = 30 { min: 1, max: 50 }

payment: money(USD) = PMT(annualRate / 12, years * 12, -principal)
totalPaid: money(USD) = payment * years * 12
interest: money(USD) = totalPaid - principal

view form(principal, annualRate, years) -> payment, totalPaid, interest
MORTGAGE
`;

const MAPS_3D = `# Maps (GeoJSON) & 3D (X3D)

<<<OBS type="application/geo+json" basemap="positron" title="Royal Observatory, Greenwich"
{
  "type": "FeatureCollection",
  "features": [
    { "type": "Feature", "properties": { "name": "Royal Observatory", "marker-color": "#b4441c" }, "geometry": { "type": "Point", "coordinates": [-0.0015, 51.4769] } },
    { "type": "Feature", "properties": { "name": "Cutty Sark" }, "geometry": { "type": "Point", "coordinates": [-0.0096, 51.4828] } }
  ]
}
OBS

<<<CUBE type="model/x3d+xml" title="X3D interactive scene"
<X3D profile='Interchange' version='4.0'>
  <Scene>
    <Background skyColor='0.96 0.93 0.85'/>
    <Viewpoint position='0 0 7'/>
    <Transform rotation='1 1 0 0.6'>
      <Shape>
        <Appearance><Material diffuseColor='0.06 0.42 0.37'/></Appearance>
        <Box size='2 2 2'/>
      </Shape>
    </Transform>
  </Scene>
</X3D>
CUBE
`;

const DATA = `---
title: Mission log
mission: Kestrel-7
---
# Mission log: Kestrel-7

<<<TELEMETRY type="application/json" title="Telemetry, pretty-printed"
{"t":"T+00:42:17","altitude_km":412.6,"velocity_kms":7.66,"systems":{"power":"nominal","comms":"nominal","thermal":"watch"}}
TELEMETRY

<<<CREW type="text/csv" title="Crew, with quoting"
Name,Role,Notes
"Okafor, A.",Commander,"First flight: 2061"
Lindqvist,Pilot,"Says ""hello"" to every satellite"
CREW

<<<CONFIG type="application/yaml" title="Flight config (never instantiated)"
mission: Kestrel-7
payload: !!python/object/apply:os.system ["rm -rf /"]
CONFIG
`;

const ALTERNATES = `# Postcards from 2077

<<<HOLO type="model/x-hologram" title="A spinning city"
opaque hologram data
HOLO
<<<HOLOTEXT type="text/plain" rel="alternate" title="Described in words"
A small city spins slowly above a desk, its towers lit gold and green.
HOLOTEXT

<<<CARD type="text/html" rel="attachment" filename="postcard.html" title="A postcard"
<h1>Wish you were here</h1>
CARD
`;

const REMOTE = `# Remote content, on your say-so

<<<ICON type="image/svg+xml" encoding="uri" title="The Markdown2 icon"
https://md2.cognotik.com/icon.svg
ICON

<<<ABBEY type="text/uri-list" title="Mont-Saint-Michel"
https://www.openstreetmap.org/export/embed.html?bbox=-1.5200%2C48.6300%2C-1.4900%2C48.6420&layer=mapnik
ABBEY

<<<PLAIN type="text/uri-list" title="Plain http: refused by default"
http://example.org/
PLAIN
`;

const FAILURES = `# A museum of broken things

<<<NOTYPE title="Exhibit A: no type at all"
# If you can read this as a heading, something went wrong.
NOTYPE

<<<NEARMISS type="image/jpg" title="Exhibit B: a near miss"
the correct name is image/jpeg; you get a hint, never a silent fix
NEARMISS

<<<BADB64 type="text/plain" encoding="base64" title="Exhibit C: broken base64"
!!! this is not base64 !!!
BADB64

<<<BADJSON type="application/json" title="Exhibit D: invalid JSON"
{"ok": true, "missing": "a closing brace"
BADJSON
`;

const PRESETS = {
  vaults: { label: 'Vaults & locks', blurb: 'Encrypted sections, nested vaults and a key that is never inherited. Passphrase: markdown2.', source: vaultSource },
  diagrams: { label: 'Diagrams', blurb: 'Mermaid, Graphviz (WASM), WaveDrom and inert SVG in one document.', source: DIAGRAMS },
  math: { label: 'Math', blurb: 'TeX (fenced and resource) and MathML rendered by MathJax to inert SVG.', source: MATH },
  music: { label: 'Music (Tartlet)', blurb: 'Strudel-style music sketches synthesized locally in an opaque-origin sandbox.', source: MUSIC },
  charts: { label: 'Charts', blurb: 'Offline Plotly and Vega-Lite alongside a consent-gated Google Chart.', source: CHARTS },
  calculators: { label: 'Calculators', blurb: 'Reactive DataCalculator workbook with pure formulas and typed inputs.', source: CALCULATORS },
  maps3d: { label: 'Maps & 3D', blurb: 'Consent-gated GeoJSON map and an offline interactive X3D scene.', source: MAPS_3D },
  opacity: { label: 'Opacity', blurb: 'Everything inside a resource is bytes until its terminator. Nothing needs escaping.', source: OPACITY },
  nesting: { label: 'Nesting', blurb: 'Documents inside documents, each with its own scoped stylesheet.', source: NESTING },
  data: { label: 'Data', blurb: 'JSON, CSV with quoting and hostile YAML (never instantiated).', source: DATA },
  alternates: { label: 'Alternates', blurb: 'Future formats with plain-text alternates and safe attachment saving.', source: ALTERNATES },
  remote: { label: 'Remote', blurb: 'Images and embedded pages that wait for permission. Try the consent policy switch.', source: REMOTE },
  failures: { label: 'Fail closed', blurb: 'Broken resources become labelled stubs and diagnostics — never leaked bytes.', source: FAILURES },
};

function presetSource(key) {
  const p = PRESETS[key];
  if (typeof p.source !== 'function') return Promise.resolve(p.source);
  p.cache ??= p.source();
  return p.cache;
}

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

run(async () => {
  setupTabs();
  const editor = $('live-src');
  const chips = $('presets');
  let view = null;
  let policy = 'ask';

  // Check if handed off from lab.html or URL ?scene=...
  let handedOff = null;
  try {
    handedOff = sessionStorage.getItem('md2-lab-handoff');
    if (handedOff) sessionStorage.removeItem('md2-lab-handoff');
  } catch {
    handedOff = null;
  }
  const urlScene = new URLSearchParams(location.search).get('scene');
  let current = handedOff ? null : urlScene && Object.hasOwn(PRESETS, urlScene) ? urlScene : 'vaults';

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

  let currentSource = handedOff ?? (await presetSource(current));
  $('preset-blurb').textContent = handedOff
    ? 'A resource you packed in the Resource Lab. Edit it, break it, or unlock it.'
    : PRESETS[current].blurb;
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
    $('live-diags').textContent = `· ${state.diagnostics.length}`;
    showDiagnostics($('play-diags'), state.diagnostics);
  };

  view = mount($('live-view'), currentSource, {
    baseUrl: location.href,
    handlers: allHandlers,
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
});
