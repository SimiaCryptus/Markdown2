# Spec issues found during implementation

Seeded from plan.md §11; additions below.

1. **BOM**: implementation strips a leading U+FEFF before frontmatter/opener detection.
2. **Opener at EOF**: treated as committed and unterminated with empty payload.
3. **Non-UTF-8 stacks for text/markdown**: runtime requires valid UTF-8; otherwise `failed` / `invalid-utf-8`.
4. **Wrapper `-->` inside containers**: implementation requires the container prefix.
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