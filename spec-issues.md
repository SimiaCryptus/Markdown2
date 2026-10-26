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