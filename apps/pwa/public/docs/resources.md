---
title: Resources and encodings
---
# Resources and encodings

Every resource answers three questions:

- `type` says **what the bytes are**, as a media type such as `image/svg+xml`.
- `encoding` says **how to obtain them**, as a stack of decoders applied left to right.
- `rel` says **what the resource is to its document**: shown inline, metadata, an attachment and so on.

`title` and `filename` describe a resource, so a reader that cannot open it can still say what it is. They never change how it is decoded.

## Opacity

Once a resource begins, nothing inside it is interpreted until its terminator line. Backticks, headings and other `<<<` lines are just bytes:

<<<OPAQUE type="text/plain" title="Opaque payload"
```javascript
const x = "```";
```
## still not a heading
<<<OTHER type="text/plain"
OTHER
OPAQUE

## Types are authoritative

The reader never guesses a type from the bytes. Here is a JSON resource, pretty-printed by the JSON handler:

<<<DATA type="application/json" title="Some JSON"
{"format": "Markdown2", "draft": 0.2, "resources": ["typed", "opaque", "nested"]}
DATA

YAML is shown as text. It is never instantiated, so tags such as `!!python/object` are harmless:

<<<CONF type="application/yaml" title="Some YAML"
name: example
tags: [one, two]
danger: !!python/object:os.system ls
CONF

SVG is drawn only through an image, where scripts never run:

<<<LOGO type="image/svg+xml" title="A drawing"
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="28" fill="#0f6b5f"/><circle cx="32" cy="32" r="12" fill="#b0802a"/></svg>
LOGO

A type this reader has no handler for still has a defined representation. It is shown, never dropped:

<<<CAD type="model/x-acme-cad" title="Bracket drawing" filename="bracket.cad"
opaque bytes that only a CAD handler would understand
CAD

## Encodings

`base64` turns text into bytes. This payload decodes to a short greeting:

<<<HELLO type="text/plain" encoding="base64" title="Decoded from base64"
SGVsbG8sIHdvcmxkIQ==
HELLO

`gzip` decompresses. Compression is an encoding, not a type: a gzipped SVG is still an SVG. To make one, compress first, then base64-encode:

```text
gzip -c topology.svg | base64 -w 76
```

and declare the stack in decoding order, `base64` first:

```text
<<<TOPOLOGY type="image/svg+xml" encoding="base64 gzip" title="Network topology"
H4sIAAAAAAAAA+2YW2/bNhTH3/0pBL7…
TOPOLOGY
```

Decompression is checked while it runs, so a few kilobytes that would expand to gigabytes stop as soon as the size limit is reached.

A decoder this reader does not implement makes the resource `unsupported`. No earlier stage runs:

<<<ZST type="text/plain" encoding="base64 zstd" title="Compressed with zstd"
KLUv/QBYYQAA
ZST

Encryption (`age`) and remote retrieval (`uri`) are decoders too. They wait for you: see [locks, keys and remote resources](trust.md).

## Relationships

`rel="attachment"` presents a resource as something to save rather than to show:

<<<NOTES type="text/plain" rel="attachment" filename="notes.txt"
Meeting notes, carried with the document.
NOTES

`rel="alternate"` offers another representation of the resource before it. The reader shows at most one of the two. This reader cannot draw the first one, so it shows the alternative:

<<<FANCY type="image/x-fancy-vector" title="A format this reader cannot draw"
opaque vector data
FANCY
<<<FANCYTEXT type="text/plain" rel="alternate" title="Plain-text alternative"
Three boxes in a row, joined by arrows from left to right.
FANCYTEXT

`rel="describedby"` attaches a description to the resource before it, for example as alternative text for assistive technology:

<<<CHART type="image/svg+xml" title="Three bars"
<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80" viewBox="0 0 160 80"><rect x="10" y="60" width="30" height="20" fill="#b0802a"/><rect x="60" y="40" width="30" height="40" fill="#b0802a"/><rect x="110" y="20" width="30" height="60" fill="#b0802a"/></svg>
CHART
<<<CHARTDESC type="text/plain" rel="describedby"
Three bars of increasing height: 20, 40 and 60.
CHARTDESC

`rel="metadata"` is data about the document. The `---` block at the top of this page is shorthand for a YAML metadata resource. It is consumed, not displayed.

## Placement

Resources work inside list items and block quotes. Every line carries the container's prefix, and the prefix is stripped from the payload:

1. Install the agent.
2. Check the topology:

   <<<TOPO type="image/svg+xml" title="Topology"
   <svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><rect x="2" y="10" width="30" height="20" fill="none" stroke="#0f6b5f" stroke-width="2"/><line x1="32" y1="20" x2="88" y2="20" stroke="#b0802a" stroke-width="2"/><rect x="88" y="10" width="30" height="20" fill="none" stroke="#0f6b5f" stroke-width="2"/></svg>
   TOPO

3. Restart the service.

> A quotation can hold a resource too:
>
> <<<QUOTED type="text/plain" title="Inside a block quote"
> Quoted payload, with the prefix stripped.
> QUOTED

## Hiding from older previews

Binary payloads look like noise in ordinary Markdown previews. The compatibility wrapper hides a resource inside an HTML comment there, while Markdown2 still reads it:

<!--
<<<HIDDEN type="text/plain" title="Wrapped in a comment"
Ordinary Markdown previews hide this. Markdown2 shows it.
HIDDEN
-->

## Next

- [Back to the welcome page](index.md)
- Tour stop 4: [Locks, keys and remote resources](trust.md), why nothing unlocks or fetches on its own.