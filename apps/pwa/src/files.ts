export interface OpenedDocument {
  name: string;
  text: string;
  handle?: FileSystemFileHandle;
}

const TYPES: FilePickerAcceptType[] = [{ description: 'Markdown2', accept: { 'text/markdown': ['.md', '.markdown'] } }];

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

export async function fromHandle(handle: FileSystemFileHandle): Promise<OpenedDocument> {
  const file = await handle.getFile();
  return { name: file.name, text: await file.text(), handle };
}

export async function fromFile(file: File): Promise<OpenedDocument> {
  return { name: file.name, text: await file.text() };
}

/** File System Access API when available, else a plain file input. */
export async function openDocument(input: HTMLInputElement): Promise<OpenedDocument | null> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: TYPES });
      return handle ? await fromHandle(handle) : null;
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
  }
  return new Promise((resolve) => {
    input.value = '';
    input.onchange = () => {
      const f = input.files?.[0];
      if (f) void fromFile(f).then(resolve);
      else resolve(null);
    };
    input.oncancel = () => {
      resolve(null);
    };
    input.click();
  });
}

/** Save the document source. Returns the handle that was written, if any. */
export async function saveDocument(
  text: string,
  name: string,
  handle?: FileSystemFileHandle,
): Promise<FileSystemFileHandle | undefined> {
  let h = handle;
  if (!h && window.showSaveFilePicker) {
    try {
      h = await window.showSaveFilePicker({ suggestedName: name, types: TYPES });
    } catch (e) {
      if (isAbort(e)) return undefined;
      throw e;
    }
  }
  if (h) {
    const w = await h.createWritable();
    await w.write(text);
    await w.close();
    return h;
  }
  downloadBytes(new TextEncoder().encode(text), name);
  return undefined;
}

/**
 * Download bytes. Always `application/octet-stream`, so the browser never
 * renders a resource based on its untrusted declared type.
 */
export function downloadBytes(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}