---
planId: "31fb2d25-893f-4b3e-9a4e-93625cd468b0"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Finish the Epic with strictly content-free Frontend Engineer and Pair metrics, behavior-preserving active Plan migration, persistent Pair-loop Skill guidance, and documentation of the settled recommendation-driven workflow."
affectedPaths:
    - "src/shared/workflow/metrics.js"
    - "src/shared/workflow/metrics.test.js"
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/shared/workflow/pair-execution.test.js"
    - "src/shared/workflow/validation.js"
    - "src/shared/workflow/validation.test.js"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/hosted-session.test.js"
    - "src/shared/session/agent-handler.test.js"
    - "src/tools/pair-checkpoint.js"
    - "src/tools/__tests__/pair-checkpoint.test.js"
    - "src/tools/task-completed.js"
    - "src/tools/__tests__/task-completed.test.js"
    - "src/agent-definitions/frontend-engineer.md"
    - "src/skills/frontend-framework/SKILL.md"
    - "src/skills/agent-browser/SKILL.md"
    - "plans/"
    - "docs/prd/frontend-engineer-pair-execution-prd.md"
    - "docs/workflows.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-18T11:02:23-04:00"
updatedAt: "2026-07-24T03:58:41.281Z"
status: "verified"
origin: "internal"
parentPlan: "frontend-engineer-pair-execution"
order: 4
dependencies:
    - "03-tui-pair-host-and-autonomous-host-boundaries"
implementedAt: "2026-07-23T22:05:38.735Z"
worktreeStatus: "completed"
verifiedAt: "2026-07-24T03:58:41.281Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
---

# Metrics, Active Plan Migration, Skills, and Docs

## Context

Plans 01–03 established **Frontend Engineer** ownership, workflow-scoped **Pair Execution**, and the local TUI as the
first Pair-capable host. The settled workflow is recommendation-driven: a canonical Frontend Engineer FEATURE Plan with
`collaborationRecommendation: pair` enters Pair Execution when the currently attached host explicitly supports Pair
checkpoints; otherwise it runs autonomously. Approve & Run does not ask a second style question, and Plan Recovery
derives a fresh runtime style from the current Plan and host instead of persisting or restoring `collaborationMode`.

The remaining Epic work is consistency and observability. Generic workflow-metric sanitization is denylist-based and is
not a sufficient privacy boundary for checkpoint text or browser evidence. Pair decisions are not instrumented at their
normalized tool seam, Task Completion does not have a structured browser-preflight outcome, and its production metric
call omits the required Project cwd. Validation also clears the active execution context before repair, so repair-phase
completion cannot currently retain Pair facts or execution-attempt timing. The bundled frontend/browser Skills still
refer to `frontend: true`, project-local browser-tool installation, or one-shot browser cleanup. Active nonterminal
Plans retain the retired `frontend` field, while the PRD, parent Epic, and workflow guide describe older runtime-choice,
`AFK`, and durable-mode behavior.

## Objective

Finish the Epic without changing Plan Lifecycle or approved execution behavior:

- record opt-in Frontend Engineer and Pair effectiveness metrics as closed enum/boolean/numeric facts only;
- preserve current behavior while removing `frontend` from the reviewed active, non-archived, nonterminal Plans;
- align the bundled frontend/browser Skills with persistent dev-server and named headed-browser loops;
- update the PRD, active parent Epic, and workflow documentation to the recommendation-driven TUI Pair contract; and
- keep Pair checkpoints, browser evidence, Task Completion, and Workflow Validation as distinct boundaries.

## Approach

Add three dedicated metric events at the seams that already own normalized facts. Apply an event-specific closed schema
inside `recordWorkflowMetric()` before the existing generic sanitizer. Dedicated events retain normal `v`, `ts`,
`category`, `event`, and hashed Project identity, but always strip top-level `sessionId`, `planName`, and `agentName`,
all unknown detail keys, every free-form string, arrays, and nested objects. Invalid enum or numeric fields are omitted
rather than serialized.

| Event                             | Emission seam                                                                                                      | Allowed details                                                                                                                                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend_runtime_style_resolved` | `executePlan()` after policy/status validation and host-capability resolution, only for Frontend Engineer policies | `policySource: canonical \| legacy_frontend`; `recommendation: autonomous \| pair`; `runtimeStyle: autonomous \| pair`; `pairCapable: boolean`; `resolutionReason: canonical_pair_capable \| canonical_pair_unavailable \| canonical_autonomous \| legacy_autonomous`                                         |
| `pair_checkpoint_decided`         | `pair_checkpoint` once after each authorized attempt is normalized                                                 | `checkpointNumber` as a positive safe integer; `decision: continue \| revise \| switch_to_autonomous \| stop \| canceled`; optional `reason: checkpoint_interaction_canceled \| revision_feedback_required \| pair_capability_lost \| invalid_checkpoint_response`                                            |
| `frontend_execution_completed`    | accepted Frontend Engineer `task_completed` calls in an active implementation or validation-repair context         | `phase: implementation \| validation_repair`; `runtimeStyle: autonomous \| pair`; `checkpointCount` as a non-negative safe integer; `switchedToAutonomous`, `capabilityLost` booleans; `browserPreflightOutcome: succeeded \| failed \| externally_blocked`; optional non-negative finite integer `elapsedMs` |

Never pass checkpoint parameters, revision feedback, route/URL, screenshot or evidence paths, diagnostics, browser
payloads, source content, Plan or Session identity, or the Task Completion report to these events. The generic sanitizer
remains defense in depth for other workflow metrics.

Add `executionAttemptStartedAtMs` as ephemeral active execution state. Set it from an injectable clock only after the
`execution_started` Plan Event succeeds, preserve it across same-runtime Pair stop/resume and validation repair, and
start a new clock after runtime-loss recovery or another genuine execution start. Before each synchronous validation
repair, temporarily restore the captured active execution snapshot with `validationContinuation: true`; clear it again
when Task Completion is observed, but retain it when repair pauses so the existing Agent Handler continuation path can
resume validation. This supplies owner, phase, Pair facts, and timing to Task Completion without adding a Plan field or
another lifecycle transition.

Frontend Engineer's `task_completed` schema requires a content-free `browserPreflightOutcome` enum (`succeeded`,
`failed`, or `externally_blocked`) while its Markdown report continues to carry final browser-verification evidence.
Engineer and Operator schemas remain unchanged. Pair acceptance never counts as browser evidence or validation.

Migrate only the reviewed legacy inventory and preserve each Plan's pre-migration effective policy. Legacy FEATURE
`frontend: true` becomes canonical Frontend Engineer/autonomous; `frontend: false` is removed without adding policy,
preserving the Engineer/autonomous compatibility default. PROJECT Epics lose `frontend` but never gain execution policy.
Canonical policy already present wins and remains unchanged. Do not infer Pair during migration, change
lifecycle/worktree/collaboration fields, or rewrite verified/archived history.

## Files to Modify

- `src/shared/workflow/metrics.js` — add the exact event-specific allowlists and top-level identifier stripping while
  retaining opt-in, local-only, best-effort JSONL behavior and generic sanitization for other events.
- `src/shared/workflow/metrics.test.js` — prove dedicated events retain only approved fields and cannot retain
  checkpoint text, feedback, routes/URLs, evidence, diagnostics, paths, browser payloads, source, reports, Plan names,
  Session IDs, Agent names, unknown fields, invalid enums, or invalid numbers.
- `src/shared/workflow/workflow.js` — emit content-free runtime-style resolution facts, pass the recorder into the
  workflow-scoped Pair tool, and set the execution-attempt clock only after execution starts.
- `src/shared/workflow/workflow.test.js` — cover canonical Pair, canonical autonomous, legacy autonomous, and
  incapable-host metrics plus fresh-attempt timing without a style prompt or pre-execution lifecycle mutation.
- `src/shared/workflow/pair-execution.test.js` — verify same-runtime Pair stop/resume preserves attempt timing and
  remains outside Workflow Validation.
- `src/shared/workflow/validation.js` — expose the captured active execution snapshot only around Frontend Engineer
  validation-repair turns so Task Completion sees `validationContinuation` and existing timing/Pair facts; clear it when
  repair completes and retain it when continuation is required.
- `src/shared/workflow/validation.test.js` — cover immediate and paused/resumed Frontend Engineer repair completion,
  phase labeling, timestamp preservation, and absence of duplicate lifecycle transitions.
- `src/shared/session/hosted-session.js` — type and validate the optional ephemeral execution-attempt timestamp while
  keeping it out of Plan Front Matter and durable recovery authority.
- `src/shared/session/hosted-session.test.js` — cover valid timestamp state, invalid values, and preservation through
  ordinary active-workflow updates.
- `src/shared/session/agent-handler.test.js` — prove deliberate Pair resume and validation continuation retain the
  execution-attempt timestamp and do not re-record implementation completion.
- `src/tools/pair-checkpoint.js` — accept an injectable metric recorder, pass `hostedSession.cwd`, and record one
  content-free decision event for each authorized checkpoint attempt after normalization.
- `src/tools/__tests__/pair-checkpoint.test.js` — assert every decision/reason/count mapping, cwd forwarding,
  exactly-once emission, and exclusion of user feedback and all checkpoint evidence fields.
- `src/tools/task-completed.js` — give Frontend Engineer a required structured preflight outcome, pass
  `hostedSession.cwd` to production metrics, and emit content-free completion facts without reading or parsing the
  Markdown report.
- `src/tools/__tests__/task-completed.test.js` — cover owner-specific schema, all preflight values, implementation
  versus validation-repair completion, elapsed time, Pair facts, cwd forwarding, rejection paths, and report exclusion.
- `src/agent-definitions/frontend-engineer.md` — align Task Completion instructions with the structured preflight
  outcome and explicitly keep final headed-browser evidence separate from Pair acceptance.
- `src/skills/frontend-framework/SKILL.md` — replace `frontend: true` guidance with Frontend Engineer ownership/runtime
  context, preserve convention/design-system discovery, and describe HMR-aware Pair versus autonomous loops without
  introducing a test framework.
- `src/skills/agent-browser/SKILL.md` — require a stable assignment-specific named headed session, worktree-safe
  reconnect/restart behavior, checkpoint evidence discipline, manifest/lockfile safety, and best-effort cleanup only at
  terminal workflow completion.
- `plans/` — perform the narrow reviewed active Plan migration, update stale current-contract language in the active
  parent Epic, and leave verified/archived Plans and unrelated Plan content unchanged.
- `docs/prd/frontend-engineer-pair-execution-prd.md` — mark the delivered contract current and replace startup choice,
  deferred Front Matter, persisted-style, `AFK`, and user-selection metric language with the canonical
  recommendation-driven host policy.
- `docs/workflows.md` — document ownership, Review Loop recommendation choice, TUI Pair activation, ACP/Headless Mode
  fallback, runtime-loss derivation, legacy interpretation, migration behavior, and checkpoint/Task Completion/Workflow
  Validation separation.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/workflow/metrics.js#recordWorkflowMetric` — retain its settings gate, cwd hash, home-scoped JSONL append,
  and non-fatal write behavior; add a strict event-specific privacy layer rather than a second telemetry channel.
- `src/shared/workflow/workflow.js#selectRuntimeCollaborationStyle` — instrument the settled policy/host derivation
  instead of adding an interaction or parallel host enum.
- `src/shared/workflow/workflow.js#startActiveExecutionWorkflow` — keep the existing successful `execution_started`
  boundary as the only place that starts the ephemeral attempt clock.
- `src/shared/workflow/validation.js#runCompletionGatedRepair` and `pauseForExecutionContinuation` — wrap the existing
  owner-preserving repair path with transient execution context rather than adding a separate repair workflow.
- `src/plan-store.js#resolvePlanExecutionPolicy` — compare effective policy before and after migration for canonical,
  legacy true, legacy false, and PROJECT cases.
- `src/shared/collaboration/lock.js#assertSharedPlanWriteAllowed` — honor the current remote-canonical collaboration
  write lock before any direct Plan rewrite; never use a collaboration bypass for migration.
- `src/tools/pair-checkpoint.js#createPairCheckpointTool` — record decisions only after existing normalization and state
  transition, never from raw interaction data.
- `src/tools/task-completed.js#createTaskCompletedTool` — extend the existing owner-aware completion schema rather than
  adding a browser-reporting tool or parsing free-form completion text.
- `src/skills/frontend-framework/SKILL.md` and `src/skills/agent-browser/SKILL.md` — preserve their convention-first and
  real-browser techniques while making persistence and Pair boundaries explicit.

## Implementation Steps

- [ ] Implement the exact three-event allowlist above before generic sanitization. For dedicated events, strip top-level
      Plan/Session/Agent identity, omit unknown or invalid detail fields, and keep only the listed enums, booleans, and
      validated numeric counters/duration.
- [ ] Add adversarial metric tests containing revision text, summaries, routes, credential-bearing URLs, screenshots,
      evidence, diagnostics, source, browser payloads, report text, nested objects, arrays, and secret-bearing paths.
- [ ] Instrument Frontend Engineer runtime-style derivation after execution policy/status and host capability checks.
      Emit canonical or legacy source, recommendation, derived style, explicit Pair capability, and the exact bounded
      resolution reason; never describe it as a post-approval user selection.
- [ ] Add injectable `now()` seams to execution startup and Task Completion. Set `executionAttemptStartedAtMs` only
      after the `execution_started` Plan Event resolves; use a new timestamp after runtime-loss recovery or another
      execution start, and preserve the existing value during same-runtime continuation.
- [ ] Inject the recorder into `createPairCheckpointTool`, always call it with `{ cwd: hostedSession.cwd }`, and emit
      exactly one decision event after every authorized attempt. Inactive or previously paused calls do not increment or
      emit; interaction cancellation and missing revision feedback normalize to `canceled`, while capability loss and an
      invalid response normalize to `switch_to_autonomous` with the listed reason.
- [ ] Extend Frontend Engineer Task Completion with required `browserPreflightOutcome`; leave Engineer and Operator
      schemas unchanged and do not infer the value from report text, browser output, Pair history, or diagnostics.
- [ ] Keep the Frontend Engineer Markdown report concise but require final URL/route, relevant viewports/states,
      headed-browser checks, diagnostics, visible evidence, and exact blockers. State that checkpoint acceptance is not
      verification evidence.
- [ ] Fix Task Completion's production metric call to pass `hostedSession.cwd`. Emit `frontend_execution_completed` only
      for an accepted Frontend Engineer completion with an active workflow, deriving phase from
      `validationContinuation`, elapsed time from the injected clock, and Pair facts from active state—never the report.
- [ ] In Workflow Validation, restore a copy of the captured active workflow with `validationContinuation: true` before
      every FEATURE repair Agent turn. Clear it after observed Task Completion; if the turn stops without Task
      Completion, retain the context for the existing continuation path. Do not alter QUICK_FIX behavior or record a
      second `implementation_finished` Plan Event.
- [ ] Update both bundled Skills using their actual source paths. Keep one assignment-specific named headed-browser
      session and normal dev server alive across Pair increments and same-runtime repair; after recovery, re-run
      preflight and reconnect only when the process/session still belongs to the current worktree, otherwise restart
      safely.
- [ ] Remove the frontend Skill's `frontend: true` trigger. Browser verification follows Frontend Engineer execution
      policy and the approved Verification Plan; Pair behavior applies only when the execution request supplies Pair
      context and `pair_checkpoint`.
- [ ] Prevent Skill guidance from adding Playwright, Puppeteer, project-local `agent-browser`, visual snapshots, or
      manifest/lockfile changes unless the approved Plan explicitly includes them. Keep browser cleanup best-effort and
      terminal-only; a Pair stop/cancellation leaves the Plan In Progress and is not terminal cleanup.
- [ ] Before changing any Plan, inventory non-archived files with `frontend`, capture their raw Front Matter/body and
      effective `resolvePlanExecutionPolicy()` result, and compare the inventory with the reviewed baseline below. If a
      new candidate appears, a target disappears, or a target acquires In-Progress/recovery/worktree state, stop before
      migration and report it for review rather than broadening or partially applying the migration.
- [ ] Re-read each target immediately before writing, call `assertSharedPlanWriteAllowed()` without a bypass, and abort
      that migration if the remote-canonical collaboration write lock rejects it. Preserve the original `updatedAt`
      explicitly and use narrow text/Front Matter edits so unknown/user-authored fields, body text, field formatting,
      lifecycle data, worktree data, collaboration data, Ticket References, and timestamps remain unchanged.
- [ ] Apply the policy-preserving migration rules: canonical FEATURE policy removes only redundant `frontend`; legacy
      FEATURE true adds `executionAgent: "frontend-engineer"` and `collaborationRecommendation: "autonomous"`; legacy
      FEATURE false only removes the field; PROJECT Epics only remove the field.
- [ ] Use this reviewed baseline: PROJECT Epics `frontend-engineer-pair-execution.md` and
      `personal-remote-workspace-v1.md`; legacy-true browser FEATUREs Personal Workspace 05 and 10–13; legacy-false
      FEATUREs `automatic-session-context-resilience.md`, `deep-semantic-source-modules.md`, and Personal Workspace
      06–09. This Plan is already canonical. Leave verified `guided-review-validation-code-reviews.md`, verified sibling
      Plans 01–03, and every file under `plans/archived/` untouched.
- [ ] Update only the active parent Epic's stale current-contract wording: remove the claim that `frontend` is
      canonical, replace startup user choice/re-asking and persisted-style language with recommendation/host derivation,
      replace `AFK` with autonomous, and remove the contradictory statement that TUI Pair hosting is out of scope.
      Preserve verified child Plans 01–03 as historical artifacts.
- [ ] Update the PRD and `docs/workflows.md` to the settled contract: recommendation chosen during the Review Loop;
      capable TUI derives Pair; ACP, Headless Mode, no adapter, legacy ownership, or capability loss derive autonomous;
      runtime state is ephemeral; Plan Recovery re-derives it; checkpoints never replace Task Completion, browser
      verification, or Workflow Validation.
- [ ] Run focused tests, inspect the migration diff and before/after policy audit, then run `deno task ci` and fix all
      failures.

## Verification Plan

- Automated: run
  `deno test -A src/shared/workflow/metrics.test.js src/shared/workflow/workflow.test.js src/shared/workflow/pair-execution.test.js src/shared/session/hosted-session.test.js src/shared/session/agent-handler.test.js`.
  Verify strict event allowlists, opt-in behavior, all runtime-style resolution paths, no second style prompt,
  execution-attempt timing, and same-runtime Pair continuation.
- Automated: run
  `deno test -A src/tools/__tests__/pair-checkpoint.test.js src/tools/__tests__/task-completed.test.js src/shared/workflow/validation.test.js`.
  Verify every normalized checkpoint decision, exactly-once/cwd metric calls, owner-specific preflight schema,
  implementation/repair phase and elapsed state, paused repair continuation, and complete exclusion of checkpoint/report
  content.
- Automated: run `deno task ci` because executable JavaScript and tests change; fix all failures.
- Manual migration audit: compare the exact reviewed inventory before/after, run `resolvePlanExecutionPolicy()` on every
  target, and confirm effective owner/recommendation is unchanged. Confirm only the targeted `frontend`/canonical policy
  fields and parent-Epic wording changed; all other Front Matter values, formatting, timestamps, and unrelated body text
  remain unchanged, and the remote-canonical collaboration write lock was not bypassed.
- Manual history audit: confirm verified `guided-review-validation-code-reviews.md`, verified sibling Plans 01–03, and
  every file under `plans/archived/` are unchanged.
- Manual metrics audit: enable `workflowMetrics`, run a Pair-recommended Frontend Engineer Plan through continue,
  revise, switch-to-autonomous, initial Task Completion, and one validation repair, then inspect JSONL. Confirm the
  three events contain only their allowed fields and no Plan/Session/Agent identity, feedback, route/URL,
  screenshot/evidence path, diagnostics, browser payload, source, or completion report.
- Manual workflow/docs audit: confirm the PRD, active parent Epic, Skills, and `docs/workflows.md` all describe the same
  recommendation-driven TUI Pair behavior, unsupported-host autonomous fallback, ephemeral recovery model, persistent
  same-runtime browser loop, and checkpoint/validation separation.
- Expected result: active Plans and current guidance no longer emit or teach `frontend`; migrated Plans preserve prior
  execution behavior; Frontend Engineer/Pair metrics are useful but structurally unable to retain implementation or user
  content; validation-repair completion remains owner-aware without changing Plan Lifecycle.
- Execution policy matrix:
  - FEATURE Plans may omit `executionAgent`; omission defaults to `engineer` for backward compatibility.
  - FEATURE Plans may set `executionAgent: "engineer"` with `collaborationRecommendation: "autonomous"` or omitted;
    `pair` is invalid for Engineer-owned execution.
  - FEATURE Plans may set `executionAgent: "frontend-engineer"` with `collaborationRecommendation: "autonomous"` or
    `"pair"`.
  - Use Frontend Engineer for browser-rendered UI work whose primary outcome is materially visual or interactive;
    otherwise use Engineer, including TUI work and incidental frontend-file edits.
  - A canonical Pair recommendation activates Pair only in a Pair-capable host; unsupported hosts derive autonomous.
    Legacy `frontend: true` remains Frontend Engineer/autonomous compatibility behavior until migrated.
  - PROJECT Epics are non-executable containers and must not define `executionAgent` or `collaborationRecommendation`;
    execution policy belongs on child FEATURE Plans.

## Edge Cases & Considerations

- Generic denylist sanitization remains useful but is not the privacy guarantee for dedicated events. The closed schema
  must omit unknown keys and free-form strings even if a future call site accidentally supplies them.
- Checkpoint count means authorized attempts, not accepted increments, progress percentage, quality, or validation.
  Cancellation and missing revision feedback are normalized decisions without feedback content; inactive calls do not
  increment or emit.
- Elapsed time is the current live runtime execution attempt, not a durable wall-clock total across process loss. Plan
  Recovery must not fabricate historical duration from Plan timestamps or Session Transcript data.
- Frontend Engineer may call Task Completion during validation repair. Transiently restoring active context must not
  leave validation itself looking like implementation or cause Agent Handler to record duplicate implementation
  completion.
- `browserPreflightOutcome` is a coarse Agent-reported fact, not proof of final browser verification. The Markdown
  report and approved Verification Plan remain the evidence source; external blockage must still identify what remains
  unverified in the report.
- Browser/dev-server processes are not Session Host-managed resources in this Epic. Skills should promise stable reuse
  and terminal best-effort cleanup, not guaranteed persistence across process loss or automatic leak-free cleanup.
- Migration from legacy true to Pair would change approved behavior. Always use autonomous for mechanical migration;
  changing a recommendation to Pair requires a separate Review Loop decision.
- The reviewed migration inventory is intentionally closed. Newly created legacy Plans require their own ownership and
  recommendation review rather than opportunistic conversion during execution.
- The working tree currently contains unrelated changes, including Personal Workspace Plan 04, TUI API files, build
  scripts/configuration, and the Plannotator submodule. Execution must preserve them and re-check overlap before every
  broad Plan or documentation edit.
