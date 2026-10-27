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
- **Developer handlers** (`src/handlers.ts`, demonstrated in `public/docs/developer.md`)
  - Fenced code with a known language: read-only Monaco in a sandboxed frame (`/sandbox/code.html`),
    inside the original `pre > code.language-x`. Code resources (`text/javascript`, …) too.
  - `text/vnd.mermaid` and ```` ```mermaid ````: Mermaid (strict) in a sandboxed frame (`/sandbox/mermaid.html`).
  - `application/x-tex`, ```` ```math ```` and `application/mathml+xml`: MathJax to SVG, shown through `<img>`.
   - `model/x3d+xml`, `model/x3d-vrml`, `model/vrml` and ```` ```x3d ````: X3D scenes drawn by X_ITE in a sandboxed
     frame (`/sandbox/x3d.html`). X_ITE is copied to `public/vendor/x_ite` on install (`scripts/vendor-x_ite.mjs`)
     and served from this origin; the frame fetches nothing from the web.
  - Frames have an opaque origin and show the escaped source until they report that they have drawn.
    Their scripts are CORS requests, so production needs the CloudFront CORS policy in `terraform/`.
- **Web pages and charts** (`public/docs/embeds.md`)
  - `text/uri-list`: an `https:` page on another site in a sandboxed frame (no top navigation, no referrer).
  - `application/vnd.google.charts+json`: Google Charts in an opaque-origin frame (`/sandbox/gchart.html`).
  - Both reach the network, so neither loads on open. *Load…* in the Resources panel allows one resource;
    origins in **Remote…** load without asking. Until then a page shows its address and a chart its data table.
- **Prose**: GFM tables and `~~strikethrough~~`, demonstrated in `public/docs/markdown.md`.
- **Drag and drop**: drags that start in the app never drop back into it (no accidental navigation into
  a dragged image). Only files dragged in from outside open documents.
- **Help and opening by URL**
   - The Help menu opens the built-in documentation in `public/docs/`. Each page is a Markdown2
     document that also demonstrates what it describes.
   - `?url=` opens any document: a path on this site (`/?url=/docs/styles.md`) or an `https:` URL,
     which asks first. Cookies are never sent to other sites, and nothing inside the document is
     unlocked or fetched.
   - Documents opened by URL are not autosaved, so they never overwrite the local draft. Links
     between them stay in the app, and Back/Forward work.


## Deferred (plan M4 / M5)

- Preact and CodeMirror; a worker for parsing.
- Recent files in IndexedDB.
- Authoring helpers.
- Trusted Types: the preview currently uses `innerHTML` on escaped output.
- Trusting relative references within a project.
- Browsers without `@scope` ignore document stylesheets entirely (fails safe).
  - Inline buttons sit on each locked card and unloaded embed (*Load from host…*, *Unlock…*). They live
    in closed shadow roots and only open the chrome dialog, which offers *Load this one* or
    *Always allow host* (added to the Remote… list, so that site never asks again).
- **Inline style controls**: each style group shows a checkbox (one member) or dropdown (several)
  where its first stylesheet sits in the document, synced with the Styles panel.
- **Maps** (`public/docs/maps.md`)
  - `application/geo+json` and ```` ```geojson ````: GeoJSON on an interactive MapLibre GL JS map with
    OpenFreeMap tiles, in an opaque-origin frame (`/sandbox/map.html`) that may only reach `tiles.openfreemap.org`.
  - `basemap="liberty|bright|positron"` picks the OpenFreeMap style. simplestyle properties (`marker-color`,
    `stroke`, `fill`, …) colour features. Properties appear in popups as text, never HTML.
  - Tiles reach the network, so maps wait for *Load…* like charts; until then they list their features.
- **Charts: Plotly and Vega-Lite** (`public/docs/charts.md`)
  - `application/vnd.plotly.v1+json` and ```` ```plotly ````: plotly.js in an opaque-origin frame (`/sandbox/plotly.html`).
    Only `staticPlot`, `scrollZoom`, `displayModeBar` and `doubleClick` are honoured from `config`.
    The frame allows `'unsafe-eval'` (needed by the full bundle) and no remote origin, so geo and map traces cannot load.
  - `application/vnd.vegalite.v5+json`, ```` ```vega-lite ```` and ```` ```vegalite ````: vega-embed in an opaque-origin frame
    (`/sandbox/vega.html`). Expressions run through `vega-interpreter`, so no `'unsafe-eval'`. Data must be inline:
    `url` and `href` keys are refused, and the frame's loader refuses every request.
  - Both need no network, so they draw on open. Shared validation lives in `src/charts.ts`.