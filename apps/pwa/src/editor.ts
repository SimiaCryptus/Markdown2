import type { Diagnostic } from '@markdown2/core';
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/editor/editor.all.js';
import 'monaco-editor/esm/vs/basic-languages/monaco.contribution.js';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { LANGUAGE_ID, registerMarkdown2Language } from './language.js';
import {
  decodeRawSelection,
  decodeResourceBlock,
  encodeResourceBlock,
  encodeSelection,
  findResourceAtLine,
  isEncodedResource,
  toggleCompatWrapper,
  type EncryptKey,
  type ResourceSpan,
} from './transforms.js';
import type { KeyGrant } from './decoders.js';

window.MonacoEnvironment = {
  getWorker() {
    return new EditorWorker();
  },
};

export interface CursorInfo {
  /** 0-based line number. */
  line: number;
  /** 0-based column number. */
  col: number;
  /** Number of selected characters. */
  selected: number;
}

export interface EncryptPromptRequest {
  compress: boolean;
  inResource: boolean;
  defaultType: string;
  defaultTitle: string;
  defaultWrapped: boolean;
}

export interface EncryptPromptResult {
  key: EncryptKey;
  type: string;
  title: string;
  wrapped: boolean;
}

export interface WrapPromptResult {
  type: string;
  title: string;
  token: string;
  wrapped: boolean;
}

export interface SourceEditorOptions {
  container: HTMLElement;
  dark: boolean;
  onChange: () => void;
  onCursorChange: (info: CursorInfo) => void;
  onLineClick: (line0: number) => void;
  onStatus: (message: string, sticky?: boolean) => void;
  askEncrypt: (req: EncryptPromptRequest) => Promise<EncryptPromptResult | null>;
  askWrap: () => Promise<WrapPromptResult | null>;
  askDecryptKey: (description: string) => Promise<KeyGrant | null>;
}

export interface SourceEditor {
  getValue(): string;
  setValue(text: string): void;
  focus(): void;
  setTheme(dark: boolean): void;
  setDiagnostics(diags: readonly Diagnostic[]): void;
  jumpToLine(line0: number, selectLine?: boolean): void;
  layout(): void;
  containsTarget(target: EventTarget | null): boolean;
  getCursorInfo(): CursorInfo;
}

export function createSourceEditor(opts: SourceEditorOptions): SourceEditor {
  registerMarkdown2Language(monaco);

  const editor = monaco.editor.create(opts.container, {
    value: '',
    language: LANGUAGE_ID,
    theme: opts.dark ? 'm2-dark' : 'm2-light',
    automaticLayout: true,
    folding: true,
    showFoldingControls: 'mouseover',
    foldingHighlight: true,
    foldingStrategy: 'auto',
    lineNumbers: 'on',
    renderLineHighlight: 'all',
    minimap: { enabled: false },
    wordWrap: 'on',
    wrappingIndent: 'same',
    fontSize: 13.5,
    lineHeight: 22,
    fontFamily: "ui-monospace, 'SF Mono', 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, monospace",
    padding: { top: 16, bottom: 160 },
    smoothScrolling: true,
    scrollBeyondLastLine: false,
    contextmenu: true,
    tabSize: 2,
    bracketPairColorization: { enabled: true },
    unicodeHighlight: { ambiguousCharacters: false },
  });

  const ctxHasSelection = editor.createContextKey<boolean>('m2HasSelection', false);
  const ctxInResource = editor.createContextKey<boolean>('m2InResource', false);
  const ctxInEncodedResource = editor.createContextKey<boolean>('m2InEncodedResource', false);

  let suppressChange = false;

  const getModel = (): monaco.editor.ITextModel => {
    const m = editor.getModel();
    if (!m) throw new Error('Monaco model missing');
    return m;
  };

  const getCursorInfo = (): CursorInfo => {
    const pos = editor.getPosition();
    const sel = editor.getSelection();
    const model = getModel();
    const selected = sel && !sel.isEmpty() ? model.getValueInRange(sel).length : 0;
    return {
      line: (pos?.lineNumber ?? 1) - 1,
      col: (pos?.column ?? 1) - 1,
      selected,
    };
  };

  const updateContextKeys = (): void => {
    const sel = editor.getSelection();
    const hasSel = sel !== null && !sel.isEmpty();
    const pos = editor.getPosition();
    const span = pos ? findResourceAtLine(getModel().getValue(), pos.lineNumber - 1) : null;
    ctxHasSelection.set(hasSel);
    ctxInResource.set(span !== null);
    ctxInEncodedResource.set(span !== null && isEncodedResource(span.node));
  };

  editor.onDidChangeModelContent(() => {
    updateContextKeys();
    if (!suppressChange) opts.onChange();
  });

  editor.onDidChangeCursorSelection(() => {
    updateContextKeys();
    opts.onCursorChange(getCursorInfo());
  });

  editor.onMouseUp((e) => {
    if (e.event.leftButton && e.target.position) {
      const sel = editor.getSelection();
      if (!sel || sel.isEmpty()) {
        opts.onLineClick(e.target.position.lineNumber - 1);
      }
    }
  });

  /** Replace a 0-based inclusive line span with `text` as an undoable edit. */
  const replaceLines = (startLine0: number, endLine0: number, text: string): void => {
    const model = getModel();
    const startLine = startLine0 + 1;
    const endLine = endLine0 + 1;
    const range = new monaco.Range(startLine, 1, endLine, model.getLineMaxColumn(endLine));
    editor.pushUndoStop();
    editor.executeEdits('markdown2-transform', [{ range, text, forceMoveMarkers: true }]);
    editor.pushUndoStop();
  };

  /** Replace the current selection with `text` as an undoable edit. */
  const replaceSelection = (sel: monaco.Selection, text: string): void => {
    editor.pushUndoStop();
    editor.executeEdits('markdown2-transform', [{ range: sel, text, forceMoveMarkers: true }]);
    editor.pushUndoStop();
  };

  /** Current resource block at cursor (only when selection is empty or inside the same block). */
  const currentResource = (): ResourceSpan | null => {
    const pos = editor.getPosition();
    if (!pos) return null;
    return findResourceAtLine(getModel().getValue(), pos.lineNumber - 1);
  };

  const runSafe = (fn: () => Promise<void>): void => {
    void fn().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      opts.onStatus(`Transform failed: ${msg}`, true);
    });
  };

  // ---------------------------------------------------------------- context menu actions
  const runEncode = async (kind: 'base64' | 'gzip' | 'age', compress = false): Promise<void> => {
    const model = getModel();
    const sel = editor.getSelection();
    const hasSel = sel !== null && !sel.isEmpty();
    const span = hasSel ? null : currentResource();

    if (!hasSel && !span) {
      opts.onStatus('Select text or place the cursor inside a resource block first');
      return;
    }

    if (kind === 'age') {
      const req: EncryptPromptRequest = {
        compress,
        inResource: span !== null,
        defaultType: span?.node.resource.type ?? 'text/markdown',
        defaultTitle: span?.node.resource.attributes.get('title') ?? '',
        defaultWrapped: span ? span.wrapped : true,
      };
      const answer = await opts.askEncrypt(req);
      if (!answer) return;

      if (span) {
        const out = await encodeResourceBlock(span.node, span.wrapped, {
          kind: 'age',
          key: answer.key,
          compress,
          title: answer.title,
          wrapped: answer.wrapped,
        });
        replaceLines(span.outerStartLine, span.outerEndLine, out);
      } else if (sel) {
        const out = await encodeSelection(model.getValueInRange(sel), {
          kind: 'age',
          key: answer.key,
          compress,
          type: answer.type,
          title: answer.title,
          wrapped: answer.wrapped,
        });
        replaceSelection(sel, out);
      }
      opts.onStatus(compress ? 'Compressed and encrypted with age' : 'Encrypted with age');
      return;
    }

    if (span) {
      const out = await encodeResourceBlock(span.node, span.wrapped, { kind });
      replaceLines(span.outerStartLine, span.outerEndLine, out);
    } else if (sel) {
      const out = await encodeSelection(model.getValueInRange(sel), { kind });
      replaceSelection(sel, out);
    }
    opts.onStatus(kind === 'gzip' ? 'Compressed with gzip + base64' : 'Encoded as base64');
  };

  const runDecodeBlock = async (mode: 'in-place' | 'unwrap'): Promise<void> => {
    const span = currentResource();
    if (!span) {
      opts.onStatus('Place the cursor inside a resource block to decode it');
      return;
    }
    const label = span.node.resource.attributes.get('title') ?? span.node.token ?? 'resource';
    const result = await decodeResourceBlock(span.node, span.wrapped, {
      mode,
      getKey: (layer, total) =>
        opts.askDecryptKey(`${label}: layer ${layer} of ${total} (age)`),
    });
    if (result.cancelled) return;
    replaceLines(span.outerStartLine, span.outerEndLine, result.text);
    opts.onStatus(mode === 'unwrap' ? 'Decoded and unwrapped to plain text' : 'Decoded resource payload in place');
  };

  editor.addAction({
    id: 'm2.encrypt',
    label: 'Markdown2: Encrypt (age)…',
    precondition: 'm2HasSelection || m2InResource',
    contextMenuGroupId: 'm2_1_encode',
    contextMenuOrder: 1,
    run: () => runSafe(() => runEncode('age', false)),
  });

  editor.addAction({
    id: 'm2.compressEncrypt',
    label: 'Markdown2: Compress & Encrypt (gzip + age)…',
    precondition: 'm2HasSelection || m2InResource',
    contextMenuGroupId: 'm2_1_encode',
    contextMenuOrder: 2,
    run: () => runSafe(() => runEncode('age', true)),
  });

  editor.addAction({
    id: 'm2.compress',
    label: 'Markdown2: Compress (gzip)',
    precondition: 'm2HasSelection || m2InResource',
    contextMenuGroupId: 'm2_1_encode',
    contextMenuOrder: 3,
    run: () => runSafe(() => runEncode('gzip')),
  });

  editor.addAction({
    id: 'm2.base64Encode',
    label: 'Markdown2: Encode Base64',
    precondition: 'm2HasSelection || m2InResource',
    contextMenuGroupId: 'm2_1_encode',
    contextMenuOrder: 4,
    run: () => runSafe(() => runEncode('base64')),
  });

  editor.addAction({
    id: 'm2.wrapResource',
    label: 'Markdown2: Wrap as Resource Block…',
    precondition: 'm2HasSelection',
    contextMenuGroupId: 'm2_1_encode',
    contextMenuOrder: 5,
    run: () =>
      runSafe(async () => {
        const sel = editor.getSelection();
        if (!sel || sel.isEmpty()) return;
        const answer = await opts.askWrap();
        if (!answer) return;
        const out = await encodeSelection(getModel().getValueInRange(sel), {
          kind: 'wrap',
          type: answer.type,
          title: answer.title,
          token: answer.token,
          wrapped: answer.wrapped,
        });
        replaceSelection(sel, out);
        opts.onStatus('Wrapped selection as resource block');
      }),
  });

  editor.addAction({
    id: 'm2.decodeInPlace',
    label: 'Markdown2: Decrypt / Decompress in Place',
    precondition: 'm2InEncodedResource',
    contextMenuGroupId: 'm2_2_decode',
    contextMenuOrder: 1,
    run: () => runSafe(() => runDecodeBlock('in-place')),
  });

  editor.addAction({
    id: 'm2.decodeUnwrap',
    label: 'Markdown2: Decrypt / Unwrap to Plain Text',
    precondition: 'm2InResource',
    contextMenuGroupId: 'm2_2_decode',
    contextMenuOrder: 2,
    run: () => runSafe(() => runDecodeBlock('unwrap')),
  });

  editor.addAction({
    id: 'm2.decodeRawBase64',
    label: 'Markdown2: Decode Selected Base64',
    precondition: 'm2HasSelection && !m2InResource',
    contextMenuGroupId: 'm2_2_decode',
    contextMenuOrder: 3,
    run: () =>
      runSafe(async () => {
        const sel = editor.getSelection();
        if (!sel || sel.isEmpty()) return;
        const text = await decodeRawSelection(getModel().getValueInRange(sel), 'base64');
        replaceSelection(sel, text);
        opts.onStatus('Decoded base64 selection');
      }),
  });

  editor.addAction({
    id: 'm2.decodeRawGzip',
    label: 'Markdown2: Decompress Selected Base64+Gzip',
    precondition: 'm2HasSelection && !m2InResource',
    contextMenuGroupId: 'm2_2_decode',
    contextMenuOrder: 4,
    run: () =>
      runSafe(async () => {
        const sel = editor.getSelection();
        if (!sel || sel.isEmpty()) return;
        const text = await decodeRawSelection(getModel().getValueInRange(sel), 'gzip');
        replaceSelection(sel, text);
        opts.onStatus('Decompressed base64+gzip selection');
      }),
  });

  editor.addAction({
    id: 'm2.toggleWrapper',
    label: 'Markdown2: Toggle <!-- --> Compatibility Wrapper',
    precondition: 'm2InResource',
    contextMenuGroupId: 'm2_2_decode',
    contextMenuOrder: 5,
    run: () =>
      runSafe(() => {
        const span = currentResource();
        if (!span) return Promise.resolve();
        const edit = toggleCompatWrapper(getModel().getValue(), span);
        replaceLines(edit.startLine, edit.endLine, edit.text);
        opts.onStatus(span.wrapped ? 'Removed compatibility wrapper' : 'Added compatibility wrapper');
        return Promise.resolve();
      }),
  });

  return {
    getValue: () => getModel().getValue(),
    setValue: (text: string) => {
      suppressChange = true;
      try {
        getModel().setValue(text);
        editor.setScrollTop(0);
        editor.setPosition({ lineNumber: 1, column: 1 });
      } finally {
        suppressChange = false;
      }
      updateContextKeys();
      opts.onCursorChange(getCursorInfo());
    },
    focus: () => editor.focus(),
    setTheme: (dark: boolean) => {
      monaco.editor.setTheme(dark ? 'm2-dark' : 'm2-light');
    },
    setDiagnostics: (diags: readonly Diagnostic[]) => {
      const model = getModel();
      const lineCount = model.getLineCount();
      const markers: monaco.editor.IMarkerData[] = [];
      for (const d of diags) {
        if (d.nodeId !== undefined && d.nodeId.includes('/')) continue;
        const line = Math.max(1, Math.min(d.line + 1, lineCount));
        markers.push({
          severity: monaco.MarkerSeverity.Error,
          startLineNumber: line,
          startColumn: 1,
          endLineNumber: line,
          endColumn: model.getLineMaxColumn(line),
          code: d.code,
          message: `${d.code}: ${d.message}`,
          source: 'markdown2',
        });
      }
      monaco.editor.setModelMarkers(model, 'markdown2', markers);
    },
    jumpToLine: (line0: number, selectLine = false) => {
      const model = getModel();
      const line = Math.max(1, Math.min(line0 + 1, model.getLineCount()));
      editor.focus();
      if (selectLine) {
        editor.setSelection(new monaco.Range(line, 1, line, model.getLineMaxColumn(line)));
      } else {
        editor.setPosition({ lineNumber: line, column: 1 });
      }
      editor.revealLineInCenter(line);
      opts.onCursorChange(getCursorInfo());
    },
    layout: () => editor.layout(),
    containsTarget: (target: EventTarget | null) =>
      target instanceof Node && opts.container.contains(target),
    getCursorInfo,
  };
}
