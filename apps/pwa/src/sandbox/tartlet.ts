import { defineTartletPlayer, type TartletPlayerElement } from '@tartlet/element';
import { serve } from './frame.js';

/**
 * Tartlet music sketches in an opaque-origin frame. The sketch is parsed by
 * Tartlet's closed language and never evaluated as JavaScript. Sound starts
 * only when the reader presses play inside the frame.
 *
 * The evaluation worker cannot start in an opaque origin; the player falls
 * back to evaluating on this thread.
 */
const DARK: Readonly<Record<string, string>> = {
  '--tt-bg': 'transparent',
  '--tt-fg': '#e6e0d3',
  '--tt-muted': '#9c94a5',
  '--tt-border': '#443f4f',
  '--tt-error': '#ef7c55',
  '--tt-warning': '#e2b24c',
  '--tt-info': '#8fb3d6',
};
const PULSE: readonly [number, number] = [3, 30];

serve(({ source, lang, dark }, root) => {
  defineTartletPlayer();
  const player = document.createElement('tartlet-player') as TartletPlayerElement;
  player.setAttribute('document-id', 'markdown2');
  player.setAttribute('blob-index', '0');
  if (lang !== undefined && lang !== '') player.setAttribute('seed', lang);
  if (dark) for (const [k, v] of Object.entries(DARK)) player.style.setProperty(k, v);
  else player.style.setProperty('--tt-bg', 'transparent');

  // Steady pulsing between 3 and 30 Hz: warn on the first press, play on the second.
  const note = document.createElement('p');
  note.className = 'm2-pulse';
  note.hidden = true;
  let acknowledged = false;
  player.addEventListener('beforeplay', (e) => {
    if (acknowledged) return;
    const rates = (player.program?.advisories ?? []).flatMap((a) => (a.pulse ? [a.pulse] : []));
    const pulsing = rates.some(([lo, hi]) => hi >= PULSE[0] && lo <= PULSE[1]);
    if (!pulsing) return;
    e.preventDefault();
    acknowledged = true;
    const text = rates.map(([lo, hi]) => (lo === hi ? `${String(lo)} Hz` : `${String(lo)}–${String(hi)} Hz`)).join(', ');
    note.textContent = `This sketch pulses steadily (${text}). Rhythmic stimulation can, rarely, contribute to seizures in susceptible people. Keep the volume low; press play again to listen.`;
    note.hidden = false;
  });

  // Set the source before connecting, so the player never reads its own text content.
  player.source = source;
  root.append(player, note);

  return new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 5000);
    player.addEventListener('diagnostics', done, { once: true });
  });
});