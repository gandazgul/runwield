# Plan: Parallel task agent execution + task context isolation

## Context

- Current `PROJECT` execution in `src/shared/workflow.js` claims dependency-ordered task dispatch, but behavior is
  effectively sequential and can fall back to a single Engineer run if task parsing fails.
- Desired behavior (confirmed):
  - run dependency-ready tasks in parallel with a concurrency cap of **4**,
  - continue executing other independent tasks when one fails,
  - report failures clearly and offer retry for failed tasks,
  - keep task runs fully isolated (no shared per-task session state),
  - treat malformed task tables as a **hard error** and send the plan back to planning-agent repair (no single-agent
    fallback).

## Approach

- Harden task-table parsing/validation so `PROJECT` tasks are deterministically read from approved plans (including
  stricter validation of assignee/dependency references).
- Replace sequential dispatch with a dependency-aware scheduler:
  - topologically gate by dependencies,
  - execute ready tasks in parallel with max concurrency = **4**,
  - track per-task status (`pending`, `running`, `success`, `failed`, `blocked`).
- Preserve strict context isolation by running each task in an independent `runAgentSession()` invocation (fresh
  in-memory session per task).
- Keep task prompts token-efficient:
  - include task assignment + dependencies + plan context needed for execution,
  - avoid passing interactive chat history,
  - do **not** add original user request unless already necessary/available.
- On task failure, continue unaffected tasks; at end, show a structured failure summary and ask whether to retry failed
  tasks.
- On malformed/unusable task table, hard-stop execution and route back to plan-repair loop for the responsible planning
  agent.

## Files to modify

- `src/shared/workflow.js` (task parsing/validation, scheduler, parallel dispatch, failure aggregation, retry flow)
- `src/constants.js` (parallelism constant, potentially retry/dispatch flags)
- `src/cmd/router/index.js` (if execution returns plan-repair-required result)
- `src/cmd/resume/index.js` (if execution returns plan-repair-required result)
- Possibly `.pi/agents/architect.md` (tighten task-table contract instructions)
- Possibly `.pi/agents/planner.md` (same contract if FEATURE plans ever include task tables)

## Reuse

- Existing `extractTasks()` and `executePlan()` flow in `src/shared/workflow.js`
- Existing `runAgentSession()` isolation behavior in `src/shared/session.js` (already uses fresh
  `SessionManager.inMemory()` per invocation)
- Existing `reviewLoop()` in `src/shared/workflow.js` for plan-repair routing
- Existing `planWrittenTool` + Plannotator review path for enforced plan correction

## Steps

- [ ] Confirm current failure mode(s): parser miss, sequential scheduler limitation, and fallback path behavior.
- [ ] Replace `extractTasks()` with stricter parsing + validation:
  - enforce required headings/columns,
  - normalize assignee values,
  - validate dependency references and cycles.
- [ ] Implement dependency-aware parallel scheduler (max 4 concurrent running tasks).
- [ ] Add per-task execution result model (status, agent, error, summary, timings).
- [ ] Continue independent tasks after failures; mark dependent tasks blocked when needed.
- [ ] Add post-run summary + retry prompt for failed tasks only.
- [ ] Remove single-agent fallback for malformed task tables; trigger plan-repair path instead.
- [ ] Wire plan-repair handoff (architect/planner by classification) and require corrected table before execution
      resumes.
- [ ] Verify via router and resume flows with:
  - fully independent tasks,
  - mixed dependencies,
  - malformed/cyclic dependency table,
  - intentional task failure + retry.

## Verification

- End-to-end `PROJECT` flow (fresh route + resume approved).
- Validate:
  - up to 4 dependency-ready tasks run concurrently,
  - dependent tasks do not start until prerequisites succeed,
  - independent tasks continue when one task fails,
  - failed tasks are summarized and user can choose retry,
  - mixed assignees (`engineer`, `tester`, `doc-writer`) dispatch correctly,
  - no per-task conversational bleed (fresh session context each run),
  - final execution summary reports success/failed/blocked counts.
- Validate malformed task table behavior:
  - no fallback to single-agent execution,
  - plan is routed back into planning repair workflow,
  - corrected plan must pass review before execution.

## Decision log

- On malformed task tables, Harns should automatically invoke the planning-agent repair loop (no extra confirmation
  prompt).
