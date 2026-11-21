import { $, initChrome, mountEditableDemo, run } from './shared.js';

initChrome();

const GROOVE_SRC = `### A first sketch (\`text/vnd.tartlet\`)

<<<GROOVE type="text/vnd.tartlet" title="D-minor groove"
setcpm(92/4)

$: s("bd*2 [~ bd] sd ~, hh*8").gain(.8)
$: note("<d2 d2 f2 c2>").s("sawtooth").lpf(600).release(.2)
$: n("<0 2 4 6>").scale("D:minor").s("triangle").room(.4).slow(2)
GROOVE

### Fenced sketch (\`\`\`tartlet)

\`\`\`tartlet
setcpm(124/4)
$: s("bd*4, [~ hh]*4, ~ cp ~ cp").gain(.9)
$: note("<c2 c2 eb2 g1>*2").s("sawtooth").lpf(500).release(.1)
\`\`\`
`;

const seedSource = (seed) => `<<<CHANCE type="text/vnd.tartlet" title="Chance (${seed})" tartlet-seed="${seed}"
setcpm(124/4)
$: s("bd*4, hh*16?0.4")
$: note("c3 eb3 g3 bb3").s("triangle").degradeBy(.3).sometimesBy(.4, x => x.add(12)).release(.1)
CHANCE
`;

run(async () => {
  await mountEditableDemo({
    editorId: 'groove-src',
    viewId: 'groove-view',
    resetId: 'groove-reset',
    timeId: 'groove-time',
    source: GROOVE_SRC,
  });

  const seeded = await mountEditableDemo({
    editorId: 'seed-src',
    viewId: 'seed-view',
    resetId: 'seed-reset',
    timeId: 'seed-time',
    source: seedSource('take-2'),
  });

  const buttons = [...$('seed-buttons').querySelectorAll('button[data-seed]')];
  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      const s = btn.dataset.seed;
      for (const b of buttons) b.setAttribute('aria-pressed', String(b === btn));
      void seeded.setSource(seedSource(s));
    });
  }
});
