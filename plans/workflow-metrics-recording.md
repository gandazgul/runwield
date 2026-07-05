---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Record privacy-preserving local workflow decision metrics and tool-usage counters across routing, planning, execution, validation, recovery, and model selection."
affectedPaths:
    - "src/shared/workflow/metrics.js"
    - "src/tools/triage-report.js"
    - "src/tools/plan-written.js"
    - "src/tools/task-completed.js"
    - "src/tools/return-to-router.js"
    - "src/shared/workflow/orchestrator.js"
    - "src/shared/workflow/decisions.js"
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/validation.js"
    - "src/cmd/load-plan/index.js"
    - "src/shared/session/session.js"
    - "src/shared/session/root-session.js"
    - "docs/settings.md"
    - "config.schema.json"
frontend: false
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-07-05T00:25:41-04:00"
status: "draft"
---

# Workflow Metrics Recording

## Context

The request is to record local-only workflow metrics for RunWield decisions across the core lifecycle, plus tool-call
counters to understand which tools are used most often and in which broad mode. This covers Router triage, planning
outcomes, execution outcomes, validation/repair loops, recovery choices, model selection, and tool usage. Today these
decisions are spread across tool implementations and workflow orchestrators:

- Router triage is emitted by `triage_report` and dispatched in `dispatchPostTriage`.
- Planning decisions are normalized by `decidePostPlanning` after `plan_written` review/approval outcomes.
- Execution decisions are normalized by `decidePostExecution` after `executePlan` / `task_completed`.
- Validation and repair loops live in `runMechanicalValidation` and `runValidationLoop`.
- Recovery choices live in `handlePlanRecovery` inside `src/cmd/load-plan/index.js`.
- Model selection is resolved inside `resolveModel` / `buildAgentSession`.
- Tool invocation lifecycle events are already observed in `attachUiSubscribers` via `tool_execution_start` and
  `tool_execution_end`.

The metrics must be local-only: no network transmission, no analytics sharing, and no prompt/diff/user-content capture.
The implementation should produce durable, inspectable local records that help evaluate workflow behavior without
changing the workflow state machine.

Confirmed product decisions:

- Store metrics as newline-delimited JSON under the user's RunWield home directory, scoped per project similarly to
  sessions: `~/.wld/workflow-metrics/<encoded-cwd>/metrics.jsonl`.
- Metrics recording is opt-in. By default RunWield records nothing; users enable it with `workflowMetrics: true` or
  `{ "workflowMetrics": { "enabled": true } }` in settings.
- This feature only records data, including per-call counter events for tool usage. It does not add a reporting UI or
  CLI reader yet.

## Objective

Add a small, dependency-free workflow metrics recorder and instrument decision points so RunWield can answer questions
like:

- How often does Router choose each routing intent and complexity?
- How often are plans saved, approved for execution, canceled, or returned for feedback?
- How often does execution complete, pause, require repair, or fail before validation?
- How many validation cycles/CI repair attempts/semantic repair attempts/merge repair attempts happen before success or
  halt?
- Which recovery action was selected for held/failed plans?
- Which model source was selected for each agent, and which candidates failed before selection?
- Which tools are called most often overall, by agent, and by broad sub-usage such as code search vs code read, memory
  read vs memory write, bash validation vs git, file read vs file edit, or lifecycle tool calls?

## Approach

Implement a dedicated `src/shared/workflow/metrics.js` module that appends sanitized event records to a local JSONL
file. Keep the call sites intentionally thin: each workflow component should emit one semantic event at the point it
already has the normalized decision/outcome, without adding metrics-specific branching to core logic.

Recommended event shape:

```js
{
    v: 1,
    ts: "2026-07-05T00:00:00.000Z",
    category: "routing" | "planning" | "execution" | "validation" | "recovery" | "model_selection" | "tool_usage",
    event: "triage_reported",
    sessionId: "...",        // optional if safely available
    planName: "...",         // optional, no plan contents
    agentName: "planner",    // optional
    cwdHash: "...",          // hash project root instead of recording full path
    details: { ... }          // sanitized scalar/array/object fields only
}
```

Privacy and robustness rules:

- Do not record user requests, prompts, plan markdown, diffs, CI output, review feedback text, raw tool args, raw tool
  results, file contents, absolute paths, API keys, or full model auth configuration.
- Record file paths only when they are already user-visible plan-relative metadata such as `affectedPaths`; otherwise
  omit or hash path-like values.
- Record model identifiers and source labels, but never auth state beyond a boolean/enum such as
  `authConfigured: true|false`.
- For tool-call counters, record `toolName`, `agentName`, safe `subUsage`, success/error outcome, and duration when
  available; never record the argument payload or result text.
- Metrics writes are best-effort. A metrics write failure must never halt routing, planning, execution, validation,
  recovery, or model selection.
- Keep records local to the user's `~/.wld/` directory, separate from repo-tracked plan metadata.

## Files to Modify

- `src/shared/workflow/metrics.js` — new metrics recorder module with home-scoped per-project path resolution, settings
  gate, JSONL append, sanitization, project-root hashing, and convenience helpers such as `recordWorkflowMetric()`.
- `src/shared/workflow/metrics.test.js` — tests for enabled/disabled behavior, JSONL append format, sanitization,
  write-failure swallowing, and path/hash behavior.
- `src/tools/triage-report.js` — record `routing/triage_reported` with routing intent, complexity, classification,
  affected path count/list, and session name presence.
- `src/shared/workflow/orchestrator.js` — record the dispatch branch selected for each routing intent and high-level
  outcomes for OPERATION/QUICK_FIX/FEATURE/PROJECT orchestration.
- `src/shared/workflow/decisions.js` — record or expose enough normalized planning/execution decision data for callers
  to record `planning/decision` and `execution/decision` consistently.
- `src/tools/plan-written.js` — record plan review outcomes: canceled, feedback, approved/saved, approved/execute,
  project decomposition started/saved, and readiness lifecycle success/failure where useful.
- `src/tools/task-completed.js` — record `execution/task_completed` with agent name and whether a message was supplied,
  not the message text.
- `src/tools/return-to-router.js` — record `routing/return_to_router` when an agent hands control back to Router,
  without recording the handoff reason text.
- `src/shared/workflow/workflow.js` — record plan execution start, execution result, non-executable plan rejection,
  worktree creation/reuse metadata without full paths, and implementation completion.
- `src/shared/workflow/validation.js` — record QUICK_FIX mechanical validation attempts/results, FEATURE validation
  cycles, CI pass/fail attempts, semantic review pass/fail, human review decisions, semantic/CI/merge repair attempts,
  validation pass/fail, and merge-back outcome.
- `src/cmd/load-plan/index.js` — record recovery prompt selections (`validate`, `inspect`, `continue`, `reset`, `merge`,
  `abandon`, `review`, `hold`, `cancel`) and recovery action outcomes.
- `src/shared/session/session.js` — instrument model-selection resolution by recording candidate sources, failed
  candidate reasons as enums, selected provider/model/source, selected thinking level/temperature source if available,
  image mode/fallback status from `buildAgentSession`, and tool-call counter events from `attachUiSubscribers`.
- `src/shared/session/agent-handler.js` — record active-agent handler workflow transitions when it decides to execute a
  plan, run validation, stay with an agent, or halt after a normalized decision.
- `src/shared/settings.js` — add helper(s) for a `workflowMetrics` custom setting if needed, or use existing
  `getMergedCustomSetting` directly from `metrics.js`.
- `src/shared/session/root-session.js` — reuse or export the existing cwd encoding convention so metrics directory
  layout matches persisted sessions.
- `docs/settings.md` — document opt-in local workflow metrics, home-scoped per-project storage path, privacy
  constraints, and record-only scope.
- `config.schema.json` — add schema for the `workflowMetrics` setting.

## Reuse Opportunities

- `src/shared/settings.js#getMergedCustomSetting` — read a merged global/project `workflowMetrics` setting without
  introducing a new settings subsystem.
- `src/constants.js#CWD` and `HOME_DIR` — anchor metrics to the primary project root while storing records under the
  user's RunWield home directory.
- `src/shared/session/root-session.js#encodeCwdForSessionDir` — reuse the session directory encoding for per-project
  metrics directories.
- Existing workflow decision functions in `src/shared/workflow/decisions.js` — instrument normalized decision outcomes
  instead of duplicating branch logic.
- Existing workflow tests in `src/shared/workflow/orchestrator.test.js`, `validation.test.js`, and `workflow.test.js` —
  extend dependency-injection patterns to assert metrics calls without touching real user files.
- Existing model-selection tests under `src/shared/session/__tests__/` — add coverage for model metrics around
  overrides/fallbacks.
- `src/shared/session/session.js#attachUiSubscribers` — reuse existing tool execution start/end events so tool counters
  are centralized and cover built-in, custom, and protected tools without wrapping every tool implementation.
- `Deno.writeTextFile(..., { append: true })` and `Deno.mkdir(..., { recursive: true })` — sufficient for append-only
  JSONL metrics without adding dependencies.

## Implementation Steps

- [ ] Add `src/shared/workflow/metrics.js`.
  - [ ] Define JSDoc typedefs for metric category, record, settings, and safe details; do not use TypeScript syntax.
  - [ ] Resolve the default metrics path to
        `join(HOME_DIR, ".wld", "workflow-metrics", encodeCwdForSessionDir(CWD), "metrics.jsonl")`.
  - [ ] Read `workflowMetrics` via `getMergedCustomSetting("workflowMetrics")` with default disabled.
  - [ ] Support `workflowMetrics: true` or `{ enabled: true }` to enable writes; treat `false`, missing, or
        `{ enabled: false }` as disabled.
  - [ ] Do not add arbitrary path redirection in this feature unless it is constrained to the same
        `~/.wld/workflow-metrics/` tree; keep the first implementation simple if possible.
  - [ ] Sanitize `details` recursively: allow primitives, arrays, and plain objects; redact suspicious keys (`prompt`,
        `request`, `content`, `diff`, `output`, `apiKey`, `token`, `secret`, `authorization`, `password`); truncate long
        strings; avoid absolute paths.
  - [ ] Hash the project root to `cwdHash` using Web Crypto SHA-256 rather than recording `CWD`.
  - [ ] Append one JSON object per line; swallow write errors after optionally emitting debug output only when existing
        debug conventions allow.
- [ ] Add `src/shared/workflow/metrics.test.js` for recorder behavior.
  - [ ] Use temp project roots/dependency injection rather than the real `.wld/`.
  - [ ] Assert missing/default settings and disabled settings produce no file, while opt-in settings create the expected
        home-scoped per-project file.
  - [ ] Assert redaction/truncation of unsafe fields.
  - [ ] Assert records include `v`, `ts`, `category`, `event`, `cwdHash`, and sanitized `details`.
  - [ ] Assert write failures do not throw.
- [ ] Instrument routing.
  - [ ] In `createTriageReportTool`, record `routing/triage_reported` after normalization with routing intent,
        complexity, classification, affectedPaths, affectedPathCount, and `hasSessionName`.
  - [ ] In `dispatchPostTriage`, record `routing/dispatch_selected` with selected routing intent and target
        agent/branch.
  - [ ] In `return-to-router.js`, record `routing/return_to_router` with target agent and `hasReason`, but never the
        reason text.
  - [ ] For OPERATION and QUICK_FIX, record whether `task_completed` was observed and whether mechanical validation
        ran/passed.
- [ ] Instrument planning.
  - [ ] In `plan-written.js`, record `planning/review_outcome` for canceled, feedback, project readiness
        saved/proceeded, feature readiness saved/proceeded, and repair-required outcomes.
  - [ ] In callers that use `decidePostPlanning`, record `planning/decision` with `kind`, `reason`, `planName`,
        classification, and whether tasks were present.
- [ ] Instrument execution.
  - [ ] In `task-completed.js`, record `execution/task_completed` with agent name and `hasMessage` only.
  - [ ] In `executePlan`, record start, non-executable rejection reasons, execution completion/incompletion, and
        implementation-finished lifecycle success.
  - [ ] In `startActiveExecutionWorkflow`, record whether an existing worktree was reused or a new worktree was created,
        worktree status, branch presence, and base-branch presence without full paths.
  - [ ] In `agent-handler.js` and `orchestrator.js`, record `execution/decision` after `decidePostExecution` with
        `kind`, `reason`, failed task count, and next agent.
- [ ] Instrument validation and repair.
  - [ ] In `runMechanicalValidation`, record validation start, each CI attempt result, each repair dispatch/completion,
        and final pass/fail with attempts.
  - [ ] In `runValidationLoop`, record validation start, validation cycle count, CI attempt results, semantic review
        result, human review mode/decision, repair dispatch/completion for CI/semantic/human/merge repair, merge-back
        pass/fail, and final validation pass/fail.
  - [ ] Ensure CI output, review feedback, diff text, and human review comments are never recorded.
- [ ] Instrument recovery.
  - [ ] In `handlePlanRecovery`, record the selected recovery action, current plan status, worktree availability flags,
        and action result.
  - [ ] Add metrics for recovery reset/continue/merge/review/hold/abandon outcomes without recording worktree paths.
- [ ] Instrument model selection.
  - [ ] Refactor `resolveModel` minimally so it can record candidate evaluation as sanitized metadata: candidate source,
        strictness, parsed/invalid, found/discovered/missing, auth configured/missing, and selected
        provider/model/source.
  - [ ] Record a failure event before throwing for invalid strict candidates, unknown strict candidates, missing auth,
        or no configured model.
  - [ ] In `buildAgentSession`, record final `model_selection/session_configured` with agent name, provider/model, image
        mode, vision fallback presence, resolved thinking level, and whether temperature was configured.
- [ ] Instrument tool-call counters.
  - [ ] In `attachUiSubscribers`, record a `tool_usage/tool_call_started` counter event on `tool_execution_start` with
        `toolName`, `agentName`, and a safe `subUsage` derived from the tool name and argument shape only.
  - [ ] Record `tool_usage/tool_call_finished` on `tool_execution_end` with `toolName`, `agentName`, safe `subUsage`,
        `isError`, and duration when available.
  - [ ] Add a helper such as `classifyToolSubUsage(toolName, args)` that never returns raw args. Suggested splits:
        `bash` into `validation_command`, `git`, `package_manager`, `filesystem`, or `shell_other`; code tools into
        `search`, `read`, `outline`, `refs`, `impact`, `trace`; memory tools into `read`, `write`, `delete`; file tools
        into `read`, `search`, `list`, `edit`, `multi_edit`, `write`; workflow tools into `triage`, `plan_written`,
        `task_completed`, `return_to_router`, `user_interview`; browser tools, if present, into `navigate`, `inspect`,
        `interact`, `screenshot`, or `browser_other`.
  - [ ] Keep these as append-only metric events rather than an in-place aggregate file; reporting can later aggregate
        JSONL by `toolName`, `subUsage`, agent, category, or session.
- [ ] Add or update tests around instrumentation.
  - [ ] Prefer dependency injection of `recordWorkflowMetric` where existing modules already use `__deps`.
  - [ ] For tool modules without `__deps`, mock via imported helper behavior only if feasible; otherwise assert by
        writing to a temp `.wld/` with settings reset.
  - [ ] Cover at least one event in each category: routing, planning, execution, validation, recovery, model_selection,
        and tool_usage.
  - [ ] Add tests for `classifyToolSubUsage` that prove raw commands, search queries, file contents, and reason/message
        text are not preserved in tool usage metrics.
- [ ] Update docs and schema.
  - [ ] Add `workflowMetrics` to `docs/settings.md` custom keys with opt-in examples and the default storage path.
  - [ ] Add matching `workflowMetrics` schema to `config.schema.json`.
  - [ ] Explicitly note that reporting/CLI summaries are out of scope for this feature.

## Verification Plan

- Automated: `deno task ci`
- Targeted while developing:
  - `deno test -A src/shared/workflow/metrics.test.js`
  - `deno test -A src/shared/workflow/orchestrator.test.js src/shared/workflow/validation.test.js src/shared/workflow/workflow.test.js src/shared/workflow/decisions.test.js`
  - `deno test -A src/shared/session/agent-handler.test.js src/shared/session/__tests__/agent-model-override.test.js src/shared/session/__tests__/session-tools-policy.test.js`
  - `deno test -A src/cmd/load-plan/index.test.js src/tools/__tests__/plan-written.test.js src/tools/__tests__/return-to-router.test.js`
- Manual:
  - Set `workflowMetrics: true` in `.wld/settings.json` or `~/.wld/settings.json`, run a small interactive request that
    routes to INQUIRY or OPERATION, and confirm `~/.wld/workflow-metrics/<encoded-cwd>/metrics.jsonl` is created with
    routing/model-selection events only.
  - Run or simulate a FEATURE plan through approval/execution/validation with metrics enabled and confirm records cover
    planning, execution, validation, model-selection, and tool-usage categories.
  - Remove or set `workflowMetrics: false`, run a request, and confirm no new metrics are appended.
- Expected results:
  - Metrics records are valid JSONL, append-only, local to `~/.wld/`, and not written unless explicitly enabled.
  - Workflow behavior and plan lifecycle statuses are unchanged.
  - No record contains prompt text, user request text, diff text, CI output, review feedback, raw tool args/results,
    secrets, full auth config, or absolute worktree paths.

## Edge Cases & Considerations

- Metrics write failures should be non-fatal and must not mask the original workflow outcome.
- Validation and recovery code paths are already complex; keep instrumentation close to existing outcome branches and
  avoid introducing new control flow.
- Model selection can throw before a session exists; record best-effort failure metrics before throwing, but never
  degrade the error message users already see.
- Concurrent worktrees or multiple sessions may append to the same JSONL file. Individual writes should be one JSON line
  and small; do not introduce a lock unless tests show interleaving is a real problem.
- Store under `~/.wld/workflow-metrics/` rather than project `.wld/`, matching the user's preference for per-project
  home-local storage similar to sessions.
- Reporting/summary commands are intentionally out of scope and can be planned later once the raw event vocabulary
  stabilizes.
