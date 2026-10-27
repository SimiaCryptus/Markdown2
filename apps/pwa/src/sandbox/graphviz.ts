import { instance } from '@viz-js/viz';
import { serve } from './frame.js';

const ENGINES: ReadonlySet<string> = new Set([
  'dot',
  'neato',
  'fdp',
  'sfdp',
  'circo',
  'twopi',
  'osage',
  'patchwork',
]);

function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Graphviz (WebAssembly) in an opaque-origin frame. The resulting SVG is shown
 * through <img>, so URL and href attributes in a graph stay inert.
 */
serve(async ({ source, lang }, root) => {
  const viz = await instance();
  const engine = lang !== undefined && ENGINES.has(lang) ? lang : 'dot';
  const result = viz.render(source, { format: 'svg', engine });
  if (result.status === 'failure') {
    throw new Error(result.errors[0]?.message ?? 'the graph could not be drawn');
  }
  const img = document.createElement('img');
  img.alt = 'Graphviz graph';
  img.style.cssText = 'display:block;max-width:100%;height:auto;margin:0 auto';
  img.src = `data:image/svg+xml;base64,${toBase64(result.output)}`;
  root.append(img);
  await new Promise<void>((resolve, reject) => {
    img.onload = () => {
      resolve();
    };
    img.onerror = () => {
      reject(new Error('the graph image could not be displayed'));
    };
  });
});