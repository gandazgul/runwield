---
planId: "482d1525-3be2-417e-bd9c-9b59bda1d71b"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
summary: "Classify Workflow Validation operational errors and apply retry, Agent correction, deterministic recovery, user action, or immediate halt without treating infrastructure failures as implementation failures."
affectedPaths:
    - "src/shared/workflow/validation-operational-errors.ts"
    - "src/shared/workflow/validation-recovery.ts"
    - "src/shared/workflow/validation-ports.ts"
    - "src/shared/workflow/validation-types.ts"
    - "src/shared/workflow/validation-session-adapter.ts"
    - "src/shared/workflow/validation-local-ci.ts"
    - "src/shared/workflow/validation-mechanical.ts"
    - "src/shared/workflow/validation-semantic.ts"
    - "src/shared/workflow/validation-engine.ts"
    - "src/shared/workflow/validation-supervisor.ts"
    - "src/shared/workflow/validation-publication.ts"
    - "src/shared/workflow/validation-merge-repair.ts"
    - "src/shared/workflow/validation-emit.ts"
    - "src/shared/workflow/validation-user-messages.ts"
    - "src/shared/workflow/validation-operational-errors.test.ts"
    - "src/shared/workflow/validation-operational-recovery.test.ts"
    - "src/shared/workflow/validation-local-ci.test.ts"
    - "src/shared/workflow/validation-publication.test.ts"
    - "src/shared/workflow/validation-self-healing.integration.test.ts"
    - "docs/settings.md"
    - "docs/plan-lifecycle.md"
objectiveChecks:
    - id: "OC1"
      command: "deno eval 'import { classifyValidationOperationalError as c } from \"./src/shared/workflow/validation-operational-errors.ts\"; const xs=[[{source:\"provider\",kind:\"rate_limited\",message:\"x\"},\"transient\"],[{source:\"reviewer_protocol\",kind:\"missing_review_complete\",message:\"x\"},\"correctable\"],[{source:\"validation_state\",kind:\"plan_missing\",message:\"x\"},\"missing_information\"],[{source:\"policy\",kind:\"prohibited\",message:\"x\"},\"fatal\"]]; for(const [x,w] of xs) if(c(x).recoveryClass!==w) Deno.exit(1);'"
      rationale: "This calls the production classifier directly and proves that one representative typed failure maps to each recovery class."
    - id: "OC2"
      command: "grep -q 'transient Reviewer failures use jittered backoff without consuming semantic rounds' src/shared/workflow/validation-operational-recovery.test.ts && grep -q 'correctable Reviewer failures stay in the same session with structured feedback' src/shared/workflow/validation-operational-recovery.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/validation-operational-recovery.test.ts --filter 'Reviewer failures'"
      rationale: "This proves that retry and Agent correction are different actions, and that neither action spends an implementation-repair round."
    - id: "OC3"
      command: "! grep -q 'exitCode: canceled ? 130 : 1' src/shared/workflow/validation-local-ci.ts && grep -q 'CI process start failure does not dispatch implementation repair' src/shared/workflow/validation-local-ci.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/validation-local-ci.test.ts --filter 'CI process start failure does not dispatch implementation repair'"
      rationale: "This removes the current synthetic CI verdict and proves through the real boundary that a process-start failure cannot dispatch source repair."
    - id: "OC4"
      command: "! grep -q 'failureKind !== \"primary_checkout_dirty\"' src/shared/workflow/validation-publication.ts && grep -q 'publication dispatches merge repair only for a content conflict' src/shared/workflow/validation-publication.test.ts && grep -q 'fatal publication error halts without retry or repair' src/shared/workflow/validation-publication.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/validation-publication.test.ts --filter 'publication'"
      rationale: "This removes the current broad repair condition and proves that publication races, missing state, dirt, conflicts, and fatal failures take distinct paths."
    - id: "OC5"
      command: "deno task seams:check && deno task check && deno task ci"
      rationale: "This protects the zero-seam baseline, TypeScript rules, Plan Lifecycle invariants, validation behavior, and the full repository."
objectiveCheckWaivers:
    - id: "OC5"
      command: "deno task seams:check && deno task check && deno task ci"
      source: "mechanical_detection"
      explanation: "Objective check timed out after 120000ms."
      userNote: "command cant execute"
      waivedAt: "2026-08-19T13:37:45.570Z"
    - id: "OC4"
      command: "! grep -q 'failureKind !== \"primary_checkout_dirty\"' src/shared/workflow/validation-publication.ts && grep -q 'publication dispatches merge repair only for a content conflict' src/shared/workflow/validation-publication.test.ts && grep -q 'fatal publication error halts without retry or repair' src/shared/workflow/validation-publication.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/validation-publication.test.ts --filter 'publication'"
      source: "engineer_report"
      explanation: "The named file `src/shared/workflow/validation-publication.test.ts` does not exist. Running the command fails at grep with `grep: src/shared/workflow/validation-publication.test.ts: No such file or directory` and exit code 2, so this check cannot prove the publication recovery objective."
      waivedAt: "2026-08-19T19:34:20.285Z"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-12T00:47:42-04:00"
updatedAt: "2026-08-20T00:41:26.240Z"
status: "verified"
origin: "internal"
implementedAt: "2026-08-19T01:26:34.635Z"
verifiedAt: "2026-08-20T00:41:26.240Z"
userVerifiedAt: null
executionReport: "- Added typed Workflow Validation operational errors and recovery decisions, including recovery classes, stable codes, bounded Retry-After parsing, capped full-jitter retry delay calculation, correction limits, and operational metrics.\n- Updated Local CI and isolated Agent outcome types to discriminated results; Local CI process-start and missing-command failures now use operational recovery before repair counters or lifecycle failure events.\n- Integrated semantic reviewer protocol corrections, transient operational handling, and publication routing so only proven merge conflicts dispatch merge repair and target-reference races retry.\n- Added `retry.validation.maxDelayMs` schema/docs and Plan Lifecycle docs that operational retries/pauses/halts do not advance or reset Plan Status.\n- Updated tests and fixtures for the new CI result contract; test delta: +9 automated tests, 0 tests removed. Golden publication scripts were reduced only where Agent repair is no longer expected for non-conflict operational failures.\n- Verification passed: focused operational/local-CI/review/repair/publication/resume tests, `deno task seams:check`, `deno task check`, and full `deno task ci` (336 files passed, 0 failed).\n- Note: the Plan listed `src/shared/workflow/validation-publication.test.ts`, but this checkout has `validation-publication-pause.test.js`; I ran the existing publication test file instead."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
validationCheckpoint: null
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "79fb4ee1f78114a43d787e903500899eb53f3475"
    targetBranch: "main"
    targetHeadBeforeMerge: "1651f7ec36e281fc8afc144bbac03dc9383214d0"
routingIntent: "PLANNED_CHANGE"
sessionName: "validation error recovery"
validationCiAttempts: 0
validationObjectiveCheckAttempts: 0
validationSemanticRounds: 0
---

# Classify Workflow Validation Operational Errors

## Context

Workflow Validation must answer two different questions:

1. Did the implementation fail a validation check?
2. Could RunWield complete the validation operation?

The current loop does not keep these questions separate in all phases.

- Local CI returns exit code `1` when RunWield cannot start the validation process. Mechanical Validation can then
  dispatch an Engineer to repair source code that did not fail a test.
- Semantic Code Review catches every Reviewer execution exception and repeats the Reviewer operation. It does not use an
  error class, a delay, or jitter. It also uses the same three-attempt shape for missing protocol output and provider
  failures even though these failures require different responses.
- Publication sends most failures to merge repair. Only a dirty primary checkout is excluded. A compare-and-swap race,
  missing worktree, permission error, and content conflict do not require the same response.
- Plan and worktree precondition failures return plain reason strings. Callers cannot tell whether RunWield should
  retry, ask an Agent to correct its request, choose a path that does not need missing information, or halt.
- The validation supervisor now repairs provable RunWield-owned state before it claims a durable Validation Checkpoint,
  but its outer catch still turns every remaining exception into the same `validation_operation_failed` retry-later
  result. The operational policy must run inside that authority model, not replace it.

`CI_REPAIR_CYCLES`, `OBJECTIVE_CHECK_REPAIR_CYCLES`, and `SEMANTIC_REVIEW_CYCLES` limit implementation repair. They must
not count network retries, provider rate limits, invalid Agent tool arguments, or missing resources.

## Objective

Add one typed operational-error model to Workflow Validation. Each operational failure has one of four recovery classes:

- **transient** — the same idempotent operation can succeed later;
- **correctable** — the current Agent can correct its request or result from structured feedback;
- **missing_information** — the same operation cannot succeed until it uses a different resource or RunWield restores
  missing state; and
- **fatal** — validation must halt immediately because retry or Agent repair is not permitted or cannot help.

The recovery class selects the response. It does not change the meaning of CI failure, Objective-Failing Check failure,
Semantic Code Review feedback, or merge conflict. RunWield records a validation-failure lifecycle event only when it has
evidence that the implementation failed. The existing `ValidationRecoveryResult` remains the public result contract; the
new classifier and recovery runner supply its stable code, action, and next phase.

## Approach

### Transient

For a rate limit, provider timeout, temporary network failure, service-unavailable response, or Git target-reference
race, RunWield retries the same idempotent operation.

The delay uses bounded exponential backoff with full jitter:

`delay = random value from 0 through min(maxDelay, baseDelay * 2^retryIndex)`

RunWield uses a valid provider `Retry-After` value when one is present and within the configured maximum. The existing
`retry.enabled`, `retry.maxRetries`, `retry.baseDelayMs`, and `retry.provider.maxRetryDelayMs` settings define the
validation-level budget. Provider SDK retries remain provider-level behavior. Neither provider retries nor validation
operational retries change `validationCiAttempts`, `validationObjectiveCheckAttempts`, `validationSemanticRounds`, or
any implementation-repair budget.

The status surface shows the operation, retry number, maximum retries, and next delay. Escape or Session cancellation
stops the wait and returns the existing safe paused result.

When the transient retry budget is spent, RunWield pauses at the same validation phase. It preserves the Plan Status,
Review Issue Ledger, worktree record, publication journal, and active workflow. It does not record a validation failure.

### Correctable

For invalid tool arguments, a missing `review_complete` result, a Reviewer decision made without reading the diff, or an
incomplete finding set, RunWield sends a structured correction to the same Agent session.

There is no backoff. The correction names the rejected operation, stable error code, invalid field or missing result,
and the required correction. The Agent keeps its current context and can issue a corrected call. RunWield does not start
a new semantic round and does not dispatch the implementation Engineer.

Correctable attempts have a separate small protocol-correction limit. When that limit is spent, RunWield pauses at the
same phase with the current review ledger. It does not reset the Plan to Implemented.

### Missing information

RunWield does not repeat an operation that requires information that is still absent.

- If the Agent selected a missing optional entity, RunWield gives the structured missing-entity result to that Agent.
  The Agent must continue without that entity or select an available alternative.
- If a RunWield-owned Plan, worktree registry entry, repair checkout, or publication record is missing, RunWield uses
  the existing deterministic recovery operation when one can prove the correct state.
- If deterministic recovery cannot prove the correct state, RunWield pauses once with the missing item and a concrete
  user action. It does not dispatch an Agent to edit Plan Front Matter or worktree records.

An unknown Plan status is not an Agent replanning case. It is a RunWield invariant failure and follows the fatal path.

### Fatal

For a policy violation, prohibited operation, invalid lifecycle invariant, or access failure that makes the operation
unavailable, RunWield stops the validation run immediately.

It does not retry. It does not dispatch an Engineer. It does not record `mechanical_validation_failed`,
`semantic_review_feedback`, or `validation_failed`. It keeps the last valid Plan Lifecycle checkpoint and emits one
terminal error with the operation, stable code, and required user action when an action exists.

Authentication failure is normally a user-action pause, not a transient failure and not a policy violation. The error
classifier gives it a stable missing-information or fatal code according to whether the user can restore access.

## Architecture

### Typed error contract

Add named TypeScript types in `validation-operational-errors.ts`. Do not use `any`, `unknown`, `object`, or complex
inline types. The central contract includes:

- `ValidationRecoveryClass`;
- `ValidationOperation`;
- `ValidationOperationalFailure` with `code`, `message`, `operation`, `recoveryClass`, and optional bounded retry or
  correction metadata;
- named source types discriminated by `source` and `kind` for provider, local-process, validation-state, worktree,
  Git-publication, Reviewer-protocol, and policy errors; the stable baseline pairs include `provider/rate_limited`,
  `reviewer_protocol/missing_review_complete`, `validation_state/plan_missing`, and `policy/prohibited`;
- `classifyValidationOperationalError`, which accepts the named source union and returns a classified failure; and
- an exhaustive `never` check so a newly added typed source kind cannot silently inherit a default retry policy.

Prefer stable error codes and typed error classes from the source boundary. Use normalized string matching only in an
adapter for a legacy provider that supplies no typed status. The classifier must not inspect arbitrary thrown values
through repeated property casts.

Change validation port results from ambiguous success shapes with optional error strings to discriminated outcomes. For
example, Local CI returns one of completed, canceled, or operational failure. Isolated Agent execution returns its
role-specific success result or an operational failure. Publication normalizes its typed Git and lifecycle failures
before the recovery policy runs.

### Recovery decision

Extend the existing `validation-recovery.ts` module as the only owner of the class-to-action mapping. Preserve its
`ValidationRecoveryResult` contract for supervisor and runtime callers. It owns:

- retry eligibility and the total operation-attempt budget;
- pure backoff and full-jitter calculation;
- bounded `Retry-After` handling;
- cancellation-aware waiting;
- protocol-correction attempt limits; and
- the final pause or halt result when recovery cannot continue.

The production implementation uses the platform timer and cryptographic random bytes directly. Keep the delay
calculation pure so tests can verify exact bounds without a timer or random-number injection seam. Tests use zero-delay
classified failures when they need to exercise the full retry loop. Do not add an optional dependency bag, clock
override, random override, or fallback capability.

The recovery runner records operational metrics separately from validation verdict metrics. Each record includes the
operation, error code, recovery class, attempt, selected action, and delay. It must not include secrets, full provider
responses, or unbounded command output.

### Mechanical Validation boundary

`validation-local-ci.ts` must preserve the difference between these outcomes:

- the command ran and returned a nonzero exit code;
- the command timed out or was canceled after it started;
- RunWield could not find or obtain a validation command; and
- RunWield could not start or supervise the process.

Only the first outcome is direct evidence of an implementation validation failure. A configured command that runs and
times out remains a mechanical verdict because the implementation or its test command did not finish. User cancellation
remains a safe pause. Missing command information and process-start failures follow their classified operational policy.

Mechanical operational retries do not call `dispatchCiRepair`, increment the CI repair counter, or record a failed Plan
lifecycle event.

### Semantic Review boundary

Replace the current unconditional Reviewer nudge loop with recovery decisions:

- provider rate limits, timeouts, and temporary service failures use backoff and retry;
- invalid Reviewer protocol output receives a structured correction in the same in-memory Reviewer session;
- missing optional review input returns to the Reviewer with an instruction to continue without it or choose a valid
  alternative;
- missing RunWield-owned diff, Plan, or worktree state pauses for deterministic recovery; and
- policy violations halt immediately.

The existing diff-inspection and open-finding checks become named correctable protocol errors. Preserve the current
Review Issue Ledger and same-session correction behavior. A completed Reviewer verdict still consumes exactly one
semantic round. A semantic feedback verdict still dispatches repair and follows the current Plan Lifecycle.

### Publication boundary

Use typed publication failure kinds before selecting repair:

- target-reference compare-and-swap loss is transient and retries against the new target head;
- content conflict is implementation state and can dispatch bounded merge repair;
- primary-checkout dirt requires the existing user decision;
- a missing worktree or repair checkout uses deterministic recovery or one missing-information pause;
- permission and policy failures halt; and
- a failure after the target ref moved still uses the existing proof that publication already succeeded.

Only a proven content conflict can call `dispatchMergeRepair`. Operational retries do not change the immutable execution
candidate or clear recovery metadata.

### Lifecycle and resume behavior

Do not add a new Plan status. The validation supervisor keeps ownership through its durable Validation Checkpoint, and
the last committed Plan Status remains the phase authority:

- `implemented` resumes Mechanical Validation;
- `validated_ci` resumes Semantic Code Review; and
- `validated_reviewer` resumes human review or publication as required.

An operational pause preserves active workflow and the durable Validation Checkpoint phase. A fatal halt records a
bounded runtime/metric event, but it does not write a false validation-failure lifecycle event. On a later explicit user
action, validation rereads the canonical Plan and execution context before it continues.

## Files to Modify

- `src/shared/workflow/validation-operational-errors.ts` — define the four classes, named source types, stable codes,
  sanitization limits, and the pure central classifier.
- `src/shared/workflow/validation-recovery.ts` — extend the current public recovery result with class-to-action
  decisions, retry budgets, jitter calculation, `Retry-After` bounds, cancellation-aware delay, correction limits, and
  operational metrics.
- `src/shared/workflow/validation-ports.ts` and `validation-types.ts` — replace optional error strings and ambiguous CI
  results with discriminated typed outcomes; keep operational attempt counts separate from repair rounds.
- `src/shared/workflow/validation-session-adapter.ts` — normalize Pi and Claude execution failures at the session
  boundary, preserve typed backend codes, sanitize legacy error text, and return operational failures to the engine.
- `src/shared/workflow/validation-local-ci.ts` — distinguish command verdict, cancellation, missing command, process
  timeout, and process-start/supervision errors.
- `src/shared/workflow/validation-mechanical.ts` — run operational recovery before any repair counter or lifecycle
  mutation. Dispatch implementation repair only for an actual failed command or unmet objective check.
- `src/shared/workflow/validation-semantic.ts` — replace blind Reviewer retries with transient recovery and typed
  same-session corrections. Keep one semantic round for one completed verdict.
- `src/shared/workflow/validation-engine.ts` — classify invalid or missing canonical validation state and return a
  phase-preserving pause or fatal halt without retry loops.
- `src/shared/workflow/validation-supervisor.ts` — preserve self-healing and durable Validation Checkpoint ownership,
  settle classified pauses and halts, and keep its outer catch as a fail-closed fallback rather than the main policy.
- `src/shared/workflow/validation-publication.ts` and `validation-merge-repair.ts` — normalize publication failures and
  limit Agent repair to proven content conflicts. Replace touched loose error parameters and property casts with named
  typed publication errors.
- `src/shared/workflow/validation-emit.ts` and `validation-user-messages.ts` — display bounded operational retry, pause,
  and halt information without presenting an operational failure as a failed validation check.
- Focused and self-healing integration tests — prove every recovery class, counter separation, cancellation, retry
  exhaustion, same-session correction, missing-state behavior, lifecycle preservation, and publication routing.
- `docs/settings.md` — clarify that the existing retry settings also bound validation operational retries and do not
  count as implementation repair rounds.
- `docs/plan-lifecycle.md` — document that operational recovery does not advance or reset Plan Lifecycle status.

## Reuse Opportunities

- Existing `retry.*` settings and Pi retry status events — use the current user configuration and status vocabulary. Do
  not create a second unrelated settings family.
- `ClaudeCliBackendError` and its stable kinds — preserve typed backend failures instead of flattening them into text.
- `ValidationSessionPort.emitStatus`, progress records, and validation metrics — report retries and terminal actions
  without importing Session internals into the validation engine.
- The current same-session Reviewer manager — use it for correctable protocol feedback.
- Existing Plan/worktree recovery, `continueWorkflowValidation`, Validation Checkpoints, and publication proof — repair
  provable RunWield-owned state before classification, preserve one validation owner, and detect publication that
  completed before bookkeeping failed.
- Existing `ValidationRecoveryResult`, `retryValidationLater`, plain validation message builders, and cancellation
  controllers — preserve caller compatibility and stop waits and active operations through the same Session cancellation
  path.

## Implementation Steps

- [ ] `validation-operational-errors.ts` exports named source failures, stable codes, the four recovery classes, and one
      exhaustive classifier. Its table tests cover typed provider status, bounded `Retry-After`, Reviewer protocol
      errors, missing Plan/worktree state, Git conflict/race/dirt, authentication, permission, policy, and unknown
      legacy text; unknown untyped failures do not retry automatically.
- [ ] Local CI and isolated Agent ports return discriminated completed, canceled, and operational-failure outcomes. All
      production composition and fixtures use the new contract, with no optional compatibility path and no flattened
      `executionError` or synthetic exit-code fallback.
- [ ] The existing `validation-recovery.ts` maps each class to one typed `ValidationRecoveryResult`, calculates capped
      exponential full jitter, honors only valid bounded `Retry-After`, stops waits on cancellation, enforces separate
      retry and protocol-correction budgets, and never reads or changes implementation-repair counters.
- [ ] Semantic Reviewer provider failures use transient recovery, while missing `review_complete`, unread diffs, and
      unaccounted findings produce structured same-session corrections. Only one completed verdict consumes one semantic
      round, and existing Review Issue Ledger coverage remains.
- [ ] A Local CI command that runs and exits nonzero remains a mechanical verdict. Missing commands, process-start or
      supervision failures, and cancellation enter operational recovery before failure reasons, repair counters, Plan
      Events, or Engineer dispatch; a started command timeout remains a mechanical verdict.
- [ ] Publication distinguishes target-reference races, proven content conflicts, primary-checkout dirt, missing
      recovery state, access or policy failures, and post-publication bookkeeping failures. Only a proven content
      conflict reaches `dispatchMergeRepair`, and prior-success proof prevents a duplicate target-ref update.
- [ ] The validation engine and supervisor classify canonical Plan and execution-context failures after deterministic
      self-healing runs. They settle phase-preserving pauses or fatal halts through the current Validation Checkpoint
      and preserve the outer catch only as a bounded fail-closed fallback.
- [ ] Validation status output and metrics name the operation, bounded code, recovery class, attempt, action, and delay
      without secrets or raw provider bodies. Operational stops do not mark CI, Semantic Code Review, Local Human Code
      Review, or publication as an implementation failure.
- [ ] `docs/settings.md` states that existing retry settings bound Workflow Validation operational retries, and
      `docs/plan-lifecycle.md` states that these retries, pauses, and halts do not advance or reset Plan Status or spend
      implementation-repair counters.
- [ ] Focused tests, the self-healing integration suite, zero-seam check, type check, and full CI all pass while
      preserving existing CI repair, Objective-Failing Check repair, semantic convergence, durable checkpoint resume,
      human review, and publication recovery behavior.

## Approval Confirmation

This Plan does not supersede a prior Work Record. The completed validation-engine, authority, and self-healing records
remain valid foundations that this change extends.

## Verification Plan

- Automated:
  - `deno run -A scripts/run-tests.js src/shared/workflow/validation-operational-errors.test.ts`
  - `deno run -A scripts/run-tests.js src/shared/workflow/validation-operational-recovery.test.ts`
  - `deno run -A scripts/run-tests.js src/shared/workflow/validation-local-ci.test.ts`
  - `deno run -A scripts/run-tests.js src/shared/workflow/validation-loop-review.test.js`
  - `deno run -A scripts/run-tests.js src/shared/workflow/validation-loop-repair.test.js`
  - `deno run -A scripts/run-tests.js src/shared/workflow/validation-publication.test.ts`
  - `deno run -A scripts/run-tests.js src/shared/workflow/validation-lifecycle-resume.test.js`
  - `deno task seams:check`
  - `deno task check`
  - `deno task ci`
- Manual: not required; the focused tests exercise the composed supervisor, real Plan and Git fixtures, and typed
  external boundaries.
- Required behavior:
  - A transient Reviewer timeout retries with a bounded jittered delay and does not increment the semantic round.
  - Invalid Reviewer output receives structured feedback in the same session and does not sleep.
  - A missing optional entity is attempted once; the Agent receives the missing-entity result and selects another path.
  - A policy violation stops the current validation call and dispatches no further Agent or external operation.
  - A CI command exit code increments the implementation-repair count; a CI process-start error does not.
  - A target-reference race retries publication; only a content conflict dispatches merge repair.
  - A spent operational budget leaves the Plan at its last valid status and can resume from that phase later.
- Mutation checks:
  - Force all errors to transient and prove fatal, missing-information, and correctable tests fail.
  - Count a transient retry as a repair round and prove counter-separation tests fail.
  - Convert a CI process-start failure to exit code `1` and prove the no-repair regression fails.
  - Dispatch merge repair for a non-conflict publication error and prove the publication routing test fails.
  - Remove jitter or the retry cap and prove the delay-policy tests fail.

## Edge Cases and Constraints

- Retry only operations that are idempotent or have an existing proof that detects prior success. Never blindly retry a
  lifecycle write, target-ref update, worktree cleanup, or other operation that can have completed before it failed.
- A timeout classification depends on the boundary. A provider request timeout is transient. A validation command that
  started and exceeded its allowed runtime is a mechanical verdict unless cancellation caused it.
- `Retry-After` input can be invalid, negative, too large, or a date. Normalize it once and enforce the configured cap.
- A user cancellation is not an error class. It remains a safe pause and stops an active backoff wait.
- Authentication can be restored by the user, but immediate retry cannot restore it. Do not classify authentication as
  transient.
- Unknown legacy error text must not default to transient. Fail closed with a bounded pause or fatal result.
- Do not expose provider response bodies, environment values, command secrets, tokens, or full stderr in metrics or Plan
  metadata.
- Do not add Plan Front Matter fields for operational attempt counts. Attempts are run-local. The canonical Plan status
  is the durable resume checkpoint.
- Do not add an Agent seam for Plan, lifecycle, registry, lock, or publication state. Test these paths with real Plan
  and Git fixtures. Agent execution, local CI, network, timer, and provider behavior remain genuine external boundaries.
- Do not weaken lifecycle compare-and-set checks. Do not ask an Agent to repair RunWield-owned state.
- New TypeScript must not use `any`, `unknown`, `object`, or complex inline types. Migrate touched loose publication
  error signatures to named types as part of this change.
