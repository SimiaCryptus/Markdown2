import type { LiteElement } from 'mathjax-full/js/adaptors/lite/Element.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { MathML } from 'mathjax-full/js/input/mathml.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/base/BaseConfiguration.js';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { SVG } from 'mathjax-full/js/output/svg.js';

/**
 * MathJax without a DOM: TeX or MathML in, standalone SVG out. Only the `base`
 * and `ams` TeX packages are loaded (no \require, no \def). The SVG is shown
 * through <img>, where nothing in it can run.
 */
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

type Doc = ReturnType<typeof mathjax.document>;
let texDoc: Doc | undefined;
let mmlDoc: Doc | undefined;

export function mathToSvg(source: string, input: 'tex' | 'mathml'): string {
  const doc =
    input === 'tex'
      ? (texDoc ??= mathjax.document('', {
          InputJax: new TeX({ packages: ['base', 'ams'] }),
          OutputJax: new SVG({ fontCache: 'none' }),
        }))
      : (mmlDoc ??= mathjax.document('', { InputJax: new MathML(), OutputJax: new SVG({ fontCache: 'none' }) }));
  const node = doc.convert(source, { display: true }) as LiteElement;
  const svg = adaptor.innerHTML(node);
  if (!svg.startsWith('<svg')) throw new Error('MathJax produced no SVG');
  return svg.includes('xmlns="http://www.w3.org/2000/svg"')
    ? svg
    : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
}