# TODO

## Bugs

- [x] Memories are being stored and then lost in worktrees, mnemosyne is full of collections named after work trees. the
      memory_* tools should be worktree aware and store in the projects;s collection not a worktree's collection
- [x] CONTEXT-FORMAT file is not extracted on a fresh install.
- [x] The footer CWD and branch needs to be updates when working in a worktree. Currently it shows the main branch and
      the main CWD even when in a worktree.
- [ ] When reviewer is active the footer looses the plan name, classification and complexity. engineer too, so this is a
      general problem with the verification loop.
- [ ] Implement auto update and wld update
- [ ] During init guess the probable ci command, maybe more than 1 choice, when asking the user that the ci command is
      offer the ones found by init plus None which will not do mechanical validation (with a warning) and Other to let
      the user type a command. Then store the choice.
- [ ] Give prompt templates a front matter option to specify the wld agent to use as well as a model, thinking and
      temperature override
- [x] Investigate notification sounds
- [x] P0 before marking a plan as verified we need to check that: all changes in the worktree were actually committed,
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
- [x] silly message just say nothing if its not an epic: RunWield Epic continuation complete:
      completed_plan_has_no_parent_epic.
- [ ] in the code review surface allow the side bars to be collapsed.
  - [ ] ![alt text](image.png) the inline comments overflow the container they should wrap and have padding
- [ ] The /share link is not the preview link, is should be.
  - [ ] We should eventually have session share support in the self hosted plan sharing server.
  - [ ] the shared session html should be friendlier and only contain the messages and hide more of the cruft in
        collapsible sections.
- [x] After hitting other on a user-interview question, there's no way to go back to the multiple choice options. The
      user has to cancel the interview and the model gets nothing. Esc should go back to the multiple choice options, a
      second Esc then cancels the interview.

## Backlog

### P1 - Close the Local Planning Loop

- [ ] Implement Guided Reviews using Plannotator:
      [plans/guided-review-validation-code-reviews.md](plans/guided-review-validation-code-reviews.md).
  - Keep Guided Review v1 independent from Work Records.
  - Later: share review-analysis machinery with Recorder.

- [ ] Build Plan Finalizer for FEATURE Plans:
      [docs/prd/feature-plan-finalization-prd.md](docs/prd/feature-plan-finalization-prd.md).
  - Run a clean-context Finalizer after Planner and before the one user-facing Plan review.
  - Preserve Planner-owned design decisions, derive executable steps/verification, and return insufficiency to Planner
    instead of inventing missing decisions.
  - Update Slicer child-draft behavior so Planner, not Slicer, owns final executable FEATURE detail.

- [ ] Implement Semantic Code Review convergence:
      [docs/prd/semantic-code-review-convergence-prd.md](docs/prd/semantic-code-review-convergence-prd.md).
  - Add structured Reviewer results, a validation-owned Review Issue Ledger, stable issue identities, Engineer repair
    claims, and a two-cycle automatic semantic review limit.
  - Persist only final advisories into a managed Verified Plan appendix after successful validation/merge-back.

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

- [ ] Build FEATURE Plan Finalizer recovery hooks for long Planner sessions:
      [docs/prd/feature-plan-finalization-prd.md](docs/prd/feature-plan-finalization-prd.md),
      [docs/prd/session-context-resilience-prd.md](docs/prd/session-context-resilience-prd.md).
  - Ensure Planner rereads current drafts after compaction/continuation and Finalizer handoffs do not depend on raw
    planning transcripts.

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

- [ ] Build Personal Remote Workspace v1: [docs/prd/runwield-workspace-PRD.md](docs/prd/runwield-workspace-PRD.md).
  - Include registered Projects, private-network device pairing/revocation, the Attention Dashboard, persistent
    Sessions, Session Activation Leases, Durable Workflow Checkpoints, Plan Workflow Leases, notifications, artifact
    intelligence, cross-Project human Cymbal search, and the code-server Code Surface.
  - Preserve repository artifacts as canonical and keep TUI/ACP/Workspace sibling surfaces from creating competing
    Session or Plan workflow writers.

- [ ] Build Attached Mode starting with the Claude Code FEATURE Preview:
      [docs/prd/attached-mode-prd.md](docs/prd/attached-mode-prd.md).
  - Keep all model calls host-owned while RunWield owns Plan Lifecycle, review, worktrees, validation, recovery, Work
    Records, and memory truth.
  - Prove the full `/runwield` FEATURE journey in an uninitialized trusted repo before expanding to stable Claude,
    Codex, OpenCode, and Pi adapters.

- [ ] Build Forge Change Request Delivery:
      [docs/prd/forge-change-request-delivery-prd.md](docs/prd/forge-change-request-delivery-prd.md).
  - Preserve Direct Delivery as the unchanged default while adding a nonterminal In Review / finalization-pending path
    for GitHub and GitLab shared-repo and fork publication.
  - Prove merged delivery before marking FEATURE work Verified, bind validation evidence to the published revision, and
    keep QUICK_FIX support explicit.

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
