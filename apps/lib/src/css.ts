import { UA_STYLESHEET } from '@markdown2/core';

/**
 * A readable default look for the styling tree, in the user-agent layer so
 * that page and document styles always win. Colours are CSS variables
 * (`--md2-*`); set `data-md2-theme="dark"` on any ancestor for dark.
 */
export const themeCss = `
md2-document[data-m2-root] {
  --md2-bg: #fffdf8; --md2-ink: #25222c; --md2-muted: #6c6575; --md2-rule: #e0d7c7;
  --md2-card: #faf6ee; --md2-code: #f3eee4; --md2-accent: #b0802a; --md2-link: #0f6b5f;
  --md2-bad: #b4441c; --md2-warn: #946500;
  --md2-font: Georgia, 'Iowan Old Style', 'Palatino Linotype', serif;
  --md2-ui: system-ui, -apple-system, 'Segoe UI', sans-serif;
  --md2-mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  color: var(--md2-ink);
  background: var(--md2-bg);
  font: 1rem/1.65 var(--md2-font);
  overflow-wrap: break-word;
}
:where([data-md2-theme='dark']) md2-document[data-m2-root] {
  --md2-bg: #1f1d26; --md2-ink: #e6e0d3; --md2-muted: #9c94a5; --md2-rule: #3a3644;
  --md2-card: #26232d; --md2-code: #2c2934; --md2-accent: #d9a84e; --md2-link: #57c0ac;
  --md2-bad: #ef7c55; --md2-warn: #e2b24c;
}
@media (prefers-color-scheme: dark) {
  :where(.md2-surface:not([data-md2-theme])) md2-document[data-m2-root] {
    --md2-bg: #1f1d26; --md2-ink: #e6e0d3; --md2-muted: #9c94a5; --md2-rule: #3a3644;
    --md2-card: #26232d; --md2-code: #2c2934; --md2-accent: #d9a84e; --md2-link: #57c0ac;
    --md2-bad: #ef7c55; --md2-warn: #e2b24c;
  }
}
.md2-surface md2-document[data-m2-root] { padding: 1.25rem 1.5rem; border-radius: 12px; }
md2-document :is(h1, h2, h3, h4, h5, h6) { line-height: 1.25; margin: 1.4em 0 0.5em; }
md2-document h1 { font-size: 1.9em; margin-top: 0.3em; }
md2-document p { margin: 0 0 1em; }
md2-document a { color: var(--md2-link); }
md2-document code { font-family: var(--md2-mono); font-size: 0.88em; }
md2-document :not(pre) > code { background: var(--md2-code); padding: 0.1em 0.35em; border-radius: 4px; }
md2-document pre { background: var(--md2-code); padding: 0.75em 1em; border-radius: 8px; overflow: auto; font: 0.85rem/1.55 var(--md2-mono); }
md2-document blockquote { margin: 1em 0; padding: 0.1em 1em; border-left: 3px solid var(--md2-accent); color: var(--md2-muted); }
md2-document table { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; margin: 0 0 1em; font: 0.92em/1.45 var(--md2-ui); }
md2-document :is(th, td) { border: 1px solid var(--md2-rule); padding: 0.35em 0.75em; vertical-align: top; }
md2-document th { background: var(--md2-card); }
md2-document th:not([align]) { text-align: left; }
md2-document hr { border: 0; border-top: 1px solid var(--md2-rule); margin: 2em 0; }
md2-document del { color: var(--md2-muted); }
md2-section[level='1'] + md2-section[level='1'] { margin-top: 2em; }
md2-resource { margin: 1.2em 0; padding: 0.8em 1em; border: 1px solid var(--md2-rule); border-radius: 10px; background: var(--md2-card); }
md2-resource[title]::before, md2-resource[essence]::before {
  display: block; margin-bottom: 0.6rem; font: 600 0.66rem/1.2 var(--md2-ui); letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--md2-muted);
}
md2-resource[essence]::before { content: attr(essence); }
md2-resource[title]::before { content: attr(title) '  ·  ' attr(essence); }
md2-resource:is(:not([state='decoded']), [error])::before { content: none; }
md2-resource[state='locked'] { border-style: dashed; border-color: var(--md2-accent); }
md2-resource[state='failed'] { border-color: var(--md2-bad); }
md2-resource > md2-document { background: transparent; }
md2-fallback { border-radius: 8px; background: var(--md2-bg); color: var(--md2-muted); font: 0.85rem/1.5 var(--md2-ui); }
md2-label { font-style: italic; color: var(--md2-ink); }
md2-detail { margin-top: 0.2rem; font: 0.75rem/1.5 var(--md2-mono); }
.m2-hint { color: var(--md2-warn); }
.m2-text, .m2-json, .m2-yaml { margin: 0; }
.m2-image, .m2-wavedrom { display: block; max-width: 100%; height: auto; margin: 0 auto; }
.m2-wave-block { overflow-x: auto; background: #fff; border-radius: 6px; padding: 0.25rem; }
.m2-attachment { display: inline-flex; gap: 0.5em; padding: 0.45em 0.9em; border-radius: 99px; background: var(--md2-code); font: 0.85rem var(--md2-ui); }
.m2-embed-frame { display: block; width: 100%; aspect-ratio: 16 / 9; border: 0; border-radius: 8px; background: var(--md2-bg); }
.m2-embed-pending { display: grid; gap: 0.3em; color: var(--md2-muted); font: 0.85rem/1.5 var(--md2-ui); overflow-wrap: anywhere; }
.m2-embed-host { font-weight: 600; color: var(--md2-ink); }
.m2-load-slot:empty { display: none; }
.m2-prose-image::before { content: '🖼 '; }
.m2-grid-note { font-style: italic; color: var(--md2-muted); }
`;

/** UA baseline (style.md Appendix A) plus the default look, layered so pages and documents can override it. */
export const defaultCss = `@layer m2-ua, m2-user, m2-author;
@layer m2-ua {
${UA_STYLESHEET}
${themeCss}
}
`;