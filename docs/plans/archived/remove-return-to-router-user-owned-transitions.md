---
planId: "60baefb7-082f-4e80-85a4-5c502c2a4a13"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
summary: "Remove the return_to_router tool and all autonomous agent-initiated control switching; agents state limits and offer options in conversation, the user owns every transition, and an explicit /agent during active execution deterministically ends the workflow's ownership of the conversation."
affectedPaths:
    - "src/tools/return-to-router.ts"
    - "src/tools/registry.js"
    - "src/tools/delegate-agent.ts"
    - "src/shared/types.js"
    - "src/shared/session/session.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/agent-handler.ts"
    - "src/shared/session/agent-switching.js"
    - "src/shared/session/types.js"
    - "src/shared/session/managed-operation.ts"
    - "src/shared/session/agents.js"
    - "src/shared/session/backends/claude-cli/mcp-bridge.ts"
    - "src/shared/workflow/workflow-results.js"
    - "src/shared/workflow/orchestrator.ts"
    - "src/shared/workflow/metrics.js"
    - "src/shared/workflow/validation-helpers.ts"
    - "src/shared/workflow/validation-session-adapter.ts"
    - "src/cmd/agents/index.ts"
    - "src/cmd/load-plan"
    - "src/cmd/plans/pull.ts"
    - "src/ui/tui/runtime-adapter.js"
    - "src/agent-definitions"
    - "src/prompt-templates/code-optimizer.md"
    - "scripts/run-router-golden-set.js"
    - "docs/domain-language.md"
    - "docs/sessions.md"
    - "docs/architecture.md"
objectiveChecks:
    - id: "OC1"
      command: "! grep -rq \"return_to_router\" src/ scripts/"
      rationale: "The tool name appears throughout production code, prompts, tests, and a golden-set runner today. It can only disappear when the tool and every live reference are removed."
    - id: "OC2"
      command: "! grep -rqE \"ReturnToRouter|returnToRouter|toRouterHandoff|HANDOFF_LIMIT_MESSAGE|MAX_CHAINED_HANDOFFS|AgentTurnHandoffResult|handoffLimitReached|allowReturnToRouter\" src/ scripts/"
      rationale: "Catches the typed outcome, session option, chained-turn loop, and result-contract machinery that could survive removal of only the snake-case tool name."
    - id: "OC3"
      command: "! grep -q \"return_to_router\" docs/domain-language.md docs/sessions.md docs/architecture.md"
      rationale: "The current glossary, session guide, and architecture reference document the tool; this only goes green when current project language and runtime documentation match the user-owned transition model."
    - id: "OC4"
      command: "! grep -rq \"AGENTS.ROUTER\" src/tools/"
      rationale: "The removed tool is currently the only Custom Tool that targets Router. This catches a superficial tool rename that keeps the same Agent-initiated Router transition."
    - id: "OC5"
      command: "deno eval 'const s=await Deno.readTextFile(\"src/shared/session/session-runtime.js\");const a=s.indexOf(\"async promptSession(\");const b=s.indexOf(\"\\n}\\n\\n/**\\n * Compose a SessionRuntime\",a);if(a<0||b<0)Deno.exit(2);const p=s.slice(a,b);if((p.match(/await handler\\(/g)||[]).length!==1||p.includes(\"#activateSessionAgent(\"))Deno.exit(1)'"
      rationale: "The current prompt loop calls the handler and then activates another Agent from its result. This only passes when one user message invokes one handler and promptSession has no post-result Agent activation path."
    - id: "OC6"
      command: "grep -q 'releaseActiveWorkflow: true' src/cmd/agents/index.ts && deno run -A scripts/run-tests.js src/shared/session/session-runtime.test.js --filter 'user-authorized agent switch releases active workflows'"
      rationale: "Requires the explicit /agent release signal and a focused Runtime test of release behavior; the source marker and test do not exist today."
    - id: "OC7"
      command: "grep -q 'sequential QUICK_FIX completions each run Mechanical Validation' src/shared/session/agent-handler.test.ts && deno run -A scripts/run-tests.js src/shared/session/agent-handler.test.ts --filter 'sequential QUICK_FIX completions each run Mechanical Validation'"
      rationale: "Requires a behavioral regression test proving a second completion in one QUICK_FIX Session receives a second Mechanical Validation; that behavior and test are absent today."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-15T13:03:40-0400"
status: "verified"
origin: "internal"
implementedAt: "2026-08-17T17:53:45.473Z"
verifiedAt: "2026-08-17T22:54:42.632Z"
userVerifiedAt: null
executionReport: "- Merged `main` into the execution worktree before implementation; used a temporary Plan-file stash to get past merge blocking, resolved the Plan metadata conflict by keeping the active execution metadata, then dropped the stash.\n- Removed the `return_to_router` tool, registry entry, auto-wiring, MCP lifecycle special-case, metrics mapping, TUI presentation path, workflow-result helpers, AgentHandler handoff result, SessionRuntime chained-turn loop, and handoff counters/result fields.\n- Rewrote Agent prompts, shared QUICK_FIX/Plan execution practice, attention nudges, code-optimizer prompt, and current docs so Agents state concrete limits and offer user-owned `/agent` options instead of switching control.\n- Added explicit user-owned workflow release: `/agent` passes `releaseActiveWorkflow: true`; `switchActiveAgent` releases only after successful Agent commit, keeps `workflowContext`, emits planned/QUICK_FIX notices, releases same-Agent user switches, and preserves workflow on failed activation/internal switches.\n- Implemented QUICK_FIX continuity: after each no-plan Mechanical Validation, the Engineer QUICK_FIX workflow is re-armed with a fresh attempt timestamp and no stale completion receipt, so later `task_completed` calls validate again.\n- Added/updated tests for absent bundled tool lists, one-turn prompt results, user-authorized release, failed/same-Agent/internal switch behavior, QUICK_FIX re-arm, prompt contract text, and removed-tool absence.\n- Test-count delta across changed test files: 232 → 226 (`-6`). Rewritten: Guide tool-policy test now checks read-only tools without the removed tool; effective-tool filtering test now checks no removed-tool special case; same-Agent root-policy test now checks explicit `forceRebuild`; validation prompt escape-hatch test now checks removed-tool absence by constructed name. Deleted because the behavior no longer exists: return-tool definition/execute/metric/outcome tests (5), build/read handoff helpers (2), session-runtime chained router handoff (1), OPERATION router handoff (1), Claude CLI return handoff/lifecycle gating (2), TUI handoff-reason folding (1), and tool-title switch-mode mapping (1).\n- Fixed one merged-main golden race while verifying: slash-command share now waits for the suggestion and sends the confirming Enter before asserting the GitHub CLI unavailable message.\n- Verification passed: objective greps and OC5/OC6/OC7 checks passed; targeted suite passed (`session-runtime`, `agent-switching`, `agent-handler`, `task-completion-session`, `session-tools-policy`, `workflow-results`, `orchestrator`); focused OC6/OC7 filters passed; final `deno task ci` passed (`330 files passed | 0 failed`).\n- Manual TUI checklist from the Plan was not run as a live interactive human session; equivalent TUI behavior was covered by the golden tests included in `deno task ci`."
workRecord:
    status: "generated"
    recordId: "28a12a68-6f3b-4530-93ec-327fa6829b4a"
    path: "docs/work-records/2026-08-17-removed-return-to-router-and-made-agent-switches-user-owned.md"
    lastAttemptAt: "2026-08-17T22:56:21.590Z"
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-08-17T22:53:26.476Z"
validationCheckpoint: null
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "93e55d4e6032b34217fbaec6bba8c97d62706d0c"
    targetBranch: "main"
    targetHeadBeforeMerge: "9dca73933795e601e2adea0ae86e14cb2dce6366"
validationCiAttempts: 0
validationObjectiveCheckAttempts: 0
validationSemanticRounds: 0
updatedAt: "2026-08-19T19:36:04.786Z"
archivedAt: "2026-08-19T19:36:04.786Z"
archivedFromStatus: "verified"
archivedFromPath: "docs/plans/remove-return-to-router-user-owned-transitions.md"
---

# Remove return_to_router and Make Agent Transitions User-Owned

## Context

The user reports that `return_to_router` is broadly misaligned with their expectations: it wrestles control away from
the user, is misused by all models (frontier and open-source alike), loses conversational nuance by rewriting the user's
request as an LLM-authored "first user message" to Router, adds a redundant triage turn, and frequently harms more than
it helps. This is the third iteration of agent-initiated switching (`switch_agent` → `return_to_router`), and the
conclusion from the ideation session is that **any** autonomous control switch is the wrong experience.

Decisions settled in the planning conversation (see project Memory 7725):

1. **Remove `return_to_router` entirely.** Do not rename it or replace it with another autonomous switching tool.
2. **Agents never initiate a control switch.** When an Agent hits a genuine capability limit (missing tools) or believes
   work is out of its role, it explains the concrete limit in natural conversation and offers plain options — e.g. "you
   can switch with `/agent planner`, or say continue and I'll go back to the original request." No forced yes/no
   question, no `user_interview` form for rerouting, no ending the turn via a tool.
3. **Warn once, then comply.** Scope guidance is advice. If the user says continue, the Agent continues. This applies
   especially to QUICK_FIX: the Engineer's work boundary is elastic; when work grows feature-sized, the Engineer voices
   one concern (recommend Planner / a new session, note there will be no Plan-based semantic review), and if the user
   continues anyway, the Engineer does the work. Each `task_completed` still triggers Mechanical Validation, which is
   the accepted quality gate; the user may continue issuing work in the same QUICK_FIX session indefinitely.
4. **Router is entry and explicit reassessment only.** Router activates for new-session triage, `/agent router`, or an
   explicit user request to reassess. It never regains control because another Agent decided scope changed.
5. **Active workflows stay strict.** A workflow-owned execution Agent does not deviate from the current workflow step on
   its own. Normal workflow progression (plan approval → execution → validation → repair) remains automatic because the
   user chose that workflow.
6. **Explicit `/agent` during any active execution workflow releases the workflow.** This is a deliberate user
   transition — for example the user realizing a Plan is wrong and returning to Planner. RunWield (not any LLM) performs
   the deterministic bookkeeping. For planned work, the active execution workflow's claim on the conversation ends while
   Plan/worktree recovery evidence stays intact for `/load-plan`. For QUICK_FIX, the workflow claim ends and the current
   working-tree changes remain, but there is no Plan to resume. The persisted `workflowContext` remains as conversation
   and Plan context; it is a projection, not execution authority.

A follow-up plan (not this one) will split the selectable Quick Fix Engineer from a workflow-only Plan Engineer and
narrow Frontend Engineer to workflow-only planned browser-UI execution. This plan deliberately keeps the current Agent
roster and dispatch unchanged; it only removes autonomous switching and rewrites boundary behavior.

## Objective

After this change:

- No `return_to_router` tool exists anywhere in `src/` — no tool definition, registry entry, session wiring, runtime
  handoff consumption, orchestrator dispatch path, MCP bridge alias, metrics mapping, TUI presentation, or prompt
  reference.
- Every user-facing Agent prompt replaces its "call return_to_router" escalation with conversational limit-stating +
  option-offering + warn-once-then-comply guidance.
- An explicit manual agent switch (`/agent <name>` or an equivalent consumer call marked as user-authorized) while an
  active execution workflow exists deterministically clears that workflow's ownership of the conversation with a
  user-visible notice. Planned work keeps all Plan/worktree recovery evidence; QUICK_FIX keeps working-tree edits but
  has no resumable Plan.
- The only root-agent transition entry points are session boot, deterministic workflow progression (triage outcomes,
  Plan execution, validation continuations), and an explicit user-authorized `switchAgent` request. No Custom Tool
  result can change the root Agent.
- A QUICK_FIX Engineer can complete more than one task in the same Session. Each accepted `task_completed` still runs a
  fresh Mechanical Validation; the first completion must not silently disable validation for later work.

## Approach

Work in five passes so the tree compiles at every stage:

1. **Runtime removal** — delete the tool and unwire session/runtime/orchestrator/bridge consumption. The `AgentHandler`
   handoff result kind and `SessionRuntime` chained-turn loop are removed. The obsolete result fields (`handoffs`,
   `handoffLimitReached`), chained-handoff constants, and `allowReturnToRouter` option go with them; one submitted user
   message now produces one root Agent turn, while deterministic workflow progression remains inside the handler.
2. **Prompt rewrite** — remove the tool from every agent definition's `tools:` list and rewrite each "Requests Outside
   Your Scope" (and equivalent) section to the conversational contract. Rewrite the shared-practice fragments
   (`bounded-request.md` for QUICK_FIX elasticity, `plan-execution.md` for in-workflow behavior).
3. **User-authorized `/agent` releases the workflow** — add an explicit `releaseActiveWorkflow: true` option to the
   Runtime's `switchAgent` request and pass it only from `/agent` (or an equivalent user-owned consumer). In the same
   managed Runtime transaction, stage and commit the requested Agent first; only after that succeeds, clear
   `activeExecutionWorkflow`, emit the appropriate planned-work or QUICK_FIX notice, and retain `workflowContext`.
   Internal workflow restores keep the default (`false`) and cannot release workflow ownership accidentally. A switch to
   the already-active Agent still releases when the user explicitly requested it.
4. **QUICK_FIX continuity** — after each no-plan Mechanical Validation, keep or re-arm the Engineer's QUICK_FIX
   ownership so another accepted `task_completed` in the same Session runs a fresh validation. Explicit `/agent` remains
   the deterministic way to release it.
5. **Docs and glossary** — update `docs/domain-language.md`, `docs/sessions.md`, and `docs/architecture.md` so current
   documentation describes the implemented truth (no Return-to-Router Tool, no chained Agent turn, redefined Scope
   Escalation, and explicit user-owned workflow release).

The switch order is deliberate:

```text
/agent planner
  validate requested Agent
  switchAgent(releaseActiveWorkflow: true)
    stage and commit Planner root
    clear activeExecutionWorkflow
    keep workflowContext
    emit release notice
```

A failed Agent activation stops before the clear. Internal workflow calls omit the release option.

The set-aside option was to clear every workflow from every `switchAgent` call. That would make internal `/load-plan`,
validation, auth, and prompt-template Agent restores destroy their own workflow, so the release signal must be explicit.

## Files to Modify

### Runtime removal

- `src/tools/return-to-router.ts` — **delete** (tool definition, `executeReturnToRouter`, metric emission).
- `src/tools/__tests__/return-to-router.test.ts` — **delete**.
- `src/tools/registry.js` — remove `"return_to_router"` from the tool name registry.
- `src/tools/delegate-agent.ts`, `src/shared/session/managed-operation.ts`, and `scripts/run-router-golden-set.js` —
  remove the obsolete `allowReturnToRouter` option from delegated, managed, and golden-runner session option shapes and
  calls.
- `src/tools/__tests__/delegate-agent.test.js` — remove `"return_to_router"` from the delegated-session exclusion
  expectations (the name no longer exists to exclude).
- `src/shared/session/session.js` — remove the `allowReturnToRouter` option and its filter in
  `resolveEffectiveSessionToolNames` (~line 208), and both auto-wiring sites that close over the hosted session (~lines
  1739, 2067).
- `src/shared/session/__tests__/session-tools-policy.test.js` — remove the filter/auto-wire tests; update the Guide
  tool-policy test to no longer expect `return_to_router`.
- `src/shared/session/session-runtime.js`, `src/shared/types.js`, and `src/shared/session/types.js` — remove
  `HANDOFF_LIMIT_MESSAGE`, `MAX_CHAINED_HANDOFFS`, the router-handoff consumption loop, the `AgentTurnHandoffResult`
  variant, and the `handoffs` / `handoffLimitReached` prompt-result fields. `promptSession` runs exactly one root Agent
  handler for each submitted user message.
- `src/shared/session/agent-handler.ts` — remove the interactive-path handoff producer (scanning for the outcome and
  returning a router-handoff result kind); its typed result is completion-only. Preserve deterministic workflow
  progression that the handler performs after `triage_report`, `plan_written`, and `task_completed`.
- `src/shared/workflow/workflow-results.js` — remove `readLatestReturnToRouterOutcome` and `buildReturnToRouterPrompt`
  (and the `ReturnToRouterOutcome` typedef).
- `src/shared/workflow/workflow-results.test.ts` — remove their tests.
- `src/shared/workflow/orchestrator.ts` — remove the `toRouterHandoff` consumption in `dispatchPostTriage` paths.
- `src/shared/workflow/orchestrator.test.ts` — remove/update the operation-handoff test (~line 230).
- `src/shared/workflow/metrics.js` — remove the `return_to_router` tool→event mapping (~line 368).
- `src/shared/workflow/planning-agent.ts`, `engineer-runner.ts`, `workflow-slicer.ts`, `validation-helpers.ts`,
  `validation-session-adapter.ts`, and `validation-prompts.ts` — remove `allowReturnToRouter: false` plumbing and stale
  comments; workflow isolation continues through existing bounded tool lists and Agent definitions, without a
  tool-specific gate.
- `src/cmd/load-plan/plan-session-types.ts`, `plan-session-surface.ts`, and `plan-recovery-actions.ts`, plus
  `src/cmd/plans/pull.ts` — remove the obsolete option while preserving their internal workflow Agent restores.
- `src/shared/session/backends/claude-cli/mcp-bridge.ts` — `isLifecycleTool` no longer special-cases `return_to_router`
  (~line 79).
- `src/shared/session/backends/claude-cli/mcp-bridge.test.ts` — remove alias/gating tests for it.
- `src/shared/session/claude-cli-execution.test.ts` — remove the bridged `return_to_router` handoff test and the
  toolNames expectation (~lines 193, 487–507).
- `src/shared/session/tool-event-title.js` + `tool-event-title.test.js` — remove the `switch_mode` mapping for it.
- `src/ui/tui/runtime-adapter.js` + `runtime-adapter.test.js` — remove the fold-reason-into-tool-block presentation
  (~line 229) and its test (~line 521).
- `src/constants.js` — update the `SUBAGENTS` doc comment that mentions "`return_to_router` targets" (~line 334).
- `src/shared/session/session-runtime.test.js` and `src/shared/session/managed-operation-boundary.test.ts` — remove the
  router chained-turn tests and update prompt-result expectations to the one-turn, no-handoff result contract.

### Prompt rewrite

- `src/agent-definitions/operator.md`, `guide.md`, `ideator.md`, `planner.md`, `architect.md`, `engineer.md`,
  `frontend-engineer.md`, `tester.md` — remove `return_to_router` from `tools:`; rewrite each scope-boundary section to
  the conversational contract. A capability limit must not become a false promise: Agents with no edit or execution
  tools offer `/agent <name>`, an in-role alternative, or a return to the prior request. Warn-once-then-comply applies
  when the concern is advisory and the Agent has the required capability, not when a real tool limit makes the request
  impossible and not while an approved Plan workflow still owns the conversation.
- `src/agent-definitions/shared-practice/bounded-request.md` — rewrite the QUICK_FIX escalation fence into the elastic
  boundary contract: warn once when the work has grown planning-sized, name the concrete consequence (no Plan, no
  Plan-based semantic review; Mechanical Validation on each `task_completed` is the only gate), then comply if the user
  continues; repeated `task_completed` calls in one session are normal and each gets fresh Mechanical Validation.
- `src/agent-definitions/shared-practice/plan-execution.md` — replace the escalation instruction: a workflow-owned Agent
  never abandons the current workflow step; out-of-Plan requests get a conversational explanation and options
  (continue/finish the Plan, or `/agent <name>` to release it deliberately). The Agent does not perform the unrelated
  request while the workflow remains active, ask a routing form, or end the turn through a tool.
- `src/agent-definitions/router.md` — remove any expectation of receiving agent handoffs; Router's contract is
  new-session triage, `/agent router`, and explicit reassessment requests.
- `src/prompt-templates/code-optimizer.md` — replace the `return_to_router` instruction with the conversational
  limit-stating guidance.
- `src/shared/session/agents.js` — update attention nudges that reference `return_to_router` (Ideator, ~line 35; check
  Guide's "return to Router" phrasing, ~line 33).
- `src/shared/session/session-prompt.test.js` — update the nudge assertion (~line 282).
- `src/shared/session/agents-shared-practice.test.ts` — update the assertion expecting "stop and
  call\n`return_to_router` for fresh triage" (~line 217) to assert the new warn-once contract text instead.
- `src/shared/workflow/validation-prompts.test.js` — keep the invariant test but it now trivially holds; simplify its
  comment (the tool no longer exists anywhere, so isolated-session filtering rationale is gone).

### User-owned release and QUICK_FIX continuity

- `src/cmd/agents/index.ts` — mark the `/agent` Runtime request with `releaseActiveWorkflow: true`; automatic Agent
  changes from auth, prompt templates, `/load-plan`, Plan pull, Sleep, Triage, execution, and validation do not set it.
- `src/shared/session/session-runtime.js` (`switchAgent`) and `src/shared/session/agent-switching.js` — commit the Agent
  switch before releasing workflow state, clear only `activeExecutionWorkflow` / pending completion state, retain
  `workflowContext`, and emit a `SYSTEM_STATUS` notice. Planned notices name the Plan and `/load-plan`; QUICK_FIX
  notices state that no Plan exists and working-tree edits remain. Failed/invalid switches preserve the old Agent and
  workflow.
- `src/shared/session/agent-handler.ts` — after each QUICK_FIX `task_completed`, consume that receipt once, finish its
  Mechanical Validation, then re-arm a fresh Engineer-owned QUICK_FIX workflow from the same triage/project/cwd data
  with a new attempt timestamp and no stale completion state. This makes the next completion independently valid;
  explicit user-owned Agent switching is the release boundary. Note that `src/shared/workflow/validation-supervisor.ts`
  now short-circuits to `settled_completion` when the stored checkpoint's `lastSettledOperationId` equals the incoming
  `taskCompletionId`, so a second completion must arrive with a distinct completion id and a checkpoint that no longer
  claims the first one as settled.
- `src/shared/session/agent-switching.test.js`, `src/shared/session/session-runtime.test.js`, and focused QUICK_FIX
  handler tests — cover atomic release, internal-switch preservation, same-Agent release, and repeated validation.

### Docs and glossary

- `docs/domain-language.md` — remove the **Return-to-Router Tool** entry; redefine **Scope Escalation** (currently
  "returns work to the Router for fresh Triage") to describe the conversational contract: an Agent states a concrete
  capability or role limit and offers the user explicit options; only the user transitions control. Update the stable
  relationships list accordingly.
- `docs/sessions.md` — remove `return_to_router` from the Agent-activation paths and document `/agent` as the explicit
  user-owned release from active execution.
- `docs/architecture.md` — remove the chained-handoff loop, per-invocation tool filter, and Return-to-Router sequence
  from the current Session Runtime description; distinguish retained `workflowContext` projection from released
  `activeExecutionWorkflow` authority.

## Reuse Opportunities

- `src/shared/session/session-runtime.js::switchAgent` — the existing atomic, Runtime-owned agent transition; the
  workflow-breaking behavior extends this path rather than adding a new transition mechanism.
- The active-workflow invariant already permits clearing on "a deliberate fresh routing transition with an explicit new
  owner" — user-initiated `switchAgent` is exactly that; no new lifecycle machinery is needed.
- `/load-plan` recovery and the worktree registry already own Plan recoverability; the workflow-breaking switch must
  simply not touch them.
- Existing prompt shared-practice composition (`sharedPractice:` front matter) — the new conversational boundary
  contract should live once in shared practice where multiple agents need identical wording.

## Implementation Steps

- [ ] `src/tools/return-to-router.ts` and `src/tools/__tests__/return-to-router.test.ts` do not exist; `src/` and
      `scripts/` contain no occurrence of `return_to_router`, `ReturnToRouter`, `returnToRouter`, `toRouterHandoff`,
      `allowReturnToRouter`, `HANDOFF_LIMIT_MESSAGE`, `MAX_CHAINED_HANDOFFS`, `AgentTurnHandoffResult`, or
      `handoffLimitReached`; `deno task check` passes.
- [ ] `resolveEffectiveSessionToolNames` in `src/shared/session/session.js` has no options parameter behavior for router
      handoffs, and `buildAgentSession` wires no hosted-session-closing handoff tool; the corresponding tests in
      `session-tools-policy.test.js` assert the tool name is absent from every loaded bundled agent definition's
      effective tool list.
- [ ] The `AgentHandler` result in `src/shared/session/agent-handler.ts` is completion-only, and `SessionRuntime` runs
      one root handler per submitted user message. `SessionPromptResult` has no handoff counters. No Custom Tool result
      can request a second root turn or change the root Agent; tests inject a synthetic switch-requesting tool-result
      message and prove the active Agent and submitted-message count do not change. Triage, Plan approval, Task
      Completion, and validation still advance through their existing deterministic handler calls.
- [ ] The composed prompts for `operator`, `guide`, `ideator`, `planner`, `architect`, `engineer`, `frontend-engineer`,
      and `tester` omit `return_to_router` and give one coherent boundary contract: state the concrete role or tool
      limit, offer natural options (a suitable `/agent <name>`, an in-role alternative, or return to the prior request),
      and never use a routing tool, `user_interview`, or forced yes/no form to change control. Tests distinguish
      advisory concerns (warn once, then comply when capable) from real missing capabilities and the active-Plan
      exception (do not promise impossible work or silently broaden an active Plan).
- [ ] `src/agent-definitions/shared-practice/bounded-request.md` defines the elastic QUICK_FIX boundary: one concern
      when work becomes planning-sized, naming the concrete consequence (no Plan-based semantic review; Mechanical
      Validation per `task_completed` is the only gate); user continuation is honored; multiple sequential
      `task_completed` completions in one QUICK_FIX session are explicitly normal. The escalation fence instructing a
      stop-and-reroute no longer exists.
- [ ] `src/agent-definitions/shared-practice/plan-execution.md` instructs workflow-owned execution Agents to stay on the
      current workflow step and answer out-of-Plan requests with two user-owned options: continue/finish the Plan, or
      explicitly leave it with `/agent <name>`. It does not perform unrelated work before release, initiate a switch,
      ask a routing form, or end the turn through a tool.
- [ ] `SessionRuntime.switchAgent(..., { releaseActiveWorkflow: true })` commits the requested Agent before it clears
      `activeExecutionWorkflow`; `/agent` always sets this option, including a switch to the already-active Agent. The
      release retains persisted `workflowContext`. For a planned workflow, the notice names the Plan and `/load-plan`,
      and the primary Plan Front Matter plus `.wld/worktrees.json` entry remain byte-identical. For QUICK_FIX, the
      notice says there is no resumable Plan and working-tree edits remain. If Agent activation fails, the Agent and
      workflow both remain unchanged. Internal Agent restores omit the option and preserve the workflow. Tests cover all
      cases, including `/load-plan` successfully resuming the released planned work.
- [ ] After one QUICK_FIX completion and Mechanical Validation, a later Engineer task in the same Session can emit a new
      `task_completed` and trigger a second, fresh Mechanical Validation. The completion receipts are consumed once, no
      Plan lifecycle or semantic review starts, and explicit `/agent` release prevents later input from being forced
      back to Engineer.
- [ ] `src/shared/session/agents.js` attention nudges, `src/shared/workflow/metrics.js` and validation prompt comments,
      `src/shared/session/tool-event-title.js`, `src/ui/tui/runtime-adapter.js`, and the Claude CLI MCP bridge contain
      no reference to the removed tool; the bridged Claude CLI tool list no longer includes it.
- [ ] `docs/domain-language.md` has no **Return-to-Router Tool** entry; **Scope Escalation** is redefined as the
      conversational limit-and-options contract with the user as the only transition authority; the stable relationships
      section no longer states that Scope Escalation returns work to Router. `docs/sessions.md` and
      `docs/architecture.md` contain no live `return_to_router` path and describe explicit user release, one root turn
      per submitted message, retained workflow context, and deterministic workflow progression accurately.
- [ ] `deno task ci` passes on the completed tree.

## Approval Confirmation

No Work Record supersession is proposed, so no supersession confirmation is required.

## Verification Plan

- Automated: `deno task ci` (type-check, lint, language policy, seams:check, doc-links, full test suite via the
  sandboxed runner). Targeted suites during development:
  `deno run -A scripts/run-tests.js src/shared/session/session-runtime.test.js src/shared/session/agent-switching.test.js src/shared/session/agent-handler.test.ts src/shared/session/task-completion-session.test.ts src/shared/session/__tests__/session-tools-policy.test.js src/shared/workflow/workflow-results.test.ts src/shared/workflow/orchestrator.test.ts`.
- Manual: in a TUI session, (1) ask Guide for a code change — it must explain the limit and offer `/agent` options
  without switching or ending its turn via a tool; (2) run a QUICK_FIX, expand it feature-sized, observe one concern,
  say "continue", observe compliance and Mechanical Validation on `task_completed`; (3) approve and run a small Plan,
  then `/agent planner` mid-execution — observe the workflow-released notice and retained Plan footer context, then
  `/load-plan` and confirm the Plan and worktree resume; (4) complete two sequential tasks in one QUICK_FIX Engineer
  Session and observe a separate Mechanical Validation after each `task_completed`; (5) `/agent guide` during a
  QUICK_FIX and confirm the release notice states that no Plan exists and the next message stays with Guide.
- Behavior that must remain protected by existing tests after this reshape: atomic `switchAgent` transitions
  (staged-handler construction, failure preserves the previous pair), workflow dispatch via `triage_report` /
  `plan_written` / `task_completed` outcomes, Keep-Engineer-active-after-interruption semantics, and QUICK_FIX
  Mechanical Validation per accepted completion. Behavior that is expected to stop existing (tests deleted, not
  rewritten): router-handoff consumption, multi-root-turn chaining from one user message, handoff counters/limits,
  `buildReturnToRouterPrompt` framing, bridged lifecycle gating for the removed tool, and TUI handoff-reason folding.
- Glossary check: `docs/domain-language.md` describes only implemented behavior; the redefined Scope Escalation matches
  the shipped prompts.

## Edge Cases & Considerations

- **Persisted sessions containing historical `return_to_router` tool results**: hydration must tolerate old JSONL
  transcripts with those tool results as inert history (rendered as a plain completed tool block). No migration; only
  the live consumption paths are removed. Add/keep a hydration test with a legacy transcript if one does not exist;
  construct the historical name from parts so the live source tree does not retain the removed identifier.
- **Current architecture docs versus historical records**: update `docs/architecture.md`, but do not rewrite accepted
  ADRs, archived Plans, PRDs, or Work Records that truthfully describe the system at their publication time.
- **Custom/user-override Agent Definitions** in `~/.wld/agents` or `.wld/agents` may still list `return_to_router`.
  Treat it as any unavailable tool: session construction must omit unavailable names or report a clear configuration
  warning without restoring an alias or switch behavior. Cover the generic unknown-tool policy with a neutral fixture
  name so production code and live tests do not retain a compatibility reference to the removed tool.
- **Uncommitted work in `session-runtime.js`** (managed-hydration recovery, ~35 lines) is still in the working tree at
  the time of this revision. It sits in the managed-operation region, not in `promptSession` or `switchAgent`, so no
  design interaction is expected — but the execution worktree branches from the committed base, so publication will have
  to merge it. The Engineer should re-read every file rather than trusting the line numbers in this plan; the
  memory-tool unification and model-state work already shifted several of them.
- **Invariant alignment**: clearing the active workflow on user `/agent` is permitted by the recorded invariant
  ("deliberate fresh routing transition with an explicit new owner"). Do not clear on Agent stops, questions, errors,
  auth/model rebuilds, prompt-template activation, `/load-plan` restores, or deterministic workflow progression — only
  on a switch request explicitly marked to release it. `workflowContext` remains because it is persisted context and a
  useful Plan anchor, not live execution authority.
- **QUICK_FIX release**: a user can leave an indefinitely continuing QUICK_FIX only through the explicit release path.
  The release clears pending completion state so an old receipt cannot validate after the user has changed Agent.
- **`validation-prompts.test.js`** currently asserts isolated-session prompts never reference the tool; after removal
  this is trivially true everywhere. Keep a single repo-wide "no references" assertion or rely on the objective check;
  do not leave a misleading comment implying the tool still exists elsewhere.
- **Metrics**: the `routing/return_to_router` event disappears from new data. No consumer migration needed; metric files
  are append-only local records.
- **Follow-up plan (b)** — Engineer/Plan-Engineer split, workflow-only Frontend Engineer, Pair Execution for both — is
  intentionally out of scope here. Prompt rewrites in this plan should avoid wording that would contradict that split
  (e.g. do not newly entrench "Engineer executes Plans" language beyond what already exists).
