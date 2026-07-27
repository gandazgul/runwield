---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Use the established Golden TUI Scenario harness to add the remaining role, FEATURE, PROJECT, block, terminal, recovery, coverage, release-tiering, and documentation portfolio."
affectedPaths:
    - "src/ui/tui/golden-scenarios/"
    - "src/ui/tui/testing/"
    - "src/ui/tui/chat-session.js"
    - "src/ui/tui/api.js"
    - "src/ui/tui/runtime-adapter.js"
    - "src/ui/tui/runtime-interaction-adapter.js"
    - "scripts/release-check.js"
    - ".github/workflows/release.yml"
    - "docs/contributing.md"
    - "deno.json"
executionAgent: "engineer"
createdAt: "2026-07-27T00:04:06.042Z"
updatedAt: "2026-07-27T00:04:06.042Z"
status: "draft"
origin: "internal"
parentPlan: "golden-tui-scenario-testing"
order: 2
dependencies:
    - "01-establish-golden-tui-scenario-harness"
---

# Add Golden TUI Workflow Portfolio

## Context

The first Golden TUI Scenario FEATURE establishes the deterministic harness, virtual terminal, subprocess isolation,
model actor, scripted interaction surface, cleanup, diagnostics, and initial Router-to-Guide proof. This second FEATURE
consumes that stable public interface to cover RunWield's remaining role and workflow journeys, plus the TUI
block/terminal behavior matrix that currently lacks composed regression coverage.

This slice should be mostly scenario authoring and real defect repair. If the portfolio requires redesigning the runner
or bypassing Runtime/workflow behavior, that is a signal to repair or extend the first slice's harness seam rather than
creating scenario-specific internal shortcuts.

## Objective

Add the full Golden TUI workflow portfolio using the same public harness interface created by
`01-establish-golden-tui-scenario-harness`. The portfolio must verify:

- Guide/`INQUIRY`, Ideator/`IDEATION` with interview and requested PRD synthesis, Operator/`OPERATION`, and
  Engineer/`QUICK_FIX` with Mechanical Validation;
- a FEATURE journey with Plan Review feedback, Planner revision/resubmission, approval/execution, Reviewer rejection,
  Engineer repair, final approval, Workflow Validation, delivery, and terminal lifecycle state;
- a clean two-child PROJECT journey with Architect approval, real Slicer child materialization, explicit launch of the
  first child, both child FEATURE lifecycles, `session_replaced` continuation into the second child, and final Epic
  terminal state/evidence;
- suite-wide semantic coverage of user, thinking, assistant, tool, system/error, review result, validation handoff,
  select, text, spinner, keyboard-help, managed-sync, queued steering, and image presentation states, including tool
  failure and recovery;
- focused terminal behavior including Ctrl+C, slash commands/autocomplete, resize, prompts/focus restoration, queueing,
  and genuine Session replay/hydration;
- measured CI/release tiering and authoring/diagnostic documentation.

## Approach

Author realistic, hand-written Golden scenarios and focused terminal tests that share the first slice's scenario runner,
model actor, virtual terminal, normalization, interaction scripting, and durable assertions. Do not force all blocks or
terminal behaviors into one artificial mega-scenario; distribute coverage across realistic journeys and focused
examples.

Use semantic assertions as the main oracle: normalized screen text, Runtime events, workflow outcomes, Plan metadata,
filesystem state, Git ancestry, worktree registry state, Session replacement identity, validation evidence, Work
Records, and cleanup semantics. Scenario metadata may declare coverage capabilities, but every declared capability must
be backed by a behavioral or screen assertion. Add a coverage meta-test that fails when supported blocks/behaviors have
no owning asserted scenario.

Keep production workflow modules authoritative. FEATURE and PROJECT goldens must exercise real Plan Review transactions,
real Plan Lifecycle transitions, worktree creation/publication/cleanup, validation, review handoffs, Slicer
materialization, and Session replacement. If a scenario exposes a real defect, repair the owning module without
weakening scenario expectations or adding a Golden-only bypass.

Measure runtime after the portfolio is stable. If the complete suite remains fast and repeatable, include it in the
ordinary quality gate. If the recovery portfolio is too expensive for every `deno task ci`, keep a critical
deterministic subset in `ci` and place the extensive tier in `deno task release:check` and the release workflow.
Document the measured decision.

## Files to Modify

- `src/ui/tui/golden-scenarios/` — add role, FEATURE, PROJECT, block, terminal, recovery, coverage, fixture, and
  assertion scenarios using the established harness interface.
- `src/ui/tui/testing/` — extend the harness only where the portfolio needs general reusable assertions, coverage
  inventory support, fixture helpers, or diagnostics; avoid scenario-specific shortcuts.
- `src/ui/tui/chat-session.js` — repair real composed-session defects discovered by portfolio scenarios, especially
  around startup ordering, cancellation, replay, focus restoration, queueing, Session replacement, and terminal
  lifecycle state.
- `src/ui/tui/api.js` — repair block rendering, prompt, spinner, queued-message, keyboard-help, managed-sync, image,
  review-result, validation, or error presentation defects discovered by scenarios.
- `src/ui/tui/runtime-adapter.js` — repair Runtime-event-to-TUI projection defects discovered by scenarios, especially
  review result, validation handoff, queued steering, managed sync, replay/hydration, and Session replacement behavior.
- `src/ui/tui/runtime-interaction-adapter.js` — repair real TUI interaction behavior discovered by portfolio scenarios
  while preserving the production Plan Review and Code Review transaction paths.
- `deno.json` — adjust `test:golden-tui`, `ci`, or related test tasks according to measured suite tiering.
- `scripts/release-check.js` — include the extensive Golden portfolio tier if measured runtime makes it a release gate
  rather than an every-commit gate.
- `.github/workflows/release.yml` — run the selected Golden release tier if it is not fully covered by ordinary CI.
- `docs/contributing.md` — document how to run, author, diagnose, and intentionally update Golden TUI Scenarios,
  including their distinction from Session replay, browser Playwright coverage, live-model benchmarks, and future PTY
  smoke tests.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/tui/testing/` from `01-establish-golden-tui-scenario-harness` — public scenario runner, virtual terminal,
  subprocess isolation, actor, scripted interactions, normalization, durable assertions, cleanup, and diagnostics.
- `src/ui/tui/golden-scenarios/` initial examples — scenario definition conventions and fixture organization.
- `src/shared/session/session-runtime.js:SessionRuntime` — authoritative Runtime transitions, interactions,
  cancellation, queued messages, Session replacement, and Epic continuation.
- `src/shared/session/session-runtime-events.js` — stable semantic event stream for assertions and coverage mapping.
- `src/shared/workflow/plan-lifecycle.js` — canonical Plan status, lifecycle event, review, approval, validation,
  delivery, and completion state.
- `src/shared/workflow/validation.js` — Workflow Validation behavior and evidence to assert after FEATURE execution.
- `src/shared/workflow/epic-continuation.js` — canonical continuation behavior between child FEATURE Plans and final
  Epic completion.
- `src/shared/worktree-test-helpers.js:makeRepo` — temporary Git repository setup and identity helpers for
  FEATURE/PROJECT scenarios.
- Existing TUI block, keybinding, slash-dispatch, prompt, runtime-adapter, runtime-interaction-adapter, managed-sync,
  and workflow tests — expected behavior vocabulary and focused regression fixtures.
- `docs/prd/end-to-end-benchmark-harness-prd.md` and `docs/prd/agent-behavior-evaluation-prd.md` — conceptual alignment
  for future reuse of deterministic scenario/result seams without importing benchmark scoring scope.

## Implementation Steps

- [ ] Step 1: Add role journey scenarios for Guide/`INQUIRY`, Ideator/`IDEATION` with a real interview and requested PRD
      synthesis, Operator/`OPERATION`, and Engineer/`QUICK_FIX` with Mechanical Validation, using real terminal input
      and Runtime/workflow transitions.
- [ ] Step 2: Add a FEATURE Golden journey that covers Plan Review feedback, Planner revision and resubmission, approval
      and execution, Reviewer rejection, Engineer repair, final approval, Workflow Validation, delivery evidence,
      worktree/branch publication, registry cleanup, and terminal lifecycle state.
- [ ] Step 3: Add a two-child PROJECT Golden journey that covers Architect approval, real Slicer child FEATURE
      materialization, explicit user launch/loading of the first child, both child FEATURE lifecycles, typed
      `session_replaced` continuation into the second child, and final Epic evidence/terminal state.
- [ ] Step 4: Add realistic and focused coverage for TUI presentation states: user, thinking, assistant, tool,
      system/error, review result, validation handoff, select, text, spinner, keyboard-help, managed-sync, queued
      steering, image presentation, tool failure, and recovery.
- [ ] Step 5: Add focused terminal behavior tests for Ctrl+C, slash commands/autocomplete, resize, prompts/focus
      restoration, queueing, and genuine Session replay/hydration.
- [ ] Step 6: Add or extend scenario coverage metadata and a coverage meta-test that fails when supported block/terminal
      capabilities lack an owning scenario with actual behavioral or screen assertions.
- [ ] Step 7: Repair any real defects exposed in the owning Runtime, workflow, TUI, adapter, review, validation,
      worktree, or lifecycle modules without weakening scenario expectations or creating Golden-only bypass paths.
- [ ] Step 8: Run repeated suite timing and stability checks, decide whether the full portfolio belongs in
      `deno task ci` or an explicit release tier, and update `deno.json`, `scripts/release-check.js`, and
      `.github/workflows/release.yml` accordingly.
- [ ] Step 9: Update `docs/contributing.md` with commands, authoring conventions, fixture isolation rules, diagnostics,
      snapshot update expectations, troubleshooting, CI/release tiering, and explicit non-goals.

## Verification Plan

- Automated: run the full `deno task test:golden-tui` portfolio and verify Guide, Ideator, Operator, QUICK_FIX, FEATURE
  recovery, PROJECT continuation, block coverage, terminal behavior, and recovery scenarios pass.
- Automated: run the coverage meta-test and confirm every supported block/terminal capability is both declared and
  asserted by at least one scenario.
- Automated: run `for i in 1 2 3; do deno task test:golden-tui; done` and confirm deterministic pass/fail behavior,
  per-scenario deadlines, and no leaked child processes, worktrees, branches, registry entries, review surfaces,
  temporary settings, or HOME state.
- Automated: run `deno task ci`. If the full portfolio is intentionally outside ordinary CI due to measured runtime, run
  the documented extensive tier through `deno task release:check` as well.
- Automated: verify FEATURE scenario durable outcomes: Plan metadata, lifecycle events, worktree branch/ancestry,
  staged/merged delivery evidence, validation results, registry/worktree cleanup, and enabled post-verification
  handoffs.
- Automated: verify PROJECT scenario durable outcomes: child FEATURE files, correct parent/child lifecycle states,
  explicit launch semantics, `session_replaced` identity, final parent advancement, Epic evidence/Work Record behavior,
  and cleanup.
- Manual diagnostic check: intentionally break one portfolio expectation and confirm the failure artifact identifies the
  scenario, unmet expectation, active Agent/phase/tools, last normalized screen, semantic activity, remaining script,
  and durable temp state.
- Manual documentation check: follow the new `docs/contributing.md` instructions from a clean checkout to run a focused
  Golden scenario, diagnose a failure, and understand when/how to update expected outputs.
- No headed browser verification is required. This is TUI/test/runtime workflow coverage; browser Plan Review behavior
  remains owned by the existing Workspace/Playwright path.

## Edge Cases & Considerations

- The portfolio must not become a single brittle mega-scenario. Prefer realistic journeys plus focused tests that
  collectively cover the matrix.
- Scenario assertions should avoid prompt-text parsing as a source of Agent or phase truth. Use model references,
  Runtime snapshots/events, workflow context, and durable lifecycle state.
- FEATURE goldens must verify real worktree/branch publication and cleanup semantics rather than only conversational
  completion.
- PROJECT goldens must verify decomposition followed by explicit child launch; Epic approval is not Epic execution.
- `session_replaced` must close/rebind the old Session correctly and continue in a fresh transcript; assertions should
  cover identity and visible transition without assuming one continuous model context.
- Tool failure and recovery scenarios should execute bounded real tools in isolated projects and prove writes cannot
  escape the fixture root.
- Replay/hydration scenarios should exercise genuine Session state rather than raw Transcript JSONL replay as a scenario
  format.
- Image, spinner, timing, UUID, port, path, duration, commit-hash, and animation-frame values should be normalized only
  at the reporting/comparison edge.
- If full-suite runtime is too high for ordinary CI, the omission must be explicit, measured, documented, and covered by
  release checks rather than silently skipping important scenarios.
- Do not add live-model evaluation, sampling repetitions, scorecards, external benchmark adapters, baseline comparison,
  reports, ACP parity, or PTY smoke coverage in this FEATURE. Preserve compatible scenario/result seams for future
  benchmark or PTY work.
