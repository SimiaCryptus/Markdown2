import {
  $,
  allHandlers,
  benchParse,
  decode,
  defineElement,
  esc,
  fmtBytes,
  gzipBase64,
  h,
  initChrome,
  Marked,
  marked,
  ms,
  REQUIRES_ASYNC,
  run,
  showDiagnostics,
  showError,
} from './shared.js';

initChrome();
defineElement('markdown2-view', { handlers: allHandlers });

// ---------------------------------------------------------------- custom handlers

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

// ---------------------------------------------------------------- sync & async parse

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

// ---------------------------------------------------------------- custom element themes

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

// ---------------------------------------------------------------- speed

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
          h('td', { className: 'num', textContent: `${Math.round(rate * 1000).toLocaleString()} resources/s · ${(((r.srcBytes / r.median) * 1000) / (1024 * 1024)).toFixed(1)} MB/s` }),
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
      await new Promise((r) => setTimeout(r, 30));
      try {
        results.unshift(benchParse(Number(b.dataset.n)));
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

setupThemes();
run(demoExtend);
run(demoParse);
run(demoSpeed);
