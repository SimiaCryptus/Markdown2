// Minimal typings for APIs that lib.dom does not include yet.
interface FilePickerAcceptType {
  description?: string;
  accept: Record<string, string[]>;
}
interface OpenFilePickerOptions {
  types?: FilePickerAcceptType[];
  multiple?: boolean;
}
interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerAcceptType[];
}
interface LaunchParams {
  readonly files: readonly FileSystemHandle[];
}
interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}
interface Window {
  showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
  launchQueue?: LaunchQueue;
}

// Libraries without bundled typings: only the part this app uses.
declare module 'plotly.js-dist-min' {
  interface PlotlyStatic {
    newPlot(root: HTMLElement, data: unknown[], layout?: object, config?: object): Promise<unknown>;
    addFrames(root: HTMLElement, frames: unknown[]): Promise<unknown>;
  }
  const Plotly: PlotlyStatic;
  export default Plotly;
}
declare module 'vega-interpreter';