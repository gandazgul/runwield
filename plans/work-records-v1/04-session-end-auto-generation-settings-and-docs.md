---
planId: "7e2e6038-346c-4397-a09c-a96f8357cbdd"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Hook best-effort Work Record generation into session boundaries, add the auto-generation setting, and document V1 behavior. This completes V1 by generating records automatically on /new and /quit without blocking terminal Plan transitions or session closure."
affectedPaths:
    - "src/shared/session/session-runtime.js"
    - "src/cmd/new/"
    - "src/cmd/quit/"
    - "src/shared/settings.js"
    - "src/shared/work-records/"
    - "src/shared/session/workflow-context-session.js"
    - "docs/prd/work-records-prd.md"
    - "docs/work-records/"
    - "docs/usage.md"
    - "docs/workflows.md"
    - "docs/settings.md"
frontend: false
createdAt: "2026-07-15T21:05:36.853Z"
updatedAt: "2026-07-15T21:05:36.853Z"
status: "draft"
origin: "internal"
parentPlan: "work-records-v1"
order: 4
dependencies:
    - "02-recorder-generation-and-backfill"
    - "03-index-search-cli-and-agent-retrieval-tools"
---

# Session-End Auto Generation, Settings, and Docs

## Context

The final V1 behavior is automatic internal Work Record generation at session boundaries, but it must be best-effort and
non-blocking. Completed Plans should already be able to generate records through explicit backfill; this slice connects
that generation service to `/new` and `/quit`, scoped only to Plans touched by the current session. Broad repository
discovery remains the explicit `wld wr backfill` flow.

This slice also documents Work Record storage, completion confidence, backfill, derived indexing, automatic generation,
and deferred manual/external creation.

## Objective

Add session-boundary Work Record scheduling before `/new` session replacement and `/quit` closure. Respect a project
setting `workRecords.autoGenerateOnSessionEnd` defaulting to true. Generation must never block Plan terminal
transitions, `/new`, or `/quit`; failures should write durable Plan backlink metadata and at most emit concise status
messages. Update docs and PRD notes so users and future agents understand V1 behavior and deferred scope.

## Approach

Use the generation service from the previous slice as the only automation dependency. Add a session-boundary
orchestrator that identifies touched top-level Plans/Epics for the current HostedSession/workflow context, deduplicates
them, checks eligibility/missing backlink state, and schedules generation best-effort.

Keep automation separate from Plan Lifecycle and Workflow Validation critical paths. Validation may mark Plans terminal;
session-boundary automation observes terminal source Plans later. If generation or index sync fails, `/new` and `/quit`
still proceed, and the source Plan receives `workRecord.status: failed`, `lastAttemptAt`, and a concise `error`.

## Files to Modify

- `src/shared/session/session-runtime.js` — schedule best-effort Work Record generation before session
  replacement/closure in `closeSessionWhenIdle()` / `closeAllSessionsWhenIdle()` or the appropriate `/new` and `/quit`
  runtime paths.
- `src/cmd/new/` — ensure `/new` invokes the session-boundary generation hook before replacing the current session
  without blocking replacement.
- `src/cmd/quit/` — ensure `/quit` invokes the session-boundary generation hook before closing sessions without blocking
  exit.
- `src/shared/settings.js` — add `workRecords.autoGenerateOnSessionEnd` setting support with default true.
- `src/shared/work-records/` — add session-boundary orchestration, touched Plan resolution, setting checks, dedupe, skip
  reasons, and concise runtime/status reporting.
- `src/shared/session/workflow-context-session.js` — reuse or expose current session Plan identity/touched Plan context
  if needed for scoped generation.
- `docs/prd/work-records-prd.md` — align final V1 scope and any implementation decisions discovered during the Epic.
- `docs/work-records/` — document only by example/placeholder if needed; generated records remain canonical artifacts.
- `docs/usage.md` — document `wld wr`, listing/search/backfill, and where records live.
- `docs/workflows.md` — document automatic generation timing, skipped-verification reason requirements, backfill, and
  non-blocking failure behavior.
- `docs/settings.md` — document `workRecords.autoGenerateOnSessionEnd` default and behavior.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `SessionRuntime.closeSessionWhenIdle()` and `SessionRuntime.closeAllSessionsWhenIdle()` — existing idle-safe session
  close boundaries.
- `/new` and `/quit` command handlers — current replacement/exit control points.
- `HostedSession` workflow context and `src/shared/session/workflow-context-session.js` — current Plan/session identity
  for touched Plan resolution.
- Work Record generation and backlink helpers from slice 2 — single source for generation and failure recording.
- Work Record index sync from slice 3 — sync generated records without making index failures authoritative.
- `src/shared/settings.js` — merged project setting patterns and defaults.
- Existing docs in `docs/usage.md`, `docs/workflows.md`, and `docs/settings.md` — command and workflow documentation
  style.

## Implementation Steps

- [ ] Step 1: Add settings support for `workRecords.autoGenerateOnSessionEnd`, defaulting to true and treating missing
      config as enabled.
- [ ] Step 2: Add session-boundary touched Plan resolution that scopes to Plans/Epics associated with the current
      session, resolving child FEATURE Plans to parent Epics and deduplicating targets.
- [ ] Step 3: Add an automation orchestrator that checks setting, eligibility, terminal status, existing backlinks, and
      skip reasons before calling the generation service.
- [ ] Step 4: Hook the orchestrator into `/new` session replacement and `/quit` session closure through idle-safe
      runtime boundaries.
- [ ] Step 5: Ensure automation is best-effort: catch generation/index errors, write durable failure backlink metadata
      when possible, emit concise status messages when a process/session surface exists, and always allow `/new` or
      `/quit` to continue.
- [ ] Step 6: Add tests for setting disabled behavior, touched-plan scoping, child-to-Epic resolution, existing-backlink
      skip, generation failure resilience, and non-blocking `/new`/`/quit` behavior.
- [ ] Step 7: Update docs for concepts, storage, list/search/backfill, agent retrieval, automatic generation, indexing
      as derived state, completion confidence, closure reason requirements, setting behavior, and deferred
      manual/external creation.
- [ ] Step 8: Run final V1 integration checks with a completed Plan fixture, session boundary trigger, generated Work
      Record, Plan backlink, index/search availability, and docs consistency.

## Verification Plan

- Automated:
  `deno test -A src/shared/session/session-runtime.test.js src/cmd/new/**/*.test.js src/cmd/quit/**/*.test.js`
- Automated: `deno test -A src/shared/work-records/**/*.test.js src/shared/workflow/validation.test.js`
- Automated: `deno task ci`
- Manual: Complete or fixture a verified top-level FEATURE Plan in a session, run `/new`, and confirm a Work Record is
  generated under `docs/work-records/`, the source Plan gets a generated backlink, and the new session still starts even
  if generation emits warnings.
- Manual: Mark a PROJECT Epic done enough and run `/quit`; confirm one Epic Work Record is generated for the Epic and
  session closure proceeds.
- Manual: Disable `workRecords.autoGenerateOnSessionEnd`; repeat a session boundary and confirm no automatic generation
  occurs while explicit `wld wr backfill` still works.
- Manual: Simulate Recorder or index failure during session-end generation; confirm `/new` and `/quit` proceed, Plan
  status is not rolled back, and failure backlink metadata is recorded.
- Manual: Search for the generated record after session-boundary generation and confirm derived index/search behavior
  still works.
- Expected result: Work Records are generated automatically at safe session boundaries, never block user flow, and are
  documented as canonical Markdown with rebuildable derived search.

## Edge Cases & Considerations

- Session-end automation must be scoped to touched Plans only; broad repository scans belong to `wld wr backfill`.
- Avoid hooking generation directly into validation success or Plan terminal transition code in a way that can block
  terminal status.
- `/new` and `/quit` should proceed even if generation, Recorder invocation, Plan backlink update, or index sync fails.
- If a source Plan already has `workRecord.status: generated`, skip it; retry semantics for failed backlinks should be
  explicit and conservative.
- If touched Plan identity is missing, prefer no-op plus concise debug/status output over broad scanning.
- Docs must clearly state that manual/external Work Record creation, Plannotator Work Record approval, and Guided Review
  reuse are deferred from this V1.
