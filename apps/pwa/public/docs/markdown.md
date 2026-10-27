---
title: Markdown formatting
---
# Markdown formatting

Every Markdown2 document is Markdown first. This page shows each formatting feature the reader renders, live. Press **Ctrl+2** (⌘2 on a Mac) to see the source beside the page.

## Text

Paragraphs are separated by a blank line. Inside them you can write *italic* or _italic_, **bold** or __bold__, ***bold italic***, ~~struck through~~ and `inline code`.

A backslash keeps a character literal: \*not italic\*, \# not a heading, \`not code\`.

Entities work too: &copy; &mdash; &hellip; &#8364; &#x2603;.

End a line with a backslash\
to break it without starting a new paragraph. Two trailing spaces do the same.

## Headings

ATX headings use one to six `#` signs:

### Third level

#### Fourth level

##### Fifth level

###### Sixth level

A setext heading
----------------

A line of `=` or `-` under a paragraph makes it a heading: `=` for the first level, `-` for the second.

## Links and images

- An inline link: [CommonMark](https://commonmark.org "The CommonMark specification").
- An autolink: <https://spec.commonmark.org/0.31.2/>.
- An e-mail autolink: <hello@example.org>.
- A link to another help page: [using the app](guide.md).

Images are written `![alt text](address)`. The reader never fetches an image named in prose, because opening a document must not reach the network. It shows a link instead: ![The Markdown2 icon](/icon.svg)

To show an image, embed it as a resource:

<<<ICON type="image/svg+xml" title="An embedded image"
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect x="6" y="6" width="52" height="52" rx="12" fill="#0f6b5f"/><circle cx="32" cy="32" r="12" fill="#b0802a"/></svg>
ICON

## Lists

- Bullet lists use `-`, `+` or `*`.
- Items can hold nested lists:
  - one level down
    - and another
- And back.

1. Ordered lists count from their first number.
2. Second.
3. Third.

A list can start anywhere:

7. This one starts at seven.
8. And carries on.

A loose list has blank lines between its items:

- Each item is then a paragraph.

- Like this one.

## Block quotes

> A quotation can hold any Markdown, **including formatting**.
>
> > Quotes nest, too.
>
> - and so do lists

## Code

Inline code: `const answer = 42;`

A fenced block, with a language name for highlighting:

```js
function greet(name) {
  return `Hello, ${name}!`;
}
```

An indented block, four spaces deep:

    $ m2 validate notes.md
    notes.md:1: missing-type [0]: Resource OOPS: missing-type

## Tables

| Feature          | Syntax          | Notes                    |
| :--------------- | :-------------: | -----------------------: |
| Emphasis         | `*text*`        | `_text_` works too       |
| Strong           | `**text**`      | `__text__` works too     |
| Strikethrough    | `~~text~~`      | A GitHub extension       |
| Links in a cell  | `[text](url)`   | [like this](resources.md) |
| A pipe in a cell | `a \| b`        | Escape it with `\|`      |

The second line sets the alignment of each column: `:---` left, `:---:` centred, `---:` right. Cells hold inline formatting, never blocks. A table ends at the first blank line.

## Thematic breaks

Three or more `*`, `-` or `_` on a line of their own draw a break:

***

## Raw HTML

Markdown2 never passes raw HTML through, so <b>this is not bold</b>. To embed HTML, declare it as a resource with its type, and the reader decides how to show it.

## Next

- [Resources and encodings](resources.md): what Markdown2 adds to Markdown.
- [Back to the welcome page](index.md)