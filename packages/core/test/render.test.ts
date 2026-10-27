import { describe, expect, it } from 'vitest';
import {
  DecoderRegistry,
  defaultHandlers,
  fenceAliasType,
  HandlerRegistry,
  parse,
  renderHtml,
  resolveDocument,
  textHandler,
  type Decoder,
  type Handler,
  type RenderOptions,
  type ResolveOptions,
} from '../src/index.js';

const render = async (src: string, ro: ResolveOptions = {}, opts: RenderOptions = {}) =>
  renderHtml(await resolveDocument(parse(src), ro), opts);

const fakeAge: Decoder = {
  id: 'age',
  position: 'any',
  capability: 'key',
  decode: (input) => Promise.resolve(input),
};

describe('handler registry', () => {
  it('matches the essence exactly, per capability', () => {
    const r = new HandlerRegistry([textHandler]);
    expect(r.can('view', 'Text/Plain; charset=utf-8')).toBe(true);
    expect(r.can('view', 'text/plai')).toBe(false);
    expect(r.can('thumbnail', 'text/plain')).toBe(false);
    expect(r.can('view', undefined)).toBe(false);
    expect(defaultHandlers().types('view')).toContain('image/svg+xml');
    expect(defaultHandlers().types('thumbnail')).not.toContain('text/plain');
  });
  it('fence aliases', () => {
    expect(fenceAliasType('JSON')).toBe('application/json');
    expect(fenceAliasType('mermaid extra')).toBe('text/vnd.mermaid');
    expect(fenceAliasType('Plotly')).toBe('application/vnd.plotly.v1+json');
    expect(fenceAliasType('vega-lite')).toBe('application/vnd.vegalite.v5+json');
    expect(fenceAliasType('vegalite')).toBe('application/vnd.vegalite.v5+json');
    expect(fenceAliasType('python')).toBeUndefined();
  });
});

describe('rendering (§6)', () => {
  it('escapes prose and text payloads', async () => {
    const out = await render('<b>hi</b>\n<<<T type="text/plain"\n<script>x</script>\nT\n');
    expect(out).toContain('<p>&lt;b&gt;hi&lt;/b&gt;</p>');
    expect(out).toContain('<pre class="m2-text">&lt;script&gt;x&lt;/script&gt;</pre>');
    expect(out).not.toContain('<script>');
  });

  it('failed resources never leak their payload', async () => {
    const out = await render('<<<S type="text/plain"\nSECRET\n');
    expect(out).not.toContain('SECRET');
    expect(out).toContain('unterminated-resource');
    expect(out).toContain('md2-fallback');
  });

  it('locked resources show a stub with their title', async () => {
    const registry = new DecoderRegistry();
    registry.register(fakeAge);
    const out = await render('<<<E type="application/pdf" encoding="age" title="Q3.pdf"\nCIPHER\nE\n', { registry });
    expect(out).toContain('🔒');
    expect(out).toContain('Q3.pdf');
    expect(out).toContain('locked');
    expect(out).not.toContain('CIPHER');
  });

  it('did you mean, without correction (G.2)', async () => {
    const out = await render('<<<I type="image/jpg"\nx\nI\n');
    expect(out).toContain('Did you mean <code>image/jpeg</code>?');
    expect(out).not.toContain('<img');
  });

  it('declared type wins: HTML declared as PNG is not rendered as HTML (G.1)', async () => {
    const out = await render('<<<I type="image/png"\n<b>x</b>\nI\n');
    expect(out).toContain('src="data:image/png;base64,');
    expect(out).not.toContain('<b>');
  });

  it('images and SVG only through <img>', async () => {
    const png = await render('<<<I type="image/png" title="Logo"\nx\nI\n');
    expect(png).toContain('<img class="m2-image" alt="Logo" src="data:image/png;base64,eA==">');
    const svg = await render('<<<S type="image/svg+xml"\n<svg/>\nS\n');
    expect(svg).toContain('<img');
    expect(svg).not.toContain('<svg');
  });

  it('nested markdown renders recursively', async () => {
    const out = await render('<<<A type="text/markdown"\ninner\n<<<B type="text/plain"\ndeep\nB\nA\n');
    expect(out).toContain('<md2-document><p>inner</p>');
    expect(out).toContain('data-m2-id="0/1"');
    expect(out).toContain('deep');
  });

  it('invalid UTF-8 markdown falls back', async () => {
    const out = await render('<<<M type="text/markdown" encoding="base64"\n/w==\nM\n');
    expect(out).toContain('invalid-utf-8');
  });

  it('JSON is pretty-printed; invalid JSON is a handler error', async () => {
    expect(await render('<<<J type="application/json"\n{"a":1}\nJ\n')).toContain('&quot;a&quot;: 1');
    expect(await render('<<<J type="application/json"\n{\nJ\n')).toContain('handler-error');
  });

  it('YAML is shown, never instantiated (H.3)', async () => {
    const out = await render('<<<Y type="application/yaml"\nx: !!python/object:os.system ls\nY\n');
    expect(out).toContain('<pre class="m2-yaml">x: !!python/object:os.system ls</pre>');
  });

  it('sandboxed handlers run in an opaque-origin iframe', async () => {
    const evil: Handler = {
      types: ['application/x-acme'],
      capabilities: ['view'],
      sandbox: true,
      render: () => Promise.resolve('<script>alert(1)</script>'),
    };
    const out = await render('<<<X type="application/x-acme"\nx\nX\n', {}, { handlers: new HandlerRegistry([evil]) });
    expect(out).toContain('sandbox="allow-scripts"');
    expect(out).not.toContain('allow-same-origin');
    expect(out).not.toContain('<script>');
  });
});

describe('rel semantics (Appendix A)', () => {
  it('decoded metadata is consumed, not displayed', async () => {
    const out = await render('---\ntitle: SECRETMETA\n---\nBody\n');
    expect(out).not.toContain('SECRETMETA');
    expect(out).toContain('<p>Body</p>');
  });

  it('attachments are saveable items', async () => {
    const out = await render('<<<F type="application/pdf" rel="attachment" filename="r.pdf"\nx\nF\n');
    expect(out).toContain('m2-attachment');
    expect(out).toContain('data-m2-save-name="r.pdf"');
  });

  it('renders at most one of a resource and its alternate', async () => {
    const fallbackFirst = await render(
      '<<<A type="a/b"\nx\nA\n<<<B type="text/plain" rel="alternate"\nALTPAYLOAD\nB\n',
    );
    expect(fallbackFirst.match(/<md2-resource /g)).toHaveLength(1);
    expect(fallbackFirst).toContain('ALTPAYLOAD');
    expect(fallbackFirst).toContain('data-m2-shown="1"');
    const both = await render(
      '<<<A type="text/plain"\nMAIN\nA\n<<<B type="text/plain" rel="alternate"\nALTPAYLOAD\nB\n',
    );
    expect(both).toContain('MAIN');
    expect(both).not.toContain('ALTPAYLOAD');
  });

  it('describedby is linked for accessibility; orphans render inline', async () => {
    const out = await render('<<<I type="image/png"\nI\n<<<D type="text/plain" rel="describedby"\nalt text\nD\n');
    expect(out).toContain('aria-describedby="m2-1"');
    expect(out).toContain('data-m2-describes="0"');
    const orphan = await render('<<<D type="text/plain" rel="describedby"\nlonely\nD\n');
    expect(orphan).toContain('data-m2-rel="inline"');
    expect(orphan).toContain('lonely');
  });
});

describe('fence aliases (§7.2, F.3)', () => {
  it('select a handler without altering the tree', async () => {
    const src = '```json\n{"a":1}\n```\n';
    expect(parse(src).children.map((c) => c.kind)).toEqual(['prose']);
    const out = await render(src);
    expect(out).toContain('<pre class="m2-json">');
  });
  it('unknown or invalid fences stay code', async () => {
    expect(await render('```python\n<x>\n```\n')).toContain(
      '<pre><code class="language-python">&lt;x&gt;</code></pre>',
    );
    expect(await render('```json\n{\n```\n')).toContain('<code class="language-json">{</code>');
    expect(await render('```mermaid\ngraph TD\n```\n')).toContain('language-mermaid');
  });
  it('closes only on a matching fence of at least the opening length', async () => {
    // Tilde fence is not closed by backticks.
    const tilde = await render('~~~python\na\n```\nb\n~~~\n');
    expect(tilde).toContain('<code class="language-python">a\n```\nb</code>');
    // Four-backtick fence is not closed by three, but is closed by five.
    const long = await render('````\nx\n```\ny\n`````\nafter\n');
    expect(long).toContain('<pre><code>x\n```\ny</code></pre>');
    expect(long).toContain('<p>after</p>');
    // An unclosed fence runs to the end of the prose.
    expect(await render('```\nopen\n')).toContain('<pre><code>open\n</code></pre>');
  });
});
describe('prototype keys never act as table entries', () => {
  it('a code fence hook may present code; aliases and failures keep their path', async () => {
    const codeFence = (lang: string, body: string): Promise<string | null> => {
      if (lang === 'bad') return Promise.reject(new Error('boom'));
      return Promise.resolve(lang === 'ts' ? `<pre><code class="language-ts">HL:${body}</code></pre>` : null);
    };
    expect(await render('```ts\nlet a\n```\n', {}, { codeFence })).toContain('HL:let a');
    expect(await render('```py\nx\n```\n', {}, { codeFence })).toContain(
      '<pre><code class="language-py">x</code></pre>',
    );
    expect(await render('```bad\ny\n```\n', {}, { codeFence })).toContain('<code class="language-bad">y</code>');
    expect(await render('```json\n{"a":1}\n```\n', {}, { codeFence })).toContain('<pre class="m2-json">');
  });
  it('renders types and fences named after Object.prototype members', async () => {
    const out = await render('<<<X type="constructor"\nx\nX\n\n```constructor\ny\n```\n');
    expect(out).toContain('md2-fallback');
    expect(out).not.toContain('Did you mean');
    expect(out).toContain('<code class="language-constructor">y</code>');
  });
});
describe('prose rendering', () => {
  it('marks blocks and resources with their source line on request', async () => {
    const src = '# A\n\ntext\n<<<M type="text/markdown"\nx\n\n## B\nM\n';
    const out = await render(src, {}, { sourceLines: true });
    expect(out).toContain('<h1 data-m2-line="0">A</h1>');
    expect(out).toContain('<p data-m2-line="2">text</p>');
    expect(out).toMatch(/<md2-resource [^>]*data-m2-line="3"/);
    expect(out).toContain('<p data-m2-line="4">x</p>');
    expect(out).toContain('<h2 data-m2-line="6">B</h2>');
    expect(await render(src)).not.toContain('data-m2-line');
  });
  it('renders Markdown structure between resources, escaped', async () => {
    const out = await render('# Head\n\n- *a*\n- b\n<<<T type="text/plain"\nx\nT\n> quote <i>\n');
    expect(out).toContain('<h1>Head</h1>');
    expect(out).toContain('<ul>\n<li><em>a</em></li>\n<li>b</li>\n</ul>');
    expect(out).toContain('<blockquote>\n<p>quote &lt;i&gt;</p>\n</blockquote>');
  });
});
