interface Window {
showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
launchQueue?: LaunchQueue;
}
// WaveDrom and onml ship no typings; only the parts used in src/wavedrom.ts.
declare module 'wavedrom/lib/render-any.js' {
const renderAny: (index: number, source: unknown, skins: unknown) => unknown;
export default renderAny;
}
declare module 'wavedrom/skins/default.js' {
const skins: Record<string, unknown>;
export default skins;
}
declare module 'onml' {
const onml: { stringify(tree: unknown): string };
export default onml;
}