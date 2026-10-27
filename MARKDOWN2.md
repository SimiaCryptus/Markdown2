# Markdown2: reference for agents

Markdown2 = CommonMark + GFM tables/strikethrough + **one primitive**: opaque, typed, encoded resources that nest. Draft 0.2. Files are `.md`, media type `text/markdown` (optionally `; variant=Markdown2`). Ordinary Markdown is valid Markdown2.

## 1. Resource block

```text
<<<TOKEN type="media/type" encoding="dec1 dec2" rel="rel" title="…" filename="…"
…payload (opaque bytes)…
TOKEN
```

**Opener**
- Starts with `<<<` at block start: column 0, or the content position inside a list item or block quote. It may interrupt a paragraph.
- `<<<` is followed by a TOKEN matching `[A-Za-z_][A-Za-z0-9_.-]*`, then a space, tab or EOL. `<<< X` and `<<<9X` are plain text.
- Attributes: `name="v"` or `name='v'`, separated by spaces or tabs.
  - A value cannot contain its own quote character or a line break.
  - Names are case-insensitive. A repeated name is an error.
  - Use single quotes for media-type parameters with quotes: `type='text/plain; charset="utf-8"'`.
- **Commitment**: once the opener has `<<<TOKEN` plus a space, tab or EOL, the parser scans for the closer even if the rest of the line is malformed. The block then becomes a `failed` node with opaque payload. It never falls back to Markdown.

**Attributes**

| Attribute | Required | Meaning |
|---|---|---|
| `type` | yes | Media type of the fully decoded bytes |
| `encoding` | no | Decoder stack, space-separated, applied left to right. Default `utf-8` |
| `rel` | no | Relationship to the parent. Default `inline` |
| `title` | no | Human label. Shown in locked and fallback stubs. Never affects decoding or handler choice |
| `filename` | no | Suggested save name. Untrusted |

- Unknown attributes are preserved and ignored.
- Core names have no `-`. Extensions are vendor-namespaced (`acme-thumbnail`). Do not use `x-`.
- This reader's extension attributes: `md2-class`, `md2-group`, `md2-default` (§7), `basemap` (maps), `layout` (Graphviz).

**Closer**
- The first later line equal to TOKEN, byte-exact and case-sensitive, optionally followed by spaces or tabs.
- Leading whitespace prevents a match. Container prefixes are stripped first.
- Nothing between opener and closer is interpreted while searching: no Markdown, fences, indentation, or other `<<<` lines.
- Pick a TOKEN that never appears alone on a payload line. If a payload contains `NOTE` on its own line, use `NOTE2`.
- Nested resources need **distinct tokens**. The outer block ends at its own first exact match.

**Payload**
- The bytes after the opener's EOL, up to but excluding the EOL before the closer.
- An empty block (closer directly after the opener) has an empty payload.
- Interior line terminators are preserved. CRLF and LF parse equivalently.

**Unterminated block** (EOF reached, or the container ends first)
- Emit a `failed` node with error `unterminated-resource`.
- The payload runs to the point where the block ended.
- Emit a diagnostic.
- Never backtrack or reinterpret the content as Markdown.

**Containers (list items, block quotes)**
- Every line (opener, payload, closer) carries the container prefix: `>` markers plus indentation to the list content column.
- The prefix is stripped before the closer test. Nothing else is stripped.
- There is no lazy continuation. A payload line missing the prefix ends the container, so the resource is `failed`.
- Exceptions that give an empty payload line: a blank line in a list item, and a line of only `>` markers.

```text
2. Check the topology:

   <<<TOPO type="image/svg+xml" title="Topology"
   <svg …/>
   TOPO
```

Resource syntax is plain text inside fenced code, indented code and HTML blocks, except the compat wrapper (§6).

## 2. Frontmatter

- First line exactly `---` at byte offset 0. It ends at the next line that is exactly `---` or `...`.
- It is sugar for `<<<META type="application/yaml" rel="metadata"`. The renderer cannot tell the two forms apart. It is always YAML.
- `---` elsewhere is a thematic break. Use `***` or `___` as a first-line break.
- Unterminated frontmatter gives a `failed` metadata node with error `unterminated-frontmatter`.
- It applies at the start of every `text/markdown` resource, so nested documents may have their own.
- YAML is loaded with a safe schema. Tags such as `!!python/object` are never instantiated.
- Other metadata formats: `<<<META type="application/json" rel="metadata"`.

## 3. Model: Node = {rel?, Resource{type, encoding[], payload, attributes}}

- `type` = what the bytes are. `encoding` = how to obtain them. `rel` = what the node is to its parent.
- The document itself is a resource with `type=text/markdown`, `encoding=[utf-8]`. A nested `text/markdown` resource is rendered by the same handler, so nesting is composition.
- Pipeline: `payload → decoder[0] → decoder[1] → … → typed bytes → handler(type) → view`. Every stage runs under a byte quota.

**`rel` tokens**

| Token | Meaning |
|---|---|
| `inline` | Default. Rendered where it appears |
| `metadata` | Data about the document. Consumed, not displayed |
| `attachment` | Presented as something to save, not rendered inline |
| `alternate` | Alternative to the previous sibling resource. At most one of the two is shown. Use it when the first is unsupported |
| `describedby` | Text description of the previous sibling, used as alt text |
| `stylesheet` | Reader extension: document CSS (§7) |

Unknown `rel` values are preserved and treated as `inline`.

Place `alternate` and `describedby` resources **immediately after** the resource they refer to.

## 4. Encodings (decoder stack)

Write `encoding` in **decoding order**. To produce the payload, do the steps in reverse.

```text
compress → encrypt → base64   ⇒  encoding="base64 age gzip"
```

| Decoder | Behaviour |
|---|---|
| `utf-8` | Default. Payload is text, validated as UTF-8 |
| `base64` | RFC 4648. ASCII whitespace ignored. Wrap at 76 columns for diffs |
| `gzip` | RFC 1952. Decompression bombs are stopped mid-stream |
| `uri` | Optional. Must be **first**. The payload is one URI (whitespace trimmed). The fetched bytes are used, but the declared `type` wins over `Content-Type` and extensions |
| `age` (and other encryption) | Capability-gated. AEAD only |

- Compression is an encoding, not a type. A gzipped SVG is `type="image/svg+xml" encoding="base64 gzip"`. Use `type="application/gzip"` only when the archive itself is the object to save.
- Compress before encrypting. Do not compress secrets together with attacker-influenced data (CRIME/BREACH).
- Encryption is an encoding. The declared type is the real type, for example `encoding="base64 age"`.
- Layered encryption (`base64 age age`) needs every layer granted: a two-person rule. Multiple recipients within one layer is the format's own feature (age supports it).
- Nesting an encrypted `text/markdown` resource inside another protects a structure. Unlocking the outer one leaves the inner ones locked.
- To hide the type of an encrypted resource, declare `text/markdown` outside and put the real typed resource inside. Title, type and size of a locked resource are always visible.
- Other algorithms (`zstd`, `br`) are not core. A reader without them marks the resource `unsupported`.

**States** (first match wins, in this order)
1. `failed` (structural): unterminated, malformed opener, missing `type`, duplicate attribute, `uri` not first, limit already exceeded.
2. `unsupported`: the stack names an unimplemented decoder.
3. `locked`: a decoder needs an ungranted capability.
4. `failed` (runtime): invalid base64, corrupt gzip, invalid UTF-8, quota exceeded (`limit-exceeded`).
5. `decoded`.

Examples: `frobnicate uri` is `failed`. `base64 frobnicate age` is `unsupported`.

**Capabilities**
- No decoder that needs authority (`uri`, encryption) runs without user action.
- `uri` is `locked` by default for **all** schemes, including `file:` and relative references.
- Grants are per resource and never propagate to children. Batch grants are explicit, scoped, and applied per node.
- Server-side renderers must refuse loopback, link-local and private addresses, including after redirects.

## 5. Types and fallback

- `type` is authoritative. **No sniffing.** `image/jpg` is not `image/jpeg`.
- Prefer IANA types. Provisional names are listed in §8.
- A resource that is not decoded, or has no handler, is still shown with: title or filename, type, encoding, state and error, and size. It never breaks the surrounding document.
- Near-miss types (`image/jpg`, `text/json`, `image/svg`) get a "did you mean?" hint. They are never silently corrected.
- Saving never derives an active extension (`.html`, `.svg`, `.js`, `.exe`, `.bat`) from `type` or `filename`. The default is `.bin`, or the user confirms.
- Limits: nesting depth, total decoded size and resource count are enforced incrementally. Exceeding one gives `failed` with `limit-exceeded`, and the rest of the document continues.
- Error codes seen: `unterminated-resource`, `unterminated-frontmatter`, `missing-type`, `limit-exceeded`, `handler-error` (handler rejected valid bytes).

## 6. Compatibility

**Wrapper.** The line `<!--`, immediately followed by an opener, then the resource, then `-->` on the line right after the closer:

```text
<!--
<<<BIG type="image/svg+xml" encoding="base64 gzip"
H4sI…
BIG
-->
```

- Old renderers hide it as an HTML comment. Markdown2 parses the resource normally and discards the wrapper lines.
- A missing `-->` gives a diagnostic.
- The payload must not contain `-->`. Base64 never does.
- Recommended for binary and encrypted payloads. Add a prose sentence saying what it contains.
- **Do not** wrap resources in code fences. They would become plain text.

**Fence aliases.** Fences with these info strings are still fenced code in the tree, but the reader can draw them. Unsupported readers just show code.

| Fence | Type |
|---|---|
| `mermaid` | `text/vnd.mermaid` |
| `dot`, `graphviz` | `text/vnd.graphviz` |
| `wavedrom` | `text/vnd.wavedrom` |
| `math` | `application/x-tex` |
| `x3d` | `model/x3d+xml` |
| `json` | `application/json` |
| `csv`, `tsv` | table grid |
| `plotly` | `application/vnd.plotly.v1+json` |
| `vega-lite`, `vegalite` | `application/vnd.vegalite.v5+json` |
| `geojson` | `application/geo+json` |
| `ts`, `js`, `python`, `bash`, `rust`, `go`, … | code view in Monaco |

- Fences have no resource behind them, so no *Load…* button. Network-dependent fences draw only once the origin is allowed globally.
- Version control: in repositories prefer `encoding="uri"` with a relative path. Inline payloads suit documents that travel.

## 7. Reader handlers (PWA reference reader)

**Markdown**
- CommonMark 0.31.2 plus GFM tables (alignment `:---`, `:---:`, `---:`; inline content only) and `~~strike~~`.
- Raw HTML is never passed through. Embed HTML as a resource instead.
- Images in prose (`![alt](url)`) are never fetched. They render as links.
- There is no inline `$…$` math. Math is block-level only.
- Tables, including Markdown ones, get sort, filter, column hide and resize controls.

**Handlers by type**

| Type | Behaviour |
|---|---|
| `text/plain` | Shown as text |
| `text/markdown` | Nested document |
| `application/json` | Pretty-printed |
| `application/yaml` | Shown as text, never instantiated |
| `image/svg+xml` | Drawn through an image. Scripts never run |
| `image/*` (png etc.) | Image handler (declared type only) |
| `text/csv`, `text/tab-separated-values` | Live grid. See below |
| `text/javascript`, `text/css`, … code types | Monaco read-only, sandboxed |
| `text/vnd.mermaid` | Mermaid diagram, strict level |
| `text/vnd.graphviz` | Graphviz, WASM. Output is an inert image |
| `text/vnd.wavedrom` | WaveDrom timing diagrams or register maps. Source is JSON5, never evaluated |
| `application/x-tex` | MathJax SVG image (`base`, `ams` packages only) |
| `application/mathml+xml` | MathJax SVG image |
| `model/x3d+xml`, `model/x3d-vrml`, `model/vrml` | X_ITE 3D scene, sandboxed |
| `application/vnd.plotly.v1+json` | Plotly chart |
| `application/vnd.vegalite.v5+json` | Vega-Lite chart |
| `application/vnd.google.charts+json` | Google Charts (network, waits) |
| `text/uri-list` | Embedded page in a sandboxed iframe (network, waits) |
| `application/geo+json` | MapLibre map (network, waits) |
| `text/css` with `rel="stylesheet"` | Document styles |
| anything else | Fallback stub (shown, not dropped) |

**CSV / TSV**
- CSV follows RFC 4180: quoted fields may hold commas, newlines and `""`.
- TSV has no quoting.
- The first row is the header. For no header use `type='text/csv; header=absent'`.
- Limits: 10,000 rows and 256 columns. Cells are text only.
- Invalid UTF-8 gives `handler-error`.
- Linked data: `encoding="uri"` with the path as payload. It stays locked until the user loads it.

**Charts**
- Plotly: standard Plotly JSON (`data`, `layout`).
  - `layout.width` is ignored. `layout.height` is kept, 150–2000, default 450.
  - Only the `config` keys `staticPlot`, `scrollZoom`, `displayModeBar` and `doubleClick` are honoured.
  - Limits: 200 traces and 500 frames.
  - There are no network tiles, so geo and map traces draw nothing.
- Vega-Lite: data must be **inline** (`data.values` or `datasets`).
  - Any `url` or `href` makes the resource fail with `handler-error`.
  - Expressions are interpreted, not compiled. A Vega (non-Lite) `$schema` is refused.
  - `"width": "container"` fills the page.
- Google Charts: JSON `{chartType, data (first row = labels), options}`. Until drawn, a data table shows. Needs `www.gstatic.com`.
- Both Plotly and Vega-Lite run sandboxed with no network, and parse JSON as data only.

**Maps**
- GeoJSON (RFC 7946), positions `[lon, lat]`. A Feature, a bare geometry or a collection are all accepted.
- `basemap="liberty|bright|positron"` (default `liberty`).
- Simplestyle properties: `marker-color`, `stroke`, `stroke-width`, `stroke-opacity`, `fill`, `fill-opacity`.
- Other properties show in popups as plain text.
- Tiles come from `tiles.openfreemap.org` and wait for permission. Until then the map lists its features.

**Embedded pages**
- `text/uri-list`: one `https:` URL. Blank lines and `#` lines are ignored.
- Only external `https:` is framed. Same-site, `http:` and URLs with credentials fail.
- Frames are 16:9. They run sandboxed with no referrer.

**Graphviz**
- `layout` attribute: `dot` (default), `neato`, `fdp`, `sfdp`, `circo`, `twopi`, `osage` or `patchwork`. Any other value falls back to `dot`.

**Document styles (`rel="stylesheet"`, `type="text/css"`)**
- Plain CSS. Place sheets at the top of the file, wrapped for old previews.
- `md2-group="G"` and `title="T"`:
  - Without `md2-group`, a sheet is persistent while document styles are on.
  - A group of several members is a **choice**: exactly one applies.
  - A group of one is a **switch**.
  - `md2-default="on|off"` sets the initial state.
- User choices are remembered by group and title across documents.
- `md2-class="x"` on any resource adds a class. Wrap prose in a nested `text/markdown` resource to give it a class.
- Selector tree:
  - `md2-document` (root of every document, and `:root` at top level)
  - `md2-section[level=1..6]`
  - `md2-resource` with attributes `type`, `essence`, `state`, `rel`, `title`, `class`
  - `md2-view` (handler output) and `md2-fallback` (stub)
- A stylesheet in a nested document applies only inside it.
- Styles cannot:
  - fetch (`@import` is ignored, remote `url()` is stripped, `data:` is kept)
  - reach reader chrome
  - hide a locked or failed stub
  - keep secrets
- The user can switch to unstyled (Ctrl+Shift+U) and has "My styles" with `!important` priority.

**Reader UI** (useful when giving the user instructions)
- Ctrl+1/2/3: Write, Split, Read.
- Ctrl+.: inspector (Diagnostics, Resources, Styles).
- Ctrl+O and Ctrl+S: open and save.
- `?url=` opens a document. Paths on the same site open directly. Other `https:` URLs prompt, send no cookies, and are not autosaved.
- Toolbar: Remote… (allow-list of origins), Forget keys.
- Per-resource *Unlock…*, *Load…*, *Save* (decoded) and *Save raw*.
- Keys live in memory only. After a successful unlock the reader may offer to try the key on other locked resources, listing them first.

## 8. Provisional and baseline types

- Registered: `text/markdown`, `application/yaml`, `application/json`, `application/mathml+xml`, `text/csv`, `text/tab-separated-values`, `application/geo+json`, `text/uri-list`.
- Provisional (not IANA):
  - `application/x-tex`
  - `text/vnd.mermaid`
  - `text/vnd.graphviz`
  - `text/vnd.wavedrom`
  - `application/vnd.plotly.v1+json`
  - `application/vnd.vegalite.v5+json`
  - `application/vnd.google.charts+json`

## 9. Security invariants

- Opening a document grants nothing: no network, files or keys.
- Fail closed: bad resources become `failed` nodes and their bytes never reach the prose.
- No sniffing. The declared type wins over server headers and extensions.
- Handlers are sandboxed and receive only decoded bytes. SVG and maths are shown as images.
- Locked content is not hidden: title, type and size are visible.
- Encryption must be AEAD. A wrong key leaves the resource locked, not failed.
- Resource exhaustion limits are mandatory.

## 10. Authoring checklist for agents

1. Every resource has `type` (a missing one gives `failed`).
2. Choose a TOKEN unique among nested tokens and not occurring alone on any payload line.
3. A closer must start at the container content position, with no extra leading space.
4. Write `encoding` in decoding order (`base64` first for compressed binary). `uri` goes first or not at all.
5. Use exact IANA type strings. Do not rely on `image/jpg`, `text/json` or `image/svg`.
6. Never put resources inside code fences. Use the `<!-- … -->` wrapper to hide them from old renderers.
7. Inside lists and quotes, prefix every line of the resource.
8. Put `alternate` and `describedby` resources right after their target. Give images a `describedby`.
9. Use inline data for charts (no `url`). Use `title` and `filename` for locked and fallback legibility, and expect them to be treated as untrusted.
10. Do not use raw HTML, inline `$math$`, or image links in prose for rendering. Use resources and fences instead.
11. Validate with `m2 validate file.md` (diagnostics like `file:LINE: missing-type`).

**Minimal examples**

```text
---
title: Doc
---
# Doc

<<<DATA type="application/json" title="Data"
{"a": 1}
DATA

<<<LOGO type="image/svg+xml" encoding="base64 gzip" title="Logo"
H4sIAAAAAAAAA…
LOGO
<<<LOGOALT type="text/plain" rel="describedby"
A green circle.
LOGOALT

<<<VAULT type="text/markdown" encoding="base64 age" title="Private notes"
YWdlLWVuY3J5cHRpb24ub3JnL3YxCi0+…
VAULT

<<<REMOTE type="text/csv" encoding="uri" title="Planets"
data/planets.csv
REMOTE
```

*One sentence:* Markdown2 is Markdown with recursively embeddable, explicitly typed, explicitly encoded opaque resources. Everything else is a handler, a decoder or a convention.