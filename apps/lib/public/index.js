import { $, benchParse, initChrome, ms, run, runRedTeamSuite } from './shared.js';

initChrome();

run(async () => {
  const { passed, total } = await runRedTeamSuite();
  $('proof-checks').textContent = `${passed}/${total}`;
});

setTimeout(() => {
  try {
    const r = benchParse(200, 3);
    $('proof-speed').textContent = ms(r.median);
  } catch (e) {
    $('proof-speed').textContent = 'n/a';
    console.error(e);
  }
}, 250);
