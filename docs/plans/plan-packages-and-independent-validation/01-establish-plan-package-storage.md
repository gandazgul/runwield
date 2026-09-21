---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/plan-store.js"
    - "src/plan-front-matter.js"
    - "src/shared/epic-artifacts.ts"
    - "src/cmd/plans/archive.ts"
    - "src/cmd/plans/prune.ts"
    - "docs/domain-language.md"
    - "docs/prd/runwield-core-prd.md"
executionAgent: "engineer"
createdAt: "2026-09-21T17:13:55.346Z"
status: "draft"
origin: "internal"
parentPlan: "plan-packages-and-independent-validation"
order: 1
dependencies:
    []
targetBranch: "epic/plan-packages-and-independent-validation"
planId: "3ed23b44-0cd8-491d-9ff6-600e156ed8f9"
---

# Establish Plan Package Storage

## Context

RunWield currently treats one Markdown file as a complete Plan. Companion files would therefore be cataloged as separate
Plans, and callers independently derive identity, revisions, paths, and archive scope. The parent Epic requires one
package boundary before approval, collaboration, validation, migration, or UI code can safely use multiple Plan
documents.

This child delivers the storage foundation only. It keeps legacy Plans readable and does not perform automatic
repository conversion; a later child owns migration after the complete package contract exists. It updates the Core Plan
authoring and external adoption capability without claiming that independent Validator behavior is delivered.

## Objective

Make a directory containing canonical `plan.md` the authoritative Plan Package while preserving existing Plan identity
and compatibility. The Plan store must own package membership, content and write revisions, atomic multi-document saves,
discovery, direct-edit detection, archive scope, and recovery from interrupted writes.

## Approach

Add a package aggregate to `plan-store.js` and route existing single-document helpers through it. Separate the authored
specification revision from byte revisions used for concurrent-write protection. Commit package updates under existing
locks with a durable journal so readers resolve either the prior committed file set or the next one, never a
half-written mixture.

```text
caller
  -> load/save package
  -> validate identity and expected revisions
  -> stage complete file set
  -> commit journaled package revision
  -> expose committed package
```

Keep legacy files as a supported input shape during the transition. The option set aside is a directory rename plus
sequential file writes; that would catalog companion files incorrectly and expose partial approval state after
interruption.

## Expected Change Surface

The boundaries below are guidance, not an allowlist: verify the real footprint during implementation and change whatever
the Implementation Steps need, including files not named here. Stop and report only when discovery changes approved
intent — the change reaches another subsystem, public behavior or architecture shifts, migration or compatibility risk
grows, or the Verification Plan no longer proves the objective.

- `src/plan-store.js` — package paths, membership, revisions, transactions, discovery, direct edits, archive, restore,
  and prune behavior.
- `src/plan-front-matter.js` — package-compatible metadata parsing and preservation where responsibility is not already
  in the store.
- `src/shared/epic-artifacts.ts` — explicit package-owned authored and generated artifacts instead of filename
  recursion.
- `src/cmd/plans/archive.ts` and `src/cmd/plans/prune.ts` — operate on selected package units without recursively taking
  unrelated child packages.
- `docs/domain-language.md` — define Plan Package and related stable storage terms when implementation makes them true.
- `docs/prd/runwield-core-prd.md` — update Plan authoring and external adoption requirements and scenarios for delivered
  package storage.

## Reuse Opportunities

- `src/plan-store.js` — existing locks, atomic file writes, identity checks, stale-write errors, and archive selection.
- `src/shared/workflow/state-transition.ts` — owned journaling and rollback patterns.
- `src/shared/epic-artifacts.ts` — current explicit Epic artifact registration.
- `src/testing/` fixtures — real temporary Plan projects rather than an injected Plan-store seam.

## Implementation Steps

- The Plan store exposes one package interface whose canonical identity is the directory containing `plan.md`; companion
  Markdown never appears as a separate catalog Plan.
- The package model distinguishes authored documents, generated artifacts, and child packages, and preserves unfamiliar
  authored metadata instead of filtering it away.
- Authored specification revisions use canonical authored content, while independent byte revisions continue to reject
  stale concurrent writes.
- A complete package update is committed under existing locks and a durable journal; recovery finishes or restores only
  writes proven to belong to that transaction, and unexpected external edits remain intact.
- Existing load, save, list, resource lookup, hierarchy, and direct Markdown edit paths resolve legacy files and package
  directories through the store rather than adding a second execution implementation.
- Archive, restore, and prune act on explicitly selected package-owned artifacts; selecting a parent does not implicitly
  move or delete unselected child packages.
- Core Plan authoring requirements and acceptance scenarios match the delivered package behavior, with later approval,
  validation, collaboration, and migration outcomes still marked target.
- `docs/domain-language.md` defines the implemented Plan Package storage terms, avoided aliases, and stable relationship
  between package identity, `planId`, authored documents, and generated artifacts.

## Verification Plan

- Automated: run focused storage and archive tests through
  `deno run -A scripts/run-tests.js src/plan-store.test.js src/shared/epic-artifacts.test.ts src/cmd/plans/archive.test.ts src/cmd/plans/prune.test.ts`.
- Automated: add crash-point tests around package staging and commit that fail if a reader can observe mixed old and new
  documents or recovery overwrites an external edit.
- Automated: prove `validation.md`, generated QA, and reports are not cataloged as Plans; prove names and `planId`
  survive package operations.
- Automated: prove parent archive and prune leave an unselected child package intact and report each explicitly selected
  result.
- Automated: run `deno task seams:check` and `deno task ci`.
- Manual: create a package, edit an authored companion outside RunWield, reload it, and confirm the change is detected
  without losing custom metadata.
- Documentation: confirm the Core PRD and glossary describe only the storage behavior delivered by this child.

## Edge Cases

- Mixed legacy-file and package layouts must remain readable until migration completes.
- A directory without canonical `plan.md` is a container, not a Plan Package.
- A child package can remain below a directory whose parent package is archived or absent.
- Locks do not control arbitrary editors or old binaries; expected revisions and ownership evidence must preserve their
  writes.
- Package transactions are RunWield-owned machinery and must not introduce an injection seam.
