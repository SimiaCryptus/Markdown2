# Markdown2 Style Sheets

*Companion specification, working draft 0.1*

## 1. Summary

Markdown2 Style Sheets (M2SS) lets Markdown2 documents and readers be styled with ordinary CSS.

It adds no new styling language. It formalises the three things that CSS written for Markdown has always had to guess:

1. **The styling tree.** Which elements, attributes and nesting a rendered document produces, so that selectors mean the same thing in every reader.
2. **Document-suggested stylesheets.** How a document offers stylesheets that are always applied, stylesheets the reader picks one of, and stylesheets the reader switches on or off.
3. **Reader control.** How the viewer overrides, disables or replaces document styles, and how it applies its own preferred stylesheets globally.

A document needs no styling to be read. Every rule in this specification is presentation only and never changes the parse tree, the decode state or the meaning of a resource.

The key words MUST, MUST NOT, REQUIRED, SHOULD, SHOULD NOT, RECOMMENDED, MAY and OPTIONAL are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when, and only when, they appear in all capitals.

## 2. Relationship to the Core Specification

Markdown2 core §10 excludes a `stylesheet` relationship from its baseline because styling would make the core format a layout system. M2SS respects that boundary:

- M2SS is a **companion specification** (core §9). A reader can conform to Markdown2 without implementing it.
- M2SS adds **no syntax**. Stylesheets are ordinary resources (`type="text/css"`), and author hooks are ordinary extension attributes.
- M2SS defines the `stylesheet` relationship token and the `md2-` attribute namespace. Both are reserved for Markdown2 companion specifications.

**Open issue for core.** Core Appendix A.1 renders unknown `rel` tokens as `inline`. A core reader that does not implement M2SS would therefore show each stylesheet as a `text/css` fallback stub. The next core draft should list `stylesheet` in A.1 with the meaning: *presentation for the parent document; readers that do not apply it SHOULD NOT render it inline.* Until then, authors SHOULD use the compatibility wrapper (core §7.1) for stylesheets and accept that core-only readers show a stub.

## 3. Design Principles

1. **CSS, unchanged.** Selectors, the cascade, media queries and properties are the CSS that already exists. M2SS defines the tree CSS applies to, not a dialect.
2. **Presentation, never semantics.** Removing every stylesheet leaves a complete, correct document.
3. **The document suggests; the reader decides.** Document stylesheets are proposals. The viewer may accept, override, replace or ignore them.
4. **Styles cannot escape the document.** Document CSS cannot fetch, cannot script, and cannot reach or imitate reader chrome.
5. **Hidden is not secret.** CSS can hide content from view, but it does not protect content. Confidentiality is the job of encryption decoders (core §5.4).

## 4. The Styling Tree

Readers that apply CSS MUST style a tree equivalent to the one defined in this section. They may render into an HTML DOM, a native view hierarchy or anything else, provided selectors match as if they styled this tree.

### 4.1 Base: CommonMark HTML

For ordinary Markdown, the styling tree is the HTML rendering shown in the CommonMark 0.31.2 specification examples. This includes:

| Construct              | Element(s)                                                                    |
|------------------------|-------------------------------------------------------------------------------|
| ATX / setext heading   | `h1` … `h6`                                                                   |
| Paragraph              | `p`                                                                           |
| Block quote            | `blockquote`                                                                  |
| Bullet / ordered list  | `ul` / `ol`, with `start` when the list does not begin at 1                   |
| List item              | `li`. Tight lists omit the `p` wrapper, exactly as CommonMark renders them.   |
| Fenced / indented code | `pre > code`. A fence info string's first word `x` gives `class="language-x"`.|
| Thematic break         | `hr`                                                                          |
| Emphasis / strong      | `em` / `strong`                                                               |
| Code span              | `code`                                                                        |
| Link                   | `a` with `href` and optional `title`                                          |
| Image                  | `img` with `src`, `alt` and optional `title`                                  |
| Hard line break        | `br`                                                                          |

Raw HTML is part of the styling tree only if the reader's HTML policy renders it. M2SS makes no promise about raw HTML.

Syntax extensions that a reader supports (for example GFM tables) SHOULD use their own established HTML rendering.

Compatibility aliases (core §7.2) do not change the tree. An aliased fence is still `pre > code.language-mermaid`, whatever its handler draws inside it.

### 4.2 Markdown2 Additions

M2SS adds four element names. All contain a hyphen, so they are valid HTML custom element names and never collide with HTML.

#### `md2-document`

The root of every rendered `text/markdown` resource, including the top-level document.

- The top-level `md2-document` matches `:root` for document stylesheets.
- A nested document appears as the child of its `md2-resource` (§4.2, `md2-resource`).

#### `md2-section`

Markdown has no sections, but CSS authors constantly need "the part under this heading". M2SS derives sections mechanically:

- Each heading that is a **direct child** of an `md2-document` starts an `md2-section` with attribute `level="n"`, where `n` is the heading level.
- The section contains the heading and every following sibling up to, but not including, the next heading of the same or a smaller level, or the end of the `md2-document`.
- Sections nest: an `h3` section sits inside the preceding `h2` section.
- Headings inside block quotes, list items or other containers never start sections.
- Content before the first heading is not inside any section.

````text
md2-document
 ├─ p                       ; before the first heading
 ├─ md2-section level="1"
 │   ├─ h1
 │   ├─ p
 │   └─ md2-section level="2"
 │       ├─ h2
 │       └─ ul
 └─ md2-section level="1"
     └─ h1
````

Sections are part of the styling tree only. They are not part of the Markdown2 parse tree and carry no semantics.

#### `md2-resource`

Every resource node (core §3.2) appears as an `md2-resource` element at its position in the tree, including resources inside list items and block quotes.

| Attribute  | Value                                                                                   |
|------------|-----------------------------------------------------------------------------------------|
| `type`     | The `type` attribute exactly as written, parameters included.                           |
| `essence`  | The media type without parameters, ASCII-lowercased, e.g. `image/svg+xml`.              |
| `encoding` | The decoder stack as written. Absent when the default applied.                          |
| `rel`      | The relationship token. `inline` when absent in the source.                             |
| `state`    | `decoded`, `locked`, `unsupported` or `failed` (core §5.5).                             |
| `error`    | The error code when there is one, e.g. `unterminated-resource`.                         |
| `title`    | The `title` attribute, if present.                                                      |
| `filename` | The `filename` attribute, if present.                                                   |
| `class`    | The value of the `md2-class` attribute (§4.3), if present.                              |

`type` is case-sensitive as written. Authors who want case-insensitive matching use `essence`, or the CSS `i` flag.

An `md2-resource` has exactly one child:

- an `md2-document`, when the resource is a `decoded` `text/markdown` resource
- an `md2-view`, when another handler renders the resource
- an `md2-fallback`, otherwise (core §6.2)

Attributes update when state changes. Unlocking a resource changes `state` and replaces `md2-fallback` with the rendered child, and styles re-apply as for any DOM change.

#### `md2-view` and `md2-fallback`

`md2-view` is the box a handler draws into. Its interior belongs to the handler and is not part of this contract. Handlers SHOULD size themselves to the `md2-view` box so that authors can constrain them, for example with `max-height`.

`md2-fallback` is the stub for a resource that has no rendered view. It contains, in order:

- `md2-label`: the `title`, else the `filename`, else empty
- `md2-detail`: type, encoding, state, error and size, as text chosen by the reader

### 4.3 Author Hooks: `md2-class`

Markdown has no way to put a class on a paragraph, and M2SS does not add one. The hook is the existing primitive: any resource may carry `md2-class`, a space-separated list of class names, which becomes the `class` of its `md2-resource`.

To style a stretch of prose, wrap it in a nested document:

````text
<<<DETAILS type="text/markdown" md2-class="details"
## Methodology

Revenue figures are taken from the audited ledger…
DETAILS
````

This matches `md2-resource.details > md2-document`.

Class names are author vocabulary. M2SS defines no class names and readers MUST NOT give any class name built-in meaning.

## 5. Document Stylesheets

### 5.1 Declaring a Stylesheet

A stylesheet is a resource with `rel="stylesheet"`:

````text
<<<STYLE type="text/css" rel="stylesheet"
md2-section[level="2"] { margin-block-start: 2em; }
STYLE
````

- Its `type` MUST have essence `text/css`. A `stylesheet` node of any other type is not applied, and the reader SHOULD emit a diagnostic.
- It is applied only in the `decoded` state. A `locked` stylesheet, whether encrypted or `encoding="uri"`, is not applied until it is decoded. Granting it follows core §5.5 like any other resource.
- It is never rendered inline. The UA stylesheet (Appendix A) hides it, and readers SHOULD list it in their style controls instead.
- It may appear anywhere in its document. Its position affects only cascade order (§5.4).

| Attribute     | Meaning                                                                                |
|---------------|----------------------------------------------------------------------------------------|
| `title`       | Label shown in the reader's style controls. REQUIRED for members of a group.           |
| `md2-group`   | Name of the group the stylesheet belongs to (§5.2). Absent means persistent.           |
| `md2-default` | `on` or `off`. Initial state within the group (§5.2).                                  |
| `md2-media`   | A CSS media query list. The sheet applies only while the query matches.                |

### 5.2 Persistent, Alternative and Toggle Stylesheets

The kind of a stylesheet follows from its group.

**Persistent.** A stylesheet with no `md2-group` is applied whenever document styles are enabled. Several persistent stylesheets stack.

**Alternatives.** Two or more stylesheets with the same `md2-group` form a selector. Exactly one member is applied at a time.

- The initially selected member is the first with `md2-default="on"`, or else the first in document order.
- The reader presents the group name as the selector's label and each member's `title` as an option.
- Authors who want a "none" option include an empty stylesheet with a title such as `Plain`.

**Toggle.** A group with exactly one member is a switch.

- It is on initially unless it has `md2-default="off"`.
- The reader presents it as an on/off control labelled with the group name.

A group of one is a toggle, and a group of many is a choice. No further syntax exists.

Group names are compared as exact strings within one `md2-document`. `md2-default` values other than `on` or `off` are ignored, with a diagnostic.

### 5.3 Scope

- A stylesheet applies to the `md2-document` that is its parent, as if its rules were wrapped in `@scope` rooted at that element. Its rules reach into nested documents below it, as CSS normally would.
- A stylesheet inside a nested document applies only within that nested `md2-document`. It can never match its ancestors or siblings.

**Rationale.** An encrypted or third-party nested document must not be able to restyle the document that contains it, for example to hide a warning or relabel a locked resource. Scoping makes this impossible by construction.

Groups declared in nested documents are offered by the reader as well, grouped under the nested resource's title.

### 5.4 Cascade Order

Applied document stylesheets are author-origin stylesheets. Among themselves they cascade in **document order**, pre-order through the tree, regardless of whether a sheet is persistent, selected or toggled. Changing a selection never reorders sheets.

## 6. Reader Control

The viewer is the user's agent. Its choices always outrank the document's suggestions.

### 6.1 Origins

M2SS maps onto the three CSS cascade origins without change:

| CSS origin   | M2SS source                                                         |
|--------------|---------------------------------------------------------------------|
| user-agent   | The reader's baseline, including Appendix A.                        |
| user         | Viewer-level stylesheets and preferences (§6.2).                    |
| author       | Document stylesheets (§5).                                          |

Ordinary CSS precedence follows: author rules beat user rules, and user `!important` beats author `!important`.

### 6.2 Required Controls

A reader that applies document stylesheets MUST let the user:

- **disable document styles**, for one document and globally, leaving the UA and user origins only
- **override every selection**: choose any member of any alternatives group and flip any toggle, whatever `md2-default` says

A reader SHOULD let the user:

- **install global stylesheets** in the user origin, stacked in a user-chosen order and applied to every document
- **define global alternatives and toggles** using the same model as §5.2, for example a viewer-wide `Theme` choice of `Light`, `Dark` and `Sepia`
- **remember preferences by name**: "when a document offers group `G`, select the member titled `T`" or "always switch `Summary mode` on". Matching is by exact group name and title. Documents that share vocabulary therefore share preferences without any registry.
- **always reach an unstyled view** with one command, wherever document styles might obscure content

Preferences learned from one document MUST NOT be applied silently to a different document under any other name.

## 7. Example: Summary Mode

A report that collapses its detail for a quick read, offered as a toggle and a theme choice:

````text
---
title: Q3 Report
---

<!--
<<<BASE type="text/css" rel="stylesheet"
md2-resource.chart md2-view { max-height: 24em; }
BASE
-->

<!--
<<<SUMMARY type="text/css" rel="stylesheet" md2-group="Summary mode" title="Summary mode" md2-default="off"
md2-resource.details { display: none; }
md2-resource.chart md2-view { max-height: 8em; }
SUMMARY
-->

<!--
<<<LIGHT type="text/css" rel="stylesheet" md2-group="Theme" title="Light" md2-default="on"
:root { color: #222; background: #fff; }
LIGHT
-->

<!--
<<<DARK type="text/css" rel="stylesheet" md2-group="Theme" title="Dark"
:root { color: #ddd; background: #181818; }
DARK
-->

# Q3 Report

Revenue grew 12% quarter on quarter.

<<<REV type="image/svg+xml" encoding="base64 gzip" md2-class="chart" title="Revenue by region"
H4sIAAAAAAAAA+2YW2/bNhTH3/0pBL7…
REV

<<<DETAILS type="text/markdown" md2-class="details"
## Methodology

Figures are taken from the audited ledger…
DETAILS
````

The reader offers a `Summary mode` switch, off by default, and a `Theme` selector with `Light` and `Dark`. With summary mode on, the methodology disappears and the chart shrinks. A reader without style support still shows every word.

## 8. CSS Profile and Security

Document stylesheets are untrusted input. Readers MUST apply the following restrictions to the author origin. They MAY relax them for the user origin.

### 8.1 No Fetching

- `@import` rules MUST be ignored.
- `url()` references, including those in `@font-face` `src`, MUST NOT be fetched, except `data:` URLs.
- Bytes of `data:` URLs count toward the document's decoded-size quota (core §6.3).

**Rationale.** Fetching would bypass the `uri` capability gate (core §5.5). It would also enable CSS exfiltration, where attribute selectors trigger requests that leak content one character at a time. Stylesheets that need remote assets use `encoding="uri"` on the stylesheet itself and go through reader policy.

### 8.2 Containment

- Document styles MUST be confined to the document's rendering surface. Selectors MUST NOT match reader chrome.
- Readers MUST establish containment on the top-level `md2-document` such that fixed and absolute positioning, overflow and painting cannot extend past the surface. `contain: layout paint` or an equivalent achieves this.
- Script-bearing or legacy extension properties MUST NOT have effect.

### 8.3 Trust Indicators

CSS can draw anything inside the surface, including a fake lock icon or a fake "decoded" badge. Therefore:

- Capability prompts, grant controls and any indication of a resource's true decode state that the user relies on for a security decision MUST be presented in reader chrome, outside the styled surface.
- The UA stylesheet's rules that keep `md2-fallback` visible use `!important`. Readers MAY additionally enforce them through the user origin.

### 8.4 Hidden Is Not Secret

`display: none` hides content from view, from most assistive technology and from printing. The content is still in the file, in the parse tree and in every reader that ignores the stylesheet.

Authors MUST NOT use styling to withhold information. Use an encryption decoder.

### 8.5 Accessibility

- Readers SHOULD expose the selected alternatives and toggles to assistive technology as ordinary controls.
- Document styles that suppress focus outlines or reduce contrast are the author's responsibility. The user's ability to disable document styles (§6.2) is the remedy.
- Authors SHOULD respect `prefers-color-scheme`, `prefers-reduced-motion` and `prefers-contrast` media features.

## 9. Degradation

| Reader                         | Behaviour                                                                                 |
|--------------------------------|-------------------------------------------------------------------------------------------|
| CommonMark only                | Wrapped stylesheets are hidden as HTML comments. Unwrapped ones appear as text.           |
| Markdown2 core, no M2SS        | Stylesheets appear as `text/css` fallback stubs until core adopts §2's amendment.         |
| Markdown2 with M2SS            | Stylesheets applied as specified.                                                         |
| Any reader, styles disabled    | The complete document, unstyled.                                                          |

Authors SHOULD wrap stylesheets in the compatibility wrapper (core §7.1). CSS rarely contains `-->`, but authors must check, exactly as for other text payloads.

## 10. Compatibility Test Suite (Outline)

**S. Styling tree**

1. CommonMark fixtures produce the CommonMark reference HTML, wrapped in `md2-document`.
2. Sections: `h1 p h2 p h1` produces two level-1 sections, the first containing one level-2 section.
3. A heading inside a block quote does not start a section.
4. Every resource state produces the matching `state` attribute. Unlocking updates it.
5. `type='text/plain; charset="utf-8"'` gives `essence="text/plain"`.
6. `md2-class="a b"` matches `.a` and `.b`.
7. A decoded nested `text/markdown` resource has `md2-document` as its only child.

**T. Stylesheets**

1. Persistent sheets stack in document order.
2. A two-member group applies exactly one member, honouring `md2-default="on"`.
3. A one-member group with `md2-default="off"` is not applied until toggled.
4. A `locked` stylesheet is not applied.
5. A `rel="stylesheet"` resource with `type="text/plain"` is not applied and yields a diagnostic.
6. A stylesheet in a nested document cannot match elements outside that document.
7. `md2-media="print"` applies only to print.

**U. Reader control**

1. Disabling document styles leaves the UA and user origins only.
2. A user selection overrides `md2-default`.
3. A remembered preference applies to a second document offering the same group name and title.

**V. Security**

1. `@import` is ignored and produces no network request.
2. `background: url(https://…)` produces no network request. A `data:` URL renders.
3. `position: fixed` content cannot paint outside the document surface.
4. A document stylesheet cannot hide an `md2-fallback` for a `locked` resource.

## 11. References

Normative:

- Markdown2 core specification, working draft 0.2
- CommonMark Spec, version 0.31.2
- CSS Cascading and Inheritance Level 6 (cascade origins, `@scope`)
- Selectors Level 4
- Media Queries Level 4
- CSS Containment Module Level 2
- BCP 14: RFC 2119 and RFC 8174

Informative:

- HTML Living Standard, alternate style sheets and custom element names
- RFC 2397, the `data:` URL scheme

## Appendix A. UA Baseline Stylesheet

Readers MUST apply the equivalent of these rules in the user-agent origin. They MAY add further rules.

```css
md2-document,
md2-section,
md2-resource,
md2-view,
md2-fallback { display: block; }

md2-resource[rel="metadata"],
md2-resource[rel="stylesheet"] { display: none; }

md2-fallback {
  display: block !important;
  visibility: visible !important;
  opacity: 1 !important;
  border: 1px solid;
  padding: 0.5em 0.75em;
}

md2-label  { display: inline; font-weight: bold; }
md2-detail { display: block; font-size: 0.875em; }
```

---

*In one sentence:* M2SS is plain CSS over a fixed, documented tree, with stylesheets that are ordinary resources the document can offer as stacked, alternative or on/off, and that the reader can always override.