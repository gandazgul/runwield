---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/cmd/registry.js"
    - "src/ui/tui/chat-session.ts"
    - "src/ui/tui/slash-dispatch.ts"
    - "src/shared/session/"
    - "src/shared/settings.js"
    - "src/agent-definitions/"
    - "docs/quickstart.md"
    - "docs/prd/runwield-core-prd.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-09-11"
status: "draft"
planId: "363848da-a5f1-469e-8da0-b06ed9a89da5"
---

# Skippable Onboarding Tutorial

## Context

RunWield currently offers model setup and project initialization. Neither walks a newcomer through its central value:
review a Plan before code changes, then see implementation checked, independently reviewed, and delivered.

The user requested a draft Plan for a skippable onboarding tutorial, with OpenSpec initialization as a reference.

References inspected for this proposal:

- [OpenSpec init](https://github.com/Fission-AI/OpenSpec/blob/9d4e5974e5c0d9a09b9c6c1e1eb0975e80ec4461/docs/cli.md#openspec-init)
  creates project folders, configuration, and assistant integrations. Use its clear setup entry point as a reference;
  RunWield's existing Init additionally explores the repository and captures project knowledge.
- [OpenSpec onboarding](https://github.com/Fission-AI/OpenSpec/blob/9d4e5974e5c0d9a09b9c6c1e1eb0975e80ec4461/src/core/templates/workflows/onboard.ts)
  teaches the workflow through a small real change, explaining each stage and pausing at meaningful decisions.
- [OpenSpec existing-project guide](https://github.com/Fission-AI/OpenSpec/blob/9d4e5974e5c0d9a09b9c6c1e1eb0975e80ec4461/docs/existing-projects.md)
  starts with the area the user wants to change rather than documenting the whole repository.

Current RunWield evidence: `src/ui/tui/chat-session.ts` owns the startup Init offer; `src/ui/tui/model-welcome.ts` owns
model setup; `src/cmd/init/index.ts` and `init-completion.ts` own initialization; `docs/workflows.md` describes the
existing planned-work lifecycle.

## Objective

A new user can choose a short guided first change, understand each major RunWield stage, and leave with real work and
its actual validation outcome. Every tutorial entry is optional. Skipping never prevents ordinary work.

## Approach

Draft scope: interactive TUI entry through `/onboard` and `wld onboard`, reusing existing browser review surfaces. A new
Workspace-native tutorial is deferred. The tutorial teaches the workflow through existing agents and controls; it does
not introduce another implementation agent or a second Plan lifecycle.

### Entry and skipping

- On an eligible fresh interactive startup, after model setup and the existing Init decision, show one brief offer:
  **Start tutorial**, **Skip for now**, **Don't show again**. Do not interrupt a supplied initial request, a resumed
  Session, an active workflow, or a headless invocation.
- Remember that the offer was handled at the user level so changing repositories does not repeat it. Both skip choices
  return immediately to normal input; `/onboard` remains available explicitly. Keep offer/completion preferences
  separate from project Init state.
- Displaying or skipping the offer starts no model work and creates no managed Session, Plan, or repository file. An
  explicit preference change may use the normal user-settings store.
- `/onboard` first shows the scope: a small real project change, normal model usage, and normal review/delivery choices.
  Choosing Start submits an explicit tutorial request through the ordinary Session activation path.
- If model setup or project initialization is needed, explain it and reuse the existing flow. Cancelling either returns
  to ordinary use without marking the tutorial complete. Existing initialization is not repeated.

### Guided journey

1. **Choose a real improvement.** After Start, inspect a bounded area and suggest at most three small changes with
   observable success criteria. The user can supply their own. Avoid broad migrations or invented work. Explain that
   this exercise deliberately uses a Plan so the user can experience review, even if the change could be a quick fix.
2. **Shape the request.** Briefly show how exploration clarifies the desired outcome. Mention Ideator for open product
   questions and Architect/Slicer for larger projects; do not force a tour of every agent.
3. **Plan and review.** Use Planner and ordinary Plan Review. Explain annotations, revision, Approve for Later, and
   Approve & Run when they become relevant. Practicing a revision is optional; approval remains a real decision.
4. **Implement.** The normal Plan Engineer or Frontend Engineer executes. Explain worktree isolation and how to pause or
   redirect. Narration follows actual workflow events; it never advances execution itself.
5. **Validate and deliver.** Explain project checks, independent review, any actual repairs, and available human review
   and delivery controls. Show failures honestly. Do not manufacture a failure for teaching or claim delivery before the
   normal workflow establishes it.
6. **Recap.** Link the actual Plan, available review/QA artifacts, and Work Record. Explain the outcome and how to begin
   ordinary work. Complete the tutorial only after the real change reaches RunWield Verified and the recap is shown.
   Other completion modes remain accurately labeled and can end the tutorial without counting as full completion.

Each stage gets a short explanation tied to the user's work. Optional explanations can be dismissed. Avoid repeated
Continue prompts between stages that require no user decision.

### Exit and resume

At teaching checkpoints, **Continue without tutorial** removes narration while preserving the normal workflow. **Pause
tutorial** uses existing cancellation/pause behavior to stop active work and preserve its recoverable state. The copy
must distinguish these actions. Skipping instruction never means approving a Plan, skipping validation, deleting work,
or authorizing publication.

Store the tutorial marker and necessary stage information with the existing Session persistence mechanism. Derive work
progress from the associated Plan/workflow, not duplicated tutorial statuses. Resuming the same Session offers to resume
guidance or continue ordinarily; it must not create a second Plan, execute completed steps again, or repeat delivery. If
the relationship cannot be recovered, explain the gap and offer the existing Plan/Session recovery path.

A static sample-only walkthrough was set aside because it would not demonstrate actual review and verification. A
mandatory first-run wizard was set aside because experienced users should reach their own task immediately.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/cmd/onboard/` (new), `src/cmd/registry.js`, `src/ui/tui/slash-dispatch.ts` — explicit tutorial entry and
  controls.
- `src/ui/tui/chat-session.ts`, `src/ui/tui/model-welcome.ts`, `src/cmd/init/` — place the optional offer around
  existing setup and preserve cancellation, empty-project behavior, and deferred Session activation.
- `src/shared/settings.js` and its existing schema/persistence owners — user-level offer preferences.
- `src/shared/session/` — minimum tutorial context and continuation using existing Session ownership and persistence.
- `src/agent-definitions/` or bundled instructional assets — concise teaching instructions around existing role work.
- `src/ui/tui/` — existing notices, selections, and workflow presentation; no independent review UI.
- `docs/quickstart.md`, `docs/usage.md`, `docs/prd/runwield-core-prd.md` — command help, tutorial journey, and lasting
  acceptance requirements, updated when implemented. Update `docs/domain-language.md` only if implementation introduces
  a stable term that needs definition. Do not promote this draft's proposed behavior into current documentation now.

## Reuse Opportunities

- Command registry and slash dispatch for shared entry/help semantics.
- Existing model welcome, Init completion checks, and empty-project detection for prerequisites.
- Existing Session activation, transcript continuity, workflow events, and cancellation for progress and recovery.
- Planner, Plan Review, execution handoff, validation, delivery, and Work Record generation for actual work.
- Existing TUI prompts/notices and shared browser review surfaces. Any necessary browser change follows
  `docs/design-system.md` and `src/ui/design-system/`, using semantic tokens.
- Real Git/project fixtures and composed-TUI/golden tests. No new seams for RunWield-owned machinery.

## Implementation Steps

- [ ] `/onboard` and `wld onboard` expose the same guided journey and help text, with explicit Start before discovery.
- [ ] Eligible startup offers the tutorial once; both skip choices leave ordinary input usable and survive restart
      without repeated offers. Explicit invocation remains available after skipping or completing.
- [ ] Offers and skips cause zero model calls and no managed Session or repository artifacts. Suppression works for
      initial requests, resumed Sessions, active workflows, and non-interactive use.
- [ ] Setup uses existing model/Init flows. Cancelled setup cannot create false Init or tutorial completion.
- [ ] One selected improvement becomes one ordinary draft Plan, enters real Plan Review, and executes only through the
      approved workflow. Feedback and Approve for Later behave exactly as in ordinary planned work.
- [ ] Teaching messages reflect actual stage changes and distinguish checks, review, validation, and delivery.
      Failure/repair states cannot display an invented success.
- [ ] Continue without tutorial, Pause, and resume preserve the current Plan, edits, approvals, and delivery state;
      resumption does not duplicate work.
- [ ] Verified delivery produces a useful recap with valid artifact links. A failed, paused, manually verified, or
      closed-without-verification Plan cannot masquerade as a completed verified tutorial.
- [ ] Behavioral tests cover the journeys below; command documentation and the Core PRD describe shipped behavior.

## Approval Confirmation

No Work Record supersession is proposed. Draft assumptions are TUI-first delivery, a real small project change,
user-level offer suppression, and explicit `/onboard` access after skipping. Review these with the Plan's normal scope;
creating this draft does not approve or execute it.

## Verification Plan

Use the real settings, Session, Plan, and Git owners. Fake only external capabilities such as model turns and command
execution where an existing supported boundary permits it. Resolve home/cwd through project helpers and protect tests
that mutate them with `withProcessGlobalTestLock`.

- Automated: run focused changed-file tests with `deno run -A scripts/run-tests.js <test-file-paths>`, then
  `deno task ci` (including the zero-seam check). Never use `deno test` directly.
- Composed startup: test Start, both skips, restart, another repository, explicit invocation after dismissal, existing
  users, and no-model cancellation. Assert no model calls or Session/Plan/repository writes before Start.
- Preserve existing startup coverage: empty prompt remains unpersisted, explicit requests run without interception,
  empty repositories remain usable, `/new` and loaded Sessions retain their activation/continuation behavior.
- Real temporary Git project: choose a small behavioral change with a test that fails before implementation; exercise
  Plan feedback, revision, approval, execution, validation, and verified delivery through the ordinary workflow. Assert
  the behavior and delivered Git ancestry, not just tutorial labels or task checkboxes.
- Failure path: a failing project check or reviewer finding must show the true failure/repair and prevent the verified
  recap. User Verified and close-without-verification must retain their distinct outcomes.
- Pause before approval and during execution; reload the Session and resume. Assert one Plan, preserved edits and
  approvals, and no repeated implementation or publication. Approve for Later must stop execution.
- Manual TUI/browser walkthrough: new-user Start, skip to a normal question, explicit `/onboard` after skip, annotate
  the real Plan Review, pause/resume, dismiss narration, finish a small change, and open recap artifacts. Confirm
  keyboard/cancellation behavior and concise instructions. Existing browser review rendering remains intact.
- A no-op command or scripted success narration must fail these tests: neither can deliver the required behavior,
  produce real approval evidence, preserve resumed work, or establish verified delivery.

## Edge Cases & Considerations

- Empty directory or unsuitable project: explain why a real tutorial change cannot start yet; let the user return to
  normal work and invoke `/onboard` after meaningful code exists. Do not create sample files automatically.
- Active work: explicit invocation explains the current work and offers a deliberate new Session rather than replacing
  it. An in-progress tutorial resumes its existing work.
- Large user-selected request: recommend a small useful slice; keep the full request available for ordinary planning.
- Dirty checkout, missing Git, absent real verification, unavailable browser, or publication permission: follow existing
  workflow behavior and report limitations. Do not weaken checks merely to finish the lesson. An Init placeholder
  verification command must be disclosed; never describe its successful exit as real test coverage.
- Model latency and project CI vary: present a short guided exercise, not a guaranteed completion time. Starting the
  tutorial does not grant extra commit/push permission beyond the normal user-approved workflow and repository policy.
- Cross-device tutorial narration and a standalone Workspace onboarding UI are outside this draft. Ordinary Plan and
  Session continuity remain available through existing supported surfaces.
