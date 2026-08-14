---
planId: "3c1c7cbd-b71b-486e-8ea2-894335f986df"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
summary: "Generalize Pair Execution from Frontend Engineer to regular Engineer so backend, architecture, migration, debugging, and repair work can use resumable user-steered checkpoints without inheriting browser-specific behavior."
affectedPaths:
    - "src/agent-definitions/engineer.md"
    - "src/agent-definitions/frontend-engineer.md"
    - "src/agent-definitions/shared-practice/"
    - "src/shared/workflow/execution-collaboration.ts"
    - "src/shared/workflow/pair-execution.js"
    - "src/shared/workflow/agent-runners.js"
    - "src/shared/workflow/workflow-prompts.js"
    - "src/shared/session/"
    - "src/tools/"
    - "src/ui/tui/"
    - "src/ui/workspace/"
    - "src/plan-store.js"
    - "docs/domain-language.md"
    - "docs/prd/runwield-core-prd.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-08-14T00:11:43-04:00"
status: "draft"
---

# Generalize Pair Execution to Engineer

## Context

RunWield currently treats Pair Execution as a Frontend Engineer capability. Its durable recommendation, runtime style,
interaction checkpoint, same-Session/worktree continuation, host capability negotiation, and switch-to-autonomous flow
are valuable for engineering work beyond browser UI. A user may want to steer a risky migration, choose an architectural
boundary after seeing repository evidence, review a defect reproduction before repair, or assess a vertical backend
slice without forcing the work into Frontend Engineer.

The shared collaboration mechanism should support both Engineer and Frontend Engineer while preserving their different
disciplines. Regular Engineer must not inherit headed-browser requirements, visual checkpoints, or frontend design
authority. Pair checkpoints remain implementation collaboration, never Task Completion or validation.

## Objective

Allow approved regular-Engineer Plans to recommend and run Pair Execution through the existing host capability and
interaction model. Preserve one execution workflow, Session, worktree, Agent context, and runtime style across multiple
checkpoints, revisions, interruption, repair, and a switch to autonomous work.

Engineer checkpoints present coherent engineering evidence and a consequential decision. Frontend Engineer checkpoints
continue to present coherent visible product increments. Both share lifecycle and interaction machinery without sharing
discipline-specific instructions.

## Approach

Extract the existing Pair collaboration contract into shared execution practice and policy, then compose
discipline-specific checkpoint guidance:

```text
approved Plan + host Pair capability
  -> resolve Pair or autonomous runtime style
  -> activate selected execution Agent
  -> shared checkpoint interaction
       Engineer: behavior, boundary, migration, reproduction, risk
       Frontend Engineer: visible UI increment and browser evidence
  -> continue / revise / switch autonomous / stop
```

Keep `collaborationRecommendation` as a recommendation resolved at execution start. Do not add a Pair Plan Status or
make pair approval equivalent to completion. The option set aside is a separate backend Pair workflow; it would
duplicate runtime ownership and interaction recovery that already work for Frontend Engineer.

## Files to Modify

- `src/agent-definitions/engineer.md` — add Pair collaboration behavior and evidence standards without frontend rules.
- `src/agent-definitions/frontend-engineer.md` — consume shared Pair practice while retaining browser-specific
  execution.
- `src/agent-definitions/shared-practice/` — define the common checkpoint contract and user-authority behavior.
- `src/shared/workflow/execution-collaboration.ts`, `pair-execution.js`, `agent-runners.js`, and `workflow-prompts.js` —
  resolve Pair for both execution owners and preserve it across continuation and repair.
- `src/shared/session/` and `src/tools/` — expose the checkpoint only in an active Pair-capable execution and persist
  the same bounded interaction semantics.
- `src/ui/tui/` and `src/ui/workspace/` — present shared Pair choices and discipline-appropriate checkpoint evidence.
- `src/plan-store.js` — accept `executionAgent: engineer` with `collaborationRecommendation: pair` under the canonical
  execution policy.
- `docs/domain-language.md` and `docs/prd/runwield-core-prd.md` — define Pair Execution as execution-agent-neutral
  collaboration and preserve specialization boundaries.

## Reuse Opportunities

- Existing `execution-collaboration.ts` runtime-style resolution.
- Existing `pair-execution.js` checkpoint state and metrics.
- Existing `pair_checkpoint` interaction tool and TUI interaction broker.
- Frontend Engineer's continue, revise, switch-to-autonomous, and stop decisions.
- Active execution workflow ownership and same-worktree repair continuation.

## Implementation Steps

- [ ] Canonical execution policy accepts `executionAgent: engineer` with either `pair` or `autonomous`, while PROJECT
      Epics remain non-executable and unsupported hosts still resolve safely to autonomous behavior.
- [ ] One shared Pair practice defines checkpoint timing, evidence, choices, persistence, interruption, and the rule
      that checkpoint approval is not completion or validation.
- [ ] Engineer receives `pair_checkpoint` only while a Pair-capable regular-Engineer workflow is active; autonomous
      work, OPERATION, unrelated Agents, and unsupported adapters cannot call it.
- [ ] Engineer checkpoints require a coherent increment and consequential decision, such as an isolated reproduction,
      selected data boundary, completed vertical behavior, migration preview, architectural trade-off, or risky repair.
- [ ] Engineer checkpoints never require a browser unless the approved Plan independently requires browser behavior;
      Frontend Engineer retains its current headed-browser and visible-evidence contract.
- [ ] Continue and revise responses preserve the same Session, active workflow, Agent, worktree, dev processes, and
      implementation context.
- [ ] **Switch to autonomous** changes only the remaining runtime collaboration style; it does not replace the Agent,
      restart implementation, or discard earlier user direction.
- [ ] **Stop** leaves the Plan and worktree in a durable resumable state with plain actions for later continuation.
- [ ] Validation and review repair preserve the selected execution owner and active collaboration style, but add a Pair
      checkpoint only when the repair contains a consequential decision requiring user judgment.
- [ ] Metrics remain content-free and distinguish execution owner from Pair/autonomous style without recording
      checkpoint text, repository content, or user feedback.
- [ ] Existing Frontend Engineer Pair behavior continues unchanged through the generalized shared core.

## Approval Confirmation

No Work Record is proposed for supersession.

## Verification Plan

- Automated: execution-policy tests accept Engineer Pair, preserve current Frontend Engineer combinations, and reject
  Pair for unsupported/non-executable owners.
- Automated: workflow tests complete at least two Engineer checkpoints with revise and continue decisions while
  retaining Session, worktree, owner, and active workflow identity.
- Automated: switch-to-autonomous and interruption/resume tests prove no execution restart or context loss.
- Automated: tool-policy tests prove `pair_checkpoint` is absent outside active Pair execution.
- Automated: validation-repair tests preserve owner/style and do not add unnecessary checkpoints.
- Automated: run focused Pair, Agent runner, Session interaction, TUI, execution-policy, and metrics suites through
  `scripts/run-tests.js`, then `deno task ci`.
- Manual: run one non-frontend Planned Change in Pair mode, revise it twice, switch the remainder to autonomous, and
  confirm the same Plan worktree and Engineer Session continue throughout.
- Expected result: Pair Execution is a shared collaboration mode, while Engineer and Frontend Engineer remain distinct
  execution disciplines.

## Edge Cases & Considerations

- Existing policy and documentation explicitly describe Pair as frontend-only; migrate every positive and negative
  assertion together.
- A checkpoint is appropriate only when the user can make a meaningful decision. Frequent narration would make Pair
  slower without improving control.
- Non-interactive hosts cannot block for Pair input and must explain their autonomous fallback once.
- A paused checkpoint must not release the active workflow or permit a competing execution owner.
- The later Engineer/Validator split will remove full-validation responsibility from Engineer; this Plan should keep
  Pair machinery independent of that prompt change.
