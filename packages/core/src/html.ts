const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape text for use in HTML element content and quoted attribute values. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

const SANDBOX_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:";

/**
 * Wrap handler output in an opaque-origin iframe (§11 handler isolation).
 * `allow-same-origin` is never granted, so the content cannot reach the
 * embedding document, its storage or its cookies.
 */
export function sandboxFrame(html: string, title: string): string {
  const doc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">${html}`;
  return `<iframe class="m2-sandbox" sandbox="allow-scripts" referrerpolicy="no-referrer" title="${escapeHtml(title)}" srcdoc="${escapeHtml(doc)}"></iframe>`;
}
