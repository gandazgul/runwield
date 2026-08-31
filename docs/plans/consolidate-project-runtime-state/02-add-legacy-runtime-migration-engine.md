---
classification: "PLANNED_CHANGE"
workKind: "MAINTENANCE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/project-runtime-layout.ts"
    - "src/shared/runwield-owned-paths.ts"
    - "src/shared/worktree-registry.js"
    - "src/shared/workflow/publication-machine.ts"
    - "src/shared/project-runtime-layout.test.ts"
    - "src/shared/worktree-registry.test.js"
    - "src/shared/workflow/publication-machine.e2e.test.ts"
executionAgent: "engineer"
createdAt: "2026-08-29T03:04:53.911Z"
status: "draft"
origin: "internal"
parentPlan: "consolidate-project-runtime-state"
order: 2
dependencies:
    - "01-add-runtime-layout-contract"
planId: "6412559b-2b74-4121-bb1c-f7c1d5e6d793"
targetBranch: "epic/consolidate-project-runtime-state"
---

# Add Legacy Runtime Migration Engine

## Context

Version 0.10.0 must adopt inactive project-local runtime state from legacy `.wld/` paths into `.wld/internal/`. It must
stop without changing files when the old state is active, ambiguous, tracked, symlinked, or tied to unfinished
publication recovery.

The previous child Plan created the layout contract. This child Plan adds the migration engine, but does not need every
command surface to call it yet.

## Objective

Implement a serialized, durable, idempotent migration that can run before normal project runtime access. The engine must
preserve primary-checkout and selected-checkout ownership and must never silently merge two authorities.

## Approach

Keep migration in the layout owner so stores and command surfaces share one result type. Migration should use real
filesystem and Git evidence, not Plan status guesses.

A safe flow is:

```text
enter project runtime
  acquire migration lock
  hold legacy registry lock
  preflight legacy and new authorities
  refuse before mutation if unsafe
  adopt inactive runtime leaves
  write marker and adopted selected roots
  reconcile gitignore later in the owning child
```

The main option set aside is translating unfinished publication recovery into the new layout. That could make upgrades
smoother, but it risks losing the authority for validated unpublished work if a process stops mid-translation.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/project-runtime-layout.ts` — add migration lock, marker manifest, phase recovery, preflight, adoption, and
  refusal results.
- `src/shared/runwield-owned-paths.ts` — provide the bounded legacy hazard list used by migration.
- `src/shared/worktree-registry.js` — expose or reuse registry inspection needed to detect unfinished publication and
  repair state.
- `src/shared/workflow/publication-machine.ts` — expose proof-bearing publication phase information to migration without
  changing active recovery paths.
- `src/shared/project-runtime-layout.test.ts` — cover inactive adoption, conflict refusal, live-writer refusal, symlink
  refusal, marker version checks, and restart recovery.
- `src/shared/worktree-registry.test.js` and publication tests — prove registry/publication blockers use real stored
  evidence.

## Reuse Opportunities

- `src/shared/worktree-registry.js` — reuse serialization, atomic rename, directory sync, lock recovery, and ambiguity
  handling.
- `src/shared/workflow/controller-registry.ts` — reuse controller lock behavior when distinguishing stale lock files
  from live writers.
- `src/shared/workflow/publication-machine.ts` — reuse publication phases and cleanup evidence.
- `src/shared/git.js` and `src/shared/git-test-fixture.ts` — use real Git fixtures for tracked-file and symlink checks.

## Implementation Steps

- [ ] A single project migration lock serializes layout adoption for the primary checkout and selected checkout roots.
- [ ] Migration records durable phase evidence so a process stop after each filesystem effect can resume or refuse
      deterministically.
- [ ] The primary marker records the layout version and adopted selected checkout roots.
- [ ] An inactive legacy fixture migrates once, preserves bytes and restrictive permissions where applicable, retires
      live legacy stores, and is byte-stable on a second entry.
- [ ] A marker newer than the running code understands is rejected without mutation.
- [ ] Any valid non-cleaned publication phase, saved repair root, malformed or unreadable legacy registry, or
      unsupported publication record shape refuses before directory creation, rename, marker write, or `.gitignore`
      write.
- [ ] Old and new authorities populated independently refuse without merge, overwrite, or deletion.
- [ ] Tracked runtime authorities, tracked project collaboration secrets, symlinks at `.wld/internal/`, symlinks at
      legacy authority paths, and live legacy locks refuse without reading or writing outside the applicable checkout.
- [ ] The legacy registry lock is held from publication preflight through durable marker commit and retirement of legacy
      authoritative data, then released before its obsolete lock file is retired.
- [ ] Focused tests use real filesystem and Git fixtures and do not add dependency-injection seams.

## Verification Plan

- Automated:
  `deno run -A scripts/run-tests.js src/shared/project-runtime-layout.test.ts src/shared/worktree-registry.test.js src/shared/workflow/publication-machine.e2e.test.ts src/shared/worktree-registry-restore.test.js`.
- Automated: `deno task seams:check`.
- Automated: `deno task ci` must pass before the next child Plan starts.
- Expected result: safe inactive projects migrate once, and unsafe projects stop before mutation with machine-readable
  refusal information.
- Expected result: any temporary skipped tests must be clearly marked as part of `consolidate-project-runtime-state` and
  must not hide changed behavior that this child owns.

## Edge Cases & Considerations

- Cross-device moves must not be assumed. If copy fallback exists, it must write, sync, verify, and only then retire the
  source.
- Persistent but unlocked controller lock files must not counterfeit a live writer.
- Registered execution worktrees can contain selected-checkout legacy journals and must be included when known.
- Downgrade and mixed 0.9/0.10 use remain unsupported after adoption.
