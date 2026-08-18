---
planId: "8ecc1f44-d7c0-42d9-9014-507efeee6e82"
classification: "PLANNED_CHANGE"
workKind: "REFACTOR"
complexity: "HIGH"
summary: "Make Workflow Validation and Plans Doctor fix every safe problem, continue from one source of truth, protect working code, and explain the rare user choice in plain words."
affectedPaths:
    - "src/plan-front-matter.js"
    - "src/plan-store.js"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/shared/workflow/state-transition.ts"
    - "src/shared/workflow/validation.ts"
    - "src/shared/workflow/validation-supervisor.ts"
    - "src/shared/workflow/validation-checkpoint.ts"
    - "src/shared/workflow/validation-recovery.ts"
    - "src/shared/workflow/validation-user-messages.ts"
    - "src/shared/workflow/validation-user-messages.test.ts"
    - "src/shared/workflow/validation-engine.ts"
    - "src/shared/workflow/validation-context.ts"
    - "src/shared/workflow/validation-emit.ts"
    - "src/shared/workflow/validation-interactions.ts"
    - "src/shared/workflow/validation-human-review.ts"
    - "src/shared/workflow/validation-local-ci.ts"
    - "src/shared/workflow/validation-helpers.ts"
    - "src/shared/workflow/validation-progress.ts"
    - "src/shared/workflow/validation-types.ts"
    - "src/shared/workflow/validation-ports.ts"
    - "src/shared/workflow/validation-session-adapter.ts"
    - "src/shared/workflow/execution-context.ts"
    - "src/shared/workflow/execution-plan-file.js"
    - "src/shared/workflow/validation-plan-amendment.ts"
    - "src/shared/workflow/validation-mechanical.ts"
    - "src/shared/workflow/validation-semantic.ts"
    - "src/shared/workflow/validation-publication.ts"
    - "src/shared/workflow/validation-merge-repair.ts"
    - "src/shared/workflow/validation-merge-verification.ts"
    - "src/shared/session/task-completion-session.ts"
    - "src/shared/session/agent-handler.ts"
    - "src/shared/session/session-runtime.js"
    - "src/shared/workflow/orchestrator.ts"
    - "src/shared/workflow/epic-continuation.ts"
    - "src/cmd/load-plan/index.ts"
    - "src/cmd/load-plan/plan-execution.ts"
    - "src/cmd/load-plan/plan-recovery-actions.ts"
    - "src/cmd/load-plan/plan-recovery-flow.ts"
    - "src/cmd/load-plan/plan-recovery-worktree.ts"
    - "src/cmd/load-plan/plan-recovery-reset.ts"
    - "src/cmd/load-plan/plan-recovery-merge.ts"
    - "src/cmd/load-plan/transition-failure.ts"
    - "src/cmd/plans/doctor.ts"
    - "src/cmd/plans/doctor.test.ts"
    - "src/cmd/plans/doctor-messages.ts"
    - "src/cmd/plans/doctor-messages.test.ts"
    - "src/cmd/registry.js"
    - "src/shared/workflow/transition-recovery.ts"
    - "src/shared/worktree-registry.js"
    - "src/shared/workflow/validation-self-healing.integration.test.ts"
    - "src/shared/workflow/validation-owner.test.ts"
    - "src/shared/workflow/validation-plan-amendment.test.ts"
    - "src/shared/workflow/execution-context.test.js"
    - "src/shared/workflow/execution-plan-file.test.js"
    - "src/shared/workflow/validation-publication-pause.test.js"
    - "src/shared/workflow/validation-merge-verification.test.ts"
    - "src/shared/workflow/validation-loop-core.test.js"
    - "src/cmd/load-plan/plan-recovery-flow.test.ts"
    - "src/cmd/load-plan/index.integration.test.ts"
    - "src/shared/session/agent-handler.test.ts"
    - "src/shared/session/session-runtime.test.js"
    - "src/shared/workflow/orchestrator.test.ts"
    - "src/shared/workflow/epic-continuation.test.js"
    - "docs/domain-language.md"
    - "docs/plan-lifecycle.md"
    - "docs/prd/runwield-core-prd.md"
    - "src/skills/runwield/PLANS.md"
    - "src/skills/runwield/COMMANDS.md"
objectiveChecks:
    - id: "OC1"
      command: "test -f src/shared/workflow/validation-self-healing.integration.test.ts && test \"$(wc -l < src/shared/workflow/validation-self-healing.integration.test.ts)\" -ge 250 && grep -q 'makeValidationProjectRoot' src/shared/workflow/validation-self-healing.integration.test.ts && grep -q 'stale RunWield state self-heals and validation continues' src/shared/workflow/validation-self-healing.integration.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/validation-self-healing.integration.test.ts --filter 'stale RunWield state self-heals and validation continues'"
      rationale: "This requires a substantial real-project integration regression for the reported Plan-copy drift and proves validation reaches the next phase instead of asking the user to repair RunWield state."
    - id: "OC2"
      command: "test -f src/shared/workflow/validation-supervisor.ts && grep -q 'export async function continueWorkflowValidation' src/shared/workflow/validation-supervisor.ts && for f in src/shared/session/agent-handler.ts src/shared/session/session-runtime.js src/shared/workflow/orchestrator.ts src/shared/workflow/epic-continuation.ts src/cmd/load-plan/plan-execution.ts; do grep -q 'continueWorkflowValidation' \"$f\" && ! grep -q 'runValidationLoop' \"$f\" || exit 1; done && deno run -A scripts/run-tests.js src/shared/workflow/validation-owner.test.ts --filter 'every production entry uses one validation owner'"
      rationale: "This prevents an alias-only workaround: the production callers must use the new supervisor and must no longer reference the lower-level loop directly."
    - id: "OC3"
      command: "test -f src/shared/workflow/validation-user-messages.ts && test -f src/shared/workflow/validation-user-messages.test.ts && test -f src/cmd/plans/doctor-messages.test.ts && grep -qi 'flesch' src/shared/workflow/validation-user-messages.test.ts && grep -Eq 'appendSystemMessage|emitStatus' src/shared/workflow/validation-user-messages.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/validation-user-messages.test.ts src/cmd/plans/doctor-messages.test.ts --filter 'messages stay plain'"
      rationale: "This requires production message catalogs plus an inventory test that checks actual display paths for reading level, forbidden internal terms, and raw-error leaks."
    - id: "OC4"
      command: "grep -q '\"--check\"' src/cmd/plans/doctor.ts && grep -q 'plans doctor repairs every safe issue to a fixed point and preserves protected work' src/cmd/plans/doctor.test.ts && deno run -A scripts/run-tests.js src/cmd/plans/doctor.test.ts --filter 'plans doctor repairs every safe issue to a fixed point and preserves protected work'"
      rationale: "This proves Doctor repairs by default until clean, retains read-only mode, and preserves unmerged worktrees and working changes."
    - id: "OC5"
      command: "grep -q 'validationCheckpoint' src/plan-front-matter.js && grep -q 'validationGeneration' src/shared/session/task-completion-session.ts && grep -q 'repair completion survives process loss and resumes once' src/shared/workflow/validation-owner.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/validation-owner.test.ts --filter 'repair completion survives process loss and resumes once'"
      rationale: "This requires the durable Plan-owned continuation record and generation-addressed Task Completion needed to prevent nested validation and resume exactly once after process loss."
    - id: "OC6"
      command: "grep -q 'published candidate settlement resumes without a second merge' src/shared/workflow/validation-publication-pause.test.js && deno run -A scripts/run-tests.js src/shared/workflow/validation-publication-pause.test.js src/shared/workflow/validation-merge-verification.test.ts --filter 'published candidate settlement resumes without a second merge'"
      rationale: "This proves exact Git publication is recognized after interruption and remaining Plan/worktree cleanup continues without a duplicate merge."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-12T23:45:24-04:00"
status: "user_verified"
origin: "internal"
implementedAt: "2026-08-13T05:29:56.180Z"
userVerifiedAt: "2026-08-14T04:41:33.866Z"
userVerificationNote: "Marked user verified at the explicit request of the repository owner after the validated implementation was merged into main."
workRecord:
    status: "generated"
    recordId: "b4a008aa-4a33-4452-97ce-1420a507c061"
    path: "docs/work-records/2026-08-16-workflow-validation-now-self-heals.md"
    lastAttemptAt: "2026-08-16T03:50:58.635Z"
humanReviewMode: "always"
humanReviewDecision: "approved"
humanReviewedAt: "2026-08-13T18:47:46.301Z"
validationCheckpoint: null
executionMode: "worktree"
updatedAt: "2026-08-16T18:02:21.427Z"
archivedAt: "2026-08-16T18:02:21.427Z"
archivedFromStatus: "user_verified"
archivedFromPath: "docs/plans/make-workflow-validation-self-healing.md"
---

# Make Workflow Validation Self-Healing

## Context

Workflow Validation can stop even when RunWield still has the Plan, its registered worktree, and the Git history needed
to continue. The current system reads the same facts from several places and sometimes treats every copy as an equal
authority:

- the primary Plan;
- the Plan copy in the execution worktree;
- the worktree registry;
- Git;
- the active Session workflow;
- caller-provided execution context; and
- process-local validation position.

A stale projection can therefore veto the durable records. In the reported case, the execution Plan copy differed from
the primary Plan on `planId` and `collaborationRecommendation`. `execution-plan-file.js` reconciled only part of the
RunWield-owned metadata. `validation-plan-amendment.ts` then treated the remaining stale fields as an execution-shaping
change that required fresh Plan review. Validation stopped although the Plan and worktree were connected.

The same class of failure exists elsewhere:

- execution completion, Task Completion, `/load-plan`, Session resume, repair resume, orchestrator completion, and Epic
  child continuation enter validation through separate preparation paths;
- a repair Task Completion can start nested validation while the original validation call still owns stale state;
- validation position is stored only in a `WeakMap`, so process loss removes the information that distinguishes a fresh
  phase from a phase waiting for repair;
- many Plan, registry, Git, CI, review, amendment, and publication errors can escape the loop without a final visible
  recovery result;
- publication can merge successfully and then fail bookkeeping or a post-verification handoff, after which a retry can
  misclassify completed delivery as a new merge failure; and
- `/load-plan` can reject stale Plan or Session projections before the stronger registry and Git resolver can repair
  them.

Prior work correctly made Plan Lifecycle, worktree recovery, and publication proof strict. This change keeps strict
proof for real identity and delivery. It removes the false rule that stale derived copies can overrule their owners.

## Objective

Workflow Validation becomes a total, resumable workflow. For every nonterminal outcome, RunWield first repairs every
problem it can prove how to fix and continues. It asks the user only before a repair would delete an unmerged worktree
or reset working changes. It does not expose disagreement between its internal records as work for the user.

The authority model is:

| Fact                                                                                                               | Authority                                             |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Plan identity, classification, execution policy, hierarchy, status, review state, waivers, and accepted definition | Locked primary Plan and Plan Lifecycle                |
| Worktree ID pointer                                                                                                | Primary Plan                                          |
| Worktree path, branch, target, base refs and commits, execution baseline, and attempt status                       | Worktree registry                                     |
| Physical worktree attachment, checked-out branch, refs, trees, commits, and ancestry                               | Git                                                   |
| Unapproved body and allowed definition edits                                                                       | Execution Plan copy as a Plan Amendment proposal only |
| Active Agent, caller context, progress, and Session workflow                                                       | Rebuildable projections only                          |

One public reconcile-and-continue operation owns every validation entry and resume path. A RunWield-owned durable
validation checkpoint records only continuation facts that Plan Status cannot express, such as waiting for a specific
repair generation. It is part of locked Plan Lifecycle state, not a second workflow authority. Plan Status continues to
select Mechanical Validation, Semantic Code Review, or delivery.

If the recorded worktree folder is gone but its branch or commit remains, RunWield recreates the worktree and continues.
If the branch is gone but the worktree remains attached, RunWield creates a recovery branch at its current commit and
continues. Only when both the worktree and recoverable branch/commit are gone does RunWield ask:

> The worktree and branch are gone. The Plan says they should be here. What do you want to do?

The choices are:

- **Try the implementation again** — abandon the lost attempt, return the Plan to Ready For Work, create a new attempt,
  and start its recorded execution Agent.
- **Send the Plan back to Planner** — preserve the loss record, reopen Plan review, and activate Planner.
- **Stop here** — abandon the lost attempt and leave the Plan at Ready For Work without starting execution.

All validation, recovery, and Plans Doctor messages use plain words and short sentences. The target is a fourth-grade
reading level. Git terms such as `branch`, `commit`, and `worktree` are allowed when they name the real thing the user
must inspect. User messages must not name internal storage or control terms, including `worktree registry`,
`Front
Matter`, `lifecycle`, `projection`, `checkpoint`, `settlement`, `execution context`, `Delivery Evidence`, or raw
field names. Internal codes and technical details remain available to logs, metrics, and tests, but are mapped to plain
user messages at the display edge.

`wld plans doctor` repairs safe problems by default. `--repair` remains a compatible alias. Add `--check` for users who
want a read-only report. Validation and Plan loading call the same repair engine automatically before they consider a
user prompt. Safe repair includes stale names and IDs, abandoned locks, completed journals, missing derived Plan copies,
provable Plan/worktree links, missing worktree records, recoverable paths and branches, baselines, and publication
cleanup. A repair is not safe only when it would delete an unmerged worktree or reset working changes. In those cases,
RunWield preserves all files and asks a short, specific question.

## Approach

### One continuation path

Add `continueWorkflowValidation` in `validation-supervisor.ts` as the only production entry for planned-change
validation.

```text
execution completion / task_completed / load-plan / resume / repair / Epic child
                                  |
                                  v
                    continueWorkflowValidation
                                  |
                   lock Plan and claim generation
                                  |
             reconcile Plan -> registry -> Git -> projections
                                  |
             checkpoint -> run next phase -> settle outcome
                                  |
                 continue, wait, recover, or verify
```

Callers pass only the stable Project root, Plan name, trigger, and optional Task Completion reference. Caller metadata
and active Session state can help locate a candidate, but cannot veto canonical evidence. The supervisor:

1. reloads the primary Plan under the existing transition/Plan lock;
2. completes `execution_started` and `implementation_finished` checkpoints when durable completion evidence proves they
   are due;
3. resolves the attempt from the Plan's `worktreeId`, then the registry, then Git;
4. repairs stale registry and worktree projections when one unique attempt is provable;
5. materializes or reconciles the execution Plan copy;
6. rebuilds the active workflow and execution Agent projection from canonical policy;
7. claims one validation generation;
8. runs the phase selected by canonical Plan Status and the compatible durable checkpoint; and
9. settles or records a retryable continuation before releasing ownership.

Remove direct production calls to `runValidationLoop` from Agent Handler, Session Runtime, `/load-plan`, orchestrator,
Epic continuation, and post-execution wrappers. Keep `runValidationLoop` as the engine-level operation called by the
supervisor and as a focused test interface.

### One active owner and durable continuation

Replace `validation-position.ts` process-only authority with a typed, versioned Plan field owned by Plan Lifecycle. The
checkpoint contains the execution-attempt identity, expected Plan Status, next phase, state (`ready`, `running`,
`awaiting_repair`, or `paused`), repair kind and generation when applicable, and the last settled operation ID. It does
not copy paths, policy, Plan body, output, or review content.

A supervisor call uses Plan locking and compare-and-set writes to claim a generation. A second call for the same Plan:

- signals or leaves Task Completion for the current owner;
- observes a settled result and returns it; or
- takes over a stale durable checkpoint after process loss and reruns only operations with idempotency proof.

`task-completed` stays a durable consume-once outbox. Its event identifies the Plan attempt and validation repair
generation. The active supervisor is the sole live consumer while an Agent repair turn is in flight. Agent Handler must
not start nested validation. If the process stops, the unconsumed completion and Plan checkpoint let a later supervisor
continue once.

Every failed CI, Objective-Failing Check, review, or merge outcome is recorded before an external repair turn starts.
After the turn, the supervisor reloads canonical Plan state before it records another transition. It never writes an
event against the status snapshot that existed before an Agent turn.

### Deterministic reconciliation

`execution-context.ts` becomes an authority-directed resolver:

- the primary Plan's pointer and policy win over Session and caller projections;
- the registry wins for worktree location, branch, target, and baseline facts;
- Git verifies or repairs the registry's physical claims;
- a missing registry record is rebuilt from a unique attached worktree, Plan ID, and Git proof;
- a stale Plan path, branch, baseline, Session Plan ID, or returned execution context is overwritten in the projection
  direction and cannot block validation;
- a missing worktree is recreated from its branch or commit;
- a worktree without its recorded branch gets a recovery branch at its current commit; and
- multiple stale candidates are preserved while the Plan pointer wins. If the pointer is absent, RunWield selects the
  current attached attempt, then the newest Git-proven nonterminal attempt by stable recorded order. Other candidates
  remain untouched and cannot block the selected attempt.

Real identity checks remain strict. RunWield does not run or publish from a path that cannot be tied to the Project
repository and selected execution attempt. An unrelated repository, unprovable candidate, or physically lost attempt
uses the typed recovery flow instead of an escaping error.

The execution Plan is derived storage for primary-owned fields. Before amendment detection, `execution-plan-file.js`
synchronizes all execution-shaping fields from the primary Plan: `planId`, `classification`, `executionAgent`,
`collaborationRecommendation`, `origin`, `parentPlan`, `order`, and `dependencies`, plus existing lifecycle fields.
These differences never become Plan Amendment proposals.

Body and allowed definition changes remain reviewable proposals. Amendment approval uses the existing journaled
transition machinery. Once the primary Plan accepts a definition revision, that revision is authoritative. If execution
copy synchronization stops, the next supervisor call completes primary-to-execution synchronization; it cannot propose
the old execution copy back to the user.

Malformed, unreadable, symlinked, or non-regular execution Plan copies never overwrite the primary Plan. RunWield
preserves the bytes or path as bounded recovery evidence outside the publication candidate, materializes the canonical
copy at the required path when filesystem safety permits, and continues. If fixing the primary Plan would overwrite
working changes, RunWield preserves the file and asks before replacement. This is a protected working-change case, not
an internal-state refusal.

### Total recovery results

Add typed validation operation results and recovery classes in `validation-recovery.ts`:

- `reconcile_and_retry` for stale RunWield-owned state and idempotent incomplete transitions;
- `retry_later` for transient external failures with bounded backoff and a durable phase checkpoint;
- `agent_correction` for invalid Reviewer or execution-Agent protocol output in the same Agent turn;
- `user_action` only when the next repair would delete an unmerged worktree or reset working changes, including the
  agreed lost-attempt choice when no worktree, branch, or commit remains; and
- `terminal` only after the Plan is verified, deliberately sent back to Planner, deliberately reset to Ready For Work,
  or deliberately closed by an existing lifecycle action.

`continueWorkflowValidation` catches every phase exception and converts it to one of these results. A nonterminal result
always emits a visible plain-language status, preserves the Plan, worktree, validation checkpoint, active execution
Agent, and Task Completion evidence, and supplies a runnable retry or recovery action. It does not record
`validation_failed` for RunWield bookkeeping or infrastructure disagreement. Actual failed checks and review findings
keep their existing lifecycle meaning.

A bounded convergence limit returns a visible durable retry result naming the next phase. It never returns the last
phase's success text while more work remains.

### Plain messages and repair-first Plans Doctor

Move user-facing validation and recovery text behind typed message builders. Internal modules return stable reason codes
and bounded technical detail. `validation-user-messages.ts` turns those results into short messages that answer three
questions:

1. What happened?
2. What did RunWield fix or preserve?
3. What happens next, or what one choice is needed?

Do not append raw exception text to TUI, headless, `/load-plan`, or Plans Doctor messages. Keep raw detail in structured
logs and metrics. A message can name a Plan, file, branch, commit, worktree, command, test, or code review. It cannot
ask the user to fix RunWield's saved status, IDs, journals, registry rows, fields, or phase records.

`validation-user-messages.test.ts` inventories every user-visible string emitted by validation, publication, and
validation recovery. It applies a Flesch-Kincaid grade-level check to sentence text, with code spans, paths, commands,
identifiers, and allowed Git terms removed before scoring. Each message must score at grade 4 or lower, use short active
sentences, and contain no forbidden internal term. Labels and unavoidable proper names have separate length and banned-
term checks. The test also rejects direct raw-error interpolation at display calls outside the message builders.

Extract Plans Doctor display text to `doctor-messages.ts` and apply the same rules. Change command behavior:

```text
wld plans doctor          fix all safe problems, then show a short result
wld plans doctor --repair same behavior for compatibility
wld plans doctor --check  report only; change nothing
```

The shared Doctor repair engine runs to a fixed point: collect facts, prove repairs, apply them through existing locks
and transactions, reload, and repeat until no further safe repair is available. It may create missing bookkeeping,
restore a worktree from a branch, create a recovery branch for an attached worktree, close proven completed work, and
finish publication cleanup. It must not delete an unmerged worktree, run `git reset` on working changes, clean untracked
files, force checkout, or overwrite a dirty file. Those protected cases return one plain user choice and keep every path
and branch in place.

Validation, `/load-plan`, transition recovery, and worktree ambiguity paths call this repair engine directly. They do
not tell the user to run Plans Doctor for a problem RunWield can repair itself. The command remains useful for a full
Project scan and for the two protected choices.

### Publication settles from proof

Publication recovery treats Git ancestry and the journal as authority. A completed Direct Delivery is recognized only
when:

1. the exact sealed execution candidate is an ancestor of the target;
2. the metadata commit is an ancestor when one exists;
3. the canonical Plan is `verified` with matching Delivery Evidence; and
4. the registry is settled or a durable cleanup record preserves the remaining cleanup action.

If merge or target movement succeeded before bookkeeping stopped, the next supervisor call finishes Plan, hierarchy,
registry, and journal settlement without merging again. A failed registry cleanup preserves the attached worktree and a
durable cleanup action; it does not turn proven delivery into validation failure.

Work Record, Epic continuation, and other post-verification handoffs run after publication settlement. Their failures
are separate retryable handoff results and cannot change a Verified Plan into a merge failure or cause duplicate
publication. Hierarchy snapshot failure is not replaced by an empty snapshot; the journal records the pending hierarchy
settlement and retries it from canonical Plans.

The set-aside option is to add more local guards to each caller. That is smaller per incident but keeps several entry
paths and state copies able to disagree, which is the failure pattern this change must remove.

## Files to Modify

- `src/plan-front-matter.js` and `src/plan-store.js` — define, parse, order, and classify the typed RunWield-owned
  durable validation checkpoint; keep execution-shaping policy fields out of amendment proposals.
- `src/shared/workflow/plan-lifecycle.js` and `state-transition.ts` — own checkpoint claims, settlement, stale-operation
  takeover, amendment synchronization, lost-attempt choices, and publication recovery under existing locks and journals.
- `src/shared/workflow/validation-supervisor.ts` — provide the sole reconcile-and-continue entry, one-owner rule, phase
  driving, exception boundary, convergence result, and post-verification continuation.
- `src/shared/workflow/validation-checkpoint.ts` — define and validate checkpoint state, compatible Plan Status rules,
  repair generations, process-loss takeover, and terminal clearing without a Session dependency.
- `src/shared/workflow/validation-recovery.ts` — define typed operation failures and map each class to automatic retry,
  Agent correction, plain user choice, durable pause, or terminal settlement.
- `src/shared/workflow/validation-user-messages.ts` and its test — own all user-facing validation status, error, pause,
  repair, review, and publication text; enforce fourth-grade reading level, allowed Git terms, forbidden internal terms,
  and no raw exception interpolation.
- `src/shared/workflow/validation.ts`, `validation-engine.ts`, `validation-context.ts`, `validation-types.ts`,
  `validation-ports.ts`, and `validation-session-adapter.ts` — compose the supervisor over the session-independent
  engine, remove process-only position authority, expose narrow interaction/Agent operations, and ensure all phase
  outcomes settle through the supervisor.
- `validation-emit.ts`, `validation-interactions.ts`, `validation-human-review.ts`, `validation-local-ci.ts`,
  `validation-helpers.ts`, and `validation-progress.ts` — replace direct user text and raw-error forwarding with typed
  message keys while keeping structured internal reason codes and progress facts.
- `src/shared/workflow/execution-context.ts` and `execution-plan-file.js` — resolve in authority order, repair stale
  registry/Git projections, recreate recoverable worktrees or branches, synchronize every primary-owned shaping field,
  and preserve unsafe derived Plan copies before canonical restoration.
- `src/shared/workflow/validation-plan-amendment.ts` — detect only allowed definition proposals and make accepted
  primary-to-execution synchronization resumable and one-directional.
- `src/shared/workflow/validation-mechanical.ts` and `validation-semantic.ts` — record phase outcomes before repair
  dispatch, bind repair completion to one generation, classify operational failures, and remove stale post-turn writes.
- `src/shared/workflow/validation-publication.ts`, `validation-merge-repair.ts`, and `validation-merge-verification.ts`
  — require exact candidate/evidence proof, resume partial settlement, separate cleanup and handoff retries, and prevent
  duplicate publication.
- `src/shared/session/task-completion-session.ts`, `agent-handler.ts`, and `session-runtime.js` — address completion
  events to validation generations, remove competing consumers and direct validation starts, and resume through the
  supervisor.
- `src/shared/workflow/orchestrator.ts` and `epic-continuation.ts` — route completion and recoverable implemented
  children through the same supervisor instead of separate blocking paths.
- `src/cmd/load-plan/index.ts`, `plan-execution.ts`, `plan-recovery-actions.ts`, `plan-recovery-flow.ts`,
  `plan-recovery-worktree.ts`, `plan-recovery-reset.ts`, `plan-recovery-merge.ts`, and `transition-failure.ts` — run
  safe repair before any refusal, make validation-state Plans continue by default, protect unmerged worktrees and
  working changes, and use only plain user messages.
- `src/cmd/plans/doctor.ts`, `doctor-messages.ts`, command registration, tests, `transition-recovery.ts`, and
  `worktree-registry.js` — make Doctor repair safe problems by default to a fixed point, add read-only `--check`,
  preserve `--repair`, share the repair engine with validation/load-plan, and remove internal storage terms from output.
- Focused tests named in Front Matter — prove the reported case, ownership, restart, every entry path, physical
  recovery, amendment interruption, publication settlement, Doctor fixed-point repair, protected working state, reading
  level, and plain lost-attempt choices with real Plan/Git fixtures.
- `docs/domain-language.md` — define the durable Validation Checkpoint and state that it supplements rather than
  competes with Plan Status, registry, and Git authority.
- `docs/plan-lifecycle.md` and `docs/prd/runwield-core-prd.md` — document the authority order, total continuation
  behavior, repair-first Doctor policy, protected worktree/working-change rule, plain-message rule, lost-attempt
  choices, checkpoint clearing, publication settlement, and user-visible guarantees.
- `src/skills/runwield/PLANS.md` and `COMMANDS.md` — document Doctor's repair-by-default behavior, compatible
  `--repair`, read-only `--check`, and the two protected cases.

## Reuse Opportunities

- `src/shared/workflow/state-transition.ts` — reuse ordered resources, Plan locks, journals, effect proof, rollback, and
  reconciliation instead of adding an uncoordinated validation store.
- `src/shared/workflow/plan-lifecycle.js` — keep Plan Status as phase authority and keep strict compare-and-set
  transitions.
- `src/shared/workflow/execution-context.ts` — extend its existing registry restoration, canonical Plan ID adoption,
  baseline derivation, Git checks, and execution Plan restoration.
- `src/shared/workflow/execution-plan-file.js` — extend its one-directional canonical metadata reconciliation and atomic
  revision checks.
- `src/shared/session/task-completion-session.ts` — retain the durable accepted/consumed outbox and add
  generation-scoped ownership rather than adding another completion channel.
- `src/shared/workflow/validation-merge-verification.ts` and publication journals — reuse exact ancestry proof and
  recover incomplete settlement instead of trusting status text.
- `defineGitFixture`, `makeValidationProjectRoot`, real Plan transactions, and the existing Local CI/Agent external
  ports — test RunWield-owned machinery without a new injection seam.

## Implementation Steps

- [ ] `src/shared/workflow/validation-self-healing.integration.test.ts` reproduces the reported primary/execution Plan
      mismatch with both `planId` and `collaborationRecommendation`, reaches fresh Mechanical Validation, and contains
      no fresh-review error or user state-repair prompt.
- [ ] `continueWorkflowValidation` is the only production entry for planned-change validation; execution completion,
      Task Completion, `/load-plan`, Session resume, semantic repair, orchestrator, and Epic child paths call it and do
      not call `runValidationLoop` directly.
- [ ] The primary Plan, worktree registry, and Git own the facts in the Objective table. Active Session workflow,
      `triageMeta`, returned execution context, duplicate Plan worktree fields, and execution Plan metadata are rebuilt
      projections and cannot veto a proven attempt.
- [ ] A typed, versioned Plan Lifecycle checkpoint survives process and Session replacement, agrees with canonical Plan
      Status, distinguishes pending repair generations, and is cleared on verification, review reopen, recovery reset,
      hold reset, closure, and attempt replacement.
- [ ] One live supervisor owns each Plan validation generation. A repair Task Completion wakes or remains queued for
      that owner, cannot start nested validation, is consumed once after a retry-safe checkpoint, and remains
      recoverable after process loss.
- [ ] Mechanical, objective-check, semantic, human-review, and merge repair paths record known outcomes before external
      Agent turns and reload canonical Plan state after each turn; no path writes a lifecycle event from a pre-turn
      status snapshot.
- [ ] The execution Plan synchronizes all primary-owned execution-shaping and lifecycle fields before amendment
      detection. Only body and allowed definition fields can produce a Plan Amendment proposal.
- [ ] Accepted Plan Amendments use a journaled primary-authoritative revision. Interruption after the primary write
      resumes synchronization to the execution copy and cannot reverse-propose stale execution content.
- [ ] Missing or stale worktree records, paths, branches, targets, baselines, and Plan projections reconcile from the
      authority order. A recoverable branch recreates a worktree; a recoverable attached worktree creates a branch; no
      user metadata repair is required.
- [ ] When both worktree and branch/commit are gone, the user receives exactly the agreed plain choices. Retry creates a
      new attempt, Planner reopens review and activates Planner, and Stop leaves a clean Ready For Work Plan.
- [ ] Every engine, CI, Objective-Failing Check, Agent, review, amendment, registry, Git, publication, and handoff
      exception becomes a typed visible result with a next action. Nonterminal operational failures preserve active
      execution ownership and do not record a false implementation validation failure.
- [ ] The convergence cap returns a durable retryable pause with the next phase. It cannot silently return a stale
      success reason while validation remains nonterminal.
- [ ] Publication success requires exact candidate and metadata ancestry plus matching canonical Delivery Evidence.
      Interrupted Plan/hierarchy/registry/journal settlement resumes without another merge, and post-verification
      handoff failures cannot move a Verified Plan backward.
- [ ] Every user-visible validation, publication, and Plan recovery message comes from typed message builders, scores at
      fourth-grade reading level or lower after technical-token normalization, uses only allowed Git terms, contains no
      forbidden internal term or raw field name, and never appends raw exception text.
- [ ] `wld plans doctor` and compatible `--repair` repair all provable safe issues to a fixed point. `--check` is
      read-only. Validation and `/load-plan` invoke the same repair engine before prompting the user.
- [ ] Doctor and validation never delete an unmerged worktree, reset working changes, clean untracked files, force a
      checkout, or overwrite a dirty file. Every other proven repair completes automatically without a refusal.
- [ ] `docs/domain-language.md`, `docs/plan-lifecycle.md`, and the Core PRD describe the implemented authority model,
      Validation Checkpoint, automatic reconciliation, physical-loss choice, and publication settlement behavior.
- [ ] The zero-seam rule remains green; Plan writes, lifecycle transitions, registry writes, locks, amendment
      settlement, and publication settlement use real RunWield-owned machinery in tests.

## Approval Confirmation

This Plan does not declare any Work Record supersession. It refines prior lifecycle and fail-closed verification work by
keeping strict identity and delivery proof while removing stale projections as veto authorities.

## Verification Plan

- Automated:
  - `deno run -A scripts/run-tests.js src/shared/workflow/validation-self-healing.integration.test.ts`
  - `deno run -A scripts/run-tests.js src/shared/workflow/validation-user-messages.test.ts src/cmd/plans/doctor-messages.test.ts src/cmd/plans/doctor.test.ts`
  - `deno run -A scripts/run-tests.js src/shared/workflow/validation-owner.test.ts src/shared/session/task-completion-session.test.ts src/shared/session/agent-handler.test.ts`
  - `deno run -A scripts/run-tests.js src/shared/workflow/execution-context.test.js src/shared/workflow/execution-plan-file.test.js src/shared/workflow/validation-plan-amendment.test.ts`
  - `deno run -A scripts/run-tests.js src/cmd/load-plan/plan-recovery-flow.test.ts src/cmd/load-plan/index.integration.test.ts src/shared/session/session-runtime.test.js src/shared/workflow/orchestrator.test.ts src/shared/workflow/epic-continuation.test.js`
  - `deno run -A scripts/run-tests.js src/shared/workflow/validation-loop-core.test.js src/shared/workflow/validation-completion-gating.test.ts src/shared/workflow/validation-lifecycle-resume.test.js src/shared/workflow/validation-loop-repair.test.js src/shared/workflow/validation-loop-review.test.js src/shared/workflow/validation-loop-human-review.test.js`
  - `deno run -A scripts/run-tests.js src/shared/workflow/validation-publication-pause.test.js src/shared/workflow/validation-merge-verification.test.ts src/shared/workflow/validation-work-record-handoff.test.ts`
  - `deno task seams:check`
  - `deno task check`
  - `deno task ci`
- Integration-test integrity:
  - Each new integration test creates its own real Plan, worktree, branch, and RunWield state with
    `makeValidationProjectRoot` and `defineGitFixture` or the equivalent existing real fixture. It asserts the broken
    precondition before invoking production code, then asserts the resulting Plan status, Git refs/ancestry, worktree
    bytes, emitted messages, call counts, and durable reopen state. Empty tests, mocked return-only tests,
    source-text-only tests, and tests that do not prove their broken precondition do not satisfy this Plan.
  - The message inventory test discovers production display calls and catalogs from source paths; a hand-written sample
    list is not enough. The Doctor test runs the real command twice, proves the first pass repairs and the second pass
    is clean, then proves `--check` leaves byte and Git snapshots unchanged.
- Manual:
  - Load an Implemented Plan whose primary and execution copies differ on `planId` and `collaborationRecommendation`;
    select validation and confirm RunWield fixes the issue and says only that it is running the tests. It must not show
    either field name or ask for Plan review.
  - Stop the process while a validation repair awaits Task Completion, reopen the Session or load the Plan, complete the
    repair once, and confirm validation resumes once from the saved phase.
  - Remove only a recorded worktree folder while preserving its branch; load the Plan and confirm RunWield recreates the
    worktree and continues without a recovery menu.
  - In a disposable fixture, remove both worktree and branch/commit; confirm the exact plain three-choice prompt and
    each lifecycle result.
  - Interrupt publication after target movement but before registry or Work Record settlement; retry and confirm no
    second merge occurs and the Plan remains or becomes Verified from exact proof.
  - Seed every safe Doctor issue in one disposable Project. Run `wld plans doctor` with no flag and confirm it fixes all
    issues in repeated passes. Run `--check` and confirm it changes no files.
  - Seed an unmerged worktree and a dirty worktree. Confirm Doctor and validation leave both byte-for-byte and
    ref-for-ref unchanged and ask a short question before any destructive action.
  - Read every validation, recovery, and Doctor prompt in the TUI. Confirm it uses short plain sentences and does not
    show internal storage names, raw Plan field names, or raw exception text.
- Behavior protected afterwards:
  - Plan Lifecycle remains the only status state machine and strict stale transition checks remain enabled.
  - Worktree registry and Git proof remain required before RunWield executes or publishes from a worktree.
  - Execution Plan body and allowed definition changes still require Plan Amendment review.
  - CI, Objective-Failing Checks, Semantic Code Review, Local Human Code Review, and delivery proof retain their current
    pass/fail meaning.
  - Task Completion stays durable and consume-once; isolated Agent completions remain separate from the root outbox.
  - User-owned primary checkout changes are preserved during publication and cleanup.
- Behavior expected to stop existing:
  - Session, caller, or execution-copy projections can no longer block canonical Plan + registry + Git evidence.
  - RunWield-owned metadata mismatch can no longer demand fresh Plan review.
  - Two validation calls can no longer act on one repair Task Completion.
  - Process loss can no longer erase the only record that validation is waiting for repair.
  - Escaping exceptions and phase limits can no longer leave a nonterminal Plan with no visible next action.
  - Proven publication can no longer be repeated or changed into merge failure by later bookkeeping or handoff failure.
  - Validation and Plans Doctor no longer show internal storage names, control-state names, raw field names, or raw
    exceptions to the user.
  - Plans Doctor no longer stops after reporting a safe problem or requires `--repair` before it fixes one.
- Mutation proof:
  - Restore any direct production `runValidationLoop` call outside the supervisor and confirm the entrypoint
    architecture test fails.
  - Let active Session context veto the registry path and confirm stale-projection tests fail.
  - Remove repair generation matching or permit Agent Handler to start nested validation and confirm owner tests fail.
  - Stop amendment synchronization after the primary write and confirm interruption recovery still succeeds; reverse the
    authority direction and confirm the test fails.
  - Trust `verified` status without exact ancestry, or retry merge after proven target movement, and confirm publication
    tests fail.
  - Replace the lost-attempt prompt or make Stop enter any status other than `ready_for_work` and confirm recovery tests
    fail.
  - Add a forbidden internal term, a grade-5 sentence, or raw-error interpolation to any user message and confirm the
    message catalog tests fail.
  - Make Doctor leave a provable safe repair for a second manual command, or let it delete/reset protected work, and
    confirm fixed-point and preservation tests fail.

## Edge Cases & Considerations

- A stale projection is not the same as an unproven physical identity. Projections self-heal. An unrelated repository or
  attempt must never be executed or published as this Plan.
- A second active Session can race to continue the same Plan. Plan locking, checkpoint generation, and compare-and-set
  settlement must choose one owner; the loser reloads the settled or active result without starting work.
- A process can stop after an external effect but before local bookkeeping. Retry only after Git, Plan, transition
  journal, or Task Completion evidence proves whether the effect happened.
- Non-Git in-place execution has no registry worktree. The primary Plan and project root remain authoritative, while the
  same validation generation and exception rules apply.
- A canonical Plan that is missing, malformed, symlinked, or outside `docs/plans/` is not a stale projection. Preserve
  evidence and offer repository repair, Planner reconstruction, or stop actions without claiming validation.
- An execution Plan can contain intentional allowed definition edits mixed with stale RunWield metadata. Synchronize
  only primary-owned fields before computing the proposal so the intended definition diff remains visible.
- A malformed execution Plan can contain user text that cannot be parsed safely. Preserve its exact bytes before
  materializing the canonical copy; do not publish the recovery backup.
- If several attempts exist, a valid primary `worktreeId` wins. Without it, choose the current attached attempt, then
  the newest Git-proven nonterminal attempt by stable recorded order. Preserve every other worktree and branch.
  Selection never permits deletion or reset.
- Authentication, provider outage, test process-start failure, user cancellation, invalid Agent protocol, failed checks,
  and code-review findings require different responses. These are not internal-state refusals. Retry what is safe, then
  state the one external action in plain words. Do not send infrastructure or protocol failures to an implementation
  repair Agent.
- Bounded automatic retries must not consume CI or semantic repair rounds. Cancellation stops waiting and preserves the
  same durable checkpoint.
- A dirty execution worktree can be valid implementation evidence. Checkpoint it through the existing execution
  transaction when appropriate; never reset or clean it merely to make reconciliation pass.
- A dirty primary checkout and dirty worktree remain user-owned. Repair can inspect and preserve them, but cannot run a
  reset, clean, forced checkout, destructive restore, or overwrite. Ask before the exact destructive action and offer a
  non-destructive stop.
- Delivery settlement and post-verification handoffs are distinct. A pending Work Record or Epic handoff must remain
  retryable without weakening or repeating proven delivery.
- Doctor can repair an issue that reveals another issue. Repeat collect/prove/apply/reload until no safe repair remains,
  with a bounded no-progress guard that reports a plain stop instead of looping.
- Readability scoring must normalize paths, commands, identifiers, URLs, Plan names, and allowed Git terms so technical
  tokens do not create false failures. Do not exempt the surrounding sentence from grade and banned-term checks.
- Headless structured events keep stable internal codes for clients, but their human-readable `message` fields follow
  the same plain-language catalog as the TUI.
- Existing draft Plans for validation error classification, guided repair, and repair completion overlap parts of this
  objective. Implement this Plan against current source as the single authority and continuation refactor; do not create
  parallel validation supervisors or duplicate checkpoint stores.
- New TypeScript uses named types and does not use `any`, `unknown`, or `object`. Existing JavaScript touched by this
  Plan follows the repository JSDoc style.
