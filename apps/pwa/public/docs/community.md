---
title: Join the community
---
# Join the community

Markdown2 is an open project: a small specification, a reference implementation and this reader. All of it lives on GitHub:

**[github.com/SimiaCryptus/Markdown2](https://github.com/SimiaCryptus/Markdown2)**

The **GitHub** button in the toolbar and the **Help** menu take you there too.

## Ways to help

- **Star the repository**, so others can find it.
- **Try it on your own documents**, and tell us where it falls short.
- **[Report a bug](https://github.com/SimiaCryptus/Markdown2/issues/new/choose)**. A short document that shows the problem helps most. Use *Save* to attach one.
- **Question the specification.** The draft (`idea.md`) and its open questions (`spec-issues.md`) are in the repository. If a rule is unclear, or two readers could disagree, that is a bug in the spec.
- **Write a handler.** Handlers are small: bytes in, a view out. CSV grids, Mermaid diagrams and maths all started that way.
- **Implement Markdown2 in another language.** The conformance fixtures in `packages/core/test/fixtures` are language-neutral: a source document and its expected tree.

## Principles we keep

Contributions are measured against the design principles of the spec:

<<<PRINCIPLES type="text/csv" title="Principles"
Principle,In one line
One primitive,"Typed, opaque, nestable resources; everything else is a handler or a convention"
Declarations are authoritative,"A resource is exactly the type it claims to be; nothing is sniffed"
Decoding may require agency,"Opening a document grants nothing: no network, no files, no keys"
Graceful degradation,"Old readers see text; unsupported resources are shown, not dropped"
Failure is closed,"A broken resource never leaks its bytes into the prose"
Implementable from the spec,"Anyone can build a correct reader from the document alone"
PRINCIPLES

## Next

- [Back to the welcome page](index.md)
- [Data tables](tables.md), the newest handler.