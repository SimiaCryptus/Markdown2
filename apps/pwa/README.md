# @markdown2/pwa: barebones M4

`npm install && npm run dev`, then open the printed URL. `npm run build && npm run preview` serves the production build with the service worker.

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
  - Nothing unlocks on open; each locked resource has an "Unlock…" button.
  - `age` keys: passphrases or identities, unlocked one layer at a time. Keys are held in memory only.
  - `uri` resources:
    - a confirmation unlocks one resource at a time
    - a user-configured list of `https:` origins allows remote resources without asking
  - Batch grants show their scope before you confirm.
  - "Forget keys" clears every grant.
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