---
planId: "6aa3e38e-de12-47d4-a584-926d24061f79"
classification: "PLANNED_CHANGE"
workKind: "MAINTENANCE"
complexity: "MEDIUM"
summary: "Adopt a Deno-native TypeScript ratchet policy for the main RunWield codebase, enforce no new production JS files, and migrate a few low-risk leaf modules as proof of the migration path."
affectedPaths:
    - "docs/adr/000-initial-tech-stack.md"
    - "docs/adr/013-deno-native-typescript-ratchet.md"
    - "deno.json"
    - "scripts/check-language-policy.js"
    - "src/ui/tui/boot-logo.ts"
    - "src/ui/tui/chat-session.js"
    - "src/shared/collaboration/base64url.js"
    - "src/shared/collaboration/base64url.test.js"
    - "src/shared/package-resources.js"
    - "src/shared/package-resources.test.js"
createdAt: "2026-07-27T14:53:57-04:00"
status: "draft"
origin: "internal"
---

# TypeScript Ratchet Policy

## Context

RunWield was originally standardized on Deno + vanilla JavaScript + JSDoc to avoid build-pipeline friction. A small PoC
has now proven that the main codebase can safely mix JS and TS under Deno: `src/ui/tui/boot-logo.js` was converted to
`src/ui/tui/boot-logo.ts`, imported from existing JS via the real `.ts` extension, and passed `deno task -q check`, full
`deno task -q ci`, and `deno task -q compile`.

The goal is not a big-bang migration. Existing JS+JSDoc should remain valid and maintainable while the codebase moves
forward through a ratchet: new production modules use TypeScript, and existing modules migrate gradually in independent,
low-risk chunks.

## Objective

Change RunWield's language policy from "pure JS+JSDoc outside Workspace" to "Deno-native mixed JS/TS, with TypeScript
required for new production files." Preserve Deno's no-emit execution model, add a CI guard that prevents new production
JS files, and migrate a few low-risk leaf modules to validate the policy without touching core
lifecycle/session/worktree semantics.

## Approach

Record the policy as an ADR that supersedes only the language portion of ADR-000. Keep ADR-000's Deno runtime and Pi
foundation decisions intact, but add a short note pointing readers to the new TypeScript ratchet ADR.

Add a mechanical language-policy check rather than relying on agent memory alone. The check should maintain a baseline
of existing production `.js`/`.jsx` files and fail when a new production JS file appears outside the baseline. When a
module is migrated to TS later, its old JS path is removed from the baseline. This makes the allowed JS set shrink over
time without forcing unrelated edits to migrate existing files.

Update type-check coverage so main-code `.ts` files are checked directly, not only when imported by a checked `.js`
entry. Keep Workspace's Astro-owned TS/TSX check separate.

Treat the current `boot-logo.ts` PoC as the first accepted canary. Migrate one or two additional leaf modules only if
they remain behavior-preserving syntax migrations with straightforward import-extension updates. Do not migrate Plan
Lifecycle, SessionRuntime, worktree publication, validation, or collaboration authority modules in this Plan.

## Policy Rules

- TypeScript is allowed throughout the main RunWield codebase.
- Existing JS+JSDoc files remain valid and may receive small behavior fixes without forced conversion.
- New production source files under `src/` should be `.ts` or `.tsx` as appropriate.
- New tests should preferably match the module under test; existing JS tests are not required to migrate.
- Scripts may remain JS unless they become long-lived production-like modules; do not block tiny operational scripts in
  this first ratchet unless the implementation chooses to include them explicitly.
- Deno remains the runtime and checker: no `tsc` emit pipeline, no CLI/runtime `dist/`, no new bundler requirement.
- Imports use real file extensions (`.ts` imports for TS files, `.js` imports for remaining JS files).
- Migration PRs should avoid semantic refactors: rename/extension updates, native TS type syntax, and type-fix fallout
  only.

## Files to Modify

- `docs/adr/013-deno-native-typescript-ratchet.md` — add an accepted ADR documenting Deno-native mixed JS/TS, the new
  production-file ratchet, and the no-emit constraint.
- `docs/adr/000-initial-tech-stack.md` — add a brief amendment that its original JS+JSDoc language decision is
  superseded by ADR-013 while the Deno runtime decision remains accepted.
- `deno.json` — update `check`/`ci` tasks so main-code TS files are checked and the language-policy guard runs in CI.
- `scripts/check-language-policy.js` — add the ratchet guard for new production JS files using a generated or maintained
  baseline of existing production JS/JSX files.
- `src/ui/tui/boot-logo.ts`, `src/ui/tui/chat-session.js` — keep the successful PoC conversion as the first canary.
- `src/shared/collaboration/base64url.js` and `src/shared/collaboration/base64url.test.js` — optional leaf migration
  candidate; pure functions, small surface, focused tests.
- `src/shared/package-resources.js` and `src/shared/package-resources.test.js` — optional leaf migration candidate if
  the first candidate is uneventful.

## Implementation Steps

- [ ] Create ADR-013 as the accepted Deno-native TypeScript ratchet decision.
- [ ] Amend ADR-000 with a short note that only its original language decision is superseded by ADR-013.
- [ ] Keep the `boot-logo.ts` PoC changes if still present; otherwise restore that exact minimal conversion as the first
      canary.
- [ ] Add a language-policy guard that distinguishes existing JS from new production JS and wire it into `deno task ci`.
- [ ] Update the main type-check task so `.ts` files outside Workspace's Astro-owned check are checked directly.
- [ ] Migrate `src/shared/collaboration/base64url.js` and its focused test to TS if the guard/check changes pass
      cleanly.
- [ ] Optionally migrate `src/shared/package-resources.js` and its focused test to TS if it remains a pure syntax-level
      migration.
- [ ] Do not migrate high-authority runtime/lifecycle/worktree/session modules in this Plan.
- [ ] Remove migrated JS paths from the language-policy baseline so the allowed JS set shrinks immediately.

## Verification

- `deno task -q check`
- `deno task -q lint`
- Focused tests for migrated modules, for example:
  - `deno test -A src/shared/collaboration/base64url.test.ts`
  - `deno test -A src/shared/package-resources.test.ts`
- `deno task -q ci`
- `deno task -q compile`

## Out of Scope

- Migrating the entire codebase to TypeScript.
- Rewriting shared domain types or replacing JSDoc across all existing modules.
- Changing runtime packaging, introducing `tsc` emit, or adding a bundler for the CLI/runtime path.
- Migrating SessionRuntime, Plan Lifecycle, worktree publication, validation loops, or other high-authority modules.
- Updating `CONTEXT.md`; this is a language/tooling policy, not domain language.
