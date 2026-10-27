import Plotly from 'plotly.js-dist-min';
import { isObject, parsePlotly } from '../charts.js';
import { serve } from './frame.js';

/**
 * Plotly in an opaque-origin frame. The figure was validated by the app and is
 * checked again here. Config is allowlisted, so a figure cannot point the
 * library at servers; the frame's CSP allows no network at all.
 */
serve(async ({ source, dark }, root) => {
  const spec = parsePlotly(source);
  const ink = dark ? '#e6e0d3' : '#25222c';
  const userFont = isObject(spec.layout.font) ? spec.layout.font : {};
  const layout = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    ...spec.layout,
    font: { color: ink, ...userFont },
  };
  root.style.height = `${layout.height}px`;
  await Plotly.newPlot(root, spec.data, layout, spec.config);
  if (spec.frames.length > 0) await Plotly.addFrames(root, spec.frames);
});