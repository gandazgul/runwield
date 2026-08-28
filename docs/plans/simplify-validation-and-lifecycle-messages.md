---
planId: "4695664f-ee36-4be9-860b-f8f58b6e66ab"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/workflow/"
    - "src/ui/tui/"
    - "src/ui/workspace/"
    - "src/cmd/load-plan/"
    - "src/cmd/plans/"
    - "docs/domain-language.md"
    - "docs/plan-lifecycle.md"
    - "docs/design-system.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-08-14T00:11:43-04:00"
status: "implemented"
origin: "internal"
userVerifiedAt: null
targetBranch: "main"
---

# Simplify Validation and Lifecycle Messages

## Context

RunWield currently exposes internal lifecycle vocabulary in owner-facing messages: Plan Status identifiers, validation
phase names, semantic rounds, generation and activation terminology, worktree identifiers, transition events, and repair
machinery. Messages are emitted from workflow branches, Session adapters, TUI panels, Workspace surfaces, and commands,
so the same state can appear under inconsistent labels or provide no useful next action.

Correct state is not enough if the owner cannot tell what happened, whether work is safe, who is acting, or what to do
next. This Plan follows the validation-authority repair so messages are derived from canonical facts rather than
papering over ambiguous state.

## Objective

Make validation and blocked lifecycle messages plain and actionable. Each changed message must answer the questions that
matter for its context:

1. What happened?
2. Is saved work safe, when Git evidence can prove it?
3. Who owns the next step?
4. What can the owner do now?

Use the same validation terms in TUI and Workspace: **tests/CI**, **AI code review**, and **human review**. Keep
internal status values and repair bookkeeping in technical details, logs, and diagnostic output instead of primary copy.
Do not create a new presentation state machine or change lifecycle behavior.

## Approach

Keep the current message architecture and improve the high-value display boundaries:

```text
validation workflow
  -> validation-user-messages.ts for event copy
  -> RuntimeValidationProgress transport
  -> small shared validation-label helper
       -> TUI validation panel
       -> Workspace validation stages

load-plan / Plans Doctor
  -> existing local diagnosis and action logic
  -> revised blocked messages
```

`validation-user-messages.ts` remains the main copy catalog. Add only a small pure helper for live validation headings,
stage labels, and check labels. It can translate existing progress values such as `ci`, `semantic_review`, and
`human_review` into **Tests and CI**, **AI code review**, and **Human review**. It must not model Plan Lifecycle,
publication recovery, action legality, or damaged state.

Session events remain transport. Workspace keeps its current authoritative Plan/controller/worktree derivation and uses
the helper only for validation wording. `load-plan` and Plans Doctor keep their separate recovery logic because they
must explain inconsistent state that the normal validation view cannot model.

Exact Git terms such as branch, commit, worktree, merge conflict, push, and target branch remain visible when they help
the user understand or fix a problem. Safety claims stay local to code that has the evidence to support them.

The option set aside is a universal lifecycle presenter. It could remove more duplication, but it would couple normal
progress, damaged-state diagnosis, transport, and action policy for a copy improvement. Revisit it only if focused work
leaves repeated user-visible inconsistencies.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/workflow/validation-user-messages.ts` — remain the main catalog and revise validation, review, repair,
  publication, and completion copy to use the approved terms and specific next actions.
- `src/shared/workflow/validation-progress-presentation.ts` (new, name may follow local convention) — provide a small,
  pure mapping from existing live progress/check values to shared owner labels and headings. It does not derive
  lifecycle state or actions.
- `src/shared/workflow/validation-progress.ts` and `execution-preparation-progress.ts` — supply accurate context to the
  existing message and progress paths; remove raw status wording such as `in_progress` from primary copy.
- `src/ui/tui/blocks.js` — use the shared helper for validation headings and check labels instead of direct underscore
  replacement and internal cycle/attempt language. `runtime-adapter.js` changes only if needed to pass existing progress
  through unchanged.
- `src/ui/workspace/server/owner-plan-progress.ts` and `src/ui/workspace/react/PlanProgressSurface.tsx` — keep current
  progress derivation, but use the shared validation terms and move raw Plan status and transcript segment kinds out of
  the main hierarchy into technical details.
- `src/cmd/load-plan/` — audit blocked and interrupted-operation messages. Name the affected Plan, branch, worktree, or
  operation and give the existing recovery action or command without exposing lifecycle-record terms in primary copy.
- `src/cmd/plans/doctor.ts` and `src/cmd/plans/doctor-messages.ts` — revise owner summaries and next steps while keeping
  exact internal evidence available in detailed `--check` output when diagnosis requires it.
- Focused tests under `src/shared/workflow/`, `src/ui/tui/`, `src/ui/workspace/`, `src/cmd/load-plan/`, and
  `src/cmd/plans/` — protect changed wording, context, and safety claims.
- `docs/domain-language.md` and `docs/plan-lifecycle.md` — define **AI code review** and **human review** as
  owner-facing labels while preserving **Semantic Code Review** and Plan Status as internal architecture terms.
- `docs/design-system.md` — document the compact status-message order only if implementation needs to change the
  existing Workspace details/notice pattern. No new component or visual language is expected.

The change does not alter Session event contracts, Plan Lifecycle transitions, Workspace state derivation, controller
ownership, Git publication rules, or which actions are legal.

## Reuse Opportunities

- `src/shared/workflow/validation-user-messages.ts` — keep its typed request union and current message builders. Improve
  them in place instead of introducing another catalog.
- `src/shared/workflow/validation-progress.ts` and `src/shared/session/session-runtime-events.js` — keep the existing
  structured progress and Session transport unchanged.
- `src/shared/workflow/validation-merge-repair.ts` — preserve its useful `whatHappened` / `doThis` split and exact Git
  recovery guidance.
- `src/ui/tui/ValidationHandoffBlock`, Workspace `owner-card`, `rw-status-badge`, notice patterns, and semantic `--rw-*`
  tokens — keep current rendering and accessibility conventions.
- `src/shared/workflow/validation-user-messages.test.ts`, `src/ui/tui/blocks.test.js`, Golden TUI scenarios,
  `src/ui/workspace/workspace-plan-progress.integration.test.ts`, `src/cmd/load-plan/*.test.ts`, and
  `src/cmd/plans/doctor-messages.test.ts` — extend existing focused behavior coverage.

## Implementation Steps

- [ ] `validation-user-messages.ts` uses **tests/CI**, **AI code review**, and **human review** for their defined roles.
      **Validation** refers only to the combined gate. Messages for a failure or pause state what happened and give the
      next existing action; they do not replace useful Git terms with vague reassurance.
- [ ] A small shared validation-progress helper maps the existing `kind`, `stage`, `outcome`, and check-result values to
      owner headings and labels. It has no Plan/controller/worktree inputs, no action policy, no renderer markup, and no
      dependency-injection seam.
- [ ] TUI `ValidationHandoffBlock` uses the helper and no longer shows **Mechanical Validation**, **Semantic review**,
      raw stage names, total rounds, or repair-attempt counters in its primary heading. Engineer and Reviewer reports
      remain visible and are labeled by their user role.
- [ ] Workspace keeps `loadOwnerPlanProgress` as the owner of progress derivation, but its validation stages and details
      use the same helper terms as TUI. The primary progress hierarchy does not show raw Plan status or transcript
      segment kinds; those facts remain available in a technical-details region where useful.
- [ ] Execution-preparation copy does not show stored Plan status values. Validation and publication copy names the
      exact operation that is running: tests, AI code review, human review, combining commits, pushing, verification, or
      Git cleanup.
- [ ] Blocked `load-plan` messages name the affected Plan/Git operation and the existing recovery action or command.
      Primary copy does not ask the user to understand an unfinished lifecycle record, transition, registry ID,
      checkpoint, generation, or settlement.
- [ ] Plans Doctor summaries and guidance use plain diagnosis and specific next steps. Detailed `--check` output may
      name Front Matter, registry files, transition records, paths, IDs, and Git commands when those details are
      necessary to repair damaged state.
- [ ] Safety wording is evidence-based: messages say a branch, commit, or worktree is safe only where the caller already
      has proof. Unknown or ambiguous state says what RunWield cannot determine and directs the user to inspect it.
- [ ] `docs/domain-language.md` and `docs/plan-lifecycle.md` define **AI code review** and **human review** as
      owner-facing labels and keep **Semantic Code Review** as the internal state-machine term. Update
      `docs/design-system.md` only if the Workspace implementation changes the existing status/details presentation
      pattern.

## Approval Confirmation

No Work Record is proposed for supersession.

## Verification Plan

- Automated: table tests for the small validation-progress helper cover tests/CI, AI code review, human review, repair,
  merge, paused, failed, and complete values. They assert the approved labels and prove raw stage values and counters
  are not returned as headings.
- Automated: `src/shared/workflow/validation-user-messages.test.ts` covers running, failure, repair, pause, review,
  publication, cleanup, and completion copy. Negative safety fixtures confirm uncertain state does not claim that work
  is safe.
- Automated: `src/ui/tui/blocks.test.js`, `src/ui/tui/runtime-adapter.test.js`, and focused Golden TUI scenarios prove
  the existing progress event renders **Tests and CI**, **AI code review**, and **Human review** in the correct context
  and omits raw stage names and counters.
- Automated: `src/ui/workspace/workspace-plan-progress.integration.test.ts` and current component/UX tests exercise AI
  review, repair, publication failure, degraded evidence, and completion. They assert the shared validation labels,
  existing stage derivation, and raw Plan status only in technical details.
- Automated: focused `load-plan` and Plans Doctor tests cover unknown status, interrupted operation, missing worktree,
  merge conflict, and ambiguous attempt. Each blocked message names the affected developer fact and an existing next
  action. Existing automatic repair and refusal behavior must remain unchanged.
- Automated: run
  `deno run -A scripts/run-tests.js src/shared/workflow/validation-user-messages.test.ts src/ui/tui/blocks.test.js src/ui/tui/runtime-adapter.test.js src/ui/workspace/workspace-plan-progress.integration.test.ts src/cmd/load-plan src/cmd/plans/doctor-messages.test.ts src/cmd/plans/doctor.test.ts`,
  then `deno task test:golden-tui`, `deno task workspace:check`, and `deno task ci`.
- Manual TUI: inspect one successful path and one tests-fail/repair/resume path. Confirm the panel identifies tests, AI
  code review, and human review correctly; blocked text gives the next action; and internal values do not dominate.
- Manual Workspace: run `deno task workspace:dev` and inspect the Plan progress fixtures at `http://127.0.0.1:5173` in a
  headed browser at desktop and narrow widths. Confirm TUI/Workspace validation terms agree, technical facts remain
  available, and the current live-region and disclosure behavior stays accessible.
- Expected: a pass-through that changes underscores to spaces or keeps **Mechanical Validation** / **Semantic Code
  Review** as primary labels fails the helper, TUI, and Workspace tests. Blocked recovery copy is actionable without a
  universal lifecycle presenter.

## Edge Cases & Considerations

- A safety sentence is an evidence claim. If the branch, commit, or worktree cannot be proven, say what RunWield cannot
  determine and direct the user to inspect it; do not say “your work is safe.”
- **Tests**, **CI**, **AI code review**, **human review**, **Plan**, **Session**, branch, commit, worktree, and merge
  conflict are allowed product/developer terms. The rule targets misplaced terms and implementation bookkeeping, not
  technical detail in general.
- AI review feedback and human review feedback have different owners and resume paths. Copy must not collapse them into
  one generic review state.
- A failed push, a merge conflict, and incomplete cleanup happen after different facts are safe. Keep their existing
  specialized Git guidance instead of forcing them through the live-progress helper.
- Non-Git and local-only projects must not receive remote, branch, commit, or worktree promises.
- Existing state names, Session events, lifecycle behavior, and external adapter contracts remain compatible. This Plan
  changes presentation, not persistence or migration behavior.
- Plans Doctor detailed output is intentionally more technical than normal status copy. It must stay precise enough to
  repair inconsistent data.
- Tests should assert approved role labels, safety meaning, and next actions rather than incidental punctuation.
- The existing working tree has unrelated changes in `TODO.md`, `deno.lock`, and archived Plan moves. They do not
  overlap this Plan file or the expected implementation surface and must not be changed or reverted during execution.
