# markdown2.js

Markdown2 as a library for any web page, with a [marked](https://marked.js.org)-compatible API and a
permission-aware live view.

- `npm install && npm run build` writes `dist/`: `markdown2.js` (ES module, code-split), `markdown2.umd.js`
  (global `markdown2`) and the example page (`index.html`, `example.js`, `example.css` from `public/`).
- `npm run preview` serves `dist/` at http://localhost:4174/.
- Deployed by `deploy.sh` to `/lib/` in the same bucket as the reader: https://md2.cognotik.com/lib/index.html.

## Usage

```js
import { marked, mount, defaultCss } from 'https://md2.cognotik.com/lib/markdown2.js';

el.innerHTML = marked.parse(source);                      // synchronous drop-in
el.innerHTML = await marked.parse(source, { async: true }); // full pipeline (gzip, granted keys/fetches)
const view = mount(el, source, { onChange: (s) => … });    // live, with consent dialogs
```

The example page demonstrates every part: `marked.parse`, `async`, `mount()` with app-driven controls,
the `<markdown2-view>` element, handlers, hooks and `walkTokens`.

## Differences from marked

- Tokens are Markdown2 tokens: runs of prose and opaque resources.
- `renderer`, `tokenizer` and `extensions` are accepted and ignored. Extend with `handlers` (one per media type).
- Without `async: true`, resources that need to await (gzip, keys, fetches) show `requires-async`.
- Rendering grants nothing: locked resources stay locked until the user or the app grants them.

Importing from another site needs `Access-Control-Allow-Origin` on `/lib/*`; the CloudFront distribution
already adds it for the reader's sandboxed frames.