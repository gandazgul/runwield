---
planId: "797354ff-94e3-4829-a9a1-7fdeab903f17"
classification: "PROJECT"
type: "epic"
complexity: "HIGH"
summary: "Add Work Records to RunWield Core as durable repo-local retrospective planning-memory artifacts, with CLI backfill, derived search, agent access, and later extensibility for manual records and Guided Review reuse."
affectedPaths:
    - "docs/prd/work-records-prd.md"
    - "CONTEXT.md"
    - "src/plan-front-matter.js"
    - "src/plan-store.js"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/shared/workflow/validation.js"
    - "src/cmd/registry.js"
    - "src/cmd/wr/"
    - "src/shared/work-records/"
    - "src/tools/work-record-search.js"
    - "src/tools/work-record-read.js"
    - "src/tools/registry.js"
    - "src/shared/session/session.js"
    - "src/shared/session/session-catalog.js"
    - "src/agent-definitions/guide.md"
    - "src/agent-definitions/ideator.md"
    - "src/agent-definitions/planner.md"
    - "src/agent-definitions/architect.md"
    - "src/agent-definitions/recorder.md"
    - "src/ui/workspace/"
    - "docs/work-records/"
    - "docs/usage.md"
    - "docs/workflows.md"
    - "docs/settings.md"
frontend: true
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://localhost:5173/"
devServerHmr: true
createdAt: "2026-07-14T17:04:16-04:00"
status: "draft"
origin: "internal"
routingIntent: "PROJECT"
sessionName: "work records v1"
---

# Work Records V1

## Context

RunWield has durable prospective artifacts such as Plans, PRDs, ADRs, Plan lifecycle metadata, validation state, and
memories, but it does not yet have a concise durable record of what completed work actually produced. Old Plans are
misleading as future planning context because they describe intent, not the final completion mode, skipped verification,
done-enough Epic outcome, or later supersession.

`docs/prd/work-records-prd.md` is the source product design for this Epic. The Epic should implement Work Records as
repo-local Markdown artifacts under `docs/work-records/`, with Markdown as the source of truth and Mnemosyne or any
semantic index treated as rebuildable derived state.

Guided Review integration is intentionally deferred. Guided Review v1 can ship independently; a later integration may
reuse the Guided Review analysis machinery to prefill Work Record material, but the artifacts remain separate.

## Objective

Add Work Records to RunWield Core so completed top-level planned work can produce small durable outcome records that
humans and planning Agents can search and read before future planning.

V1 should support:

- canonical Work Record Markdown storage and validation;
- a dedicated Work Record Lifecycle module with final-state-only front matter;
- Plan backlink metadata for generated or failed Work Record attempts;
- required close-without-verification reasons for new Plan closures;
- internal Work Record generation for completed top-level Plans/Epics;
- explicit `wld wr` CLI flows, especially `wld wr backfill`;
- a derived Work Record search index and `work_record_search` / `work_record_read` tools;
- default Work Record access for Ideator, Planner, Architect, and Guide, but not Engineer;
- manual/external Work Record creation and review when feasible within child slices.

## Vertical Slice Findings

- `src/plan-store.js` owns Plan front matter parsing/injection, Plan listing, archived Plan listing, and arbitrary Plan
  front matter updates through `updatePlanFrontMatter()`.
- `src/plan-front-matter.js` centralizes Plan front matter key ordering and already includes Epic done-enough fields.
- `src/shared/workflow/plan-lifecycle.js` owns Plan lifecycle events through `recordPlanEvent()` and already has
  `manual_closed_without_verification` and `epic_done_enough` events; new close-without-verification reasons should be
  enforced here or at its API boundary.
- `src/cmd/registry.js` is the central command registry; adding `wld wr` should follow the existing `plans` command
  pattern.
- `src/tools/registry.js` defines protected tool names; `src/shared/session/session.js` auto-wires internal custom tools
  requested by agent definitions.
- Guide currently has read-oriented project assistant access. Work Record tools should expand Guide's historical inquiry
  capability while requiring status/completion warnings.
- `plans/archived/` is already first-class in Plan storage; `listArchivedPlans()` should be reused for explicit backfill
  over archived completed Plans.

## Files to Modify

- `docs/prd/work-records-prd.md` — keep the PRD aligned if implementation discovers small terminology or scope fixes.
- `CONTEXT.md` — preserve canonical Work Record vocabulary and relationships.
- `docs/work-records/` — new canonical Work Record storage directory, likely with a placeholder when empty.
- `src/shared/work-records/` — new core modules for Work Record parsing, validation, path/slug handling, lifecycle,
  indexing, search, and generation orchestration.
- `src/plan-front-matter.js` — add `workRecord` and `closedWithoutVerificationReason` front matter keys with stable
  ordering.
- `src/plan-store.js` — type and round-trip new Plan front matter fields; support backlink updates for active and
  archived source Plans as needed.
- `src/shared/workflow/plan-lifecycle.js` — require non-empty reasons for new `manual_closed_without_verification`
  events and store `closedWithoutVerificationReason`; preserve legacy backfill fallback behavior for old Plans without
  the field.
- `src/shared/workflow/validation.js` and session boundary commands such as `src/cmd/new/` and `src/cmd/quit/` — hook
  best-effort session-end generation for top-level Plans/Epics touched in the session.
- `src/cmd/registry.js` and `src/cmd/wr/` — add the `wld wr` command group with read/search/create/backfill direction.
- `src/tools/work-record-search.js` and `src/tools/work-record-read.js` — expose planning/history retrieval tools.
- `src/tools/registry.js` and `src/shared/session/session.js` — register/auto-wire Work Record tools and protect them
  only where appropriate.
- `src/agent-definitions/guide.md`, `src/agent-definitions/ideator.md`, `src/agent-definitions/planner.md`, and
  `src/agent-definitions/architect.md` — grant and instruct default Work Record access; keep Engineer without default
  access.
- `src/agent-definitions/recorder.md` — add the Recorder Agent if implementation chooses a dedicated Agent definition
  instead of a narrower internal generation prompt.
- `src/ui/workspace/` and Plannotator integration points — broaden artifact review only for child slices that implement
  manual/external draft Work Record review.
- `docs/usage.md`, `docs/workflows.md`, `docs/settings.md`, and related docs — document `wld wr`, Work Record retrieval,
  settings, and lifecycle semantics.

## Reuse Opportunities

- `src/plan-store.js` front matter parsing/injection patterns for Work Record Markdown parsing and source Plan backlink
  updates.
- `src/shared/workflow/plan-lifecycle.js` state-machine style for a dedicated Work Record Lifecycle module.
- `src/cmd/plans/` command structure for `wld wr` command parsing, help text, read/list/backfill UX, and tests.
- `listArchivedPlans()` and active Plan listing helpers for `wld wr backfill` eligibility scanning.
- Existing Mnemosyne CLI/tool patterns from memory and Sleep flows for derived index rebuild/sync behavior.
- Existing internal tool auto-wiring in `src/shared/session/session.js` for `work_record_search` and `work_record_read`.
- Plannotator review-loop patterns for later manual/external Work Record approval.

## Verification Plan

- Automated:
  - `deno test -A src/plan-store.test.js src/shared/workflow/plan-lifecycle.test.js`
  - `deno test -A src/shared/work-records/**/*.test.js src/cmd/wr/**/*.test.js`
  - `deno test -A src/shared/session/__tests__/session-tools-policy.test.js`
  - `deno test -A src/shared/workflow/validation.test.js` for session-end generation hooks when implemented
  - `deno task workspace:react:check` for any Workspace/Plannotator review-surface child slice
  - `deno task ci`
- Manual:
  - Complete or fixture a verified top-level FEATURE Plan and confirm a concise approved Work Record is generated with a
    Plan backlink.
  - Close a Plan without Workflow Validation and confirm new flows require `closedWithoutVerificationReason`; confirm
    old already-closed Plans without the field backfill using `Reason not specified.`.
  - Run `wld wr backfill`, verify it previews completed top-level Plans/Epics from active and archived locations, skips
    sources with backlinks, and requires confirmation.
  - Search/read Work Records as a human and as Guide/Ideator/Planner/Architect; confirm completion mode and status
    warnings are prominent.
  - Confirm Engineer does not receive Work Record tools by default.

## Edge Cases & Considerations

- V1 final-state-only lifecycle: do not add Work Record event logs in front matter or sidecars; richer audit trails wait
  for the future authorship/ownership model.
- Completed Plan eligibility means top-level Plans/Epics with `status: verified`, `status: closed_without_verification`,
  or PROJECT Epics with `epicCompletionMode: done_enough`.
- Child FEATURE Plans under an Epic should not get their own Work Record by default; the top-level Epic Work Record owns
  useful child outcome detail.
- File path is not identity; `recordId` is identity. Search/read should tolerate path moves when the ID remains stable.
- Empty optional fields should be omitted rather than serialized as nulls or empty arrays.
- Mnemosyne/index failures must not corrupt canonical Markdown. Markdown remains source of truth and indexes must be
  rebuildable.
- Session-end generation is best-effort and must not block `/new`, `/quit`, or Plan terminal transitions.
- Failed generation should write `workRecord.status: failed`, `lastAttemptAt`, and concise `error` to the source Plan;
  stderr messages are supplemental only.
- Human and agent default search should exclude pending, draft, superseded, and archived records unless explicit intent
  asks for historical or maintenance records.
- Guide can read all current-project Work Record statuses for inquiries but must not present draft/pending/superseded or
  closed-without-verification records as settled verified history.
- Manual/external Work Record creation and Plannotator review may be sliced after internal generation/backfill if
  needed; external draft records require human approval before default retrieval.
- Suggested child-feature order for Slicer:
  1. Core Work Record storage, parser/writer, lifecycle, and Plan front matter fields.
  2. Close-without-verification reason enforcement and Plan backlink helpers.
  3. Internal Recorder generation for completed top-level Plans/Epics.
  4. `wld wr read/search/backfill` over canonical Markdown and completed Plan discovery.
  5. Derived Mnemosyne index sync and `work_record_search` / `work_record_read` tools with agent access policy.
  6. Session-end background generation and failure persistence.
  7. Manual/external Work Record creation and review surface.
