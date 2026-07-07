---
planId: "79c82bc3-2f16-491c-9a1e-9f708158ae45"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Remove remaining mutable global session-state dependencies, restore full existing TUI behavior, unskip all temporary tests, and run the complete regression checklist for the Session Host refactor."
affectedPaths:
    - "src/shared/session/session-state.js"
    - "src/cmd/resume/index.js"
    - "src/cmd/session/index.js"
    - "src/cmd/compact/index.js"
    - "src/cmd/copy/index.js"
    - "src/cmd/reload/index.js"
    - "src/cmd/load-plan/index.js"
    - "src/shared/interactive/chat-session.js"
    - "src/shared/interactive/slash-dispatch.js"
    - "src/shared/session/session.js"
    - "src/shared/workflow/orchestrator.js"
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/validation.js"
    - "src/tools/return-to-router.js"
    - "src/tools/plan-written.js"
    - "src/**/*.test.js"
frontend: false
createdAt: "2026-07-03T18:03:46.155Z"
updatedAt: "2026-07-06T13:38:53.974Z"
status: "verified"
origin: "internal"
parentPlan: "session-host-multi-session-refactor"
order: 6
dependencies:
    - "workflow-execution-and-validation-session-scoping"
verifiedAt: "2026-07-06T13:38:53.974Z"
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-07-06T13:26:35.791Z"
---

# Cleanup Globals and Restore TUI Behavior

## Context

Earlier slices intentionally broke and rebuilt the runtime on an isolation branch, allowing skipped tests as temporary
escrow while Session Host, TUI, routing, and workflow scoping were introduced. This final slice must finish the
refactor: remove remaining mutable singleton session-state usage, restore current TUI behavior, and ensure all temporary
skipped tests are either unskipped and passing or deleted with explicit justification.

This is the point where the branch stops being an intermediate refactor state and becomes mergeable product work.

## Objective

Complete the Session Host multi-session refactor for Slice 1 of the ACP roadmap. The existing TUI should run through one
HostedSession with no intended behavior change, while tests prove multiple Hosted Sessions can coexist in one process
without leaking active agent, root session, pending swap/handoff, model/thinking, UI/event sink, or workflow state.

## Approach

Audit all remaining production imports and test fixtures that touch `session-state.js` or implicit session globals.
Replace them with HostedSession or SessionHost context. Restore command behavior for `resume`, `session`, `compact`,
`copy`, `reload`, and any load-plan leftovers. Then unskip all temporary tests from prior slices and run full CI.

Critical instruction: all temporary skipped/ignored tests introduced during this Epic must be unskipped and passing by
the end of this slice, unless a test is deleted because it no longer represents valid behavior and the deletion is
justified in code review notes. Do not leave hidden skipped regression coverage.

## Files to Modify

- `src/shared/session/session-state.js` — delete the module or reduce it to non-mutable typedefs/helpers only. No
  production mutable singleton state should remain.
- `src/cmd/resume/index.js` — resume should load or replace the current TUI HostedSession and rebuild/hydrate through
  HostedSession context.
- `src/cmd/session/index.js` — read session info from the current HostedSession's session manager.
- `src/cmd/compact/index.js` — compact the current HostedSession's root AgentSession only.
- `src/cmd/copy/index.js` — copy from the current HostedSession's root AgentSession/messages only.
- `src/cmd/reload/index.js` — reload config/context for the current HostedSession without relying on global root state.
- `src/cmd/load-plan/index.js` — remove any remaining global session/workflow assumptions from load-plan continuation.
- `src/shared/interactive/chat-session.js` — finish TUI behavior restoration and remove any temporary state plumbing
  left from earlier slices.
- `src/shared/interactive/slash-dispatch.js` — ensure all built-in commands receive HostedSession context consistently.
- `src/shared/session/session.js` — remove remaining production fallbacks to implicit root/ui/model/workflow state.
- `src/shared/workflow/orchestrator.js` — finish HostedSession-only routing/handoff context.
- `src/shared/workflow/workflow.js` — finish HostedSession-only execution workflow context.
- `src/shared/workflow/validation.js` — finish HostedSession-only validation context.
- `src/tools/return-to-router.js` — ensure tool context is HostedSession-aware without active UI globals.
- `src/tools/plan-written.js` — ensure plan-written uses HostedSession/session manager context only.
- `src/**/*.test.js` — unskip temporary tests from prior slices and update fixtures to use HostedSession/SessionHost.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session-host.js` — use the final SessionHost API as the only production owner for Hosted Sessions.
- `src/shared/session/hosted-session.js` — use HostedSession methods for all mutable session-scoped state.
- Existing command tests under `src/cmd/` — reuse behavior expectations for resume, session, compact, copy, reload, and
  load-plan.
- Existing manual verification checklist in the parent Epic — use it as the final TUI behavior acceptance checklist.
- `deno run ci` — use the repository's standard full validation command.

## Implementation Steps

- [ ] Step 1: Audit production imports of `src/shared/session/session-state.js` and replace mutable state usage with
      explicit HostedSession or SessionHost context.
- [ ] Step 2: Finish command migration for `resume`, `session`, `compact`, `copy`, `reload`, and any remaining
      `load-plan` paths.
- [ ] Step 3: Remove production fallback paths that silently use active UI, active root session, active model, or active
      workflow globals.
- [ ] Step 4: Delete or reduce `session-state.js` so it no longer owns process-global mutable session state.
- [ ] Step 5: Unskip every temporary test introduced during the Epic. If a skipped test is deleted, document why the
      behavior is obsolete or covered elsewhere.
- [ ] Step 6: Add a guard test or explicit audit check that prevents reintroducing mutable production session-state
      imports where practical.
- [ ] Step 7: Run the full automated and manual regression checklist and fix all regressions.

## Verification Plan

- Automated: run a repository search for skipped/ignored tests introduced during this Epic and unskip them. There must
  be no remaining temporary skipped regression tests from the Session Host refactor.
- Automated: run a repository search for production imports of `session-state.js`; any remaining imports must be
  non-mutable typedef/helper usage or removed.
- Automated: run all affected command, session, interactive, workflow, and tool tests.
- Automated: run `deno run ci` and fix every issue.
- Manual: start the TUI normally, submit a request, and confirm Router starts.
- Manual: confirm specialist handoff persists as the active Agent for follow-up messages.
- Manual: confirm `/new` resets the conversation and starts cleanly.
- Manual: confirm `/agent router` returns to routing.
- Manual: confirm `/model` and thinking controls still update footer/state correctly.
- Manual: confirm `/resume` restores prior active Agent behavior and hydrates the UI.
- Manual: run a simple FEATURE planning flow through Plannotator and confirm approval/save/feedback behavior remains
  unchanged.
- Manual: run a small QUICK_FIX or OPERATION flow and confirm execution/validation state does not regress.
- Expected result: current TUI behavior is restored, Session Host owns session-scoped runtime state, and full CI passes
  without temporary skipped test debt.

## Edge Cases & Considerations

- This final slice is not complete if temporary skipped tests remain. Skipped tests may only remain if they predated
  this Epic or are unrelated and are explicitly documented.
- Be strict about avoiding global fallbacks. A successful full CI run is not enough if production code can still
  accidentally mutate process-global session state.
- Do not implement ACP, Takopi, Slack/Discord, or Workspace UI integration in this Epic. This slice only finishes the
  internal Session Host refactor.
- Keep manual verification focused on existing TUI behavior; no browser/frontend verification is required because
  Workspace UI is not in scope.
