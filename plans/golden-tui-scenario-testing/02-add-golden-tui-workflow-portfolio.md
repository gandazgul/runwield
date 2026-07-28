---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Use the established Golden TUI Scenario harness to add the remaining role, PLANNED_CHANGE, PROJECT, block, terminal, recovery, coverage, release-tiering, and documentation portfolio."
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
collaborationRecommendation: "autonomous"
createdAt: "2026-07-26T20:04:06.042-04:00"
updatedAt: "2026-07-28T02:20:24.536Z"
status: "implemented"
origin: "internal"
parentPlan: "golden-tui-scenario-testing"
order: 2
dependencies:
    - "01-establish-golden-tui-scenario-harness"
failureReason: "Semantic Review failed to complete after 3 attempts. Validation halted."
implementedAt: "2026-07-28T00:17:19.766Z"
userVerifiedAt: null
executionReport: "- Added Golden TUI portfolio catalog, required coverage matrix/meta-test, asserted coverage helpers, and reusable synthetic event/state actions in the scenario runner.\n- Added role, PLANNED_CHANGE, PROJECT, presentation, terminal, tool-failure, recovery, and replay/hydration Golden scenario modules/tests, plus stabilized timeout diagnostics under load.\n- Added `deno task test:golden-tui:extensive`, updated language-policy baseline, and documented Golden TUI authoring, diagnostics, coverage metadata, and measured CI/release tiering in `docs/contributing.md`.\n- Verification passed: `deno task test:golden-tui`; `deno task test:golden-tui:extensive`; repeated `deno task test:golden-tui` 3x; manual diagnostic artifact check; full `deno task ci`.\n- No headed browser verification performed; scope is TUI/runtime test coverage and docs."
executionMode: "worktree"
executionBaselineTree: "503d003a6091d41f25de5b64a0e14d9a1d68b9e5"
worktreeId: "76aa7a60"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-golden-tui-scenario-testing-02-add-golden-tui-wo-76aa7a60"
worktreeBranch: "runwield/worktree/golden-tui-scenario-testing-02-add-golden-tui-wo-76aa7a60"
worktreeBaseBranch: "main"
worktreeStatus: "validation_failed"
---

# Add Golden TUI Workflow Portfolio

## Context

The first Golden TUI Scenario child Plan is verified. It added the deterministic harness, `@xterm/headless` virtual
terminal, subprocess isolation, `GoldenScenarioActor`, `runGoldenScenarioChildProcess`, scripted Plan Review surface,
scripted Runtime interaction support, disposable `createInteractiveTuiComposition`, cleanup/diagnostics contracts, and
initial scenarios for Router-to-Guide `INQUIRY`, Escape cancellation, `/help`, Plan Review persistence, faux-provider
protocol checks, Runtime interactions, and Session replacement.

This second child consumes that established public interface to cover RunWield's remaining role and workflow journeys,
plus the TUI presentation and terminal-behavior matrix that still lacks composed regression coverage. The work should be
primarily scenario authoring, reusable harness assertions, coverage inventory, and repair of real defects uncovered by
those scenarios. If the portfolio requires bypassing `SessionRuntime`, Plan Lifecycle, worktrees, validation, review, or
Session replacement, the implementation should repair or deepen the harness seam from the first slice rather than add
scenario-only shortcuts.

Use current RunWield language in new scenario names and documentation: planned executable work is `PLANNED_CHANGE`; the
existing `FEATURE` label is a legacy compatibility label and may appear only where the system under test still accepts
or emits it. The user-facing portfolio may still describe the historical "FEATURE journey" as the PLANNED_CHANGE Golden
workflow that covers planning, execution, review repair, validation, and delivery.

## Objective

Add the full Golden TUI workflow portfolio using the harness created by `01-establish-golden-tui-scenario-harness`. The
portfolio must verify:

- role journeys for Guide/`INQUIRY`, Ideator/`IDEATION` with a real interview and requested PRD synthesis,
  Operator/`OPERATION`, and Engineer/`QUICK_FIX` with Mechanical Validation;
- a PLANNED_CHANGE workflow journey, including Plan Review feedback, Planner revision/resubmission, approval/execution,
  Reviewer rejection, Engineer repair, final approval, Workflow Validation, delivery, and terminal lifecycle state;
- a clean two-child PROJECT journey, including Architect approval, real Slicer child materialization, explicit launch of
  the first child, both child PLANNED_CHANGE lifecycles, typed `session_replaced` continuation into the second child,
  and final Epic terminal state/evidence;
- suite-wide semantic coverage for user, thinking, assistant, tool, system/error, review result, validation handoff,
  select, text, spinner, keyboard-help, managed-sync, queued steering, and image presentation states, including tool
  failure and recovery;
- focused terminal behavior for Ctrl+C, slash commands/autocomplete, resize, prompts/focus restoration, queueing, and
  genuine Session replay/hydration;
- measured CI/release tiering plus authoring and diagnostic documentation.

## Approach

Author realistic, hand-written Golden scenarios and focused terminal tests that share the first slice's public harness:
`runGoldenScenarioChildProcess`, `runGoldenScenario`, `GoldenScenarioActor`, `ScriptedReviewSurface`, virtual terminal
helpers, normalized screen assertions, Runtime-event assertions, isolated environment setup, and retained failure
artifacts. Do not force all states into one artificial mega-scenario; distribute coverage across role journeys, workflow
journeys, and focused examples.

Keep production workflow modules authoritative. PLANNED_CHANGE and PROJECT Goldens must exercise real Plan Review
transactions, real Plan Lifecycle transitions, worktree creation/publication/cleanup where Direct Delivery applies,
Workflow Validation, Reviewer repair handoffs, Slicer materialization, and Session replacement. If a scenario exposes a
real defect, repair the owning module without weakening scenario expectations or adding a Golden-only bypass.

Extend the scenario harness only for general reusable needs:

- fixture helpers for temporary Git repositories, Plan files, User Requests, images, and safe tool-failure projects;
- action/assertion helpers for `waitForEvent`, `waitForIdle`, Plan status/events, worktree registry state, Git ancestry,
  Work Record/evidence checks, Session replacement identity, queued steering, replay/hydration, resize, Ctrl+C, and
  prompt focus;
- scenario coverage metadata and a coverage meta-test that fails when supported blocks/behaviors have no owning asserted
  scenario;
- diagnostics that identify the active Agent/phase/tools, unmet expectation, remaining script, normalized screen,
  semantic activity, durable state, and retained temp artifact.

Coverage declarations must be behavioral, not decorative. Prefer a small helper such as `assertsGoldenCoverage()` or
assertion wrappers that associate a coverage capability with a concrete screen/durable assertion. The coverage meta-test
should fail when a scenario declares a capability without at least one associated assertion and when an expected
capability has no owning scenario.

Measure runtime after the portfolio is stable. If the complete suite remains fast and repeatable, include it in the
ordinary quality gate. If the recovery portfolio is too expensive for every `deno task ci`, keep the critical happy-path
subset in `ci` and put the extensive suite behind an explicit release tier run by `deno task release:check` and the
release workflow. Document the measured decision and the exact commands.

## Files to Modify

- `src/ui/tui/golden-scenarios/initial-scenarios.js` and `initial-scenarios.test.js` — keep existing contract scenarios
  passing; optionally move shared exports into a catalog if the portfolio grows beyond one module.
- `src/ui/tui/golden-scenarios/role-journeys.js` and `role-journeys.test.js` — add Guide, Ideator, Operator, and
  QUICK_FIX role journeys using real terminal input, faux-provider turns, Runtime handoffs, interactions, tools, and
  durable assertions.
- `src/ui/tui/golden-scenarios/planned-change-workflow.js` and `planned-change-workflow.test.js` — add the full
  PLANNED_CHANGE planning/execution/review-repair/validation/delivery Golden journey.
- `src/ui/tui/golden-scenarios/project-workflow.js` and `project-workflow.test.js` — add the two-child PROJECT journey
  with Architect approval, Slicer materialization, explicit child launch, Session replacement, child completion, parent
  advancement, evidence, and cleanup assertions.
- `src/ui/tui/golden-scenarios/presentation-and-terminal.js` and `presentation-and-terminal.test.js` — add focused
  block, prompt, image, managed-sync, queued steering, slash/autocomplete, Ctrl+C, resize, replay/hydration, spinner,
  focus-restoration, tool-failure, and recovery scenarios that do not fit naturally in the role/workflow journeys.
- `src/ui/tui/golden-scenarios/coverage.test.js` — add the meta-test that imports the scenario catalog and enforces the
  required coverage matrix and asserted-capability contract.
- `src/ui/tui/testing/scenario-runner.js` — extend the `GoldenScenario` typedef and runner with reusable actions,
  fixture setup, coverage metadata plumbing, durable-state capture, and assertion helpers needed by the portfolio.
  Preserve subprocess isolation for composed scenarios.
- `src/ui/tui/testing/scenario-actor.js` — extend protocol checks only if the workflow portfolio needs general Agent,
  phase, tool, image, or concurrent-turn validation; fail closed on unexpected, ambiguous, missing, or unused turns.
- `src/ui/tui/testing/isolated-environment.js` — add reusable Git/worktree/image/settings fixture setup only where it
  remains isolated from the Agent-readable fixture root and real HOME/provider credentials.
- `src/ui/tui/testing/scripted-review-surface.js` — extend scripted Plan Review or Runtime interaction decisions only
  through the production `submitPlanForReview`/interaction paths.
- `src/ui/tui/testing/coverage-matrix.js` — add the supported role, Routing Intent, workflow, block, terminal behavior,
  recovery, and durable-outcome inventory plus helpers for scenario declarations and meta-test assertions.
- `src/ui/tui/testing/mod.js` — export any new general-purpose harness helpers used by scenario modules.
- `src/ui/tui/chat-session.js` — repair composed-session defects discovered by portfolio scenarios, especially startup
  ordering, cancellation, replay, focus restoration, queueing, Session replacement, idle settlement, and terminal
  lifecycle state.
- `src/ui/tui/api.js` — repair block rendering, prompt, spinner, queued-message, keyboard-help, managed-sync, image,
  review-result, validation, or error presentation defects discovered by scenarios.
- `src/ui/tui/runtime-adapter.js` — repair Runtime-event-to-TUI projection defects discovered by scenarios, especially
  review result, validation handoff, queued steering, managed sync, replay/hydration, image handling, and Session
  replacement behavior.
- `src/ui/tui/runtime-interaction-adapter.js` — repair real TUI interaction behavior discovered by portfolio scenarios
  while preserving production Plan Review and code review transaction paths.
- `deno.json` — adjust `test:golden-tui`, `ci`, or new focused/extensive Golden tasks according to measured suite
  tiering.
- `scripts/release-check.js` — include the extensive Golden portfolio tier if measured runtime makes it a release gate
  rather than an every-commit gate.
- `.github/workflows/release.yml` — run the selected Golden release tier if it is not fully covered by ordinary CI.
- `docs/contributing.md` — document how to run, author, diagnose, and intentionally update Golden TUI Scenarios,
  including their distinction from raw Session Transcript replay, browser Playwright coverage, live-model benchmarks,
  and future true-PTY smoke tests.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/tui/testing/mod.js` — current Golden harness public exports, including actor, runner, subprocess isolation,
  isolated environment, scripted review surface, virtual terminal, and child protocol.
- `src/ui/tui/golden-scenarios/initial-scenarios.js` — scenario definition conventions, composed TUI actions, protocol
  checks, Plan Review contract, Runtime interaction contract, and Session replacement contract.
- `src/ui/tui/chat-session.js:createInteractiveTuiComposition` — disposable composed TUI/session lifecycle, readiness,
  idle settlement, and Session replacement rebinding.
- `src/ui/tui/runtime-adapter.js:attachTuiRuntimeAdapter` — canonical Runtime-event-to-TUI projection, queued steering,
  image, review result, validation handoff, managed sync, and Session replacement rendering path.
- `src/ui/tui/runtime-interaction-adapter.js:createTuiInteractionAdapter` — typed select/text/approval/code-review/Plan
  Review interaction mapping.
- `src/ui/review/plan-review.js:submitPlanForReview` — production reviewed-content, execution-policy, feedback,
  approval, and lifecycle transaction; inject only a scripted review surface.
- `src/shared/session/session-runtime.js:SessionRuntime` — authoritative Session lifecycle, cancellation, queued
  messages, interactions, replay/hydration, validation, post-verification handoffs, and Epic continuation.
- `src/shared/session/session-runtime-events.js` — stable semantic Runtime event stream for scenario assertions and
  coverage mapping.
- `src/shared/workflow/plan-lifecycle.js` — canonical Plan status, lifecycle event, review, approval, validation,
  delivery, and completion state.
- `src/shared/workflow/validation.js` and validation-loop tests — Workflow Validation behavior, Reviewer rejection,
  Engineer repair, validation evidence, and terminal handoff vocabulary.
- `src/shared/workflow/epic-continuation.js` — canonical continuation behavior between child Plans and final Epic
  completion.
- `src/shared/worktree-test-helpers.js:makeRepo` — temporary Git repository setup and identity helpers for
  PLANNED_CHANGE/PROJECT scenarios.
- Existing TUI block, keybinding, slash-dispatch, prompt, runtime-adapter, runtime-interaction-adapter, managed-sync,
  replay/hydration, image, and workflow tests — expected behavior vocabulary and focused regression fixtures.
- `docs/prd/end-to-end-benchmark-harness-prd.md` and `docs/prd/agent-behavior-evaluation-prd.md` — conceptual alignment
  for future deterministic scenario/result reuse without importing benchmark scoring scope.

## Implementation Steps

- [ ] Step 1: Create the Golden scenario catalog and coverage inventory. Add `coverage-matrix.js`, scenario catalog
      exports, `coverage.test.js`, and `GoldenScenario` typedef support for asserted coverage capabilities. Include the
      required roles, Routing Intents, workflows, block types, terminal behaviors, recovery paths, and durable outcomes.
- [ ] Step 2: Add reusable harness helpers for portfolio fixtures and assertions: temporary Git repo setup, Plan file
      setup, image fixture setup, safe failing-tool fixture setup, Plan status/event assertions, worktree registry and
      Git ancestry assertions, Work Record/evidence assertions, Session replacement assertions, replay/hydration setup,
      resize/Ctrl+C/slash/autocomplete actions, and prompt focus assertions.
- [ ] Step 3: Add role journey scenarios for Guide/`INQUIRY`, Ideator/`IDEATION` with real `user_interview` flow and
      requested PRD synthesis, Operator/`OPERATION`, and Engineer/`QUICK_FIX` with Mechanical Validation. Assert active
      Agent transitions, expected tool availability, visible thinking/tool/assistant output, durable mutation policy,
      and terminal return-to-ready state.
- [ ] Step 4: Add the PLANNED_CHANGE Golden journey. Drive Router/Planner through Plan Review feedback, revise and
      resubmit the Plan, approve with execution, execute through Engineer, receive Reviewer rejection, dispatch Engineer
      repair in the same active workflow, pass final review, run Workflow Validation, record delivery evidence, publish
      or stage the execution result according to the fixture delivery mode, clean worktree registry state, and return
      the terminal to the correct post-verification state.
- [ ] Step 5: Add the two-child PROJECT Golden journey. Drive Architect Plan Review approval, real Slicer child Plan
      materialization, explicit user launch/load of the first child, both child PLANNED_CHANGE lifecycles, typed
      `session_replaced` continuation into the second child, parent Epic advancement, final Epic evidence/Work Record
      behavior enabled by the fixture, and cleanup.
- [ ] Step 6: Add presentation-state scenarios or assertions for user, thinking, assistant, tool, system/error, review
      result, validation handoff, select, text, spinner, keyboard-help, managed-sync, queued steering, image
      presentation, tool failure, and recovery. Prefer natural ownership in role/workflow journeys; use focused
      scenarios only for gaps.
- [ ] Step 7: Add terminal-behavior scenarios for Ctrl+C, slash commands/autocomplete, resize, prompts/focus
      restoration, queueing while busy, and genuine Session replay/hydration. Ensure replay/hydration uses real Session
      state rather than treating raw Session Transcript JSONL as the scenario format.
- [ ] Step 8: Repair real defects exposed in `chat-session.js`, `api.js`, `runtime-adapter.js`,
      `runtime-interaction-adapter.js`, or owning shared workflow modules without weakening Golden expectations, editing
      protected Plan Lifecycle state directly, or creating Golden-only bypass paths.
- [ ] Step 9: Run repeated timing and stability checks. Decide whether the full portfolio belongs in `deno task ci` or
      an explicit release tier, then update `deno.json`, `scripts/release-check.js`, and `.github/workflows/release.yml`
      with the measured gate.
- [ ] Step 10: Update `docs/contributing.md` with commands, authoring conventions, fixture isolation rules, diagnostics,
      coverage metadata, snapshot/update expectations, troubleshooting, CI/release tiering, and explicit non-goals.

## Verification Plan

- Automated: run `deno task test:golden-tui` and verify the complete Golden portfolio passes, including role journeys,
  PLANNED_CHANGE recovery, PROJECT continuation, presentation coverage, terminal behavior, tool-failure, and recovery
  scenarios.
- Automated: run the Golden coverage meta-test and confirm every supported role, Routing Intent, workflow, block,
  terminal behavior, recovery path, and durable outcome is declared by at least one owning scenario and backed by a
  concrete screen/behavior/durable assertion.
- Automated: run `for i in 1 2 3; do deno task test:golden-tui; done` and confirm deterministic pass/fail behavior,
  per-scenario deadlines, retained diagnostics on failure, and no leaked child processes, worktrees, branches, registry
  entries, review surfaces, temporary settings, or HOME state.
- Automated: run `deno task ci`. If the full portfolio is intentionally outside ordinary CI due to measured runtime,
  also run the documented extensive tier through `deno task release:check`.
- Automated: verify PLANNED_CHANGE durable outcomes: Plan metadata, lifecycle events, worktree branch/ancestry, staged
  or merged delivery evidence, validation results, registry/worktree cleanup, and enabled post-verification handoffs.
- Automated: verify PROJECT durable outcomes: child Plan files, parent/child lifecycle states, explicit launch
  semantics, `session_replaced` identity, final parent advancement, Epic evidence/Work Record behavior, and cleanup.
- Automated: verify role journeys preserve mutation policy: Guide remains read-only, Ideator materializes only the
  requested PRD/doc artifact, Operator performs only the requested operation, and QUICK_FIX goes through Engineer plus
  Mechanical Validation.
- Manual diagnostic check: intentionally break one portfolio expectation and confirm the failure artifact identifies the
  scenario, unmet expectation, active Agent/phase/tools, last normalized screen, semantic activity, remaining script,
  and durable temp state.
- Manual documentation check: follow the updated `docs/contributing.md` instructions from a clean checkout to run a
  focused Golden scenario, diagnose a failure, understand coverage metadata, and understand when/how to update expected
  outputs.
- No headed browser verification is required. This is TUI/test/runtime workflow coverage; browser Plan Review behavior
  remains owned by the existing Workspace/Playwright path.

## Edge Cases & Considerations

- The portfolio must not become a single brittle mega-scenario. Prefer realistic journeys plus focused tests that
  collectively cover the matrix.
- Scenario assertions should avoid prompt-text parsing as a source of Agent, phase, or workflow truth. Use model
  references, Runtime snapshots/events, workflow context, and durable lifecycle state.
- Use canonical `PLANNED_CHANGE` in new workflow assertions. Keep legacy `FEATURE` only for compatibility checks or
  existing fixture metadata that explicitly needs it.
- PLANNED_CHANGE Goldens must verify real worktree/branch publication and cleanup semantics rather than only
  conversational completion.
- PROJECT Goldens must verify decomposition followed by explicit child launch; Epic approval is not Epic execution.
- `session_replaced` must close/rebind the old Session correctly and continue in a fresh transcript; assertions should
  cover identity and visible transition without assuming one continuous model context.
- Tool failure and recovery scenarios should execute bounded real tools in isolated projects and prove writes cannot
  escape the fixture root.
- Replay/hydration scenarios should exercise genuine Session state rather than raw Session Transcript JSONL replay as a
  scenario format.
- Image, spinner, timing, UUID, port, path, duration, commit-hash, worktree suffix, and animation-frame values should be
  normalized only at the reporting/comparison edge.
- If full-suite runtime is too high for ordinary CI, the omission must be explicit, measured, documented, and covered by
  release checks rather than silently skipping important scenarios.
- Do not add live-model evaluation, sampling repetitions, scorecards, external benchmark adapters, baseline comparison,
  reports, ACP parity, or true-PTY smoke coverage in this child Plan. Preserve compatible scenario/result seams for
  future benchmark or PTY work.
