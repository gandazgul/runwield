# TODO

## Bugs

- [x] Fix Shift+Tab thinking-level cycling regression. It was previously implemented in
      [plans/archived/implement-thinking-level-cycling.md](plans/archived/implement-thinking-level-cycling.md), so this
      is likely a focused keybinding/session-state regression.
- [x] Recover and finish the routing intent work in
      [plans/routing-intent-guide-agent.md](plans/routing-intent-guide-agent.md).

## Current Focus / Next Up

1. Finish and verify [Improve Epic Execution Flow](plans/improve-epic-execution-flow.md).
2. Implement [Plan Archival and Retrieval](plans/implementing-plan-archival.md) before fresh Plan UI work, unless the UI
   branch is already being merged.
3. Use Plan archival to clean up verified Plans that still live in active `plans/`.
4. Resume the [Local-First Plan Management UI](plans/local-first-plan-management-ui.md) Epic children.

## Backlog

### P0 - Roadmap and Plan Hygiene

- [x] Implement plan archival/search so completed or stale plans stop crowding the active list:
      [plans/implementing-plan-archival.md](plans/implementing-plan-archival.md).
- [x] Implement first-class deferred work with `on_hold` status:
      [docs/prd/on-hold-plan-status.md](docs/prd/on-hold-plan-status.md),
      [plans/implement-on-hold-plan-status.md](plans/implement-on-hold-plan-status.md).
- [x] Keep completed PRDs in [docs/prd/done/](docs/prd/done/) and completed plans in [plans/archived/](plans/archived/).
      This is the current convention for marking roadmap artifacts done without renaming every file.

### P1 - Core Workflow UX

- [ ] Finish Plan Lifecycle UX polish: status browsing, recovery paths for `in_progress` / `failed` / `implemented`,
      validation reports, re-review flows, and "what changed since approval?" summaries. Canonical lifecycle context:
      [docs/plan-lifecycle.md](docs/plan-lifecycle.md).
- [ ] Expose compaction settings and make the current compaction behavior easier to inspect:
      [docs/prd/compaction-PRD.md](docs/prd/compaction-PRD.md).
- [x] Add `/reload` to refresh dynamic system-prompt content on the live root `AgentSession` after memory, skill, or
      `RUNWEILD.md` changes.
- [ ] Refactor before broad test expansion: `src/shared/interactive/chat-session.js` and
      `src/shared/session/root-session.js` are the main candidates.
- [ ] Add more focused tests after the refactor boundaries are clearer.

### P2 - Extension and Package Ecosystem

- [x] Allow explicitly RunWield-compatible Pi-shaped code extensions:
      [plans/archived/allow-wld-compatible-pi-extensions.md](plans/archived/allow-wld-compatible-pi-extensions.md).
- [x] Allow installed Pi packages to contribute passive slash prompt templates:
      [plans/archived/allow-wld-compatible-extension-prompts.md](plans/archived/allow-wld-compatible-extension-prompts.md).
- [x] Improve install output for ignored package skills:
      [plans/archived/message-for-ignored-pi-package-skills.md](plans/archived/message-for-ignored-pi-package-skills.md).
- [ ] Build the optional Colgrep semantic search extension:
      [plans/colgrep-semantic-search-extension.md](plans/colgrep-semantic-search-extension.md).
- [x] Continue to document that `~/.agents/skills` is the preferred skill-install path instead of implementing native
      RunWield skill installation.

### P3 - Search, Memory, and Metrics

- [ ] Revisit the native semantic indexer only after confirming the external-tool gap is still worth the complexity:
      [plans/unified-semantic-indexer.md](plans/unified-semantic-indexer.md).
- [ ] Record local-only workflow metrics for routing, planning, execution, validation, recovery, and model-selection
      decisions.
- [ ] Use those metrics to evaluate Router accuracy, plan stall points, Slicer outcomes, auto-sleep triggers, worktree
      recovery rates, and model behavior.
- [ ] Define auto-sleep trigger policy around session end, memory churn, session age, context size, and plan completion.
- [ ] Add a refresh path for core project memories beyond `/sleep`, while keeping Mnemosyne core memories as the source
      of the compressed project brief.

### P4 - Model Reliability and Capability Transparency

- [ ] Add a clear model fallback policy for unavailable configured models/auth.
- [ ] Build Router classification fixtures to evaluate routing quality across models.
- [ ] Define Planner/Architect plan-quality evaluation rubrics.
- [ ] Explore repo-local execution harnesses for Engineer/Operator model evaluation.
- [ ] Add a resolved capability viewer showing each agent's effective tools, prompt source layers, runtime narrowing,
      protected-tool reinjection, and custom-tool additions.

### P5 - Collaboration

- [ ] Revisit collaborative planning when local lifecycle/plan hygiene is stable:
      [docs/prd/collaborative-planning-PRD.md](docs/prd/collaborative-planning-PRD.md).

### P6 - Security and Hardening

- [ ] Add Security Reviewer as an optional planning/review gate for production-oriented FEATURE and PROJECT workflows.
- [ ] Make security review mode-aware so prototypes and one-off builds can bypass it.
- [ ] Investigate running restricted agents' bash commands under a read-only OS user for stronger write barriers.

### Lower Priority / Someday

- [ ] Consider making this theme the default:
      <https://github.com/ifiokjr/oh-pi/blob/main/packages/themes/themes/oh-p-dark.json>.
- [x] Theme extension support is done: [docs/prd/done/theme-extensions.md](docs/prd/done/theme-extensions.md).
- [x] PROJECT decomposition into Epic + child FEATURE plans is done:
      [docs/prd/done/project-decomposition-PRD.md](docs/prd/done/project-decomposition-PRD.md).
- [x] Vision fallback / `see_image` support is done:
      [docs/prd/done/vision-fallback-see-image.md](docs/prd/done/vision-fallback-see-image.md).
