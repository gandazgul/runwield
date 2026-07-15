---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Generate approved internal Work Records from completed top-level FEATURE Plans and PROJECT Epics, write Plan backlinks, and add explicit backfill with preview and confirmation. This enables on-demand/backfill creation without session-end automation."
affectedPaths:
    - "src/constants.js"
    - "src/plan-store.js"
    - "src/shared/work-records/"
    - "src/shared/session/session.js"
    - "src/agent-definitions/recorder.md"
    - "src/cmd/wr/"
    - "src/cmd/registry.js"
    - "docs/work-records/"
frontend: false
createdAt: "2026-07-15T21:05:36.852Z"
updatedAt: "2026-07-15T21:05:36.852Z"
status: "draft"
origin: "internal"
parentPlan: "work-records-v1"
order: 2
dependencies:
    - "01-work-record-store-lifecycle-plan-metadata-and-list-cli"
---

# Recorder Generation and Backfill

## Context

After the canonical Work Record store exists, RunWield needs a way to produce approved internal Work Records from
completed planned work. V1 generation is limited to completed top-level FEATURE Plans and PROJECT Epics. Child FEATURE
Plans under an Epic should not generate separate records by default; broad Epic work should be represented by the parent
Epic Work Record.

This slice builds generation and explicit backfill. It does not hook generation to `/new` or `/quit`; session-boundary
scheduling belongs to the later automation slice.

## Objective

Add internal Recorder generation for Work Records, including eligibility detection, top-level/Epic resolution, concise
retrospective body generation, canonical Markdown write, and durable Plan backlink success/failure metadata. Add
`wld wr backfill` to preview eligible completed active and archived Plans, require human confirmation, generate missing
records, and record per-Plan outcomes.

## Approach

Build a narrow Work Record generation service under `src/shared/work-records/` that accepts source Plan identity and
produces or skips a canonical approved internal Work Record. Keep Plan storage/lifecycle independent: generation should
read Plan metadata and update neutral backlinks, but Work Record modules own eligibility, generation semantics, and
failure handling.

Use a Recorder boundary for the retrospective text. The implementation may use a bundled `recorder.md` Agent Definition
or a workflow-owned prompt, but callers should depend only on a generation function that returns structured
success/failure. Generated records should be concise, include completion confidence, and include skipped-verification
warnings and closure reasons when relevant.

Backfill should be explicit and maintenance-oriented: scan active and archived Plans, preview eligible sources, skip
existing backlinks, require confirmation, and proceed record-by-record so one failure does not corrupt other records.

## Files to Modify

- `src/constants.js` — add Recorder Agent identifier or generation constants if needed.
- `src/plan-store.js` — reuse active/archived Plan load/update helpers and add any safe backlink update support required
  for archived Plans.
- `src/shared/work-records/` — add source Plan eligibility, top-level/Epic resolution, Recorder prompt/generation
  orchestration, Work Record body construction, backlink update helpers, failure recording, and backfill services.
- `src/shared/session/session.js` — support Recorder invocation only if generation uses a bundled agent session path.
- `src/agent-definitions/recorder.md` — add the Recorder role contract for internal Work Record generation, or document
  why a workflow-owned prompt is used while preserving the same boundary.
- `src/cmd/wr/` — add `backfill` command parsing, preview output, confirmation handling, and per-source result
  reporting.
- `src/cmd/registry.js` — update Work Record command help/usage for `backfill`.
- `docs/work-records/` — receive generated canonical Work Record Markdown artifacts during manual/backfill use.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `listPlans()`, `listArchivedPlans()`, `loadPlan()`, `loadArchivedPlan()`, `updatePlanFrontMatter()`, and archived Plan
  helpers from `src/plan-store.js` — source discovery and backlink persistence.
- `groupPlanHierarchy()`, `isChildFeaturePlan()`, and `isEpicPlan()` from `src/plan-store.js` — child FEATURE exclusion
  and parent Epic resolution.
- `src/shared/workflow/plan-lifecycle.js` — terminal status and Epic done-enough semantics.
- `src/cmd/plans/archive.js` — bulk command preview/result patterns and test dependency injection.
- Work Record parser/formatter/store from slice 1 — canonical Markdown write and validation before persistence.
- Existing agent-session construction in `src/shared/session/session.js` — only if Recorder uses a bundled Agent
  Definition.

## Implementation Steps

- [ ] Step 1: Add Work Record source eligibility helpers for completed top-level FEATURE Plans and PROJECT Epics,
      including `verified`, `closed_without_verification`, and PROJECT `epicCompletionMode: done_enough`.
- [ ] Step 2: Add child FEATURE resolution so automatic/backfill generation skips child Plans by default and resolves
      child work to the parent Epic where appropriate.
- [ ] Step 3: Implement generation orchestration that loads source Plan context, derives `scope`, `origin`,
      `completionMode`, provenance source Plan IDs, title, Summary, Deferred Work, and Future Planning Notes when
      meaningful.
- [ ] Step 4: Add the Recorder boundary for generation, using either `src/agent-definitions/recorder.md` or a
      workflow-owned prompt while keeping the public generation service stable.
- [ ] Step 5: Write generated Work Records as `status: approved`, `origin: internal`, flat files under
      `docs/work-records/`, validating before write and treating Markdown as canonical.
- [ ] Step 6: Update source Plan `workRecord` metadata with `status: generated`, `recordId`, `path`, and `lastAttemptAt`
      on success.
- [ ] Step 7: Record generation failures on the source Plan as `workRecord.status: failed`, `lastAttemptAt`, and a
      concise `error`, without rolling back terminal Plan status.
- [ ] Step 8: Implement `wld wr backfill` with active + archived Plan scan, existing-backlink skip, eligible-source
      preview, confirmation requirement, per-Plan generation, and per-Plan success/failure output.
- [ ] Step 9: Add tests for eligibility, child exclusion, Epic done-enough records, closed-without-verification reason
      fallback, backlink updates, generation failure handling, archived Plan backfill, and command confirmation
      behavior.

## Verification Plan

- Automated: `deno test -A src/shared/work-records/**/*.test.js src/cmd/wr/**/*.test.js`
- Automated: `deno test -A src/plan-store.test.js src/shared/workflow/plan-lifecycle.test.js`
- Automated: `deno task ci`
- Manual: Fixture a verified standalone FEATURE Plan and run `wld wr backfill`; confirm preview appears, confirmation is
  required, one approved Work Record is written under `docs/work-records/`, and the source Plan receives a generated
  backlink.
- Manual: Fixture a PROJECT Epic marked done enough with child FEATURE Plans; confirm backfill generates one Epic Work
  Record for the Epic and not one record per child.
- Manual: Fixture a `closed_without_verification` Plan with a reason; confirm generated Summary prominently says
  RunWield verification was skipped and includes the reason.
- Manual: Fixture a legacy `closed_without_verification` Plan without a reason; confirm generation succeeds and uses
  `Reason not specified.`.
- Manual: Simulate Recorder or write failure; confirm terminal Plan status is unchanged and Plan front matter records
  concise failure metadata.
- Expected result: Backfill can produce useful approved internal Work Records from eligible completed Plans while
  skipping ineligible/already-linked sources and preserving canonical Markdown integrity.

## Edge Cases & Considerations

- Backfill should skip Plans with any existing `workRecord` backlink unless a future explicit repair/retry option is
  added.
- Archived Plans need safe backlink updates without losing archive metadata.
- Generation should not require code evidence for every internal record; source Plans are sufficient provenance in V1.
- Closed-without-verification records must never imply Workflow Validation passed.
- Recorder output should stay concise and retrospective; do not duplicate the full source Plan intent or implementation
  diary.
- This slice should not build the Mnemosyne index, expose agent retrieval tools, or schedule generation on `/new` or
  `/quit`.
