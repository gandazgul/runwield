---
planId: "8d58195f-84d5-4292-ad31-8968b008be38"
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
createdAt: "2026-07-16T18:03:54-04:00"
updatedAt: "2026-07-17T03:49:36.742Z"
status: "verified"
origin: "internal"
parentPlan: "work-records-v1"
order: 2
dependencies:
    - "01-work-record-store-lifecycle-plan-metadata-and-list-cli"
implementedAt: "2026-07-17T03:19:04.049Z"
verifiedAt: "2026-07-17T03:49:36.742Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
---

# Recorder Generation and Backfill

## Context

The Work Record store/list slice is verified, so RunWield now has canonical Markdown Work Records under
`docs/work-records/`, Work Record parsing/formatting/storage helpers, Plan `workRecord` backlink metadata, and required
`closedWithoutVerificationReason` handling for new manual closures.

This slice adds the generation layer for completed planned work. V1 generation is limited to completed top-level FEATURE
Plans and PROJECT Epics. Child FEATURE Plans under an Epic do not generate separate records by default; the parent Epic
Work Record represents the broader outcome and may summarize child FEATURE outcomes when useful.

This slice also adds explicit broad backfill through `wld wr backfill`. It does not hook generation to `/new` or
`/quit`; session-boundary automation belongs to the later Work Records slice.

## Objective

Add internal Recorder generation for approved Work Records, including source Plan eligibility detection, top-level/Epic
resolution, concise retrospective body generation, canonical Markdown writes, and durable success/failure Plan backlink
metadata.

Add `wld wr backfill` to scan completed active and archived Plans, preview missing eligible Work Records, require human
confirmation before writing, support scriptable `--yes`, support preview-only `--dry-run`, generate records one source
at a time, and record per-Plan outcomes without rolling back terminal Plan status.

## Approach

Build a narrow Work Record generation subsystem under `src/shared/work-records/`. Plan storage remains neutral: it
provides Plan loading/updating and backlink persistence, while Work Record modules own source eligibility, completion
mode derivation, Recorder prompting, generated Markdown construction, storage, and failure semantics.

Use a bundled `src/agent-definitions/recorder.md` Agent Definition and add `AGENTS.RECORDER`. The Recorder should be a
read-only generation boundary: it receives source Plan metadata/body and, for Epics, child Plan summaries/statuses; it
returns a structured retrospective draft such as title, Summary, and optional `Deviations from Plan`, `Deferred Work`,
and `Future Planning Notes`. The generation service, not the Recorder prompt, owns UUID creation, Front Matter,
validation, file writes, and Plan backlink updates. If needed, add a small non-interactive Recorder invocation helper in
`src/shared/session/session.js` that builds an in-memory AgentSession for `cwd` without depending on SessionRuntime.
Keep this helper injectable so tests can supply deterministic Recorder output.

Eligibility is conservative and source-of-truth based:

- standalone top-level FEATURE Plans are eligible when `status` is `verified` or `closed_without_verification`;
- PROJECT Epics are eligible when `status` is `verified`, `status` is `closed_without_verification`, or
  `epicCompletionMode` is `done_enough`;
- child FEATURE Plans are skipped by default;
- any source Plan with an existing `workRecord` backlink, including `status: generated` or `status: failed`, is skipped
  by backfill in this slice;
- older closed-without-verification Plans without `closedWithoutVerificationReason` remain eligible and use
  `Reason not specified.`.

Backfill is an explicit maintenance command. It scans active and archived Plan locations, ensures each generated
internal Work Record has stable source Plan IDs, previews eligible sources and skipped counts, then writes records only
after confirmation. `--dry-run` prints the same preview and exits without prompting or writing. `--yes` accepts the
preview non-interactively. Treat `--yes` with `--dry-run` as conflicting input so automation cannot silently do the
wrong thing.

## Files to Modify

- `src/constants.js` — add `AGENTS.RECORDER` and update the JSDoc/type shape for canonical Agent identifiers.
- `src/plan-store.js` — reuse active/archived Plan loading helpers; add safe archived Plan Front Matter update or
  identity/backlink support as needed so archived sources can receive `planId` and `workRecord` metadata without losing
  archive metadata.
- `src/shared/work-records/` — add source discovery, eligibility, top-level/Epic resolution, Recorder orchestration,
  generated body construction, Work Record write, backlink update, failure recording, and backfill services.
- `src/shared/session/session.js` — add or reuse a non-interactive Recorder Agent invocation helper only if the
  generation service needs a default LLM-backed implementation.
- `src/agent-definitions/recorder.md` — add the Recorder role contract, read-only tools, structured output contract,
  completion-mode warnings, and Work Record writing boundary.
- `src/cmd/wr/` — add `backfill` parsing, preview output, confirmation handling, `--yes`, `--dry-run`, dependency
  injection for tests, and per-source result reporting.
- `src/cmd/registry.js` — update Work Records help/usage/notes for `wld wr backfill`, `--yes`, and `--dry-run` while
  keeping search/create deferred to later slices.
- `docs/work-records/` — receive generated canonical Work Record Markdown artifacts during manual/backfill use; do not
  add non-record sidecars.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/work-records/markdown.js` and `src/shared/work-records/store.js` — `formatWorkRecordMarkdown()`,
  `parseWorkRecordMarkdown()`, `writeWorkRecord()`, date-prefixed slug filenames, flat path validation, and canonical
  validation before persistence.
- `src/shared/work-records/schema.js` — Work Record status/scope/origin/completion-mode constants and JSDoc typedefs.
- `src/plan-store.js` — `listPlans()`, `listArchivedPlans()`, `loadPlan()`, `loadArchivedPlan()`,
  `updatePlanFrontMatter()`, `isChildFeaturePlan()`, `isEpicPlan()`, `groupPlanHierarchy()`, and Plan identity patterns.
- `src/shared/workflow/plan-lifecycle.js` — terminal Plan Status values and Epic `epicCompletionMode: done_enough`
  semantics.
- `src/cmd/plans/archive.js` — bulk command preview/result style and command dependency-injection patterns.
- `src/cmd/wr/index.js` and `src/cmd/wr/index.test.js` — command-group dispatch and Work Records CLI output tests.
- `src/shared/session/session.js` — `buildAgentSession()` / `runPrompt()` patterns for an in-memory, non-interactive
  Recorder invocation when no HostedSession exists.

## Implementation Steps

- [ ] Step 1: Add `AGENTS.RECORDER` in `src/constants.js` and create `src/agent-definitions/recorder.md` with a
      read-only Recorder role, concise retrospective guidance, explicit skipped-verification wording requirements, and a
      structured output contract that excludes file writes and Front Matter ownership.
- [ ] Step 2: Add Work Record source model typedefs/helpers under `src/shared/work-records/`, covering source kind
      active/archived, source Plan name/path/ID, scope, completion mode, closure reason, Epic child summaries, skip
      reasons, and generated/backlink outcomes.
- [ ] Step 3: Implement source discovery for active and archived Plans. Ensure active sources have `planId` via existing
      identity helpers; add archived identity/update support if an archived eligible source lacks `planId`, because
      internal Work Record provenance requires `provenance.sourcePlans`.
- [ ] Step 4: Implement eligibility helpers for completed standalone FEATURE Plans and PROJECT Epics, deriving
      `scope: feature|epic` and `completionMode: verified|closed_without_verification|done_enough`. Exclude child
      FEATURE Plans and skip any source with existing `workRecord` metadata.
- [ ] Step 5: Implement Epic context gathering so generated Epic records include useful child FEATURE status/summary
      detail when children are available in active or archived Plan locations, while still generating a parent-only Epic
      record if child context is incomplete.
- [ ] Step 6: Implement Recorder orchestration with an injectable generator. The default implementation should invoke
      the bundled Recorder Agent non-interactively and parse structured output; tests should be able to bypass the LLM
      with deterministic generated sections.
- [ ] Step 7: Build canonical generated Work Record Front Matter with `status: approved`, `origin: internal`, a new UUID
      `recordId`, derived `scope`, derived `completionMode`, current `createdAt`, and
      `provenance.sourcePlans: [sourcePlanId]`. Build the Markdown body from Recorder output and include optional
      sections only when meaningful.
- [ ] Step 8: Validate and write generated Work Records through the existing store as flat files under
      `docs/work-records/`; never let Recorder output choose an arbitrary path or bypass `parseWorkRecordMarkdown()`
      validation.
- [ ] Step 9: On successful generation, update only the source Plan/Epic backlink to `workRecord.status: generated`,
      `recordId`, `path`, and `lastAttemptAt`; child FEATURE Plans do not receive backlinks by default.
- [ ] Step 10: On generation, validation, write, Recorder, or backlink failure, preserve terminal Plan status and record
      `workRecord.status: failed`, `lastAttemptAt`, and a concise `error` on the source Plan when possible. Do not leave
      a partially written record linked as generated.
- [ ] Step 11: Implement `wld wr backfill` over the source discovery/generation service: print eligible sources,
      existing-backlink skips, ineligible skip counts, and likely generated record count; require typed confirmation by
      default; support `--dry-run`; support `--yes`; reject `--dry-run --yes`; proceed record-by-record and report
      success/failure per source.
- [ ] Step 12: Update Work Records command help in `src/cmd/registry.js` and local `wr` command help behavior so users
      can discover backfill, preview-only dry runs, and scriptable confirmation.
- [ ] Step 13: Add focused tests for source eligibility, child FEATURE exclusion, Epic done-enough records, archived
      Plan identity/backlink updates, closed-without-verification reason fallback, Recorder-output validation,
      successful backlinks, failure backlinks, existing-backlink skips, `--dry-run`, `--yes`, confirmation rejection,
      and per-source backfill continuation after a failure.

## Verification Plan

- Automated: `deno test -A src/shared/work-records/**/*.test.js src/cmd/wr/**/*.test.js`
- Automated: `deno test -A src/plan-store.test.js src/shared/workflow/plan-lifecycle.test.js`
- Automated:
  `deno test -A src/shared/session/session-prompt.test.js src/shared/session/__tests__/session-tools-policy.test.js` if
  Recorder Agent/session wiring changes.
- Automated: `deno task ci`
- Manual: Fixture a verified standalone FEATURE Plan with no `workRecord`, run `wld wr backfill --dry-run`, and confirm
  the source appears in the preview with one likely generated record and no files or backlinks are written.
- Manual: Run `wld wr backfill`, decline confirmation, and confirm no Work Record or Plan backlink is written.
- Manual: Run `wld wr backfill --yes` for the verified standalone FEATURE Plan; confirm one approved internal Work
  Record is written under `docs/work-records/`, `provenance.sourcePlans` contains the source `planId`, and the source
  Plan receives a generated backlink.
- Manual: Fixture a PROJECT Epic marked done enough with child FEATURE Plans; confirm backfill generates one Epic Work
  Record for the parent Epic, includes useful child outcome detail, and does not generate separate child FEATURE
  records.
- Manual: Fixture a `closed_without_verification` Plan with a reason; confirm the generated Summary prominently says
  RunWield Workflow Validation was skipped and includes the closure reason.
- Manual: Fixture a legacy `closed_without_verification` Plan without a reason; confirm generation succeeds and uses
  `Reason not specified.`.
- Manual: Simulate Recorder or write failure; confirm terminal Plan status is unchanged and Plan Front Matter records
  concise failure metadata.
- Expected result: Backfill can produce concise approved internal Work Records from eligible completed Plans, skip
  ineligible or already-linked sources safely, update active and archived source backlinks, and preserve canonical
  Markdown integrity.

## Edge Cases & Considerations

- Backfill skips any source with existing `workRecord` metadata, including failed backlinks; explicit repair/retry of
  failed generation is deferred and should not be implicit.
- Archived Plans need safe Front Matter updates for identity and backlinks without dropping archive metadata such as
  `archivedAt`, `archiveReason`, or original path details.
- Internal Work Records require a source Plan ID. If an archived source cannot safely receive or expose a `planId`, fail
  that source with a concise backlink/error instead of writing an invalid Work Record.
- Closed-without-verification records must never imply RunWield Workflow Validation passed; the Summary must disclose
  skipped verification and the closure reason or `Reason not specified.`.
- Recorder output should stay concise and retrospective; do not duplicate the full source Plan, chat transcript,
  implementation diary, or full diff.
- The generation service should be deterministic around metadata and filesystem writes even when the Recorder Agent text
  varies.
- This slice does not build the Mnemosyne index, expose Work Record search/read Agent tools, implement manual/external
  Work Record creation, generate QUICK_FIX records by default, or schedule generation on `/new` or `/quit`.
