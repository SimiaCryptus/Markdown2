# Markdown2

**Markdown that can carry anything, without breaking anything.**

Markdown2 is ordinary Markdown plus one idea. A document can hold *resources*: pieces of content that say what they are and how to open them, and that can contain further resources. With that single addition, a plain text file can hold diagrams, charts, data tables, maps, images, attachments and encrypted sections. It still reads cleanly in any Markdown editor, and it still degrades gracefully when something cannot be shown.

This folder contains the specification and a reference reader. The reader is an app that runs in the browser, works offline and can be installed.

---

## A little background

Markdown succeeded because it is just text. You can write it in any editor, email it, put it under version control, and read it even when nothing renders it. That is why READMEs, notes apps, wikis, chat tools and AI assistants all use it.

But real documents are rarely just text. They need a diagram, a table of figures, a chart, a screenshot, an attached spreadsheet, or a paragraph only some readers should see. Markdown has no answer for any of these, so every tool invented its own:

- images are *links* to files kept somewhere else, and they break when the document moves
- diagrams hide in code blocks that only some tools know how to draw
- metadata lives in a "frontmatter" block that each tool reads differently
- attachments and private sections are not possible at all

The result is many slightly incompatible dialects, each locked to the tool that invented it.

Markdown2 does not add a dozen features to fix this. It adds **one general mechanism** and lets the features follow from it.

---

## The idea

A resource looks like this inside an ordinary Markdown document:

```text
The network layout is shown below.

<<<TOPOLOGY type="image/svg+xml" encoding="base64 gzip" title="Network topology"
H4sIAAAAAAAAA+2YW2/bNhTH3/0pBL7…
TOPOLOGY
```

It answers three questions, and keeps them separate:

| Question | Answered by | Example |
|---|---|---|
| *What is this?* | `type` | an SVG image, a CSV table, a Markdown document |
| *How do I get to it?* | `encoding` | unpack base64, decompress, decrypt, fetch from an address |
| *What is it to this document?* | `rel` | shown inline, data about the document, an attachment, a description of the previous image |

The word after `<<<` (here `TOPOLOGY`) is a closing word the author chooses. Everything up to the line that repeats it is kept exactly as written and is never treated as Markdown. Nothing inside needs escaping, so you can paste in a whole file, a block of code or another document unchanged.

A resource can itself be a Markdown document, and that document can contain resources. Nesting works without any extra rules.

### What falls out of one primitive

Because type, encoding and relationship are independent, many things that would normally be separate features are just combinations:

- **Embedded images and attachments**: an image or a PDF, base64-encoded, travelling inside the file.
- **Compression**: a large diagram compressed so it takes a fraction of the space.
- **Diagrams, charts and maps**: a resource whose type the reader knows how to draw.
- **Linked data**: a resource whose "encoding" is an address. The table lives in a separate file and is loaded only when you agree.
- **Frontmatter**: the familiar `---` block is simply shorthand for a metadata resource.
- **Encrypted sections**: a nested document whose encoding includes decryption. Unlocking it reveals a whole sub-document, with its own images, tables and further locked sections.
- **Two-person rules**: a resource encrypted twice, to two different groups, opens only when both have granted access.

---

## The principles, in plain language

Markdown2 is opinionated about safety and honesty. These rules are the heart of the design:

1. **A resource is what it says it is.** The reader never guesses from the content. A file declared as an image is never treated as a web page, even if it looks like one. Common slips such as `image/jpg` instead of `image/jpeg` get a "did you mean?" hint, never a silent correction.
2. **Nothing is silently dropped.** If the reader cannot open something, it still shows a labelled placeholder with the title, type, size and the reason it could not be shown.
3. **Opening a document grants nothing.** Reading a file never fetches from the internet, reads your disk or uses your keys on its own. Each of those needs your permission, per resource, and permission never spreads from one resource to the ones inside it.
4. **Broken means closed.** If a resource is damaged, truncated or mistyped, it becomes a "failed" placeholder. Its contents never spill into the text, so a missing line can never dump ciphertext or private data into your view.
5. **Old tools keep working.** Ordinary Markdown is valid Markdown2. A Markdown2 document opened in an older editor still shows all of its prose, and bulky binary content can be wrapped so older previews hide it.
6. **Locked is not invisible.** You can always see *that* something is locked, what it is called and roughly how big it is. Only its contents are protected.

---

## The reader

The reference reader is a browser app that can be installed like a desktop application and works offline.

### Writing and reading

- **Three views**: *Write* (the source), *Split* (source and result side by side, updating as you type) and *Read* (the finished document). Switch with Ctrl+1, Ctrl+2 and Ctrl+3.
- **Open and save** with Ctrl+O and Ctrl+S, or drag a file in. A document can also be opened from a web address. Documents from other sites are opened only after you confirm, and are not kept automatically.
- **Help pages** inside the app show each feature as a live example.

### What it can draw

| Content | Shown as |
|---|---|
| Text, Markdown, JSON, YAML | Formatted text or a nested document |
| Images, including SVG | Pictures. Scripts in SVG never run |
| CSV and TSV data | Live tables you can sort, filter and resize, with columns you can hide |
| Mermaid, Graphviz, WaveDrom | Flowcharts, graphs, timing diagrams and register maps |
| TeX and MathML | Typeset mathematics |
| Plotly, Vega-Lite, Google Charts | Interactive charts |
| GeoJSON | Interactive maps |
| X3D and VRML | 3D scenes |
| Program code | A read-only code viewer with highlighting |
| A web address list | An embedded page in an isolated frame |

Ordinary Markdown tables get the same sort, filter and resize controls as CSV data. Many of these also work from familiar code blocks such as `mermaid`, `math` or `csv`, so existing documents benefit without changes.

Every drawing runs in an isolated box with no access to the rest of the page or your data.

### Staying in control

Each resource that needs something from you shows its own buttons:

- **Unlock…** asks for a password or key to open an encrypted section. Keys are kept in memory only, and **Forget keys** clears them at once. After one unlock, the reader can offer to try the same key on other locked sections, and lists them before it does anything.
- **Load…** fetches linked content, once, for that resource only.
- **Remote…** sets the list of web sites you trust for maps, embedded pages and similar content. Content that needs the network waits until you allow it, and shows something useful in the meantime: a map lists its places, a chart shows its data as a table.
- **Save** and **Save raw** store a resource's contents or its original bytes. The reader never gives a saved file a name that would make it run or open as a web page unless you confirm.

### Styling

Documents can suggest their own look with ordinary CSS, including choices for the reader, such as a *Light* or *Dark* theme, or a *Summary mode* switch that hides the detail. The reader always has the final word:

- Turn all document styles off with Ctrl+Shift+U.
- Add your own styles in *My styles*; they take priority.
- Your choices are remembered by name across documents that offer the same options.

Styles cannot fetch anything from the internet, cannot reach the reader's own controls, and cannot hide a locked or failed placeholder.

### Looking inside

The **inspector** (Ctrl+.) lists every problem found in the document with its line, every resource and its state, and every style sheet the document offers.

---

## Why it is interesting

- **One idea instead of many features.** Most formats grow by adding syntax. Markdown2 adds one primitive and leaves the rest to *handlers* (what can be drawn) and *decoders* (how bytes are obtained). New kinds of content need no change to the format.
- **Documents that travel whole.** A report can carry its charts, its data, its attachments and its confidential appendix in one text file that survives email, archives and hand-offs.
- **Privacy that is part of the document.** Different readers can see different depths of the same file, and that is decided by keys, not by a server or an access list.
- **Safety by default.** The rules come from long experience with web browsers and email: no guessing about content types, no automatic network access, no silent failure. They are built into the format rather than added afterwards.
- **Honest degradation.** Whether you open a file in this reader, an older Markdown editor or a plain text editor, you still get the words.
- **Simple enough to rebuild.** The specification aims to be small enough that anyone can implement it correctly from the text alone, in any language. The reader here is *one* implementation of it, not the definition.
- **Friendly to AI assistants.** Language models already write Markdown. A short reference for agents lets them produce diagrams, tables and charts in a form any tool can check, while fitting into ordinary text.

---

## Who might find it useful

- **Technical writers and engineers**, for runbooks and guides with diagrams inside numbered steps, timing charts and data tables, all in one versionable file.
- **Researchers and analysts**, for reports whose charts and tables carry their own data, so readers can sort, filter and explore instead of squinting at a screenshot.
- **Teams handling sensitive material**, for documents where an appendix is encrypted to finance, a section to legal, and the summary is open to everyone.
- **Teachers and students**, for notes that mix prose, mathematics, diagrams and 3D models without a heavy authoring tool.
- **Anyone handing over a document**, who needs to send one file and know it will arrive with everything in it.
- **People working with AI assistants**, who want generated output that is richer than plain text but still safe and checkable.
- **Tool builders**, who want a well-defined, safe way to embed rich content in Markdown instead of inventing yet another dialect.

---

## Status

Markdown2 is a **working draft (0.2)**. The core idea has been reviewed from several angles and is stable, but details may still change. A few of the content types the reader uses are widely used names that are not yet formally registered; these are marked as provisional in the specification. Questions found while building the reader are recorded openly rather than quietly decided in code.

---

## Read more

| Document | What it is |
|---|---|
| [`idea.md`](idea.md) | The Markdown2 specification itself |
| [`style.md`](style.md) | The companion specification for styling documents with CSS |
| [`MARKDOWN2.md`](MARKDOWN2.md) | A compact reference for authors and AI agents |
| [`spec-issues.md`](spec-issues.md) | Open questions found while building the reader |
| [`plan.md`](plan.md) | How the reference reader was planned |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to report problems, ask questions or help |

The project lives at [github.com/SimiaCryptus/Markdown2](https://github.com/SimiaCryptus/Markdown2). Bug reports, questions about the specification, documents that break things, and implementations in other languages are all welcome.

---

*In one sentence:* Markdown2 is Markdown with embeddable, nestable, clearly labelled content. Everything else is just a matter of what your reader knows how to show.