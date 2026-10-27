/** Frame side of the protocol (see ../frames.ts). Runs in an opaque-origin sandbox. */
export interface RenderRequest {
  source: string;
  lang: string | undefined;
  dark: boolean;
}

export function post(message: Record<string, unknown>): void {
  window.parent.postMessage(message, '*');
}

export function serve(render: (r: RenderRequest, root: HTMLElement) => Promise<void>): void {
  const root = document.getElementById('root');
  if (!root) return;
  let done = false;
  window.addEventListener('message', (e) => {
    if (done || e.source !== window.parent) return;
    const d: unknown = e.data;
    if (typeof d !== 'object' || d === null) return;
    const r = d as Record<string, unknown>;
    if (r.type !== 'm2-render' || typeof r.source !== 'string') return;
    done = true;
    const dark = r.dark === true;
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    render({ source: r.source, lang: typeof r.lang === 'string' ? r.lang : undefined, dark }, root).then(
      () => {
        const report = (): void => {
          post({ type: 'm2-size', height: Math.ceil(root.getBoundingClientRect().height) });
        };
        new ResizeObserver(report).observe(root);
        report();
      },
      (err: unknown) => {
        post({ type: 'm2-error', message: err instanceof Error ? err.message : String(err) });
      },
    );
  });
  post({ type: 'm2-ready' });
}