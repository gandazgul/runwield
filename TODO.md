# TODO

## Bugs

- [ ] Install.sh should init mnemosyne global collection with `mnemosyne init --name global`
- [ ] CONTEXT-FORMAT file is not extracted on a fresh install.

- [ ] P0 before marking a plan as verified we need to check that: all changes in the worktree were actually committed,
      then that main's HEAD is not the same as the plan's base commit, then that the plan's base commit is an ancestor
      of main's HEAD. If any of these checks fail, it should dispatch engineer back to fix the merge issues before
      checking again.
- [ ] the login URLs from /login subscription models are split and only the first line is used when users clicks, the
      rest of the url appears as just text. User has to copy and paste on the browser. Fix the formatting.
- [ ] plans/session-runtime-acp-mvp/01-acp-sdk-and-stdio-entrypoint-skeleton.md says status: verified but still has
      worktreeStatus: merge_conflict and a failure reason about overlapping uncommitted\
      primary-checkout changes. That conflicts with the normal lifecycle expectation that verified worktree-backed plans
      have merged back cleanly. See docs/plan-lifecycle.md.
- [ ] MAke the last assistant message pinned to the top of the input. During validation this gets replaced by the
      validation card so you dont have 2 pins. Also in the validation card put the reviewer findings above the
      engineer's task_completed result.
- [ ] Guided review tries to use claude code???? it should use WLD instead. "failed · claude/claude-cli · 3.2s · tokens
      unavailable · cost unavailable"

## Backlog

### P1 - Close the Local Planning Loop

- [ ] Implement Guided Reviews using Plannotator:
      [plans/guided-review-validation-code-reviews.md](plans/guided-review-validation-code-reviews.md).
  - Keep Guided Review v1 independent from Work Records.
  - Later: share review-analysis machinery with Recorder.

### P2 - Frontend Execution UX

- [ ] Build Frontend Engineer + Pair Execution:
      [docs/prd/frontend-engineer-pair-execution-prd.md](docs/prd/frontend-engineer-pair-execution-prd.md),
      [plans/frontend-engineer-pair-execution.md](plans/frontend-engineer-pair-execution.md).
  - Goal: route visual/interactive frontend FEATURE Plans to Frontend Engineer.
  - Include headed browser loop, user checkpoints, and switch-to-AFK.

### P3 - Session and Runtime Reliability

- [ ] Improve Session Context Resilience:
      [docs/prd/session-context-resilience-prd.md](docs/prd/session-context-resilience-prd.md).
  - Universal Core reliability; independent of model adaptation.
  - Detect context pressure during autonomous turns, compact safely, and continue intent-preserving work.

- [ ] Finish/verify Session Host + ACP external-client work:
      [docs/prd/runwield-acp-session-host-PRD.md](docs/prd/runwield-acp-session-host-PRD.md).
  - Current memory says SessionRuntime/ACP event contract is largely consumer-ready; backlog should now focus on
    remaining external UX/integration gaps, not redoing completed runtime boundaries.

### P4 - Evaluation, Metrics, and Model Capability

- [ ] Build End-to-End Benchmark Harness:
      [docs/prd/end-to-end-benchmark-harness-prd.md](docs/prd/end-to-end-benchmark-harness-prd.md).
  - Sequence says this should come before serious Agent Behavior Evaluation graduation.

- [ ] Build Agent Behavior Evaluation:
      [docs/prd/agent-behavior-evaluation-prd.md](docs/prd/agent-behavior-evaluation-prd.md).
  - Covers Router, Engineer, Operator, runtime reliability, and future planning-role rubrics.

- [ ] Explore Selective Execution Model Adaptation:
      [docs/prd/selective-execution-model-adaptation-prd.md](docs/prd/selective-execution-model-adaptation-prd.md).
  - Depends on Agent Behavior Evaluation before any profile “graduates.”
  - Keep profiles explicit/experimental until measured.

- [ ] Add a resolved capability viewer showing each Agent's effective tools, prompt source layers, runtime narrowing,
      protected-tool reinjection, custom-tool additions, model, thinking level, and temperature source.

### P5 - Collaboration and Workspace

- [ ] Continue self-hosted Shared Plan Spaces / collaboration:
      [docs/prd/collaborative-planning-PRD.md](docs/prd/collaborative-planning-PRD.md),
      [docs/prd/runwield-workspace-PRD.md](docs/prd/runwield-workspace-PRD.md),
      [plans/collaborative-planning-remote-shared-spaces.md](plans/collaborative-planning-remote-shared-spaces.md).
  - Current Core already has share/pull/push/unshare direction; next grooming should identify remaining Phase 2 gaps:
    docs, hardening, retention, closed-plan UX, diff viewer, notifications, hosted follow-up.

- [ ] Build runwield.dev landing/docs site. Inspiration: https://itayinbarr.github.io/little-coder/

### P6 - Search, Memory, and Source Intelligence

- [ ] Decide RunWield-owned indexing direction: [docs/prd/runwield-core-prd.md](docs/prd/runwield-core-prd.md),
      [plans/unified-semantic-indexer.md](plans/unified-semantic-indexer.md).
  - Decide whether to keep Cymbal as primary, add local structural index, add semantic index, or retire old LanceDB /
    Tree-sitter language from Core PRDs.

- [ ] Build optional Colgrep semantic search extension:
      [plans/colgrep-semantic-search-extension.md](plans/colgrep-semantic-search-extension.md).

- [ ] Add refresh path for core project memories beyond `/sleep`, while keeping Mnemosyne core memories as source of the
      compressed project brief.

### P7 - Architecture / Codebase Shape

- [ ] Revisit deep semantic source modules:
      [plans/deep-semantic-source-modules.md](plans/deep-semantic-source-modules.md).
  - Decide whether this is still worth doing now, or defer until after Work Records / Frontend Engineer / Workspace
    surfaces stabilize.

### P8 - Security and Hardening

- [ ] Decide future Core guardrails: [docs/prd/runwield-core-prd.md](docs/prd/runwield-core-prd.md).
  - Clean-primary-checkout policy?
  - Dangerous shell policy in RunWield vs Pi vs user/project instructions?
  - Governance/Security Reviewer as workflow gate vs Skill/policy?

- [ ] Add Security Reviewer as optional planning/review gate for production-oriented FEATURE and PROJECT workflows.
- [ ] Make security review mode-aware so prototypes and one-off builds can bypass it.
- [ ] Investigate running restricted Agents' bash commands under a read-only OS user for stronger write barriers.
