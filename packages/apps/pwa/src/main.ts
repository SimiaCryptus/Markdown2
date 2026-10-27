diagList.append(li);
}
renderGutter(true);
}
// ---------------------------------------------------------------- source/page sync (split view)
/** Clicks on these never move the editor: they have their own job. */
const INTERACTIVE =
'a, button, input, select, textarea, summary, label, iframe, m2-actions, m2-style-control, m2-grid-tools, thead th, .m2-col-resize';
/** Source and page are both visible. */
function isSplit(): boolean {
return document.body.dataset.view === 'split';
}
/** Scroll the page to the visible block that starts closest before `line`. */
function seekPreview(line: number): void {
let best: HTMLElement | null = null;
let bestLine = -1;
for (const node of preview.querySelectorAll<HTMLElement>('[data-m2-line]')) {
const l = Number(node.dataset.m2Line);
if (!Number.isFinite(l) || l > line || l < bestLine) continue;
if (node.getClientRects().length === 0) continue; // hidden, e.g. stylesheets
best = node; // ties: the later (deeper) element wins
bestLine = l;
}
if (!best) return;
best.scrollIntoView({ block: 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
glow(best);
}
/** Put the caret at the start of `line` in the source, without selecting it. */
function seekEditor(line: number): void {
const lines = editor.value.split('\n');
const target = Math.max(0, Math.min(line, lines.length - 1));
let start = 0;
for (let k = 0; k < target; k++) start += (lines[k]?.length ?? 0) + 1;
editor.focus({ preventScroll: true });
editor.setSelectionRange(start, start);
const lh = Number.parseFloat(getComputedStyle(editor).lineHeight) || 22;
editor.scrollTop = Math.max(0, target * lh - editor.clientHeight / 3);
syncGutter();
updateCursor();
}
// ---------------------------------------------------------------- documents
type DocSource = { kind: 'file' } | { kind: 'share' } | { kind: 'draft' } | { kind: 'url'; url: URL };