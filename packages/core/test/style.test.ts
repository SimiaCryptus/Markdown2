import { describe, expect, it } from 'vitest';
import {
  appliedSheets,
  ByteQuota,
  collectStyles,
  composeCascade,
  parse,
  renderHtml,
  resolveDocument,
  sanitizeCss,
  selectionFor,
  UA_STYLESHEET,
  type StyleModel,
} from '../src/index.js';

const model = async (src: string): Promise<StyleModel> => collectStyles(await resolveDocument(parse(src)));
const render = async (src: string): Promise<string> => renderHtml(await resolveDocument(parse(src)));
const sheet = (tok: string, attrs: string, css: string): string =>
  `<<<${tok} type="text/css" rel="stylesheet"${attrs}\n${css}\n${tok}\n`;
const applied = (m: StyleModel, sel: ReadonlyMap<string, string | boolean> = new Map()): string[] =>
  appliedSheets(m, sel).map((s) => s.title ?? s.id);

describe('S. styling tree', () => {
  it('S.1 prose is wrapped in the root md2-document', async () => {
    expect(await render('hi\n')).toBe('<md2-document data-m2-root><p>hi</p></md2-document>');
  });
  it('S.2 sections nest by heading level', async () => {
    expect(await render('# A\n\np\n\n## B\n\np\n\n# C\n')).toBe(
      '<md2-document data-m2-root><md2-section level="1">\n<h1>A</h1>\n<p>p</p>\n<md2-section level="2">\n<h2>B</h2>\n<p>p</p>\n</md2-section>\n</md2-section>\n<md2-section level="1">\n<h1>C</h1>\n</md2-section></md2-document>',
    );
  });
  it('S.3 a heading inside a block quote does not start a section', async () => {
    expect(await render('> # q\n')).not.toContain('md2-section');
  });
  it('S.4 state attribute', async () => {
    const out = await render('<<<U type="image/png" encoding="uri"\nhttps://e.org/x\nU\n');
    expect(out).toContain('state="locked"');
    expect(out).toContain('encoding="uri"');
    expect(out).toContain('<md2-fallback');
  });
  it('S.5 essence', async () => {
    const out = await render(`<<<T type='text/plain; charset="utf-8"'\nx\nT\n`);
    expect(out).toContain('essence="text/plain"');
    expect(out).toContain('type="text/plain; charset=&quot;utf-8&quot;"');
    expect(out).toContain('<md2-view><pre class="m2-text">x</pre></md2-view>');
  });
  it('S.6 md2-class becomes class', async () => {
    expect(await render('<<<T type="text/plain" md2-class="a b"\nx\nT\n')).toContain('class="a b"');
  });
  it('S.7 a decoded nested document is the only child', async () => {
    expect(await render('<<<M type="text/markdown"\nx\nM\n')).toMatch(
      /<md2-resource [^>]*><md2-document><p>x<\/p><\/md2-document><\/md2-resource>/,
    );
  });
  it('stylesheets are never rendered inline', async () => {
    const out = await render(sheet('S', '', 'p{color:red}'));
    expect(out).toContain('rel="stylesheet"');
    expect(out).toContain('<md2-view></md2-view>');
    expect(out).not.toContain('color:red');
  });
});

describe('T. stylesheets', () => {
  it('T.1 persistent sheets stack in document order', async () => {
    expect(applied(await model(sheet('A', '', 'a{}') + sheet('B', '', 'b{}')))).toEqual(['0', '1']);
  });
  it('T.2 a two-member group applies exactly one member', async () => {
    const m = await model(
      sheet('L', ' md2-group="Theme" title="Light"', '') +
        sheet('D', ' md2-group="Theme" title="Dark" md2-default="on"', ''),
    );
    expect(m.groups[0]?.kind).toBe('alternatives');
    expect(applied(m)).toEqual(['Dark']);
  });
  it('T.3 a toggle with md2-default="off" applies only when switched on', async () => {
    const m = await model(sheet('S', ' md2-group="Summary" title="Summary" md2-default="off"', ''));
    expect(applied(m)).toEqual([]);
    const key = m.groups[0]?.key ?? '';
    expect(applied(m, new Map([[key, true]]))).toEqual(['Summary']);
  });
  it('T.4 a locked stylesheet is not applied', async () => {
    const m = await model('<<<S type="text/css" rel="stylesheet" encoding="uri"\nhttps://e.org/s.css\nS\n');
    expect(m.sheets[0]?.state).toBe('locked');
    expect(applied(m)).toEqual([]);
  });
  it('T.5 a non-CSS stylesheet is not applied and yields a diagnostic', async () => {
    const m = await model('<<<S type="text/plain" rel="stylesheet"\np{}\nS\n');
    expect(applied(m)).toEqual([]);
    expect(m.diagnostics.map((d) => d.code)).toEqual(['stylesheet-not-css']);
  });
  it('T.6 a nested stylesheet is scoped to its own document', async () => {
    const m = await model(`<<<M type="text/markdown" title="Inner"\n${sheet('S', '', 'p{color:red}')}M\n`);
    expect(m.sheets[0]).toMatchObject({ scope: '0', scopeLabel: 'Inner' });
    const css = composeCascade({ author: appliedSheets(m, new Map()) });
    expect(css).toContain('@scope (md2-resource[data-m2-id="0"] > md2-document) {\np{color:red}\n}');
  });
  it('T.7 md2-media wraps the sheet in @media', async () => {
    const m = await model(sheet('P', ' md2-media="print"', 'p{}'));
    expect(composeCascade({ author: appliedSheets(m, new Map()) })).toContain('@media print {');
  });
  it('bad md2-default and md2-media yield diagnostics', async () => {
    const m = await model(sheet('S', ' md2-group="G" title="T" md2-default="yes" md2-media="a{"', ''));
    expect(m.diagnostics.map((d) => d.code)).toEqual(['stylesheet-bad-default', 'stylesheet-bad-media']);
    expect(applied(m)).toEqual([]);
  });
});

describe('U. reader control', () => {
  const themes =
    sheet('L', ' md2-group="Theme" title="Light" md2-default="on"', ':root{}') +
    sheet('D', ' md2-group="Theme" title="Dark"', ':root{}');

  it('U.1 disabling document styles leaves the UA and user origins only', () => {
    const css = composeCascade({ user: ['p{}'] });
    expect(css).toContain(UA_STYLESHEET);
    expect(css.split('@layer m2-author {')[1]).not.toContain('@scope');
  });
  it('U.2 a user selection overrides md2-default', async () => {
    const m = await model(themes);
    const sel = selectionFor(m);
    sel.set(m.groups[0]?.key ?? '', '1');
    expect(applied(m, sel)).toEqual(['Dark']);
  });
  it('U.3 remembered preferences match by exact group name and title', async () => {
    const m = await model(themes);
    const prefs = { choices: new Map([['Theme', 'Dark']]), toggles: new Map<string, boolean>() };
    expect(applied(m, selectionFor(m, prefs))).toEqual(['Dark']);
    const other = { choices: new Map([['theme', 'Dark']]), toggles: new Map<string, boolean>() };
    expect(applied(m, selectionFor(m, other))).toEqual(['Light']);
  });
});

describe('V. CSS profile and security', () => {
  it('V.1 @import is removed', () => {
    const r = sanitizeCss('@import url(https://e.org/x.css);\n@\\69mport "y.css";\na{}');
    expect(r.css).not.toContain('e.org');
    expect(r.css).not.toContain('y.css');
    expect(r.removed).toContain('@import');
  });
  it('V.2 remote urls are blocked, data: urls kept', () => {
    expect(sanitizeCss('a{background:url(https://e.org/x)}').css).toBe('a{background:none}');
    expect(sanitizeCss('a{background:url("https://e.org/x")}').css).toBe('a{background:none}');
    expect(sanitizeCss('a{background:\\75 rl(https://e.org)}').css).toBe('a{background:none}');
    expect(sanitizeCss('a{background:image-set("x.png" 1x)}').css).toBe('a{background:none}');
    expect(sanitizeCss('a{background:url(data:image/png;base64,AA)}').css).toBe(
      'a{background:url("data:image/png;base64,AA")}',
    );
  });
  it('data: urls count towards the quota', () => {
    expect(sanitizeCss('a{b:url(data:,xxxx)}', { quota: new ByteQuota(2) }).css).toBe('a{b:none}');
  });
  it('output is balanced, so the scope wrapper cannot be escaped', () => {
    expect(sanitizeCss('}} :root { color: red', { rootToScope: true }).css).toBe(' :scope { color: red}');
    expect(sanitizeCss('a{content:"}"}').css).toBe('a{content:"}"}');
    // A stray `)` inside an open `{` block is dropped; as in browsers, it does not close the block.
    expect(sanitizeCss('a{color:f( { ) }').css).toBe('a{color:f( {  })}');
    expect(sanitizeCss('a{color:red/* open').css).toBe('a{color:red }');
  });
  it('author @scope rules are dropped', () => {
    expect(sanitizeCss('@scope (html) { body { color: red } } p{}').css).toBe(' p{}');
  });
  it('legacy script-bearing properties have no effect', () => {
    expect(sanitizeCss('a{-moz-binding:url(x)}').css).toBe('a{--m2-blocked-moz-binding:none}');
  });
  it('legacy behavior property and its url are neutralised', () => {
    expect(sanitizeCss('a{behavior:url(x.htc)}').css).toBe('a{--m2-blocked-behavior:none}');
  });
  it('quoted data: urls are kept and re-serialised', () => {
    expect(sanitizeCss('a{b:url( "data:,x" )}').css).toBe('a{b:url("data:,x")}');
  });
  it('malformed unquoted urls are removed', () => {
    const r = sanitizeCss('a{b:url(x y)}');
    expect(r.css).toBe('a{b:none}');
    expect(r.removed).toContain('url()');
  });
  it('remote urls may be kept for the user origin only', () => {
    const user = sanitizeCss('a{b:url(https://e.org/x)}', { allowRemoteUrls: true });
    expect(user.css).toBe('a{b:url("https://e.org/x")}');
  });
  it('blocked functions are replaced', () => {
    const r = sanitizeCss('a{b:element(#x)}');
    expect(r.css).toBe('a{b:none}');
    expect(r.removed).toContain('element()');
  });
  it('a string cut off by a newline is closed', () => {
    expect(sanitizeCss('a{content:"x\nb:c}').css).toBe('a{content:"x"\nb:c}');
  });
  it('V.3 the root document is contained', () => {
    expect(UA_STYLESHEET).toContain('contain: layout paint !important');
  });
  it('V.4 fallbacks stay visible with !important UA rules', () => {
    expect(UA_STYLESHEET).toMatch(/md2-fallback \{\s*display: block !important;/);
    const css = composeCascade();
    expect(css.indexOf('@layer m2-ua, m2-user, m2-author;')).toBe(0);
  });
});
