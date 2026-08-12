---
planId: "482d1525-3be2-417e-bd9c-9b59bda1d71b"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
summary: "Classify Workflow Validation operational errors and apply retry, Agent correction, replanning, or immediate halt without treating infrastructure failures as implementation failures."
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
    - "src/shared/workflow/validation-publication.ts"
    - "src/shared/workflow/validation-merge-repair.ts"
    - "src/shared/workflow/validation-emit.ts"
    - "src/shared/workflow/validation-operational-errors.test.ts"
    - "src/shared/workflow/validation-operational-recovery.test.ts"
    - "src/shared/workflow/validation-local-ci.test.ts"
    - "src/shared/workflow/validation-publication.test.ts"
    - "docs/settings.md"
    - "docs/plan-lifecycle.md"
objectiveChecks:
    - id: "OC1"
      command: "grep -q 'validation error classifier maps typed failures to the four recovery classes' src/shared/workflow/validation-operational-errors.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/validation-operational-errors.test.ts --filter 'validation error classifier maps typed failures to the four recovery classes'"
      rationale: "This proves that transient, correctable, missing-information, and fatal errors have one stable typed classification before any phase chooses a response."
    - id: "OC2"
      command: "grep -q 'transient Reviewer failures use jittered backoff without consuming semantic rounds' src/shared/workflow/validation-operational-recovery.test.ts && grep -q 'correctable Reviewer failures stay in the same session with structured feedback' src/shared/workflow/validation-operational-recovery.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/validation-operational-recovery.test.ts --filter 'Reviewer failures'"
      rationale: "This proves that retry and Agent correction are different actions, and that neither action spends an implementation-repair round."
    - id: "OC3"
      command: "grep -q 'CI process start failure does not dispatch implementation repair' src/shared/workflow/validation-local-ci.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/validation-local-ci.test.ts --filter 'CI process start failure does not dispatch implementation repair'"
      rationale: "The current CI boundary converts process-start errors into exit code 1. This check proves that an operational failure can no longer become a false test failure."
    - id: "OC4"
      command: "grep -q 'publication dispatches merge repair only for a content conflict' src/shared/workflow/validation-publication.test.ts && grep -q 'fatal publication error halts without retry or repair' src/shared/workflow/validation-publication.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/validation-publication.test.ts --filter 'publication'"
      rationale: "This proves that publication races, missing state, user-owned dirt, content conflicts, and fatal access or policy failures no longer share one blind repair path."
    - id: "OC5"
      command: "deno task seams:check && deno task check && deno task ci"
      rationale: "This protects the zero-seam baseline, TypeScript rules, Plan Lifecycle invariants, validation behavior, and the full repository."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-12T00:47:42-04:00"
updatedAt: "2026-08-12T00:47:42-04:00"
status: "draft"
origin: "internal"
userVerifiedAt: null
routingIntent: "PLANNED_CHANGE"
sessionName: "validation error recovery"
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

`AUTOMATIC_ROUNDS` is an implementation-repair limit. It must count failed CI or review repair cycles. It must not count
network retries, provider rate limits, invalid Agent tool arguments, or missing resources.

## Objective

Add one typed operational-error model to Workflow Validation. Each operational failure has one of four recovery classes:

- **transient** — the same idempotent operation can succeed later;
- **correctable** — the current Agent can correct its request or result from structured feedback;
- **missing_information** — the same operation cannot succeed until it uses a different resource or RunWield restores
  missing state; and
- **fatal** — validation must halt immediately because retry or Agent repair is not permitted or cannot help.

The recovery class selects the response. It does not change the meaning of CI failure, Objective-Failing Check failure,
Semantic Code Review feedback, or merge conflict. RunWield records a validation-failure lifecycle event only when it has
evidence that the implementation failed.

## Product Behavior

### Transient

For a rate limit, provider timeout, temporary network failure, service-unavailable response, or Git target-reference
race, RunWield retries the same idempotent operation.

The delay uses bounded exponential backoff with full jitter:

`delay = random value from 0 through min(maxDelay, baseDelay * 2^retryIndex)`

RunWield uses a valid provider `Retry-After` value when one is present and within the configured maximum. The existing
`retry.enabled`, `retry.maxRetries`, `retry.baseDelayMs`, and `retry.provider.maxRetryDelayMs` settings define the
validation-level budget. Provider SDK retries remain provider-level behavior. Neither provider retries nor validation
operational retries change `validationCiAttempts`, `validationSemanticRounds`, or `AUTOMATIC_ROUNDS`.

The status surface shows the operation, retry number, maximum retries, and next delay. Escape or Session cancellation
stops the wait and returns the existing safe paused result.

When the transient retry budget is spent, RunWield pauses at the same validation phase. It preserves the Plan status,
review ledger, worktree record, publication journal, and active workflow. It does not record a validation failure.

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
- named source types for provider, local-process, Plan-state, worktree, Git-publication, and Reviewer-protocol errors;
  and
- `classifyValidationOperationalError`, which accepts the named source union and returns a classified failure.

Prefer stable error codes and typed error classes from the source boundary. Use normalized string matching only in an
adapter for a legacy provider that supplies no typed status. The classifier must not inspect arbitrary thrown values
through repeated property casts.

Change validation port results from ambiguous success shapes with optional error strings to discriminated outcomes. For
example, Local CI returns one of completed, canceled, or operational failure. Isolated Agent execution returns its
role-specific success result or an operational failure. Publication normalizes its typed Git and lifecycle failures
before the recovery policy runs.

### Recovery decision

Add `validation-recovery.ts` as the only owner of the class-to-action mapping. It owns:

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

Do not add a new Plan status. The last committed status remains the restart checkpoint:

- `implemented` resumes Mechanical Validation;
- `validated_ci` resumes Semantic Code Review; and
- `validated_reviewer` resumes human review or publication as required.

An operational pause preserves active workflow and phase position. A fatal halt records a bounded runtime/metric event,
but it does not write a false validation-failure lifecycle event. On a later explicit user action, validation rereads
the canonical Plan and execution context before it continues.

## Files to Modify

- `src/shared/workflow/validation-operational-errors.ts` — define the four classes, named source types, stable codes,
  sanitization limits, and the pure central classifier.
- `src/shared/workflow/validation-recovery.ts` — own class-to-action decisions, retry budgets, jitter calculation,
  `Retry-After` bounds, cancellation-aware delay, correction limits, status output, and operational metrics.
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
- `src/shared/workflow/validation-publication.ts` and `validation-merge-repair.ts` — normalize publication failures and
  limit Agent repair to proven content conflicts. Replace touched loose error parameters and property casts with named
  typed publication errors.
- `src/shared/workflow/validation-emit.ts` — display bounded operational retry, pause, and halt information without
  presenting an operational failure as a failed validation check.
- Focused tests — prove every recovery class, counter separation, cancellation, retry exhaustion, same-session
  correction, missing-state behavior, lifecycle preservation, and publication routing.
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
- Existing Plan/worktree recovery and publication proof — restore RunWield-owned state mechanically and detect a
  publication that completed before bookkeeping failed.
- Existing cancellation controllers — cancel waits and active operations through the same Session cancellation path.

## Implementation Steps

- [ ] Add failing table tests for all four error classes. Cover typed provider codes, HTTP status, bounded
      `Retry-After`, Reviewer protocol errors, missing Plan/worktree state, Git conflict/race/dirt, authentication,
      permission, policy, and unknown legacy text. Unknown untyped errors must fail closed without automatic retry.
- [ ] Add the named operational-error types and classifier. Keep string normalization at legacy adapters and keep
      persisted/displayed messages bounded and free of credentials.
- [ ] Change Local CI and isolated Agent port contracts to discriminated outcomes. Update all production composition and
      fixtures without an optional compatibility path.
- [ ] Add the recovery decision module. Prove exponential growth, full-jitter bounds, delay cap, valid `Retry-After`
      precedence, cancellation, maximum attempts, and no use of repair counters.
- [ ] Route Semantic Reviewer execution through the policy. Convert no `review_complete`, unread diff, and unaccounted
      findings into structured correctable results that remain in the same Reviewer session.
- [ ] Route Local CI operational failures through the policy before `getCiFailureReason`, attempt increments, Plan
      lifecycle events, or Engineer dispatch.
- [ ] Type publication failures and route compare-and-swap races, content conflicts, dirty checkout, missing recovery
      state, access failures, and post-publication bookkeeping failures to their distinct actions.
- [ ] Classify canonical Plan and execution-context failures. Use deterministic RunWield recovery where proof exists;
      otherwise pause or halt once with a concrete action.
- [ ] Emit separate operational retry and recovery metrics. Confirm that progress UI does not mark CI, semantic review,
      human review, or merge as failed before a real verdict exists.
- [ ] Update settings and lifecycle documentation with the new meanings and counter separation.
- [ ] Run focused tests, `deno task seams:check`, `deno task check`, and `deno task ci`.

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
