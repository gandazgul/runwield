---
classification: "PLANNED_CHANGE"
workKind: "MAINTENANCE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/worktree-registry.js"
    - "src/shared/workflow/controller-registry.ts"
    - "src/shared/workflow/publication-machine.ts"
    - "src/shared/isolated-publication.ts"
    - "src/shared/worktree.js"
    - "src/shared/worktree-registry.test.js"
    - "src/shared/workflow/plan-execution-runtime-boundaries.integration.test.ts"
    - "src/shared/worktree-creation.test.js"
executionAgent: "engineer"
createdAt: "2026-08-29T03:04:55.060Z"
status: "draft"
origin: "internal"
parentPlan: "consolidate-project-runtime-state"
order: 3
dependencies:
    - "02-add-legacy-runtime-migration-engine"
planId: "e7e56bbb-79e1-4d99-8187-de58bdf85aaa"
targetBranch: "epic/consolidate-project-runtime-state"
---

# Move Primary Runtime Stores

## Context

Primary-owned runtime state is shared through the primary checkout. Today, several stores still construct paths under
`.wld/` directly or inherit the old runtime directory. They must move under the primary checkout's `.wld/internal/`
root.

The Epic branch can be unsafe between child Plans, but CI must pass after this slice. Selected-checkout stores can move
in the next child Plan.

## Objective

Move primary-owned runtime readers and writers to the shared internal layout without changing their authority model,
locking rules, revision checks, or publication proof behavior.

## Approach

Change primary-owned stores to ask the layout module for paths instead of constructing `.wld` paths. Do not introduce a
second registry or controller protocol.

Primary ownership after this slice:

```text
primary .wld/internal
  controller/plans/*.json
  worktrees.json
  worktrees.lock
  plan-staging/<attempt>
  worktree-registry-migration-issues.json
  worktrees/              # only no-home fallback
```

The main option set aside is moving primary and selected stores together. The user accepted unsafe middle states on the
Epic branch, so this slice stays smaller and leaves selected-checkout stores for the next child Plan.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/worktree-registry.js` — resolve registry, lock, temp write, and migration-report paths through the primary
  internal root.
- `src/shared/workflow/controller-registry.ts` — move controller records below the primary internal root while
  preserving locks, revisions, and atomic writes.
- `src/shared/workflow/publication-machine.ts` — create new publication staging below the primary internal root.
- `src/shared/isolated-publication.ts` — preserve proof-bearing publication behavior with the new staging path.
- `src/shared/worktree.js` — keep normal `~/.wld/worktrees/`; move only the no-home project fallback below primary
  `.wld/internal/`.
- Registry, controller, publication, and worktree tests — update expected paths and prove no second authority is
  created.

## Reuse Opportunities

- `src/shared/project-runtime-layout.ts` — use the primary-checkout path helpers from the new contract.
- `src/shared/worktree-registry.js` — retain existing registry serialization and CAS-like update behavior.
- `src/shared/workflow/controller-registry.ts` — retain existing OS file locking, revision checks, and atomic writes.
- `src/shared/workflow/publication-machine.ts` — retain monotonic publication phase behavior.

## Implementation Steps

- [ ] Worktree registry reads, writes, locks, temp files, and migration reports are created only below the primary
      checkout internal root.
- [ ] Controller records are created only below the primary checkout internal root and still reject stale writes.
- [ ] Publication staging for new attempts is created only below the primary checkout internal root.
- [ ] Existing publication recovery evidence is still read by absolute paths recorded in the registry and is not
      translated by this slice.
- [ ] Normal home-based execution worktrees still resolve under `~/.wld/worktrees/`.
- [ ] The no-home project fallback for execution worktrees resolves below primary `.wld/internal/`.
- [ ] Linked-worktree fixtures prove primary-shared state has one authority from either primary or execution checkout
      invocation.
- [ ] CI remains green even though selected-checkout runtime stores are not moved until the next child Plan.

## Verification Plan

- Automated:
  `deno run -A scripts/run-tests.js src/shared/worktree-registry.test.js src/shared/workflow/plan-execution-runtime-boundaries.integration.test.ts src/shared/worktree-creation.test.js src/shared/workflow/publication-machine.e2e.test.ts src/shared/isolated-publication.test.ts`.
- Automated: `deno task seams:check`.
- Automated: `deno task ci` must pass before the next child Plan starts.
- Expected result: primary-owned runtime files are observably created below primary `.wld/internal/` and not directly
  below legacy `.wld/`.
- Expected result: selected-checkout legacy paths can still exist at this point only where the next child Plan owns the
  move. Any skipped tests must be marked for final cleanup.

## Edge Cases & Considerations

- Do not change primary-checkout discovery or nested invocation behavior.
- Do not rewrite publication records that contain absolute recovery paths.
- Dirty-path filtering and publication exclusion may still need final policy work in a later child Plan.
