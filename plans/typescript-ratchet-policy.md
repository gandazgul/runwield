---
planId: "6aa3e38e-de12-47d4-a584-926d24061f79"
classification: "PLANNED_CHANGE"
complexity: "MEDIUM"
summary: "Adopt a Deno-native TypeScript ratchet policy for the main RunWield codebase, enforce no new production JS files, and migrate a few low-risk leaf modules as proof of the migration path."
affectedPaths:
    - "docs/adr/000-initial-tech-stack.md"
    - "docs/adr/013-deno-native-typescript-ratchet.md"
    - "deno.json"
    - "scripts/check-language-policy.js"
    - "scripts/language-policy-baseline.json"
    - "src/ui/tui/boot-logo.ts"
    - "src/ui/tui/chat-session.js"
    - "src/shared/collaboration/base64url.js"
    - "src/shared/collaboration/base64url.test.js"
    - "src/shared/package-resources.js"
    - "src/shared/package-resources.test.js"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-27T14:53:57-04:00"
updatedAt: "2026-07-27T20:25:09.804Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-27T19:41:37.919Z"
verifiedAt: "2026-07-27T20:25:09.804Z"
userVerifiedAt: null
userVerificationNote: null
executionReport: "- Implemented TypeScript ratchet policy docs: added accepted ADR-013 and amended ADR-000 to supersede only the old JS+JSDoc language decision.\n- Added `scripts/check-language-policy.js` and sorted `scripts/language-policy-baseline.json`; guard reports new production JS/JSX and stale baseline entries separately, supports `--update`, excludes tests/fixtures/generated/dependency artifacts, and is wired into `deno task -q ci`.\n- Updated `deno task -q check` to check non-Workspace `.ts`/`.tsx` directly while preserving separate `workspace:check` for Astro-owned Workspace TS/TSX.\n- Kept `boot-logo.ts` / `chat-session.js` import pattern unchanged and migrated `src/shared/collaboration/base64url` plus its focused test to `.ts`; updated all repository imports to real `./base64url.ts` extensions and removed the old JS path from the baseline.\n- Did not migrate optional `package-resources.js`; the required base64url canary and policy guard were clean, and the optional second canary was left for a separate low-risk migration.\n- Verification passed: `deno task -q check`, `deno task -q lint`, `deno test -A src/shared/collaboration/base64url.test.ts`, `deno run -A scripts/check-language-policy.js`, throwaway new/stale baseline failure checks, `deno task -q ci` (1878 passed), and `deno task -q compile` (completed with existing Vite warnings only)."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
workKind: "MAINTENANCE"
---

# TypeScript Ratchet Policy

## Context

RunWield was originally standardized on Deno + vanilla JavaScript + JSDoc to avoid build-pipeline friction. A small
proof-of-concept has proven that the main codebase can safely mix JS and TS under Deno: `src/ui/tui/boot-logo.js` was
converted to `src/ui/tui/boot-logo.ts`, imported from existing JS via the real `.ts` extension in
`src/ui/tui/chat-session.js`, and passed `deno task -q check`, full `deno task -q ci`, and `deno task -q compile` during
planning.

The goal is not a big-bang migration. Existing JS+JSDoc remains valid and maintainable while the codebase moves forward
through a ratchet: new production modules use TypeScript, and existing modules migrate gradually in independent,
low-risk chunks. This Plan should update durable project policy, enforce the new rule mechanically, and migrate a small
canary slice without touching RunWield's high-authority lifecycle, Session, validation, or worktree publication code.

## Objective

Change RunWield's language policy from "pure JS+JSDoc outside Workspace" to "Deno-native mixed JS/TS, with TypeScript
required for new production files." Preserve Deno's no-emit execution model, add a continuous integration (CI) guard
that prevents new production JS files, ensure main-code TS files are checked directly, and migrate a few low-risk leaf
modules to validate the policy.

Success means contributors and agents get a clear, enforced rule:

- existing JS+JSDoc can continue to be maintained;
- new production source under `src/` is `.ts` or `.tsx` as appropriate;
- migrated modules remove their old JS path from the allowlist immediately;
- no `tsc`, runtime `dist/`, CLI bundler, or emit pipeline is introduced.

## Approach

Record the policy as a new accepted architectural decision record (ADR) that supersedes only the language portion of
ADR-000. ADR-000's Deno runtime and Pi foundation decisions remain accepted, but ADR-000 should point readers to the new
TypeScript ratchet ADR for the current language policy.

Add a mechanical language-policy check rather than relying on agent memory alone. The check should keep a sorted
baseline JSON file of existing production `.js`/`.jsx` files under `src/`. It must fail when a new production JS/JSX
file appears outside the baseline, and it must also fail when a baseline entry no longer exists so migrations are forced
to shrink the allowlist in the same change. Test files and non-production fixtures should be excluded from this first
production-file ratchet. Scripts remain outside this first guard unless they are production source under `src/`.

Update the main `deno task check` path so non-Workspace `.ts`/`.tsx` files are checked directly, not only when imported
by a checked `.js` entry. Keep Workspace's `astro check` task separate for Workspace TS/TSX. The implementation may use
a small shell/find command in `deno.json` or a helper path from the language-policy script, but it must avoid pulling
Workspace TSX directly into the main Deno check because current Workspace/third-party TSX imports are handled by
Astro/Vite configuration.

Treat the current `boot-logo.ts` conversion as the first accepted canary. Migrate
`src/shared/collaboration/base64url.js` and its focused test as the primary additional leaf canary. Migrate
`src/shared/package-resources.js` and its focused test only if it remains a behavior-preserving syntax migration after
the first canary passes. Do not migrate Plan Lifecycle, SessionRuntime, worktree publication, validation, collaboration
authority, or other high-authority modules in this Plan.

## Files to Modify

- `docs/adr/013-deno-native-typescript-ratchet.md` — add an accepted ADR documenting Deno-native mixed JS/TS, the new
  production-file ratchet, gradual migration rules, and the no-emit constraint.
- `docs/adr/000-initial-tech-stack.md` — add a brief amendment that its original JS+JSDoc language decision is
  superseded by ADR-013 while the Deno runtime and Pi foundation decisions remain accepted.
- `deno.json` — wire the language-policy guard into `ci`, update the main `check` task so non-Workspace main-code TS/TSX
  is checked directly, and preserve the separate `workspace:check` Astro path.
- `scripts/check-language-policy.js` — add the ratchet guard. It should discover production JS/JSX under `src/`, compare
  against the baseline, report actionable additions/removals, and exit non-zero on policy drift.
- `scripts/language-policy-baseline.json` — new sorted baseline of existing production JS/JSX files that are temporarily
  allowed. Remove entries immediately when their modules migrate to TS/TSX.
- `src/ui/tui/boot-logo.ts` — keep the existing TypeScript proof-of-concept conversion, using native TS syntax and real
  `.ts` imports.
- `src/ui/tui/chat-session.js` — keep the real-extension import from `./boot-logo.ts`; do not otherwise refactor this
  large TUI Session module.
- `src/shared/collaboration/base64url.js` — migrate to `base64url.ts` as a behavior-preserving leaf conversion.
- `src/shared/collaboration/base64url.test.js` — migrate to `base64url.test.ts` and update imports to the real `.ts`
  extension.
- `src/shared/package-resources.js` — optional second leaf conversion to `package-resources.ts` only if the first canary
  is clean and the change stays syntax-level.
- `src/shared/package-resources.test.js` — optional matching test conversion to `package-resources.test.ts` if
  `package-resources.js` migrates.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `deno.json` — reuse the existing `ci`, `check`, `workspace:check`, `lint`, `test`, and `compile` task structure rather
  than introducing a TypeScript compiler or build pipeline.
- `scripts/check-submodules.js` — reuse the repository-root script style: Deno script with explicit process exits, clear
  stderr messages, small pure helpers, and no new runtime dependency.
- `src/ui/tui/boot-logo.ts` and `src/ui/tui/chat-session.js` — reuse the proven Deno-native interop pattern where JS
  imports TS by its real `.ts` extension.
- `src/shared/collaboration/base64url.js` — use as the primary leaf migration candidate because it is pure, small,
  directly tested, and has no authority over RunWield lifecycle state.
- `src/shared/package-resources.js` — use as an optional second candidate because it has focused tests and a limited
  prompt-resource helper surface, but skip it if package-manager typing introduces semantic churn.

## Implementation Steps

- [ ] Create `docs/adr/013-deno-native-typescript-ratchet.md` with accepted status, covering Deno-native TS, real file
      extensions, no emit/dist pipeline, gradual migration, and the production JS baseline ratchet.
- [ ] Amend `docs/adr/000-initial-tech-stack.md` with a short note under Decision or Consequences stating that ADR-013
      supersedes only the original "Vanilla JavaScript with JSDoc" language decision; keep the Deno runtime decision
      intact.
- [ ] Confirm the existing `src/ui/tui/boot-logo.ts` proof-of-concept and `src/ui/tui/chat-session.js` import remain
      minimal. Do not broaden changes in `chat-session.js` beyond import fallout.
- [ ] Add `scripts/language-policy-baseline.json` containing the sorted list of current production `.js`/`.jsx` paths
      under `src/`, excluding tests and non-production fixtures. Do not include migrated canary paths after migration.
- [ ] Implement `scripts/check-language-policy.js` so it: - resolves paths from the repository root; - discovers current
      production JS/JSX files under `src/`; - excludes `*.test.js`, `*.test.jsx`, obvious fixture directories/files, and
      generated files such as `src/shared/version.js` if appropriate for the repo's existing generated-file policy; -
      compares discovered files with `scripts/language-policy-baseline.json`; - reports "new production JS files" and
      "stale baseline entries" separately with exact paths; - exits `1` on drift and `0` when the baseline matches; -
      optionally supports an explicit `--update` mode if the implementation wants a safe way to regenerate the sorted
      baseline after intentional migrations.
- [ ] Update `deno.json` so `deno task -q ci` runs the language-policy guard before or during validation, preferably
      before the heavier checks for fast feedback.
- [ ] Update `deno.json` so `deno task -q check` directly checks non-Workspace main-code `.ts`/`.tsx` files in addition
      to the existing JS/JSX and script JS roots. Keep `workspace:check` as the Astro-owned check for Workspace TS/TSX,
      and do not require `tsc` or emit output.
- [ ] Migrate `src/shared/collaboration/base64url.js` to `src/shared/collaboration/base64url.ts` with native TS
      parameter/return annotations equivalent to the current JSDoc. Preserve error messages and byte/string behavior.
- [ ] Migrate `src/shared/collaboration/base64url.test.js` to `src/shared/collaboration/base64url.test.ts`, update the
      import to `./base64url.ts`, and keep existing assertions behavior-identical.
- [ ] Update all repository imports/references from `base64url.js` to `base64url.ts` using real file extensions.
- [ ] Remove `src/shared/collaboration/base64url.js` from the language-policy baseline once it no longer exists.
- [ ] Optionally migrate `src/shared/package-resources.js` and `src/shared/package-resources.test.js` to `.ts` if the
      change remains behavior-preserving and does not require package-manager architecture changes. If migrated, update
      real-extension imports/references and remove `src/shared/package-resources.js` from the baseline.
- [ ] Do not migrate high-authority runtime/lifecycle/worktree/session/validation modules in this Plan.

## Verification Plan

- Automated: `deno task -q check`
- Automated: `deno task -q lint`
- Automated: focused tests for migrated modules:
  - `deno test -A src/shared/collaboration/base64url.test.ts`
  - if migrated, `deno test -A src/shared/package-resources.test.ts`
- Automated: `deno run -A scripts/check-language-policy.js`
- Automated: `deno task -q ci`
- Automated: `deno task -q compile`
- Expected result: the language-policy guard passes with the updated baseline, fails if a throwaway new production
  `src/**/*.js` file is added, and fails if a migrated/deleted JS path remains in the baseline.
- Expected result: existing JS files continue to type-check with `checkJs`, new non-Workspace TS/TSX files type-check
  directly, and Workspace TS/TSX remains validated through `deno task -q workspace:check`.
- Expected result: the base64url test behavior is unchanged, including UTF-8 round trips, binary round trips, empty
  values, missing padding, and invalid input rejection.
- Expected result: `deno task -q compile` proves the Deno-native TS/JS mix still compiles into the existing binary path
  without introducing a `tsc` build pipeline or runtime `dist/` output.

## Edge Cases & Considerations

- Existing JS+JSDoc remains valid. The guard should not force unrelated edits to migrate old files.
- The ratchet only works if the baseline shrinks when files migrate. Treat stale baseline entries as CI failures, not
  warnings.
- New tests are allowed to stay JS in this first policy if needed, though TS is preferred when testing a TS module. The
  guard should focus on production source files.
- Scripts remain JS in this first ratchet unless they live under guarded production source paths. This avoids blocking
  small operational scripts while the main application source moves to TS.
- Workspace TS/TSX uses Astro/Vite-specific resolution and should remain covered by `workspace:check`; do not make the
  main Deno check import Workspace TSX directly if that pulls in third-party UI package paths that Astro already owns.
- Keep imports explicit with real extensions. Existing JS may import `.ts`; TS should import remaining JS by `.js` until
  those modules migrate.
- Keep canary migrations behavior-preserving. If TypeScript exposes unclear typing or package-boundary problems, prefer
  stopping after `base64url.ts` rather than expanding this Plan into semantic refactoring.
- No `CONTEXT.md` update is required because this Plan changes language/tooling policy, not RunWield domain language.
