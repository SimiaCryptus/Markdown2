import { serve } from './frame.js';

/** The small part of the Google Charts API this frame uses. */
interface ChartWrapper {
  draw(container: HTMLElement): void;
}
interface Google {
  charts: { load(version: string, settings: { packages: string[] }): Promise<void> };
  visualization: {
    arrayToDataTable(data: unknown[][]): unknown;
    ChartWrapper: new (spec: Record<string, unknown>) => ChartWrapper;
    events: { addListener(target: unknown, event: string, handler: (e?: { message?: string }) => void): void };
  };
}

/** Google Charts must be loaded from Google; this frame's opaque origin keeps it away from the app. */
const LOADER = 'https://www.gstatic.com/charts/loader.js';

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => {
      resolve();
    };
    s.onerror = () => {
      reject(new Error('Google Charts could not be loaded (offline or blocked)'));
    };
    document.head.append(s);
  });
}

function themed(dark: boolean): Record<string, unknown> {
  const text = { color: dark ? '#e6e0d3' : '#25222c' };
  return {
    backgroundColor: 'transparent',
    titleTextStyle: text,
    legend: { textStyle: text },
    hAxis: { textStyle: text, titleTextStyle: text },
    vAxis: { textStyle: text, titleTextStyle: text },
  };
}

serve(async ({ source, dark }, root) => {
  const spec = JSON.parse(source) as { chartType: string; data: unknown[][]; options?: Record<string, unknown> };
  await loadScript(LOADER);
  const google = (window as unknown as { google?: Google }).google;
  if (!google) throw new Error('Google Charts did not load');
  await google.charts.load('current', { packages: ['corechart'] });
  const options: Record<string, unknown> = { ...themed(dark), ...spec.options };
  const height = typeof options.height === 'number' ? options.height : 320;
  root.style.height = `${height}px`;
  await new Promise<void>((resolve, reject) => {
    const chart = new google.visualization.ChartWrapper({
      chartType: spec.chartType,
      dataTable: google.visualization.arrayToDataTable(spec.data),
      options: { ...options, height },
    });
    google.visualization.events.addListener(chart, 'ready', () => {
      resolve();
    });
    google.visualization.events.addListener(chart, 'error', (e) => {
      reject(new Error(e?.message ?? 'the chart could not be drawn'));
    });
    chart.draw(root);
  });
});