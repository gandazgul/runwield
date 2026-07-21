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
createdAt: "2026-07-15T21:30:22-04:00"
updatedAt: "2026-07-16T02:53:19.931Z"
status: "verified"
origin: "internal"
parentPlan: "work-records-v1"
order: 1
dependencies:
    []
implementedAt: "2026-07-16T02:15:20.159Z"
verifiedAt: "2026-07-16T02:53:19.931Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
---

# Work Record Store, Lifecycle, Plan Metadata, and List CLI

## Context

Work Records need a canonical repo-local Markdown source of truth before generation, indexing, session-boundary
automation, or Agent retrieval can be reliable. The Epic and PRD define Work Records as small retrospective
planning-memory artifacts under `docs/work-records/`, with Markdown as canonical state and any future Mnemosyne index
treated as rebuildable derived state.

This first slice creates the durable storage and lifecycle foundation. It intentionally stops short of Recorder
generation, backfill, Mnemosyne indexing, search ranking, Agent retrieval tools, session-boundary automation,
Plannotator Work Record approval, and manual/external creation flows.

The repository already has example Work Record Markdown under `docs/work-records/`. Treat those files as existing
canonical-style records to parse and list; do not rewrite or migrate them except through explicit Work Record store
write APIs added in this slice.

## Objective

Add the Work Record core model and source-of-truth store under `src/shared/work-records/`, including parsing,
validation, formatting, lifecycle state helpers, path/slug handling, body-section extraction, directory/list/write APIs,
and default current-record filtering.

Extend Plan Front Matter to round-trip `closedWithoutVerificationReason` and nested `workRecord` backlink metadata,
enforce non-empty close-without-verification reasons for new Plan Lifecycle transitions, and update Workspace lifecycle
UX so browser users can provide and see that reason.

Add only a simple human CLI surface in this slice: `wld wr` and `wld wr list` list canonical Markdown records. Later
slices own Recorder generation/backfill and indexed search/read behavior.

## Approach

Follow existing Plan storage patterns while fixing the new nested-metadata need explicitly. Current `plan-store.js`
front matter formatting is scalar/array-oriented and would skip nested objects such as Plan `workRecord` or Work Record
`provenance`. This slice should add safe, predictable nested YAML formatting for the known shapes rather than relying on
ad hoc string concatenation. Keep output stable, omit empty optional fields, preserve unknown Plan metadata where
existing Plan code already does, and avoid broad arbitrary object serialization unless it is covered by tests.

Create a focused `src/shared/work-records/` subsystem with small modules for schema constants/JSDoc typedefs, Markdown
front matter parsing/formatting, validation, lifecycle transition helpers, path/slug helpers, body-section extraction,
store APIs, list filtering, and CLI output formatting. Keep files flat under `docs/work-records/`; `recordId` is
identity and the file path is only location.

Plan modules should only know neutral Plan metadata: `closedWithoutVerificationReason` and the nested `workRecord`
backlink fields. Work Record modules own Work Record eligibility, validation, lifecycle state, storage semantics, and
list/search filtering rules.

For close-without-verification, enforce the required reason at the Plan Lifecycle/API boundary, not just in Workspace.
Preserve compatibility for legacy already-closed Plans that lack the field so later generation/backfill can use
`Reason not specified.`.

For `wld wr list`, default to current usable records: approved, non-archived, non-superseded records. Include a simple
explicit `--all` flag if needed to inspect draft, pending, superseded, or archived records before search/backfill
exists; whenever non-current records are shown, print prominent status/completion/archive/supersession notices. If
implementation keeps the initial CLI even smaller, it may defer `--all`, but it must not present non-current records as
normal current planning history.

## Files to Modify

- `docs/prd/work-records-prd.md` — align V1/slice language if needed: this slice adds store/list/lifecycle metadata
  only; generation, backfill, indexed search/read, manual create, and Plannotator Work Record review remain
  later/deferred scope.
- `docs/work-records/` — preserve existing Work Record Markdown as canonical source files and optional manual fixtures;
  do not add non-record artifacts unless absolutely needed.
- `src/constants.js` — add durable Work Record constants such as `WORK_RECORDS_DIR_NAME`, command labels, and any
  storage path names used by CLI/store code.
- `src/plan-front-matter.js` — add stable Plan Front Matter ordering for `closedWithoutVerificationReason` near terminal
  completion fields and `workRecord` near lifecycle/provenance metadata.
- `src/plan-store.js` — parse, normalize, format, and update `closedWithoutVerificationReason` and nested `workRecord`
  metadata for active and archived Plans; add safe nested YAML formatting for known Plan/Work Record metadata shapes
  without dropping unknown existing Plan metadata.
- `src/shared/workflow/plan-lifecycle.js` — require a non-empty reason for new `manual_closed_without_verification`
  events and persist it as `closedWithoutVerificationReason`.
- `src/shared/workflow/validation.js` — preserve independence from Work Record generation while keeping terminal
  validation metadata compatible with later Work Record completion-mode derivation.
- `src/shared/work-records/` — add schema constants, JSDoc typedefs, parser/formatter, validator, lifecycle helpers,
  path/slug helpers, body-section extraction, store/list APIs, list filtering/output helpers, and tests.
- `src/cmd/registry.js` — register the `wr` command group with help/usage for `wld wr`, `wld wr list`, and deferred
  commands noted only when helpful.
- `src/cmd/wr/` — implement command dispatch, help output, and list behavior over canonical Markdown records.
- `src/ui/workspace/server/plan-adapter.js` — validate and pass closure reasons through Workspace lifecycle actions in
  both persisted and in-memory preview paths; serialize reason and backlink metadata for details.
- `src/ui/workspace/components/PlanDetail.jsx` — display close-without-verification reasons and existing Work Record
  backlink/failure metadata where Plan status details/metadata are shown.
- `src/ui/workspace/islands/PlanLifecycleActions.jsx` — collect a non-empty close-without-verification reason before
  dispatching the lifecycle action, replacing the current confirm-only flow.
- `src/ui/workspace/workspace.test.js` — cover Workspace lifecycle payload validation, reason persistence, in-memory
  preview behavior, and serialized display fields.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.js` — Front Matter parsing/injection, stable formatting style, active/archived Plan handling,
  stale-write safety, and identity-vs-path patterns.
- `src/plan-front-matter.js` — canonical key ordering model for predictable Markdown diffs.
- `src/shared/workflow/plan-lifecycle.js` — state-machine style for lifecycle events and transition validation.
- `src/cmd/plans/index.js` and `src/cmd/plans/archive.js` — command-group dispatch, help style, list output,
  confirmation/test dependency-injection patterns.
- `src/ui/workspace/server/plan-adapter.js` — existing lifecycle action validation and in-memory preview structure.
- `src/ui/workspace/islands/PlanLifecycleActions.jsx` — existing prompt-based hold reason flow as a temporary UX pattern
  for collecting a required closure reason.
- Existing `docs/work-records/*.md` examples — schema and listing fixtures for nested `provenance.evidence`,
  external/internal origins, verified completion, and concise Summary rendering.

## Implementation Steps

- [ ] Step 1: Add Work Record schema constants and JSDoc typedefs in `src/shared/work-records/`, covering
      `kind: work_record`, plain UUID `recordId`, `status`, `scope`, `origin`, `completionMode`, `createdAt`,
      `archivedAt`, `supersedes`, `supersededBy`, and `provenance`.
- [ ] Step 2: Implement Work Record Markdown parsing and validation: require valid front matter, H1 title, `## Summary`,
      valid enum values, `provenance.sourcePlans` for internal records, optional `provenance.evidence` path/note
      entries, and omitted-empty optional fields.
- [ ] Step 3: Implement stable Work Record formatting with known nested YAML support for `provenance.sourcePlans`,
      `provenance.evidence`, supersession fields, and archive fields. Do not serialize empty optional arrays/objects as
      `null`, `[]`, or `{}`.
- [ ] Step 4: Add body-section extraction helpers for H1 title, required Summary, and optional
      `## Deviations from Plan`, `## Deferred Work`, and `## Future Planning Notes` sections; preserve Markdown body
      text without creating implementation-diary structure.
- [ ] Step 5: Add flat storage helpers for `docs/work-records/`: ensure directory, generate date-prefixed slugs, reject
      path traversal, read/list records, write validated records atomically enough for local CLI use, and resolve
      records by `recordId` without treating path as identity.
- [ ] Step 6: Add Work Record lifecycle helpers for V1 final-state fields: pending verification, draft, approved,
      superseded, archived, and restored semantics without event-log persistence or sidecars.
- [ ] Step 7: Add list filtering and formatting: default current records only; optional all-record inclusion if
      implemented; always show title, `recordId`, status, scope, origin, completion mode, source Plan IDs when present,
      archive/supersession/skipped-verification notices, and path.
- [ ] Step 8: Extend Plan Front Matter key ordering, parsing, formatting, and update helpers for
      `closedWithoutVerificationReason` and nested `workRecord` backlink metadata (`status`, `recordId`, `path`,
      `lastAttemptAt`, `error`).
- [ ] Step 9: Update Plan Lifecycle handling so `manual_closed_without_verification` requires a trimmed non-empty reason
      for new transitions and writes `closedWithoutVerificationReason`; legacy already-closed Plans without the field
      remain parseable.
- [ ] Step 10: Update Workspace server and island lifecycle flows to collect, submit, validate, persist, preview, and
      display close-without-verification reasons plus any Work Record backlink/failure metadata already present on the
      Plan.
- [ ] Step 11: Register `wld wr` and implement `wld wr list` / default `wld wr` listing over canonical records, with
      command help that reserves generation/backfill/search/create for later slices rather than silently pretending they
      exist.
- [ ] Step 12: Add focused tests for Work Record parser/formatter/store/lifecycle validation, nested YAML round-trip,
      Plan Front Matter round-trip, lifecycle reason enforcement, command listing, and Workspace reason behavior.

## Verification Plan

- Automated: `deno test -A src/plan-store.test.js src/shared/workflow/plan-lifecycle.test.js`
- Automated: `deno test -A src/shared/work-records/**/*.test.js src/cmd/wr/**/*.test.js`
- Automated: `deno test -A src/ui/workspace/workspace.test.js`
- Automated: `deno task workspace:react:check`
- Automated: `deno task ci`
- Manual: Run `wld wr list` against existing or fixture Work Record Markdown under `docs/work-records/`; confirm title,
  `recordId`, status, scope, origin, completion mode, source Plan IDs/evidence availability, and path are visible and
  malformed records produce actionable errors.
- Manual: Include current and non-current fixture records; confirm default listing does not present draft, pending,
  superseded, or archived records as current planning history, and any explicit all-record listing shows warnings
  prominently.
- Manual: Close a Plan without verification through CLI/workflow lifecycle code and Workspace; confirm a non-empty
  reason is required, persisted as `closedWithoutVerificationReason`, and displayed on Plan detail.
- Frontend manual: Run `deno task workspace:dev`, open `http://localhost:5173/` in a headed browser, navigate to a Plan
  detail route, use the close-without-verification action, verify blank reason is rejected, valid reason persists, and
  the display follows the RunWield Design System.
- Expected result: Work Record Markdown under `docs/work-records/` is canonical and listable; nested Work Record and
  Plan metadata round-trip predictably; new skipped-verification closures cannot be reasonless; legacy closed Plans
  without reasons remain parseable.

## Edge Cases & Considerations

- Legacy already-closed Plans may not have `closedWithoutVerificationReason`; parsing must allow this so later
  generation/backfill can use `Reason not specified.`.
- File path is not identity; store APIs and CLI output should treat `recordId` as the stable identifier.
- Empty optional Work Record fields should be omitted, not serialized as `null`, empty arrays, or empty objects.
- Nested YAML support must cover the known `workRecord` and `provenance` shapes; tests should prevent accidental
  dropping of nested metadata during Plan or Work Record writes.
- Work Record lifecycle state is Front Matter only in V1; do not add Work Record event logs or sidecars.
- This slice should not grant Agent tools, build a Mnemosyne index, generate Work Records, backfill completed Plans,
  hook `/new` or `/quit`, or implement manual/external create.
- Workspace changes must use the existing RunWield Design System and current Plan lifecycle UI patterns rather than
  adding a separate Work Record visual identity.
- Existing Work Record Markdown in `docs/work-records/` may predate this store implementation; validation errors should
  be clear enough to repair records without silently rewriting them.
