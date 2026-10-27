---
title: Welcome to Markdown2
---
# Welcome to Markdown2

Markdown2 is Markdown plus one idea: you can embed **opaque, typed resources**, and those resources can nest inside each other. This page is itself a Markdown2 document. Press **Ctrl+2** (⌘2 on a Mac) to see its source beside the page.

## One primitive

A resource starts with `<<<` and a terminator token you choose. It declares its type, and it ends at the first line that holds just that token:

```text
<<<NOTE type="text/plain" title="A note"
Anything at all stays opaque here.
# This is not a heading, and ``` is not a fence.
NOTE
```

Here is that exact block, live:

<<<NOTE type="text/plain" title="A note"
Anything at all stays opaque here.
# This is not a heading, and ``` is not a fence.
NOTE

Nothing inside a resource needs escaping. The reader slices out the bytes and hands them to a handler for the declared type.

## Documents inside documents

A resource of type `text/markdown` is rendered by Markdown2 itself, so a document can carry whole documents, with their own resources:

<<<INNER type="text/markdown" title="A nested document"
### A document inside the document

It has its own *Markdown* and its own resources:

<<<DEEP type="text/plain" title="Two levels down"
Hello from the inside.
DEEP
INNER

An encrypted nested document hides a whole structure behind one key. The [locks and keys](trust.md) page explains how.

## Where to next

- [Using the app](guide.md): layouts, the inspector, drafts and saving.
- [Resources and encodings](resources.md): types, `base64`, `gzip`, relationships and placement.
- [Locks, keys and remote resources](trust.md): why nothing unlocks or fetches on its own.
- [Document styles](styles.md): themes and switches a document can offer, and how you stay in charge.

## Opening any document by URL

Add `?url=` to the address of this app:

```text
/?url=/docs/resources.md
/?url=https://example.org/notes/today.md
```

Paths on this site open straight away. Documents on other `https:` sites ask first. Opening a document never unlocks or fetches anything inside it.
- [Markdown formatting](markdown.md): every formatting feature, tables included.
- [Developer features](developer.md): code blocks that know their language, Mermaid diagrams and mathematics.
- [Web pages and charts](embeds.md): embedded pages and Google Charts, loaded only when you allow them.