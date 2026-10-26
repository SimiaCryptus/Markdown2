import { typeEssence } from './runtime.js';
import type { ResourceNode } from './types.js';

/**
 * Safe saving (§6.2). Both `type` and `filename` are untrusted author input,
 * so neither may yield an extension that executes or renders actively.
 *
 * An allowlist of passive extensions is used rather than a denylist of
 * dangerous ones: anything unknown falls back to `.bin` (spec-issues #14).
 */
const PASSIVE_EXTENSIONS: ReadonlySet<string> = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'bmp',
  'txt',
  'md',
  'markdown',
  'json',
  'yaml',
  'yml',
  'csv',
  'tsv',
  'pdf',
  'gz',
  'zip',
  'tar',
  'mp3',
  'mp4',
  'wav',
  'ogg',
  'webm',
  'flac',
]);

/** Declared type → passive extension, used only when no filename is given. */
const PASSIVE_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/json': 'json',
  'application/yaml': 'yaml',
  'application/pdf': 'pdf',
  'application/gzip': 'gz',
  'application/zip': 'zip',
};

// eslint-disable-next-line no-control-regex -- stripping control and bidi characters is the point
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const RESERVED_WINDOWS = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

export interface SaveName {
  /** Safe default name. Never carries an active or unknown extension. */
  name: string;
  /** Name requested by the document; offer it only behind explicit user confirmation. */
  requested?: string;
}

function cleanName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? '';
  return base
    .replace(UNSAFE_CHARS, '')
    .replace(/[<>:"|?*]/g, '_')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 200);
}

/**
 * Compute a save name for a resource.
 *
 * - `raw` saves the payload as written, which is always text in a Markdown2 file.
 * - `decoded` saves the fully decoded bytes.
 */
export function safeSaveName(node: ResourceNode, form: 'raw' | 'decoded'): SaveName {
  const fallbackStem = `resource-${node.id.replace(/\//g, '-')}`;
  const requestedRaw = node.resource.attributes.get('filename');
  const cleaned = requestedRaw === undefined ? '' : cleanName(requestedRaw);
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 ? cleaned.slice(dot + 1).toLowerCase() : '';
  // Inner dots are replaced so "invoice.pdf.exe" cannot masquerade as a PDF.
  let stem = (dot > 0 ? cleaned.slice(0, dot) : cleaned).replace(/\./g, '_');
  if (stem === '') stem = fallbackStem;
  if (RESERVED_WINDOWS.test(stem)) stem = `_${stem}`;

  if (form === 'raw') return { name: `${stem}.txt` };
  if (ext !== '' && PASSIVE_EXTENSIONS.has(ext)) return { name: `${stem}.${ext}` };

  const essence = typeEssence(node.resource.type) ?? '';
  const typeExt = Object.hasOwn(PASSIVE_TYPE_EXTENSIONS, essence) ? PASSIVE_TYPE_EXTENSIONS[essence] : undefined;
  const name = `${stem}.${typeExt ?? 'bin'}`;
  return ext !== '' ? { name, requested: cleaned } : { name };
}
