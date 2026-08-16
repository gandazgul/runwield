---
planId: "29ebfa42-f20b-4287-812e-220b3681f381"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Let approved Plans declare Work Record supersession and let Recorder proposals wait for explicit user confirmation when corrections emerge during execution or review."
affectedPaths:
    - "docs/domain-language.md"
    - "docs/prd/forge-change-request-delivery-prd.md"
    - "src/agent-definitions/document-formats/planner-plan-format.md"
    - "src/agent-definitions/recorder.md"
    - "src/plan-front-matter.js"
    - "src/plan-store.js"
    - "src/plan-store.test.js"
    - "src/shared/work-records/"
    - "scripts/objective-checks/work-record-supersession.ts"
    - "src/shared/workflow/validation-helpers.ts"
    - "src/shared/workflow/validation-work-record-handoff.test.ts"
    - "src/cmd/load-plan/plan-epic-flow.ts"
    - "src/cmd/load-plan/plan-hold.ts"
    - "src/cmd/wr/index.ts"
    - "src/cmd/wr/index.test.ts"
    - "src/cmd/registry.js"
objectiveChecks:
    - id: "OC1"
      command: "deno eval 'const t=Deno.readTextFileSync(\"src/plan-front-matter.js\"); if(!/supersedes:\\s*[\\x22\\x27]supersedes[\\x22\\x27]/.test(t)) Deno.exit(1)'"
      rationale: "The current Plan schema has no supersedes key. This fails now and passes only after Plans can retain the declared Work Record relation."
    - id: "OC2"
      command: "test -f scripts/objective-checks/work-record-supersession.ts && deno run -A scripts/objective-checks/work-record-supersession.ts"
      rationale: "The new objective script must create canonical predecessor/successor records, invoke the production supersession operation, and assert symmetric metadata plus confirmed current/all retrieval behavior; the file is absent today."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-12T11:06:12-04:00"
status: "verified"
origin: "internal"
implementedAt: "2026-08-12T16:32:00.073Z"
verifiedAt: "2026-08-12T17:34:19.627Z"
userVerifiedAt: null
executionReport: "- Implemented approved Plan-declared and Recorder-proposed Work Record supersession, including strict persisted proposals and all completion modes.\n- Added token-owned locking, heartbeats, atomic canonical writes, rollback evidence, idempotency/conflict checks, and fresh best-effort index projection.\n- Added TUI, hosted validation, backfill, headless guidance, and `wld wr supersede` list/confirm/reject flows.\n- Updated Planner/Recorder contracts, command help, domain language, and PRD.\n- Verification passed: objective supersession proof, focused tests, `deno task seams:check`, `deno task check`, formatting, and `deno task ci` (280 test files passed).\n- Test delta: 24 new named tests total (15 added in existing files plus 10 in the new supersession suite, with 1 existing handoff test rewritten against the new proposal shape); no behavior coverage was deleted."
workRecord:
    status: "generated"
    recordId: "b6f4b4a5-629d-4bdc-88a9-52205b29b192"
    path: "docs/work-records/2026-08-12-implemented-work-record-supersession.md"
    lastAttemptAt: "2026-08-12T17:34:34.656Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "86418258242c27e56861d5c22e8ac47784c8ece7"
    targetBranch: "main"
    targetHeadBeforeMerge: "df2977ca7b476bc3a4b456cd6c4379b3b7bde6b2"
validationCiAttempts: 0
validationSemanticRounds: 2
updatedAt: "2026-08-16T18:02:44.302Z"
archivedAt: "2026-08-16T18:02:44.302Z"
archivedFromStatus: "verified"
archivedFromPath: "docs/plans/implement-work-record-supersession.md"
---

# Implement Work Record Supersession

## Context

RunWield already defines Superseded Work Records, stores `supersedes` and `supersededBy` fields, excludes superseded
records from default retrieval, warns when historical records are read, tags indexed records as superseded, and exports
`supersedeWorkRecord`. No production path creates the relation. As a result, later work can prove an earlier Work Record
wrong without correcting the planning history that Agents retrieve.

The product rule in `docs/prd/forge-change-request-delivery-prd.md` defines two authorization paths:

1. A Planner declares the intended supersession before execution. Plan approval is the user's confirmation, and Recorder
   generation must honor it.
2. When execution or review reveals the correction, Recorder can propose supersession during generation. The proposal
   must not retire prior history until the user confirms it.

The user confirmed two additional behaviors for this change. An unconfirmed Recorder proposal remains durable on the new
Work Record; interactive terminal user interface (TUI) and `wld wr backfill` flows ask immediately, while Workspace and
other headless paths leave it for a later `wld wr supersede` command. A confirmed correction can supersede prior history
for every supported completion mode; the successor's existing completion-mode warnings continue to state its
verification confidence.

## Objective

Make Work Record supersession a complete, user-authorized lifecycle operation. Approved Plans can declare predecessor
Work Record IDs, generated successor records apply that declaration without a second prompt, Recorder can propose
late-discovered predecessor IDs with reasons, and users can accept or reject each pending proposal. Canonical Markdown
must remain internally consistent, default retrieval must change only after confirmation, and the derived Mnemosyne
index must follow canonical state without becoming authoritative.

## Approach

Add optional `supersedes: string[]` Plan front matter and document it in the canonical Planner format. Preserve and
normalize the field through every Plan load, revision, archive, and restore path. `generateWorkRecordForSource` will
pass the declaration to Recorder as settled context and will put the declared IDs on the successor record. Recorder's
JSON contract will gain optional `supersessionProposals`, with one `{ recordId, reason }` entry per record that Recorder
has searched, read, and determined is materially replaced rather than merely related.

Add a Work Record `supersessionProposal` front matter object that contains only unresolved Recorder candidates and their
reasons. A pending proposal is a notice, not lifecycle authority: the predecessor remains current, the successor remains
approved, and both remain available through default search until confirmation. Rejecting a candidate removes it from the
pending object without changing either record. Confirming a candidate applies the same canonical mutation used by the
Plan-declared path.

A new TypeScript Work Record supersession module will own that mutation. It will pre-load and validate the successor and
all predecessor IDs, reject self-links, duplicate IDs, missing records, and conflicts where a predecessor already names
a different successor, and make retries idempotent. Serialize supersession mutations with a project-local lock so two
processes cannot both pass conflict prevalidation and publish different successors. The canonical invariant after
success is symmetric: the successor's `supersedes` list contains each predecessor ID, while each predecessor has
`status: superseded` and `supersededBy: <successorRecordId>`. Prepare and validate every replacement Markdown file
before replacing canonical files; if a later file replacement fails, restore earlier files from captured canonical
Markdown and report any rollback failure explicitly. For generation, the new successor file participates in the same
operation: prevalidate declared targets before the Recorder call, allocate the successor ID, and delete the newly
created successor if a final conflict or write failure prevents the relation from committing. Canonical Markdown commits
before index synchronization. Re-sync every changed record through `syncWorkRecordToIndex`; an index failure returns
repair guidance but does not undo correct Markdown.

Automatic generation results will carry pending proposal details. TUI terminal-outcome paths will ask for each candidate
through their existing interaction adapters. `wld wr backfill` will ask after generation even when `--yes` approved the
backfill itself; that flag does not authorize Recorder-proposed supersession. Workspace and unsupported/headless
interaction paths will return a message that the proposal remains pending. `wld wr supersede` with no record ID lists
pending proposals; `wld wr supersede <successorRecordId>` resolves candidates interactively, and explicit
`--confirm <predecessorRecordId>` or `--reject <predecessorRecordId>` forms resolve one candidate. Cancel or unavailable
input leaves remaining candidates unchanged.

## Files to Modify

- `src/plan-front-matter.js` — add the canonical optional Plan `supersedes` key in stable front matter order.
- `src/plan-store.js` — type, normalize, serialize, revise, and preserve `supersedes` as a deduplicated non-empty string
  list.
- `src/plan-store.test.js` — prove Plan-declared predecessor IDs round-trip and survive revision without accepting
  malformed values.
- `src/agent-definitions/document-formats/planner-plan-format.md` — document optional Work Record IDs that an approved
  Plan will supersede.
- `src/agent-definitions/recorder.md` — extend the JSON contract and require search plus canonical read before proposing
  a material replacement; prohibit proposals based only on topical similarity.
- `src/shared/work-records/schema.js` — define the pending proposal front matter shape and key order while preserving
  the existing Work Record-to-Work Record ID contract.
- `src/shared/work-records/markdown.js` — parse, validate, normalize, omit empty proposals, and round-trip pending
  candidates and reasons.
- `src/shared/work-records/store.js` — add validated atomic replacement support for an existing canonical Work Record
  file without changing record identity or path.
- `src/shared/work-records/lifecycle.js` — reuse and tighten the existing superseded-state transition as required by the
  multi-record operation.
- `src/shared/work-records/supersession.ts` — own proposal listing/rejection and confirmed multi-record supersession,
  idempotency, conflict checks, rollback, and best-effort index synchronization.
- `src/shared/work-records/generation.js` — pass declared IDs to Recorder, parse and validate proposed IDs and reasons,
  persist unresolved proposals, apply approved Plan declarations, and reconcile the relation when generation links an
  existing record during retry/backfill.
- `src/shared/work-records/auto-generation.ts` — expose pending proposal details and actionable messages without
  changing the rule that Work Record failure cannot reverse a terminal Plan outcome.
- `src/shared/work-records/list.js` — display a prominent pending-supersession notice without hiding either record.
- `src/shared/work-records/index.ts` — export the new canonical supersession operations to command and workflow callers.
- `src/shared/work-records/work-records.test.js` and `src/shared/work-records/supersession.test.ts` — cover schema,
  generation, canonical mutation, rollback, retry, conflict, retrieval, and index behavior.
- `scripts/objective-checks/work-record-supersession.ts` — create real predecessor/successor Markdown fixtures, invoke
  the production supersession export, and fail unless canonical files and current-only retrieval have the confirmed
  target state. This is an objective proof, not a placeholder test.
- `src/shared/workflow/validation-helpers.ts` — ask for each late Recorder proposal after verified Plan generation by
  using the existing hosted interaction mechanism; unsupported or canceled interaction preserves pending state.
- `src/shared/workflow/validation-work-record-handoff.test.ts` — prove confirm, reject, cancel, and unsupported
  interaction outcomes do not make Work Record generation block successful validation.
- `src/cmd/load-plan/plan-epic-flow.ts` and `src/cmd/load-plan/plan-hold.ts` — resolve proposals through existing TUI
  selection prompts after done-enough and manual terminal outcomes.
- `src/cmd/wr/index.ts` — add pending listing and interactive/explicit per-target confirmation or rejection; keep
  `backfill --yes` separate from supersession authorization.
- `src/cmd/wr/index.test.ts` — cover command syntax, messages, confirmations, rejection, cancellation, and headless
  persistence.
- `src/cmd/registry.js` — add `wld wr supersede` usage and confirmation semantics to command help.
- `docs/prd/forge-change-request-delivery-prd.md` — replace the future-command note with the implemented declaration,
  proposal, confirmation, and pending behavior.
- `docs/domain-language.md` — state that a Superseded Work Record is replaced only by a confirmed successor Work Record
  and that a pending proposal has no retrieval effect.

## Reuse Opportunities

- `src/shared/work-records/lifecycle.js` — reuse `supersedeWorkRecord` for predecessor state instead of creating another
  status transition.
- `src/shared/work-records/store.js` and `src/shared/work-records/markdown.js` — keep canonical flat-file paths and use
  existing formatter/parser validation before every replacement.
- `src/shared/work-records/index-adapter.js` — reuse `syncWorkRecordToIndex`; its existing `superseded:true` tag and
  strict update behavior already support the target state.
- `src/shared/work-records/search.js` and `src/shared/work-records/list.js` — preserve current-only filtering and
  all-mode warnings; only add the pending proposal notice.
- `src/tools/work-record-search.ts`, `src/tools/work-record-read.ts`, and `src/shared/session/session.js` — use
  Recorder's existing all-record retrieval tools and Mnemosyne wiring; do not add a duplicate lookup seam.
- `src/shared/session/session-runtime-interactions.js` — reuse hosted select interactions for post-validation
  confirmation and their unsupported/canceled outcomes.
- `src/ui/tui/types.js` — reuse `promptSelect` for `/load-plan` terminal outcomes.
- `src/shared/work-records/test-fixtures/mnemosyne-port.ts` and `src/cmd/testing/runtime-command-fixture.ts` — test with
  the real canonical store and derived-index fixture rather than injecting RunWield-owned lifecycle functions.

## Implementation Steps

- [ ] Plan front matter accepts optional `supersedes` Work Record IDs, emits the field in canonical order, removes blank
      and duplicate IDs, preserves it through ordinary revisions and archive/restore flows, and the Planner format says
      that Plan approval confirms every listed relation.
- [ ] Recorder's contract accepts optional `supersessionProposals: [{ recordId, reason }]`; its instructions require
      `work_record_search` followed by `work_record_read` before a proposal, distinguish a material correction from
      topical overlap, and treat Plan-declared `supersedes` as already confirmed rather than proposing them again.
- [ ] Work Record Markdown round-trips a normalized `supersessionProposal` containing only non-empty, unique unresolved
      record IDs with non-empty reasons. Malformed proposal data fails with an actionable schema error, and an empty
      proposal is omitted.
- [ ] `src/shared/work-records/supersession.ts` exports
      `applyWorkRecordSupersession(cwd, { successorRecordId, predecessorRecordIds, mnemosynePort })`; under one
      project-local supersession lock, it establishes the symmetric relation between one successor and one or more
      predecessors, rejects self-links, missing records, duplicate IDs, and conflicting successors before mutation, and
      treats an already-correct relation as success.
- [ ] The canonical multi-file operation validates all rendered Markdown before replacement and restores prior Markdown
      after a partial write failure. Generation treats a newly created successor as part of the operation and removes it
      if the declared relation cannot commit. A rollback failure reports every uncertain path rather than claiming
      success.
- [ ] A successful canonical operation re-syncs successor and predecessors through the existing Mnemosyne adapter. Index
      failure leaves canonical state intact, reports `wld wr index rebuild`, and a later rebuild produces superseded
      tags and current-only retrieval from Markdown truth.
- [ ] Work Record generation writes Plan-declared predecessor IDs to the successor and applies them without another
      prompt because Plan approval supplied user confirmation. A missing or conflicting declared target produces a
      generation failure/backlink that does not reverse the terminal Plan.
- [ ] Work Record generation stores valid, undeclared Recorder candidates as pending proposals and returns their IDs and
      reasons. It does not change predecessor status or `supersededBy`, and the approved successor remains current with
      a visible pending notice.
- [ ] Generation retry/link-existing paths reconcile approved declarations and preserve unresolved proposals instead of
      linking an orphan record while silently skipping supersession work.
- [ ] Confirming one pending target applies the canonical supersession and removes that target from the proposal;
      rejecting removes only that target; cancel/unsupported interaction leaves it pending. Resolving one target does
      not implicitly decide other targets.
- [ ] Post-verification, done-enough Epic, manual User Verified, and closed-without-verification TUI paths ask
      immediately for each returned proposal. Every completion mode can become a confirmed successor, and its existing
      confidence notices remain unchanged.
- [ ] `wld wr backfill` asks about returned proposals after record generation, including when `--yes` authorized the
      backfill. Null/headless prompt input leaves proposals pending and prints the later-resolution command.
- [ ] `wld wr supersede` lists pending successors and candidate reasons; its interactive and explicit confirm/reject
      forms resolve only named pending targets, require no model call, and reject attempts to confirm an unproposed
      relation.
- [ ] Workspace and other non-interactive auto-generation callers include pending proposal IDs and
      `wld wr supersede <successorRecordId>` guidance in their result message without blocking the terminal Plan result.
- [ ] Default list/search behavior changes only after confirmation: pending predecessor and successor records both
      remain current, while a confirmed predecessor is excluded by default and remains available with a replaced-by
      notice in all-mode search/read.
- [ ] Product and domain documentation describe the implemented Plan-declared primary path, Recorder-proposed fallback,
      per-target user confirmation, pending-state retrieval behavior, and Work Record-only target rule.

## Verification Plan

- Automated objective proof: `deno run -A scripts/objective-checks/work-record-supersession.ts`. The script must use
  `writeWorkRecord`, production `applyWorkRecordSupersession`, `findWorkRecordById`, and current/all list filtering; it
  must assert the symmetric IDs and statuses, hide only the confirmed predecessor from current results, and retain it in
  all results. It must not import test-only code or pass when zero assertions run.
- Automated:
  `deno run -A scripts/run-tests.js src/plan-store.test.js src/shared/work-records/work-records.test.js src/shared/work-records/supersession.test.ts src/shared/work-records/auto-generation.test.ts src/shared/workflow/validation-work-record-handoff.test.ts src/cmd/wr/index.test.ts`.
- Automated: `deno task seams:check` to prove the change reuses real Plan, Work Record, interaction, and index machinery
  instead of introducing dependency-injection seams for RunWield-owned lifecycle writes.
- Automated: `deno task check` and `deno task test`.
- Manual: create an approved Plan with `supersedes` pointing to a current Work Record, complete it, and confirm the new
  record lists the predecessor, the predecessor names the new record and is hidden from default `wld wr list/search`,
  and `--all` plus `wr read` retain it with a replaced-by notice.
- Manual: complete a Plan without a declaration and make Recorder return two valid candidates. Confirm one, reject the
  other, and verify only the confirmed predecessor becomes superseded and no pending proposal remains.
- Manual: repeat generation through Workspace or a session without an interaction adapter. Confirm the terminal Plan
  remains successful, both records remain current, the pending notice and command guidance are visible, and
  `wld wr supersede <successorRecordId>` can resolve it later.
- Manual: run `wld wr backfill --yes` for a source that produces a proposal. Confirm the backfill authorization does not
  auto-confirm supersession and null/canceled input preserves the proposal.
- Expected preserved behavior: verified, User Verified, closed-without-verification, and done-enough generation still
  create approved records with their existing confidence disclosures; Plan backlinks and link-existing retries remain
  idempotent; child Planned Changes still defer to their parent Epic; default retrieval still excludes draft, pending
  verification, archived, and confirmed superseded records.
- Expected removed behavior: there is no longer a state where an approved Plan can carry a supersession declaration that
  Work Record generation ignores, and the existing lifecycle helper is no longer unreachable from production surfaces.
- Documentation check: `docs/domain-language.md`, the Planner format, Recorder contract, command help, and PRD use
  `Superseded Work Record`, `Work Record`, `Plan`, and `Recorder` consistently and do not imply that a pending proposal
  has already replaced history.

## Edge Cases & Considerations

- A Plan declaration is approved before its successor Work Record ID exists. Store predecessor IDs on the Plan; create
  the successor ID first during generation, then apply the confirmed relation.
- Supersession targets are Work Record IDs only. Plan IDs, paths, titles, PRDs, architectural decision records, and code
  references are invalid targets.
- Multiple approved Plans can race to supersede the same predecessor. Hold the project-local supersession lock across
  final reads, validation, canonical writes, and rollback; the first committed successor wins, and a later different
  successor receives a conflict without overwriting `supersededBy`.
- A pending proposal can become stale before confirmation. Re-read both records at confirmation time and reject a
  missing or differently superseded target while leaving the unresolved proposal visible for explicit rejection.
- Recorder has all-status retrieval access. Its prompt must not treat archived, draft, pending-verification, or already
  superseded records as current guidance, and proposals must preserve those distinctions in the reason.
- Confirmed successors may have `closed_without_verification`, `user_verified`, or `done_enough` completion modes. Do
  not add a verified-only gate; preserve their existing warnings so retrieval reports confidence accurately.
- `backfill --yes` authorizes record creation only. It must not be reinterpreted as confirmation of a model-proposed
  relationship.
- Index state is a projection. Canonical Markdown determines current/superseded filtering after hydration, and rebuild
  is the repair path after best-effort synchronization fails.
- Existing Work Records need no migration because the proposal field is optional and `supersedes`/`supersededBy` already
  parse. Existing Plans need no migration because `supersedes` is optional.
- The working tree contains unrelated archived/moved Plan files. Execution must not restore or modify those changes.
