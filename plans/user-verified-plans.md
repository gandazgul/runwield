---
classification: "FEATURE"
complexity: "HIGH"
summary: "Add a first-class User Verified Plan outcome that preserves user attestation separately from RunWield Workflow Validation, satisfies completion relationships, and produces provenance-correct Work Records."
affectedPaths:
    - "src/plan-front-matter.js"
    - "src/plan-store.js"
    - "src/plan-store.test.js"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/shared/workflow/plan-lifecycle.test.js"
    - "src/shared/workflow/epic-continuation.js"
    - "src/shared/workflow/epic-continuation.test.js"
    - "src/cmd/load-plan/index.js"
    - "src/cmd/load-plan/load-plan-recovery.test.js"
    - "src/cmd/load-plan/load-plan-epic.test.js"
    - "src/cmd/registry.js"
    - "src/cmd/plans/archive.test.js"
    - "src/ui/workspace/constants.js"
    - "src/ui/workspace/server/plan-adapter.js"
    - "src/ui/workspace/islands/PlanLifecycleActions.jsx"
    - "src/ui/workspace/components/PlanDetail.jsx"
    - "src/ui/workspace/workspace-lifecycle.test.js"
    - "src/ui/workspace/workspace-board.test.js"
    - "src/shared/work-records/schema.js"
    - "src/shared/work-records/generation.js"
    - "src/shared/work-records/list.js"
    - "src/shared/work-records/work-records.test.js"
    - "src/agent-definitions/recorder.md"
    - "docs/plan-lifecycle.md"
    - "docs/workflows.md"
    - "docs/settings.md"
    - "docs/design-system.md"
    - "docs/prd/runwield-core-prd.md"
    - "docs/prd/work-records-prd.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-26T10:40:37-04:00"
updatedAt: "2026-07-26T15:50:50.951Z"
status: "implemented"
origin: "internal"
implementedAt: "2026-07-26T15:50:50.951Z"
executionReport: "- Implemented `user_verified` Plan status and `manual_user_verified` lifecycle event with required user note, `userVerifiedAt`, reopen cleanup, dependency satisfaction, Epic split progress/completion, and archive eligibility.\n- Added `wld load-plan` and Workspace User Verified actions with required-note validation, distinct labels/messages, no `verifiedAt`/Delivery Evidence fabrication, and best-effort Work Record generation.\n- Extended Work Records with `completionMode: user_verified`, Recorder/fallback attribution safeguards, list/read notices, backfill eligibility, and user note preservation.\n- Updated lifecycle/storage/CLI/Workspace/Work Record tests and documentation/PRDs/design guidance; recorded `User Verified Plan` as a separate `CONTEXT.md` follow-up without editing `CONTEXT.md` or ADRs.\n- Verification passed: `deno test -A src/plan-store.test.js src/shared/workflow/plan-lifecycle.test.js src/shared/workflow/epic-continuation.test.js`; `deno test -A src/cmd/load-plan/load-plan-recovery.test.js src/cmd/load-plan/load-plan-epic.test.js src/cmd/plans/archive.test.js`; `deno test -A src/shared/work-records/work-records.test.js src/ui/workspace/workspace-lifecycle.test.js src/ui/workspace/workspace-board.test.js`; `deno test -A src/cmd/load-plan/load-plan-review.test.js`; `deno test -A src/ui/workspace/workspace-local-server.test.js`; `deno task ci`.\n- Frontend browser check: started Workspace dev server at `http://127.0.0.1:5173/`, opened headed agent-browser session `runwield-user-verified-6dce8cd5`, verified Plan Board/detail routes loaded with lifecycle controls and no reported browser errors; did not submit the User Verified action in the live project to avoid mutating an active real Plan."
humanReviewMode: null
humanReviewDecision: null
executionMode: "worktree"
executionBaselineTree: "06d074a9ef05bbb0982ff88a8438a65c7d255288"
worktreeId: "6dce8cd5"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-user-verified-plans-6dce8cd5"
worktreeBranch: "runwield/worktree/user-verified-plans-6dce8cd5"
worktreeBaseBranch: "main"
worktreeStatus: "completed"
---

# User Verified Plans

## Context

RunWield currently has two terminal Plan outcomes: `verified`, which is a proof-bearing result of RunWield Workflow
Validation, and `closed_without_verification`, which combines intentional closure, manual acceptance, and verification
performed outside RunWield under one free-text reason. A user who personally verifies an outcome cannot record that fact
as a first-class lifecycle result without either understating it as generic closure or incorrectly implying that
RunWield established Delivery Evidence.

The distinction matters beyond display. Child dependencies accept only exact `verified` status, Epic progress counts
only RunWield-verified children, Work Records have no user-attested completion mode, and Workspace and `wld load-plan`
cannot capture a structured user verification note. RunWield must let the user take responsibility for verification
without weakening the fail-closed meaning of `verified`.

## Objective

Add a distinct terminal `user_verified` Plan Status and `manual_user_verified` Plan Event. The event records when and
how the user verified the outcome, never fabricates RunWield validation or delivery proof, satisfies child dependency
and Epic completion relationships with visibly distinct reporting, and triggers the existing best-effort Work Record
pipeline with `completionMode: user_verified`.

## Approach

Extend the event-driven Plan Lifecycle rather than adding a raw Front Matter mutation. `manual_user_verified` will be
available from the existing manual board-safe statuses for FEATURE Plans and PROJECT Epics. It requires a non-empty
`userVerificationNote`, sets `status: user_verified` and `userVerifiedAt`, and preserves prior execution, validation,
failure, human-review, Delivery Evidence, and worktree fields as historical facts. It must not set `verifiedAt`, claim
Workflow Validation passed, clean up a worktree, or overwrite a prior validation failure.

Expose the action through Workspace Plan detail and `wld load-plan`, both calling the same Plan Event. After the
terminal state is durably recorded, use `autoGenerateWorkRecordForCompletedPlan`; the existing
`workRecords.autoGenerateOnPlanCompletion` setting, top-level source rules, best-effort failure backlink, and
`wld wr
backfill` recovery remain authoritative.

Introduce shared completion predicates so callers do not collapse `verified` and `user_verified` into the same label.
Both satisfy dependencies and completed-child accounting, while UI/TUI summaries report RunWield-verified and
user-verified counts separately. A last User Verified child may advance its ready parent Epic through the existing
done-enough mechanism when every child is either proof-bearing RunWield verified or User Verified; no automatic
next-child execution starts from the manual action.

## Files to Modify

- `src/plan-front-matter.js` — register `userVerifiedAt` and `userVerificationNote` in canonical Front Matter order.
- `src/plan-store.js` — extend Plan Front Matter JSDoc, status normalization/ranking, archive eligibility, dependency
  resolution, and child progress accounting for distinct User Verified semantics.
- `src/plan-store.test.js` — cover Front Matter round-tripping, status normalization, archival, dependency states, and
  split Epic progress counts.
- `src/shared/workflow/plan-lifecycle.js` — add `user_verified`, `manual_user_verified`, lifecycle action capability,
  required-note validation, terminal/re-open behavior, completion predicates, and mixed RunWield/User Verified parent
  Epic advancement.
- `src/shared/workflow/plan-lifecycle.test.js` — verify allowed and blocked transitions, exact metadata preservation,
  required attestation, re-open cleanup, hold protection, and parent advancement rules.
- `src/shared/workflow/epic-continuation.js` — recognize User Verified children as terminal and their dependency state
  as satisfied without relabeling it RunWield verified; do not auto-continue merely because the manual event occurred.
- `src/shared/workflow/epic-continuation.test.js` — cover next-child selection and dependency resolution with mixed
  verification authorities.
- `src/cmd/load-plan/index.js` — add a shared User Verified action to applicable Plan menus, collect the required note,
  record the event, attempt setting-aware Work Record generation, and present terminal archive/re-open/view handling.
- `src/cmd/load-plan/load-plan-recovery.test.js`, `src/cmd/load-plan/load-plan-epic.test.js` — cover User Verification
  from implemented/manual statuses, preserved worktree/failure evidence, mixed child progress, no automatic execution,
  and Work Record result messaging.
- `src/cmd/registry.js`, `src/cmd/plans/archive.test.js` — document and test `user_verified` as normally
  archive-eligible while retaining existing recoverable-worktree archive guards.
- `src/ui/workspace/constants.js` — add the canonical Workspace lifecycle action identifier.
- `src/ui/workspace/server/plan-adapter.js` — add status/action metadata, request validation, shared event dispatch,
  dependency/Epic serialization, and post-transition Work Record generation.
- `src/ui/workspace/islands/PlanLifecycleActions.jsx` — render “Mark as User Verified,” require a non-empty note through
  the existing lifecycle-action interaction pattern, and surface success/failure messages without a raw YAML edit.
- `src/ui/workspace/components/PlanDetail.jsx` — treat User Verified as closed, show its timestamp/note in Lifecycle
  metadata, and keep its status text distinct from RunWield Verified.
- `src/ui/workspace/workspace-lifecycle.test.js`, `src/ui/workspace/workspace-board.test.js` — cover action payloads,
  persistence, closed-board placement, status labels, split progress, dependency satisfaction, and Work Record outcomes.
- `src/shared/work-records/schema.js` — add `user_verified` as a canonical Work Record completion mode.
- `src/shared/work-records/generation.js` — make User Verified Plans eligible, carry the attestation into Recorder input
  and fallback synthesis, and enforce summary language that attributes verification to the user rather than RunWield.
- `src/shared/work-records/list.js` — display a prominent User Verified notice distinct from the generic
  skipped-validation warning.
- `src/shared/work-records/work-records.test.js` — cover generation, backfill, notices, source eligibility, user note
  preservation, and mixed Epic child summaries.
- `src/agent-definitions/recorder.md` — require Recorder output for User Verified sources to preserve user authority and
  avoid claiming RunWield Workflow Validation.
- `docs/plan-lifecycle.md`, `docs/workflows.md` — document the status, event, transition rules, dependency/Epic
  semantics, worktree preservation, and the distinction from RunWield Verified and Closed Without Verification.
- `docs/settings.md`, `docs/prd/work-records-prd.md` — add User Verified to setting-aware Work Record eligibility,
  completion-mode schema, summary requirements, notices, and backfill behavior.
- `docs/prd/runwield-core-prd.md` — keep the living Core status/event model aligned with the new terminal outcome.
- `docs/design-system.md` — add User Verified to status intent guidance using existing semantic tokens and an explicit
  label; do not introduce a new theme or token.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/workflow/plan-lifecycle.js#buildPlanEventUpdates` and `recordPlanEvent` — keep user attestation inside the
  canonical event-driven state machine.
- `src/shared/workflow/plan-lifecycle.js#getPlanLifecycleActionMetadata` — extend the existing structured manual-action
  capability/blocked-reason model rather than creating surface-specific permission rules.
- `src/ui/workspace/islands/PlanLifecycleActions.jsx#createCloseWithoutVerificationIntent` — mirror its required-text,
  dispatch, and message handling while giving User Verification a separate action and non-destructive label.
- `src/cmd/load-plan/index.js#putPlanOnHold` — reuse the `uiAPI.promptText` and shared helper pattern for a required
  attestation note.
- `src/shared/work-records/auto-generation.js#autoGenerateWorkRecordForCompletedPlan` — preserve setting-aware,
  post-terminal, best-effort Work Record generation and parent-Epic targeting.
- `src/shared/work-records/generation.js#prepareGeneratedSections` — extend enforced completion-language normalization
  so Recorder output cannot misattribute User Verification to RunWield.
- Existing Workspace action/status button, badge, notice, and metadata patterns — use RunWield semantic tokens and
  current Plan detail styling without a new visual component or raw Front Matter editor.

## Implementation Steps

- [ ] Extend the canonical Plan schema with `user_verified`, `userVerifiedAt`, and `userVerificationNote`; preserve
      unknown Front Matter fields and deterministic key order, and ensure `verifiedAt` remains exclusive to RunWield
      verification and Epic done-enough semantics.
- [ ] Add shared lifecycle/completion predicates that separately answer terminal, archive-eligible,
      dependency-satisfied, and RunWield-verified questions. Replace exact-status checks in Plan storage, dependency
      resolution, progress accounting, load-plan selection, Workspace serialization, and Epic continuation where User
      Verified must participate.
- [ ] Implement `manual_user_verified` in Plan Lifecycle. Require the current Plan to be in the existing manual
      board-safe set and require a trimmed non-empty note; set user attestation fields and terminal status while
      preserving prior failure, execution, Delivery Evidence, human-review, and worktree facts.
- [ ] Extend `review_reopened` so `user_verified` can return to `feedback` and stale `userVerifiedAt` /
      `userVerificationNote` are cleared. Keep User Verified blocked from generic movement, hold, and repeated terminal
      actions; converting an already terminal Closed Without Verification Plan requires re-opening first.
- [ ] Update dependency and Epic semantics. Return a distinct `user_verified` dependency state with satisfied behavior,
      report split RunWield/User Verified child counts, skip both completed kinds when selecting remaining children, and
      allow the last manual user-verification event to advance a ready Epic only when every child is either RunWield
      verified with mode-appropriate Delivery Evidence or User Verified.
- [ ] Add the `wld load-plan` action across applicable manual-status and recovery menus. Prompt until the user supplies
      a note or cancels, explain that RunWield Workflow Validation is not being claimed, record the event, attempt Work
      Record generation, report disabled/failed generation without undoing status, and end the action without
      auto-running another child.
- [ ] Add the Workspace action end to end: constant, request shape, status/action metadata, capability serialization,
      required-note client intent, server-side lifecycle validation, Work Record trigger, closed-board routing, metadata
      labels, and distinct status/progress/dependency presentation. Reuse existing action styles and semantic tokens.
- [ ] Extend Work Record schema and generation with `completionMode: user_verified`. Include the Plan attestation note
      in Recorder context and deterministic fallback output; enforce a summary sentence stating that the user, not
      RunWield Workflow Validation, established verification; retain approved internal Work Record and Plan backlink
      behavior.
- [ ] Make Work Record list/search/read notices identify User Verified provenance prominently. Ensure backfill discovers
      active or archived top-level User Verified FEATURE Plans and PROJECT Epics, while child FEATURE Plans continue to
      be represented through the parent Epic according to current policy.
- [ ] Update focused lifecycle, storage, CLI/TUI, Workspace, Epic continuation, archival, and Work Record tests,
      including negative assertions that User Verification never synthesizes `verifiedAt` or Delivery Evidence and never
      erases a prior RunWield validation failure.
- [ ] Update lifecycle, workflow, settings, design-system, and living PRD documentation. Record `User Verified Plan` as
      a proposed canonical domain term needing a separate `CONTEXT.md` update by Ideator/Init; do not modify
      `CONTEXT.md` or ADRs in this feature.

## Verification Plan

- Automated:
  `deno test -A src/plan-store.test.js src/shared/workflow/plan-lifecycle.test.js src/shared/workflow/epic-continuation.test.js`.
- Automated:
  `deno test -A src/cmd/load-plan/load-plan-recovery.test.js src/cmd/load-plan/load-plan-epic.test.js src/cmd/plans/archive.test.js`.
- Automated:
  `deno test -A src/shared/work-records/work-records.test.js src/ui/workspace/workspace-lifecycle.test.js src/ui/workspace/workspace-board.test.js`.
- Automated: `deno task ci` and fix all issues attributable to the change.
- Manual TUI: load Plans in `draft`, `implemented` with a prior validation failure, and `in_progress` with recoverable
  worktree metadata. Mark each as User Verified, provide/cancel/omit the required note, and verify terminal state,
  preserved evidence, clear attribution, no automatic sibling execution, and accurate Work Record messages.
- Manual Workspace: start the existing Workspace/Plan UI, open a Plan detail, use “Mark as User Verified,” verify
  required note handling, closed-tab placement, distinct status/metadata, archive/re-open actions, and no raw Front
  Matter editing.
- Manual hierarchy: User Verify a dependency child and confirm its dependent becomes unblocked with a “user verified”
  label; finish an Epic with mixed RunWield Verified/User Verified children and confirm split counts, parent completion,
  and Epic Work Record child statuses.
- Manual Work Records: verify enabled generation creates `completionMode: user_verified` with the user note and
  attribution notice; disable auto-generation and confirm the Plan remains User Verified with no record until
  `wld wr backfill`.
- Expected result: a user can durably attest a completed Plan without RunWield claiming Workflow Validation or Delivery
  Evidence, and all lifecycle, hierarchy, archive, UI, and Work Record consumers preserve that authority distinction.
- Execution policy matrix:
  - Use `executionAgent: "engineer"` with `collaborationRecommendation: "autonomous"` because lifecycle/storage and Work
    Record semantics are the primary outcome; Workspace changes extend established controls rather than introduce a new
    visual design.
  - No dedicated dev server command is required. Manual Workspace verification should use the repository's existing
    Workspace launch path and current RunWield design system.

## Edge Cases & Considerations

- `verified` must remain fail-closed and proof-bearing. Never treat `user_verified` as permission to backfill
  `verifiedAt`, Delivery Evidence, human-review approval, merge ancestry, or registry cleanup.
- User Verification is an assertion of completion strong enough to satisfy dependencies, but callers must preserve its
  authority in labels, counters, dependency states, Work Records, and Agent-facing notices.
- A User Verified Plan may retain `failureReason` or recoverable worktree metadata from an earlier RunWield attempt.
  Terminal status must not delete that evidence; normal archival remains blocked while recoverable worktree states
  exist.
- The action remains best-effort with respect to Work Records. A disabled setting or Recorder/index failure must leave
  `user_verified` committed and expose backfill/retry guidance through the existing Plan backlink/result model.
- Existing `closed_without_verification` Plans are not migrated automatically. Users may leave them as historical
  closure or explicitly re-open and User Verify them with a required note.
- Child FEATURE Plans do not receive standalone Work Records under current policy. When User Verification completes the
  parent Epic, targeted generation should create/reconcile the Epic Work Record; otherwise the child remains represented
  by Plan state until parent completion.
- User Verified Epics and FEATURE Plans are both supported. Epic attestation may close an Epic with remaining children,
  so its required note and Work Record must make that user decision explicit rather than imply every child passed
  RunWield validation.
- `User Verified Plan` is new canonical language not yet present in `CONTEXT.md`. This Plan uses that term consistently
  and records the glossary follow-up without changing context or ADR artifacts in this feature.
