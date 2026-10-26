# Markdown2: A Specification for Typed, Recursively Composable Markdown

*Working draft 0.2*

## 1. Summary

Markdown2 is Markdown plus one new idea: you can embed opaque resources that declare their type and encoding, and those resources can nest inside each other.

Readers may provide **handlers** for resource types and **decoders** for encodings. A resource the reader cannot handle still has a defined representation, and it never prevents the rest of the document from being read.

That is the whole format. Many apparent features fall out of this one primitive rather than being added as new syntax:

- attachments
- embedded images
- compressed assets
- diagrams
- remote resources
- frontmatter
- nested documents
- encrypted sections, including sections encrypted to more than one key

The design goal is a spec small enough that someone can implement it correctly from this document alone, in any language, without the reference implementation.

**Status of this draft.** Draft 0.2 keeps the primitive of draft 0.1 unchanged. Draft 0.1 was reviewed from seven perspectives: technical, implementer, security, user experience, compatibility, authoring and standards.

The reviews agreed closely on two things: that the core model is right, and where the draft was wrong. The remaining disagreements were competing priorities, such as security against convenience, rather than competing readings of the text.

This revision therefore concentrates on four areas:

- parser determinism
- failure behaviour
- security
- the few places where draft 0.1 contradicted itself

Where a tension between priorities touches the text, the resolution and its rationale appear next to the rule they affect.

The key words MUST, MUST NOT, REQUIRED, SHOULD, SHOULD NOT, RECOMMENDED, MAY and OPTIONAL are to be interpreted as described in BCP 14 (RFC 2119, RFC 8174) when, and only when, they appear in all capitals. Normative references are listed in §13.

## 2. Design Principles

1. **One primitive.** Markdown2 defines typed composition, not new kinds of documents.
2. **Opacity.** Once a resource begins, its contents are uninterpreted until its terminator matches. Nothing needs escaping, counting or recursive lexing.

   This is the one deliberately rigid part of the format. A self-chosen, exact terminator gives three guarantees:
   - authors can paste any existing serialisation in unchanged
   - parsers can slice payloads without copying
   - two parsers have no room to disagree about where a resource ends
3. **Separation of concerns.**
   - `type` answers *what are these bytes?*
   - `encoding` answers *how do I obtain these bytes?* This covers transfer encoding, compression, encryption and retrieval.
   - `rel` answers *what is this to its parent?*
   - Everything else belongs to decoders, handlers or conventions.
4. **Declarations are authoritative.** A resource is exactly the type it claims to be. Readers never sniff content.
5. **Decoding may require user agency.** Opening a document does not grant permission to decode everything it contains.
6. **Graceful degradation.**
   - Old readers see legible text.
   - New readers render old documents normally.
   - Unsupported resources are shown, not dropped.
7. **Failure is closed.** A resource that cannot be parsed or decoded is shown as a resource in a failed state. Its bytes never leak into the prose.
8. **The format is not a platform.** Viewers, editors, registries and security UX are specified separately, if at all.

## 3. Data Model

### 3.1 Resource

```text
Resource {
    type       : media type        ; e.g. image/png, text/markdown
    encoding   : [decoder-id, ...] ; ordered decoder stack, possibly empty
    payload    : bytes             ; the literal content as written
    attributes : {name → value}    ; title, filename, extension attributes
}
```

Decoding is a pipeline. Every stage runs under a byte quota (§6.3):

```text
payload
  → decoder[0]
  → decoder[1]
  → …
  → typed bytes
  → handler(type)
  → view
```

### 3.2 Node

A resource appears in a document through a **node**. The node carries the relationship between parent and child. That relationship is never a property of the resource itself.

```text
Node {
    rel?      : relationship token ; e.g. metadata
    resource  : Resource
}
```

**Rationale.** The same JSON object may serve as document metadata, displayed data, form state or chart input. It is the same typed object in each case. Only its relationship to the parent document differs.

Keeping `rel` off the resource avoids the classic MIME mistake of inventing semantic types such as `application/x-markdown2-frontmatter+yaml`.

A node without `rel` is `inline`: it is rendered where it appears.

A small baseline of `rel` tokens is defined in Appendix A, so that independent implementations agree from the first day. Other tokens are vendor-namespaced.

### 3.3 Document

A Markdown2 file is itself a resource with implicit attributes:

```text
type     = text/markdown
encoding = [utf-8]
```

The `text/markdown` handler is the Markdown2 renderer. A nested `text/markdown` resource is therefore rendered by invoking the same handler again.

Nesting is **composition, not grammar recursion**. The container syntax never needs to know that recursion occurred.

```text
Markdown2 document
 ├─ metadata (application/yaml)
 ├─ prose
 ├─ image/jpeg
 ├─ text/markdown
 │    ├─ metadata
 │    └─ text/markdown (encrypted)
 │         ├─ metadata
 │         ├─ application/json
 │         └─ …
 └─ prose
```

## 4. Syntax

### 4.1 Resource Blocks

A resource block uses a heredoc-style opener. **The opener chooses its own terminator.**

```text
<<<TOKEN type="media/type" encoding="dec1 dec2" rel="relationship"
…payload…
TOKEN
```

Example:

````text
<<<SECTION type="text/markdown"
# A nested document

```javascript
const x = "```";
```

Anything at all may appear here, including other resource blocks
with different terminators.
SECTION
````

#### Opener rules

- The opener begins with the literal `<<<` at the start of a block's content:
  - at top level, column 0 of a line
  - inside a list item or block quote, the container's content position (see *Placement*)
- `<<<` is immediately followed by a **terminator token** matching `[A-Za-z_][A-Za-z0-9_.-]*`.
- Zero or more **attributes** follow the token. Each attribute is separated by one or more spaces or tabs and has the form `name="value"` or `name='value'`.
  - A value may not contain its own quote character or a line break.
  - A double-quoted value may contain `'`, and a single-quoted value may contain `"`.
  - Quoting rules let media type parameters with quoted strings (RFC 2045) be written directly: `type='text/plain; charset="utf-8"'`.
  - Attribute names are case-insensitive.
  - Repeating an attribute name is an error.
- The opener ends at the first line terminator (LF or CRLF).

#### Commitment

The first part of the line alone decides recognition. A line is an opener if it begins with `<<<`, followed by a valid token, followed by a space, a tab or a line terminator. Such a line **commits** the parser to scanning for that token.

Commitment holds even when the rest of the line is malformed, for example because of:

- a missing `type`
- a duplicate attribute
- an unclosed quote
- stray text after the token

A malformed opener still produces a resource node in the `failed` state (§5.5), and its payload is still opaque.

Without this rule, a typo in an attribute would turn an opaque payload back into Markdown. That is exactly the failure the terminator exists to prevent.

A line beginning `<<<` that is not followed by a valid token is ordinary text. Examples are `<<< X` and `<<<9X`.

#### Attributes

| Attribute  | Required | Meaning                                                                      |
|------------|----------|------------------------------------------------------------------------------|
| `type`     | yes      | Media type of the fully decoded bytes, with optional parameters.             |
| `encoding` | no       | Space-separated decoder stack (§5). Default: `utf-8`.                        |
| `rel`      | no       | Relationship of this node to its parent (§3.2, Appendix A).                  |
| `title`    | no       | Human-readable label, shown in particular by locked and fallback stubs.      |
| `filename` | no       | Suggested name when the resource is saved, subject to §6.2.                  |

`title` and `filename` are descriptive only. They MUST NOT influence decoding or handler selection, and they are as untrusted as the rest of the document.

They exist so that a resource the reader cannot open can still say what it is. `🔒 Q3_Financials.pdf` tells a reader far more than `🔒 encrypted application/pdf`.

Unknown attributes are preserved in the parse tree and otherwise ignored. Core attribute names never contain `-`.

Extension attributes use a vendor-namespaced form, `vendor-name`, for example `acme-thumbnail`. This follows the advice of RFC 6648 against `x-` prefixes, and draft 0.1's reservation of `x-` is withdrawn. An `x-` attribute is now simply an extension attribute whose vendor is `x`.

#### Terminator rules

- The closer is the first subsequent line whose content matches the token exactly, optionally followed by spaces or tabs. The line terminator is excluded, as is any container prefix (see *Placement*).
- Matching is byte-exact and case-sensitive. Leading whitespace prevents a match. Trailing spaces and tabs do not.
- **Nothing between opener and closer is interpreted while searching for the closer.** This includes Markdown, fences, indentation and other `<<<` lines.

**Rationale for trailing whitespace.** In draft 0.1, trailing whitespace prevented a match. Editors add and strip invisible trailing spaces unpredictably, so a single stray space after `TOKEN` would silently swallow the rest of the document.

Tolerating trailing horizontal whitespace costs nothing in opacity. The payload still cannot contain a line that is the bare token, give or take invisible padding. Authors who need such a line choose a different token.

#### Unterminated blocks

A block is **unterminated** in either of two cases:

- end of input is reached before a closer is found
- inside a container, the container ends first (see *Placement*)

For an unterminated block:

- The parser MUST NOT backtrack and reinterpret the opener or the payload as Markdown.
- It MUST emit a resource node in the `failed` state with the error `unterminated-resource`. The node's payload is everything after the opener up to the point where the block ended.
- It MUST surface a diagnostic.

**Rationale.** Draft 0.1 fell back to ordinary Markdown text. That was wrong for two reasons.

- **It made parsers non-streaming.** Nothing after an opener could be emitted until a closer had been found, which forced whole-file buffering and backtracking.
- **It failed open.** A mistyped or truncated closer dumped raw ciphertext, private data or attacker-chosen HTML straight into the prose renderer.

A committed parser can stream. A failed node keeps the bytes behind the same fallback representation (§6.2) as any other resource that cannot be decoded.

#### Payload extent

The payload consists of the bytes after the opener's line terminator, up to but not including the line terminator immediately before the closer. Inside a container, each payload line first has its container prefix removed.

An empty block, where the closer directly follows the opener, has an empty payload. Line terminators inside the payload are preserved as written.

#### Placement

Resource blocks are recognised wherever a block may start:

- at top level
- inside list items
- inside block quotes

An opener may interrupt a paragraph, just as a code fence can.

Resource syntax is ordinary text inside:

- fenced code
- indented code
- HTML blocks, except for the compatibility wrapper (§7.1)

Inside a container, **every line of the block carries the container's prefix**. That includes the opener, the payload lines and the closer. The prefix consists of:

- the `>` markers of enclosing block quotes, each with its optional following space as CommonMark defines it
- the indentation up to the content column of enclosing list items

The prefix is stripped before the closer test and before a line enters the payload. Nothing else is stripped.

This is the only interpretation that happens inside a resource, and it is purely positional. It is the same rule as Ruby's `<<~` heredoc, or a fenced code block indented under a list item.

````text
1. Install the agent.
2. Check the topology:

   <<<NET type="image/svg+xml" encoding="base64 gzip" title="Network topology"
   H4sIAAAAAAAAA+1YbW/bNhD+7l8h…
   NET

3. Restart the service.
````

Lazy continuation does not apply. A payload line that does not carry the full prefix ends the container under CommonMark rules. It therefore also ends the resource, which becomes unterminated and `failed`.

There are two exceptions. Each contributes an empty payload line:

- an empty line inside a list item
- a line consisting of the block quote markers alone

**Rationale.** Draft 0.1 recognised resources only at top level. To place a resource inside a list, it suggested nesting a `text/markdown` resource there instead.

That workaround could never have worked. The nested document applies the same top-level restriction, so no resource could ever sit inside a list item. A diagram inside a numbered step, which is ordinary technical writing, was impossible to express. Container placement removes this deadlock.

**Parser reality.** Recognising a resource requires knowing, at each line, whether a fenced code block, an HTML block or a container is open. It therefore cannot be done by a regular-expression pre-pass that looks for `<<<` at column 0.

Recognition belongs in the block-start phase of a CommonMark block parser, alongside fenced code. In the CommonMark 0.31.2 parsing strategy, this is the first phase of block parsing.

### 4.2 Frontmatter Shorthand

Conventional frontmatter is **syntax sugar for the first resource**. It is not privileged parser state.

A document whose first line is exactly `---` begins a frontmatter block. The block ends at the next line that is exactly `---` or `...`.

The block normalises to:

```text
Node {
    rel      = metadata
    resource = {
        type     = application/yaml
        encoding = [utf-8]
        payload  = <lines between the delimiters>
    }
}
```

The shorthand always means `application/yaml`. Draft 0.1 allowed this default to be configured. That option is withdrawn, so that every parser produces the same tree from the same bytes.

The following explicit form is equivalent:

```text
<<<META type="application/yaml" rel="metadata"
title: Example
META
```

Explicit metadata in other formats needs no further rules:

```text
<<<META type="application/json" rel="metadata"
{"title": "Example"}
META
```

After normalisation, the renderer MUST NOT distinguish between the shorthand and the explicit form.

If no closing delimiter is found, the frontmatter **fails closed** exactly as an unterminated resource does. The parser emits:

- a `metadata` node in the `failed` state
- the error `unterminated-frontmatter`
- a payload running to the end of input
- a diagnostic

Authors who want a thematic break as the first line of a document use `***` or `___`.

Metadata is data, never code. Handlers for `application/yaml` metadata MUST use a safe-loading schema, such as the YAML core or JSON schema. They MUST NOT instantiate application objects or resolve language-specific tags.

The shorthand applies independently at the start of every `text/markdown` resource. This means nested and encrypted documents may carry their own frontmatter.

**Principle:** the `---` form is convention; the resource model is semantics.

## 5. Encodings and Decoders

### 5.1 The Decoder Stack

`encoding` is an ordered list of decoder identifiers. They are applied **left to right, in decoding order**:

```text
encoding="base64 age"
payload → base64-decode → decrypt → bytes of declared type
```

Authors write in the reverse order. For example, an author who wants a compressed, encrypted, base64-encoded resource:

1. compresses the bytes
2. encrypts them
3. base64-encodes the result
4. declares `encoding="base64 age gzip"`

A decoder is any transformation that produces the input for the next stage. A decoder is not necessarily a character codec. Compression, decryption and retrieval are all decoders.

Decoder identifiers are case-insensitive tokens.

### 5.2 Core Decoders

Every conforming reader MUST implement:

| Decoder  | Input → Output                                                                                                                      |
|----------|-------------------------------------------------------------------------------------------------------------------------------------|
| `utf-8`  | Payload bytes are used as-is and asserted to be valid UTF-8 text.                                                                   |
| `base64` | RFC 4648 base64. ASCII whitespace is ignored. Invalid input is a decode failure.                                                   |
| `gzip`   | RFC 1952 gzip. Output is the decompressed bytes. Corrupt input is a decode failure. Quotas apply as bytes are produced (§6.3).      |

The following decoder is defined but optional:

| Decoder | Input → Output                                                                                                                                  |
|---------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| `uri`   | Input is a single URI (RFC 3986), with surrounding whitespace trimmed. Output is the bytes obtained by resolving it. MUST be the first decoder in the stack. |

The `uri` decoder makes remote and filesystem resources mechanically consistent with inline ones:

```text
<<<LOGO type="image/svg+xml" encoding="uri"
https://example.org/logo.svg
LOGO
```

Resolving a URI yields bytes, never a type. The declared `type` remains authoritative. Readers MUST NOT let any of the following override it:

- a `Content-Type` response header
- a filename extension
- anything else learned during retrieval

### 5.3 Compression

Compression is an encoding for the same reason encryption is: a gzipped SVG is still an SVG.

```text
<<<TOPOLOGY type="image/svg+xml" encoding="base64 gzip"
H4sIAAAAAAAAA+2YW2/bNhTH3/0pBL7…
TOPOLOGY
```

Compression matters most for text-heavy assets such as SVG, JSON, CSV and nested Markdown, which often shrink severalfold. The 4/3 expansion of base64 is then applied to far fewer bytes.

`gzip` is a core decoder so that a document using it is readable everywhere. Other algorithms, such as `zstd` or `br`, may be defined in decoder profiles (§9). A document that uses them is only as portable as those profiles.

**Encoding or type?** The author decides whether compression is part of the transport or part of the object.

- If the archive itself is the object being shared, for example a download the reader should save as `.gz`, it is `type="application/gzip"`. The reader shows or saves the archive and does not decompress it.
- If compression is only how the bytes travel, it belongs in `encoding`.

`encoding` says *undo this to obtain the object*. `type` says *this is the object*. This is the same distinction HTTP draws between `Content-Encoding` and `Content-Type`.

**Compression and encryption.** Ciphertext does not compress, so authors compress before they encrypt. The compression decoder therefore comes *after* the encryption decoder in the stack: `base64 age gzip`.

There is a known hazard here. Compressing secret data together with data an adversary can influence, then encrypting the result, leaks information through the ciphertext length. This is the CRIME/BREACH class of attack. Authors SHOULD NOT compress encrypted resources that mix secrets with attacker-influenced content.

**Compression bombs.** Ratios of 1000:1 are trivial to construct. The quotas of §6.3 are therefore enforced *while* each decoder runs, not after it finishes.

### 5.4 Encryption Decoders

Encryption is an **encoding, not a type**.

A JPEG does not stop being a JPEG because its bytes were encrypted. Encryption changes the *accessibility* of a resource, not its *identity*.

```text
<<<VAULT type="text/markdown" encoding="base64 age"
YWdlLWVuY3J5cHRpb24ub3JnL3YxCi0+IHNjcnlwdCBk…
VAULT
```

Markdown2 does not define cryptography, key management, password storage or prompt UX. It defines only these rules:

- Encryption decoder identifiers name an external, fully specified encryption format. `age` is a non-normative example. Decoder profiles are published separately.
- Encryption decoder profiles MUST specify authenticated encryption (AEAD). A decoder that cannot detect tampering would pass modified bytes to a handler, under a type the author never vouched for.
- Encryption decoders are **capability-gated** (§5.5).

Unlocking produces bytes, not a special "secret Markdown" structure. If the declared type is `text/markdown`, the ordinary Markdown2 handler renders it.

An entire subtree can therefore be encrypted. Unlocking it reveals a nested document that may contain images, diagrams, metadata and further encrypted sections.

#### Layered encryption

A stack may contain more than one encryption decoder:

```text
<<<ESCROW type="application/pdf" encoding="base64 age age" title="Q3_Financials.pdf"
YWdlLWVuY3J5cHRpb24ub3JnL3YxCi0+IFgyNTUxOSBq…
ESCROW
```

Each encryption decoder is its own capability gate. In this example, the outer layer might be encrypted to the legal team and the inner layer to finance. The PDF becomes readable only when both layers have been granted. This is a two-person rule expressed entirely in the encoding.

Layers may use different formats where profiles exist, for example `base64 age gpg`.

- The resource remains `locked` until every encryption stage has been granted.
- The intermediate output of a layer is the inner ciphertext. It has no type and is never passed to a handler.
- "Any one of several keys" is not layering. It is a property of the encryption format; `age`, for example, supports multiple recipients within one layer.

**Layering versus nesting.**

- Layered encryption protects *one resource* behind several keys.
- Nesting an encrypted `text/markdown` resource inside another protects a *structure*. Unlocking the outer resource reveals a document whose inner sections stay locked, each with its own metadata and title.

Use layering when every key guards the same thing. Use nesting when each key reveals more.

### 5.5 Capability Boundary and Decoder States

Some decoders require authority that opening a document does not confer. Examples include network access, filesystem access and keys.

```text
payload → decoder → bytes → handler → view
             ↑
     capability boundary
```

Each resource is in exactly one decode state:

| State         | Meaning                                                                 |
|---------------|-------------------------------------------------------------------------|
| `decoded`     | All decoders succeeded. Bytes are available to a handler.               |
| `locked`      | A decoder requires a capability that has not been granted.              |
| `unsupported` | A decoder in the stack is not implemented by this reader.               |
| `failed`      | The resource is malformed, or a decoder ran and reported an error.      |

#### State precedence

A resource's state is the first of the following that applies, evaluated in order:

1. **Structural error → `failed`.** Examples:
   - an unterminated block
   - a malformed opener
   - a missing `type`
   - a duplicate attribute
   - `uri` in any position other than first
   - a depth or resource-count limit already exceeded
2. **Unknown decoder → `unsupported`.** The stack names a decoder this reader does not implement.
3. **Unmet capability → `locked`.** A decoder in the stack requires a capability that has not been granted.
4. **Runtime decode error → `failed`.** Examples:
   - invalid base64
   - corrupt gzip
   - invalid UTF-8
   - a byte quota exceeded mid-stream
5. Otherwise → **`decoded`**.

Steps 1–3 are static. They follow from the opener and the reader's configuration, without running any decoder.

For example:

- `frobnicate uri` is `failed`, not `unsupported`, because the structural rule wins.
- `base64 frobnicate age` is `unsupported`, not `locked`.

A reader MAY run gated stages as each one is granted, for example to verify a passphrase. However, no bytes reach a handler until every stage has been granted. A rejected key leaves the resource `locked` with a diagnostic. It is not a runtime failure.

#### Requirements

- An encryption decoder MUST NOT run without affirmative user action, unless trust for that specific resource or key has already been explicitly established.
- The `uri` decoder MUST NOT resolve without reader policy permitting it.
  - The default policy MUST leave `uri` resources `locked` for **all** schemes, including `file:` and relative references.
  - Draft 0.1's distinction between local and non-local schemes is withdrawn. "Local" resolution is how documents read files they should not, such as `file:///etc/passwd`. It is also how they leak credentials, for example a `file://attacker/share` reference that triggers SMB authentication.
  - Server-side renderers that resolve `uri` MUST refuse loopback, link-local and private addresses, which prevents server-side request forgery. They MUST apply the same check after every redirect.
- A `locked` resource remains a structural node. For example, it may be rendered as `🔒 Q3_Financials.pdf — encrypted application/pdf`. Its content stays invisible.
- Granting a capability moves the resource out of `locked` once every gated stage has been granted. It MUST NOT implicitly grant capabilities to any nested resources.

#### Avoiding permission fatigue

Per-resource capability is a property of the model. It does not mandate one prompt per resource. A document with fifteen remote images need not ask fifteen times.

Viewers MAY offer **batch grants**, such as "unlock every block in this document that accepts this key" or "allow images from example.org". A batch grant is permitted under three conditions:

- it is an explicit user action
- its scope is shown to the user
- it is applied as an individual grant to each matching node

Implicit propagation remains forbidden. Unlocking a parent never, by itself, grants anything to its children.

## 6. Types and Handlers

### 6.1 Type Is Authoritative

- The `type` attribute names the media type of the fully decoded bytes.
- Readers MUST NOT inspect content to override or refine the declared type. **There is no sniffing.**
- An unknown type means unknown.
- Types SHOULD be taken from the IANA media type registry (RFC 6838) where a suitable type exists. Markdown2 does not maintain its own media type universe. Appendix A names a handful of common types only so that implementations agree on them.

This is deliberately unforgiving. `image/jpg` is not `image/jpeg`, and a reader that silently treats them as equal has started sniffing. Authors get help through the fallback (§6.2), not through looser rules.

### 6.2 Fallback

A resource that is not `decoded`, or whose type has no handler, MUST still be represented. The representation should show at least:

- the `title` or `filename`, if present
- the declared type and encoding
- the decode state, and the error where there is one (for example `unterminated-resource`)
- the size, if known

When a type has no handler because it is a near miss of a known type, readers SHOULD show an advisory "did you mean?" hint in the fallback. Common examples:

- `image/jpg` → `image/jpeg`
- `text/json` → `application/json`
- `image/svg` → `image/svg+xml`

A reader MUST NOT apply such a correction silently. Type authority is not relaxed for convenience.

Readers SHOULD offer access to the raw payload or the decoded bytes, for example by viewing or saving them.

When saving, readers MUST NOT derive a file extension that causes execution or active rendering from the `type` or `filename` attributes, because both are untrusted author input. Examples of such extensions are `.html`, `.svg`, `.js`, `.exe` and `.bat`. Safe alternatives are a neutral extension such as `.bin`, or explicit user confirmation of the name.

Such a resource MUST NOT cause the surrounding document to fail rendering.

### 6.3 Recursion Limits

Readers MUST impose and document limits on:

- nesting depth
- total decoded size
- number of resources

Size limits MUST be enforced incrementally. Each decoder stage counts bytes as it produces them and aborts as soon as the quota is exceeded. Checking after decoding is too late: a few kilobytes of gzip can expand to gigabytes before such a check runs.

A resource that exceeds a limit is treated as `failed` with the error `limit-exceeded`. The surrounding document continues.

## 7. Compatibility

### 7.1 Old Reader, New Document

A CommonMark reader sees each resource block as ordinary paragraph text:

- the opener line
- the payload
- the closer line

Payloads remain legible when they are text. Binary payloads do not. An inline base64 image or `age` ciphertext appears as hundreds or thousands of lines of noise in legacy previews such as GitHub, Obsidian and VS Code.

Draft 0.1 advised wrapping resource blocks in a long code fence. **That advice is withdrawn.** It contradicted §4.1: resource syntax inside fenced code is ordinary text, so a fenced resource was invisible to Markdown2 readers as well.

Markdown2 instead defines a **compatibility wrapper** based on an HTML comment:

````text
The network topology is shown below.

<!--
<<<TOPOLOGY type="image/svg+xml" encoding="base64 gzip" title="Network topology"
H4sIAAAAAAAAA+2YW2/bNhTH3/0pBL7…
TOPOLOGY
-->
````

- A wrapped resource opens with a line that is exactly `<!--`, immediately followed by an opener line at the same block position. Markdown2 checks for this pattern before it recognises HTML blocks.
- The resource is parsed normally.
  - If the line immediately after the closer is exactly `-->`, the parser consumes it.
  - Otherwise, readers SHOULD emit a diagnostic.
- The wrapper lines are discarded. The parse tree is identical to the unwrapped form.
- Legacy renderers treat the whole construct as an HTML comment and hide it.
  - This works only if the payload does not contain `-->`. Base64 never does. For text payloads, authors must check.
  - Markdown2 itself is unaffected either way, because the payload is opaque.

Hiding is not the same as degrading gracefully. Authors SHOULD place a sentence of prose near each wrapped resource that says what it contains. The wrapper is RECOMMENDED for binary and encrypted payloads. Textual payloads usually read better unwrapped.

### 7.2 New Reader, Old Document

Ordinary Markdown is valid Markdown2 and renders normally.

Readers MAY map conventional fenced code info strings to media types as **compatibility aliases**. These aliases are explicitly not part of the format:

````text
```mermaid  → text/vnd.mermaid (Appendix A)
```json     → application/json
```math     → reader-configured math renderer (Appendix A)
````

Aliased fences are still fenced code in the parse tree. The alias only influences handler selection.

### 7.3 File Naming

Markdown2 documents use the existing `.md` extension and the `text/markdown` media type (RFC 7763). No new extension is required.

Some senders need to distinguish Markdown2 from other dialects, for example during content negotiation. They MAY use the RFC 7763 variant parameter, `text/markdown; variant=Markdown2`. The variant name is to be registered in the IANA Markdown Variants registry.

### 7.4 Authoring in Version Control (Informative)

Inline payloads pull in two directions.

- **Portability.** A self-contained "briefcase" document carries its images and attachments with it, so links never break.
- **Repository health.** Inline base64 bloats repositories, defeats `git diff` review and slows editors. Encrypted payloads make this worse because encryption is non-deterministic: re-encrypting unchanged plaintext changes every line.

Both uses are legitimate. The following guidance helps authors choose:

- Use inline payloads for documents that must travel intact, such as email, archives and hand-offs.
- In repositories, prefer `encoding="uri"` with a relative reference to a separately tracked file, or to large-file storage. This keeps the prose diffable.
  - Because `uri` is locked by default, readers used on repositories MAY let the user configure a policy that trusts relative references within the opened project.
  - Such a policy is configured by the user, never defaulted.
- When payloads are inline:
  - compress them (`base64 gzip`)
  - wrap base64 at a fixed width, such as 76 columns, so that diffs stay line-oriented
  - place large payloads in the compatibility wrapper
- Tools that manage encrypted resources SHOULD re-encrypt only when the plaintext changes.

A same-document reference pattern was considered for this draft and deferred. In that pattern, a resource in the prose would point at a payload defined at the end of the file. It needs identifier, scoping and cycle rules that would cost more than they save at this stage.

## 8. Minimal Grammar

The grammar below is ABNF-style and line-oriented. It applies at block positions (§4.1). Anything not matched here is CommonMark.

```abnf
document     = [frontmatter] *( wrapped / resource / markdown-line )

frontmatter  = "---" EOL *fm-line ( "---" / "..." ) EOL
                 ; only at byte offset 0
                 ; unterminated → failed metadata node (§4.2)

wrapped      = "<!--" EOL resource [ prefix "-->" EOL ]
                 ; wrapper lines are discarded (§7.1)

resource     = opener payload closer

opener-start = prefix "<<<" token ( SP / HTAB / EOL )
                 ; commits the parser, even if the rest of the
                 ; line does not match `opener` (§4.1)
opener       = prefix "<<<" token *( WSP1 attribute ) *WSP EOL

attribute    = name "=" ( DQUOTE dvalue DQUOTE / SQUOTE svalue SQUOTE )
name         = ALPHA *( ALPHA / DIGIT / "-" )
dvalue       = *( %x20-21 / %x23-7E / UTF8-nonascii )   ; no DQUOTE, no EOL
svalue       = *( %x20-26 / %x28-7E / UTF8-nonascii )   ; no SQUOTE, no EOL
token        = ( ALPHA / "_" ) *( ALPHA / DIGIT / "_" / "." / "-" )

payload      = *( prefix payload-line EOL )
                 ; shortest run before a closer; prefixes are stripped
closer       = prefix token *WSP ( EOL / end-of-input )
                 ; token must equal the opener token exactly

prefix       = <container prefix, §4.1; empty at top level>

EOL          = LF / CRLF
WSP          = SP / HTAB
WSP1         = 1*WSP
SQUOTE       = %x27
```

**Disambiguation.** The closer search is a literal scan, line by line, for a line that equals the token after its container prefix is removed, optionally followed by spaces or tabs.

There is one exception: when the payload is empty, the closer immediately follows the opener's EOL.

If the scan reaches end of input without finding a closer, the result is a `failed` node, never Markdown.

## 9. Companion Specifications (Out of Scope Here)

These are kept separate on purpose, so that the format stays implementable without them.

### Markdown2 Viewer API

The Viewer API defines a handler registry keyed by **capability × media type**, not media type alone:

```text
can(capability, type) → bool
perform(capability, resource) → result

capabilities: view, edit, print, thumbnail, convert, validate, …
```

The Viewer API is also the place for permission and fallback UX. It SHOULD recommend:

- batch-capability patterns, such as "unlock all blocks in this document with this key" or "allow all images from this domain", that keep the underlying nodes individually granted (§5.5)
- "did you mean?" linting for media type typos (§6.2)

### Decoder Profiles

Decoder profiles provide precise definitions of optional decoders. Examples include:

- `uri` scheme policies
- additional compression algorithms such as `zstd` or `br`
- specific encryption formats, which MUST use AEAD (§5.4)

### Reference Implementation

A PWA serves as the reference parser and handler runtime.

It is *a* realisation of the spec, not the spec. Implementations in Rust, Java, Swift, .NET or shell utilities need nothing from it.

## 10. Non-Goals

Markdown2 explicitly refuses to become:

1. a dependency manager
2. a scripting language
3. a layout system
4. an application event bus
5. a registry of Markdown-specific media types

Appendix A does not contradict item 5. It is a baseline of names, not a registry.

Minimalism has a cost: if everything beyond `metadata` is left unspecified, implementations drift into incompatible dialects within months. Appendix A therefore fixes a handful of `rel` tokens and media type names so that independent implementations agree from the first day. It defers to IANA wherever IANA already has an answer.

For the same reason, Appendix A defines no `stylesheet` relationship, because styling would make Markdown2 a layout system.

Each new feature proposal should be tested against one question: *Can someone still implement this correctly from the spec alone?*

## 11. Security Considerations

- **No implicit authority.**
  - Rendering a document never grants network access, filesystem access or key access.
  - Capabilities are per resource and do not propagate to children. Batch grants are explicit and are applied to each node individually (§5.5).
  - `uri` is locked by default for every scheme. Server-side renderers refuse loopback, link-local and private addresses.
- **Fail closed.** An unterminated, malformed or undecodable resource becomes a `failed` node. Its payload is never reinterpreted as prose (§4.1, §4.2).
- **No parser differentials.** Opacity means parsers cannot disagree about where a resource ends. The commitment rule and the fail-closed rule preserve this property when input is malformed.
- **No sniffing.** Declared types prevent content-confusion attacks of the kind that browsers mitigate with `X-Content-Type-Options: nosniff`. Retrieved bytes never acquire a type from the server.
- **Handler isolation.** Readers SHOULD sandbox third-party handlers. A handler receives decoded bytes and nothing else.
- **Safe metadata.** YAML metadata is loaded with a safe schema and never instantiates objects (§4.2).
- **Safe saving.** Saved payloads never receive an executable or actively rendered extension derived from untrusted attributes (§6.2).
- **Resource exhaustion.** Depth, count and size limits are mandatory and are enforced while decoding runs (§6.3). This guards against recursive structures and decompression bombs.
- **Authenticated encryption.** Encryption profiles MUST use AEAD, so tampered ciphertext fails instead of decoding to attacker-chosen bytes.
- **Compression side channels.** Compressing secrets together with attacker-influenced data before encryption leaks information through length (§5.3).
- **Locked content is not hidden content.**
  - The existence, type, title and size of an encrypted resource are visible.
  - Authors who need to conceal the type SHOULD declare `type="text/markdown"` on the encrypted outer resource. The true typed resource, with its real type, title and filename, goes *inside* the encrypted document.
  - Draft 0.1 suggested `application/octet-stream` for this purpose. That advice is withdrawn: once such a resource is unlocked, the no-sniffing rule leaves the reader nothing to render.
  - Size remains visible in all cases. Length padding is a matter for encryption profiles.

## 12. Compatibility Test Suite (Outline)

Each test case is a source document plus an expected normalised tree of nodes, resources, states and errors. A conforming parser MUST pass every case in categories A–E, G and H.

**A. Terminators**

1. Payload containing triple and quadruple backticks is preserved exactly.
2. A line equal to the token followed by trailing spaces or tabs terminates the block. A line equal to the token preceded by a leading space does not.
3. A different token inside the payload does not terminate. A nested opener with the same token terminates at the first exact match.
4. Empty payload.
5. An unterminated block produces a `failed` node with error `unterminated-resource`, a payload running to end of input, no Markdown rendering of that payload, and a diagnostic.
6. CRLF and LF inputs produce identical payloads, modulo the preserved interior line terminators.
7. Case sensitivity: `END` does not close `<<<end`.
8. An opener directly after a paragraph line interrupts the paragraph.

**B. Attributes and openers**

1. Missing `type` produces a `failed` node. The payload is still opaque, and the document continues.
2. Duplicate attribute produces a `failed` node.
3. A malformed opener, such as one with an unclosed quote, still commits the parser to the closer scan.
4. `<<< X` and `<<<9X` are ordinary text.
5. Unknown and vendor-namespaced attributes are preserved.
6. `type='text/plain; charset="utf-8"'` parses, with the inner double quotes intact.
7. Default `encoding` is `utf-8`.
8. `title` and `filename` are preserved and do not affect handler selection.

**C. Decoder stacks**

1. `base64` with embedded whitespace decodes correctly.
2. Invalid base64 → `failed`.
3. Unknown decoder → `unsupported`. Siblings render normally.
4. `uri` not in first position → `failed`.
5. `uri` without policy → `locked`. This applies to `https:`, `file:` and relative references alike.
6. Encryption decoder → `locked` until unlocked, and children remain absent while locked.
7. `base64 gzip` decodes correctly. Corrupt gzip → `failed`.
8. `base64 age age` remains `locked` after only one layer has been granted, and becomes `decoded` when both have been granted.
9. Precedence: `frobnicate uri` → `failed`; `base64 frobnicate age` → `unsupported`.
10. A `Content-Type` returned during `uri` resolution does not override the declared type.

**D. Frontmatter**

1. `---` shorthand and explicit `rel="metadata"` block produce identical trees.
2. `...` closes frontmatter.
3. `---` not at offset 0 is a thematic break, not frontmatter.
4. Nested `text/markdown` resources with their own frontmatter.
5. Unterminated frontmatter produces a `failed` metadata node with error `unterminated-frontmatter`.
6. Bare `---` normalises to `application/yaml` regardless of reader configuration.

**E. Nesting and placement**

1. Three levels of `text/markdown` with distinct tokens.
2. Encrypted Markdown containing a further encrypted Markdown resource. Unlocking the outer resource leaves the inner one `locked`.
3. Depth limit exceeded → `failed`, with the surrounding document intact.
4. A resource inside a list item and one inside a block quote have their prefixes stripped. Each payload is identical to its top-level equivalent.
5. A payload line without the block quote prefix ends the resource as `failed`, and container parsing resumes.
6. A resource inside a nested `text/markdown` document inside a list item.

**F. Compatibility (informative)**

1. A CommonMark renderer displays a Markdown2 document without loss of prose.
2. Plain Markdown fixtures from the CommonMark suite render identically under a Markdown2 reader.
3. Fence aliases (`mermaid`, `json`) select handlers without altering the parse tree.
4. The HTML comment wrapper yields a tree identical to the unwrapped form. A legacy renderer hides the payload.

**G. Type authority**

1. A resource declared `image/png` whose payload is HTML is never rendered as HTML. It is either handled as PNG and fails, or falls back.
2. A resource declared `image/jpg`, with no handler for that type, falls back with a "did you mean `image/jpeg`?" hint. It is never passed to the `image/jpeg` handler.

**H. Limits and safety**

1. A gzip bomb is aborted mid-stream → `failed` with `limit-exceeded`, with bounded memory use.
2. A document exceeding the resource-count limit marks the excess resources `failed`. The rest of the document renders.
3. YAML metadata containing language-specific tags, such as `!!python/object`, is not instantiated.
4. Saving a resource declared `text/html` does not produce an `.html` file name without explicit confirmation.
5. A server-side renderer refuses a `uri` resolving to `127.0.0.1`, even when its policy permits remote resources.

## 13. Normative References

- **BCP 14**: RFC 2119 and RFC 8174, *Key words for use in RFCs to Indicate Requirement Levels*.
- **CommonMark Spec**, version 0.31.2.
- **RFC 1952**, *GZIP file format specification version 4.3*.
- **RFC 3629**, *UTF-8, a transformation format of ISO 10646*.
- **RFC 3986**, *Uniform Resource Identifier (URI): Generic Syntax*.
- **RFC 4648**, *The Base16, Base32, and Base64 Data Encodings*.
- **RFC 6838**, *Media Type Specifications and Registration Procedures*.
- **RFC 7763**, *The text/markdown Media Type*.
- **RFC 9512**, *YAML Media Type*.

Informative:

- RFC 2045 (MIME, media type parameters)
- RFC 5116 (AEAD)
- RFC 6648 (deprecating the `x-` convention)
- RFC 8288 and the IANA Link Relations registry
- the age encryption format, age-encryption.org/v1

## Appendix A. Baseline Relationships and Media Types

### A.1 `rel` tokens

These tokens are aligned in spirit with the IANA Link Relations registry. Unknown `rel` tokens are preserved and rendered as `inline`. Other tokens are vendor-namespaced (`vendor-name`).

| Token         | Meaning                                                                                                      |
|---------------|--------------------------------------------------------------------------------------------------------------|
| `inline`      | Default when `rel` is absent. The resource is rendered where it appears.                                     |
| `metadata`    | Data about the parent document. Readers MAY consume it rather than display it.                               |
| `attachment`  | Accompanies the document. Readers SHOULD present it as a saveable item rather than render it inline.         |
| `alternate`   | An alternative representation of the preceding sibling resource. Readers render at most one of the two.      |
| `describedby` | A textual description of the preceding sibling resource, for example alternative text for accessibility.     |

### A.2 Media type names

Readers MUST treat these as exact type strings. If IANA later registers a different name for a provisional entry, a future draft will add an alias rather than change the meaning of existing documents.

| Content              | Media type               | Status                       |
|----------------------|--------------------------|------------------------------|
| Markdown / Markdown2 | `text/markdown`          | registered (RFC 7763)        |
| YAML                 | `application/yaml`       | registered (RFC 9512)        |
| JSON                 | `application/json`       | registered                   |
| MathML               | `application/mathml+xml` | registered                   |
| TeX / LaTeX math     | `application/x-tex`      | provisional, widely used     |
| Mermaid diagrams     | `text/vnd.mermaid`       | provisional, not registered  |

---

*In one sentence:* Markdown2 is Markdown with recursively embeddable, explicitly typed, explicitly encoded opaque resources. Everything else is a handler, a decoder or a convention.