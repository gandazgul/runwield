# TODO

## Bugs

- [ ] P0 "RunWield Workflow halted: User code review exited without approval or feedback." Workflow halt is meaningless,
      unless the user explicitly said stop runwield should never end the workflow early. In that example a qustion
      should oppear, Re-open review or Stop, stop IS the user deciding to stop then halt just because the user asked,
      else re open the review.

- [ ] P0 break up this file! src/shared/workflow/validation.js and convert it to TS

- [ ] golden TUI claude's suggestions:

  planned-change-review-repair-validation-delivery no longer reaches composition idle. It passes at the prior commit and
  fails with my scenario-runner changes; the scenario consumes its whole script and the workflow completes, so it's
  harness, not product. I isolated it to scenario-runner.js but not to the specific change, and I stopped rather than
  keep guessing. That's the one thing I'd pick up first.

  Highest value — the seams that just broke.

  1. Epic completion and parent advancement: the last child verifies → Epic advances → Work Record → registry fully
     drained. This is where both remaining anomalies live.
  2. Resume after interruption: kill a child mid-execution, reopen, /load-plan epic → recovery options. Every bug I hit
     was a stale-snapshot or precondition bug, and recovery is nothing but preconditions.
  3. Concurrent Plans: two Plans executing in one Project — the planId backfill bug was a lock/ordering bug, and nothing
     currently exercises contention.

  Real user journeys with no coverage. 4. /load-plan itself — the richest untested surface in the codebase (hold/resume,
  reset-to-draft, re-review, user-verify, archive, worktree recovery). I read a lot of it today; almost none is covered
  end-to-end. 5. Validation failure paths: CI fails → repair → retry → exhausts rounds. Today only the happy path and
  one reviewer rejection are covered. 6. QUICK_FIX through to Direct Delivery (currently stops at Mechanical
  Validation). 7. Non-Git in-place execution — a whole delivery mode with no Golden coverage, and the mode the old fake
  code silently used.

  Strengthening what exists. 8. Assert absence: Guide writes nothing, Ideator writes only the PRD. Mutation-policy
  claims are currently assertions about screen text, not the filesystem. 9. Assert the worktree registry drains in the
  PLANNED_CHANGE scenario too, not just PROJECT. 10. A malformed/hand-edited Plan file mid-workflow — front-matter
  parsing is load-bearing for every precondition and is only unit-tested.

-
  - [ ] Composition tests — the guarantee only exists when parts compose, so it can only be observed there.
  - Mutation checks — break the call on purpose; if nothing goes red, the test is decorative. That's how I found eleven
    ancestry tests passing with reversed arguments.
  - Structural enforcement — no seam at all, plus a ratchet so it can't come back.

Today, planId is assigned lazily by ensurePlanIdentity (plan-store.js:2941), and only four production callers ever
trigger it:

┌──────────────────────────────────────┬───────────────────────────────────────────────────────────────────────────────────────────┐
│ Caller │ When it fires │
├──────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────┤
│ workflow.js:1158 │ execution start — only if triageMeta.planId is absent │
├──────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────┤
│ work-records/generation.js:349 │ work record generation │
├──────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────┤
│ cmd/plans/share.js:136 │ wld plans share │
├──────────────────────────────────────┼───────────────────────────────────────────────────────────────────────────────────────────┤
│ listPlanResources({backfillMissing}) │ defaults to true — Workspace plan list, doctor --repair, registry migration,
findPlanById │
└──────────────────────────────────────┴───────────────────────────────────────────────────────────────────────────────────────────┘

plan_written has zero planId handling — I grepped the whole file, no matches. savePlan doesn't assign one. Neither does
saveChildFeaturePlans, the Slicer's child-creation path.

So your Plan had no id because nothing had happened to need one yet. Planner wrote the file, you approved it — and
neither step touches identity.

The part I'd call a genuine footgun: listPlanResources defaults to backfillMissing: true, so a read-shaped function
writes to Plan files as a side effect. That's why ids seem to appear at random moments — whichever of the Workspace,
doctor, or registry migration happens to run first silently stamps them in. It also means a Plan's id can be minted by a
background surface rather than a lifecycle event.

Should plan_written assign one? Yes — but it isn't sufficient on its own.

For it:

- plan_written is where RunWield adopts an authored Plan. Everything downstream keys on planId — registry binding
  (addEntry outright throws without one), hierarchy, Workspace routing (server.js:427,432,437), sharing, work records.
- It would erase a whole doctor issue class (registry_missing_plan_id) and the entire legacy-migration branch in
  worktree-registry.js:72-138, which exists purely because ids arrive late.
- It removes a lock hazard: ensurePlanIdentity takes catalog → plan, while the execution transition holds plan without
  catalog. Minting ids at creation keeps the catalog lock out of the execution path entirely.

The catch:

- plan_written is called repeatedly (initial write, then again after review feedback), so assignment must be
  create-if-absent, never regenerate. ensurePlanIdentityLocked already has exactly that semantic.
- It doesn't cover Slicer children, which are created by saveChildFeaturePlans. Those would stay lazy.

So the shape I'd suggest is "assign wherever RunWield creates or adopts a Plan file" — plan_written and
saveChildFeaturePlans — and then flip listPlanResources to backfillMissing: false by default so listing stops writing.
doctor --repair keeps the explicit backfill as the one place that heals older Plans.

That makes identity a lifecycle fact from birth instead of a side effect of whoever reads first.

Want me to implement that? It's three focused changes plus turning the default off, and I'd keep ensurePlanIdentity as
the single assigner so there's still exactly one place that mints ids.

✻ Cogitated for 1m 29s ~413k uncached · /clear to start fresh
───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
❯ saveChildFeaturePlans should also do the same thing, both tools that declare a plan should then assign a planId to
"make it official" add if missing should always be the policy make a single function that does this. Keep the other lazy
additions although I would remove the one from listPlanResources, a read function has no business having write side
effects, make sure this doesnt now break something downstream that required plan id

- [ ] P0 Guided review tries to use claude code???? it should use WLD instead. "failed · claude/claude-cli · 3.2s ·
      tokens unavailable · cost unavailable"
- [ ] wld plans doctor is usless it just vomits all plans again, make this actually give actionable feedback about
      broken plans and what to do.
- [ ] When reviewer is active the footer looses the plan name, classification and complexity. engineer too, so this is a
      general problem with the verification loop.
- [ ] Implement auto update and wld update
- [ ] During init guess the probable ci command, maybe more than 1 choice, when asking the user that the ci command is
      offer the ones found by init plus None which will not do mechanical validation (with a warning) and Other to let
      the user type a command. Then store the choice.
- [ ] Give prompt templates a front matter option to specify the wld agent to use as well as a model, thinking and
      temperature override
- [ ] this should be true for all repos runwield touches: [6702] 2026-07-27 13:21:06 - RunWield lifecycle repair
      ownership invariant (2026-07-27): LLM agents must never repair deterministic Plan/worktree bookkeeping such as
      status, verifiedAt, executionMode, Delivery Evidence, worktree id/path/branch/base/status, registry state, or
      publication-attempt metadata. Those fields are RunWield-owned protected state and transitions must be mechanical,
      typed, transactional, and tested. Dispatch Engineer only for genuine source-level or semantic merge conflict
      resolution; RunWield must perform pre/post-repair lifecycle bookkeeping itself and must not ask an agent to edit
      protected Plan front matter.
- [ ] plans/session-runtime-acp-mvp/01-acp-sdk-and-stdio-entrypoint-skeleton.md says status: verified but still has
      worktreeStatus: merge_conflict and a failure reason about overlapping uncommitted\
      primary-checkout changes. That conflicts with the normal lifecycle expectation that verified worktree-backed plans
      have merged back cleanly. See docs/plan-lifecycle.md.
- [ ] MAke the last assistant message pinned to the top of the input. During validation this gets replaced by the
      validation card so you dont have 2 pins. Also in the validation card put the reviewer findings above the
      engineer's task_completed result.
- [ ] in the code review surface allow the side bars to be collapsed.
  - [ ] ![alt text](image.png) the inline comments overflow the container they should wrap and have padding
- [ ] The /share link is not the preview link, is should be.
  - [ ] We should eventually have session share support in the self hosted plan sharing server.
  - [ ] the shared session html should be friendlier and only contain the messages and hide more of the cruft in
        collapsible sections.
- [x] After hitting other on a user-interview question, there's no way to go back to the multiple choice options. The
      user has to cancel the interview and the model gets nothing. Esc should go back to the multiple choice options, a
      second Esc then cancels the interview.
- [ ] Implement this from claude: `Resume this session with:\nclaude --resume eee7ef72-6d78-4961-bcfa-668dc80b3122`

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
