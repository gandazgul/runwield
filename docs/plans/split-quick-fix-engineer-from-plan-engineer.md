---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
summary: "Split the selectable full-stack Quick Fix Engineer from a new workflow-only Plan Engineer, make Frontend Engineer a workflow-only specialist for browser-UI-dominated Plans, and open Pair Execution to both plan-execution agents."
affectedPaths:
    - "src/agent-definitions/engineer.md"
    - "src/agent-definitions/plan-engineer.md"
    - "src/agent-definitions/frontend-engineer.md"
    - "src/agent-definitions/shared-practice/bounded-request.md"
    - "src/agent-definitions/shared-practice/plan-execution.md"
    - "src/agent-definitions/planner.md"
    - "src/agent-definitions/architect.md"
    - "src/agent-definitions/router.md"
    - "src/constants.js"
    - "src/shared/session/agents.js"
    - "src/cmd/agents/index.ts"
    - "src/cmd/agents/getArgumentCompletions.js"
    - "src/shared/workflow/plan-executor.ts"
    - "src/shared/workflow/execution-start.ts"
    - "src/shared/workflow/execution-collaboration.ts"
    - "src/shared/workflow/workflow-slicer.ts"
    - "src/tools/plan-written.ts"
    - "docs/domain-language.md"
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-08-15T13:12:00-0400"
status: "draft"
planId: "e29bc564-93dc-4440-a1b5-79fe9f3041a2"
---

# Split the Quick Fix Engineer from a Workflow-Only Plan Engineer

## Context

**Sequencing: this plan executes only after `remove-return-to-router-user-owned-transitions` has landed.** It assumes
`return_to_router` no longer exists and that the conversational limit-and-options boundary contract is already in the
prompts it reorganizes.

Today one Engineer definition carries two conflicting contracts: a disciplined "do the Plan and only the Plan" executor,
and a flexible bounded coding helper for QUICK_FIX. Models bleed the strict contract into Quick Fix work and the elastic
contract into Plan work. Frontend Engineer has the same duplication plus an identity problem: Router never selects it,
frontend competence largely comes from Skills, yet its planned-execution contract (headed-browser preflight,
design-system discipline, Pair checkpoints) is genuinely valuable.

Decisions from the ideation session (project Memory 7725):

1. **`/agent engineer` is the Quick Fix Engineer** — a full-stack, single-task-by-default coding helper with an elastic
   boundary. It can handle any layer, including frontend Quick Fixes, by loading domain Skills
   (`front-end-framework-use`, `agent-browser-use`, etc.) instead of pretending universal expertise. Warn once when work
   grows planning-sized, then comply. Each `task_completed` gets Mechanical Validation; the user may keep working in the
   mode.
2. **Plan Engineer is a new workflow-only Agent.** Hidden from `/agent` listings and manual selection, but it is the
   visible, conversational, steerable root Agent while Plan execution is active — through implementation, Workflow
   Validation, repairs, and recovery. It is not an isolated subagent like Reviewer or Slicer.
3. **Frontend Engineer becomes workflow-only and narrow.** It executes Plans whose dominant concerns are browser UI/UX
   behavior and client-side code. Vertical changes with incidental UI (a checkbox wired to a new endpoint) stay with
   Plan Engineer. Planner already recommends the owner well; keep `executionAgent` front-matter values `"engineer"` /
   `"frontend-engineer"` unchanged so no Plan migration is needed — the runtime maps them to the plan-execution
   definitions.
4. **Pair Execution applies to both plan-execution agents.** The collaboration style is domain-neutral: coherent
   increments, exposed decisions and evidence, user judgment at checkpoints. Frontend checkpoints show browser states;
   backend checkpoints present observed behavior and consequential trade-offs. The domain split is about what each
   specialist worries about (HTTP/browser/interaction/accessibility vs. data integrity/concurrency/services/ security),
   not about who gets user collaboration.

## Objective

- `src/agent-definitions/plan-engineer.md` exists as the workflow-only Plan execution owner composing the plan-execution
  shared practice; `engineer.md` becomes the selectable Quick Fix helper and no longer composes it.
- `frontend-engineer.md` is workflow-only and scoped to browser-UI-dominated Plans; its QUICK_FIX references are gone.
- `/agent` listings, argument completions, and manual switching exclude workflow-only agents; workflow dispatch can
  still activate them as root Agents.
- Plan execution dispatched with `executionAgent: engineer` runs the Plan Engineer definition; `frontend-engineer` runs
  the Frontend Engineer definition; QUICK_FIX dispatch still runs the selectable Engineer.
- `plan_written` and Slicer accept `collaborationRecommendation: pair` for either execution agent without frontend-only
  caveats, and runtime collaboration selection honors a pair recommendation on engineer-owned Plans.

## Approach

1. **Selectability mechanism.** Add a `workflowOnly: true` front-matter flag to agent definitions (set on
   `plan-engineer.md` and `frontend-engineer.md`). `listAvailableAgents` and agent completions filter flagged
   definitions; manual `switchAgent` from user commands rejects them with a short explanation, while workflow dispatch
   bypasses the filter. Add `AGENTS.PLAN_ENGINEER = "plan-engineer"` to `src/constants.js`.
2. **Definition split.** Move the Plan-execution contract (Plan boundary, implementation steps discipline, verification
   plan, validation continuation behavior, Pair increments) from `engineer.md` into `plan-engineer.md`. Rewrite
   `engineer.md` around the Quick Fix contract from `bounded-request.md` (checklist, elastic boundary,
   warn-once-then-comply, repeated `task_completed`, domain-Skill loading — explicitly including frontend and browser
   Skills for UI Quick Fixes). Reorganize shared practice: the Validation Continuation contract moves out of
   `bounded-request.md` into `plan-execution.md` (only plan-execution agents receive continuations);
   `bounded-request.md` becomes QUICK_FIX-only and is composed only by `engineer.md`.
3. **Dispatch mapping.** Plan execution (`plan-executor.ts`, `execution-start.ts`, semantic repair and validation
   continuation owner realignment) maps front-matter `executionAgent: "engineer"` to the `plan-engineer` runtime
   definition and `"frontend-engineer"` to `frontend-engineer`. QUICK_FIX dispatch and Mechanical Validation repair
   continuations keep using the selectable `engineer`. Persisted workflow state
   (`activeExecutionWorkflow.executionAgent`) keeps storing the canonical front-matter value; only definition resolution
   changes, so resumed pre-split sessions realign to the correct new owner.
4. **Pair for both.** Update `plan_written.ts` and `workflow-slicer.ts` schema descriptions, and Planner/Architect
   prompt guidance, so `pair` is recommendable for engineer-owned Plans when live user judgment is worth the run
   (exploratory/high-risk work), not only for visual work. Verify `execution-collaboration.ts` selection is
   agent-neutral and extend Pair checkpoint guidance in `plan-engineer.md` (increment = coherent observable change:
   passing test, exercised behavior, or consequential decision — not necessarily visual).
5. **Frontend narrowing.** Trim `frontend-engineer.md` to the planned-execution contract only (drop routed-QUICK_FIX
   language), keep browser preflight/evidence rules. Planner (`planner.md`) keeps its existing dominant-concern guidance
   for choosing the owner; Router (`router.md`) needs no QUICK_FIX change (it already always selects Engineer) but must
   not describe Frontend Engineer as user-selectable.

## Files to Modify

- `src/constants.js` — add `AGENTS.PLAN_ENGINEER`; update the AGENTS/SUBAGENTS doc comments to name the workflow-only
  root-agent category (distinct from isolated `SUBAGENTS`).
- `src/agent-definitions/plan-engineer.md` — new definition: workflow-only flag, plan-execution + engineering +
  user-authority + working-tree-safety shared practice, full execution toolset (mirrors current engineer tools minus
  QUICK_FIX framing), Pair-capable collaboration guidance with domain-neutral checkpoints.
- `src/agent-definitions/engineer.md` — selectable Quick Fix Engineer: full-stack helper identity, Skill-loading policy
  for unfamiliar domains (frontend, infra, etc.), bounded-request practice, no plan-execution practice.
- `src/agent-definitions/frontend-engineer.md` — workflow-only flag; remove "routed UI QUICK_FIX" input shape; keep and
  sharpen the browser-dominant-Plan scope statement and real-browser evidence rules.
- `src/agent-definitions/shared-practice/bounded-request.md` — QUICK_FIX-only; Validation Continuation section moves to
  `plan-execution.md`.
- `src/agent-definitions/shared-practice/plan-execution.md` — gains the Validation Continuation contract; wording
  addressed to plan-execution agents.
- `src/agent-definitions/planner.md`, `src/agent-definitions/architect.md` — execution-owner guidance: engineer-owned
  Plans may recommend `pair`; frontend-engineer for browser-UI-dominated Plans only.
- `src/agent-definitions/router.md` — Frontend Engineer described as workflow-only; QUICK_FIX always Engineer.
- `src/shared/session/agents.js` — parse `workflowOnly` front matter; `listAvailableAgents` filters it; display names
  for `plan-engineer`; attention nudges for Plan Engineer (execution-focused) distinct from Engineer (quick-fix).
- `src/cmd/agents/index.ts`, `src/cmd/agents/getArgumentCompletions.js` — listings/completions exclude workflow-only
  agents; manual selection of one returns a short message naming why and what activates it.
- `src/shared/session/session-runtime.js` / `agent-switching.js` — user-initiated `switchAgent` rejects workflow-only
  names; workflow-initiated transitions may activate them.
- `src/shared/workflow/plan-executor.ts`, `execution-start.ts` — resolve execution root definition from canonical
  `executionAgent` via the new mapping; validation-continuation and semantic-repair owner realignment resolve through
  the same mapping.
- `src/shared/workflow/execution-collaboration.ts` — confirm/keep agent-neutral pair selection; remove any frontend-only
  assumptions in comments.
- `src/tools/plan-written.ts` — `collaborationRecommendation` description: pair valid for either execution agent.
- `src/shared/workflow/workflow-slicer.ts` — same description change in the child-plan schema.
- `docs/domain-language.md` — redefine **Engineer** (selectable full-stack Quick Fix helper), add **Plan Engineer**
  (workflow-only Plan execution owner, visible and steerable during execution), redefine **Frontend Engineer**
  (workflow-only, browser-UI-dominated Plans), update **Pair Execution** (either plan-execution agent) and the stable
  relationships ("a PLANNED_CHANGE is executed by the Plan Engineer or Frontend Engineer after approval").
- Tests: `src/shared/session/__tests__/session-tools-policy.test.js`,
  `src/shared/session/agents-shared-practice.test.ts`, `src/cmd/__tests__/getArgumentCompletions.test.js`,
  `src/shared/workflow/plan-executor` and execution-start tests, `execution-collaboration` tests, plan-written tests.

## Reuse Opportunities

- `SUBAGENTS` loader precedent (`src/shared/session/agents.js` workflow-only display-name pinning,
  `loadAgentDefFromPath` for `/agent`-invisible definitions) — but Plan Engineer is a top-level layered agent definition
  (overridable via `.wld/agents/plan-engineer.md`), so prefer the front-matter flag over the SUBAGENTS registry.
- `resolveEffectiveSessionToolNames` and existing tool lists — Plan Engineer's toolset is the current engineer list.
- `selectRuntimeCollaborationStyle` — already recommendation + host-capability driven; reuse unchanged if it carries no
  agent conditionals.
- Existing shared-practice composition and its registry tests — extend, do not invent a parallel mechanism.

## Implementation Steps

- [ ] `src/agent-definitions/plan-engineer.md` exists with `workflowOnly: true`, composes `plan-execution` shared
      practice, and owns the Plan/Validation-Continuation execution contract; `src/agent-definitions/engineer.md` no
      longer composes `plan-execution`, composes `bounded-request`, and contains the full-stack Quick Fix identity with
      explicit domain-Skill loading (including frontend/browser Skills for UI Quick Fixes).
- [ ] `src/agent-definitions/frontend-engineer.md` has `workflowOnly: true` and contains no QUICK_FIX input shape; its
      scope statement restricts it to Plans dominated by browser UI/UX and client-side concerns.
- [ ] `src/agent-definitions/shared-practice/bounded-request.md` contains only the QUICK_FIX contract; the Validation
      Continuation contract lives in `plan-execution.md`; the shared-practice registry test asserts which agents compose
      which fragment (engineer: bounded-request only; plan-engineer and frontend-engineer: plan-execution).
- [ ] `listAvailableAgents` output and `/agent` argument completions contain neither `plan-engineer` nor
      `frontend-engineer`; a user-initiated `switchAgent` to either returns a rejection message and changes nothing,
      while workflow dispatch activates them as the root Agent — all covered by tests.
- [ ] Plan execution for a Plan with `executionAgent: engineer` activates the `plan-engineer` definition as the visible
      root Agent (footer/agent name reflects Plan Engineer), and `executionAgent: frontend-engineer` activates Frontend
      Engineer; QUICK_FIX dispatch activates the selectable `engineer`. Validation continuations and semantic repair
      realign to the mapped plan-execution owner. Resuming a pre-split session with a persisted
      `activeExecutionWorkflow.executionAgent: "engineer"` continues under Plan Engineer. All covered by tests.
- [ ] `plan_written` accepts and persists `collaborationRecommendation: "pair"` with `executionAgent: "engineer"`, the
      Slicer child-plan schema description no longer scopes pair to frontend work, and `selectRuntimeCollaborationStyle`
      honors a pair recommendation for an engineer-owned Plan on a pair-capable host — covered by tests.
- [ ] `docs/domain-language.md` defines **Plan Engineer**, and its **Engineer**, **Frontend Engineer**, and **Pair
      Execution** entries and stable relationships match the implemented behavior above.
- [ ] `deno task ci` passes on the completed tree.

## Verification Plan

- Automated: `deno task ci`. Targeted during development:
  `deno run -A scripts/run-tests.js src/shared/session/__tests__/session-tools-policy.test.js src/shared/session/agents-shared-practice.test.ts src/cmd/__tests__/getArgumentCompletions.test.js src/shared/workflow/execution-collaboration.test.* src/shared/workflow/plan-executor*.test.*`
  (resolve exact test filenames in the tree).
- Manual: (1) `/agent` shows Engineer but not Plan Engineer or Frontend Engineer; `/agent plan-engineer` is rejected
  with an explanation. (2) Approve & Run a small engineer-owned Plan — the footer/active Agent shows Plan Engineer and
  the session is steerable. (3) Approve a Plan with `collaborationRecommendation: pair` and `executionAgent: engineer`
  in a TUI — Pair checkpoints occur. (4) Run a frontend Quick Fix via Router — Engineer handles it and loads frontend
  Skills.
- Protected existing behavior: atomic agent switching, Keep-Engineer-active-after-interruption (now applies to Plan
  Engineer for planned work and Engineer for QUICK_FIX), legacy `frontend: true` Plan resolution to Frontend Engineer +
  autonomous, Pair host-capability fallback (ACP/Headless run autonomous). Behavior expected to stop existing: Frontend
  Engineer as `/agent`-selectable and as a QUICK_FIX owner; engineer.md's Plan-execution instructions.
- Glossary check: domain-language entries describe shipped behavior only.

## Edge Cases & Considerations

- **Depends on plan (a).** Do not start until `remove-return-to-router-user-owned-transitions` is merged; both plans
  rewrite `engineer.md`, `frontend-engineer.md`, and the shared-practice fragments.
- **User overrides**: an existing `.wld/agents/engineer.md` override merges onto the new Quick Fix contract; document in
  the definition header comment that plan execution now lives in `plan-engineer.md` so overrides land on the right file.
  An override adding `workflowOnly` to a normally selectable agent should be honored (it is a filter, not a security
  boundary).
- **In-flight Plans and sessions**: canonical `executionAgent` front-matter values are unchanged, so approved Plans, the
  worktree registry, and Work Records need no migration. Only runtime definition resolution changes.
- **Nudges and footer labels**: Plan Engineer needs its own attention nudge and display name; reusing Engineer's
  quick-fix nudge on Plan work would recreate the contract bleed this plan removes.
- **Do not weaken frontend rigor**: moving QUICK_FIX out of `frontend-engineer.md` must not delete the headed-browser
  preflight/evidence rules from planned execution; UI Quick Fix rigor now comes from Engineer loading
  `agent-browser-use`/`front-end-framework-use`, which those Skills already mandate.
- **Naming**: runtime identifier `plan-engineer`, display name "Plan Engineer". Avoid renaming `frontend-engineer`'s
  identifier (front matter compatibility); its narrowed meaning is carried by the glossary and prompt, not a new id.
