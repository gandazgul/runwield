---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
summary: "Remove the return_to_router tool and all autonomous agent-initiated control switching; agents state limits and offer options in conversation, the user owns every transition, and an explicit /agent during active Plan execution deterministically ends the workflow's ownership of the conversation."
affectedPaths:
    - "src/tools/return-to-router.ts"
    - "src/tools/registry.js"
    - "src/shared/session/session.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/agent-handler.ts"
    - "src/shared/session/agents.js"
    - "src/shared/workflow/workflow-results.js"
    - "src/shared/workflow/orchestrator.ts"
    - "src/shared/workflow/metrics.js"
    - "src/shared/session/backends/claude-cli/mcp-bridge.ts"
    - "src/ui/tui/runtime-adapter.js"
    - "src/agent-definitions"
    - "src/prompt-templates/code-optimizer.md"
    - "docs/domain-language.md"
    - "docs/sessions.md"
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-08-15T13:03:40-0400"
status: "draft"
objectiveChecks:
    - id: "OC1"
      command: "! grep -rq \"return_to_router\" src/"
      rationale: "The tool name appears throughout src/ today (tool, registry, runtime wiring, prompts, tests). It can only disappear entirely when the tool and every consumption path and prompt reference are removed."
    - id: "OC2"
      command: "! grep -rqE \"ReturnToRouter|toRouterHandoff|HANDOFF_LIMIT_MESSAGE|allowReturnToRouter\" src/"
      rationale: "Catches the runtime machinery symbols (outcome readers, orchestrator handoff, session tool gating, chained-handoff limit) that could survive a superficial tool rename while autonomous switching behavior remains."
    - id: "OC3"
      command: "! grep -q \"return_to_router\" docs/domain-language.md docs/sessions.md"
      rationale: "The glossary and session docs currently document the tool; this only goes green when the domain language and activation-path docs are updated to the user-owned transition model."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
updatedAt: "2026-08-15T17:40:56.739Z"
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
6. **Explicit `/agent` during an active Plan workflow breaks the workflow.** This is a deliberate user transition — for
   example the user realizing the Plan is wrong and returning to Planner. RunWield (not any LLM) performs the
   deterministic bookkeeping: the active execution workflow's claim on the conversation ends, while the Plan file,
   worktree, and registry state remain intact and recoverable through the normal `/load-plan` path.

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
- An explicit manual agent switch (`/agent <name>` or equivalent runtime consumer request) while an active execution
  workflow exists deterministically clears that workflow's ownership of the conversation with a user-visible notice,
  preserving all Plan/worktree recovery state.
- The only root-agent transition entry points are: session boot, workflow dispatch (triage outcomes, plan execution,
  validation continuations), and user-initiated `switchAgent`. No Custom Tool result can change the root Agent.

## Approach

Work in four passes so the tree compiles at every stage:

1. **Runtime removal** — delete the tool and unwire session/runtime/orchestrator/bridge consumption. The `AgentHandler`
   handoff result kind and `SessionRuntime` handoff loop for router handoffs are removed; the chained handoff limit
   machinery (`HANDOFF_LIMIT_MESSAGE`) goes with it.
2. **Prompt rewrite** — remove the tool from every agent definition's `tools:` list and rewrite each "Requests Outside
   Your Scope" (and equivalent) section to the conversational contract. Rewrite the shared-practice fragments
   (`bounded-request.md` for QUICK_FIX elasticity, `plan-execution.md` for in-workflow behavior).
3. **`/agent` breaks the workflow** — extend the existing `switchAgent` path in `SessionRuntime` so a user-initiated
   switch while `getActiveExecutionWorkflow()` is non-null clears the active workflow as a deliberate transition
   (permitted by the active-workflow invariant: "a deliberate fresh routing transition with an explicit new owner"),
   emits a concise notice, and leaves Plan front matter, worktree registry, and recovery descriptors untouched.
4. **Docs and glossary** — update `docs/domain-language.md` and `docs/sessions.md` so the glossary describes the
   implemented truth (no Return-to-Router Tool, redefined Scope Escalation).

## Files to Modify

### Runtime removal

- `src/tools/return-to-router.ts` — **delete** (tool definition, `executeReturnToRouter`, metric emission).
- `src/tools/__tests__/return-to-router.test.ts` — **delete**.
- `src/tools/registry.js` — remove `"return_to_router"` from the tool name registry.
- `src/tools/__tests__/delegate-agent.test.js` — remove `"return_to_router"` from the delegated-session exclusion
  expectations (the name no longer exists to exclude).
- `src/shared/session/session.js` — remove the `allowReturnToRouter` option and its filter in
  `resolveEffectiveSessionToolNames` (~line 212), and both auto-wiring sites that close over the hosted session (~lines
  1749, 2077).
- `src/shared/session/__tests__/session-tools-policy.test.js` — remove the filter/auto-wire tests; update the Guide
  tool-policy test to no longer expect `return_to_router`.
- `src/shared/session/session-runtime.js` — remove `HANDOFF_LIMIT_MESSAGE`, the router-handoff consumption loop that
  reads `return_to_router` outcomes between settled turns, and any handoff-count limiting tied to it.
- `src/shared/session/agent-handler.ts` — remove the interactive-path handoff producer (scanning for the outcome and
  returning a router-handoff result kind); the typed handler result union loses that variant.
- `src/shared/workflow/workflow-results.js` — remove `readLatestReturnToRouterOutcome` and `buildReturnToRouterPrompt`
  (and the `ReturnToRouterOutcome` typedef).
- `src/shared/workflow/workflow-results.test.ts` — remove their tests.
- `src/shared/workflow/orchestrator.ts` — remove the `toRouterHandoff` consumption in `dispatchPostTriage` paths.
- `src/shared/workflow/orchestrator.test.ts` — remove/update the operation-handoff test (~line 230).
- `src/shared/workflow/metrics.js` — remove the `return_to_router` tool→event mapping (~line 359).
- `src/shared/session/backends/claude-cli/mcp-bridge.ts` — `isLifecycleTool` no longer special-cases `return_to_router`
  (~line 79).
- `src/shared/session/backends/claude-cli/mcp-bridge.test.ts` — remove alias/gating tests for it.
- `src/shared/session/claude-cli-execution.test.ts` — remove the bridged `return_to_router` handoff test and the
  toolNames expectation (~lines 193, 487–507).
- `src/shared/session/tool-event-title.js` + `tool-event-title.test.js` — remove the `switch_mode` mapping for it.
- `src/ui/tui/runtime-adapter.js` + `runtime-adapter.test.js` — remove the fold-reason-into-tool-block presentation
  (~line 227) and its test (~line 521).
- `src/constants.js` — update the `SUBAGENTS` doc comment that mentions "`return_to_router` targets" (~line 334).
- `src/shared/session/session-runtime.test.js` — remove the "emits the return-to-router prompt before the handed-off
  Router turn" test (~line 1760) and any related handoff-limit tests.

### Prompt rewrite

- `src/agent-definitions/operator.md`, `guide.md`, `ideator.md`, `planner.md`, `architect.md`, `engineer.md`,
  `frontend-engineer.md`, `tester.md` — remove `return_to_router` from `tools:`; rewrite each scope-boundary section to
  the conversational contract (see Implementation Steps for the required content).
- `src/agent-definitions/shared-practice/bounded-request.md` — rewrite the QUICK_FIX escalation fence into the elastic
  boundary contract: warn once when the work has grown planning-sized, name the concrete consequence (no Plan, no
  Plan-based semantic review; Mechanical Validation on each `task_completed` is the only gate), then comply if the user
  continues; repeated `task_completed` calls in one session are normal and each gets fresh Mechanical Validation.
- `src/agent-definitions/shared-practice/plan-execution.md` — replace the escalation instruction: a workflow-owned Agent
  never abandons the current workflow step; out-of-Plan requests get a conversational explanation and options
  (finish/pause via user decision, `/agent <name>` to leave the workflow deliberately); no tool ends the turn.
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

### /agent breaks the workflow

- `src/shared/session/session-runtime.js` (`switchAgent`, ~line 3884) and `src/shared/session/agent-switching.js` —
  user-initiated switches with an active execution workflow deterministically clear the workflow claim (see steps).
  Note: these files were recently modified by a completed startup-session quick fix; rebase awareness only, no design
  interaction expected.
- `src/shared/session/agent-switching.test.js`, `src/shared/session/session-runtime.test.js` — new coverage.

### Docs and glossary

- `docs/domain-language.md` — remove the **Return-to-Router Tool** entry; redefine **Scope Escalation** (currently
  "returns work to the Router for fresh Triage") to describe the conversational contract: an Agent states a concrete
  capability or role limit and offers the user explicit options; only the user transitions control. Update the stable
  relationships list accordingly.
- `docs/sessions.md` — remove `return_to_router` from the list of Agent-activation paths (~line 58).

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

- [ ] `src/tools/return-to-router.ts` and `src/tools/__tests__/return-to-router.test.ts` do not exist; `src/` contains
      no occurrence of the strings `return_to_router`, `ReturnToRouter`, `returnToRouter`, `toRouterHandoff`,
      `allowReturnToRouter`, or `HANDOFF_LIMIT_MESSAGE`; `deno task check` (type-check) passes.
- [ ] `resolveEffectiveSessionToolNames` in `src/shared/session/session.js` has no options parameter behavior for router
      handoffs, and `buildAgentSession` wires no hosted-session-closing handoff tool; the corresponding tests in
      `session-tools-policy.test.js` assert the tool name is absent from every loaded bundled agent definition's
      effective tool list.
- [ ] The `AgentHandler` result union in `src/shared/session/agent-handler.ts` has no router-handoff variant, and
      `SessionRuntime` contains no code path that changes the root Agent in response to any Custom Tool result; root
      agent transitions occur only via session boot/hydration, workflow dispatch, and `switchAgent`. A test asserts that
      a tool-result message stream containing a synthetic agent-switch-requesting tool result produces no agent change.
- [ ] Every bundled agent definition (`operator.md`, `guide.md`, `ideator.md`, `planner.md`, `architect.md`,
      `engineer.md`, `frontend-engineer.md`, `tester.md`) omits `return_to_router` from `tools:` and contains a
      scope-boundary section with all three elements: (1) name the concrete limit ("I don't have tools to edit code in
      this mode"), (2) offer explicit options in plain conversation including `/agent <name>` and continuing the current
      work, (3) never end the turn with a routing tool, routing question form, or `user_interview` for rerouting. Each
      also carries the warn-once-then-comply rule: after one stated concern, a repeated user instruction is followed.
- [ ] `src/agent-definitions/shared-practice/bounded-request.md` defines the elastic QUICK_FIX boundary: one concern
      when work becomes planning-sized, naming the concrete consequence (no Plan-based semantic review; Mechanical
      Validation per `task_completed` is the only gate); user continuation is honored; multiple sequential
      `task_completed` completions in one QUICK_FIX session are explicitly normal. The escalation fence instructing a
      stop-and-reroute no longer exists.
- [ ] `src/agent-definitions/shared-practice/plan-execution.md` instructs workflow-owned execution Agents to stay on the
      current workflow step, answer out-of-Plan requests conversationally with options, and defer any transition to an
      explicit user action; it contains no instruction to call a routing tool or to ask the user to switch to Router on
      the Agent's initiative.
- [ ] A user-initiated `switchAgent` (from `/agent` or a runtime consumer request) while `getActiveExecutionWorkflow()`
      is non-null: clears the active execution workflow and workflow context as one Runtime-owned deliberate transition,
      emits a user-visible notice naming the Plan that was released and that `/load-plan` can resume it, and leaves Plan
      front matter, worktree registry entries, and recovery descriptors byte-identical. Workflow-initiated transitions
      (execution dispatch, validation continuation, semantic repair) are unaffected. Tests cover: switch-to-planner
      during active execution clears the workflow and preserves the worktree registry entry; workflow dispatch
      transitions do not clear it; `/load-plan` after such a switch can still resume the Plan.
- [ ] `src/shared/session/agents.js` attention nudges and `src/shared/workflow/metrics.js`,
      `src/shared/session/tool-event-title.js`, `src/ui/tui/runtime-adapter.js`, and the Claude CLI MCP bridge contain
      no reference to the removed tool; the bridged Claude CLI tool list no longer includes it.
- [ ] `docs/domain-language.md` has no **Return-to-Router Tool** entry; **Scope Escalation** is redefined as the
      conversational limit-and-options contract with the user as the only transition authority; the stable relationships
      section no longer states that Scope Escalation returns work to Router. `docs/sessions.md` no longer lists
      `return_to_router` as an activation path.
- [ ] `deno task ci` passes on the completed tree.

## Verification Plan

- Automated: `deno task ci` (type-check, lint, language policy, seams:check, doc-links, full test suite via the
  sandboxed runner). Targeted suites during development:
  `deno run -A scripts/run-tests.js src/shared/session/session-runtime.test.js src/shared/session/agent-switching.test.js src/shared/session/__tests__/session-tools-policy.test.js src/shared/workflow/workflow-results.test.ts src/shared/workflow/orchestrator.test.ts`.
- Manual: in a TUI session, (1) ask Guide for a code change — it must explain the limit and offer `/agent` options
  without switching or ending its turn via a tool; (2) run a QUICK_FIX, expand it feature-sized, observe one concern,
  say "continue", observe compliance and Mechanical Validation on `task_completed`; (3) approve and run a small Plan,
  then `/agent planner` mid-execution — observe the workflow-released notice, then `/load-plan` and confirm the Plan and
  worktree resume.
- Behavior that must remain protected by existing tests after this reshape: atomic `switchAgent` transitions
  (staged-handler construction, failure preserves the previous pair), workflow dispatch via `triage_report` /
  `plan_written` / `task_completed` outcomes, Keep-Engineer-active-after-interruption semantics, and QUICK_FIX
  Mechanical Validation per `task_completed`. Behavior that is expected to stop existing (tests deleted, not rewritten):
  router-handoff consumption, the chained-handoff limit, `buildReturnToRouterPrompt` framing, bridged `return_to_router`
  lifecycle gating, and TUI handoff-reason folding.
- Glossary check: `docs/domain-language.md` describes only implemented behavior; the redefined Scope Escalation matches
  the shipped prompts.

## Edge Cases & Considerations

- **Persisted sessions containing historical `return_to_router` tool results**: hydration must tolerate old JSONL
  transcripts with those tool results as inert history (rendered as a plain completed tool block). No migration; only
  the live consumption paths are removed. Add/keep a hydration test with a legacy transcript if one does not exist.
- **Custom/user-override agent definitions** in `~/.wld/agents` or `.wld/agents` may still list `return_to_router` in
  `tools:`. Unknown tool names are already dropped from effective tool lists; verify that path degrades silently rather
  than erroring.
- **The dirty-tree quick fix** touching `agent-switching.js` / `session-runtime.js` / `runtime-adapter.js` (startup
  session work) is complete and will be committed before this plan executes; the execution worktree is created from the
  committed base, so no design interaction is expected — but the Engineer should re-read those files rather than
  trusting the line numbers in this plan.
- **Invariant alignment**: clearing the active workflow on user `/agent` is permitted by the recorded invariant
  ("deliberate fresh routing transition with an explicit new owner"). Do not clear on agent stops, questions, or errors
  — only on the explicit user-initiated switch.
- **`validation-prompts.test.js`** currently asserts isolated-session prompts never reference the tool; after removal
  this is trivially true everywhere. Keep a single repo-wide "no references" assertion or rely on the objective check;
  do not leave a misleading comment implying the tool still exists elsewhere.
- **Metrics**: the `routing/return_to_router` event disappears from new data. No consumer migration needed; metric files
  are append-only local records.
- **Follow-up plan (b)** — Engineer/Plan-Engineer split, workflow-only Frontend Engineer, Pair Execution for both — is
  intentionally out of scope here. Prompt rewrites in this plan should avoid wording that would contradict that split
  (e.g. do not newly entrench "Engineer executes Plans" language beyond what already exists).
