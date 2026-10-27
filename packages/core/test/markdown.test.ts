import { describe, expect, it } from 'vitest';
import { renderMarkdown, safeHref } from '../src/index.js';

const md = (s: string) => renderMarkdown(s);

describe('prose renderer (CommonMark subset)', () => {
  it('headings and thematic breaks', async () => {
    expect(await md('# Title\n')).toBe('<h1>Title</h1>');
    expect(await md('## Sub ##\n')).toBe('<h2>Sub</h2>');
    expect(await md('Foo\n===\n')).toBe('<h1>Foo</h1>');
    expect(await md('Foo\n---\n')).toBe('<h2>Foo</h2>');
    expect(await md('***\n')).toBe('<hr>');
    expect(await md('#5 bolt\n')).toBe('<p>#5 bolt</p>');
  });

  it('emphasis, code spans and escapes', async () => {
    expect(await md('a *b* **c** ***d***')).toBe('<p>a <em>b</em> <strong>c</strong> <em><strong>d</strong></em></p>');
    expect(await md('snake_case_word')).toBe('<p>snake_case_word</p>');
    expect(await md('use `a<b` here')).toBe('<p>use <code>a&lt;b</code> here</p>');
    expect(await md('\\*not em\\*')).toBe('<p>*not em*</p>');
  });

  it('links are restricted to safe schemes; images are never fetched', async () => {
    expect(await md('[x](https://e.org "T")')).toBe(
      '<p><a href="https://e.org" title="T" rel="noopener noreferrer nofollow">x</a></p>',
    );
    expect(await md('[x](javascript:alert(1))')).toBe('<p>x</p>');
    expect(await md('<https://e.org/a>')).toBe(
      '<p><a href="https://e.org/a" rel="noopener noreferrer nofollow">https://e.org/a</a></p>',
    );
    const img = await md('![logo](https://e.org/l.png)');
    expect(img).toContain('class="m2-prose-image"');
    expect(img).not.toContain('<img');
    expect(safeHref('JaVaScRiPt:x')).toBeNull();
    expect(safeHref('java\tscript:x')).toBeNull();
    expect(safeHref('#top')).toBe('#top');
  });

  it('raw HTML is escaped', async () => {
    expect(await md('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });

  it('lists', async () => {
    expect(await md('- a\n- b\n')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
    expect(await md('3. x\n4. y\n')).toBe('<ol start="3">\n<li>x</li>\n<li>y</li>\n</ol>');
    expect(await md('- a\n\n- b\n')).toBe('<ul>\n<li><p>a</p></li>\n<li><p>b</p></li>\n</ul>');
  });

  it('block quotes with lazy continuation', async () => {
    expect(await md('> # h\n> text\nlazy\n')).toBe('<blockquote>\n<h1>h</h1>\n<p>text\nlazy</p>\n</blockquote>');
  });

  it('hard breaks and entities', async () => {
    expect(await md('a  \nb')).toBe('<p>a<br>\nb</p>');
    expect(await md('&amp; &copy; &#65; &bogus; &constructor;')).toBe('<p>&amp; © A &amp;bogus; &amp;constructor;</p>');
  });

  it('code blocks', async () => {
    expect(await md('    x <y>\n')).toBe('<pre><code>x &lt;y&gt;</code></pre>');
    expect(await md('```js\nconst a = 1;\n```\n')).toBe('<pre><code class="language-js">const a = 1;</code></pre>');
  });
  it('tables (GFM)', async () => {
    expect(await md('| a | b |\n| :- | -: |\n| 1 | `x \\| y` |\n')).toBe(
      '<table>\n<thead>\n<tr>\n<th align="left">a</th>\n<th align="right">b</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td align="left">1</td>\n<td align="right"><code>x | y</code></td>\n</tr>\n</tbody>\n</table>',
    );
    expect(await md('p\n| a |\n| --- |\n| *b* |\n')).toBe(
      '<p>p</p>\n<table>\n<thead>\n<tr>\n<th>a</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td><em>b</em></td>\n</tr>\n</tbody>\n</table>',
    );
    expect(await md('a | b\n')).toBe('<p>a | b</p>');
    expect(await md('| a | b |\n| --- |\n')).toBe('<p>| a | b |\n| --- |</p>');
  });
  it('strikethrough (GFM)', async () => {
    expect(await md('~~gone~~ ~one~')).toBe('<p><del>gone</del> ~one~</p>');
  });

  it('stays bounded on pathological input', async () => {
    await expect(md('>'.repeat(5000) + ' x')).resolves.toContain('<blockquote>');
    await expect(md('['.repeat(5000) + ']('.repeat(5000))).resolves.toContain('[');
    await expect(md('*a'.repeat(5000))).resolves.toContain('*a');
  });
});
