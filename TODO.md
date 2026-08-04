# TODO

## Slop trends

- fake tests
  - tests that do nothing
  - tests that inject real local dependencies thus hiding real interaction bugs, internal machinery should not be mocked
    in a test
  - test that dont fail if you change how the function is called (mutation checks)
- All things into 1 file
  - massive files with 1 deep module responsibility but many submodules all cramed into 1 file
- Bad types
  - any, unknown, object, Record<string, any>, Record<string, unknown>, Record<string, object>
- Huge nested loops using continue and break for control instead function calling or event driven state machines
- Very long functions, see huge loops and all in the same file, similar symptoms

## Followup for Claude

All resolved (2026-08-04):

- `handlePlanRecovery` split into typed action modules — `plans/split-plan-recovery-flow.md` verified 2026-08-03
- load-plan modules moved out of the command module — `src/cmd/load-plan/` is now `index.ts` + `plan-*.ts` modules
- 5-plans series complete: objective checks in mechanical validation, baseline checks, formalized subagent definitions,
  delegated agent roles, re-anchor agents after compaction (all verified; re-anchor committed as
  `extensions/re-anchor/index.ts`)
- execution policy moved from plan templates into planner/architect prompts
  (`executionAgent`/`collaborationRecommendation` are `plan_written` arguments; PROJECT Epics are non-executable
  containers)
- engineer prompt improved via `agent-prompt-architecture-notes.md`

## __deps refactor

Checker gap closed (2026-08-04): default-parameter implementation injection (no bag at all) is now detected by
`scripts/check-injection-seams.js`; the ratchet baseline is down to 2 seams in 1 module.

Remaining: finish and validate the capability-port migration — see Bugs → P0 (seams refactor).

## Bugs

### P0

- [ ] RunWield Objective-Failing Checks: 4 met, 0 unmet, 1 broken (5 total) — no engineer dispatch for this.
      `plans/model-welcome-auth-deps-refactor.md` is `implemented` but `worktreeStatus: validation_failed`; the broken
      check (OC5) timed out on a Vite download during golden tests — infra flake, not product. 29 files are uncommitted
      in the working tree (19 under `src/shared/`, plus `scripts/check-injection-seams.js`). Re-verify and commit.

- [ ] Session-independent validation-engine refactor: `src/shared/workflow/validation.ts` is 2,479 lines with Pi/session
      turn machinery coupling. Hard prerequisite for Attached Mode — `plans/attached-mode-claude-feature-preview.md`
      (ready_for_decomposition) must not proceed without it. Also the biggest remaining P1 file. No plan exists yet;
      write one.

- [ ] for epic child continuation, after the new session starts please add a system message with the plan details, and
      Launching Planner to review plan <plan name>... (Continuation mechanics are verified and golden-covered; the
      user-visible system message on the fresh session is what's missing.)

- [ ] planId at creation: `plan_written` and `saveChildFeaturePlans` should assign planId via one add-if-missing
      function ("make it official"). `listPlanResources` no longer backfills (done, `src/plan-store.js`), but minting is
      still lazy at execution-start / work-record generation / share. Keep `ensurePlanIdentity` as the single assigner;
      don't break downstream planId consumers.

- [ ] providing feedback and approving a plan now reopens it as if I did send feedback this is wrong, approve feedback
      should be sent to engineer and start the plan normally. (In flight:
      `plans/deterministic-plan-review-resubmission.md` is status `feedback`.)

### Others

- [ ] when resuming the session name (tab title on the terminal) should be set to the session's name which is in the
      file not the UUID — resume currently falls back to the UUID (`src/cmd/resume/index.ts` uses
      `resumed?.name || loaded.sessionManagerId`, and the snapshot name isn't reliably populated after load). Persist
      the nice name in the file and read it back on resume.

- [ ] Split Golden TUI scenarios into smaller scheduling units — partial: every scenario is its own `Deno.test` with
      child-process isolation, but all scenarios of a module still share one test file and run-tests.js parallelizes per
      file, so the biggest file is still the critical path (planned-change-workflow.test.js ≈ 6 serial scenarios).
      Options: generate one test file per scenario, or teach run-tests.js a scenario-unit adapter. Same for giant unit
      test files: `src/plan-store.test.js` (2,776) and `src/shared/session/session-runtime.test.js` (2,190).

- [ ] when resuming a quickfix, a followup message kicks up the CI run, it shouldn't we should record in the session
      that CI ran (fix planned: `plans/resume-validation-after-repair-completion.md`, ready_for_work)

- [ ] Add a Golden TUI scenario for a brand-new Plan being stashed out of main during execution: when Engineer calls
      `task_completed`, verify the missing-Plan guidance and Retry/Stop menu, restore the Plan, choose Retry, and
      confirm Workflow Validation continues without rerunning Engineer.

- [ ] Golden TUI coverage gaps remaining (most of the suggestions are now covered): assert-absence mutation policy
      (Guide writes nothing, Ideator writes only the PRD), worktree registry drains in the PLANNED_CHANGE scenario,
      malformed/hand-edited Plan file mid-workflow, QUICK_FIX through to Direct Delivery.

- [ ] the "implented" menu for load-plan needs a new option to go back to "ready for work" and load a session with
      Engineer but without submitting anything so this kind of feedback can be given.

- [ ] we need to examine ALL of the lifecycle error messages and revise them: speak product language not tech jargon,
      short (4th-grade reading level, adjusted for SE/PM audience), reassure and provide next steps.

- [ ] During init guess the probable ci command, maybe more than 1 choice, when asking the user that the ci command is
      offer the ones found by init plus None which will not do mechanical validation (with a warning) and Other to let
      the user type a command. Then store the choice.

- [ ] Give prompt templates a front matter option to specify the wld agent to use as well as a model, thinking and
      temperature override

- [ ] MAke the last assistant message pinned to the top of the input. During validation this gets replaced by the
      validation card so you dont have 2 pins. Also in the validation card put the reviewer findings above the
      engineer's task_completed result.

- [ ] in the code review surface allow the side bars to be collapsed.
  - [ ] the inline comments overflow the container they should wrap and have padding

- [ ] The /share link is not the preview link, is should be.
  - [ ] We should eventually have session share support in the self hosted plan sharing server.
  - [ ] the shared session html should be friendlier and only contain the messages and hide more of the cruft in
        collapsible sections.

- [ ] Implement this from claude: `Resume this session with:\nclaude --resume eee7ef72-6d78-4961-bcfa-668dc80b3122`
      (likely vehicle: the in-flight `plans/claude-cli-execution-backend/` work)

- [ ] Move the plan name from the footer right to the input field top line
      `-----–------------plan-name-here-with-a-color-from-theme-background--
      |
      ---------------------------------------------------------------------`
      How does this interact with the "Image in clipboard..." message

- [ ] this should be true for all repos runwield touches: [6702] 2026-07-27 13:21:06 - RunWield lifecycle repair
      ownership invariant (2026-07-27): LLM agents must never repair deterministic Plan/worktree bookkeeping such as
      status, verifiedAt, executionMode, Delivery Evidence, worktree id/path/branch/base/status, registry state, or
      publication-attempt metadata. Those fields are RunWield-owned protected state and transitions must be mechanical,
      typed, transactional, and tested. Dispatch Engineer only for genuine source-level or semantic merge conflict
      resolution; RunWield must perform pre/post-repair lifecycle bookkeeping itself and must not ask an agent to edit
      protected Plan front matter.

- [ ] Plan lifecycle bookkeeping cleanup: `plans/re-anchor-agents-after-compaction.md` still says `ready_for_work` but
      the implementation is committed (`extensions/re-anchor/index.ts`) — needs the mechanical lifecycle transition to
      match.

## Backlog

### P1 - big files

Break up these files into smaller ones, each with a single responsibility. The goal is to make the codebase easier to
navigate and maintain.

| Lines | File                                           |
| ----: | ---------------------------------------------- |
|  3592 | `src/plan-store.js`                            |
|  3342 | `src/shared/session/session.js`                |
|  2932 | `src/shared/session/session-runtime.js`        |
|  2776 | `src/plan-store.test.js`                       |
|  2479 | `src/shared/workflow/validation.ts`            |
|  2190 | `src/shared/session/session-runtime.test.js`   |
|  1691 | `src/ui/tui/chat-session.js`                   |
|  1648 | `src/shared/workflow/state-transition.ts`      |
|  1643 | `src/ui/tui/testing/scenario-runner.js`        |
|  1514 | `src/ui/workspace/static/workspace.css`        |
|  1305 | `src/shared/worktree.js`                       |
|  1285 | `src/shared/workflow/plan-lifecycle.test.js`   |
|  1277 | `src/shared/workflow/plan-lifecycle.js`        |
|  1276 | `src/shared/workflow/state-transition.test.js` |
|  1268 | `src/acp/server.test.js`                       |
|  1180 | `src/shared/work-records/work-records.test.js` |
|  1166 | `src/ui/workspace/server.js`                   |
|  1134 | `src/shared/workflow/workflow.test.js`         |
|  1133 | `src/ui/workspace/react/CodeReviewSurface.tsx` |
|  1090 | `src/ui/tui/blocks.js`                         |
|  1053 | `docs/architecture.md`                         |
|  1010 | `src/ui/workspace/server/plan-adapter.js`      |

Removed since the last table (split or migrated): `src/cmd/load-plan/index.js` (4,460 → `index.ts` 774),
`src/shared/workflow/workflow.js` (1,754 → 151), `load-plan-recovery.test.js` (→ `plan-recovery-flow.test.ts` +
`index.integration.test.ts`), `load-plan-review.test.js`, `agent-handler.test.js` (→ `agent-handler.test.ts`),
`orchestrator.test.js` (→ `orchestrator.test.ts`).

### P2 - Frontend Execution UX

Complete (2026-07-24): Frontend Engineer + Pair Execution shipped — `plans/archived/frontend-engineer-pair-execution.md`
verified; `executionAgent: "frontend-engineer"` routing, headed-browser checks, user checkpoints, and switch-to-AFK are
live.

### P3 - Session and Runtime Reliability

- [ ] Improve Session Context Resilience:
      [docs/prd/session-context-resilience-prd.md](docs/prd/session-context-resilience-prd.md).
  - Mid-run tool-result auto-compaction verified (2026-07-27) and re-anchor agents after compaction implemented; the
    universal pressure-detection + intent-preserving compaction loop from the PRD is still open.

- [ ] Finish/verify Session Host + ACP external-client work:
      [docs/prd/runwield-acp-session-host-PRD.md](docs/prd/runwield-acp-session-host-PRD.md).
  - Runtime/ACP event contract is largely consumer-ready; remaining gaps are external UX/integration (see also the
    `claude --resume` item).

### P4 - Evaluation, Metrics, and Model Capability

- [ ] Build End-to-End Benchmark Harness:
      [docs/prd/end-to-end-benchmark-harness-prd.md](docs/prd/end-to-end-benchmark-harness-prd.md).
  - Sequence says this should come before serious Agent Behavior Evaluation graduation.

- [ ] Build Agent Behavior Evaluation:
      [docs/prd/agent-behavior-evaluation-prd.md](docs/prd/agent-behavior-evaluation-prd.md).
  - Covers Router, Engineer, Operator, runtime reliability, and future planning-role rubrics.
  - Data collection has started: `router-judgements-*.csv` + annotation commits.

- [ ] Explore Selective Execution Model Adaptation:
      [docs/prd/selective-execution-model-adaptation-prd.md](docs/prd/selective-execution-model-adaptation-prd.md).
  - Depends on Agent Behavior Evaluation before any profile "graduates."
  - Keep profiles explicit/experimental until measured.

- [ ] Add a resolved capability viewer showing each Agent's effective tools, prompt source layers, runtime narrowing,
      protected-tool reinjection, custom-tool additions, model, thinking level, and temperature source.

### P5 - Collaboration and Workspace

- [ ] Build Attached Mode starting with the Claude Code FEATURE Preview:
      [docs/prd/attached-mode-prd.md](docs/prd/attached-mode-prd.md).
  - BLOCKED on the session-independent validation-engine refactor (see Bugs → P0).
  - Keep all model calls host-owned while RunWield owns Plan Lifecycle, review, worktrees, validation, recovery, Work
    Records, and memory truth.
  - Prove the full `/runwield` FEATURE journey in an uninitialized trusted repo before expanding to stable Claude,
    Codex, OpenCode, and Pi adapters.
  - Claude CLI execution backend work is in flight: `plans/claude-cli-execution-backend/`.

- [ ] Build Personal Remote Workspace v1: [docs/prd/runwield-workspace-PRD.md](docs/prd/runwield-workspace-PRD.md).
  - `plans/personal-remote-workspace-v1.md` is ready_for_work.
  - Include registered Projects, private-network device pairing/revocation, the Attention Dashboard, persistent
    Sessions, Session Activation Leases, Durable Workflow Checkpoints, Plan Workflow Leases, notifications, artifact
    intelligence, cross-Project human Cymbal search, and the code-server Code Surface.
  - Preserve repository artifacts as canonical and keep TUI/ACP/Workspace sibling surfaces from creating competing
    Session or Plan workflow writers.

- [ ] Continue self-hosted Shared Plan Spaces / collaboration:
      [docs/prd/collaborative-planning-PRD.md](docs/prd/collaborative-planning-PRD.md),
      [docs/prd/runwield-workspace-PRD.md](docs/prd/runwield-workspace-PRD.md).
  - share/pull/push/unshare shipped; next grooming should identify remaining Phase 2 gaps: docs, hardening, retention,
    closed-plan UX, diff viewer, notifications, hosted follow-up.

- [ ] Build Forge Change Request Delivery:
      [docs/prd/forge-change-request-delivery-prd.md](docs/prd/forge-change-request-delivery-prd.md).
  - PRD exists; no plan yet.
  - Preserve Direct Delivery as the unchanged default while adding a nonterminal In Review / finalization-pending path
    for GitHub and GitLab shared-repo and fork publication.
  - Prove merged delivery before marking FEATURE work Verified, bind validation evidence to the published revision, and
    keep QUICK_FIX support explicit.

- [ ] Build runwield.dev landing/docs site. Inspiration: https://itayinbarr.github.io/little-coder/

### P6 - Search, Memory, and Source Intelligence

- [ ] Decide RunWield-owned indexing direction: [docs/prd/runwield-core-prd.md](docs/prd/runwield-core-prd.md),
      [plans/unified-semantic-indexer.md](plans/unified-semantic-indexer.md).
  - Plan is on_hold. Decide whether to keep Cymbal as primary, add local structural index, add semantic index, or retire
    old LanceDB / Tree-sitter language from Core PRDs.

- [ ] Build optional Colgrep semantic search extension:
      [plans/colgrep-semantic-search-extension.md](plans/colgrep-semantic-search-extension.md).
  - Plan is on_hold.

- [ ] Add refresh path for core project memories beyond `/sleep`, while keeping Mnemosyne core memories as source of the
      compressed project brief.

- [ ] Build Team Memory sharing: [docs/prd/team-memory-sharing-prd.md](docs/prd/team-memory-sharing-prd.md).
  - Classify memory audience independently from Core importance, materialize reviewable repository text at safe
    checkpoints, and reconcile accepted Trusted Branch Team Memories back into local Mnemosyne state.
  - Never commit database/index state or activate Team Memories from untrusted branches.

- [ ] Groom remaining Work Records v1 resume points: [docs/prd/work-records-prd.md](docs/prd/work-records-prd.md).
  - Decide headless/backfill flags, edit governance, Workspace integration, external Plan import behavior, richer
    authorship/audit direction, and any deferred `wld wr` subcommands.

### P7 - Architecture / Codebase Shape

- [ ] Revisit deep semantic source modules:
      [plans/deep-semantic-source-modules.md](plans/deep-semantic-source-modules.md).
  - Plan is draft. Decide whether this is still worth doing now, or defer until after Work Records / Frontend Engineer /
    Workspace surfaces stabilize.

### P8 - Security and Hardening

- [ ] Decide future Core guardrails: [docs/prd/runwield-core-prd.md](docs/prd/runwield-core-prd.md).
  - Clean-primary-checkout policy?
  - Dangerous shell policy in RunWield vs Pi vs user/project instructions?
  - Governance/Security Reviewer as workflow gate vs Skill/policy?

- [ ] Add Security Reviewer as optional planning/review gate for production-oriented FEATURE and PROJECT workflows.
- [ ] Make security review mode-aware so prototypes and one-off builds can bypass it.
- [ ] Investigate running restricted Agents' bash commands under a read-only OS user for stronger write barriers.

- [ ] Plan human review ideas:

  - Set plan on hold
  - Send back to planner with a custom prompt, or just to review the plan to make adjustments, then re-run in the same
    worktree
  - open VS code in the work tree so the human can tweak the code directly
  - go back to implementation engineer with a custom prompt
