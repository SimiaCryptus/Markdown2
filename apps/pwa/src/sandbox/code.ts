import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/editor/editor.all.js';
import 'monaco-editor/esm/vs/basic-languages/monaco.contribution.js';
import { serve } from './frame.js';

/**
  * Opaque-origin frames cannot start Monaco's editor worker (browsers refuse
  * the blob URL). A read-only viewer does not need it: highlighting, folding
  * and bracket matching run on the main thread. The features that do use the
  * worker are switched off below, and Monaco gets a worker that does nothing,
  * so it never tries, retries and logs errors.
  */
class NoWorker extends EventTarget {
   onmessage: ((e: MessageEvent) => void) | null = null;
   onmessageerror: ((e: MessageEvent) => void) | null = null;
   onerror: ((e: ErrorEvent) => void) | null = null;
   postMessage(): void {
     // Intentionally inert.
   }
   terminate(): void {
     // Nothing to stop.
   }
}
window.MonacoEnvironment = { getWorker: () => new NoWorker() as unknown as Worker };

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
     // These features need the editor worker, which this frame does not run.
     links: false,
     colorDecorators: false,
     unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false, nonBasicASCII: false },
     occurrencesHighlight: 'off',
     quickSuggestions: false,
     suggestOnTriggerCharacters: false,
     wordBasedSuggestions: 'off',
  });
  const fit = (): void => {
    root.style.height = `${Math.min(editor.getContentHeight(), 4000)}px`;
    editor.layout();
  };
  editor.onDidContentSizeChange(fit);
  fit();
  return Promise.resolve();
});