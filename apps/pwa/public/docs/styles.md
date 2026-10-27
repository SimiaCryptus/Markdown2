---
title: Document styles
---

<<<BASE type="text/css" rel="stylesheet"
md2-resource.callout {
  border-left: 4px solid #b0802a;
  /* Remote url() references are removed before the sheet applies: this is never fetched. */
  background-image: url(https://example.org/never-fetched.png);
}
md2-resource.callout md2-document p { margin: 0; }
BASE

<<<PAPER type="text/css" rel="stylesheet" md2-group="Page tint" title="Paper" md2-default="on"
/* The reader's own page colours. */
PAPER

<<<SEPIA type="text/css" rel="stylesheet" md2-group="Page tint" title="Sepia"
:root { background: #f4ecd8; color: #3b2f1e; }
SEPIA

<<<NIGHT type="text/css" rel="stylesheet" md2-group="Page tint" title="Night"
:root { background: #1d1b22; color: #e6dfd2; }
md2-resource { background: #26232d; border-color: #3a3644; }
NIGHT

<<<SUMMARY type="text/css" rel="stylesheet" md2-group="Summary mode" title="Summary mode" md2-default="off"
md2-resource.details { display: none; }
SUMMARY

# Document styles

A document can offer styles. You decide whether to use them. Styles are ordinary CSS, carried in resources with `rel="stylesheet"`. They change how the page looks, never what it says.

<<<TIP type="text/markdown" md2-class="callout" title="Try it"
Open the **Styles** tab in the inspector. This page offers a *Page tint* choice and a *Summary mode* switch.
TIP

## What this page offers

Five stylesheets sit at the top of this page's source, each inside the compatibility wrapper so that ordinary Markdown previews hide them:

- `BASE` is **persistent**. It has no group, so it applies whenever document styles are on. It gives the tip above its gold edge.
- `PAPER`, `SEPIA` and `NIGHT` share the group *Page tint*. A group of several members is a **choice**: exactly one applies.
- `SUMMARY` is alone in the group *Summary mode*. A group of one is a **switch**. It starts off, because it says `md2-default="off"`.

Turn on *Summary mode* and the section below disappears:

<<<DETAILS type="text/markdown" md2-class="details" title="Details"
### The details

This nested document carries `md2-class="details"`, so the summary stylesheet can hide it with `md2-resource.details { display: none; }`. Markdown has no classes, so wrapping prose in a nested document is how a stretch of text gets one.
DETAILS

## How a stylesheet is written

```text
<<<SUMMARY type="text/css" rel="stylesheet" md2-group="Summary mode" title="Summary mode" md2-default="off"
md2-resource.details { display: none; }
SUMMARY
```

Selectors match a fixed, documented tree:

- `md2-document` is the root of every document, nested ones included. At the top level it also matches `:root`.
- `md2-section` wraps the part under each heading, with `level="1"` to `level="6"`.
- `md2-resource` is every resource. It carries `type`, `essence`, `state`, `rel`, `title` and `class`.
- `md2-view` holds what a handler draws, and `md2-fallback` holds the stub for anything that is not shown.

## Styles stay inside their document

A stylesheet inside a nested document applies only within that document:

<<<SCOPED type="text/markdown" title="A nested document with its own style"
<<<INNERSTYLE type="text/css" rel="stylesheet"
p { font-style: italic; color: #0f6b5f; }
INNERSTYLE
This paragraph is styled by a stylesheet inside its own nested document. Paragraphs outside it are untouched.
SCOPED

That is how an encrypted or third-party section is kept from restyling the document around it, for example to hide a warning.

## You stay in charge

- **Unstyled** in the toolbar, or **Ctrl+Shift+U**, removes every document style with one keystroke.
- The Styles tab can turn document styles off for every document by default.
- Your choices are remembered by group name and title. Another document that offers *Page tint* with a *Sepia* member opens the same way.
- *My styles…* holds your own CSS, applied to every document. Your `!important` rules beat the document's.

## What styles cannot do

- **Fetch.** `@import` is ignored, and remote `url()` references are removed. Only `data:` URLs remain. The background image in `BASE` above is never requested.
- **Escape the page.** Styles cannot reach the toolbar, the inspector or any dialog. The page is contained, so nothing can be painted outside it.
- **Hide a lock.** A locked or failed resource always shows its stub.
- **Keep secrets.** `display: none` hides text from view, not from the file. Use encryption to withhold content.

## Next

- [Using the app](guide.md)
- [Back to the welcome page](index.md)