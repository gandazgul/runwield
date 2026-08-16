---
planId: "5aa9e38a-74c1-4629-8800-ca163792c9f8"
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "HIGH"
summary: "Make execution-worktree Plan amendments and Engineer-reported defective Objective-Failing Checks authoritative, durable, and user-governed so Mechanical Validation cannot repeat impossible repairs against stale commands."
affectedPaths:
    - "src/tools/task-completed.ts"
    - "src/shared/session/task-completion-session.ts"
    - "src/shared/session/agent-handler.ts"
    - "src/shared/workflow/workflow-results.js"
    - "src/shared/workflow/validation-types.ts"
    - "src/shared/workflow/validation-ports.ts"
    - "src/shared/workflow/validation-session-adapter.ts"
    - "src/shared/workflow/validation-engine.ts"
    - "src/shared/workflow/validation-context.ts"
    - "src/shared/workflow/validation-mechanical.ts"
    - "src/shared/workflow/validation-plan-amendment.ts"
    - "src/shared/workflow/objective-checks-baseline.ts"
    - "src/shared/workflow/objective-check-waivers.ts"
    - "src/shared/workflow/state-transition.ts"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/plan-store.js"
    - "docs/domain-language.md"
    - "docs/plan-lifecycle.md"
    - "docs/workflows.md"
    - "src/tools/__tests__/task-completed.test.js"
    - "src/shared/session/task-completion-session.test.ts"
    - "src/shared/workflow/workflow-results.test.js"
    - "src/shared/workflow/validation-completion-gating.test.ts"
    - "src/shared/workflow/validation-loop-repair.test.js"
    - "src/shared/workflow/validation-plan-amendment.test.ts"
    - "src/shared/workflow/validation-lifecycle-resume.test.js"
    - "src/plan-store.test.js"
objectiveChecks:
    - id: "OC1"
      command: "bash -lc 'set -euo pipefail; test -f src/shared/workflow/validation-plan-amendment.test.ts; grep -qF \"worktree Objective Check amendment becomes canonical only after user approval\" src/shared/workflow/validation-plan-amendment.test.ts; out=$(deno run -A scripts/run-tests.js --filter \"worktree Objective Check amendment becomes canonical only after user approval\" src/shared/workflow/validation-plan-amendment.test.ts 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed .*0 failed\"'"
      rationale: "Fails today because the worktree-amendment module and real-Git regression do not exist. It must prove user-confirmed synchronization and fresh command use."
    - id: "OC2"
      command: "bash -lc 'set -euo pipefail; grep -qF \"Engineer-reported defective checks reach user judgement for met unmet and broken results\" src/shared/workflow/validation-loop-repair.test.js; out=$(deno run -A scripts/run-tests.js --filter \"Engineer-reported defective checks reach user judgement for met unmet and broken results\" src/shared/workflow/validation-loop-repair.test.js 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed .*0 failed\"'"
      rationale: "Fails today because Engineer claims are ignored for mechanically met or unmet checks. The regression must exercise all result classifications through user judgement."
    - id: "OC3"
      command: "bash -lc 'set -euo pipefail; test -f src/shared/session/task-completion-session.test.ts; grep -qF \"defective-check claim survives process resume until validation handles it\" src/shared/session/task-completion-session.test.ts; out=$(deno run -A scripts/run-tests.js --filter \"defective-check claim survives process resume until validation handles it\" src/shared/session/task-completion-session.test.ts 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed .*0 failed\"'"
      rationale: "Fails today because the structured claim can be acknowledged before validation handles it. The regression must prove durable resume and consume-once behavior."
    - id: "OC4"
      command: "bash -lc 'set -euo pipefail; test -f src/shared/workflow/validation-plan-amendment.test.ts; grep -qF \"publication preserves an accepted execution Plan definition amendment\" src/shared/workflow/validation-plan-amendment.test.ts; out=$(deno run -A scripts/run-tests.js --filter \"publication preserves an accepted execution Plan definition amendment\" src/shared/workflow/validation-plan-amendment.test.ts 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed .*0 failed\"'"
      rationale: "Fails today because publication overwrites the execution Plan from the primary copy. The regression must prove an accepted amendment survives staging and delivery."
objectiveCheckWaivers:
    - id: "OC1"
      command: "bash -lc 'set -euo pipefail; test -f src/shared/workflow/validation-plan-amendment.test.ts; grep -qF \"worktree Objective Check amendment becomes canonical only after user approval\" src/shared/workflow/validation-plan-amendment.test.ts; out=$(deno run -A scripts/run-tests.js --filter \"worktree Objective Check amendment becomes canonical only after user approval\" src/shared/workflow/validation-plan-amendment.test.ts 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed .*0 failed\"'"
      source: "engineer_report"
      explanation: "Defective check. The file and test-name grep pass, and `deno run -A scripts/run-tests.js --filter \"worktree Objective Check amendment becomes canonical only after user approval\" src/shared/workflow/validation-plan-amendment.test.ts` exits 0 with output `all tests passed`. The final grep requires `1 passed .*0 failed`, but this runner does not emit that summary for a passing filtered run, so the OC exits 1 after the test has passed."
      userNote: "the are written wrong, the tests pass"
      waivedAt: "2026-08-13T03:39:46.715Z"
    - id: "OC2"
      command: "bash -lc 'set -euo pipefail; grep -qF \"Engineer-reported defective checks reach user judgement for met unmet and broken results\" src/shared/workflow/validation-loop-repair.test.js; out=$(deno run -A scripts/run-tests.js --filter \"Engineer-reported defective checks reach user judgement for met unmet and broken results\" src/shared/workflow/validation-loop-repair.test.js 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed .*0 failed\"'"
      source: "engineer_report"
      explanation: "Defective check. The test-name grep passes, and `deno run -A scripts/run-tests.js --filter \"Engineer-reported defective checks reach user judgement for met unmet and broken results\" src/shared/workflow/validation-loop-repair.test.js` exits 0 with output `all tests passed`. The final grep requires `1 passed .*0 failed`, but this runner does not emit that summary for a passing filtered run, so the OC exits 1 after the test has passed."
      userNote: "the are written wrong, the tests pass"
      waivedAt: "2026-08-13T03:39:46.715Z"
    - id: "OC3"
      command: "bash -lc 'set -euo pipefail; test -f src/shared/session/task-completion-session.test.ts; grep -qF \"defective-check claim survives process resume until validation handles it\" src/shared/session/task-completion-session.test.ts; out=$(deno run -A scripts/run-tests.js --filter \"defective-check claim survives process resume until validation handles it\" src/shared/session/task-completion-session.test.ts 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed .*0 failed\"'"
      source: "engineer_report"
      explanation: "Defective check. The file and test-name grep pass, and `deno run -A scripts/run-tests.js --filter \"defective-check claim survives process resume until validation handles it\" src/shared/session/task-completion-session.test.ts` exits 0 with output `all tests passed`. The final grep requires `1 passed .*0 failed`, but this runner does not emit that summary for a passing filtered run, so the OC exits 1 after the test has passed."
      userNote: "the are written wrong, the tests pass"
      waivedAt: "2026-08-13T03:39:46.715Z"
    - id: "OC4"
      command: "bash -lc 'set -euo pipefail; test -f src/shared/workflow/validation-plan-amendment.test.ts; grep -qF \"publication preserves an accepted execution Plan definition amendment\" src/shared/workflow/validation-plan-amendment.test.ts; out=$(deno run -A scripts/run-tests.js --filter \"publication preserves an accepted execution Plan definition amendment\" src/shared/workflow/validation-plan-amendment.test.ts 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed .*0 failed\"'"
      source: "engineer_report"
      explanation: "Defective check. The file and test-name grep pass, and `deno run -A scripts/run-tests.js --filter \"publication preserves an accepted execution Plan definition amendment\" src/shared/workflow/validation-plan-amendment.test.ts` exits 0 with output `all tests passed`. The final grep requires `1 passed .*0 failed`, but this runner does not emit that summary for a passing filtered run, so the OC exits 1 after the test has passed."
      userNote: "the are written wrong, the tests pass"
      waivedAt: "2026-08-13T03:39:46.715Z"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-12T12:23:35-04:00"
status: "verified"
origin: "internal"
implementedAt: "2026-08-13T03:34:02.044Z"
verifiedAt: "2026-08-14T18:31:54.041Z"
userVerifiedAt: null
executionReport: "- Confirmed implementation already exists at HEAD `b3d5834a` for `prevent-objective-check-repair-loops`; no code changes were needed in this run.\n- Verified targeted Plan suite passed: `deno run -A scripts/run-tests.js src/tools/__tests__/task-completed.test.js src/shared/session/task-completion-session.test.ts src/shared/workflow/workflow-results.test.js src/shared/workflow/validation-completion-gating.test.ts src/shared/workflow/validation-loop-repair.test.js src/shared/workflow/validation-plan-amendment.test.ts src/shared/workflow/validation-lifecycle-resume.test.js src/shared/workflow/execution-context.test.js src/shared/workflow/validation-loop-delivery.test.js src/plan-store.test.js` exited 0.\n- Verified `deno task seams:check` exited 0 and `deno task test` exited 0 (`283 files passed`).\n- `deno task ci` first failed because `src/ui/tui/golden-scenarios/project-workflow.test.js` timed out waiting for `runtime:agent:planner`; reran that exact test and it passed, then reran full `deno task ci` and it passed (`283 files passed`).\n- Mutation proof attempted by copying changed regression tests into a detached `HEAD^` worktree; it failed there with missing pre-implementation production module `validation-plan-amendment.ts`, confirming the tests are not empty pass-throughs against prior code.\n- Manual interactive validation scenarios were not run in this non-interactive check; automated orchestration tests cover the reported primary/worktree divergence, claim routing, resume, waiver, amendment, and publication paths.\n- Working tree still has the pre-existing modified Plan file `docs/plans/prevent-objective-check-repair-loops.md`; I did not edit or clean it."
workRecord:
    status: "generated"
    recordId: "61aca895-8b29-413f-8b46-ea76b384dd6b"
    path: "docs/work-records/2026-08-14-objective-check-repair-loops-prevented.md"
    lastAttemptAt: "2026-08-14T18:32:00.816Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
validationCheckpoint: null
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "65b3f6017d3d474d984215630af0a63d83ddc666"
    targetBranch: "main"
    targetHeadBeforeMerge: "c85587e3c720675a41913ad43e1bc636a3c49859"
routingIntent: "PLANNED_CHANGE"
sessionName: "fix objective check loop"
validationCiAttempts: 0
validationSemanticRounds: 2
updatedAt: "2026-08-16T18:02:32.833Z"
archivedAt: "2026-08-16T18:02:32.833Z"
archivedFromStatus: "verified"
archivedFromPath: "docs/plans/prevent-objective-check-repair-loops.md"
---

# Prevent Objective Check Repair Loops

## Context

Workflow Validation repeatedly ran three stale, invalid Objective-Failing Check commands for
`runwield-web-tools-surface`. The Engineer removed the unsupported `-A` option from OC1 and OC2 inside the execution
worktree Plan. Equivalent commands passed. RunWield still loaded `objectiveChecks` from the primary-checkout Plan, ran
the old commands in the execution worktree, classified each exit code 1 as `unmet`, ignored the Engineer's
defective-check report, and consumed all three automatic repair attempts.

The current implementation has three distinct defects:

1. `loadCanonicalValidationPlan()` refreshes the primary Plan, but Objective-Failing Checks execute in the worktree. It
   does not inspect an existing worktree Plan for user-authorized definition changes. Some same-phase retries also keep
   the old `args.triageMeta` snapshot.
2. `task_completed` accepts `brokenObjectiveChecks`, but Mechanical Validation usually considers the report only when
   RunWield already classified the command as mechanically `broken`. A valid shell command that is logically defective,
   has an invalid subcommand option, selects zero tests, or points at a renamed file normally exits nonzero or even
   zero; those reports are ignored.
3. Completion claims are mixed into `triageMeta`, copied into active workflow state, and lost or retained according to
   incidental control flow. The session adapter also discards structured reports from Reviewer-feedback repairs.

Repository evidence confirms the exact stale-source failure. The primary Plan still contains `deno eval -A` for OC1 and
OC2. The execution worktree Plan contains the Engineer's corrected commands. `validation-engine.ts` loads Plan Markdown
and Front Matter through `loadPlan(projectRoot, planName)`, while `validation-mechanical.ts` only uses the worktree as
the command current working directory.

The prior Objective Check Waiver work specified that an Engineer explanation plus fresh output must reach user judgement
even when RunWield cannot detect the defect. Its Work Record has a user-verification notice rather than Workflow
Validation proof, and the implemented tests do not cover an Engineer-reported `unmet` or exit-zero defective check, a
changed worktree command, or stale metadata across retries.

The user chose this authority rule for the repair:

- The execution worktree Plan is the proposal source for Plan definition and Objective-Failing Check edits.
- An explicit user confirmation makes those edits canonical.
- RunWield remains the sole owner of Plan lifecycle, execution, validation, delivery, worktree, identity, and
  collaboration state.
- The accepted amendment is synchronized to both Plan copies and loaded fresh before the next attempt. In-memory Plan
  snapshots never override it.

## Objective

Make Objective-Failing Check repair converge after one Engineer diagnosis and one user decision.

After this change, an Engineer can report a defective check regardless of the command's exit status, and can edit a
check command in the execution worktree. RunWield shows the report and exact Plan amendment to the user before another
automatic repair round. The user can approve the amendment and retry, waive the defective check, return to Engineer, or
stop. Approved amendments and waivers are durable, use fresh Plan state, preserve RunWield-owned lifecycle facts, and
cannot be silently replaced by an old primary or in-memory copy.

## Approach

Add one validation-owned Plan amendment boundary and make structured Engineer reports first-class validation input.

`validation-plan-amendment.ts` will load the primary and execution Plan on every Mechanical Validation attempt and after
every completion-gated repair. It will compare a defined Plan-definition projection instead of comparing whole Front
Matter. The projection includes the Markdown body and reviewable definition fields such as summary, affected paths,
Objective-Failing Checks, Ticket References, and browser verification fields. It excludes Plan identity, Plan Status,
timestamps, baselines, waivers, retry counters, reports, review state, worktree metadata, collaboration state, and
Delivery Evidence. Execution-shaping fields that cannot safely change during active validation, such as Plan
Classification, parent/dependency structure, or execution owner, are detected and reported as requiring Plan re-review;
they are not hot-applied.

When the projection differs, RunWield shows an exact field/command diff. User approval runs a typed, journaled Plan
amendment transaction with compare-and-swap (CAS) revisions for both copies. The transaction writes the accepted
projection to the primary Plan while preserving all RunWield-owned fields, then reconciles the execution Plan to that
canonical result. A failure rolls back or leaves a recovery record; it never leaves one Plan silently authoritative over
the other.

Changed Objective-Failing Checks invalidate old matching baseline and waiver evidence. Before an approved command is
used, RunWield verifies that the new command is red against the recorded execution baseline tree. This baseline check
runs in an isolated temporary checkout of that tree, not against the implemented worktree. An already-green or broken
replacement is rejected without consuming an implementation-repair attempt. After the amendment commits, Mechanical
Validation reloads the Plan and runs the new command in the execution worktree.

Engineer `brokenObjectiveChecks` reports become durable, one-shot claims outside `triageMeta`. A report is matched to
the fresh current check by id and, when supplied, exact command. Mechanical Validation runs all current, non-waived
checks once, then presents matching claims with the Engineer explanation and fresh output regardless of whether the
command returned `met`, `unmet`, or mechanically `broken`. A report can therefore catch an exit-zero command that proves
nothing, such as a zero-test filter.

The user decision flow is:

- **Approve command changes and retry** when the execution Plan contains a valid amendment.
- **Waive defective checks** for matching Engineer-reported or mechanically detected defects.
- **Engineer follow-up** to return control without consuming another normal repair attempt.
- **Stop** to keep the Plan and worktree recoverable.

If a waiver is accepted, only the selected matching check id and command are waived; every other active check must be
met. If a waiver or amendment is rejected, RunWield collects feedback and sends it to Engineer without incrementing the
normal three-attempt implementation-repair budget. A stale or mismatched report cannot waive a different command.

Every retry boundary reloads current Plan Front Matter with replacement semantics for Plan-owned fields. Removing a
check or waiver from the canonical Plan removes it from the next attempt. `engineerReportedBrokenObjectiveChecks` is no
longer copied into `triageMeta` or active workflow state. Task Completion is acknowledged only after its structured
claim is handled or durably parked, so a process interruption cannot erase the pending user decision.

## Files to Modify

- `src/tools/task-completed.ts` — tighten execution-agent guidance and structured defective-check report validation;
  preserve backward compatibility for report-only completions.
- `src/shared/session/task-completion-session.ts` — keep structured Objective-Failing Check claims durable and
  consume-once until validation records that the user-decision path handled or parked them.
- `src/shared/session/agent-handler.ts` — pass Task Completion claims to validation separately from `triageMeta`, stop
  acknowledging them before the claim is handled, and load no Plan snapshot as validation authority.
- `src/shared/workflow/workflow-results.js` — preserve `brokenObjectiveChecks` from all completion-gated repair message
  streams and reject malformed entries consistently with the tool boundary.
- `src/shared/workflow/validation-types.ts` — define Plan amendment proposals, defective-check claims, handling
  outcomes, and fresh Plan snapshot types without embedding transient claims in Plan metadata.
- `src/shared/workflow/validation-ports.ts` — carry structured claims and Plan-amendment user decisions through the
  session-independent validation interface.
- `src/shared/workflow/validation-session-adapter.ts` — stop replacing Reviewer-feedback Engineer reports with an empty
  array and preserve the same structured completion result through root and isolated repair paths.
- `src/shared/workflow/validation-engine.ts` — replace stale merge semantics with a fresh canonical snapshot for every
  phase; Plan-owned arrays removed from Front Matter must not survive from caller metadata.
- `src/shared/workflow/validation-context.ts` — keep active workflow state limited to durable execution context and
  fresh Plan metadata; do not persist one-shot defective-check claims.
- `src/shared/workflow/validation-mechanical.ts` — reload before each CI/check attempt, detect and resolve worktree Plan
  amendments, honor Engineer claims independent of mechanical status, preserve all-check execution, and keep defective
  check decisions outside the automatic repair budget.
- `src/shared/workflow/validation-plan-amendment.ts` — own definition/lifecycle field partitioning, primary/worktree
  comparison, exact user-facing amendment summaries, baseline validation, CAS adoption, synchronization, rollback, and
  recovery evidence.
- `src/shared/workflow/objective-checks-baseline.ts` — expose the existing baseline classification for changed commands
  and support validation against an isolated materialization of the recorded execution baseline tree.
- `src/shared/workflow/objective-check-waivers.ts` — persist user-approved Engineer claims even when the fresh command
  result is mechanically `met` or `unmet`, while retaining exact id-and-command matching and fresh output evidence.
- `src/shared/workflow/state-transition.ts` — add a journaled validation Plan amendment transaction over the primary
  Plan and execution attempt resources; preserve lifecycle fields and verify both Plan postconditions.
- `src/shared/workflow/plan-lifecycle.js` — stage the already-reconciled canonical Plan at publication instead of
  overwriting accepted execution Plan definition changes with a stale copy.
- `src/plan-store.js` — centralize the normalized Plan-definition projection and RunWield-owned field partition used by
  amendment comparison and persistence.
- `docs/domain-language.md` — define **Plan Amendment** as a user-approved execution-time Plan-definition revision and
  distinguish it from RunWield-owned lifecycle mutation.
- `docs/plan-lifecycle.md` — replace the unconditional primary-Plan-authority statement with the approved split
  authority, amendment transaction, baseline invalidation, validation restart, and publication rules.
- `docs/workflows.md` — document defective-check reporting, amendment/waiver/follow-up/stop choices, and attempt-budget
  behavior.
- `src/tools/__tests__/task-completed.test.js` — cover accepted, malformed, and report-only `brokenObjectiveChecks` tool
  calls.
- `src/shared/session/task-completion-session.test.ts` — cover durable claim replay, delayed acknowledgement, process
  interruption, consume-once behavior, and a later completion without stale reports.
- `src/shared/workflow/workflow-results.test.js` — cover structured report extraction from root and isolated repair
  transcripts.
- `src/shared/workflow/validation-completion-gating.test.ts` — add the end-to-end regression for the reported loop:
  worktree commands differ from primary, Engineer reports the old nonzero commands as defective, user approves the
  amendment, and the corrected commands run once without reaching round three.
- `src/shared/workflow/validation-loop-repair.test.js` — cover Engineer-reported `met`, `unmet`, and mechanically
  `broken` results; waiver, amendment, follow-up, rejection-feedback, and attempt-budget outcomes.
- `src/shared/workflow/validation-plan-amendment.test.ts` — use real Git fixtures to cover field ownership, exact diffs,
  baseline-tree execution, CAS conflicts, two-copy synchronization, rollback/recovery, and publication preservation.
- `src/shared/workflow/validation-lifecycle-resume.test.js` — cover process-loss resume with a pending defective-check
  decision and fresh Plan reload after a durable pause.
- `src/plan-store.test.js` — cover stable Plan-definition projection and exclusion of every RunWield-owned Front Matter
  field.

## Reuse Opportunities

- `src/shared/workflow/objective-checks.ts` — reuse the real sequential command runner, cancellation, output capture,
  and summary formatting.
- `src/shared/workflow/objective-checks-baseline.ts` — reuse red/broken/already-green classification rather than adding
  a second Objective-Failing Check contract.
- `src/shared/workflow/state-transition.ts` — reuse ordered Plan/attempt locks, CAS revisions, journaling, rollback, and
  recovery records.
- `src/shared/workflow/execution-context.ts` — reuse proven primary/worktree identity and execution context resolution;
  never trust a path supplied only by the Agent.
- `src/shared/git-test-fixture.ts` — use real repositories and linked worktrees for regression coverage; do not add an
  injection seam for RunWield-owned Plan or worktree mutation.
- `src/shared/session/task-completion-session.ts` — extend its durable outbox instead of parsing Engineer prose or
  adding Plan Front Matter for transient claims.
- `src/shared/workflow/validation-interactions.ts` — reuse structured select/text interactions for confirmation and
  feedback.
- `src/shared/workflow/objective-check-waivers.ts` — retain exact id-and-command waiver matching and Work Record
  evidence.

## Implementation Steps

- [ ] A minimized end-to-end regression reproduces the reported failure with a real primary checkout and linked
      execution worktree: the primary Plan has invalid OC commands, the execution Plan has Engineer-corrected commands,
      and current validation reruns the primary commands until its repair limit.
- [ ] `task_completed` preserves a normalized defective-check claim with id, explanation, and optional exact command
      through tool result, durable Task Completion journal, claim, root validation dispatch, independent repair
      dispatch, and Reviewer-feedback repair dispatch. A completion with no claims cannot inherit an earlier claim.
- [ ] Accepted Task Completion claims remain replayable until Workflow Validation has either resolved the user decision
      or recorded a durable pause that retains the claim. Process loss between Engineer completion and the user prompt
      cannot erase or duplicate the decision.
- [ ] Validation constructs each phase from a fresh Plan snapshot with replacement semantics. Current primary Plan
      fields replace caller metadata, and removal of `objectiveChecks` or `objectiveCheckWaivers` removes them from the
      next attempt. One-shot Engineer claims are never stored in `triageMeta` or `ValidationWorkflowState`.
- [ ] `validation-plan-amendment.ts` defines one explicit Plan-definition projection and one complementary
      RunWield-owned projection. The definition projection contains the Markdown body and hot-reviewable planning
      fields. Identity, lifecycle, validation, review, execution, delivery, worktree, Work Record, and collaboration
      fields remain owned by RunWield and cannot be adopted from the execution Plan. A test exhaustively assigns every
      key in `PLAN_FRONT_MATTER_KEY_ORDER` to one side, so a later Front Matter field cannot silently gain the wrong
      authority.
- [ ] A changed execution Plan with matching Plan identity produces an exact amendment proposal that names each changed
      field and shows each Objective-Failing Check old/new command. Malformed, missing, symlinked, identity-mismatched,
      or execution-shaping changes fail closed with an actionable message and preserve both files.
- [ ] User approval applies the amendment through one journaled transaction with primary-Plan and execution-attempt
      locks, CAS-checks both Plan revisions, writes the definition projection to primary while preserving current
      RunWield-owned fields, reconciles the execution copy, and verifies both copies. Partial failure rolls back or
      leaves one actionable recovery record.
- [ ] Changed Objective-Failing Check ids or commands invalidate corresponding `objectiveChecksBaseline` results and
      `objectiveCheckWaivers`. Unchanged waiver evidence remains valid only when id and command still match.
- [ ] Every changed Objective-Failing Check runs against an isolated materialization of the recorded
      `executionBaselineTree` before amendment commit. The amendment is rejected when the replacement is already green,
      mechanically broken, canceled, or cannot be tied to the recorded execution attempt. The implemented worktree is
      never used as red-baseline evidence.
- [ ] After a valid amendment commits, Mechanical Validation reloads both Plans and runs only the accepted current
      commands in the execution worktree. It does not rerun an old command from the primary file, caller argument,
      active workflow, baseline record, or prior retry snapshot.
- [ ] A matching Engineer defective-check claim reaches user judgement after all active checks run, regardless of
      whether fresh execution classified the claimed check as `met`, `unmet`, or `broken`. The prompt shows the Engineer
      explanation, current command, fresh result/output, and any exact worktree amendment.
- [ ] The decision menu offers **Approve command changes and retry** when a valid proposal exists, **Waive defective
      checks**, **Engineer follow-up**, and **Stop** as applicable. Rejection collects feedback. Amendment review,
      accepted waiver, rejected waiver, Engineer follow-up, and Stop do not consume a normal implementation-repair
      attempt.
- [ ] An accepted Engineer-reported waiver records source `engineer_report`, exact current id and command, Engineer
      explanation, fresh output evidence, optional user note, and timestamp even when the shell exit status was `met` or
      `unmet`. The phase advances only when every other active check is met.
- [ ] A stale report id, a supplied command that does not equal the fresh current command, or a report for a removed
      check cannot authorize a waiver or amendment. RunWield shows the mismatch and offers Engineer follow-up or Stop
      without silently consuming another round.
- [ ] A user-rejected amendment or waiver sends the exact feedback, current Plan, and fresh check output to Engineer.
      The next completion is a new claim; old reports do not persist through active workflow metadata.
- [ ] An accepted Plan-body or verification-definition amendment after any validation progress records a lifecycle-safe
      return to `implemented`, clears stale semantic/human-review evidence, and reruns Mechanical Validation. A command-
      only amendment already at `implemented` stays there but still invalidates affected baseline/waiver evidence.
- [ ] Publication preserves the accepted Plan definition. `stageValidationPassedInExecutionWorktree()` can update only
      RunWield-owned verification and Delivery Evidence fields; it cannot overwrite a user-approved worktree amendment
      with pre-amendment Markdown.
- [ ] `docs/domain-language.md`, `docs/plan-lifecycle.md`, and `docs/workflows.md` describe the implemented split
      authority, Plan Amendment, defective-check judgement flow, baseline rule, and repair-budget behavior without
      claiming that a waiver is a passed check.
- [ ] The old failure mode is covered at real orchestration boundaries: primary/worktree divergence, root Task
      Completion, independent Objective Check repair, process resume, all three result classifications, and publication.
      Existing CI cancellation, ordinary unmet repair, waiver matching, lifecycle recovery, and Direct Delivery behavior
      remains protected.

## Verification Plan

- Automated:
  `deno run -A scripts/run-tests.js src/tools/__tests__/task-completed.test.js src/shared/session/task-completion-session.test.ts src/shared/workflow/workflow-results.test.js src/shared/workflow/validation-completion-gating.test.ts src/shared/workflow/validation-loop-repair.test.js src/shared/workflow/validation-plan-amendment.test.ts src/shared/workflow/validation-lifecycle-resume.test.js src/shared/workflow/execution-context.test.js src/shared/workflow/validation-loop-delivery.test.js src/plan-store.test.js`
- Automated: `deno task seams:check`
- Automated: `deno task test`
- Automated: `deno task ci`
- Mutation proof: copy the new/changed regression tests into a detached clean-HEAD worktree and confirm they fail there
  while they pass against the implementation. This prevents named empty tests from satisfying the objective without the
  production amendment, claim-routing, resume, and publication changes.
- Manual: In a linked execution worktree, make one Objective-Failing Check fail because of an invalid command option,
  remove that option in the worktree Plan, and complete Engineer repair with a defective-check report. Confirm RunWield
  shows the exact old/new command before another repair dispatch.
- Manual: Approve the command amendment. Confirm the corrected command is first proven red against the recorded
  execution baseline, then runs in the implemented worktree, and the old command never appears in a later attempt.
- Manual: Repeat with no Plan edit and choose **Waive defective checks**. Confirm the waiver names the current command,
  all other checks must pass, and Semantic Code Review continues without a third Engineer loop.
- Manual: Choose **Engineer follow-up**, then complete another repair. Confirm the attempt counter did not increase for
  the user-decision cycle and no stale report reappears.
- Manual: Stop after the Engineer report, restart RunWield, and resume the Plan. Confirm the pending report and
  amendment decision reappear once, using fresh Plan files.
- Expected: Editing RunWield-owned status/worktree/delivery fields in the execution Plan never changes canonical
  lifecycle state; the next reconciliation restores those fields from RunWield authority.
- Expected: Changing Plan Classification, hierarchy, or execution owner during active validation does not hot-apply;
  RunWield requires Plan re-review/restart with a clear message.
- Expected: Successful publication contains the accepted Plan body/check definitions plus mechanically staged verified
  lifecycle and Delivery Evidence fields.

## Edge Cases & Considerations

- The current working tree already contains unrelated dirty Plan files, including the primary
  `docs/plans/runwield-web-tools-surface.md`. Implementation must use isolated fixtures and must not repair or overwrite
  those user changes as part of this Plan.
- A network-backed Objective-Failing Check can be nondeterministic. Amendment baseline and validation runs retain the
  existing timeout/cancellation behavior; a timeout is not approval evidence and routes to user judgement or Stop.
- A mechanically `met` check with an Engineer defect claim can still be logically invalid. Do not auto-pass before the
  claim is judged; zero-test filters are the canonical example.
- A mechanically `broken` check without an Engineer report continues to use the same waiver/follow-up/stop path with
  source `mechanical_detection`.
- Removing a check is a Plan amendment, not an implicit waiver. The user must see and approve the removal, and the
  amendment record must not describe the removed check as met.
- Multiple changed or reported checks are reviewed as one bounded decision with per-check evidence. Approval applies
  only to the displayed revision; a concurrent edit causes a CAS conflict and requires a fresh review.
- Non-Git in-place execution has one physical Plan file. It still uses fresh replacement semantics and Engineer report
  handling, but it does not manufacture a two-copy amendment or baseline-tree claim that cannot be proven.
- Plan Amendment is new canonical domain language. The glossary update must define avoided aliases and stable ownership
  relationships in the same implementation change.
