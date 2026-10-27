# [Markdown2](https://md2.cognotik.com/)

**Markdown, plus one idea:** you can embed opaque resources that declare their type and encoding, and those resources can nest inside each other.

This repository contains the Markdown2 specification and its reference implementation:

- **The specification:** [`idea.md`](idea.md), Working Draft 0.2.
- **The reference parser and handler runtime:** framework-free TypeScript packages that run in Node, Deno, Bun, workers and browsers.
- **The reader and editor:** an installable, offline-capable PWA.
- **The conformance suite:** language-neutral fixtures that any implementation can run.

The reference implementation is *a* realisation of the spec, not the spec. If the code and `idea.md` disagree, `idea.md` wins, and the disagreement is a bug. Ambiguities in the spec are logged in [`spec-issues.md`](spec-issues.md) rather than resolved silently in code.

## The format in one example

A resource starts with `<<<`, a terminator token you choose, and some attributes. It ends at the first line that holds just that token:

```text
<<<NOTE type="text/plain" title="A note"
Anything at all stays opaque here.
# This is not a heading, and ``` is not a fence.
NOTE
```

Every resource answers three questions:

| Attribute  | Question                              | Example              |
|------------|---------------------------------------|----------------------|
| `type`     | What are these bytes?                 | `image/svg+xml`      |
| `encoding` | How do I obtain them?                 | `base64 gzip`        |
| `rel`      | What is this to its parent document?  | `attachment`         |

Attachments, embedded images, compressed assets, diagrams, remote resources, frontmatter, nested documents and encrypted sections all follow from this one primitive. None of them is new syntax:

```text
<<<VAULT type="text/markdown" encoding="base64 age" title="Q3 notes"
YWdlLWVuY3J5cHRpb24ub3JnL3YxCi0+IHNjcnlwdCBk…
VAULT
```

A few rules hold everywhere:

- **Opacity.** Nothing inside a resource is interpreted until its terminator. Nothing needs escaping.
- **No sniffing.** The declared type is authoritative. `image/jpg` is not `image/jpeg`.
- **Fail closed.** A malformed, unterminated or undecodable resource becomes a `failed` node. Its bytes never leak into the prose.
- **No implicit authority.** Opening a document never grants network, filesystem or key access. Encrypted and `uri` resources stay `locked` until the user acts.
- **Graceful degradation.** Older Markdown readers see legible text. Unsupported resources are shown, never dropped.

Read [`idea.md`](idea.md) for the full specification, or open the PWA for a live tour.

## Repository layout

```text
markdown2/
├─ packages/
│  ├─ core/                 types, limits, static state precedence, tree serialiser
│  ├─ micromark-extension/  resource construct, commitment, frontmatter, wrapper
│  ├─ mdast/                from/to mdast, node identity
│  ├─ parser/               public parse() API
│  ├─ decoders/             utf-8, base64, gzip, uri, age; pipeline; quotas
│  ├─ runtime/              handler registry, grants, recursive render, fallback
│  ├─ handlers/             images, SVG, Markdown, JSON, YAML, math, Mermaid, …
│  ├─ codemirror/           editor language support
│  ├─ conformance/          fixtures, JSON Schema, runner
│  └─ cli/                  the m2 command
├─ apps/
│  └─ pwa/                  Vite + Preact reader and editor
├─ docs/                    architecture, ADRs, API reference
├─ idea.md                  the specification, Draft 0.2
├─ plan.md                  the implementation plan
└─ spec-issues.md           ambiguities found during implementation
```

Dependencies point one way only, from `core` up to the app and CLI. The `core`, `parser` and `decoders` packages have no DOM dependency.

## Getting started

Requirements: **Node 22 LTS** and **pnpm 9**.

```bash
pnpm install
pnpm build        # build every package and the app
pnpm test         # unit tests and the conformance suite
```

To work on the PWA:

```bash
pnpm --filter pwa dev
```

End-to-end tests run in Chromium, Firefox and WebKit through Playwright:

```bash
pnpm exec playwright install
pnpm --filter pwa test:e2e
```

## Using the parser

```ts
import { parse } from '@markdown2/parser';

const doc = parse(source);

for (const node of doc.resources) {
  console.log(node.id, node.resource.type, node.structuralError ?? 'ok');
}
```

Parsing never runs a decoder. Decode state is computed separately, in two steps:

- `staticState()` from `@markdown2/core` applies steps 1–3 of the spec's state precedence (structural error, unknown decoder, unmet capability) without touching the payload.
- `@markdown2/decoders` runs the streaming pipeline for runnable resources, with byte quotas enforced while each stage produces output.

Handler selection is an exact lookup on the declared type, keyed by capability × media type.

## The command line

The `m2` CLI parses, validates and dumps trees:

```bash
m2 parse notes.md       # print the parse tree
m2 validate notes.md    # report structural errors and diagnostics
m2 tree notes.md        # print the normalised conformance tree as JSON
m2 render notes.md      # render to HTML
```

Diagnostics name the line, the error code and the resource:

```text
notes.md:1: missing-type [0]: Resource OOPS: missing-type
```

`m2 render` is also the reference for server-side `uri` resolution. It refuses loopback, link-local and private addresses, and re-checks after every redirect.

## The reader and editor

The PWA is a reader and editor for Markdown2 documents. It works offline, installs as an app and can open `.md` files from the operating system.

- **Layouts:** Write (Ctrl+1), Split (Ctrl+2) with live preview, and Read (Ctrl+3).
- **Inspector** (Ctrl+.): diagnostics with jump-to-source, every resource with its true state, and style choices. It sits outside the page, so no document can fake or hide it.
- **Locks:** encrypted and remote resources show a sealed card until you choose *Unlock…*. Keys live in the tab's memory only. **Forget keys** clears them all.
- **Remote policy:** `uri` resources are locked for every scheme by default. Only you can add sites to the allow list.
- **Safe saving:** resources save as `.bin` by default. An active extension such as `.html` needs your confirmation.
- **Opening by URL:** `/?url=/docs/styles.md` opens a document. Other `https:` origins ask first and send no cookies. Documents opened this way are never autosaved over your draft.

Handlers that run third-party code, such as Mermaid, the code viewer, charts and embedded pages, run in sandboxed frames with an opaque origin. SVG is drawn only through `<img>`, and maths is rendered as an inert image.

The built-in help is itself a set of Markdown2 documents, in [`apps/pwa/public/docs/`](apps/pwa/public/docs/). Start with [`index.md`](apps/pwa/public/docs/index.md).

### Reader extensions

Some features of the PWA go beyond the spec and are deliberately not part of the format:

- **Document styles.** Resources with `type="text/css"` and `rel="stylesheet"`, grouped with `md2-group`, `md2-default` and `md2-class`. The spec defines no `stylesheet` relationship (§10), so these are vendor conventions. Styles are scoped to their own document, cannot fetch, and can be switched off with **Ctrl+Shift+U**.
- **Fence aliases.** Fenced `mermaid`, `math` and language-named code blocks select handlers as compatibility aliases (§7.2). They never change the parse tree.
- **Extra handlers.** `text/uri-list` embeds and `application/vnd.google.charts+json` charts. Both wait for permission before reaching the network.

A document that relies on them still reads correctly in any other Markdown2 reader.

## Conformance

The conformance suite in [`packages/conformance`](packages/conformance) covers categories A–H of §12 of the spec. Each case is:

- a source document, `*.md`
- an expected normalised tree, `*.tree.json`, valid against the published JSON Schema

The fixtures are language-neutral. Implementations in other languages can run them without any code from this repository. A conforming parser must pass every case in categories A–E, G and H. Category F is informative.

Every MUST and SHOULD in the spec has a requirement ID, such as `R-4.1-commit`. [`docs/traceability.md`](docs/traceability.md) maps each ID to its tests, and CI fails if a MUST has none.

## Security

The security model follows §11 of the spec. In particular:

- No rendering path leads from a failed, locked or unsupported payload to prose HTML. Property-based tests enforce this.
- Encryption decoders never run without a user action. Grants are scoped to a node and its payload digest, and never propagate to children.
- Byte quotas are enforced while bytes are produced, so a gzip bomb is aborted mid-stream.
- YAML is loaded with a safe schema and never instantiates tags.
- The PWA ships with a strict CSP, Trusted Types and COOP `same-origin`.

Browsers cannot see IP addresses during `fetch`, so the SSRF rules apply to the CLI and server-side renderers. The PWA relies on locked-by-default resources, user policy, CORS and CSP `connect-src`.

Please report vulnerabilities privately to the maintainers rather than in a public issue.

## Status

This is an implementation of **Working Draft 0.2**. The format may still change. See [`plan.md`](plan.md) for milestones and scope.

Out of scope for 0.2:

- the Viewer API companion specification (a pragmatic subset is implemented internally)
- decoder profiles beyond `age`, such as `gpg`, `zstd` and `br`
- same-document references, deferred by the spec
- collaborative editing and sync

## Contributing

- Behaviour is defined by the spec. A change in behaviour starts with a reference to the section it implements.
- If the spec is ambiguous, add an entry to `spec-issues.md`, choose the most fail-closed reading, mark the code with the issue ID and add a fixture.
- Every change needs passing tests on Node and all three browser engines, an updated traceability table where relevant, and a changeset.
- No new `any`, and no ESLint or type errors.