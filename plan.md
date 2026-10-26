# Markdown2 Reference Implementation: Project Plan

*Targets: Markdown2 Working Draft 0.2 (`idea.md`)*
*Stack: TypeScript, Vite, PWA*

## 1. Purpose and Scope

We are building the **reference parser and handler runtime** described in §9 of the spec. It ships as an installable, offline-capable PWA.

The reference implementation is *a* realisation of the spec, not the spec. Two consequences follow:

- Everything that defines behaviour lives in framework-free, DOM-free TypeScript packages. Those packages can be used from Node, Deno, Bun, workers or a CLI.
- The conformance suite (§12) is published as **language-neutral fixtures**: a source document plus an expected normalised JSON tree. Implementations in other languages can run it without our code.

### In scope

1. A spec-conformant parser for §4 and §8. It handles:
   - openers, commitment and terminators
   - unterminated blocks
   - container placement
   - frontmatter shorthand
   - the compatibility wrapper
2. A decoder pipeline for §5 and §6.3. It covers:
   - the state model and its precedence rules
   - incremental byte quotas
   - the core decoders `utf-8`, `base64` and `gzip`
   - the optional `uri` decoder
   - `age` as the example encryption profile
3. A handler runtime for §6. It provides:
   - a registry keyed by capability × media type
   - the fallback representation
   - "did you mean?" hints
   - recursion limits
   - sandboxing
4. The PWA itself:
   - viewer and editor with live preview
   - capability UX for unlocking, batch grants and `uri` policy
   - safe saving
   - offline support and OS file handling
5. The conformance suite for categories A–H, plus a runner.
6. A small CLI for parsing, validating and dumping trees. It also serves as the server-side renderer reference for the SSRF rules in §5.5.

### Out of scope for v0.2

- The Viewer API companion spec. We implement a pragmatic subset internally and document it.
- Decoder profiles beyond `age`, such as `gpg`, `zstd` and `br`. The architecture must allow them as plug-ins.
- Same-document references. The spec defers them in §7.4.
- Collaborative editing and sync.

## 2. Guiding Constraints

| Constraint | Consequence for the implementation |
|---|---|
| Spec is the source of truth | Every normative rule is linked to a test ID. Ambiguities go to `spec-issues.md` (§11 of this plan) and are never resolved silently in code. |
| Fail closed (§2.7) | No code path renders payload bytes as prose. This is enforced with property-based tests (M5). |
| No sniffing (§6.1) | Handler selection is an exact lookup on the declared type. No code reads magic bytes or `Content-Type`. |
| No implicit authority (§11) | Grants are per node, live in memory and never propagate. `uri` is locked for every scheme by default. |
| Implementable from the spec alone | Core packages carry no hidden behaviour. Tunables such as limits are documented constants. |

## 3. Technology Stack

### Language and tooling

- **Runtime and tools:** Node 22 LTS, pnpm 9 workspaces, ESM only.
- **TypeScript 5.6+** with these settings:
  - `strict`
  - `noUncheckedIndexedAccess`
  - `exactOptionalPropertyTypes`
  - `verbatimModuleSyntax`
  - `isolatedDeclarations` for library packages
- **Lint and format:**
  - ESLint flat config with `typescript-eslint` `strictTypeChecked`
  - `eslint-plugin-security` on core packages
  - Prettier
- **Build:**
  - Vite 6 for the app
  - `tsup` or `tsc -b` for libraries, emitting ESM and `.d.ts`
- **Testing:**
  - Vitest for unit tests and the conformance runner
  - `fast-check` for property-based and fuzz tests
  - Playwright for end-to-end tests on Chromium, Firefox and WebKit
  - `@axe-core/playwright` for accessibility checks
- **Release and maintenance:**
  - Changesets for versioning
  - Renovate for dependency updates
  - GitHub Actions for CI

### Parsing

- **micromark extension** for the resource construct, frontmatter shorthand and wrapper.
  - micromark already handles CommonMark containers, lazy continuation and block-start precedence. The spec requires recognition in exactly that phase (§4.1, *Parser reality*).
  - Its flow constructs, such as fenced code, receive container-prefix-stripped lines, which matches §4.1 *Placement*.
- **mdast** utilities convert to and from the tree, and remark/rehype handle rendering.
- **Risk mitigation:** see §10 of this plan. If micromark cannot express a rule exactly, we fall back to a purpose-built block parser behind the same public API.

### Decoding

- **Web Streams** (`ReadableStream` / `TransformStream`) form the pipeline.
- **Native `DecompressionStream('gzip')`**, with a WASM or `fflate` fallback where it is unavailable (Node CLI).
- **Counting `TransformStream`s** enforce quotas between stages, so bytes are counted as they are produced (§6.3).
- **Base64** is implemented in-house as a streaming decoder that ignores whitespace and rejects invalid input. `Uint8Array.fromBase64` is used where present, but only after validation.
- **`age-encryption`** (typage) is the `age` profile. It provides AEAD and is lazy-loaded.

### UI and PWA

- **UI layer:** Preact with `@preact/signals`. The UI is a thin layer; all logic lives in packages.
- **Editor:** CodeMirror 6, with a Markdown2 language extension that highlights openers, closers and opaque payloads.
- **PWA:** `vite-plugin-pwa` (Workbox) for precaching and updates. The web app manifest declares:
  - `file_handlers` for `.md`
  - `launch_queue` handling
  - `share_target`
- **Files:** the File System Access API, falling back to `<input type=file>` and download links.
- **Storage:** IndexedDB via `idb`, for recent files, settings and `uri` policy. Keys are never stored by default.
- **Workers:** Comlink-wrapped Web Workers handle parsing and decoding, so the UI never blocks and every decode can be aborted with `AbortController`.

### Rendering security

- Prose HTML goes through `rehype-sanitize` with a strict schema. Raw HTML in Markdown is sanitised, never trusted.
- The deployment headers set:
  - a strict CSP with no `unsafe-inline` and no `unsafe-eval`
  - `require-trusted-types-for 'script'`
  - COOP `same-origin`
- **SVG** renders only through `<img src="blob:…">`, a context where scripts are disabled. SVG is never inlined.
- **Third-party handlers** run in `<iframe sandbox="allow-scripts">`, without `allow-same-origin`, and receive bytes over `postMessage` only (§11, *Handler isolation*).

### Optional handlers (lazy-loaded)

| Type | Library |
|---|---|
| `text/vnd.mermaid` | `mermaid`, run in a sandboxed iframe |
| `application/x-tex` | KaTeX or Temml |
| `application/mathml+xml` | Native MathML, sanitised |
| `application/json`, `application/yaml` | Built-in tree viewer. YAML is parsed with `yaml` using the `core` schema and no custom tags (§4.2). |

## 4. Repository Layout

```text
markdown2/
├─ packages/
│  ├─ core/                 @markdown2/core
│  │    types (Resource, Node, Document, DecodeState, errors),
│  │    limits, static state precedence, normalised-tree serialiser
│  ├─ micromark-extension/  @markdown2/micromark-extension
│  │    resource construct, commitment, frontmatter, wrapper
│  ├─ mdast/                @markdown2/mdast
│  │    from/to mdast, node identity
│  ├─ parser/               @markdown2/parser
│  │    public parse() API combining the three packages above
│  ├─ decoders/             @markdown2/decoders
│  │    utf-8, base64, gzip, uri, age; pipeline; quotas
│  ├─ runtime/              @markdown2/runtime
│  │    handler registry, grants, recursive render, fallback, did-you-mean
│  ├─ handlers/             @markdown2/handlers
│  │    built-in handlers for images, svg, markdown, json, yaml, math, mermaid
│  ├─ codemirror/           @markdown2/codemirror
│  │    language support
│  ├─ conformance/          @markdown2/conformance
│  │    fixtures/*.md + *.tree.json, JSON Schema, runner
│  └─ cli/                  @markdown2/cli (m2 parse | validate | tree | render)
├─ apps/
│  └─ pwa/                  Vite + Preact app
├─ docs/                    architecture, ADRs, API reference (TypeDoc)
├─ idea.md                  the spec, Draft 0.2
├─ plan.md                  this file
└─ spec-issues.md           ambiguities found during implementation
```

Dependency direction is strictly one-way:

```text
core
  ← micromark-extension
  ← mdast
  ← parser
  ← decoders
  ← runtime
  ← handlers
  ← apps/pwa and cli
```

The `core`, `parser` and `decoders` packages have **no DOM dependency** and must run in Node and in workers.

## 5. Key Interfaces (Draft)

```ts
// @markdown2/core
export type DecodeState = 'decoded' | 'locked' | 'unsupported' | 'failed';

export type ErrorCode =
  | 'unterminated-resource'
  | 'unterminated-frontmatter'
  | 'malformed-opener'
  | 'missing-type'
  | 'duplicate-attribute'
  | 'uri-not-first'
  | 'limit-exceeded'
  | 'decode-error'
  | 'invalid-utf-8';

export interface Resource {
  type: string | undefined;                // raw declared string, never normalised
  encoding: readonly string[];             // lower-cased decoder ids
  payload: Uint8Array;                     // prefix-stripped, exact bytes
  attributes: ReadonlyMap<string, string>; // names lower-cased
}

export interface ResourceNode {
  kind: 'resource';
  id: NodeId;           // structural path, e.g. "0/3/1"
  rel: string;          // 'inline' when absent
  resource: Resource;
  token: string | null; // null for frontmatter shorthand
  syntax: 'block' | 'frontmatter' | 'wrapped';
  structuralError?: ErrorCode;
  position: SourceRange;
}

// Steps 1–3 of §5.5 state precedence. Pure function; runs no decoder.
export function staticState(
  node: ResourceNode,
  reg: DecoderRegistry,
  grants: GrantSet,
): { state: DecodeState; error?: ErrorCode } | 'runnable';
```

```ts
// @markdown2/decoders
export interface Decoder {
  id: string;                                            // case-insensitive
  position: 'first' | 'any';                             // uri → 'first'
  capability?: 'key' | 'network' | 'filesystem';
  decode(input: ReadableStream<Uint8Array>, ctx: DecodeContext): ReadableStream<Uint8Array>;
}

export interface DecodeContext {
  signal: AbortSignal;
  quota: ByteQuota;     // shared, enforced per stage while bytes are produced
  grant?: Grant;        // key or policy for gated stages only
  baseUri?: URL;
}
```

```ts
// @markdown2/runtime
export interface Handler {
  types: readonly string[];               // exact strings, no wildcards
  capabilities: readonly ('view' | 'thumbnail' | 'validate')[];
  render(bytes: Uint8Array, node: ResourceNode, ctx: RenderContext): Promise<View>;
}
```

### Grant model

- **Key.** A grant is keyed by `NodeId` plus the SHA-256 of the payload. Editing a payload therefore invalidates its grant.
- **Layered encryption.** A `base64 age age` stack needs two stage grants (§5.4).
- **Batch grants.** An explicit batch action expands into one individual grant per matching node. The batch's scope is shown before the user confirms.
- **No propagation.** Grants never propagate from parent to children.

## 6. Milestones

Each milestone ends with its listed exit criteria green in CI.

### M0: Foundations (week 1)

- Monorepo, TypeScript project references, lint, format and Vitest.
- CI matrix: Node 22, plus Playwright on three browsers.
- Conformance package skeleton:
  - JSON Schema for the normalised tree
  - fixture runner
  - one passing smoke fixture
- ADR-001 (micromark vs. custom parser), ADR-002 (UI framework), ADR-003 (worker architecture).
- **Exit:** `pnpm test` and `pnpm build` pass in CI. Fixture format reviewed.

### M1: Parser (weeks 2–4)

- Opener recognition with commitment: the token followed by SP, HTAB or EOL commits the parser.
- Attribute parsing:
  - both quote styles
  - case-insensitive names
  - duplicate detection
  - preservation of unknown and vendor attributes
- A malformed opener produces a failed node and stays opaque.
- Closer scan:
  - byte-exact and case-sensitive matching
  - trailing whitespace tolerated
  - leading whitespace prevents a match
  - CRLF and LF both accepted
- Payload extent rules, including the empty payload.
- An unterminated block produces a failed node and a diagnostic. No backtracking occurs.
- An opener can interrupt a paragraph.
- Placement:
  - list items and block quotes
  - prefix stripping
  - no lazy continuation
  - empty-line and bare-`>` exceptions
  - the end of the container makes the block unterminated
- Frontmatter shorthand:
  - recognised at offset 0 only
  - closed by `---` or `...`
  - unterminated frontmatter produces a failed node
  - normalised to the same tree as the explicit form
- Compatibility wrapper:
  - `<!--` followed by an opener
  - the `-->` line is consumed
  - a diagnostic is emitted when `-->` is missing
- Recursion: the shorthand and resources inside nested `text/markdown` are parsed by re-invoking the parser.
- **Exit:** conformance categories **A, B, D** and **E.1, E.4, E.5** pass. The full CommonMark 0.31.2 spec suite passes unchanged (F.2).

### M2: Decoder Pipeline (weeks 4–6)

- Decoder registry and the static precedence function (steps 1–3 of §5.5).
- Streaming pipeline with per-stage byte quotas and abort on `limit-exceeded`.
- Core decoders:
  - `utf-8`, with validation
  - `base64`
  - `gzip`
- `uri`:
  - must be first in the stack
  - locked for all schemes by default
  - a policy object controls resolution
  - the declared type wins over any `Content-Type`
- The CLI renderer applies the SSRF rules: it refuses loopback, link-local and private addresses, including after every redirect.
- `age` profile:
  - passphrase and X25519 identities
  - layered stacks with staged grants
  - a rejected key leaves the resource `locked` with a diagnostic
- Limits: depth, total decoded size and resource count, as documented constants that can be overridden.
- **Exit:** categories **C** and **H.1, H.2, H.5** pass. A gzip bomb is aborted with peak memory under the configured cap, verified by a test harness.

### M3: Runtime and Handlers (weeks 6–8)

- Handler registry: exact type match, keyed by capability × type.
- Recursive rendering:
  - `text/markdown` re-enters the parser and renderer
  - the depth limit applies
  - siblings are isolated from each other's failures
- Fallback component. It shows:
  - the title or filename
  - the declared type and encoding
  - the state and error
  - the size
  - a "did you mean?" table (`image/jpg`, `text/json`, `image/svg`, …)
- `rel` semantics from Appendix A: `inline`, `metadata`, `attachment`, `alternate` and `describedby`. Unknown tokens render as `inline`.
- Built-in handlers:
  - images, through `blob:` URLs
  - SVG, through `<img>` only
  - Markdown
  - JSON and YAML (safe schema)
  - math
  - Mermaid (sandboxed)
- Sandboxed iframe host for third-party handlers.
- Fence compatibility aliases (§7.2). These affect handler selection only, never the tree.
- **Exit:** categories **E, G** and **H.3** pass. F.3 is verified.

### M4: PWA Application (weeks 8–11)

- **App shell:** offline precache, update prompt, installability (Lighthouse PWA checks).
- **Opening documents:** file handling, launch queue, drag and drop, share target, recent files.
- **Editing:** a split editor and preview using CodeMirror. Re-parsing is incremental and debounced in a worker.
- **Capability UX:**
  - an unlock dialog per resource, which never auto-prompts on open (§5.5)
  - batch grants with a scope preview
  - a `uri` policy editor, including an opt-in "trust relative references in this project"
  - a session-only key store
- **Saving** (§6.2):
  - raw or decoded bytes
  - neutral `.bin` by default
  - explicit confirmation before an active extension is used
  - `filename` is sanitised
- **Authoring helpers:**
  - insert a resource from a file, choosing among `base64 gzip`, wrapped or `uri`
  - pick a token that is guaranteed not to collide with any payload line
  - wrap base64 at 76 columns
  - encrypt with `age`, and avoid re-encrypting unchanged plaintext (§7.4)
- **Diagnostics panel:** lists unterminated and malformed resources with jump-to-source.
- **Exit:** H.4 passes. Playwright suites cover open, edit, unlock, batch grant, save and offline reload. axe reports zero serious issues.

### M5: Hardening (weeks 11–13)

- **Property-based tests:**
  - Random documents never leak payload bytes of failed or locked nodes into rendered prose.
  - Output for a document prefix is stable, which checks there is no backtracking.
- **Fuzzing** of the opener, attribute and container interaction, with corpus seeds from the fixtures.
- **Differential testing:** the micromark path is checked against the CLI's reference line scanner for resource extents.
- **Security review:**
  - CSP and Trusted Types audit
  - sandbox escape review
  - YAML tag injection
  - SVG script handling
  - CRIME/BREACH advisory in the authoring UI
- **Performance budgets:**
  - initial JS of at most 100 KB gzip
  - Mermaid, KaTeX and `age` lazy-loaded
  - a 10 MB document parses in under 500 ms in a worker on mid-range hardware
- **Accessibility:** WCAG 2.2 AA. Locked and fallback stubs are announced with title, type and state.
- **Exit:** the threat model document is signed off, all budgets are met in CI, and no high-severity findings remain open.

### M6: Release 0.2 (week 14)

- Publish npm packages and the conformance fixtures, the latter as a versioned tarball plus JSON Schema.
- Deploy the PWA as a static site with security headers on Cloudflare Pages or GitHub Pages.
- Documentation:
  - an implementer guide that maps spec sections to modules
  - API reference
  - a user guide
- Submit `spec-issues.md` findings back into the spec draft process.

## 7. Testing Strategy

| Layer | Tooling | Coverage target |
|---|---|---|
| Unit (core, decoders) | Vitest | ≥ 95% branches |
| Conformance (§12 A–H) | Fixture runner (Node, and browser through Vitest browser mode) | 100% of normative cases |
| CommonMark regression | Official spec JSON | 100% pass |
| Property and fuzz | fast-check | Fail-closed and no-backtrack invariants |
| E2E | Playwright (3 engines) | Critical user flows |
| Accessibility | axe + manual screen-reader pass | WCAG 2.2 AA |
| Security | CSP report-only in staging, dependency audit, manual review | Zero high findings |

Every normative MUST and SHOULD in the spec receives a requirement ID, such as `R-4.1-commit`. A traceability table in `docs/traceability.md` maps each ID to its tests. CI fails if a MUST has no test.

## 8. Security Checklist (tracked per milestone)

- [ ] No rendering path from failed, locked or unsupported payloads to prose HTML.
- [ ] Encryption decoders never run without a user action or explicit prior trust.
- [ ] `uri` is locked for every scheme by default, and policy is user-configured only.
- [ ] Grants are scoped to node and payload digest, and never propagate to children.
- [ ] Declared type is used verbatim. There is no sniffing, and no override from `Content-Type` or extensions.
- [ ] YAML uses a safe schema and never instantiates tags.
- [ ] Saving never yields an active extension without confirmation.
- [ ] Quotas are enforced while bytes are produced, at every stage.
- [ ] SVG and HTML never execute in the app origin.
- [ ] Keys are held in memory only by default and cleared on tab close.

## 9. Team and Roles

This plan assumes a small team of 2–3 engineers.

- **Parser lead:** M1, the conformance suite and CommonMark integration.
- **Runtime and security lead:** M2, M3, the sandboxing model and the threat model.
- **App lead:** M4, PWA, accessibility and UX.
- **Shared:** reviews, M5 hardening and documentation.

## 10. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| micromark's container and lazy-line handling differs subtly from §4.1 (prefix stripping, the bare `>` exception, unterminated at container end). | Non-conformant trees | Write the E.4 and E.5 fixtures first, in M1 week 1. If they cannot be met, switch to a custom block parser (ADR-001 fallback) behind the unchanged `parse()` API. |
| `DecompressionStream` is missing or behaves differently across runtimes. | Broken gzip and quota enforcement | Feature-detect it and fall back to streaming `fflate`. Run the bomb tests in every engine. |
| Browsers cannot enforce SSRF rules, because `fetch` has no IP visibility. | False assurance | Document that the SSRF rules apply to server-side and CLI renderers. The PWA relies on locked-by-default, user policy, CORS and CSP `connect-src`. |
| Sandboxed handlers such as Mermaid are heavy, or need same-origin access. | Performance and UX | Lazy-load them, cache them in the service worker and keep them in opaque-origin iframes. Accept the cost as the price of isolation. |
| Spec ambiguities (see §11) | Rework | Log every ambiguity, pick the most fail-closed reading, mark the code with the issue ID and add a fixture. |
| Large inline payloads slow the editor. | UX | Fold opaque payloads in CodeMirror by default and parse in a worker. |

## 11. Known Spec Questions (seed for `spec-issues.md`)

1. **Byte order mark.** Is a leading UTF-8 BOM permitted before `---` frontmatter or before an opener at offset 0?
2. **Opener at end of input.** The grammar requires `EOL` after the opener. An opener on the last line without a terminator commits the parser, then becomes unterminated with an empty payload. This needs confirmation.
3. **Text from non-UTF-8 stacks.** The default `utf-8` applies only when `encoding` is absent. When `text/markdown` is declared with `base64 gzip`, does the handler validate UTF-8, or does the type's `charset` parameter govern? Proposed: the Markdown handler requires valid UTF-8, and invalid input means `failed`.
4. **Wrapper closing line inside containers.** The grammar shows `prefix "-->"`. Confirm that `-->` must carry the container prefix.
5. **`alternate` and `describedby`.** "Preceding sibling resource": does intervening prose break the association?
6. **Count limit for locked children.** Do resources inside a locked or encrypted subtree count towards the resource-count limit before unlocking? Proposed: they count only once decoded.
7. **`rel` on frontmatter inside a nested document.** Confirm that it is metadata of the nested document, not of the outer one.
8. **Duplicate frontmatter.** Shorthand followed by an explicit `rel="metadata"` block: are both retained, and if so, which takes precedence?

## 12. Definition of Done (per feature)

- All requirement IDs implemented, with linked tests passing on Node and all three browser engines.
- Public API documented with TSDoc. Its behaviour is described in terms of spec sections.
- No new `any`. No ESLint or type errors. Bundle budget respected.
- Security checklist items affected by the change re-verified.
- Changeset added. Docs and the traceability table updated.