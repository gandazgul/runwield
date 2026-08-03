---
classification: "PLANNED_CHANGE"
workKind: "REFACTOR"
complexity: "MEDIUM"
summary: "Split src/shared/workflow/workflow.js into cohesive modules under 1000 lines while preserving workflow.js as the public entry point."
affectedPaths:
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/execution-collaboration.ts"
    - "src/shared/workflow/objective-checks-baseline.ts"
    - "src/shared/workflow/planning-agent.ts"
    - "src/shared/workflow/implementation-checkpoint.ts"
    - "src/shared/workflow/plan-executor.ts"
    - "src/shared/workflow/engineer-runner.ts"
    - "src/shared/workflow/execution-start.ts"
    - "src/shared/workflow/workflow.test.js"
    - "src/shared/workflow/pair-execution.test.js"
    - "src/shared/workflow/validation-loop-core.test.js"
    - "src/shared/workflow/architecture-boundary.test.js"
objectiveChecks:
    - id: "OC1"
      command: "test \"$(wc -l < src/shared/workflow/workflow.js)\" -lt 1000"
      rationale: "The request specifically requires workflow.js to stop being the large monolithic file; this fails on the current 1754-line entry point and passes only after it is reduced below the requested ceiling."
    - id: "OC2"
      command: "for f in src/shared/workflow/workflow.js src/shared/workflow/execution-collaboration.ts src/shared/workflow/objective-checks-baseline.ts src/shared/workflow/planning-agent.ts src/shared/workflow/implementation-checkpoint.ts src/shared/workflow/plan-executor.ts src/shared/workflow/engineer-runner.ts src/shared/workflow/execution-start.ts; do test -f \"$f\" && test \"$(wc -l < \"$f\")\" -lt 1000 || exit 1; done"
      rationale: "This can only pass when the planned cohesive split files exist and every file produced by the split is under 1000 lines."
    - id: "OC3"
      command: "grep -q 'execution-start.ts' src/shared/workflow/workflow.js && grep -q 'plan-executor.ts' src/shared/workflow/workflow.js && grep -q 'implementation-checkpoint.ts' src/shared/workflow/workflow.js"
      rationale: "This proves workflow.js remains the entry point by delegating to the new execution modules rather than being removed or left disconnected from the split."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-02T21:03:40-04:00"
updatedAt: "2026-08-03T01:26:37.061Z"
origin: "internal"
userVerifiedAt: null
routingIntent: "PLANNED_CHANGE"
sessionName: "workflow module split"
planId: "d619da97-01ea-4fca-8ad6-4152b2bbbb16"
status: "validated_reviewer"
---

# Split Workflow Entrypoint Modules

## Context

`src/shared/workflow/workflow.js` is currently a 1754-line Plan execution facade. It mixes public re-exports, Plan
execution review/recovery, Objective-Failing Check baselining, execution worktree preparation, Engineer dispatch, Pair
Execution handling, and implementation checkpointing in one file. The user request is a refactor: break this monolith
into smaller cohesive modules, keep similar things together, keep every file created from this split under 1000 lines,
and leave `workflow.js` as the entry point for existing callers.

RunWield's current domain language treats this area as Plan execution and Workflow Validation plumbing. This change does
not introduce or redefine domain terms, user-visible workflow states, Plan Lifecycle semantics, or execution behavior.

## Objective

Reshape `src/shared/workflow/workflow.js` into a small compatibility entry point that preserves its public runtime
exports and JSDoc-importable types, while moving the implementation into cohesive TypeScript modules. The refactor must
preserve existing behavior for Plan Review recovery, Approve & Run / Approve for Later, Objective-Failing Check baseline
rejection, worktree and non-Git execution preparation, Pair Execution fallback/pause messaging, implementation
checkpointing, and Session workflow context seeding.

## Approach

Use an extraction refactor rather than a behavior rewrite. Keep external callers importing `./workflow.js`; only
`workflow.js` and internal workflow modules should know about the new module layout. New production modules should be
TypeScript to satisfy the repository language policy, but avoid opportunistic TypeScript migration beyond code moved out
of `workflow.js`.

Recommended module split:

- `execution-collaboration.ts` owns execution owner resolution and collaboration-style selection:
  - `resolveExecutionOwner`
  - `CollaborationStyles`
  - `PairCheckpointDecisions`
  - `PairPauseReasons`
  - `supportsPairExecution`
  - internal/public-as-needed `selectRuntimeCollaborationStyle`
- `objective-checks-baseline.ts` owns pre-execution Objective-Failing Check baseline enforcement:
  - `ObjectiveChecksBaselineRejectionError`
  - `buildObjectiveChecksBaselineFeedback`
  - `ensureObjectiveChecksBaseline`
- `planning-agent.ts` owns `runPlanningAgent` and Plan outcome extraction.
- `implementation-checkpoint.ts` owns `finalizePlanImplementation` and internal `markActiveWorktreeStatus`.
- `engineer-runner.ts` owns Engineer/Frontend Engineer turn dispatch and pause messages:
  - `runEngineerWithPlan`
  - `buildEngineerPausedMessage`
  - `buildPairPausedMessage`
- `execution-start.ts` owns starting an active execution workflow:
  - `normalizeExecutionTargetBranch`
  - `assertReusableWorktreeTargetMatches`
  - `confirmNonGitFeaturePlanExecution`
  - `startActiveExecutionWorkflow`
- `plan-executor.ts` owns the top-level Plan execution orchestration:
  - `executePlan`
  - internal `executeSingleEngineerPlan`

`workflow.js` remains the entry point by re-exporting slicer, prompt, result, collaboration, planning, execution,
implementation-checkpoint, and execution-start APIs. If retaining existing `__deps` behavior without multiplying
injection seams requires small compatibility wrappers in `workflow.js`, those wrappers may stay there, but the
substantive logic must live in the new cohesive modules and `workflow.js` must be under 1000 lines.

Because RunWield's seam ratchet treats injection seams as architectural claims, the extraction must not add new
dependency-bag seams. Prefer passing a named internal capability object from the entry point into extracted
implementation functions instead of having every new module read `__deps`. If an existing seam is genuinely moved from
`workflow.js` into a new file, update `scripts/injection-seam-baseline.json` with explicit `--move` arguments only for
already-recorded seams; do not add new seam names or raise counts.

## Files to Modify

- `src/shared/workflow/workflow.js` — shrink to the public entry point and compatibility layer; preserve all current
  public runtime exports and JSDoc typedefs used through `import("./workflow.js")`.
- `src/shared/workflow/execution-collaboration.ts` — new TypeScript module for execution owner and autonomous/pair
  collaboration policy resolution.
- `src/shared/workflow/objective-checks-baseline.ts` — new TypeScript module for Objective-Failing Check baseline
  rejection and persistence.
- `src/shared/workflow/planning-agent.ts` — new TypeScript module for running Planner/Architect and reading
  `plan_written` outcomes.
- `src/shared/workflow/implementation-checkpoint.ts` — new TypeScript module for committing implementation completion
  through Plan Lifecycle/worktree transitions.
- `src/shared/workflow/plan-executor.ts` — new TypeScript module for `executePlan` orchestration, Plan load/review
  recovery, policy checks, metric recording, and finalization handoff.
- `src/shared/workflow/engineer-runner.ts` — new TypeScript module for Engineer/Frontend Engineer dispatch, Pair
  checkpoint tool wiring, task-completion detection, and pause messages.
- `src/shared/workflow/execution-start.ts` — new TypeScript module for Git/non-Git execution preparation, reusable
  worktree matching, Plan materialization, baseline tree capture, and active workflow installation.
- `src/shared/workflow/workflow.test.js` — update imports or expectations only where necessary to preserve behavior
  through the `workflow.js` entry point; keep behavioral coverage rather than deleting compile-failing tests.
- `src/shared/workflow/pair-execution.test.js` — keep coverage for public `resolveExecutionOwner` and
  `supportsPairExecution` via `workflow.js`.
- `src/shared/workflow/validation-loop-core.test.js` — keep coverage proving `startActiveExecutionWorkflow` seeds footer
  workflow context.
- `src/shared/workflow/architecture-boundary.test.js` — include any new high-level workflow modules that perform
  lifecycle/worktree orchestration in the lifecycle-boundary scan, so raw Plan status/front-matter writes do not
  re-enter through the split.
- `scripts/injection-seam-baseline.json` — modify only if seams are explicitly moved with the ratchet command; omit this
  file from the final diff if compatibility wrappers keep the existing seam locations/counts unchanged.

## Reuse Opportunities

- `src/shared/workflow/workflow-prompts.js` — continue using `buildEngineerRequest` / `buildSlicerRequest`; do not move
  prompt text back into execution modules.
- `src/shared/workflow/workflow-results.js` — continue using Plan/review/task completion readers rather than duplicating
  transcript scanning.
- `src/shared/workflow/objective-checks.ts` — reuse the typed Objective-Failing Check runner, baseline classification,
  and summary formatting.
- `src/shared/workflow/state-transition.ts` — keep Plan/front matter/execution preparation/implementation checkpoint
  mutations inside existing transition wrappers.
- `src/shared/workflow/plan-lifecycle.js` — continue using Plan Lifecycle predicates/events; do not write raw
  status/front matter in extracted modules.
- `src/shared/workflow/execution-plan-file.js` and `src/shared/workflow/git-snapshot.js` — reuse existing execution Plan
  materialization and baseline tree capture.
- `src/shared/worktree.js` and `src/shared/worktree-registry.js` — keep existing worktree creation, reuse, settlement,
  registry update, and cleanup primitives.

## Implementation Steps

- [ ] `src/shared/workflow/workflow.js` is under 1000 lines and remains the public entry point for current callers:
      imports from `src/shared/workflow/workflow.js` still provide the same runtime exports as before the refactor.
- [ ] `src/shared/workflow/workflow.js` preserves JSDoc typedef compatibility for `PlanOutcomeResult`,
      `PlanExecutionResult`, and `FinalizePlanImplementationOptions`, either by retaining typedef aliases or by exposing
      equivalent imported typedefs from the new modules.
- [ ] `src/shared/workflow/execution-collaboration.ts` owns `resolveExecutionOwner`, `CollaborationStyles`,
      `PairCheckpointDecisions`, `PairPauseReasons`, `supportsPairExecution`, and collaboration-style selection; those
      declarations no longer contain substantive implementation logic in `workflow.js`.
- [ ] `src/shared/workflow/objective-checks-baseline.ts` owns `ObjectiveChecksBaselineRejectionError`, baseline feedback
      construction, trusted-baseline detection, and `ensureObjectiveChecksBaseline`; baseline rejection behavior still
      reopens the Plan for Planner/Architect revision before Engineer starts.
- [ ] `src/shared/workflow/planning-agent.ts` owns `runPlanningAgent`; it still requires a Hosted Session, invokes the
      active agent with triage metadata/images, disallows return-to-router, and returns `{ outcome: "no_call" }` when no
      `plan_written` outcome is found.
- [ ] `src/shared/workflow/implementation-checkpoint.ts` owns `finalizePlanImplementation` and
      `markActiveWorktreeStatus`; it still checkpoints worktree execution before recording `implementation_finished`,
      treats validation/verified statuses as already finalized, and records `implementation_finished` workflow metrics.
- [ ] `src/shared/workflow/engineer-runner.ts` owns Engineer/Frontend Engineer dispatch and pause messaging; autonomous
      and Pair Execution still use the correct execution owner, Pair checkpoint tool, task-completed reader, and
      paused-session system messages.
- [ ] `src/shared/workflow/execution-start.ts` owns execution target normalization, reusable worktree target matching,
      non-Git consent, Git worktree preparation/reuse, Plan materialization, Objective-Failing Check baselining,
      baseline tree capture, registry verification, and `hostedSession.setActiveExecutionWorkflow`.
- [ ] `src/shared/workflow/plan-executor.ts` owns `executePlan` orchestration; it still handles Plan load failure
      recovery review, approval-action readiness, execution policy validation, PROJECT Epic rejection, Objective-Failing
      Check baseline rejection routing back to Planner/Architect, implementation checkpoint failure reporting, and
      successful completion metrics/status messages.
- [ ] No new production JavaScript files are introduced; the new production modules are `.ts` files and
      `deno task language-policy:check` remains green without expanding the JavaScript baseline.
- [ ] The extraction does not increase the injection seam ratchet. Either `src/shared/workflow/workflow.js` continues to
      own the existing dependency-bag compatibility surface, or any moved seam is transferred in
      `scripts/injection-seam-baseline.json` with explicit `--move` commands and no new seam names/counts.
- [ ] `src/shared/workflow/architecture-boundary.test.js` covers the new lifecycle/worktree orchestration modules so
      high-level workflow code continues to use Plan Lifecycle/transition APIs instead of raw status/front-matter
      writes.
- [ ] All modules created by this split are under 1000 lines; the scope does not require splitting unrelated
      pre-existing files such as `plan-lifecycle.js` or large test files.

## Verification Plan

- Automated: `deno task check`
- Automated: `deno task language-policy:check`
- Automated: `deno task seams:check`
- Automated:
  `deno run -A scripts/run-tests.js src/shared/workflow/workflow.test.js src/shared/workflow/pair-execution.test.js src/shared/workflow/validation-loop-core.test.js src/shared/workflow/architecture-boundary.test.js`
- Automated: `deno task ci`
- Expected preserved behavior:
  - Plan load failure still opens the recoverable Plan Review loop and can return saved/canceled/session-complete
    outcomes.
  - Approved PLANNED_CHANGE Plans still reject PROJECT Epic direct execution, not-ready statuses, invalid execution
    policy, already-green Objective-Failing Checks, and broken Objective-Failing Checks through the same user-visible
    paths.
  - Git execution still prepares or reuses an isolated worktree, materializes the Plan file, records
    `execution_started`, stores baseline tree evidence, verifies the registry entry, and seeds the Hosted Session active
    execution workflow.
  - Non-Git execution still requires remembered or newly confirmed consent and records in-place execution start.
  - Pair Execution still falls back to autonomous Frontend Engineer execution when the host cannot support pair
    checkpoints, and pause messages still preserve the active Plan for continuation.
  - Implementation completion still checkpoints worktree changes before Plan Lifecycle state claims implementation is
    finished.
- Expected stopped behavior: none. This is a structural refactor; no user-visible Plan execution, Review Loop, Workflow
  Validation, Pair Execution, worktree, or non-Git semantics are intentionally removed.
- Existing tests that cover reshaped code must be preserved or moved, not deleted, unless they asserted file-local
  implementation details that no longer exist. The behavioral protections above must remain covered after the split.

### Objective-Failing Checks

Type-check, lint, and existing tests would pass if this refactor did nothing, so these checks prove the requested shape
changed.

- `OC1` — `test "$(wc -l < src/shared/workflow/workflow.js)" -lt 1000` — the original entry point is no longer a
  1754-line monolith.
- `OC2` —
  `for f in src/shared/workflow/workflow.js src/shared/workflow/execution-collaboration.ts src/shared/workflow/objective-checks-baseline.ts src/shared/workflow/planning-agent.ts src/shared/workflow/implementation-checkpoint.ts src/shared/workflow/plan-executor.ts src/shared/workflow/engineer-runner.ts src/shared/workflow/execution-start.ts; do test -f "$f" && test "$(wc -l < "$f")" -lt 1000 || exit 1; done`
  — the implementation was actually split into the planned cohesive files and none of the split modules exceeds the
  requested line ceiling.
- `OC3` —
  `grep -q 'execution-start.ts' src/shared/workflow/workflow.js && grep -q 'plan-executor.ts' src/shared/workflow/workflow.js && grep -q 'implementation-checkpoint.ts' src/shared/workflow/workflow.js`
  — `workflow.js` remains the entry point by delegating to the new execution modules instead of disappearing or being
  renamed.

## Execution Policy

Engineer-owned autonomous execution is recommended. This is an internal refactor with no browser-rendered UI or live
visual judgment requirement.

## Edge Cases & Considerations

- Public entry point compatibility: many callers import `executePlan`, `runPlanningAgent`,
  `startActiveExecutionWorkflow`, `finalizePlanImplementation`, slicer helpers, prompt helpers, result readers, and type
  names from `workflow.js`; keep those imports working.
- TypeScript migration risk: moved code should use named interfaces/types for option objects and results. Do not use
  inline complex object types, `any`, `unknown`, or `object` in new TypeScript; if a value shape is genuinely dynamic,
  define a narrow union or parser helper for the fields actually read.
- Injection seam risk: splitting a file can accidentally multiply `__deps` readers. Keep the compatibility seam
  centralized or move existing seam records explicitly; never add a new seam for RunWield-owned lifecycle, registry,
  Plan-write, or worktree machinery.
- Lifecycle authority: extracted modules must continue to mutate Plan Lifecycle, Front Matter, worktree registry, and
  implementation checkpoint state through existing transition APIs and authoritative owners, not display/projection
  state.
- Scope boundary: this Plan only splits code currently in `workflow.js`. It does not require splitting unrelated large
  files already present in `src/shared/workflow/`, such as `plan-lifecycle.js` or test files.
