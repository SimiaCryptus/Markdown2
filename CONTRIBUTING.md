# Contributing to Markdown2

Thank you for helping. Markdown2 is a specification first and code second, so contributions of every kind count: bug reports, spec questions, documents that break things, handlers, and implementations in other languages.

## Before you start

- **Bugs:** open an issue with the smallest document that shows the problem. Use *Save raw* in the reader to attach the resources involved.
- **Spec questions:** open a *Spec question* issue. Quote the section, and describe two readings that would give different results. Ambiguities are recorded in `spec-issues.md` and never resolved silently in code.
- **Features:** open an idea issue first. Each proposal is tested against one question from the spec: *can someone still implement this correctly from the spec alone?*

## Principles

Changes must keep these properties of the spec:

1. **Fail closed.** No code path renders payload bytes of a failed, locked or unsupported resource as prose.
2. **No sniffing.** Handlers are chosen by the declared type, never by content or `Content-Type`.
3. **No implicit authority.** Opening a document grants nothing. Grants are per resource and never propagate.
4. **Graceful degradation.** Unsupported resources are shown, not dropped.

## Working on the code

```sh
cd packages/core
npm install
npm run check      # format, lint, typecheck, tests with coverage, build (fail-at-end)
npm run fix        # format and auto-fix lint

cd apps/pwa
npm install
npm run dev        # http://localhost:5173
npm test
```

- Every behaviour change in `@markdown2/core` needs a test. Conformance behaviour also needs a fixture in `packages/core/test/fixtures`: `name.md` plus `name.tree.json`, regenerated with `UPDATE_FIXTURES=1`.
- New features in the reader should be demonstrated in a help page under `apps/pwa/public/docs/`. The docs tests check that every page parses cleanly.
- Keep `@markdown2/core` free of DOM and Node APIs, except under `src/node`.

## Pull requests

- Keep each pull request focused on one change.
- Explain the change in terms of spec sections where it touches behaviour.
- Make sure `npm run check` passes in `packages/core`, and `npm test` passes in `apps/pwa`.