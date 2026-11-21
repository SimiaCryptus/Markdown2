import { mathToSvg } from '../math.js';
import { serve } from './frame.js';

function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * MathJax (TeX and MathML) in an opaque-origin frame. The resulting SVG is shown
 * through <img>, where nothing in it can run.
 */
serve(async ({ source, lang, dark }, root) => {
  if (dark) document.documentElement.setAttribute('data-dark', '');
  const svg = mathToSvg(source, lang === 'mathml' ? 'mathml' : 'tex');
  const img = document.createElement('img');
  img.alt = source;
  img.src = `data:image/svg+xml;base64,${toBase64(svg)}`;
  root.append(img);
  await new Promise<void>((resolve, reject) => {
    img.onload = () => {
      resolve();
    };
    img.onerror = () => {
      reject(new Error('the formula image could not be displayed'));
    };
  });
});
