---
planId: "4c6482a6-ff82-497f-b345-1ba9ab2a4e68"
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/workflow/validation-supervisor.ts"
    - "src/shared/session/agent-switching.js"
    - "src/cmd/load-plan/index.ts"
    - "src/cmd/load-plan/index.integration.test.ts"
    - "src/shared/workflow/validation-tool-continuation.integration.test.ts"
    - "docs/prd/runwield-core-prd.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-09-08T10:26:23-04:00"
status: "ready_for_work"
origin: "internal"
userVerifiedAt: null
routingIntent: "PLANNED_CHANGE"
---

# Fix Published Plan Session Context

## Context

After Workflow Validation publishes a Plan to its target branch, publication cleanup can delete the execution worktree
while the root Agent Session still uses that worktree as its working directory. The validation supervisor clears
`activeExecutionWorkflow`, but that only clears workflow ownership; it does not rebuild the root Agent Session or its
tools. A later `/load-plan` restore can also select Planner again.

The result is a completed Session whose next Agent cannot run shell commands because its working directory no longer
exists. The expected follow-up state for a normal published Plan is the selectable Engineer in the primary checkout. A
child Plan with an active parent Epic continuation must still continue that Epic after RunWield leaves the deleted
worktree context.

## Objective

After a Plan is successfully published and verified, move its root Agent Session to the primary checkout and select
Engineer before accepting follow-up messages. Do not change paused, failed, or still-recoverable Plan execution
behavior.

## Approach

Use the existing successful publication result as the handoff boundary. Rebuild the root Agent Session through the
existing `switchActiveAgent` transaction, with an explicit primary-checkout working directory and `engineer` as the
runtime Agent. Then clear the completed execution workflow. Make `/load-plan` retain this post-publication handoff
instead of applying its earlier Planner restore policy.

```text
Workflow Validation returns verified
  → resolve primary checkout from execution context
  → rebuild root Agent Session as Engineer with primary-checkout cwd
  → clear completed execution workflow
  → preserve parent Epic continuation when present
  → accept follow-up message
```

Today, clearing the workflow leaves the root and its tools unchanged. After this change, successful publication changes
both Agent identity and tool working directory. Paused or failed validation does neither.

Reuse the current Session and Agent-switch transaction rather than recreating the deleted worktree or asking the user to
start a new Session. A replacement Session would add another continuity boundary and would not address every validation
entry point.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/workflow/validation-supervisor.ts` — make terminal verified publication perform the shared root-Agent
  handoff; keep nonterminal validation on the execution worktree.
- `src/shared/session/agent-switching.js` — use the explicit handoff working directory consistently when rebuilding the
  root and resolving project Agent settings.
- `src/cmd/load-plan/index.ts` and its small execution helpers if needed — carry the actual verified result far enough
  to prevent the command’s final restore from switching Engineer back to Planner. Do not infer success from Plan status
  alone.
- `src/cmd/load-plan/index.integration.test.ts` — cover the user-reported `/load-plan` path, including deleted-worktree
  cleanup and the final restore boundary.
- `src/shared/workflow/validation-tool-continuation.integration.test.ts` or the nearest validation-supervisor
  integration test — cover successful and nonterminal handoff behavior through the shared validation boundary.
- `docs/prd/runwield-core-prd.md` — record the lasting Core behavior: completed Plan follow-ups use Engineer from the
  primary checkout, subject to active parent Epic continuation.

No domain-language update is expected. `Session`, `Agent Session`, `Engineer`, `Plan`, `Workflow Validation`, and
`execution worktree` already have canonical meanings in `docs/domain-language.md`.

## Reuse Opportunities

- `src/shared/session/agent-switching.js` — reuse `switchActiveAgent` and its explicit `cwd` support so root replacement
  remains one Agent/root/handler transaction.
- `src/shared/primary-checkout.ts` — reuse `resolvePrimaryCheckoutRoot`; do not derive the checkout by trimming worktree
  paths.
- `src/shared/workflow/validation-supervisor.ts` — reuse the terminal `result.kind === "verified"` boundary. This result
  follows confirmed publication, unlike Plan status inspection.
- `src/shared/workflow/epic-continuation.ts` and `SessionRuntime.#continueEpicAfterValidation` — preserve the existing
  parent Epic continuation after the safe checkout handoff.
- `src/cmd/testing/runtime-command-fixture.ts` and existing Git worktree fixtures — use real Git and real Session
  switching in the regression test; do not add a RunWield-owned dependency seam.

## Implementation Steps

- A deterministic regression test reproduces the reported failure before the fix: a Plan root runs from an execution
  worktree, successful publication to `main` removes that worktree, and the next follow-up currently resolves to Planner
  or a missing working directory.
- Terminal verified Plan publication rebuilds the root Agent Session with `agentName: "engineer"` and the absolute
  primary-checkout path. The root’s file and shell tools no longer retain the execution-worktree path.
- The completed `activeExecutionWorkflow` is cleared only for terminal verified publication. Paused, failed, repair,
  publication-conflict, and user-action outcomes retain their execution Agent and recoverable worktree context.
- Agent switching treats an explicit `cwd` as the project context for both root construction and project Agent/model
  settings. A same-Agent handoff with a changed `cwd` still rebuilds the root instead of reusing stale tools.
- `/load-plan` uses the actual validation result to preserve the post-publication Engineer handoff. Its final restore
  does not switch the Session back to Planner after verified publication, but View, Cancel, review-only, failed, and
  paused paths keep their existing restore behavior.
- A child Plan first leaves the deleted execution-worktree context after publication; if RunWield has an active parent
  Epic continuation, the existing continuation then selects its required Agent instead of being overridden by the
  generic Engineer follow-up.
- `docs/prd/runwield-core-prd.md` states the completed-Plan follow-up rule and the parent Epic exception using the same
  behavior implemented in code.

## Approval Confirmation

No Work Record supersession is proposed.

## Verification Plan

- Automated red/green regression: run
  `deno run -A scripts/run-tests.js src/cmd/load-plan/index.integration.test.ts src/shared/workflow/validation-tool-continuation.integration.test.ts src/shared/session/agent-switching.test.js`.
- The publication regression must use a real Git repository and worktree. It must prove all of these after publication
  to `main`: the execution worktree no longer exists, `activeExecutionWorkflow` is null, the root Agent is `engineer`,
  the root Agent Session working directory is the primary checkout, and a real next Agent tool invocation can access a
  marker in that checkout. This test must fail if the implementation only clears workflow state, changes a displayed
  Agent label, or leaves tools bound to the deleted path.
- Add or retain a nonterminal regression that proves paused or failed validation leaves the Plan execution Agent and
  execution-worktree working directory available for repair.
- Add or retain an Epic-child regression that proves parent Epic continuation still runs after the root has left the
  removed child worktree.
- Run `deno task seams:check` to confirm the fix adds no injection seam for Session switching, publication, registry
  writes, or worktree cleanup.
- Run `deno task test` after the focused tests pass.
- Manual: publish a test Plan to `main`, confirm cleanup removes its execution worktree, then send a follow-up that asks
  Engineer to run `pwd` and `git branch --show-current`. The commands must run from the primary checkout on `main`; the
  response must come from Engineer, not Planner or Plan Engineer.
- Existing behavior that remains protected: execution and validation run in the isolated worktree until publication is
  verified; failed publication retains recovery evidence; no Agent handoff claims publication before Git verification;
  active parent Epic continuation still proceeds.
- Behavior that must stop existing: terminal publication must not leave Planner or Plan Engineer active for ordinary
  follow-ups, and no root tool may remain pinned to a removed execution worktree.

## Edge Cases & Considerations

- Remote Direct Delivery can leave the primary checkout’s local `main` behind the published remote. The handoff changes
  the working directory only; it must not pull, reset, merge, or dirty the user’s checkout.
- Publication cleanup can report retained Git artifacts even after publication is verified. The root still moves to the
  primary checkout; cleanup notices and retry evidence remain authoritative.
- Frontend-owned Plan execution also ends with the selectable Engineer for ordinary post-publication follow-ups, as
  requested. It does not remain Frontend Engineer merely because that Agent executed the Plan.
- The handoff must use the primary checkout resolver because the execution worktree can already be absent when the
  transition runs.
- The current working tree contains unrelated edits. They do not overlap this Plan file; implementation must preserve
  them and must not fold them into this fix.
