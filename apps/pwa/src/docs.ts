/** The project on GitHub. Issues, discussions and pull requests are welcome. */
export const REPO = 'https://github.com/SimiaCryptus/Markdown2';

/** Built-in documentation, served from `public/docs` and opened through `?url=`. */
export interface DocEntry {
  path: string;
  title: string;
  summary: string;
}

export const DOCS: readonly DocEntry[] = [
  { path: '/docs/index.md', title: 'Welcome', summary: 'What Markdown2 is, on one page' },
  { path: '/docs/guide.md', title: 'Using the app', summary: 'Layouts, inspector, drafts and saving' },
  { path: '/docs/markdown.md', title: 'Markdown formatting', summary: 'Every formatting feature, tables included' },
  { path: '/docs/resources.md', title: 'Resources and encodings', summary: 'Types, encodings, relationships, nesting' },
  { path: '/docs/trust.md', title: 'Locks, keys and remote resources', summary: 'Nothing unlocks on its own' },
  { path: '/docs/styles.md', title: 'Document styles', summary: 'Themes and toggles a document can offer' },
  { path: '/docs/developer.md', title: 'Developer features', summary: 'Code with Monaco, Mermaid diagrams, MathJax' },
  { path: '/docs/embeds.md', title: 'Web pages and charts', summary: 'Embedded pages and Google Charts' },
  { path: '/docs/tables.md', title: 'Data tables', summary: 'CSV and TSV grids: sort, filter, hide, resize' },
  { path: '/docs/community.md', title: 'Join the community', summary: 'Markdown2 on GitHub, and how to help' },
];