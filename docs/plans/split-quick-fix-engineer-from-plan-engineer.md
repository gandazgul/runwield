---
planId: "e29bc564-93dc-4440-a1b5-79fe9f3041a2"
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
    - "src/agent-definitions/subagent-definitions/slicer-prompt.md"
    - "src/constants.js"
    - "src/shared/session/agents.js"
    - "src/shared/session/types.js"
    - "src/shared/session/session.js"
    - "src/shared/session/agent-handler.ts"
    - "src/shared/session/session-runtime.js"
    - "src/cmd/agents/index.ts"
    - "src/cmd/agents/getArgumentCompletions.js"
    - "src/cmd/load-plan/plan-session-surface.ts"
    - "src/shared/workflow/execution-agent.ts"
    - "src/shared/workflow/execution-collaboration.ts"
    - "src/shared/workflow/engineer-runner.ts"
    - "src/shared/workflow/plan-executor.ts"
    - "src/shared/workflow/execution-segment-handoff.ts"
    - "src/shared/workflow/workflow-prompts.js"
    - "src/shared/workflow/workflow-slicer.ts"
    - "src/tools/pair-checkpoint.ts"
    - "src/tools/task-completed.ts"
    - "src/tools/plan-written.ts"
    - "src/ui/workspace/react/PlanReviewSurface.tsx"
    - "src/ui/workspace/react/plan-review-policy.ts"
    - "docs/domain-language.md"
objectiveChecks:
    - id: "OC1"
      command: "deno eval 'import {AGENTS} from \"./src/constants.js\"; import {listAvailableAgents,loadAgentDef} from \"./src/shared/session/agents.js\"; import {resolvePlanExecutionRuntimeAgent} from \"./src/shared/workflow/execution-agent.ts\"; const names=(await listAvailableAgents(Deno.cwd())).map((x)=>x.name); const [p,f]=await Promise.all([loadAgentDef(\"plan-engineer\",Deno.cwd()),loadAgentDef(\"frontend-engineer\",Deno.cwd())]); if(AGENTS.PLAN_ENGINEER!==\"plan-engineer\"||!p.workflowOnly||!f.workflowOnly||names.includes(\"plan-engineer\")||names.includes(\"frontend-engineer\")||!names.includes(\"engineer\")||resolvePlanExecutionRuntimeAgent(\"engineer\")!==\"plan-engineer\"||resolvePlanExecutionRuntimeAgent(\"frontend-engineer\")!==\"frontend-engineer\") Deno.exit(1);'"
      rationale: "This requires the new runtime identity, layered workflow-only metadata, hidden manual discovery, and the compatible policy-to-runtime mapping to exist together."
    - id: "OC2"
      command: "deno eval 'import {loadAgentDef} from \"./src/shared/session/agents.js\"; const [q,p,f]=await Promise.all([loadAgentDef(\"engineer\",Deno.cwd()),loadAgentDef(\"plan-engineer\",Deno.cwd()),loadAgentDef(\"frontend-engineer\",Deno.cwd())]); const bad=!q.systemPrompt.includes(\"Quick Fix Checklist\")||q.systemPrompt.includes(\"approved Planned Change Plan\")||q.systemPrompt.includes(\"Validation Continuation\")||q.systemPrompt.includes(\"Runtime Collaboration Style\")||p.systemPrompt.includes(\"QUICK_FIX\")||p.systemPrompt.includes(\"Quick Fix Checklist\")||!p.systemPrompt.includes(\"Runtime Collaboration Style\")||f.systemPrompt.includes(\"QUICK_FIX\")||f.systemPrompt.includes(\"Quick Fix Checklist\")||!f.systemPrompt.includes(\"headed browser\"); if(bad) Deno.exit(1);'"
      rationale: "This fails until the three composed prompts have distinct Quick Fix, Plan execution, and browser-specialist contracts rather than copied marker text."
    - id: "OC3"
      command: "deno run -A scripts/run-tests.js src/shared/workflow/plan-execution-runtime-boundaries.integration.test.ts src/tools/__tests__/pair-checkpoint.test.js src/tools/__tests__/task-completed.test.js"
      rationale: "The new integration suite must enter through production Plan execution and resume paths to prove the real Plan Engineer root, canonical durable owner, Pair checkpoint, and accepted completion; existing tool suites protect both owners."
    - id: "OC4"
      command: "deno run -A scripts/run-tests.js src/ui/workspace/react/plan-review-policy.test.ts src/cmd/agents/index.test.ts src/cmd/__tests__/getArgumentCompletions.test.js"
      rationale: "The new policy test must prove Workspace preserves Engineer Pair and delegates normalization, while command tests prove workflow-only agents cannot be manually selected or completed."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-15T13:12:00-0400"
updatedAt: "2026-08-18T13:27:02.459Z"
status: "verified"
origin: "internal"
implementedAt: "2026-08-18T04:57:07.267Z"
verifiedAt: "2026-08-18T13:26:44.194Z"
userVerifiedAt: null
executionReport: "- **Plan Engineer created.** `src/agent-definitions/plan-engineer.md` is a new `workflowOnly: true` Plan executor composing `plan-execution`. `engineer.md` now composes `bounded-request` only and is the selectable full-stack Quick Fix helper that loads domain Skills (frontend/browser included) instead of refusing unfamiliar work. `frontend-engineer.md` is `workflowOnly: true`, dropped `bounded-request`, and keeps headed-browser preflight and `browserPreflightOutcome` evidence.\n\n- **Shared practice split.** `bounded-request.md` holds only the QUICK_FIX contract (checklist, elastic one-task boundary, one-warning rule, repeated completion cycles). `plan-execution.md` owns Plan scope, validation continuation, recovery, compaction, and medium-neutral Pair ceremony.\n\n- **One resolver, durable records unchanged.** New `src/shared/workflow/execution-agent.ts` maps policy owner → runtime Agent (`engineer`→`plan-engineer`, `frontend-engineer`→itself), plus `resolveActiveWorkflowRuntimeAgent` which keeps QUICK_FIX on the selectable Engineer. Wired into Plan launch, segment handoff, semantic-repair handoff, completion ownership, resume/realignment, `/load-plan` restoration, compaction re-anchor, and display labels. Plan Front Matter, `ActiveExecutionWorkflow.executionAgent`, and worktree records still hold only `engineer | frontend-engineer`; segment-handoff markers carry the runtime Agent and still accept a pre-split `engineer` marker.\n\n- **Discoverability.** `AgentDefinition.workflowOnly` comes from merged front matter (a project layer can hide or unhide). `listAvailableAgents` filters it; `listAllAgentDefinitions` does not, so workflow dispatch still loads them. `/agent` CLI+TUI and completions omit both; naming one explicitly explains what activates it and leaves the active Agent unchanged.\n\n- **Pair is owner-neutral.** `pair_checkpoint` goes to either Plan owner with observable-increment wording (browser fields stay optional). Fallback copy and pause messages name the resolved runtime Agent; an incapable host falls back to autonomous without rewriting the stored recommendation. Planner, `plan_written`, and the Slicer prompt/schema now describe Pair as valid for either owner.\n\n- **Workspace contradiction removed.** `plan-review-policy.ts` owns initial normalization, owner/style transitions, and the approval payload; `PlanReviewSurface.tsx` delegates and holds no second coercion. Also fixed a latent bug there: selectability was computed from the raw classification, so a legacy `FEATURE` Plan lost its controls.\n\n- **Glossary updated.** `docs/domain-language.md` redefines **Engineer**, adds **Plan Engineer**, narrows **Frontend Engineer**, generalizes **Pair Execution**, and states that approved PLANNED_CHANGE Plans execute through Plan Engineer or Frontend Engineer while QUICK_FIX belongs to Engineer.\n\n- **Bug found and fixed in inherited work.** `runEngineerWithSegmentHandoff` referenced an undefined `runtimeAgent`, so every resumed execution segment would have thrown at runtime.\n\n- **Objective-Failing Checks: all four pass.** OC1 and OC2 exit 0; OC3 and OC4 suites pass.\n\n- **`deno task ci`: 333 files passed, 1 failed.** The failure is `src/shared/runwield-owned-paths.test.js` (`isRunWieldOwnedRuntimePath(\".wld/worktrees.json.tmp\")` returns true, test expects false). Proven pre-existing: it fails identically at HEAD in a clean `git worktree add --detach` checkout, and no file in this change touches it. Deciding whether a temp file of an owned registry is itself \"owned\" is a product call outside this Plan, so I left it — it needs a separate fix. Type check, Astro workspace check (0 errors), lint, language policy, doc links, and `seams:check` (0 seams, no new or re-baselined seam) all pass.\n\n- **Tests: net additions, nothing deleted.** New: `agent-contracts.test.ts` (11), `plan-execution-runtime-boundaries.integration.test.ts` (5, entering through real `executePlan` and a SessionRuntime turn with canonical policy input only). Added: 2 `task-completed` owner tests, 2 `pair-execution` tests, 7 `plan-review-policy` tests, 3 `/agent` command tests, 1 legacy-marker handoff test, 1 re-anchor negative test. In `agents-shared-practice.test.ts` three tests were each split into two so Engineer and the Plan executors are asserted separately — no test was removed without a replacement, and the coverage Engineer lost there (Pair/Plan language) is now asserted negatively in `agent-contracts.test.ts`. Remaining edits were identity updates (`engineer` → `plan-engineer`) in existing tests whose behavior is unchanged.\n\n- **Mutation-verified.** Breaking `resolvePlanExecutionRuntimeAgent` turns 3 of the 5 integration tests red; removing the QUICK_FIX branch turns the 4th red — so the resolver is genuinely exercised, not just defined.\n\n- **Test-harness couplings this change exposed.** `emitLaunchingExecutionAgent`'s display name is awaited by `session-runtime` and `execution-progress` tests — the mismatch hung the entire `session-runtime.test.js` file (31 min), which first looked like an unrelated slow suite. The golden TUI harness maps live turns to scripted identities by both system-prompt substring and Runtime snapshot name; both needed the new identity folded back to the `engineer` phase label, and two scenarios waited on `runtime:agent:engineer`. Golden scenarios went from 13 failing files to 0.\n\n- **Not verified: the manual Workspace browser check.** The Verification Plan asks for the Plan Review control inspected in a headed browser at desktop and narrow widths against a running dev server. I did not run a browser. Covered instead by `plan-review-policy.test.ts` (owner/style transitions, payload round-trip, defaults, legacy `frontend: true`, and a source-boundary assertion that the surface delegates) plus the Astro workspace check at 0 errors. The rendered control and console/network cleanliness remain unverified. The other manual steps — `/agent` listing and explicit workflow-only names, and Plan Engineer owning a resumed `executionAgent: engineer` workflow — are covered by OC1 and the integration suite.\n\n- **No commits made; the working tree is left modified for review.**"
workRecord:
    status: "generated"
    recordId: "8141165a-a255-46a8-a5d0-7b986a55efde"
    path: "docs/work-records/2026-08-18-split-quick-fix-engineer-from-plan-engineer.md"
    lastAttemptAt: "2026-08-18T13:26:51.018Z"
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-08-18T13:26:42.791Z"
validationCheckpoint: null
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "79239a0e7d31b0f0303ecb46b81e8374dc7dda08"
    targetBranch: "main"
    targetHeadBeforeMerge: "8f8382615d25a7412779db3efc9847e132304341"
validationCiAttempts: 0
validationObjectiveCheckAttempts: 0
validationSemanticRounds: 0
---

# Split the Quick Fix Engineer from a Workflow-Only Plan Engineer

## Context

**Sequencing: this Plan executes only after `remove-return-to-router-user-owned-transitions` and the narrowed
`finish-agent-prompt-architecture-cleanup` have landed.** It assumes `return_to_router` no longer exists, the
conversational limit-and-options boundary contract is already in the prompts it reorganizes, and the cleanup Plan has
removed only duplicated execution-request prose. This Plan owns all Engineer Pair behavior, including Workspace review
controls; the cleanup Plan must not retain that scope.

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
- `plan_written`, Slicer, and Workspace Plan Review accept and preserve `collaborationRecommendation: pair` for either
  execution agent without frontend-only caveats, and runtime collaboration selection honors a pair recommendation on
  engineer-owned Plans.

## Approach

1. **Separate policy identity from runtime identity.** Keep Plan Front Matter and
   `ActiveExecutionWorkflow.executionAgent` limited to the compatible policy values `"engineer" | "frontend-engineer"`.
   Add one typed resolver in `src/shared/workflow/execution-agent.ts`:

   ```text
   Plan policy / durable workflow       visible root Agent
   engineer                       ->    plan-engineer
   frontend-engineer              ->    frontend-engineer
   QUICK_FIX (no Plan policy)      ->    engineer
   ```

   Every Plan launch, segment handoff, pause/resume decision, `/load-plan` restoration, validation-owner realignment,
   display label, Task Completion gate, and compaction re-anchor must use that resolver. Durable Plan/worktree/Session
   records do not migrate and never store `plan-engineer` as an execution policy value.
2. **Make workflow-only identity explicit.** Add `workflowOnly: true` to `plan-engineer.md` and `frontend-engineer.md`,
   expose the merged flag on `AgentDefinition`, and filter it from `listAvailableAgents`, CLI/TUI `/agent` lists, and
   completions. An explicit user command naming either workflow-only Agent returns a short explanation and leaves the
   active Agent unchanged. Internal workflow activation continues to call the exact low-level Agent loader/switch path,
   so it does not depend on the selectable list. `AGENTS.PLAN_ENGINEER` names the new runtime identity.
3. **Split the prompts by work contract.** `plan-engineer.md` receives the current Plan boundary, ordered implementation
   discipline, validation continuation, recovery, compaction, and medium-neutral Pair rules. `frontend-engineer.md`
   keeps the same Plan contract plus browser preflight, design-system, accessibility, and visible evidence rules, but
   loses all QUICK_FIX language. `engineer.md` becomes the selectable full-stack Quick Fix helper: a 2–5 item checklist,
   an elastic single-task boundary, one planning-size warning followed by compliance when the user confirms, repeated
   `task_completed` cycles, and explicit loading of relevant domain Skills for frontend, browser, infrastructure, or
   other unfamiliar work. `bounded-request.md` becomes QUICK_FIX-only; validation continuation moves to
   `plan-execution.md`.
4. **Make Pair medium-neutral end to end.** Planner and Slicer guidance recommends Pair when live user judgment is worth
   the interruptions, for either Plan owner. `plan_written` and child-Plan schema descriptions stop claiming Pair is
   frontend-only. `selectRuntimeCollaborationStyle` keeps the current host-capability fallback but uses owner-neutral
   copy. Pair pause messages name the resolved runtime Agent. Plan Engineer checkpoints present one coherent observable
   increment—a passing test, exercised behavior, inspectable diff, or consequential decision—while Frontend Engineer
   retains headed-browser evidence at each visible checkpoint.
5. **Remove the Workspace contradiction.** Extract execution-policy normalization from `PlanReviewSurface.tsx` into
   `plan-review-policy.ts`. The review UI offers Pair and Autonomous for both owner choices, preserves an existing
   Engineer Pair recommendation, and does not guess runtime host capability. This Plan owns that UI behavior;
   `finish-agent-prompt-architecture-cleanup` retains only its execution-request prompt cleanup.

The set-aside option was to make one Engineer prompt conditional on dispatch mode. That keeps one identity but preserves
the contract bleed this change is intended to remove and makes resumed root-Agent identity harder to explain.

## Files to Modify

- `src/constants.js` — add `AGENTS.PLAN_ENGINEER`; distinguish workflow-only root Agents from isolated `SUBAGENTS`.
- `src/agent-definitions/plan-engineer.md` — new workflow-only Plan execution definition with the full execution toolset
  and medium-neutral Pair checkpoints.
- `src/agent-definitions/engineer.md` — selectable full-stack Quick Fix definition; compose `bounded-request`, not
  `plan-execution`.
- `src/agent-definitions/frontend-engineer.md` — workflow-only browser-UI-dominated Plan specialist; remove QUICK_FIX
  inputs while preserving headed-browser preflight and evidence.
- `src/agent-definitions/shared-practice/bounded-request.md` — retain only the elastic QUICK_FIX contract.
- `src/agent-definitions/shared-practice/plan-execution.md` — own Plan execution, validation continuation, recovery, and
  owner-neutral Pair ceremony.
- `src/agent-definitions/planner.md` — explain owner selection and when Pair is useful for either execution Agent.
- `src/agent-definitions/subagent-definitions/slicer-prompt.md` — apply the same owner/Pair rules to child Plans.
- `src/shared/session/agents.js`, `src/shared/session/types.js` — parse and expose merged `workflowOnly`, filter
  selectable discovery, cache Plan Engineer's display name, and add separate Quick Fix versus Plan execution attention
  nudges.
- `src/shared/session/session.js`, `src/shared/workflow/workflow-prompts.js` — include Plan Engineer in early compaction
  and approved-Plan re-anchor behavior; remove Engineer from Plan re-anchors because it no longer executes Plans.
- `src/shared/session/agent-handler.ts`, `src/shared/session/session-runtime.js` — compare, restore, display, and
  activate active Plan owners through the policy-to-runtime resolver while keeping durable workflow state canonical.
- `src/cmd/agents/index.ts`, `src/cmd/agents/getArgumentCompletions.js`, `src/cmd/load-plan/plan-session-surface.ts` —
  hide workflow-only Agents from manual choices, explain explicit rejected names, and restore active Plan workflows to
  the resolved runtime Agent.
- `src/shared/workflow/execution-agent.ts` — new typed single source for policy-owner to runtime-Agent resolution and
  Plan-execution identity checks.
- `src/shared/workflow/execution-collaboration.ts`, `src/shared/workflow/engineer-runner.ts` — owner-neutral Pair
  fallback, checkpoint wiring, pause copy, labels, launch, and segment-resume behavior.
- `src/tools/pair-checkpoint.ts` — permit either canonical Plan owner when Pair is active and make the base checkpoint
  summary/description observable-increment language; keep route, viewport, browser diagnostics, and screenshot evidence
  as optional fields used by Frontend Engineer.
- `src/shared/workflow/plan-executor.ts`, `src/shared/workflow/execution-segment-handoff.ts` — preserve canonical owner
  in active workflow state but carry the resolved runtime Agent in execution and semantic-repair segment handoffs.
- `src/tools/task-completed.ts` — treat Plan Engineer as an execution Agent and compare its completion against the
  resolved runtime owner while retaining canonical owner data in the completion receipt; preserve Frontend Engineer's
  extra browser-preflight field.
- `src/tools/plan-written.ts`, `src/shared/workflow/workflow-slicer.ts` — describe Pair as valid for either Plan owner.
- `src/ui/workspace/react/PlanReviewSurface.tsx`, `src/ui/workspace/react/plan-review-policy.ts` — enable and preserve
  Engineer Pair recommendations through a typed, UI-independent policy normalizer.
- `docs/domain-language.md` — redefine **Engineer**, add **Plan Engineer**, narrow **Frontend Engineer**, generalize
  **Pair Execution**, and update stable relationships to match shipped behavior.
- Tests — extend `src/shared/session/agents-shared-practice.test.ts`,
  `src/shared/session/__tests__/session-tools-policy.test.js`, `src/shared/session/session-prompt.test.js`,
  `src/shared/session/agent-handler.test.ts`, `src/shared/session/session-runtime.test.js`,
  `src/cmd/agents/index.test.ts`, `src/cmd/__tests__/getArgumentCompletions.test.js`, Plan execution/segment integration
  tests, `src/shared/workflow/pair-execution.test.js`, `src/tools/__tests__/pair-checkpoint.test.js`,
  `src/tools/__tests__/task-completed.test.js`, and plan-written/Slicer tests. Add
  `src/shared/session/agent-contracts.test.ts`,
  `src/shared/workflow/plan-execution-runtime-boundaries.integration.test.ts`, and
  `src/ui/workspace/react/plan-review-policy.test.ts` for objective-level contract, production-dispatch, and
  review-policy coverage.

## Reuse Opportunities

- Layered `loadAgentDef` and shared-practice composition in `src/shared/session/agents.js` — Plan Engineer remains a
  project/home-overridable top-level root definition, not an isolated subagent.
- `resolvePlanExecutionPolicy` in `src/plan-store.js` — remains the owner of compatible Plan policy values and defaults.
- `selectRuntimeCollaborationStyle` and `createPairCheckpointTool` — retain recommendation/capability resolution and the
  existing checkpoint protocol; remove only frontend assumptions.
- Existing atomic `switchActiveAgent`/`runActiveAgentTurn` paths — workflow dispatch uses these directly instead of
  adding a second switch mechanism or a dependency-injection seam.
- The policy-normalization extraction already specified by `finish-agent-prompt-architecture-cleanup.md` — move only the
  medium-neutral review state logic; keep RunWield design-system controls unchanged.

## Implementation Steps

- [ ] `plan-engineer.md` is a substantive `workflowOnly: true` Plan executor that composes `plan-execution`;
      `engineer.md` composes `bounded-request` but not `plan-execution`, identifies as the full-stack Quick Fix helper,
      and directs UI Quick Fixes to load frontend/browser Skills rather than refuse them.
- [ ] `frontend-engineer.md` is `workflowOnly: true`, composes `plan-execution` but not `bounded-request`, contains no
      QUICK_FIX input contract, and still requires headed-browser preflight and final browser evidence for its
      browser-UI-dominated Plans.
- [ ] `bounded-request.md` contains the Quick Fix checklist, elastic one-task boundary, one-warning/user-authority rule,
      repeated completion cycles, and no Plan/validation-continuation contract. `plan-execution.md` owns Plan scope,
      validation continuation, recovery, and medium-neutral Pair behavior. `agent-contracts.test.ts` checks exact
      `sharedPractice` membership and rejects Plan/Validation-Continuation language from Engineer plus QUICK_FIX
      language from Plan Engineer/Frontend Engineer; shared-practice tests protect browser rules from leaking into the
      shared fragment.
- [ ] `AgentDefinition.workflowOnly` is derived from merged front matter. `listAvailableAgents`, CLI/TUI lists, and
      completions omit both workflow-only execution Agents. Explicit `/agent plan-engineer` and
      `/agent frontend-engineer` requests explain that approved Plan execution activates them and do not change the
      current Agent; normal unknown-name behavior remains unchanged.
- [ ] `resolvePlanExecutionRuntimeAgent` is the sole mapping from canonical Plan owner to runtime identity. All Plan
      launch, segment handoff, completion ownership, interruption/resume, `/load-plan` restoration, compaction, display,
      and active-workflow realignment paths use it. `ActiveExecutionWorkflow.executionAgent`, Plan Front Matter,
      worktree metadata, and legacy reads continue to contain only `engineer | frontend-engineer`.
- [ ] An approved `executionAgent: engineer` Plan launches and remains conversational under Plan Engineer, including a
      resumed pre-split Session whose persisted workflow owner is `engineer`; a frontend-owned Plan remains under
      Frontend Engineer; a QUICK_FIX and its Mechanical Validation repairs remain under selectable Engineer.
      `plan-execution-runtime-boundaries.integration.test.ts` enters through `executePlan` and SessionRuntime resume
      with canonical policy input only—never a caller-supplied pre-resolved Agent—and asserts the real root Agent,
      durable workflow owner, available tools, accepted Plan Engineer `task_completed` receipt, and emitted
      `agent_changed` identity so a label-only or unused-resolver change fails.
- [ ] Pair-capable execution gives `pair_checkpoint` to Plan Engineer and Frontend Engineer. The tool accepts an active
      canonical `engineer` or `frontend-engineer` workflow, uses observable-increment base fields, and keeps optional
      browser evidence for Frontend Engineer. Pause/resume messages name the actual runtime owner, and incapable hosts
      fall back to autonomous with owner-neutral copy without rewriting the stored recommendation. Plan Engineer's
      integration scenario reaches a real checkpoint through production dispatch, not by invoking the tool directly.
- [ ] Planner, `plan_written`, Slicer prompt/schema, and Workspace Plan Review allow Pair for either owner. Workspace
      does not disable, coerce, or erase an Engineer Pair recommendation; absent/invalid recommendations still default
      to autonomous and legacy `frontend: true` remains autonomous Frontend Engineer. The extracted policy module owns
      both initial normalization and owner/style transitions; `PlanReviewSurface.tsx` contains no second owner-specific
      coercion. Its test covers `engineer -> pair`, owner changes in both directions, payload round-trip, defaults, and
      legacy input, and includes a source-boundary assertion that the surface imports and delegates to that module.
- [ ] `docs/domain-language.md` defines **Engineer**, **Plan Engineer**, **Frontend Engineer**, and **Pair Execution**
      with the new ownership/selectability meanings and states that approved PLANNED_CHANGE Plans execute through Plan
      Engineer or Frontend Engineer while QUICK_FIX belongs to Engineer.
- [ ] Focused suites and `deno task ci` pass without adding or re-baselining an injection seam.

## Approval Confirmation

No Work Records are proposed for supersession.

## Verification Plan

- Objective-focused suites:
  `deno run -A scripts/run-tests.js src/shared/session/agent-contracts.test.ts src/shared/workflow/plan-execution-runtime-boundaries.integration.test.ts src/ui/workspace/react/plan-review-policy.test.ts`.
- Broader targeted suites:
  `deno run -A scripts/run-tests.js src/shared/session/__tests__/session-tools-policy.test.js src/shared/session/agents-shared-practice.test.ts src/shared/session/session-prompt.test.js src/shared/session/agent-handler.test.ts src/shared/session/session-runtime.test.js src/cmd/agents/index.test.ts src/cmd/__tests__/getArgumentCompletions.test.js src/shared/workflow/agent-runners.integration.test.ts src/shared/workflow/plan-executor.integration.test.ts src/shared/workflow/execution-segment-handoff.test.ts src/shared/workflow/pair-execution.test.js src/shared/workflow/workflow-slicer.integration.test.ts src/tools/__tests__/pair-checkpoint.test.js src/tools/__tests__/task-completed.test.js src/tools/__tests__/plan-written.test.js`.
- Full automated gate: `deno task ci` (includes type checks, Workspace checks, tests, lint, and `seams:check`).
- Manual Agent selection: open `/agent`; only Engineer appears among the three execution identities. Enter
  `/agent plan-engineer` and `/agent frontend-engineer`; each explains workflow-only activation and leaves the active
  Agent unchanged.
- Manual workflow identity: run a small engineer-owned Plan, interrupt it, and resume it. The footer/root Agent is Plan
  Engineer before and after resume while the Plan/workflow metadata still says `executionAgent: engineer`. Route a
  frontend Quick Fix and confirm selectable Engineer accepts it and follows the frontend/browser Skills.
- Manual Pair path: in Workspace Plan Review select Engineer + Pair, approve, reopen, and confirm both values persist.
  Run it in a Pair-capable TUI and confirm a non-visual checkpoint can pause for user judgment. Run the same policy in
  an incapable host and confirm autonomous fallback does not rewrite the Plan. For the Workspace check, load the current
  frontend/browser Skills, run the normal Workspace dev server discovered from project tasks, and inspect the control in
  a headed browser at desktop and narrow widths; confirm no console or failed-request errors.
- Existing behavior to protect: atomic root switching; active workflow state survives interruption; legacy
  `frontend: true` resolves to autonomous Frontend Engineer; ACP/Headless incapable-host fallback remains autonomous;
  Frontend Engineer still requires browser preflight/evidence; QUICK_FIX still receives Mechanical Validation.
- Behavior expected to stop: Engineer executes approved Plans; Frontend Engineer handles QUICK_FIX or appears in
  `/agent`; Plan Engineer appears in manual selection; Workspace disables/coerces Engineer Pair; Pair fallback and pause
  copy always names Frontend Engineer.
- Glossary check: shipped prompt/runtime/UI behavior and `docs/domain-language.md` use the same four Agent/Pair terms.

## Edge Cases & Considerations

- **Dependencies and dirty Plans:** do not start until `remove-return-to-router-user-owned-transitions` and the narrowed
  `finish-agent-prompt-architecture-cleanup` are merged. The latter must not retain Workspace Pair scope. Re-read the
  landed prompts and `workflow-prompts.js`; both prerequisite Plans change nearby text.
- **Policy versus root identity:** never put `plan-engineer` into Plan Front Matter, Plan execution policy APIs,
  `ActiveExecutionWorkflow.executionAgent`, worktree records, or legacy migration. It is a runtime root identity only. A
  small resolver used at every activation/comparison boundary prevents projections from becoming authority.
- **In-flight compatibility:** approved Plans and resumed Sessions with persisted owner `engineer` must activate Plan
  Engineer without a migration. Historical transcripts that name Engineer remain history; new `agent_changed` events and
  footer state use Plan Engineer after activation.
- **Layered overrides:** an existing `.wld/agents/engineer.md` override now layers onto Quick Fix Engineer. Document the
  split in the bundled definition so users move Plan-execution customization to `plan-engineer.md`. Honor a merged
  `workflowOnly` override on any definition; it controls discoverability, not authorization.
- **Manual versus workflow activation:** do not weaken atomic switching or add a conditional test seam. User commands
  consult selectability before calling the runtime. Workflow code loads/switches the resolved exact Agent identity.
- **Pair capability:** the Plan stores a recommendation, not a runtime promise. TUI support can select Pair; ACP,
  Headless, canceled interactions, and other incapable hosts remain autonomous for that run without mutating the Plan.
  Semantic Review's isolated Reviewer-Feedback Engineer remains outside Pair unless another approved Plan changes it.
- **Frontend rigor:** removing QUICK_FIX from Frontend Engineer must not remove headed-browser preflight, stable dev
  server/session use, accessibility/design-system checks, or browser evidence. UI Quick Fix rigor moves to Engineer via
  `front-end-framework-use` and `agent-browser-use` Skills.
- **Downstream draft:** after this Plan lands, rewrite `mode-specific-engineer-context.md` against the split identities;
  do not build conditional Plan/Quick-Fix prompt variants that recombine them.
