import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/editor/editor.all.js';
import 'monaco-editor/esm/vs/basic-languages/monaco.contribution.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker&inline';
import { serve } from './frame.js';

// Opaque origins cannot start same-site workers; an inline (blob) worker is allowed.
window.MonacoEnvironment = { getWorker: () => new EditorWorker() };

serve(({ source, lang, dark }, root) => {
  monaco.editor.setTheme(dark ? 'vs-dark' : 'vs');
  const editor = monaco.editor.create(root, {
    value: source,
    language: lang ?? 'plaintext',
    readOnly: true,
    domReadOnly: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'none',
    contextmenu: false,
    folding: true,
    lineNumbers: 'on',
    fontSize: 13,
    padding: { top: 10, bottom: 10 },
    scrollbar: { alwaysConsumeMouseWheel: false, vertical: 'hidden' },
    automaticLayout: true,
  });
  const fit = (): void => {
    root.style.height = `${Math.min(editor.getContentHeight(), 4000)}px`;
    editor.layout();
  };
  editor.onDidContentSizeChange(fit);
  fit();
  return Promise.resolve();
});