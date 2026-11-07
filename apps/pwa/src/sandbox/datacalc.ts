import { load, mount, type CanonicalJson } from '@datacalc/core';
import { serve } from './frame.js';

/**
 * DataCalculator workbooks in an opaque-origin frame. The engine is pure: formulas
 * cannot fetch, script or reach the app. Views write text content and whitelisted
 * attributes only. Input values are session state and live in this frame.
 *
 * `lang` is "json" for canonical JSON workbooks, otherwise the source is text syntax.
 */
serve(({ source, lang, dark }, root) => {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const workbook = lang === 'json' ? (JSON.parse(source) as CanonicalJson) : source;
  const wb = load(workbook);
  mount(wb, root);
  return Promise.resolve();
});