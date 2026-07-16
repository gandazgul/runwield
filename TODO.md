# TODO

## Bugs

- [ ] a draft epic should not offer "Open or resume Slicer decomposition" in /load-plan; it should offer "Open or resume
      Architect decomposition" instead.

Proposed todo before I change code:

1. Change “Reviewer stopped without review_complete” handling
   - Do not mark validation failed/halted immediately.
   - Leave the active agent/session with Reviewer so user can say “continue”, ask clarifying questions, or steer it.

2. Only advance workflow when review_complete exists
   - Validation should resume/continue only after a valid review_complete tool result is present.
   - No semantic approval/rejection decision should be inferred from ordinary Reviewer text.

3. Handle malformed review_complete as recoverable
   - If the tool call is malformed/invalid, show corrective feedback to Reviewer.
   - Keep Reviewer active and allow it to re-call review_complete.

4. Differentiate failure reasons in status/metrics
   - Split:
     - no_review_complete_yet
     - malformed_review_complete
     - actual semantic rejection
     - invocation/runtime failure
   - Avoid labeling missing tool call as “Semantic Review failed after retry.”

5. Add/update tests
   - Reviewer stops without tool → workflow does not halt; stays with Reviewer / returns a waiting state.
   - Malformed tool result → corrective feedback, no halt.
   - Valid review_complete approved/rejected → existing workflow behavior continues.
   - Runtime invocation error can still be treated as actual failure/retry path.

Approve this direction and I’ll implement.

- [ ] /load-plan is not offering architect review for draft epics instead the option is to launch slicer.

## Backlog

runwield.dev for now - inspiration: https://itayinbarr.github.io/little-coder/

### P1 - Core Workflow UX

- [ ] finish work records
- [ ] Implement Guided Reviews using plannotator

```markdown
Large changesets are hard to review top-to-bottom in file order. A Guided Review has an agent organize the current
changeset — any PR or local diff — into importance-ordered chapters: the heart of the change first, its consequences
next, glue last. Each section pairs a prose overview and per-file summaries with the live diffs it covers, and those
diffs are the real diff viewer — annotations made inside a guide land in the same review state and export in the same
feedback as everywhere else.

Open it with the Guide button in the review header or Mod+Shift+G, pick an engine and model, and generate. Sections
track their own reviewed state so you can work through a big change across sittings. Guides run on Claude or Codex
natively, and on Cursor, OpenCode, Pi, or GitHub Copilot CLI when installed. Every changed file is validated against the
real diff server-side, so a guide can never invent files or drop them silently.

A one-time intro dialog announces the feature on first open, and the Guide button carries a subtle hint until the first
time you use it.
```

### P2 - Extension and Package Ecosystem

- [ ] Build the optional Colgrep semantic search extension:
      [plans/colgrep-semantic-search-extension.md](plans/colgrep-semantic-search-extension.md).

### P3 - Search, Memory, and Metrics

- [ ] Record local-only workflow metrics for routing, planning, execution, validation, recovery, and model-selection
      decisions.
- [ ] Use those metrics to evaluate Router accuracy, plan stall points, Slicer outcomes, auto-sleep triggers, worktree
      recovery rates, and model behavior.
- [ ] Define auto-sleep trigger policy around session end, memory churn, session age, context size, and plan completion.
- [ ] Add a refresh path for core project memories beyond `/sleep`, while keeping Mnemosyne core memories as the source
      of the compressed project brief.

### P4 - Model Reliability and Capability Transparency

- [x] Add a clear model fallback policy for unavailable configured models/auth.
- [x] Build Router classification fixtures to evaluate routing quality across models.
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
