import { parse } from '@markdown2/core';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';

export const LANGUAGE_ID = 'markdown2';

export interface FoldingSpan {
  /** 1-based start line (Monaco convention). */
  start: number;
  /** 1-based end line (Monaco convention). */
  end: number;
  kind?: 'comment' | 'region' | undefined;
}

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]|$)/;

/**
 * Compute folding ranges for a Markdown2 document.
 * Covers frontmatter, Markdown2 resource blocks (including `<!-- ... -->` wrappers),
 * fenced code blocks, HTML comments, and Markdown headings.
 */
export function computeFoldingRanges(src: string): FoldingSpan[] {
  const lines = src.split(/\r?\n/);
  const totalLines = lines.length;
  if (totalLines < 2) return [];

  const ranges: FoldingSpan[] = [];
  const doc = parse(src);

  // Track lines occupied by frontmatter / resource blocks so prose scanners skip them.
  const opaqueLines = new Uint8Array(totalLines);

  for (const child of doc.children) {
    if (child.kind !== 'resource') continue;
    const wrapped = child.syntax === 'wrapped';
    const start0 = wrapped && child.startLine > 0 ? child.startLine - 1 : child.startLine;
    const hasCloseComment =
      wrapped && child.endLine + 1 < totalLines && lines[child.endLine + 1]?.trim() === '-->';
    const end0 = hasCloseComment ? child.endLine + 1 : child.endLine;

    for (let k = start0; k <= end0 && k < totalLines; k++) opaqueLines[k] = 1;
    if (end0 > start0) {
      ranges.push({
        start: start0 + 1,
        end: end0 + 1,
        kind: child.syntax === 'frontmatter' ? 'region' : 'region',
      });
    }
  }

  // Scan non-opaque lines for fenced code blocks, HTML comments, and headings.
  const headingStack: { level: number; start0: number }[] = [];
  let fence: { char: string; len: number; start0: number } | null = null;
  let commentStart0: number | null = null;

  const closeHeadings = (upToLevel: number, end0: number): void => {
    while (headingStack.length > 0) {
      const top = headingStack[headingStack.length - 1];
      if (!top || top.level < upToLevel) break;
      headingStack.pop();
      // Trim trailing blank lines from the folded section.
      let last = end0;
      while (last > top.start0 && (lines[last]?.trim() ?? '') === '') last--;
      if (last > top.start0) {
        ranges.push({ start: top.start0 + 1, end: last + 1 });
      }
    }
  };

  for (let i = 0; i < totalLines; i++) {
    if (opaqueLines[i] === 1) continue;
    const line = lines[i] ?? '';

    if (fence !== null) {
      const m = FENCE_CLOSE_RE.exec(line);
      if (m?.[1] && m[1].startsWith(fence.char) && m[1].length >= fence.len) {
        if (i > fence.start0) ranges.push({ start: fence.start0 + 1, end: i + 1, kind: 'region' });
        fence = null;
      }
      continue;
    }

    if (commentStart0 !== null) {
      if (line.includes('-->')) {
        if (i > commentStart0) ranges.push({ start: commentStart0 + 1, end: i + 1, kind: 'comment' });
        commentStart0 = null;
      }
      continue;
    }

    const fm = FENCE_OPEN_RE.exec(line);
    if (fm?.[1]) {
      fence = { char: fm[1].charAt(0), len: fm[1].length, start0: i };
      continue;
    }

    if (line.trimStart().startsWith('<!--') && !line.includes('-->', line.indexOf('<!--') + 4)) {
      commentStart0 = i;
      continue;
    }

    const hm = HEADING_RE.exec(line);
    if (hm?.[1]) {
      const level = hm[1].length;
      closeHeadings(level, i - 1);
      headingStack.push({ level, start0: i });
    }
  }

  closeHeadings(1, totalLines - 1);
  return ranges;
}

let registered = false;

/**
 * Register the `markdown2` language, Monarch syntax highlighter, folding provider,
 * and Ink & Vellum light/dark themes on the Monaco instance.
 */
export function registerMarkdown2Language(monaco: typeof Monaco): void {
  if (registered) return;
  registered = true;

  monaco.languages.register({
    id: LANGUAGE_ID,
    extensions: ['.md', '.markdown'],
    aliases: ['Markdown2', 'markdown2'],
  });

  monaco.languages.setLanguageConfiguration(LANGUAGE_ID, {
    comments: { blockComment: ['<!--', '-->'] },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string'] },
      { open: "'", close: "'", notIn: ['string'] },
      { open: '`', close: '`' },
    ],
    surroundingPairs: [
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '`', close: '`' },
      { open: '*', close: '*' },
      { open: '_', close: '_' },
      { open: '"', close: '"' },
    ],
  });

  monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, {
    defaultToken: '',
    tokenPostfix: '.m2',
    control: /[\\`*_[\]{}()#+\-.!]/,
    escapes: /\\(?:@control)/,

    tokenizer: {
      root: [
        // Frontmatter or horizontal rule
        [/^---[ \t]*$/, { token: 'meta.separator', next: '@frontmatter_or_hr' }],

        // Compatibility wrapper lines around resource blocks (kept subtle, doesn't swallow <<<TOKEN)
        [/^[ \t]*<!--[ \t]*$/, 'comment.wrapper'],
        [/^[ \t]*-->[ \t]*$/, 'comment.wrapper'],

        // Markdown2 resource block opener: <<<TOKEN attr="val"
        [
          /^(\s{0,3}(?:> ?)*)(<<<)([A-Za-z_][A-Za-z0-9_-]*)(?=[ \t]|$)/,
          ['white', 'keyword.resource', { token: 'type.identifier.resource', next: '@resource_head.$3' }],
        ],
        [
          /^(\s{0,3}(?:> ?)*)(<<<)([A-Za-z_][A-Za-z0-9_.-]*)(?=[ \t]|$)/,
          ['white', 'keyword.resource', { token: 'type.identifier.resource', next: '@resource_head_generic' }],
        ],

        // Markdown tables
        [/^\s*\|/, '@rematch', '@table_header'],

        // Headings
        [/^(\s{0,3})(#{1,6})([ \t]+.*$)/, ['white', 'keyword.heading', 'keyword.heading']],

        // Thematic breaks
        [/^\s*((\*[ ]?){3,}|(_[ ]?){3,}|(-[ ]?){3,})\s*$/, 'meta.separator'],

        // Blockquotes
        [/^\s*>+/, 'comment.quote'],

        // Lists
        [/^\s*([*+-]|\d{1,9}[.)])\s/, 'keyword.list'],

        // Fenced code blocks (backticks with language -> embedded highlighting)
        [/^\s*(`{3,})\s*([A-Za-z0-9_+#.-]+).*$/, { token: 'string.fence', next: '@codeblock_bt', nextEmbedded: '$2' }],
        [/^\s*(`{3,})\s*$/, { token: 'string.fence', next: '@codeblock_bt_plain' }],
        [/^\s*(~{3,})\s*([A-Za-z0-9_+#.-]+).*$/, { token: 'string.fence', next: '@codeblock_tilde', nextEmbedded: '$2' }],
        [/^\s*(~{3,})\s*$/, { token: 'string.fence', next: '@codeblock_tilde_plain' }],

        // Inline markdown
        { include: '@linecontent' },
      ],

      // If the line after `---` looks like YAML (`key: value`), stay in frontmatter until `---` or `...`
      frontmatter_or_hr: [
        [/^(?:---|\.\.\.)[ \t]*$/, { token: 'meta.separator', next: '@pop' }],
        [/^([A-Za-z0-9_.-]+)(\s*)(:)(.*)$/, ['attribute.name', 'white', 'delimiter', 'string']],
        [/^\s*#.*$/, 'comment'],
        [/^\s*-\s+.*$/, 'string'],
        [/^.*$/, { token: '@rematch', next: '@pop' }],
      ],

      // Attributes on the `<<<TOKEN ...` opener line
      resource_head: [
        [/[ \t]+/, 'white'],
        [/([A-Za-z][A-Za-z0-9_-]*)(=)("[^"]*")/, ['attribute.name', 'delimiter', 'string.attr']],
        [/([A-Za-z][A-Za-z0-9_-]*)(=)('[^']*')/, ['attribute.name', 'delimiter', 'string.attr']],
        [/[^ \t]+/, 'invalid'],
        [/$/, '', '@resource_body.$S2'],
      ],

      resource_body: [
        [/^(\s{0,3}(?:> ?)*)($S2)([ \t]*)$/, ['white', 'type.identifier.resource', { token: 'white', next: '@popall' }]],
        [/.*$/, 'variable.payload'],
      ],

      resource_head_generic: [
        [/[ \t]+/, 'white'],
        [/([A-Za-z][A-Za-z0-9_-]*)(=)("[^"]*")/, ['attribute.name', 'delimiter', 'string.attr']],
        [/([A-Za-z][A-Za-z0-9_-]*)(=)('[^']*')/, ['attribute.name', 'delimiter', 'string.attr']],
        [/[^ \t]+/, 'invalid'],
        [/$/, '', '@pop'],
      ],

      table_header: [{ include: '@table_common' }, [/[^|]+/, 'keyword.table']],
      table_body: [{ include: '@table_common' }, { include: '@linecontent' }],
      table_common: [
        [/\s*[-:]+\s*/, { token: 'keyword.table', switchTo: '@table_body' }],
        [/^\s*\|/, 'keyword.table'],
        [/^\s*[^|]/, '@rematch', '@pop'],
        [/^\s*$/, '@rematch', '@pop'],
        [/\|/, 'keyword.table'],
      ],

      codeblock_bt: [
        [/^\s*`{3,}\s*$/, { token: 'string.fence', next: '@pop', nextEmbedded: '@pop' }],
        [/[^`]+/, 'variable.source'],
        [/`+/, 'variable.source'],
      ],
      codeblock_bt_plain: [
        [/^\s*`{3,}\s*$/, { token: 'string.fence', next: '@pop' }],
        [/.*$/, 'variable.source'],
      ],
      codeblock_tilde: [
        [/^\s*~{3,}\s*$/, { token: 'string.fence', next: '@pop', nextEmbedded: '@pop' }],
        [/[^~]+/, 'variable.source'],
        [/~+/, 'variable.source'],
      ],
      codeblock_tilde_plain: [
        [/^\s*~{3,}\s*$/, { token: 'string.fence', next: '@pop' }],
        [/.*$/, 'variable.source'],
      ],

      linecontent: [
        [/@escapes/, 'string.escape'],
        [/\*\*([^\\*]|@escapes|\*(?!\*))+\*\*/, 'strong'],
        [/__([^\\_]|@escapes|_(?!_))+__/, 'strong'],
        [/~~([^\\~]|@escapes|~(?!~))+~~/, 'comment.strike'],
        [/\*([^\\*]|@escapes)+\*/, 'emphasis'],
        [/\b_([^\\_]|@escapes)+_\b/, 'emphasis'],
        [/`([^\\`]|@escapes)+`/, 'variable.code'],
        [/(!?\[)((?:[^\]\\]|@escapes)*)(\]\([^)]+\))/, ['string.link', 'string.link.text', 'string.link']],
        [/<!--/, 'comment', '@comment'],
      ],

      comment: [
        [/[^<-]+/, 'comment'],
        [/-->/, 'comment', '@pop'],
        [/[<-]/, 'comment'],
      ],
    },
  });

  monaco.languages.registerFoldingRangeProvider(LANGUAGE_ID, {
    provideFoldingRanges(model) {
      return computeFoldingRanges(model.getValue()).map((r) => ({
        start: r.start,
        end: r.end,
        ...(r.kind === 'comment'
          ? { kind: monaco.languages.FoldingRangeKind.Comment }
          : r.kind === 'region'
            ? { kind: monaco.languages.FoldingRangeKind.Region }
            : {}),
      }));
    },
  });

  // Ink & Vellum light theme
  monaco.editor.defineTheme('m2-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'keyword.heading', foreground: '8a5d14', fontStyle: 'bold' },
      { token: 'keyword.resource', foreground: '0f6b5f', fontStyle: 'bold' },
      { token: 'type.identifier.resource', foreground: 'b4441c', fontStyle: 'bold' },
      { token: 'attribute.name', foreground: '0f6b5f' },
      { token: 'string.attr', foreground: '8a5d14' },
      { token: 'variable.payload', foreground: '5a5363' },
      { token: 'comment.wrapper', foreground: '9a92a3', fontStyle: 'italic' },
      { token: 'comment.quote', foreground: '706979', fontStyle: 'italic' },
      { token: 'comment.strike', foreground: '8e8698', fontStyle: 'strikethrough' },
      { token: 'keyword.list', foreground: 'b0802a', fontStyle: 'bold' },
      { token: 'keyword.table', foreground: 'b0802a' },
      { token: 'meta.separator', foreground: 'b0802a' },
      { token: 'strong', fontStyle: 'bold' },
      { token: 'emphasis', fontStyle: 'italic' },
      { token: 'variable.code', foreground: 'b4441c' },
      { token: 'string.fence', foreground: '0f6b5f' },
      { token: 'string.link', foreground: '0f6b5f' },
      { token: 'string.link.text', foreground: '2a2733', fontStyle: 'underline' },
    ],
    colors: {
      'editor.background': '#fbf8f2',
      'editor.foreground': '#2a2733',
      'editorLineNumber.foreground': '#9a92a3',
      'editorLineNumber.activeForeground': '#2a2733',
      'editorGutter.background': '#f3eee4',
      'editor.lineHighlightBackground': '#f3eee480',
      'editor.selectionBackground': '#f3e4c3',
      'editorCursor.foreground': '#b0802a',
      'editorIndentGuide.background1': '#e0d7c7',
      'editorWidget.background': '#fbf8f2',
      'editorWidget.border': '#e0d7c7',
      'menu.background': '#fbf8f2',
      'menu.foreground': '#2a2733',
      'menu.selectionBackground': '#f3e4c3',
      'menu.selectionForeground': '#2a2733',
      'menu.separatorBackground': '#e0d7c7',
      'menu.border': '#cbbfa9',
    },
  });

  // Ink & Vellum dark theme
  monaco.editor.defineTheme('m2-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'keyword.heading', foreground: 'e5b75e', fontStyle: 'bold' },
      { token: 'keyword.resource', foreground: '57c0ac', fontStyle: 'bold' },
      { token: 'type.identifier.resource', foreground: 'ef7c55', fontStyle: 'bold' },
      { token: 'attribute.name', foreground: '57c0ac' },
      { token: 'string.attr', foreground: 'e5b75e' },
      { token: 'variable.payload', foreground: 'b5adc0' },
      { token: 'comment.wrapper', foreground: '756d80', fontStyle: 'italic' },
      { token: 'comment.quote', foreground: '9c94a5', fontStyle: 'italic' },
      { token: 'comment.strike', foreground: '7f7889', fontStyle: 'strikethrough' },
      { token: 'keyword.list', foreground: 'd9a84e', fontStyle: 'bold' },
      { token: 'keyword.table', foreground: 'd9a84e' },
      { token: 'meta.separator', foreground: 'd9a84e' },
      { token: 'strong', fontStyle: 'bold' },
      { token: 'emphasis', fontStyle: 'italic' },
      { token: 'variable.code', foreground: 'ef7c55' },
      { token: 'string.fence', foreground: '57c0ac' },
      { token: 'string.link', foreground: '57c0ac' },
      { token: 'string.link.text', foreground: 'e6e0d3', fontStyle: 'underline' },
    ],
    colors: {
      'editor.background': '#1b1a22',
      'editor.foreground': '#e6e0d3',
      'editorLineNumber.foreground': '#6e6778',
      'editorLineNumber.activeForeground': '#e6e0d3',
      'editorGutter.background': '#22202a',
      'editor.lineHighlightBackground': '#27242f99',
      'editor.selectionBackground': '#3a2f1a',
      'editorCursor.foreground': '#d9a84e',
      'editorIndentGuide.background1': '#2f2c38',
      'editorWidget.background': '#1b1a22',
      'editorWidget.border': '#443f4f',
      'menu.background': '#22202a',
      'menu.foreground': '#e6e0d3',
      'menu.selectionBackground': '#3a2f1a',
      'menu.selectionForeground': '#e6e0d3',
      'menu.separatorBackground': '#2f2c38',
      'menu.border': '#443f4f',
    },
  });
}
