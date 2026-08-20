---
planId: "c2a01a4b-a4c6-43a9-97df-6cb476b34515"
classification: "PLANNED_CHANGE"
workKind: "REFACTOR"
complexity: "LOW"
summary: "Finish the remaining prompt-architecture integration by exposing Engineer Pair Execution in Workspace and reducing the Engineer execution request to runtime-only context."
affectedPaths:
    - "src/shared/workflow/workflow-prompts.js"
    - "src/shared/workflow/workflow-prompts.test.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/ui/workspace/react/PlanReviewSurface.tsx"
    - "src/ui/workspace/react/plan-review-policy.ts"
    - "src/ui/workspace/react/plan-review-policy.test.ts"
objectiveChecks:
    - id: "OC1"
      command: "! grep -q 'Execute the following plan step by step' src/shared/workflow/workflow-prompts.js && ! grep -q 'buildTriageReport(triageMeta, { plannedExecution: true })' src/shared/workflow/workflow-prompts.js"
      rationale: "The Engineer request builder must stop duplicating static process instructions and generic triage prose already owned elsewhere."
    - id: "OC2"
      command: "! grep -q 'Pair Execution is available only with Frontend Engineer' src/ui/workspace/react/PlanReviewSurface.tsx && ! grep -q 'executionAgent === \"engineer\" ? \"autonomous\"' src/ui/workspace/react/PlanReviewSurface.tsx"
      rationale: "Workspace must no longer disable or erase the Engineer Pair recommendation supported by the canonical policy and runtime."
    - id: "OC3"
      command: "deno run -A scripts/run-tests.js src/shared/workflow/workflow-prompts.test.js src/shared/workflow/workflow.test.js src/ui/workspace/react/plan-review-policy.test.ts"
      rationale: "Focused tests must protect the smaller execution-request contract and medium-neutral Workspace policy behavior."
objectiveCheckWaivers:
    []
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-05T15:03:52-04:00"
status: "verified"
origin: "internal"
implementedAt: "2026-08-17T21:11:18.678Z"
verifiedAt: "2026-08-18T00:25:20.693Z"
userVerifiedAt: null
executionReport: "- Implemented `buildEngineerRequest` as a dynamic context envelope: approved Plan name, optional Router handoff, resolved runtime-style sentence, projected Plan body, and optional approval annotations.\n- Removed `triageMeta` from Engineer request options and from both `engineer-runner.ts` execution handoff paths; execution owner, images, and Pair tool selection remain unchanged.\n- Kept `buildTriageReport` unchanged for non-execution callers.\n- Updated prompt tests for pair/autonomous runtime values, optional section ordering, Front Matter removal, exact projected body preservation, Router handoff, approval annotations, and absence of removed duplicate prose.\n- Test accounting: net Deno.test delta is -1 across touched files. The removed `workflow.test.js` planned documentation Work Kind request test was deleted because that request behavior no longer exists; the old completion/Triage prompt tests were rewritten against the new envelope and absence guarantees.\n- Verification passed: `deno run -A scripts/run-tests.js src/shared/workflow/workflow-prompts.test.js src/shared/workflow/workflow.test.js`; `deno task check`; OC1 grep check.\n- Verification failed: `deno task ci` failed in TUI golden validation/publication scenarios after 328 files passed; logs show unused scripted Runtime interaction and missing visible transcript text in golden publication tests.\n- Objective check issue: saved Plan OC2/OC3 still refer to deferred Workspace Pair policy scope and a missing `src/ui/workspace/react/plan-review-policy.test.ts` file, so those checks are not valid for this approved cleanup scope."
workRecord:
    status: "failed"
    lastAttemptAt: "2026-08-18T00:25:26.490Z"
    error: "No API key found for claude-cli. Use /login to log into a provider via OAuth or API key. See: /var/folders/hw/zrm0bqr90xz63nflnb2g_qqr0000gn/T/deno-compile-wld/docs/providers.md /var/folders/hw/zrm0bqr90xz63nflnb2g_qqr0000gn/T/deno-compile-"
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-08-18T00:25:19.849Z"
validationCheckpoint: null
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "de29b2bd126fb6307ffeda6d71ba93c0a4f6cf27"
    targetBranch: "main"
    targetHeadBeforeMerge: "a4ea40ead0a2651a48b3d05848f80027da2ca8b3"
validationCiAttempts: 0
validationObjectiveCheckAttempts: 0
validationSemanticRounds: 0
updatedAt: "2026-08-19T19:36:16.588Z"
archivedAt: "2026-08-19T19:36:16.588Z"
archivedFromStatus: "verified"
archivedFromPath: "docs/plans/finish-agent-prompt-architecture-cleanup.md"
---

# Finish Agent Prompt Architecture Cleanup

## Context

The prompt-architecture work has substantially landed: Engineer and Frontend Engineer compose named shared-practice
fragments; the shared layer has drift and medium-neutrality tests; Pair Execution is supported for either execution
agent by Plan policy and the runtime; execution agents re-anchor on the Plan after compaction; and verification honesty,
test-change accounting, and falsifiable Verification Plans are now canonical instructions.

Three integration leftovers remain:

- Workspace's Plan Review surface still disables Pair Execution when `executionAgent` is `engineer`, rewrites a stored
  Engineer Pair recommendation to `autonomous` while reading review data, and says Engineer always runs autonomously.
  That contradicts `resolvePlanExecutionPolicy`, Planner, shared Plan execution practice, and runtime selection.
- `buildEngineerRequest` still injects “Execute the following plan step by step” and a completion ceremony already owned
  by the Engineer/process prompt. Editing the Markdown can therefore leave a second stale copy in code.
- The same builder still renders the generic seven-field `buildTriageReport` for planned execution. Routing intent,
  classification, session name, complexity, summary, and affected paths compete with the approved Plan as statements of
  the task. The execution agent needs the Plan plus genuinely runtime-only context, not a second reconstruction of Plan
  Front Matter.

This is the remaining narrow cleanup from `agent-prompt-architecture-notes.md`; that working-notes file is superseded by
this Plan and should stay deleted.

## Objective

Make the shipped surfaces agree with the completed architecture: Workspace allows Pair Execution for either execution
agent, and the Engineer handoff contains only the approved Plan identity/body and context that can exist only at
runtime.

## Approach

Keep static behavior in composed Agent Markdown. `buildEngineerRequest` should assemble dynamic data only:

- approved Plan name and body;
- optional Router handoff;
- active runtime collaboration style as a value, without repeating its ceremony;
- optional approval annotations.

Do not change the generic `buildTriageReport` contract used by Router handoffs, Plan presentation, Slicer, or Epic
continuation. Planned execution simply stops using that generic presentation.

Extract the Workspace execution-policy normalization into a small typed pure helper so Engineer Pair behavior is
testable without rendering the full React surface. `PlanReviewSurface.tsx` consumes that helper and enables the same
`pair | autonomous` choices for Engineer and Frontend Engineer.

## Files to Modify

- `src/shared/workflow/workflow-prompts.js` — reduce `buildEngineerRequest` to approved-Plan and runtime-only context;
  retain `buildTriageReport` for its other callers.
- `src/shared/workflow/workflow-prompts.test.js` — replace assertions for duplicated completion/triage prose with the
  new dynamic-only contract and explicit absence checks.
- `src/shared/workflow/workflow.test.js` — remove or reshape the planned Work Kind prose assertion that depended on the
  generic triage rendering.
- `src/ui/workspace/react/PlanReviewSurface.tsx` — stop disabling Pair for Engineer, stop coercing Engineer Pair to
  autonomous, and correct the stale tooltip.
- `src/ui/workspace/react/plan-review-policy.ts` — new typed, UI-independent normalization helper for review execution
  policy.
- `src/ui/workspace/react/plan-review-policy.test.ts` — prove canonical and legacy payload normalization preserves a
  valid Engineer Pair recommendation and defaults only absent/invalid recommendations.

## Reuse Opportunities

- `resolvePlanExecutionPolicy` in `src/plan-store.js` is the canonical semantic model: Pair is valid for either
  execution agent and missing collaboration metadata defaults to autonomous.
- `selectRuntimeCollaborationStyle` in `src/shared/workflow/execution-collaboration.ts` already handles host capability
  fallback; Workspace must preserve the recommendation rather than pre-resolving runtime capability.
- `src/agent-definitions/shared-practice/plan-execution.md` owns Pair/autonomous ceremony and checkpoint rules.
- Existing scalar readers in `PlanReviewSurface.tsx` can move with the pure policy helper instead of being duplicated.

## Implementation Steps

- [ ] `buildEngineerRequest` no longer emits the static “Execute the following plan step by step” or “Complete all
      Implementation Steps…” instructions, and it does not call `buildTriageReport` for planned execution.
- [ ] An Engineer request still names the approved Plan, includes the exact Plan body, preserves an optional Router
      handoff and approval annotations, and identifies the active runtime collaboration style without restating
      checkpoint or completion ceremony.
- [ ] `buildTriageReport` and all non-execution callers retain their existing structured rendering; this change does not
      alter Router, Slicer, Plan presentation, or Epic continuation contracts.
- [ ] Workspace Plan Review offers Pair and Autonomous for both `engineer` and `frontend-engineer`, and its explanatory
      copy no longer claims Engineer always runs autonomously or that Pair is frontend-only.
- [ ] Reading review data preserves `executionAgent: "engineer"` with `collaborationRecommendation: "pair"`; absent or
      invalid recommendations still normalize to `autonomous`.
- [ ] Workspace continues to store the Planner recommendation, not the host-resolved runtime style. An incapable host
      may fall back to autonomous later through `selectRuntimeCollaborationStyle` without rewriting Plan metadata.
- [ ] Focused tests cover positive Engineer/Frontend Pair cases, autonomous defaults, legacy frontend policy, dynamic
      Engineer request fields, and the absence of the removed duplicated prose.

## Verification Plan

- Automated: run the three Objective-Failing Checks from Front Matter.
- Automated: `deno task check`.
- Automated: `deno task workspace:check`.
- Automated: `deno task ci`.
- Manual: open a PLANNED_CHANGE Plan in Workspace review, select Engineer, choose Pair Execution, approve, reopen the
  Plan, and confirm both selections remain visible.
- Manual: execute that approved Plan in a Pair-capable TUI and confirm the runtime exposes `pair_checkpoint`; load the
  same Plan in an incapable host and confirm the existing visible autonomous fallback occurs without changing the stored
  recommendation.
- Existing behavior to preserve: generic triage reports still render all fields supplied by their callers; approval
  annotations and Router handoff text remain ordered before the Plan body; legacy `frontend: true` Plans still resolve
  to autonomous Frontend Engineer execution.
- Expected behavior to stop existing: Engineer requests restate process/completion rules and Plan Front Matter as a
  generic Triage Report; Workspace disables or silently erases Engineer Pair selection.

## Edge Cases & Considerations

- Runtime collaboration style is host-capability-dependent; Plan Review edits only the recommendation and must not guess
  whether the eventual execution host supports checkpoints.
- A Plan body may contain headings identical to handoff headings. Tests should assert section ordering and exact body
  preservation rather than parse arbitrary Plan Markdown as a unique heading grammar.
- Durable per-step checkbox progress is intentionally not part of this Plan. Re-anchoring now restores the Plan after
  compaction, while adding step-level lifecycle state would require new transactional semantics for Plan revision,
  retry, recovery, and worktree reconciliation. No current failure demonstrates that larger mechanism is needed.
- There is no separate Planner request builder equivalent to `buildEngineerRequest`: initial planning receives the
  routed user request and triage handoff directly. The Planner-builder audit therefore requires no code change here.
