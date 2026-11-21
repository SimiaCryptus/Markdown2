import { $, initChrome, mountEditableDemo, run } from './shared.js';

initChrome();

const MERMAID_SRC = `### Sequence diagram (fenced)

\`\`\`mermaid
sequenceDiagram
  participant U as You
  participant R as Reader
  participant S as Server
  U->>R: Open document
  R-->>U: Locked uri resource
  U->>R: Unlock…
  R->>S: GET (no cookies)
  S-->>R: Bytes only
  R-->>U: Rendered with declared type
\`\`\`

### Decode pipeline (resource)

<<<FLOW type="text/vnd.mermaid" title="The decode pipeline"
flowchart LR
  P[payload] --> B[base64]
  B --> G[gzip]
  G --> H{handler for type?}
  H -- yes --> V[view]
  H -- no --> F[fallback stub]
FLOW
`;

const gvSource = (engine) => `### Directed graph (fenced \`dot\`)

\`\`\`dot
digraph decode {
  rankdir=LR;
  node [shape=box, style=rounded, fontname="Helvetica"];
  payload -> base64 -> gzip -> handler;
  handler -> view     [label="known type"];
  handler -> fallback [label="unknown type", style=dashed];
}
\`\`\`

### Network graph (\`layout="${engine}"\`)

<<<NETWORK type="text/vnd.graphviz" layout="${engine}" title="A small network (${engine})"
graph network {
  node [shape=circle, style=filled, fillcolor="#d8ece7"];
  edge [color="#b0802a"];
  hub [shape=doublecircle, fillcolor="#f3e4c3"];
  hub -- a; hub -- b; hub -- c; hub -- d;
  a -- b; c -- d;
}
NETWORK
`;

const WAVE_SRC = `### SPI timing diagram (fenced)

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

### Register map (resource)

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
`;

const SVG_SRC = `The \`<script>\` tag inside this SVG is completely inert because Markdown2 renders SVGs through \`<img>\`:

<<<ORBIT type="image/svg+xml" title="An orbit, with a harmless script"
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120">
  <rect width="240" height="120" rx="12" fill="#1c1a24"/>
  <ellipse cx="120" cy="60" rx="90" ry="36" fill="none" stroke="#b0802a" stroke-width="2" stroke-dasharray="4 4"/>
  <circle cx="120" cy="60" r="16" fill="#f4d796"/>
  <circle cx="204" cy="48" r="8" fill="#57c0ac"/>
  <script>alert('this never runs')</script>
</svg>
ORBIT
`;

run(async () => {
  await mountEditableDemo({
    editorId: 'mermaid-src',
    viewId: 'mermaid-view',
    resetId: 'mermaid-reset',
    timeId: 'mermaid-time',
    source: MERMAID_SRC,
  });

  const gv = await mountEditableDemo({
    editorId: 'gv-src',
    viewId: 'gv-view',
    resetId: 'gv-reset',
    timeId: 'gv-time',
    source: gvSource('neato'),
  });

  const engineButtons = [...$('gv-engines').querySelectorAll('button[data-engine]')];
  for (const btn of engineButtons) {
    btn.addEventListener('click', () => {
      const eng = btn.dataset.engine;
      for (const b of engineButtons) b.setAttribute('aria-pressed', String(b === btn));
      void gv.setSource(gvSource(eng));
    });
  }

  await mountEditableDemo({
    editorId: 'wave-src',
    viewId: 'wave-view',
    resetId: 'wave-reset',
    timeId: 'wave-time',
    source: WAVE_SRC,
  });

  await mountEditableDemo({
    editorId: 'svg-src',
    viewId: 'svg-view',
    resetId: 'svg-reset',
    timeId: 'svg-time',
    source: SVG_SRC,
  });
});
