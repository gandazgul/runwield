# TODO

- [ ] "Running CI Validation (Attempt 1/3)..." when this is happening show [spinner] in front
  - same for Running Semantic Code Review...
  - "Build and tests passed." should be in the success color from the theme

- [ ] more tests

Refactor-first (before testing) candidates:

- chat-session.js: biggest one. startInteractiveSession owns TUI construction, boot flow, init prompt, autocomplete,
  queueing, steering, cancellation, bash, slash commands, and submission processing. It wants extraction into smaller
  controllers before test growth.
- root-session.js: session manager persistence/bootstrap is hard-coupled to concrete external session APIs.

- [ ] Start implementing the code indexing (Deferred: cymbal is good for now)
- [x] When re-executing a completed plan, warn the user if files in `affectedPaths` have changed since the plan ran.
      Show a list of commits between the plan's `updatedAt` (or `createdAt`) and HEAD as a heads-up before kicking off
      execution again.
- [ ] Plan archiving: move old plans (e.g., completed > N days) into `plans/archive/` so the active plans list stays
      short. Surface archived plans only on explicit request.
- [ ] when we want to trully restrict an agent's write/edit access we should invoke bash commands with a user that has
      no write permissions on the codebase. This way even if the agent tries to use bash to modify files, it will be
      blocked by the OS permissions. We can create a separate user (e.g., "harns_operator") with read-only access to the
      codebase and run all bash commands from that user context. This adds an extra layer of security and ensures that
      agents cannot bypass their tool restrictions.

- [ ] /reload command to refresh dynamic system-prompt content on the live root AgentSession (memories, skills list,
      HARNS.md). Needed because the root AgentSession is built once per agent switch and bakes these in at construction;
      without /reload, mid-session changes to mnemosyne memories / installed skills / HARNS.md are not visible to the
      active agent until the next agent switch.
- [ ] default to this theme instead? https://github.com/ifiokjr/oh-pi/blob/main/packages/themes/themes/oh-p-dark.json

## Bugs

- Shift + tab stopped working (thinking level)?

## Roadmap / Backlog

### Project level plans breakdown

[PRD](./plans/prd/project-decomposition-PRD.md)

### Concurrent Worktrees & Execution Isolation

- [ ] Use git worktrees to let multiple Harns instances execute plans or sessions concurrently without stepping on each
      other's worktree state.
- [ ] Track each execution worktree's base branch/tree, active plan/session, lifecycle status, and merge/report-back
      path.
- [ ] Connect worktree isolation to plan recovery so `in_progress`, `failed`, and `implemented` plans can be inspected,
      resumed, reset, or merged deliberately.

### Plan Lifecycle UX

- [ ] Improve plan browsing by status (`draft`, `feedback`, `approved`, `ready_for_work`, `in_progress`, `failed`,
      `implemented`, `verified`).
- [ ] Polish recovery UX for `in_progress`, `failed`, and `implemented` plans, including scoped diffs, validation retry,
      reset-to-baseline, and re-open-for-review paths.
- [ ] Add validation reports that summarize local CI, semantic review, scoped diff, final status, and failure reasons in
      one place.
- [ ] Improve re-open/re-review flows for plans that need another approval pass.
- [ ] Separate active and archived plans so completed or stale plans do not crowd the main plan list.
- [ ] Show "what changed since this plan was approved?" summaries before execution or re-execution.

### Local Workflow Metrics

- [ ] Record local-only workflow events that help evaluate Harns' routing, planning, execution, validation, recovery,
      and model-selection decisions.
- [ ] Track practical fields such as classification, complexity, models used, time to triage, time to first plan, review
      rounds, plan outcome, slicer success, execution result, validation result, recovery action, rough context size,
      and plan age/status distribution.
- [ ] Use metrics to answer product questions: Router accuracy, where plans stall, whether Slicer improves PROJECT
      reliability, when auto-sleep should trigger, and whether worktrees reduce conflicts/recovery events.

### Memory Automation

- [ ] Define auto-sleep trigger policy around session end, memory churn, session age, context size, and plan completion.
- [ ] Offer or run `/sleep` automatically at natural boundaries rather than relying only on manual invocation.
- [ ] Add a refresh path for core project memories beyond `/sleep`, while keeping Mnemosyne core memories as the source
      of the compressed project brief.

### Model Reliability & Evaluation

- [ ] Add model fallback policy for unavailable configured models/auth: fail loudly, ask, role-based fallback, or
      cheapest known-good fallback.
- [ ] Build Router classification fixtures to evaluate routing quality across models.
- [ ] Define Planner/Architect plan-quality evaluation rubrics.
- [ ] Explore SWE-bench-style or repo-local execution harnesses for Engineer/Operator model evaluation.
- [ ] Keep provider/model-specific prompt tuning out of scope unless it emerges from clear eval data or community
      contributions.

### Agent Capability Transparency

- [ ] Add a resolved capability viewer that shows each agent's effective tools after bundled/home/local layering,
      protected-tool reinjection, runtime narrowing, and custom-tool additions.
- [ ] Surface prompt source layers and whether a layer appended to or replaced the bundled agent prompt.

### Security Review Gate

- [ ] Add Security Reviewer as an optional planning/review gate, especially for production-oriented FEATURE and PROJECT
      workflows.
- [ ] Make security review mode-aware so rapid prototypes and one-off builds can bypass it without fighting the system.
- [ ] Let Planner/Architect invoke security review when threat modeling or sensitive surfaces are relevant.

### Skills Ecosystem Stance

- [x] Document that Harns intentionally reads skills from `~/.agents/skills` and local/home/bundled skill directories
      instead of reinventing skill installation.
- [x] Document that external skill/package managers can own installation; Harns should focus on discovery, invocation,
      and clear skill loading behavior.

### Research Tracks

- [ ] Keep Cymbal as the primary code intelligence backend unless a clear gap appears.
- [ ] Explore Colgrep or similar tools as a possible complement for code search.
- [ ] Research what meaningful UI/UX assistance should look like in Harns before adding a thin Playwright-specific
      agent.
- [ ] Prefer PRD/to-issues/Ideator workflows over a standalone PM agent until there is a clear job for a PM agent to do.
