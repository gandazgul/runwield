---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Establish canonical Work Record Markdown storage, state validation, Plan front matter extensions, close-without-verification reason enforcement, Workspace reason UX, and a simple listing CLI. This creates the durable source-of-truth layer without generation or indexing."
affectedPaths:
    - "docs/prd/work-records-prd.md"
    - "docs/work-records/"
    - "src/constants.js"
    - "src/plan-front-matter.js"
    - "src/plan-store.js"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/shared/workflow/validation.js"
    - "src/shared/work-records/"
    - "src/cmd/registry.js"
    - "src/cmd/wr/"
    - "src/ui/workspace/server/plan-adapter.js"
    - "src/ui/workspace/components/PlanDetail.jsx"
    - "src/ui/workspace/islands/PlanLifecycleActions.jsx"
    - "src/ui/workspace/workspace.test.js"
frontend: true
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://localhost:5173/"
devServerHmr: true
createdAt: "2026-07-15T21:05:36.851Z"
updatedAt: "2026-07-15T21:05:36.851Z"
status: "draft"
origin: "internal"
parentPlan: "work-records-v1"
order: 1
dependencies:
    []
---

# Work Record Store, Lifecycle, Plan Metadata, and List CLI

## Context

Work Records need a canonical repo-local Markdown source of truth before generation, indexing, or agent retrieval can be
reliable. The Epic also requires Plan-side metadata for Work Record backlinks and a required reason when users manually
close a Plan without RunWield verification. Today `manual_closed_without_verification` exists, but it does not persist a
reason, and Workspace currently offers a confirm-only close action.

This slice creates the durable storage and lifecycle foundation. It intentionally stops short of Recorder generation,
Mnemosyne indexing, CLI search, and session-boundary automation.

## Objective

Add the Work Record core model and source-of-truth store under `docs/work-records/`, including parsing, validation,
formatting, state transitions, path/slug handling, and listing. Extend Plan front matter to round-trip
`closedWithoutVerificationReason` and `workRecord` backlink metadata, enforce non-empty close-without-verification
reasons for new closures, and update Workspace lifecycle UX so browser users can provide and see that reason.

The only human CLI surface in this slice is simple listing through `wld wr` / `wld wr list`; users can open the Markdown
files directly, so no CLI read command is needed for V1.

## Approach

Follow existing Plan storage patterns rather than creating a parallel bespoke Markdown stack. Add a
`src/shared/work-records/` subsystem with small focused modules for schema constants, front matter parsing/formatting,
validation, lifecycle transition helpers, path/slug helpers, body-section extraction, and list filtering. Keep Markdown
files flat under `docs/work-records/`; `recordId` is identity and file path is only location.

Plan modules should only know neutral metadata: `closedWithoutVerificationReason` and `workRecord` backlink fields. Work
Record modules own Work Record eligibility, validation, lifecycle state, and storage semantics.

For close-without-verification, enforce the required reason at the Plan Lifecycle/API boundary, not just in Workspace.
Preserve compatibility for legacy already-closed Plans that lack the field so later backfill can use
`Reason not specified.`.

## Files to Modify

- `docs/prd/work-records-prd.md` — align V1 scope if needed to reflect list-only CLI in this slice and deferred CLI
  read/manual create.
- `docs/work-records/` — establish canonical flat storage directory, with only a minimal placeholder if needed to keep
  the directory present.
- `src/constants.js` — add durable Work Record directory/command constants where useful.
- `src/plan-front-matter.js` — add stable ordering for `closedWithoutVerificationReason` and `workRecord` metadata.
- `src/plan-store.js` — parse, normalize, format, and update the new Plan front matter fields for active and archived
  Plans while preserving unknown metadata.
- `src/shared/workflow/plan-lifecycle.js` — require a non-empty reason for new `manual_closed_without_verification`
  events and persist it as `closedWithoutVerificationReason`.
- `src/shared/workflow/validation.js` — preserve independence from Work Record generation while keeping lifecycle
  metadata compatible with terminal validation outcomes.
- `src/shared/work-records/` — add schema constants, parser/formatter, validator, lifecycle helpers, path/slug helpers,
  body-section extraction, storage list APIs, and tests.
- `src/cmd/registry.js` — register the `wr` command group.
- `src/cmd/wr/` — implement command dispatch, help output, and `list` behavior over canonical Markdown records.
- `src/ui/workspace/server/plan-adapter.js` — validate and pass closure reasons through Workspace lifecycle actions;
  serialize reason and backlink metadata for details.
- `src/ui/workspace/components/PlanDetail.jsx` — display close-without-verification reasons and existing Work Record
  backlink/failure metadata where Plan status details are shown.
- `src/ui/workspace/islands/PlanLifecycleActions.jsx` — collect a non-empty close-without-verification reason before
  dispatching the lifecycle action.
- `src/ui/workspace/workspace.test.js` — cover Workspace lifecycle payload validation, reason persistence, and
  serialized display fields.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.js` — front matter parsing/injection, stable formatting, active/archived Plan handling, stale-write
  safety, and identity-vs-path patterns.
- `src/plan-front-matter.js` — canonical key ordering model for predictable Markdown diffs.
- `src/shared/workflow/plan-lifecycle.js` — state-machine style for lifecycle events and transition validation.
- `src/cmd/plans/index.js` and `src/cmd/plans/archive.js` — command-group dispatch, help style, list output, and
  dependency injection for tests.
- `src/ui/workspace/server/plan-adapter.js` — existing lifecycle action validation and in-memory preview structure.
- `src/ui/workspace/islands/PlanLifecycleActions.jsx` — existing prompt-based hold reason flow as a temporary UX pattern
  for collecting a required closure reason.

## Implementation Steps

- [ ] Step 1: Add Work Record schema constants and JSDoc typedefs in `src/shared/work-records/`, covering `kind`,
      `recordId`, `status`, `scope`, `origin`, `completionMode`, `createdAt`, archival/supersession fields, and
      provenance.
- [ ] Step 2: Implement Work Record Markdown parsing, formatting, validation, H1 title extraction, Summary extraction,
      optional-section handling, and flat path/slug helpers for `docs/work-records/`.
- [ ] Step 3: Add lifecycle transition helpers for V1 final-state fields, including approved, draft, pending
      verification, superseded, archived, and restored semantics without event-log persistence.
- [ ] Step 4: Add store APIs to ensure the directory, list records, write records, and filter default current records,
      treating Markdown as canonical and omitting empty optional fields.
- [ ] Step 5: Extend Plan front matter ordering, parsing, formatting, and update helpers for
      `closedWithoutVerificationReason` and `workRecord` backlink metadata.
- [ ] Step 6: Update Plan Lifecycle handling so `manual_closed_without_verification` requires a non-empty reason for new
      transitions and writes `closedWithoutVerificationReason`.
- [ ] Step 7: Update Workspace server and island lifecycle flows to collect, submit, validate, persist, and display
      close-without-verification reasons plus any Work Record backlink/failure metadata.
- [ ] Step 8: Register `wld wr` and implement `wld wr list` / default listing over canonical records, showing title,
      `recordId`, status, scope, origin, completion mode, archived/superseded notices, source Plan IDs, and path.
- [ ] Step 9: Add focused tests for Work Record store/lifecycle validation, Plan front matter round-trip, lifecycle
      reason enforcement, command listing, and Workspace reason behavior.

## Verification Plan

- Automated: `deno test -A src/plan-store.test.js src/shared/workflow/plan-lifecycle.test.js`
- Automated: `deno test -A src/shared/work-records/**/*.test.js src/cmd/wr/**/*.test.js`
- Automated: `deno test -A src/ui/workspace/workspace.test.js`
- Automated: `deno task workspace:react:check`
- Automated: `deno task ci`
- Manual: Create fixture Work Record Markdown under `docs/work-records/`; run `wld wr list`; confirm status, completion
  mode, source Plan IDs, and path are visible and warnings are prominent for archived/superseded/skipped-verification
  records.
- Manual: Close a Plan without verification through CLI/workflow lifecycle code and Workspace; confirm a non-empty
  reason is required, persisted as `closedWithoutVerificationReason`, and displayed on Plan detail.
- Frontend manual: Run `deno task workspace:dev`, open `http://localhost:5173/` in a headed browser, navigate to a Plan
  detail route, use the close-without-verification action, verify blank reason is rejected, valid reason persists, and
  the display follows the RunWield design system.
- Expected result: Work Record Markdown under `docs/work-records/` is canonical and listable; Plan metadata round-trips
  predictably; new skipped-verification closures cannot be reasonless; legacy closed Plans without reasons remain
  parseable.

## Edge Cases & Considerations

- Legacy already-closed Plans may not have `closedWithoutVerificationReason`; parsing must allow this so later backfill
  can use `Reason not specified.`.
- File path is not identity; store APIs and CLI output should treat `recordId` as the stable identifier.
- Empty optional Work Record fields should be omitted, not serialized as `null` or empty arrays.
- Work Record lifecycle state is front matter only in V1; do not add Work Record event logs or sidecars.
- This slice should not grant agent tools, build a Mnemosyne index, generate records, or hook `/new` and `/quit`.
- Workspace changes must use the existing RunWield design system and current Plan lifecycle UI patterns rather than
  adding a separate Work Record visual identity.
