---
classification: "PLANNED_CHANGE"
workKind: "MAINTENANCE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/runwield-owned-paths.ts"
    - "src/shared/worktree.js"
    - "src/shared/workflow/execution-start.ts"
    - "src/shared/workflow/validation-publication.ts"
    - "src/shared/isolated-publication.ts"
    - "src/shared/worktree-runtime-state-isolation.test.js"
    - "src/shared/runwield-owned-paths.test.js"
    - "src/shared/worktree-merge.test.js"
    - "src/shared/workflow/publication-machine.e2e.test.ts"
executionAgent: "engineer"
createdAt: "2026-08-29T03:04:59.963Z"
status: "draft"
origin: "internal"
parentPlan: "consolidate-project-runtime-state"
order: 7
dependencies:
    - "06-wire-project-entry-guards"
targetBranch: "epic/consolidate-project-runtime-state"
---

# Enforce Git and Publication Safety

## Context

The old `.gitignore` contract enumerates many runtime paths under `.wld/`. The Epic requires one current ignored
boundary, `.wld/internal/`, while user-derived `.wld` files stay trackable. Git safety must also keep known legacy
runtime hazards out of staging and publication.

The previous child Plans moved runtime stores and wired entry guards. This child Plan makes repository and publication
policy match the new layout.

## Objective

Ensure current runtime state and known legacy runtime hazards cannot enter implementation commits or publication
commits, while `.wld/settings.json`, local Agents, Skills, and prompts remain eligible repository changes.

## Approach

Update the current runtime classifier, legacy safety classifier, `.gitignore` managed block, dirty-path filtering,
checkpoint staging, tracked-runtime cleanup, and publication protection together.

Policy shape:

```text
current runtime: .wld/internal/**      -> ignored and excluded
legacy hazard:   old .wld runtime set -> excluded/refusal/diagnostic only
user config:     .wld/settings.json   -> trackable
```

The main option set aside is ignoring all of `.wld/`. That would be simple, but it would hide project settings, local
Agents, local Skills, and prompts from Git.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/runwield-owned-paths.ts` — generate one `.wld/internal/` managed ignore entry and expose current/legacy
  safety classification.
- `src/shared/worktree.js` — update dirty-path filtering, checkpoint staging, cleanup, and merge protection to use
  current and legacy classifiers correctly.
- `src/shared/workflow/execution-start.ts` — ensure the managed ignore block is reconciled at the right execution
  boundary.
- `src/shared/workflow/validation-publication.ts` and `src/shared/isolated-publication.ts` — prevent runtime paths from
  entering publication commits.
- Runtime isolation, merge, publication, and owned-path tests — prove current internal state and recognized legacy
  hazards stay out of Git.

## Reuse Opportunities

- `src/shared/runwield-owned-paths.ts` — reuse managed-block replacement and path normalization.
- `src/shared/worktree.js` — reuse existing staging and merge-protection code paths.
- `src/shared/git-test-fixture.ts` — use real Git fixtures for tracked, staged, intent-to-add, renamed, deleted, and
  ignored paths.

## Implementation Steps

- [ ] The generated managed `.gitignore` block contains exactly `.wld/internal/` between the RunWield markers.
- [ ] Exact obsolete RunWield runtime lines and duplicates are removed or replaced when RunWield owns them, while
      unrelated user content remains byte-equivalent except for necessary newline normalization around the managed
      block.
- [ ] A broad user-authored `.wld/` ignore rule is reported but not removed automatically.
- [ ] Current `.wld/internal/**` state is ignored and excluded from checkpoint, validation, and publication commits.
- [ ] Known legacy runtime hazards are not normal write targets but are still excluded from staging and publication or
      cause explicit refusal when tracked.
- [ ] `.wld/settings.json`, `.wld/agents/**`, `.wld/skills/**`, and `.wld/prompts/**` remain eligible repository changes
      in real Git fixtures.
- [ ] Runtime paths that are untracked, tracked, staged, intent-to-add, renamed, and deleted are covered by real Git
      tests.
- [ ] Production source contains no current direct write target for the known pre-0.10.0 project runtime paths outside
      legacy migration/safety, diagnostics, tests, or historical docs.

## Verification Plan

- Automated:
  `deno run -A scripts/run-tests.js src/shared/runwield-owned-paths.test.js src/shared/worktree-runtime-state-isolation.test.js src/shared/worktree-merge.test.js src/shared/workflow/publication-machine.e2e.test.ts src/shared/isolated-publication.test.ts src/shared/workflow/validation-publication.ts`.
- Automated: run a source check for known legacy write targets and confirm remaining references are limited to
  migration/safety, diagnostics, tests, and historical documentation.
- Automated: `deno task seams:check`.
- Automated: `deno task ci` must pass before the next child Plan starts.
- Expected result: current and legacy runtime state cannot enter implementation or publication commits, while
  user-derived `.wld` files can be staged.
- Expected result: any temporary skipped tests must be marked for this Epic and resolved by the final cleanup slice.

## Edge Cases & Considerations

- `.gitignore` does not untrack files already in Git. Tracked runtime state must become an explicit refusal or
  diagnostic.
- A user broad-ignore rule may be intentional; report it rather than deleting it without user authority.
- Renames and deletions of tracked runtime files are still repository changes and must not be silently published as
  feature work.
