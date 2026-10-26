# @markdown2/pwa: barebones M4

`npm install && npm run dev`, then open the printed URL. `npm run build && npm run preview` serves the production build with the service worker.
## Design: Ink & Vellum
- The preview is a sheet of paper on a desk: serif type, a gold drop cap, ❦ section breaks and specimen-style resource cards. Locked resources are drawn sealed (dashed gold, hatched). All of it lives in the `m2-ua` layer, so document styles still win.
- Layouts: Write / Split / Read (`Mod+1/2/3`). Inspector with Diagnostics, Resources and Styles tabs (`Mod+.`); a drawer on narrow screens.
- Line-number gutter with diagnostic markers. Hover a marker for the message; click it to jump.
- Status bar: save state (local draft, unsaved or saved), cursor, word count and a diagnostics summary.
- Light, dark or automatic theme. Drop overlay. Print shows only the page. `?` opens the shortcut sheet.


## What is implemented

- **Viewing and editing**
  - Editor with live, debounced preview.
  - Diagnostics panel with jump-to-line for top-level diagnostics.
- **Opening documents**
  - File System Access API, with a file-input fallback.
  - Drag and drop.
  - OS file handling through the launch queue.
  - GET share target.
  - The draft is autosaved.
- **Capability UX (§5.5)**
  - Nothing unlocks on open. The Resources panel, which sits in reader chrome outside the styled
    preview (style.md §8.3), shows every resource's true state and offers "Unlock…".
  - `age` keys: passphrases or identities, unlocked one layer at a time. Keys are held in memory only.
  - `uri` resources:
    - a confirmation unlocks one resource at a time
    - a user-configured list of `https:` origins allows remote resources without asking
  - Batch grants show their scope before you confirm.
  - "Forget keys" clears every grant.
- **Styles (style.md, M2SS)**
  - The preview is the M2SS styling tree. Document stylesheets are sanitised (no fetching),
    scoped to their own document and applied through an adopted stylesheet.
  - Origins map to cascade layers `m2-ua < m2-user < m2-author`.
  - The Styles panel offers each document group as a switch (one member) or a choice (several),
    turns document styles off for this document or by default, and edits "My styles" (user origin).
  - Choices are remembered by exact group name and title.
  - "Unstyled view" reaches an unstyled document with one click.
- **Saving (§6.2)**
  - Raw or decoded bytes, with the safe default name from core.
  - A name the document requests is used only after you confirm it.
  - Downloads are always sent as `application/octet-stream`.
- **Offline**
  - Network-first service worker with a cache fallback.
  - Update prompt when a new version is ready.

## Deferred (plan M4 / M5)

- Preact and CodeMirror; a worker for parsing.
- Recent files in IndexedDB.
- Authoring helpers.
- Trusted Types: the preview currently uses `innerHTML` on escaped output.
- Trusting relative references within a project.
- Browsers without `@scope` ignore document stylesheets entirely (fails safe).