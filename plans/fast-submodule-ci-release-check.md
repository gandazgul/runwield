---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Make per-change CI use fast local submodule integrity checks while reserving remote pin fetchability and binary qualification for the release preflight."
affectedPaths:
    - "deno.json"
    - "scripts/check-submodules.js"
    - "scripts/check-submodules.test.js"
    - "scripts/check-submodule-fetchability.js"
    - "scripts/release-check.js"
    - "scripts/release-check.test.js"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-24T14:05:26-04:00"
updatedAt: "2026-07-24T18:24:10.996Z"
status: "implemented"
origin: "internal"
implementedAt: "2026-07-24T18:24:10.996Z"
executionReport: "- Implemented CI split: `deno task ci` no longer runs `release:check`; `submodules:check` is now fast local initialized/exact-pin/clean validation, and `submodules:check:remote` preserves remote pinned-SHA fetchability.\n- Release preflight now runs remote submodule fetchability before compile, then keeps the existing binary `--version` and review-surface smoke checks.\n- Added tests for local submodule status parsing/checking and release preflight ordering/short-circuit behavior.\n- Verification passed: `deno fmt --check deno.json scripts/check-submodules.js scripts/check-submodules.test.js scripts/check-submodule-fetchability.js scripts/release-check.js scripts/release-check.test.js`; `deno test -A scripts/check-submodules.test.js scripts/release-check.test.js`; `deno task submodules:check`; config inspection confirmed CI has no release/compile stage.\n- Verification failed: `deno task ci` fails in untouched Workspace/review tests (`src/ui/review/review-launcher.test.js`, `src/ui/workspace/workspace.test.js`); baseline comparison with this change stashed reproduced the same 4 failures, so they remain unresolved outside this feature scope."
worktreeStatus: "completed"
---

# Fast Submodule CI and Release Fetchability Check

## Context

`deno task ci` is the source-quality gate run after each change. It currently invokes `submodules:check`, whose
implementation creates temporary bare repositories and fetches every pinned submodule SHA over the network, and then
invokes the much slower `release:check`, which compiles and smoke-tests a standalone RunWield binary. This makes the
ordinary per-change loop pay release-qualification costs and prevents the submodule gate from working offline.

The checks serve different purposes. Ordinary CI can prove from local Git state that every recursive submodule is
initialized, checked out at the superproject's exact gitlink, and clean. Only release qualification needs to prove that
each configured remote can supply its pinned SHA. The compiler itself must remain offline-capable.

## Objective

Keep `deno task ci` as the command run after each change, but make its submodule stage a roughly 0.1–0.2 second local
integrity/hygiene check and remove standalone release compilation from that task. Preserve the existing network-based
fetchability proof in `deno task release:check`, ordered immediately before the existing compile and binary smoke tests.

## Approach

Retain `submodules:check` as the stable fast-CI task name and replace `scripts/check-submodules.js` with a local-only
Git checker. It will inspect recursive submodule status for initialization and exact-pin failures, then inspect each
initialized submodule's porcelain status so staged, unstaged, and untracked changes are all rejected with path-level
diagnostics. It must not fetch, update, initialize, reset, or otherwise mutate repositories.

Move the current fresh-bare-repository fetch implementation into a dedicated `scripts/check-submodule-fetchability.js`
module. Export its entry point and guard command-line execution with `import.meta.main` so `scripts/release-check.js`
can call it directly before creating/compiling the release binary. Also expose a narrowly named task for running the
remote proof independently when diagnosing release readiness.

Refactor only enough command execution/parsing into exported, injectable helpers to test failure classification and
release ordering without performing network fetches or compiling a binary during ordinary tests.

## Files to Modify

- `deno.json` — remove `release:check` from `ci`, retain the fast `submodules:check` stage, and add a standalone task
  for remote submodule fetchability.
- `scripts/check-submodules.js` — replace the remote fetch implementation with recursive, read-only local pin and
  cleanliness validation.
- `scripts/check-submodules.test.js` — add fast tests for clean, uninitialized, wrong-pin/conflicted, staged, unstaged,
  and untracked submodule states and for no-submodule repositories.
- `scripts/check-submodule-fetchability.js` — preserve the current remote SHA fetchability implementation as a
  release-only, importable/CLI-safe module.
- `scripts/release-check.js` — invoke remote submodule fetchability before compilation, leaving compilation and both
  standalone-binary smoke tests unchanged.
- `scripts/release-check.test.js` — verify the remote gate precedes compilation and aborts the remaining release stages
  on failure without performing real fetches or compilation.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `scripts/check-submodules.js` — move its `.gitmodules` parsing, gitlink lookup, temporary bare-repository fetch,
  cleanup, and current diagnostics into the release-only module rather than rewriting their semantics.
- `scripts/release-check.js` — reuse its `run`/`mustRun` failure handling and preserve the current compile, `--version`,
  and Astro review-surface smoke-test sequence.
- `scripts/release-check.test.js` — follow its existing pattern of testing exported release helpers without invoking the
  full standalone build.
- `src/shared/worktree.js` and repository tests — follow the established `Deno.Command("git", ...)` result-decoding and
  temporary Git-fixture conventions while keeping the new scripts self-contained.

## Implementation Steps

- [ ] Update `deno.json` so `ci` ends after the normal test task instead of invoking `release:check`; keep
      `submodules:check` at the start and add `submodules:check:remote` for `scripts/check-submodule-fetchability.js`.
- [ ] Move the existing network-based implementation from `scripts/check-submodules.js` into
      `scripts/check-submodule-fetchability.js`; export its main check, add an `import.meta.main` guard, and preserve
      the behavior when `.gitmodules` is absent, configured URL/gitlink lookup, fresh bare-repository fetches, aggregate
      failure reporting, and temporary-directory cleanup.
- [ ] Implement the new fast `scripts/check-submodules.js` entry point using read-only native Git commands. Inspect
      recursive status prefixes so `-` (uninitialized), `+` (checked out at a SHA other than the recorded gitlink), and
      `U` (conflicted) fail. For every initialized recursive submodule, run porcelain status with all untracked files
      enabled and reject staged, unstaged, or untracked output. Attribute every failure to its submodule path and finish
      with a concise success message.
- [ ] Ensure the local checker passes cleanly when `.gitmodules` is absent or no submodules are configured, does not
      reject unrelated superproject source changes, handles paths recursively, and never invokes network or mutating Git
      operations such as `fetch`, `update`, `init`, `checkout`, `reset`, or `clean`.
- [ ] Import and await the remote fetchability check at the start of `scripts/release-check.js`, before the compile
      command. Preserve the existing standalone binary `--version` and real Astro review-surface smoke checks; a remote
      failure must stop release qualification before compilation begins.
- [ ] Add focused tests around exported parser/check orchestration helpers or lightweight temporary Git fixtures. Cover
      clean exact pins, each recursive status failure prefix, and staged/unstaged/untracked dirt; assert actionable
      paths, no mutation/network command in the fast path, no-submodule success, and release-stage
      short-circuiting/order.

## Verification Plan

- Automated:
  `deno fmt --check deno.json scripts/check-submodules.js scripts/check-submodules.test.js scripts/check-submodule-fetchability.js scripts/release-check.js scripts/release-check.test.js`
- Automated: `deno test -A scripts/check-submodules.test.js scripts/release-check.test.js`
- Automated: `deno task submodules:check`
- Automated: `deno task ci`
- Manual/config inspection: confirm `deno task ci` contains no `release:check`, compile command, or remote-fetch stage,
  while `deno task release:check` enters remote fetchability validation immediately before compilation.
- Expected: an initialized, exact-pin, clean recursive submodule checkout passes fast CI without network access.
- Expected: deinitialized, wrong-pin, conflicted, staged, unstaged, and untracked submodule states each fail fast CI and
  name the offending submodule/path; unrelated changes in the RunWield superproject remain allowed.
- Expected: a remote fetchability failure aborts `release:check` before compilation; a successful remote check continues
  through the unchanged compile, `--version`, and review-surface smoke tests.
- Execution policy matrix:
  - FEATURE Plans may omit `executionAgent`; omission defaults to `engineer` for backward compatibility.
  - FEATURE Plans may set `executionAgent: "engineer"` with `collaborationRecommendation: "autonomous"` or omitted.
    `pair` is invalid for Engineer-owned execution.
  - FEATURE Plans may set `executionAgent: "frontend-engineer"` with `collaborationRecommendation: "autonomous"` or
    `"pair"`.
  - Use `frontend-engineer` for browser-rendered UI work whose primary outcome is materially visual or interactive;
    otherwise use `engineer` (including TUI work and incidental frontend-file edits).
  - Recommend `pair` only when live visual judgment is valuable; use `autonomous` otherwise. Include known dev-server
    hints and exact headed-browser checks. Real-browser verification is mandatory for Frontend Engineer unless
    externally blocked.
  - PROJECT Epics are non-executable containers and must not define `executionAgent` or `collaborationRecommendation`;
    execution policy belongs only on child FEATURE Plans.
  - Legacy `frontend: true` on FEATURE Plans is still accepted as Frontend Engineer/autonomous compatibility metadata,
    but new Plans should use canonical `executionAgent` / `collaborationRecommendation` instead. Legacy
    `frontend: false` remains Engineer compatibility metadata and is distinct from an absent canonical owner.

## Edge Cases & Considerations

- Fast CI proves only local checkout integrity. A locally available exact SHA may still be absent from the configured
  remote; that limitation is intentional and remains covered by the release-only fresh-fetch proof.
- A submodule may be on a branch or detached HEAD; only equality with the recorded gitlink matters.
- Recursive local validation should report nested submodule paths, but this feature preserves the current remote-check
  semantics rather than broadening release fetching beyond commits represented by the existing implementation.
- Status parsing must not confuse ordinary clean-status leading spaces with failure prefixes, and dirty output should
  remain understandable for paths containing spaces.
- The local checker is observational: it must not auto-initialize, repair, reset, or clean a developer's submodule.
- No release workflow change is planned. The GitHub release job already performs a recursive submodule checkout; the
  explicit `release:check` task remains the pre-release/Candidate qualification command rather than an ordinary CI step.
- The existing unrelated modification to `plans/parallel-test-runs.md` must not be edited or overwritten during this
  feature.
