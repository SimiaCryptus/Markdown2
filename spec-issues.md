# Spec issues found during implementation

Seeded from plan.md §11; additions below.

1. **BOM**: implementation strips a leading U+FEFF before frontmatter/opener detection.
2. **Opener at EOF**: treated as committed and unterminated with empty payload.
3. **Non-UTF-8 stacks for text/markdown**: runtime requires valid UTF-8; otherwise `failed` / `invalid-utf-8`.
4. **Wrapper `-->` inside containers**: implementation requires the container prefix.
5. **`alternate` / `describedby` targets**: blank prose does not break the association with the
    preceding sibling resource; non-blank prose and `metadata` nodes do. Several alternates or
    descriptions may share a target. Orphans render inline (`analyseRels`).
6. **Count limit and locked children**: nested resources count only once decoded and parsed.
9. **Container model**: `@markdown2/core` uses a simplified line-based container model
   (block quote markers, list content columns, no tab expansion, HTML blocks other than
   comments not tracked). The micromark extension (plan §3) remains the target for full
   CommonMark fidelity; differential tests should compare resource extents.
10. **Media type comparison**: handler lookup for `text/markdown` compares the
    lower-cased essence (before `;`). Case-insensitivity follows RFC 6838; please confirm
    this is not considered sniffing.
11. **Batch grant scope over hidden children**: a batch grant covers only nodes visible
     when it is confirmed. Children revealed by unlocking need a fresh, explicit batch
     action (§5.5 "never implicitly"). Please confirm that this is the intended reading.
12. **`rel` case**: the spec does not say whether `rel` tokens are case-sensitive. The
     implementation compares them case-insensitively, as RFC 8288 does for link relations, and
     preserves the raw token.
13. **SSRF address forms**: §5.5 names loopback, link-local and private ranges only. The
     implementation also refuses multicast, reserved, CGNAT, NAT64/6to4-embedded private
     addresses, Teredo and unparseable addresses (fail closed). Consider listing these in §5.5.
14. **Safe-save extensions**: §6.2 gives a denylist of examples. The implementation uses an
     allowlist of passive extensions (including `.pdf`) and falls back to `.bin`. PDF viewers
     may run scripts; please confirm whether `.pdf` counts as "active rendering".
15. **Fixture trees and D.1**: the normalised fixture tree keeps `token` and `syntax`
     (`frontmatter` / `block` / `wrapped`) for diagnostics and round-tripping. D.1 ("identical
     trees") therefore holds for the tree with those two fields removed. Please confirm that
     §4.2 "MUST NOT distinguish" applies to rendering, not to parse-tree metadata.
16. **Server-side `uri` policy details** (`@markdown2/core/node`): §5.5 says "refuse loopback,
     link-local and private addresses … after every redirect". The implementation also:
     - checks at connect time via a custom DNS lookup, so rebinding between check and connect
       is impossible;
     - refuses a host if *any* of its resolved addresses is forbidden;
     - refuses credentials in the URI and allows only `https:` by default;
     - never pools connections;
     - caps the body size while it streams.
     Consider making connect-time checking normative; a pre-flight DNS check alone is not
     sufficient.
17. **Prose rendering in core**: `renderMarkdown` renders a safe CommonMark subset: headings,
      thematic breaks, fenced and indented code, block quotes, lists, emphasis, code spans,
      escapes, entities, inline links and autolinks. Raw HTML is always escaped. Links are limited to
      `http:`, `https:`, `mailto:` and relative references. Prose images render as links and are
      never fetched, because rendering must not grant network access (§5.5, §11). Reference links
      and HTML blocks are not supported. Full CommonMark fidelity remains the micromark/rehype
      target; this is an implementation gap, not a spec issue.
18. **`alternate` with nothing renderable**: A.1 says "render at most one of the two". When
     neither the target nor any alternate can be rendered, the implementation shows the target's
     fallback and suppresses the alternates. Please confirm that hiding the alternates' stubs is
     acceptable under §2 principle 6 ("shown, not dropped").
19. **Displaying metadata**: decoded `metadata` nodes are consumed and not displayed. Failed or
     locked metadata still shows its fallback stub so the failure stays visible.
20. **Handler failure**: §5.5 has no state for a decoded resource whose handler rejects the bytes
     (e.g. invalid JSON). The implementation keeps the state `decoded` and shows the fallback
     with error `handler-error`. Consider naming this in §6.2.
21. **Rejected key vs. tampered ciphertext** (PWA `age` decoder): the `age` library reports a wrong
     key and corrupted ciphertext through the same kind of error, so the PWA treats every
     decryption failure as `key-rejected` (stays `locked`). §5.4 suggests tampering should be
     `failed`. Both fail closed; an encryption profile should define how to tell them apart.
22. **SSRF in browsers**: §5.5's address rules cannot be enforced by a browser, because `fetch`
     exposes no resolved IP. The PWA relies on locked-by-default `uri`, a user-configured
     `https:` origin allowlist, per-resource grants, `credentials: 'omit'` and CSP `connect-src`.
     Consider stating in §5.5 that the address rules bind server-side renderers only.
23. **M2SS: metadata stubs** (style.md Appendix A): the UA rule hides every `rel="metadata"`
     resource, including failed or locked metadata whose stub #19 keeps visible. The implementation
     follows Appendix A; consider `md2-resource[rel="metadata"][state="decoded"]`.
24. **M2SS: author `@scope`**: an author `@scope` nested inside the reader's scope wrapper is
     believed to be constrained to the outer scope, but this is not stated in style.md. The
     sanitiser drops author `@scope` rules, together with `@import`, `@namespace` and `@charset`.
25. **M2SS: `stylesheet` and associations**: stylesheets are invisible, so they neither break nor
     become the target of an `alternate`/`describedby` association. `stylesheet` is treated as a
     known `rel` token, as proposed in style.md §2.
26. **M2SS: `:root`**: in a page, `:root` matches `html`, not the top-level `md2-document`. The
     sanitiser rewrites `:root` to `:scope` in top-level stylesheets only; inside a nested
     document `:root` matches nothing.
27. **M2SS: global names**: `@font-face`, `@keyframes`, `@property` and `@counter-style` names are
     global in a page, so a document can redefine a family used by reader chrome. The PWA uses only
     generic families in its chrome. Consider listing this in style.md §8.2.
28. **Presenting plain fenced code**: §7.2 covers aliases that select a handler, but not syntax
     highlighting of ordinary code. Core exposes a `codeFence` render hook; the PWA draws a Monaco
     frame *inside* `pre > code.language-x`, keeping style.md §4.1's tree. Consider stating in
     style.md that handlers may draw inside the code element of a fence.
29. **Opaque-origin handler frames need CORS**: sandboxed frames without `allow-same-origin` load
     their module scripts as CORS requests with `Origin: null`. Deployments must allow this for
     static assets. A CORS policy that matches on `Origin` may not answer `null`; the deployment
     adds `Access-Control-Allow-Origin: *` unconditionally (CloudFront viewer-response function).
     Consider a note in the Viewer API companion.
30. **Network access by a view, not a decoder**: embedded pages (`text/uri-list`) and Google Charts
     decode without any capability (the bytes are an address or a description), but their views reach
     the network. The PWA gates the view per resource (grant bound to the payload digest, never
     propagated) and by the user's origin list, with the control in reader chrome. §5.5 only knows
     decoder capabilities; consider describing view-level capabilities in the Viewer API companion.
31. **GFM in prose**: tables and `~~strikethrough~~` follow GitHub Flavored Markdown, as style.md §4.1
     anticipates for syntax extensions. The core spec does not name GFM; consider listing it as an
     optional prose profile.