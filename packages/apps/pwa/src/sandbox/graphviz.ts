import { instance } from '@viz-js/viz';
import { serve } from './frame.js';

const ENGINES = new Set(['dot', 'neato', 'fdp', 'sfdp', 'circo', 'twopi', 'osage', 'patchwork']);

/**
 * Graphviz compiled to WebAssembly. The SVG it produces is shown through
 * <img>, so links and anything else in it stay inert.
 */
serve(async ({ source, lang, dark }, root) => {
  const viz = await instance();
  const engine = lang !== undefined && ENGINES.has(lang) ? lang : 'dot';
  const svg = viz.renderString(source, { format: 'svg', engine });
  const img = document.createElement('img');
  img.alt = 'Graphviz diagram';
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  img.style.cssText = 'display:block;max-width:100%;height:auto;margin:0 auto';
  if (dark) img.style.filter = 'invert(0.9) hue-rotate(180deg)';
  root.append(img);
  await img.decode().catch(() => undefined);
});