---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/cli.ts"
    - "src/plan-store.js"
    - "src/shared/worktree.js"
    - "src/shared/worktree-registry.js"
    - "src/shared/workflow/"
    - "src/cmd/load-plan/"
    - "src/cmd/plans/"
    - "docs/plans/"
    - "docs/plan-lifecycle.md"
    - "docs/domain-language.md"
    - "docs/prd/runwield-core-prd.md"
executionAgent: "engineer"
createdAt: "2026-09-21T17:14:02.628Z"
status: "draft"
origin: "internal"
parentPlan: "plan-packages-and-independent-validation"
order: 7
dependencies:
    - "03-share-plan-packages-without-content-loss"
    - "06-assemble-and-validate-epics-on-epic-branches"
targetBranch: "epic/plan-packages-and-independent-validation"
planId: "c4664452-908d-4802-8a76-46fcb58b6c1d"
---

# Migrate Legacy Plans and Unfinished Work

## Context

Plan Package support must convert existing repositories without requiring every Plan to finish first. Installation
cannot enumerate repositories, and a one-time global marker would miss old-format Plans introduced by later merges.
Active work can also have different authoritative content in a managed execution or retained worktree than in the
primary checkout.

This child is the rollout boundary after storage, approval, collaboration, validation, repair, and Epic assembly
semantics exist. It keeps conversion support for the parent Epic's agreed version window and does not check out
arbitrary unmanaged branches.

## Objective

On project entry, repeatedly and safely convert legacy Plans in the current checkout and RunWield-managed worktrees into
packages, including unfinished attempts, while preserving identity, user prose, authority, history, collaboration
restrictions, Git and publication evidence, and direct user acceptance.

## Approach

Scan each authoritative checkout independently. Convert one package at a time under current ownership locks with a
journal containing input identity and content, intended paths, and committed output. Extract existing Verification Plan
prose into `validation.md` without strengthening it. Reconcile duplicate shapes only when identity and content
equivalence are proven.

```text
project entry
  -> scan current checkout and managed worktrees
  -> classify each legacy Plan
  -> journal one conversion
  -> commit package or preserve conflict report
  -> continue with unrelated Plans
```

The option set aside is installer-time or one-shot global migration; it cannot handle later merges or
repository-specific worktrees.

## Expected Change Surface

The boundaries below are guidance, not an allowlist: verify the real footprint during implementation and change whatever
the Implementation Steps need, including files not named here. Stop and report only when discovery changes approved
intent — the change reaches another subsystem, public behavior or architecture shifts, migration or compatibility risk
grows, or the Verification Plan no longer proves the objective.

- `src/cli.ts` and project-entry paths discovered during planning — repeatable scan before ordinary Plan operations.
- `src/plan-store.js` — legacy classification, per-package conversion journal, mixed-layout resolution, and conflict
  reports.
- `src/shared/worktree.js` and `src/shared/worktree-registry.js` — authoritative managed-worktree enumeration and
  active-writer coordination.
- `src/shared/workflow/` — preservation of controller generations, repair receipts, lifecycle history, migration return
  to Planner, and stale completion rejection.
- `src/cmd/load-plan/` and `src/cmd/plans/` — notices, conflict presentation, external adoption, and package resolution.
- `docs/plans/` — real repository content affected by the converter must be changed only through the same proven
  conversion semantics, not a special bulk rewrite.
- `docs/plan-lifecycle.md`, `docs/domain-language.md`, and `docs/prd/runwield-core-prd.md` — delivered migration,
  compatibility, and recovery behavior.

## Reuse Opportunities

- Package transactions and journals from the storage child.
- `resolveWorkflowPlanLocation` and existing primary versus execution-worktree authority tests.
- Worktree registry, controller locks, publication machine, and real Git recovery checks.
- Existing external Plan adoption, collaboration ownership, and archive behavior.
- `defineGitFixture` and real temporary Plan projects instead of injected owned machinery.

## Implementation Steps

- Binary project entry scans the current checkout and registered RunWield-managed execution and retained worktrees; the
  installer and update command do not own repository conversion.
- Discovery is repeatable and per checkout, so a completed second run makes no changes and a later merge containing a
  legacy Plan is converted on the next entry.
- Each package conversion records input identity and content, intended paths, authoritative checkout, and committed
  output in a recoverable journal; readers never observe a half package.
- One conflict or unsafe active writer pauses only the affected package, preserves all inputs, and does not reverse
  unrelated completed conversions.
- Execution or retained-worktree Plan content remains authoritative over a stale primary copy, and identity, names,
  relationships, archive membership, Session handoff, controller generations, repair receipts, and worktree identity
  survive movement.
- Existing Verification Plan prose is extracted into `validation.md` without rewriting requirements; retained approval
  requires explicit equivalence evidence between old approved content and the new authored package revision.
- An unfinished Plan with missing or ambiguous verification is converted, preserves code and attempt history, and
  receives a durable migration return to Planner that prevents automatic resumption until a new contract is approved.
- Completed and archived Plans retain historical outcomes and do not reopen because they lack a new contract; reopening
  for new execution requires ordinary planning and approval.
- A legacy file and package are reconciled only when identity and content equivalence are proven; different content,
  destination identity, or Git conflict preserves both and creates a local report.
- Remote-canonical packages retain collaboration ownership and cannot be published by local migration.
- Existing publication receipts remain historical evidence for their actual commits and paths; conversion never broadens
  allowed paths, manufactures a new seal, publishes twice, or cleans up twice.
- Unmanaged refs and worktrees remain untouched, and notices explain that opening them later with `wld` runs the same
  scan.
- Core authoring, lifecycle, validation recovery, and external adoption requirements and scenarios match delivered
  repeatable migration and planning return behavior.
- The glossary defines package conversion and migration return, distinguishes them from adoption and Plan defect, and
  records stable authority relationships.

## Verification Plan

- Automated: use `deno run -A scripts/run-tests.js` with new focused migration integration tests plus
  `src/shared/workflow/plan-document-authority.integration.test.ts`,
  `src/shared/workflow/authority-continuation.integration.test.ts`, and publication recovery tests after verifying
  actual paths.
- Automated: convert a current checkout and unfinished managed-worktree attempt, run entry twice, and prove the second
  run is a no-op with authority and generations unchanged.
- Automated: perform a real Git merge that introduces a legacy Plan after an earlier scan and prove the next entry
  converts it.
- Automated: inject interruption at each package transaction and publication-reconciliation boundary; prove user edits,
  real delivery effects, and historical receipts remain truthful.
- Automated: prove one conflict preserves both inputs while unrelated conversions commit, and an active old writer
  cannot race conversion.
- Automated: prove missing or ambiguous verification returns unfinished work to Planner without losing code, while
  direct `user_validated` remains available and completed work stays closed.
- Automated: prove remote-canonical ownership and managed versus unmanaged worktree boundaries remain enforced.
- Automated: run `deno task seams:check` and `deno task ci`.
- Manual: open a disposable repository containing active, completed, archived, conflicting, shared, and later-merged
  legacy Plans; inspect conversion reports and reopen the active attempt.
- Documentation: confirm lifecycle, glossary, release compatibility notice, and Core PRD match the delivered support
  window without claiming unmanaged refs were converted.

## Edge Cases

- Old processes can write files outside current locks; conversion must check expected content immediately before commit.
- A status alone does not prove an unfinished checkout is idle.
- Modification time, path shape, or primary checkout location cannot select a winner between differing copies.
- Historical byte hashes are receipts, not the new authored specification revision.
- Large catalogs need bounded scanning and measured startup cost without a suppressive global completion marker.
