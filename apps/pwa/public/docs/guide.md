---
title: Using the app
---
# Using the app

This page explains the reader and editor around you. It is a Markdown2 document too: press **Ctrl+2** (⌘2 on a Mac) to see its source beside the page, and edit it freely. Your changes stay in this tab.

## Layouts

- **Write** (Ctrl+1) shows only the source.
- **Split** (Ctrl+2) shows the source and the page side by side. The page updates as you type.
- **Read** (Ctrl+3) shows only the page.

## The inspector

Press **Ctrl+.** to show or hide the inspector. It sits outside the page, in reader chrome, so nothing a document does can fake or hide what it shows.

- **Diagnostics** lists everything the parser and decoders noticed. Click an entry to jump to its line.
- **Resources** lists every resource with its true state: decoded, locked, unsupported or failed. Locked resources offer *Unlock…*, and every resource can be saved.
- **Styles** offers the style choices a document makes, plus your own styles.

## A diagnostic, on purpose

The resource below forgets its `type`. It still becomes a resource, in the `failed` state, and its payload stays opaque. Look for it in the Diagnostics tab and as a red dot in the gutter beside the source.

<<<OOPS title="A resource without a type"
# This is not a heading.
It is the payload of a broken resource, and it never leaks into the page.
OOPS

A near miss of a known type gets a hint, never a silent correction:

<<<PHOTO type="image/jpg" title="Not really a photo"
these bytes are never passed to the JPEG handler
PHOTO

## Opening documents

- **Open** (Ctrl+O) reads a file from your device. Nothing is uploaded.
- Drop a `.md` file anywhere on the window.
- Installed as an app, Markdown2 can open `.md` files from your operating system.
- Add `?url=` to the address to open a document from the web:

```text
/?url=/docs/styles.md
/?url=https://example.org/notes/today.md
```

Paths on this site open straight away. Documents on other `https:` sites ask first, because that server learns that you opened them, and no cookies are sent. Links between documents opened this way stay in the app, and the browser's Back button returns to where you were.

## Drafts and saving

Whatever you type in an ordinary document is autosaved in this browser as your **local draft**.

Documents opened through `?url=`, such as these help pages, are *not* autosaved, so reading the help never overwrites your draft. Choose *Back to my draft* in the Help menu, or press Back, to return to it. If you have edited a page opened by URL, you are asked before those edits are discarded.

**Save** (Ctrl+S) writes the document to a file. A saved document becomes an ordinary document, with an autosaved draft.

## Saving resources

Each resource in the Resources tab offers *Save*, for the decoded bytes, and *Save raw*, for the payload as written. File names come from the document, so they are untrusted. This attachment asks to be called `page.html`:

<<<PAGE type="text/html" rel="attachment" filename="page.html"
<h1>Saved, never rendered</h1>
PAGE

The safe default name is `page.bin`. The app offers `page.html` only after you confirm, because that extension renders actively when opened. Downloads are always sent as plain bytes.

## Keyboard

- **Ctrl+O** opens a document, **Ctrl+S** saves it.
- **Ctrl+1**, **Ctrl+2**, **Ctrl+3** switch between Write, Split and Read.
- **Ctrl+.** shows or hides the inspector.
- **Ctrl+Shift+U** switches to the unstyled view and back.
- **?** shows the keyboard sheet.

## Next

- [Resources and encodings](resources.md)
- [Back to the welcome page](index.md)