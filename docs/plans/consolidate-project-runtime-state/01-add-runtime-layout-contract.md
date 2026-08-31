---
classification: "PLANNED_CHANGE"
workKind: "MAINTENANCE"
complexity: "MEDIUM"
affectedPaths:
    - "src/constants.js"
    - "src/shared/project-runtime-layout.ts"
    - "src/shared/runwield-owned-paths.ts"
    - "src/shared/project-runtime-layout.test.ts"
    - "src/shared/runwield-owned-paths.test.js"
    - "docs/domain-language.md"
executionAgent: "engineer"
createdAt: "2026-08-29T03:04:53.120Z"
status: "draft"
origin: "internal"
parentPlan: "consolidate-project-runtime-state"
order: 1
dependencies:
    []
planId: "c6e653ec-2b3b-43c3-ad8a-107015520e9f"
targetBranch: "epic/consolidate-project-runtime-state"
---

# Add Runtime Layout Contract

## Context

RunWield currently treats the project `.wld/` directory as both user-derived project configuration and machine-owned
runtime state. The Epic makes `.wld/internal/` the one current project-runtime root, but the code needs a shared
contract before existing stores can move safely.

This child Plan does not move production writers yet. It creates the path vocabulary and classification rules that later
child Plans will use.

## Objective

Add a shared project-runtime layout contract that can answer three questions consistently:

- Where is the primary-checkout internal runtime root?
- Where is the selected-checkout internal runtime root?
- Which Git paths are current runtime state versus legacy runtime hazards?

The result must keep `.wld/settings.json`, `.wld/agents/**`, `.wld/skills/**`, and `.wld/prompts/**` outside the current
runtime classifier.

## Approach

Add `src/shared/project-runtime-layout.ts` as the owner of the storage-layout names and path helpers. Keep the generic
`.wld` directory name in `src/constants.js`, but add an internal directory constant and avoid treating `.wld` itself as
the runtime root.

The intended shape is:

```text
resolveProjectRuntimeLayout(cwd)
  primary.internalRoot  -> <primary>/.wld/internal
  selected.internalRoot -> <selected>/.wld/internal
  paths.registry        -> primary
  paths.planLocks       -> selected
```

The main option set aside is changing `getRunWieldRuntimeDir()` to point at `.wld/internal/` and letting all callers
inherit it. That would be smaller, but it would hide the primary-versus-selected ownership rule that this Epic must
preserve.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/constants.js` — define the internal runtime directory name while preserving test sandbox behavior.
- `src/shared/project-runtime-layout.ts` — add the shared layout types, root resolvers, and named current runtime paths.
- `src/shared/runwield-owned-paths.ts` — split current `.wld/internal/` ownership from the bounded legacy safety
  catalog.
- `src/shared/project-runtime-layout.test.ts` — prove primary and selected checkout path resolution.
- `src/shared/runwield-owned-paths.test.js` — prove current and legacy path classification.
- `docs/domain-language.md` — define the new project-runtime layout terms that this contract makes true.

## Reuse Opportunities

- `src/shared/primary-checkout.ts` — reuse existing primary-checkout resolution.
- `src/constants.js` — reuse `RUNWIELD_DIR_NAME` and test sandbox routing instead of adding direct `Deno.cwd()` or
  `HOME` reads.
- `src/shared/runwield-owned-paths.ts` — reuse normalization and managed-block replacement patterns.

## Implementation Steps

- [ ] `src/constants.js` exports a project internal runtime directory name and still resolves sandboxed test runtime
      paths through the existing sandbox mechanism.
- [ ] `src/shared/project-runtime-layout.ts` owns named path helpers for primary-checkout runtime state and
      selected-checkout runtime state.
- [ ] The layout helpers route controller records, worktree registry files, publication staging, registry migration
      reports, project secrets, and no-home fallback worktrees to the primary internal root.
- [ ] The layout helpers route Plan locks, catalog locks, transition journals, and Work Record supersession locks to the
      selected-checkout internal root.
- [ ] `src/shared/runwield-owned-paths.ts` classifies `.wld/internal/` and all descendants as current runtime state.
- [ ] The legacy runtime hazard catalog remains available for migration and Git safety, but no current classifier treats
      legacy paths as new write targets.
- [ ] `.wld/settings.json`, `.wld/agents/**`, `.wld/skills/**`, and `.wld/prompts/**` are not current runtime paths.
- [ ] `docs/domain-language.md` defines the project-runtime layout terms, avoided aliases, and stable relationships
      without claiming migration is wired yet.
- [ ] Focused tests prove the contract without moving existing production writers.

## Verification Plan

- Automated:
  `deno run -A scripts/run-tests.js src/shared/project-runtime-layout.test.ts src/shared/runwield-owned-paths.test.js src/constants.test.js`.
- Automated: `deno task seams:check`.
- Automated: `deno task ci` must pass before the next child Plan starts.
- Expected result: current runtime classification is one `.wld/internal/` boundary, while user-derived `.wld` project
  files remain trackable by classifier behavior.
- Expected result: no skipped tests are needed in this slice. If implementation discovers a temporary skip is
  unavoidable, it must be named as part of this Epic and carried to the final cleanup slice.
- Glossary check: confirm the glossary describes only the layout contract implemented here and does not claim project
  entry or migration behavior that is not yet wired.

## Edge Cases & Considerations

- Test sandbox routing must not collapse all projects into one lock namespace.
- The contract must not follow symlinks or decide migration safety yet; that belongs to the migration child Plan.
- The temporary branch can be unsafe for release, but this child must still keep CI green.
