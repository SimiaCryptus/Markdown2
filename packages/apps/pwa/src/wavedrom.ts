import JSON5 from 'json5';
import onml from 'onml';
import renderAny from 'wavedrom/lib/render-any.js';
import skins from 'wavedrom/skins/default.js';

/** Upper bound for the SVG produced from one diagram (hscale and long waves can blow up). */
const MAX_SVG = 2_000_000;

/**
 * WaveJSON in, standalone SVG out. DOM-free.
 *
 * WaveDrom's own loader evaluates the source as JavaScript; here it is
 * parsed as JSON5, so nothing in it can run. The SVG is shown through
 * <img>, where nothing in it can run either.
 */
export function waveToSvg(source: string): string {
  const parsed: unknown = JSON5.parse(source);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('a WaveDrom diagram is an object such as { signal: [...] }');
  }
  const svg = onml.stringify(renderAny(0, parsed, skins));
  if (!svg.startsWith('<svg')) throw new Error('WaveDrom produced no SVG');
  if (svg.length > MAX_SVG) throw new Error('diagram too large');
  return svg.includes('xmlns="http://www.w3.org/2000/svg"')
    ? svg
    : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
}