import {
  $,
  allHandlers,
  debounce,
  defaultConsent,
  encryptAge,
  fmtBytes,
  gzipBase64,
  h,
  initChrome,
  marked,
  mount,
  ms,
  PASS,
  resource,
  run,
  safeToken,
  showError,
  toBase64,
  utf8,
  WORK_FACTOR,
} from './shared.js';

initChrome();

const LAB_SAMPLES = {
  tricky: {
    label: 'A payload that fights back',
    type: 'text/plain',
    enc: 'none',
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
    label: 'Encrypted memo',
    type: 'text/markdown',
    enc: 'age',
    token: 'MEMO',
    title: 'Board memo',
    text: '## Board memo\n\nThe merger is **off**. Tell no one.\n\n| Option | Votes |\n| --- | ---: |\n| Proceed | 2 |\n| Cancel | 5 |\n',
  },
  svg: {
    label: 'Gzipped SVG',
    type: 'image/svg+xml',
    enc: 'gzip',
    token: 'ART',
    title: 'Concentric',
    text: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">${Array.from(
      { length: 12 },
      (_, i) => `<circle cx="80" cy="80" r="${76 - i * 6}" fill="${i % 2 ? '#0f6b5f' : '#b0802a'}"/>`,
    ).join('')}</svg>`,
  },
  tartlet: {
    label: 'Tartlet beat',
    type: 'text/vnd.tartlet',
    enc: 'none',
    token: 'BEAT',
    title: 'Lab beat',
    text: 'setcpm(112/4)\n$: s("bd*4, ~ sd ~ sd, hh*8").gain(.8)\n$: note("<c2 eb2 f2 g2>").s("sawtooth").lpf(550).release(.15)\n',
  },
  graphviz: {
    label: 'Graphviz graph',
    type: 'text/vnd.graphviz',
    enc: 'none',
    token: 'DOT',
    title: 'Simple flow',
    text: 'digraph {\n  rankdir=LR;\n  source -> parse -> decode -> render;\n}\n',
  },
};

async function demoLab() {
  let view = null;
  let seq = 0;
  let lastSrc = '';
  let url = null;

  const samples = $('lab-samples');
  samples.append(h('span', { className: 'label inline', textContent: 'Try:' }));
  for (const s of Object.values(LAB_SAMPLES)) {
    const b = h('button', { type: 'button', className: 'btn small', textContent: s.label });
    b.addEventListener('click', () => {
      $('lab-input').value = s.text;
      $('lab-type').value = s.type;
      $('lab-enc').value = s.enc;
      $('lab-token').value = s.token;
      $('lab-title').value = s.title;
      void build();
    });
    samples.append(b);
  }

  $('lab-input').value = LAB_SAMPLES.tricky.text;

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
      view = mount($('lab-view'), src, { baseUrl: location.href, handlers: allHandlers, consent: defaultConsent });
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
    const doc = `# From the resource lab\n\nPacked a moment ago. Edit it, break it, or unlock it.\n\n${lastSrc}\n`;
    try {
      sessionStorage.setItem('md2-lab-handoff', doc);
    } catch {
      // ignore storage failure
    }
    location.href = './playground.html';
  });

  await build();
}

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

run(demoLab);
run(demoNest);
