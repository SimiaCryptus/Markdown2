/**
 * Host side of the frame protocol. Frames are opaque-origin sandboxes:
 *
 *   frame → app   { type: 'm2-ready' }
 *   app → frame   { type: 'm2-render', source, lang, dark }   (once per frame)
 *   frame → app   { type: 'm2-size', height } | { type: 'm2-error', message }
 *
 * Messages are matched to frames by `event.source`, never by origin (it is "null").
 */
const MAX_HEIGHT = 4000;

function decodePayload(b64: string): string {
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function frameFor(source: MessageEventSource | null): HTMLIFrameElement | null {
  if (source === null) return null;
  for (const f of document.querySelectorAll<HTMLIFrameElement>('iframe.m2-frame')) {
    if (f.contentWindow === source) return f;
  }
  return null;
}

export function installFrameHost(isDark: () => boolean): void {
  window.addEventListener('message', (e) => {
    const frame = frameFor(e.source);
    if (!frame || typeof e.data !== 'object' || e.data === null) return;
    const data = e.data as Record<string, unknown>;
    const host = frame.closest<HTMLElement>('.m2-frame-host');
    if (data.type === 'm2-ready') {
      if (frame.dataset.m2Sent !== undefined) return; // the source is sent once
      frame.dataset.m2Sent = '';
      frame.contentWindow?.postMessage(
        { type: 'm2-render', source: decodePayload(frame.dataset.m2Payload ?? ''), lang: frame.dataset.m2Lang, dark: isDark() },
        '*',
      );
    } else if (data.type === 'm2-size' && typeof data.height === 'number' && Number.isFinite(data.height)) {
      frame.style.height = `${Math.max(16, Math.min(MAX_HEIGHT, Math.ceil(data.height)))}px`;
      host?.setAttribute('data-m2-ready', '');
    } else if (data.type === 'm2-error') {
      const msg = typeof data.message === 'string' ? data.message.slice(0, 300) : 'could not render';
      host?.setAttribute('data-m2-error', msg);
    }
  });
}