import { loader as makeLoader } from 'vega';
import embed, { type VisualizationSpec } from 'vega-embed';
import { expressionInterpreter } from 'vega-interpreter';
import { parseVegaLite } from '../charts.js';
import { serve } from './frame.js';

const refuse = (): Promise<never> => Promise.reject(new Error('external resources are not loaded: use inline data'));

/**
 * Vega-Lite in an opaque-origin frame.
 *
 * - Expressions run through vega-interpreter (an AST walker), so the frame
 *   needs no 'unsafe-eval'.
 * - The loader refuses every request: data and images must be inline.
 * - The actions menu (export, "open in editor") is off.
 */
serve(async ({ source, dark }, root) => {
  const spec = parseVegaLite(source);
  const loader = makeLoader();
  loader.load = refuse;
  loader.sanitize = refuse;
  loader.http = refuse;
  loader.file = refuse;
  await embed(root, spec as VisualizationSpec, {
    mode: 'vega-lite',
    actions: false,
    renderer: 'svg',
    ast: true,
    expr: expressionInterpreter,
    loader,
    ...(dark ? { theme: 'dark' as const } : {}),
    config: { background: 'transparent' },
  });
});