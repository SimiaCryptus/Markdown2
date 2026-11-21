import { $, ATTACKS, h, initChrome, run, runRedTeamSuite } from './shared.js';

initChrome();

run(async () => {
  const grid = $('rt-grid');
  const { passed, total, items } = await runRedTeamSuite();

  for (const item of items) {
    const card = h('article', { className: 'rt-card' });
    grid.append(card);
    if (item.error) {
      card.append(
        h('h3', { textContent: item.attack.title }),
        h('p', { className: 'err', textContent: `Could not run: ${item.error instanceof Error ? item.error.message : item.error}` }),
      );
      continue;
    }
    const out = h('div', { className: 'md2-surface out rt-out' });
    out.innerHTML = item.html;
    card.append(
      h(
        'h3',
        {},
        h('span', { textContent: item.attack.title }),
        h('small', {
          className: item.good === item.results.length ? 'pass-count' : 'fail-count',
          textContent: `${item.good}/${item.results.length}`,
        }),
      ),
      h('p', { className: 'note', textContent: item.attack.threat }),
      h('ul', { className: 'checks' }, ...item.results.map(([label, ok]) => h('li', { className: ok ? 'pass' : 'fail', textContent: label }))),
      h('details', {}, h('summary', { textContent: 'Attack source' }), h('pre', {}, h('code', { textContent: item.src }))),
      out,
    );
  }

  const summary = $('rt-summary');
  summary.textContent =
    passed === total
      ? `${passed} of ${total} checks passed across ${ATTACKS.length} attacks.`
      : `${passed} of ${total} checks passed. Failures are listed in red below.`;
  summary.className = `verdict ${passed === total ? 'ok' : 'bad'}`;
});
