---
classification: "PLANNED_CHANGE"
workKind: "MAINTENANCE"
complexity: "MEDIUM"
affectedPaths:
    - "src/cmd/plans/doctor.ts"
    - "src/cmd/plans/doctor.test.ts"
    - "src/cmd/plans/doctor-messages.test.ts"
    - "docs/architecture.md"
    - "docs/plan-lifecycle.md"
    - "docs/collaboration.md"
    - "docs/validation-authority.md"
    - "docs/adr/005-concurrent-worktree-isolation.md"
    - "docs/adr/016-proof-bearing-publication-state-machine.md"
    - "docs/adr/017-project-runtime-state-under-wld-internal.md"
    - "docs/domain-language.md"
executionAgent: "engineer"
createdAt: "2026-08-29T03:05:00.286Z"
status: "draft"
origin: "internal"
parentPlan: "consolidate-project-runtime-state"
order: 8
dependencies:
    - "07-enforce-git-and-publication-safety"
planId: "6ec4a242-ca8e-4d00-ba74-fe141b7159a7"
targetBranch: "epic/consolidate-project-runtime-state"
---

# Update Doctor Documentation and Final Test Cleanup

## Context

The earlier child Plans implement the runtime layout, migration, moved stores, entry guards, and Git safety. The final
slice must make the behavior understandable and prove no temporary test skip remains for this Epic.

Plan Doctor and docs must explain blocked migration, tracked legacy files, broad ignore rules, committed secrets, stale
locks, unsupported old-writer activity, and active-publication upgrade stops without deleting uncertain state.

## Objective

Finish the Epic branch so it is ready for final delivery to `main`: diagnostics are actionable, docs name the new
canonical paths, ADRs stay consistent, and CI passes with no temporary skipped tests from this Epic.

## Approach

Update diagnostics and docs after behavior exists, then run a final cleanup pass over tests introduced or skipped during
the child sequence.

The final user-facing story should be:

```text
.wld/settings.json, agents, skills, prompts -> user-trackable project content
.wld/internal/**                            -> RunWield machine-owned runtime state
legacy runtime paths                        -> migration/safety hazards only
```

The main option set aside is making documentation a separate ninth child Plan. Keeping final docs and test cleanup
together makes this the clear release-readiness slice.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/cmd/plans/doctor.ts` — report migration blocks, conflicts, broad `.wld/` ignore rules, tracked legacy files,
  committed secrets, stale locks, and unsupported old-writer activity.
- `src/cmd/plans/doctor.test.ts` and `src/cmd/plans/doctor-messages.test.ts` — prove the diagnostic messages are
  specific and non-destructive.
- `docs/architecture.md` — describe the new project-runtime boundary and authority split.
- `docs/plan-lifecycle.md` — describe Plan locks, transition journals, controller records, and registry locations under
  the new layout.
- `docs/collaboration.md` — describe project-local and global secret store locations and cleanup/security guidance.
- `docs/validation-authority.md` — describe validation and publication authority with the new internal paths.
- `docs/adr/005-concurrent-worktree-isolation.md` and `docs/adr/016-proof-bearing-publication-state-machine.md` — retain
  decisions but name the new canonical locations.
- `docs/adr/017-project-runtime-state-under-wld-internal.md` — keep the accepted decision aligned with implementation
  details if needed.
- `docs/domain-language.md` — reconcile glossary terms with implemented behavior.
- Tests changed during this Epic — remove any temporary skip or ignore markers introduced to keep intermediate slices
  green.

## Reuse Opportunities

- `src/cmd/plans/doctor.ts` — reuse existing diagnostic structure and recovery-action style.
- `src/shared/project-runtime-layout.ts` — reuse migration refusal result details instead of duplicating path and
  conflict detection.
- Existing documentation pages and ADRs — update canonical paths without reopening accepted decisions.

## Implementation Steps

- [ ] Plan Doctor reports blocked migration and gives pre-0.10.0 recovery guidance for unfinished publication or repair
      state.
- [ ] Plan Doctor reports old/new authority conflicts, tracked current or legacy runtime authority files, tracked
      project collaboration secrets, broad `.wld/` ignore rules, stale locks, live legacy writer evidence, and symlink
      hazards without deleting uncertain state.
- [ ] Plan Doctor messages name exact paths needed for cleanup and redact secrets.
- [ ] Architecture, lifecycle, validation-authority, collaboration, and troubleshooting or release-facing docs describe
      `.wld/internal/` as the machine-owned project-runtime boundary.
- [ ] ADR-005 and ADR-016 retain their decisions but name the new canonical runtime locations.
- [ ] ADR-017 remains consistent with the final implementation.
- [ ] `docs/domain-language.md` contains the final terms, avoided aliases, and stable relationships made true by this
      Epic, without duplicate or speculative terms.
- [ ] Every temporary skipped, ignored, or TODO-marked test introduced for `consolidate-project-runtime-state` is
      unskipped, fixed, or removed because it is no longer needed.
- [ ] Final CI passes with the full runtime migration, path ownership, Git safety, Doctor, Session Runtime, ACP, Init,
      collaboration, and golden TUI coverage active.

## Verification Plan

- Automated:
  `deno run -A scripts/run-tests.js src/cmd/plans/doctor.test.ts src/cmd/plans/doctor-messages.test.ts src/shared/project-runtime-layout.test.ts src/shared/runwield-owned-paths.test.js src/shared/worktree-runtime-state-isolation.test.js src/shared/session/session-runtime.test.js src/acp/server.test.js src/cmd/init/index.test.ts src/cmd/plans/collaboration-commands.integration.test.ts`.
- Automated: search for temporary skip or ignore markers tied to `consolidate-project-runtime-state`; none remain.
- Automated: `deno task seams:check`.
- Automated: `deno task ci`.
- Manual: in a disposable Git project with inactive legacy runtime state and custom `.gitignore` content, start 0.10.0,
  confirm one migration, inspect retained settings/Skills/prompts, and confirm a second start makes no filesystem
  changes.
- Manual: in a disposable project with saved unfinished publication conflict, start 0.10.0 and confirm it stops before
  moving or editing any runtime file and gives pre-0.10.0 recovery guidance.
- Manual: invoke from the primary checkout and a linked execution worktree. Confirm primary-shared state has one
  authority and selected-document locks and journals stay with the selected checkout.
- Expected result: docs and diagnostics describe the implemented behavior, not intermediate unsafe branch states.
- Glossary check: confirm behavior and glossary land together.

## Edge Cases & Considerations

- Do not remove a user's broad `.wld/` ignore rule automatically.
- Do not claim tracked secrets are made safe by moving them; explain rotation and repository-history remediation can be
  required.
- Documentation must distinguish project-local runtime state from global `~/.wld` state.
- This final slice is the place to remove temporary skips from earlier slices; after it, the Epic branch should be ready
  for final delivery review.
