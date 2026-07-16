# Product Requirements Document: Work Records

Last updated: 2026-07-14 08:32 EDT

## Objective

Add **Work Records** to RunWield Core as small, repo-local retrospective planning-memory artifacts that capture what
completed planned work actually produced and what future planning should remember.

Work Records close the loop between prospective **Plans** and future planning: Plans describe what should happen; Work
Records distill what did happen.

## Problem Statement

RunWield already preserves Plans, PRDs, ADRs, memories, validation state, and lifecycle metadata, but future planning
still lacks a concise, searchable record of completed work. Reading old Plans alone can be misleading because Plans are
prospective and may not reflect final completion mode, skipped verification, done-enough Epic outcomes, or later
supersession.

Work Records should make it easy for humans and planning Agents to answer questions like:

- What did we build before?
- Which prior work is relevant to this new Plan?
- Was this work verified by RunWield or closed without verification?
- Has this record been superseded by a newer outcome?
- What old completed work lacks a Work Record and should be backfilled?

## Resolved Assumptions

### Canonical Storage

- Work Records are canonical repo-local Markdown artifacts under `docs/work-records/`.
- The Markdown file is the source of truth.
- Mnemosyne or any future index is derived/cache state only.
- V1 stores files flat under `docs/work-records/`.
- V1 filenames use creation-date-prefixed slugs, for example:

```text
docs/work-records/2026-07-14-work-records-design.md
```

- File path is not identity. `recordId` is identity.

### Identity and References

- Every Work Record has a stable `recordId` in front matter.
- `recordId` uses the same style as Plan `planId`: a plain UUID string, not a prefixed `wr_...` ID.
- References use stable IDs, not paths.
- `provenance.sourcePlans` is an ID-only list of Plan IDs.
- `supersedes` and `supersededBy` store Work Record IDs only.
- Empty optional fields are omitted from front matter rather than written as nulls or empty arrays.

### Scope

Every Work Record has required `scope`:

```yaml
scope: feature | epic | quick_fix
```

- `feature`: a completed standalone FEATURE Plan or external/manual work assessed as feature-sized.
- `epic`: a completed PROJECT Epic record, including child-feature outcome detail when useful.
- `quick_fix`: an explicitly requested record for no-plan QUICK_FIX work.

External/manual records still receive a scope. Recorder should assess the appropriate scope; most external records are
expected to be `feature`.

### Origin and Provenance

Work Records use Plan-like origin:

```yaml
origin: internal | external
```

- `internal`: generated from RunWield workflow artifacts.
- `external`: imported, manually constructed, reconstructed after lost Plans, or explicitly requested for
  QUICK_FIX/no-plan work.

Work Records also have provenance:

```yaml
provenance:
    sourcePlans:
        - <planId>
    evidence:
        - path: src/example.js
          note: Stable file-level note about evidence.
```

Rules:

- `provenance.sourcePlans` is required for `origin: internal` records.
- `provenance.sourcePlans` is optional for `origin: external` records.
- `provenance.evidence` is optional in v1.
- Recorder should include stable file-level evidence and notes when useful, especially for manually constructed,
  external, or QUICK_FIX-derived records.
- V1 should not require evidence before approval.
- Avoid line numbers and symbol references by default because they become stale quickly.

### Completion Mode

Every Work Record has required `completionMode`:

```yaml
completionMode: verified | closed_without_verification | done_enough
```

- `verified`: RunWield Workflow Validation passed.
- `closed_without_verification`: work was manually closed or externally constructed without RunWield verification.
- `done_enough`: PROJECT Epic was marked done enough.

External/manual records without a RunWield Plan lifecycle use `completionMode: closed_without_verification`.

Search results should always display completion mode prominently. This builds trust even when the record is verified.

For `completionMode: closed_without_verification`, the `## Summary` must explicitly say RunWield verification was
skipped and include the closure reason.

### Status and Archival

Initial statuses:

```yaml
status: pending_verification | draft | approved | superseded
```

- `pending_verification`: internal Work Record generated before Plan verification, usually from Guided Review analysis;
  hidden from default search and Agent retrieval until the Plan reaches a terminal completion outcome.
- `draft`: external/manual/imported Work Record awaiting human review.
- `approved`: current usable Work Record.
- `superseded`: replaced by a newer Work Record.

Archival is orthogonal to status:

```yaml
archivedAt: 2026-07-14T...
```

- Any status can be archived.
- Archived records are hidden from default search and Agent retrieval.
- Archived records remain available through explicit human/maintenance flows.

Supersession rules:

- A Work Record can only be superseded by another Work Record.
- Plans, ADRs, PRDs, docs, or code changes cannot directly supersede a Work Record because they may remain prospective
  or unimplemented.
- Agents may flag stale/conflicting records and propose supersession or archive, but user confirmation is required.

### Required Body Shape

Work Records are intentionally small. V1 requires only:

```markdown
# Title

## Summary
```

The title comes from the Markdown H1 only; no duplicate `title` front matter field is used.

Optional sections may be included only when meaningful and omitted when empty:

```markdown
## Deviations from Plan

## Deferred Work

## Future Planning Notes
```

Guidance:

- Do not duplicate the original intent; readers can open the source Plan.
- Do not create a full implementation diary.
- `## Deviations from Plan` is rare for internal workflow records and should only appear when Recorder detects a
  meaningful deviation.
- `## Deferred Work` is mainly for Epics, done-enough completion, or skipped child features.
- `## Future Planning Notes` should contain only concrete reusable lessons, not speculation.
- Recorder should keep `## Summary` concise by instruction rather than hard tooling enforcement.

### Front Matter Shape

Minimal internal generated Work Record:

```yaml
---
kind: work_record
recordId: 11111111-1111-4111-8111-111111111111
status: approved
scope: feature
origin: internal
completionMode: verified
createdAt: 2026-07-14T08:32:00-04:00
provenance:
    sourcePlans:
        - 22222222-2222-4222-8222-222222222222
---
# Example Feature Outcome

## Summary

Concise record of what was completed and why it matters for future planning.
```

Example closed-without-verification record:

```yaml
---
kind: work_record
recordId: 33333333-3333-4333-8333-333333333333
status: approved
scope: feature
origin: internal
completionMode: closed_without_verification
createdAt: 2026-07-14T08:32:00-04:00
provenance:
    sourcePlans:
        - 44444444-4444-4444-8444-444444444444
---
# Example Manually Closed Work

## Summary

This work was completed but RunWield verification was skipped. Closure reason: verified manually in staging.
```

Example superseded record:

```yaml
---
kind: work_record
recordId: 55555555-5555-4555-8555-555555555555
status: superseded
scope: epic
origin: internal
completionMode: verified
createdAt: 2026-07-14T08:32:00-04:00
provenance:
    sourcePlans:
        - 66666666-6666-4666-8666-666666666666
supersededBy: 77777777-7777-4777-8777-777777777777
---
# Old Epic Outcome

## Summary

This record has been replaced by a newer Work Record.
```

## Generation Policy

### Internal Planned Work

Recorder is the future Agent responsible for Work Record generation.

Automatic generation targets:

- standalone top-level FEATURE Plan reaching `verified`
- top-level FEATURE Plan reaching `closed_without_verification`
- PROJECT Epic reaching `verified`
- PROJECT Epic marked `done_enough`
- PROJECT Epic reaching `closed_without_verification`

Automatic generation does not target:

- child FEATURE Plans under an Epic by default
- normal no-plan QUICK_FIX sessions by default

For Epics:

- generate one longer Epic Work Record
- include a clear overall Summary
- include detail about child FEATURE outcomes when needed
- do not generate one Work Record per child Plan by default

For QUICK_FIX:

- no Work Record is generated by default
- if the user explicitly requests one, treat it as `origin: external`, `scope: quick_fix`, and
  `completionMode: closed_without_verification`
- provenance should point to code/file evidence rather than a source Plan

### Guided Review Reuse

Guided Review remains a pre-merge validation aid, not a durable planning artifact. Work Records remain the durable
planning-memory artifact. Guided Review v1 can ship without Work Record integration; this reuse is a later integration
between the two concepts. When validation-time Guided Review is requested or auto-selected, RunWield should reuse the
same ephemeral analysis pass to prepare both Guided Review material and Work Record material:

- source Plan identity and background context
- concise summary of what was built
- detected deviations from the Plan
- deferred work candidates
- stable file-level evidence from the diff
- ephemeral Guided Review material needed for the human diff walkthrough

The shared review-intelligence packet is runtime/session state only. It should not be committed, stored in Plan Front
Matter, written as a sidecar artifact, or indexed. If the session is interrupted before the Work Record is written, the
analysis should be regenerated later from the Plan, diff/worktree state when available, and normal Recorder inputs.

If Guided Review runs before merge-back, Recorder may create the Work Record immediately as
`status: pending_verification`. That record must not enter default search or Agent retrieval until the source Plan
reaches `verified`, `closed_without_verification`, or `done_enough`. If verification/review succeeds, the pending record
transitions to `approved` with the final `completionMode`. If verification fails or the user requests changes, the
pending record should remain hidden and be updated, replaced, or discarded by the later successful attempt.

When Guided Review does not run because the user declined it, settings disable it, or deterministic heuristics consider
the change too small or low-signal, Work Record generation follows the normal session-boundary background path.

### Best-Effort and Timing

Work Record generation is best-effort and must not block Plans from reaching `verified` or
`closed_without_verification`.

Automatic generation waits until session boundary instead of running immediately when a Plan/Epic completes:

- `/new`
- `/quit`

At session boundary, RunWield should kick off pending Work Record generation in the background, not block the user.

Session-end auto-generation is scoped only to top-level Plans/Epics touched in the current session. Broader backfill
across all verified/closed Plans is explicit.

If RunWield crashes or generation fails, recovery/backfill can find missing records later. Generation failure should be
recorded on the source Plan's `workRecord` backlink with `status: failed`, `lastAttemptAt`, and a concise `error`.
Session-end generation failures may also print a concise stderr message when there is still a process surface available,
but the Plan backlink is the durable failure record for v1.

### Plan Backlink Metadata

Only the top-level source Plan/Epic gets a Work Record backlink. Child FEATURE Plans under an Epic do not get their own
pointer by default.

Absence of `workRecord` front matter on a completed top-level Plan/Epic means the Work Record is missing/eligible for
generation.

Suggested Plan front matter shape:

```yaml
workRecord:
    status: generated | failed
    recordId: <recordId>
    path: docs/work-records/2026-07-14-example.md
    lastAttemptAt: 2026-07-14T08:32:00-04:00
    error: "Concise failure reason when status is failed"
```

No explicit `missing` status is needed.

Backfill should include archived completed top-level Plans/Epics by default when the user explicitly runs broad
backfill. For backfill eligibility, completed means top-level Plans/Epics with `status: verified`,
`status: closed_without_verification`, or PROJECT Epics with `epicCompletionMode: done_enough`.

### Closed Without Verification

When manually closing a Plan without RunWield verification:

- New manual closures must provide a non-empty closure reason at the Plan Lifecycle/API layer, not only in UI.
- Store the reason on the Plan as `closedWithoutVerificationReason`.
- Older already-closed Plans that lack this field should not block Work Record generation or backfill; Recorder should
  use `Reason not specified.` as the closure reason.
- Recorder must include the closure reason in the Work Record Summary.
- Work Record generation follows the same session-end/background timing as verified Plans.

## Manual, Imported, and External Work Records

RunWield should support creating Work Records for work done outside normal `wld` workflow, including:

- imported external work
- work performed by a human engineer
- work performed by another coding harness
- lost/missing Plans reconstructed from code
- explicitly requested QUICK_FIX records

User-facing command direction:

```bash
wld wr create [optional text]
```

This should open an interactive TUI flow similar to Sleep:

1. User starts with or without initial text.
2. Recorder asks clarifying questions as needed.
3. Recorder inspects code/file evidence when useful.
4. Recorder drafts a Work Record with `origin: external` and `status: draft`.
5. Plannotator opens a Work Record review.
6. On feedback, Recorder incorporates feedback and relaunches review.
7. On approval, lifecycle transitions the record to `status: approved` and syncs the index.

Manual/imported/external records require human approval before entering default search/retrieval.

## Work Record Lifecycle

Implement a dedicated Work Record Lifecycle module from v1 rather than ad hoc front matter edits.

Statuses:

```text
pending_verification
draft
approved
superseded
```

Events:

```text
pending_created
draft_created
review_feedback
review_approved
verification_approved
verification_failed
superseded
archived
restored
```

Expected behavior:

- `pending_created` sets `status: pending_verification` for internal pre-merge records generated from Guided Review
  analysis
- `draft_created` sets `status: draft`
- `review_feedback` keeps or returns to `status: draft`
- `review_approved` sets `status: approved`
- `verification_approved` promotes `pending_verification` to `status: approved` and records the final `completionMode`
- `verification_failed` keeps the record hidden as `pending_verification` or removes/replaces it when the associated
  implementation attempt is abandoned
- `superseded` sets `status: superseded` and records `supersededBy`
- `archived` preserves status and sets `archivedAt`
- `restored` preserves status and clears archive metadata

Edits after approval are allowed for minor corrections, clarification, links, or provenance cleanup. Meaningful changes
to what happened should usually create a new Work Record that supersedes the old one.

Work Record create/edit/approve/supersede/archive/restore should sync the derived index immediately. If sync fails,
Markdown remains canonical and RunWield reports or retries later.

V1 stores only final lifecycle state in Work Record front matter. It should not store a Work Record event history in
front matter or sidecar files. Rich audit trails are deferred until the broader authorship/ownership model exists and
can track cross-artifact history consistently.

## Plannotator / Review Surface

Broaden Plannotator from Plan-only review into a generic artifact/code review UI.

Plannotator should support modes for:

- Plan review
- Work Record review
- code/diff review

Common behavior:

- Markdown/diff rendering as appropriate
- annotations
- approve
- feedback/return for revision

For Work Records, feedback should return to Recorder, which revises the draft and relaunches review, mirroring the Plan
review loop.

## Search and Retrieval

### Human Search UX

Human-facing Work Record search surfaces include CLI commands under `wld wr` and future Workspace views.

Default human search should show current usable records only:

- include `status: approved`
- exclude `status: pending_verification`
- exclude `status: draft`
- exclude `status: superseded`
- exclude archived records

When a human explicitly asks for historical, stale, superseded, archived, draft, or pending records, the UI may include
those records with prominent notices:

- `closed_without_verification` records display a verification-skipped warning and closure reason.
- `superseded` records display a replaced-by notice and the superseding Work Record ID when available.
- archived records display `archivedAt` and remain visually de-emphasized.
- `draft` records display an awaiting-human-review notice.
- `pending_verification` records display a not-yet-terminal notice and are not treated as settled project history.

V1 human search can use simple explicit flags or command variants for non-default statuses; it does not need nuanced
query-intent detection.

### Indexing

Use a separate derived Mnemosyne collection for Work Records:

```text
<projectName>:work-records
```

Do not mix Work Records into the normal project memory collection.

The index is derived from Markdown and rebuildable. Mnemosyne IDs are cache/index implementation details and must not be
stored in committed Markdown.

Index entries should include compact searchable text, not the full body:

```text
Title: <H1>
Scope: feature
Origin: internal
Completion: verified
Summary:
<full Summary section>
```

Indexing targets:

- Markdown H1 title
- `## Summary`
- textual metadata such as `scope`, `origin`, and `completionMode`

This supports queries like “unverified auth work” without embedding full implementation detail.

Tags should mirror useful fields for filtering, including:

- `status:approved`
- `status:pending_verification`
- `status:draft`
- `status:superseded`
- `origin:internal`
- `origin:external`
- `scope:feature`
- `scope:epic`
- `scope:quick_fix`
- `completion:verified`
- `completion:closed_without_verification`
- `completion:done_enough`
- `archived:true`
- `archived:false`

V1 search ranking should remain simple: natural keyword + semantic search. Do not add role-aware boosting in v1.

### Sync Behavior

The derived index should sync automatically on:

- create
- edit
- approve
- verification approval
- supersede
- archive
- restore

Creation is generally add-only. Archive/supersede/edit may require delete + add unless Mnemosyne gains
update/upsert/tag-update support.

Preferred future Mnemosyne capability:

- stable external keys or upsert support keyed by Work Record `recordId`
- tag updates or better tag filtering if needed

### Agent Tools

Expose a two-step tool surface:

```text
work_record_search(query)
work_record_read(recordId)
```

V1 `work_record_search`:

- input: query only
- searches current project only
- default excludes archived records
- default excludes pending-verification records
- default excludes draft records
- default excludes superseded records for planning agents
- returns full `## Summary`, not a truncated excerpt
- returns compact metadata and path

Suggested result fields:

- H1 title
- `recordId`
- `scope`
- `origin`
- `completionMode`
- `status`
- full `## Summary`
- source Plan IDs
- path

Search results must display `completionMode` prominently for all records, not only skipped-verification records.

V1 does not need filters such as `scope`, `origin`, `completionMode`, `includeArchived`, `includeSuperseded`, or
`includeDraft`. Add filters later if usage demands them.

### Agent Access

Default Work Record search/read access:

- Ideator: yes, restricted to current approved non-archived records
- Planner: yes, restricted to current approved non-archived records
- Architect: yes, restricted to current approved non-archived records
- Engineer: no default Work Record retrieval; Engineer should rely on approved Plan context unless explicitly provided
- Recorder: can read all records for maintenance/review/supersession/backfill workflows
- Guide: yes, can read all current-project Work Records so project inquiries are meaningful; Guide must surface status,
  completion mode, archived state, and supersession notices prominently and must not present draft or pending records as
  settled project history

Core v1 search is current-project only. Cross-project retrieval belongs to future Workspace/global features with
explicit permissions.

## CLI Command Surface

Use `wld wr` as the CLI command group for Work Records.

Initial command direction:

```bash
wld wr
wld wr list [--all]
wld wr search <query>
wld wr read <recordId>
wld wr create [optional text]
wld wr backfill
```

The first storage/lifecycle slice may ship only `wld wr` / `wld wr list` over canonical Markdown records. Generation,
backfill, indexed search/read, and manual create belong to later slices or deferred manual/external Work Record scope.
Default listing should show current usable records; `--all` is a maintenance view with prominent status, archival,
supersession, and completion-mode warnings.

`wld wr backfill` should:

1. scan completed top-level Plans/Epics in both `plans/` and archived Plan locations, where completed means
   `status: verified`, `status: closed_without_verification`, or PROJECT Epics with `epicCompletionMode: done_enough`;
2. skip Plans that already have a `workRecord` backlink;
3. preview the eligible Plans and likely generated record count;
4. require human confirmation before generation;
5. attempt Work Record generation for each eligible Plan;
6. write success/failure backlink metadata back to each source Plan.

Backfill should include archived completed top-level Plans/Epics by default because the command is explicit and
maintenance-oriented.

## Settings

Consider a setting to disable session-boundary background generation:

```yaml
workRecords:
    autoGenerateOnSessionEnd: true
```

Default should be true.

## Out of Scope for V1

- Cross-project Work Record retrieval.
- Role-aware search ranking/boosting.
- Hard enforcement of Summary length.
- Full body embedding.
- Automatic age-based rot/decay.
- Silent agent-driven supersession/archive without user confirmation.
- Generating Work Records for every no-plan QUICK_FIX by default.
- Writing Mnemosyne document IDs into Markdown.
- Requiring code evidence for every external record.
- Date-folder storage; v1 remains flat.

## Open Questions / Resume Points

Use these to continue the design conversation later.

1. **Guide access in v1**
   - Resolved: Guide receives Work Record search/read access for meaningful project-history inquiries.
   - Resolved: Guide can read all current-project Work Record statuses but must prominently surface status, completion
     mode, archived state, and supersession notices.

2. **Human search UX**
   - Resolved recommendation: default human search shows current usable records only: approved, non-archived,
     non-superseded, non-draft, and non-pending.
   - Resolved recommendation: historical/stale/superseded/archived/draft/pending records require explicit human intent
     or flags and display prominent status-specific notices.
   - Resolved recommendation: closed-without-verification records always display a verification-skipped warning and
     closure reason.

3. **Mnemosyne improvements**
   - Should Mnemosyne add external keys/upsert to make Work Record index sync cleaner?
   - Should Mnemosyne add tag update/retag support?
   - Should tag filtering evolve beyond “must match all tags” for Work Record search?

4. **Backfill command UX**
   - Resolved: the CLI command group is `wld wr`.
   - Resolved: `wld wr backfill` scans completed top-level Plans/Epics, including archived Plans, skips sources with an
     existing Work Record backlink, previews the generation set, and requires human confirmation before generating.
   - Open: exact non-interactive/headless behavior and flags.

5. **Session-end background behavior**
   - Resolved: source Plan `workRecord.status: failed` with `lastAttemptAt` and concise `error` is the durable v1
     failure record.
   - Resolved: session-end generation failures may also print a concise stderr message when a process surface is
     available.
   - Open: richer `/new` or Workspace notification behavior.

6. **Plan closure metadata**
   - Resolved: new `manual_closed_without_verification` lifecycle events require a non-empty reason at the lifecycle/API
     layer.
   - Resolved: store the reason in Plan front matter as `closedWithoutVerificationReason`.
   - Resolved: older already-closed Plans without the field use `Reason not specified.` during Work Record generation or
     backfill so historical gaps do not block the flow.

7. **Authorship metadata**
   - Authorship is intentionally deferred as a cross-artifact design.
   - Future design should cover Plans, Work Records, PRDs, ADRs, and possibly Plannotator review metadata.

8. **Work Record edit governance**
   - What threshold should tooling use to warn that an edit is substantial enough to create a superseding record?
   - Should internal generated records have stricter warnings than external/manual records?

9. **Workspace integration**
   - How should Work Records appear in Workspace navigation and Plan detail views?
   - Should Workspace surface Work Record maintenance suggestions such as “this record appears stale”?

10. **Command naming and surfaces**
    - Resolved: command group is `wld wr`.
    - Resolved direction: initial commands include `search`, `read`, `create`, and `backfill`.
    - Open: whether v1 also needs `list`, `archive`, `restore`, `supersede`, or `index` subcommands.

11. **Record creation from external Plans**
    - When a user brings an external Plan, should Recorder first import/normalize the Plan or directly create an
      external Work Record?
    - How should the review loop distinguish “external Plan source” from “external Work Record draft”?

12. **Lifecycle event details**
    - Resolved: v1 stores final lifecycle state only in Work Record front matter.
    - Resolved: no Work Record event history in front matter or sidecar files for v1.
    - Future: richer audit trails should be designed with the broader authorship/ownership model so cross-artifact
      history is tracked consistently.

## Success Criteria

- Completed top-level RunWield work produces a concise Work Record without blocking verification or session flow.
- Users can backfill missing Work Records for existing completed Plans, including archived Plans.
- Ideator, Planner, and Architect can retrieve relevant prior outcomes without reading raw chat/review logs or old Plans
  by default.
- Work Record search results clearly show completion/verification confidence.
- Superseded, archived, and draft records do not pollute default planning retrieval.
- Work Records remain small, human-readable, and durable in Git.
- The derived search index can be rebuilt from Markdown without losing canonical information.
