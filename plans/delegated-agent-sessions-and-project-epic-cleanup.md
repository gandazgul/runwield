---
classification: "FEATURE"
complexity: "HIGH"
summary: "Make every PROJECT Plan an Epic, remove legacy task-table/DAG machinery, and add bounded context-isolated Delegated Agent Sessions."
affectedPaths:
    - "src/constants.js"
    - "src/plan-front-matter.js"
    - "src/plan-store.js"
    - "src/tools/delegate-agent.js"
    - "src/shared/session/"
    - "src/shared/workflow/"
    - "src/cmd/load-plan/index.js"
    - "src/ui/workspace/server/plan-adapter.js"
    - "src/agent-definitions/"
    - "src/skills/"
    - "README.md"
    - "docs/plan-lifecycle.md"
    - "docs/workflows.md"
frontend: false
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-07-17T22:07:19-04:00"
status: "draft"
---

# Delegated Agent Sessions and PROJECT Epic Cleanup

## Context

RunWield currently represents the active PROJECT workflow as an Epic decomposed into child FEATURE Plans, but still
requires `type: epic` and retains compatibility code for executable PROJECT task tables and DAG scheduling. That
obsolete model leaks through Plan metadata, readiness prompts, workflow result payloads, tests, Agent instructions,
Workspace messages, and active documentation.

Large Agent Sessions also accumulate exploration and implementation details until context compaction causes drift.
RunWield already has a disposable `runIsolatedAgentSession` path used by workflow-owned Reviewer sessions, but normal
Agents and Skills cannot delegate bounded work into a fresh context and receive only the result.

## Objective

Make `classification: PROJECT` sufficient to identify every PROJECT Plan as a non-executable Epic, remove the legacy
task-table/DAG model from active code and documentation, and add a `delegate_agent` Custom Tool for bounded
context-isolated work. V1 supports foreground batches of up to three concurrent readers or one exclusive synchronous
writer; readers and writers never overlap, the parent waits for completion, and the parent remains responsible for all
delegated output and workspace changes.

## Approach

- Collapse Epic detection to `classification === "PROJECT"` everywhere. Stop emitting or interpreting `type: epic`,
  remove `type` from RunWield-owned Plan Front Matter, and allow existing files containing the field to continue loading
  as ordinary unknown metadata without changing semantics or requiring a bulk migration.
- Delete `task-scheduling.js` and remove legacy task extraction, DAG validation, task-assignment prompts, task payloads,
  task-table repair reasons, PROJECT execution approval, and facade/runtime plumbing. PROJECT approval and loading
  always route to Slicer decomposition or child FEATURE selection; `executePlan` continues to fail fast for PROJECT
  containers.
- Add one agent-facing `delegate_agent` tool with `{ mode: "read" | "write", brief: string }`. Keep it an Agent
  capability rather than a protected workflow tool so layered Agent Definition overrides can remove it.
- Back the tool with a dedicated bare Delegated Agent prompt and `runIsolatedAgentSession`. The child inherits the
  parent-selected model/thinking state and repository/project guidance, but receives no parent messages or tool results.
  It has no workflow completion/routing tools, user interaction, memory mutation, recursive delegation, or commit
  authority.
- Derive child tools by intersecting the parent Agent Session's effective tools with a mode allowlist. Read mode permits
  repository inspection tools but no shell or mutation tools. Write mode may additionally receive the parent's file-edit
  and shell tools. Dynamic parent-only Custom Tools are not inherited.
- Store a reader/writer lease in `HostedSession`: at most three readers can acquire concurrently; a writer requires zero
  readers and no writer; readers cannot enter while a writer is active. Acquire synchronously before child startup and
  release in `finally` after success, failure, or cancellation. Do not mark `delegate_agent` sequential so Pi can
  execute multiple read calls from one assistant response in parallel.
- Return the child's concise final handoff as tool content plus structured details (`ok`, `mode`, output, failure
  information, and observed changed paths). For write mode, capture a non-destructive pre/post workspace baseline so
  successful and failed calls report changed paths; preserve all partial edits and explicitly flag any environment where
  change attribution is incomplete rather than rolling files back.
- Keep automatic Semantic Reviewer execution workflow-owned with its existing `review_complete` contract. Update bundled
  Skills that currently mention an unavailable generic Agent tool to use parallel read-mode `delegate_agent` calls.

## Files to Modify

- `src/constants.js` — add the hidden Delegated Agent identifier and three-reader limit; remove the unused PROJECT-task
  concurrency constant.
- `src/plan-front-matter.js`, `src/plan-store.js`, and tests — remove `type` as RunWield-owned Plan metadata and
  classify every PROJECT Plan as an Epic while preserving unknown Front Matter fields on round-trip.
- `src/tools/delegate-agent.js` and focused tests — define the tool schema, mode-specific capability filtering, isolated
  invocation, result projection, failure handling, and changed-path reporting.
- `src/agent-definitions/workflow-prompts/delegated-agent-prompt.md` — add the minimal dedicated child identity and
  handoff rules without normal role lifecycle obligations.
- `src/shared/session/session.js` and `src/shared/session/session-prompt.test.js` — auto-wire `delegate_agent` with the
  resolved parent tools and HostedSession, load the bare child prompt, and reuse `runIsolatedAgentSession` without
  parent history.
- `src/shared/session/hosted-session.js` and `src/shared/session/hosted-session.test.js` — own and test
  HostedSession-scoped reader/writer lease state, disposal, and isolation between hosted sessions.
- `src/shared/session/tool-event-title.js` and tests — present delegation calls with stable mode/brief titles and an
  appropriate runtime tool kind.
- `src/shared/workflow/workflow-slicer.js`, `workflow-prompts.js`, `workflow.js`, `workflow-results.js`, `decisions.js`,
  `orchestrator.js`, `orchestrator.test.js`, and `workflow.test.js` — remove task-table/DAG exports, prompts, result
  fields, decisions, and compatibility branches; make PROJECT decomposition unconditional.
- `src/shared/workflow/task-scheduling.js` and `task-scheduling.test.js` — delete the retired parser, DAG validator,
  write-scope scheduler, and isolated tests.
- `src/shared/session/session-runtime.js`, `src/shared/session/agent-handler.js`, and tests — remove PROJECT task
  approval and structured-task plumbing while preserving FEATURE execution and workflow-owned isolated Agents.
- `src/cmd/load-plan/index.js` and tests — remove non-Epic PROJECT readiness/execution choices; all PROJECT Plans enter
  Epic lifecycle/decomposition behavior.
- `src/shared/workflow/collaboration-pull.js`, `guided-review.js`, and tests — stop using Plan `type` as a PROJECT/Epic
  discriminator while retaining unrelated review-record type fields.
- `src/ui/workspace/server/plan-adapter.js` and Workspace tests — derive Epic summaries, detail loading, and lifecycle
  messages solely from PROJECT classification and stop exposing Plan subtype metadata.
- `src/agent-definitions/{ideator,planner,architect,engineer,tester,guide,operator}.md` — expose `delegate_agent` to
  substantive user-facing roles; remove Architect's `type: epic` requirement and Engineer's obsolete DAG/task language.
  Router, Recorder, and workflow-only prompts do not receive the tool by default.
- `src/agent-definitions/document-formats/architect-plan-format.md` — remove `type: epic` from canonical PROJECT Plan
  Front Matter.
- `src/skills/codebase-design/` and `src/skills/improve-codebase-architecture/` — replace generic Agent-tool
  instructions with explicit read-mode `delegate_agent` parallel batches within the three-reader cap.
- `README.md`, `docs/plan-lifecycle.md`, and `docs/workflows.md` — document PROJECT-as-Epic semantics and foreground
  Delegated Agent Sessions; remove active task-table/DAG compatibility language. Preserve archived Plans, completed
  PRDs, and Work Records as historical evidence.

## Reuse Opportunities

- `src/shared/session/session.js#runIsolatedAgentSession` — fresh in-memory child lifecycle, model/thinking resolution,
  runtime event streaming, abort tracking, and guaranteed disposal.
- `src/shared/workflow/validation.js#loadReviewerPrompt` — pattern for loading a bare workflow prompt with an explicit
  tool set and no inherited conversation.
- `src/shared/workflow/workflow-results.js#extractAssistantOutput` — projection of the child's last assistant text into
  the parent tool result.
- `src/shared/workflow/git-snapshot.js#captureWorktreeTree` and `diffTrees` — non-destructive Git baseline comparison
  for delegated writer changes.
- `src/shared/session/hosted-session.js#subAgentSessions` — existing ownership and cancellation of disposable child
  sessions, extended with delegation-specific lease state rather than process globals.
- `src/shared/session/session.js#resolveEffectiveSessionToolNames` and Agent Definition frontmatter — existing effective
  tool-policy seam used to prevent delegated capability escalation.

## Implementation Steps

- [ ] Step 1: Make PROJECT intrinsically Epic by changing both cycle-free `isEpicPlan` helpers to classification-only
      checks, removing RunWield-owned `type` metadata/serialization and type-based Workspace/collaboration branches,
      updating canonical Architect output, and adding regression tests for PROJECT Plans with no subtype.
- [ ] Step 2: Delete `task-scheduling.js` and remove every task-table/DAG prompt, export, result property, workflow
      decision, SessionRuntime adapter, Agent Handler/orchestrator argument, load-plan compatibility branch, and
      corresponding test fixture; retain `task_completed` only as the execution Agent's existing completion signal.
- [ ] Step 3: Simplify PROJECT lifecycle tests and flows so approval records `epic_readiness_passed`, loading opens
      Slicer or child selection, direct `executePlan` rejects the Epic container, and no active code asks for Tasks,
      Assignees, dependencies, Integration Points, or task-table repair.
- [ ] Step 4: Add HostedSession reader/writer lease methods and constants, with tests for three concurrent readers,
      fourth-reader rejection, writer exclusivity, mixed-mode rejection, release after thrown/aborted children, disposal
      cleanup, and isolation across two HostedSessions.
- [ ] Step 5: Add the dedicated bare Delegated Agent prompt and `delegate_agent` factory. Validate bounded non-empty
      briefs, filter child tools against both parent effective tools and mode policy, forbid
      recursive/workflow/memory/user tools, inherit parent model/thinking and cwd, invoke `runIsolatedAgentSession`, and
      return only the concise final handoff to the parent context.
- [ ] Step 6: Add delegated-writer baseline/result handling. Preserve partial edits on all outcomes, report observed
      project-relative changed paths on success and failure, expose explicit attribution completeness, and never
      auto-revert or commit.
- [ ] Step 7: Auto-wire `delegate_agent` in `buildAgentSession`, add it as an optional Agent capability to the agreed
      normal Agent Definitions, and test layered tool overrides, parent capability intersection, runtime title
      projection, normal child event visibility, and absence from Router/Recorder/workflow-only sessions.
- [ ] Step 8: Update bundled review/design Skills to issue up to three read-mode calls in one assistant response and
      clarify that children run concurrently with one another while the parent waits for the batch; retain automatic
      Semantic Reviewer behavior unchanged.
- [ ] Step 9: Reconcile active README/lifecycle/workflow documentation and remove obsolete active Agent wording, while
      leaving archived Plans, done PRDs, and Work Records untouched.
- [ ] Step 10: Run formatting and the full quality gate, remove stale imports/exports and dead tests found by CI, and
      verify active-source searches contain no semantic dependency on `type: epic`, task-table PROJECT execution, or DAG
      scheduling.

## Verification Plan

- Automated: run focused tests for `hosted-session`, `session-prompt`, the new delegate tool, `plan-store`, `workflow`,
  `orchestrator`, `load-plan`, Workspace plan adapters, tool-event titles, and architecture boundaries during
  implementation.
- Automated: run `deno task ci` after all changes and fix every failure.
- Manual: invoke three `delegate_agent` read calls in one Agent response with distinct briefs; confirm all three appear
  as disposable Delegated Agent Sessions, no fourth reader is admitted, the parent receives only final handoffs in its
  model context, and it resumes after the batch.
- Manual: delegate a bounded write, confirm the parent is paused, no reader/writer overlap is admitted, edits remain in
  the current worktree, and the result reports changed paths without committing.
- Manual: force a delegated writer error or cancellation after an edit; confirm the lease is released, partial edits
  remain, failure details and changed paths return, and a later delegation can start.
- Manual: create/load a PROJECT Plan containing only `classification: PROJECT`; confirm it is grouped as an Epic, moves
  to `ready_for_decomposition`, opens Slicer/child selection, and cannot enter direct Engineer execution. Repeat with an
  older file still containing `type: epic` and confirm identical behavior without migration.
- Expected: FEATURE execution, workflow-owned Semantic Reviewer isolation, and child FEATURE lifecycle behavior remain
  unchanged.

## Edge Cases & Considerations

- Pi runs tool calls in one assistant response concurrently by default. Lease acquisition must be synchronous and
  race-safe; a mixed reader/writer batch should fail conflicting calls clearly rather than depending on call order for
  correctness.
- Parent Agents with generic write tools are not granted new privileges by delegation; the child receives only the
  intersection. Prompt scope remains the parent's responsibility, and delegation never bypasses routing or Plan
  requirements.
- Read mode must exclude `bash` because shell commands cannot be proven read-only. Write mode may inherit it, but the
  child prompt forbids commits and unrelated operations.
- Parallel children share one HostedSession event surface. Their disposable session tracking, Agent display state, event
  IDs, and cleanup must remain correct when completion order differs from launch order.
- Existing Plans may retain `type: epic` as unknown historical YAML, but no active behavior, UI message, prompt, or new
  serializer output may depend on or add it.
- Changed-path attribution is exact when a Git tree baseline is available. Non-Git or watcher-limited environments must
  report that attribution is incomplete rather than claiming no changes; partial edits are always preserved.
- The three-reader cap is a v1 constant, not durable Plan metadata. Background jobs, parent/child overlap, nested
  delegation, concurrent writers, isolated child worktrees, merge protocols, and child commits are explicitly out of
  scope.
- Historical completed PRDs, Work Records, and archived Plans intentionally retain descriptions of the retired model and
  should not be used as active behavioral specifications.
