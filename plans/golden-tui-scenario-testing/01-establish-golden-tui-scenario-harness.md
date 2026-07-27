---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Build the reusable deterministic Golden TUI Scenario machinery and prove it with the initial Router-to-Guide vertical plus focused cancellation and slash-command examples."
affectedPaths:
    - "deno.json"
    - "deno.lock"
    - "src/ui/tui/chat-session.js"
    - "src/ui/tui/tui.js"
    - "src/ui/tui/tui-manager.js"
    - "src/ui/tui/api.js"
    - "src/ui/tui/runtime-adapter.js"
    - "src/ui/tui/runtime-interaction-adapter.js"
    - "src/ui/tui/boot-logo.js"
    - "src/ui/tui/managed-session-sync.js"
    - "src/ui/tui/testing/"
    - "src/ui/tui/golden-scenarios/"
executionAgent: "engineer"
createdAt: "2026-07-27T00:04:06.040Z"
updatedAt: "2026-07-27T00:04:06.040Z"
status: "draft"
origin: "internal"
parentPlan: "golden-tui-scenario-testing"
order: 1
dependencies:
    []
---

# Establish Golden TUI Scenario Harness

## Context

RunWield has many focused tests around TUI blocks, Runtime events, workflow lifecycle, and Plan Review adapters, but it
does not yet have a deterministic test harness that launches the composed `pi-tui` application, drives real terminal
input, observes the rendered screen, and verifies durable Runtime/workflow state. The Golden TUI Scenario Epic requires
exactly two stages; this first FEATURE establishes the reusable machinery and proves it with a small set of
vertical/focused scenarios.

This work should preserve production behavior. Production CLI startup must continue to use `ProcessTerminal`; tests
should supply a virtual implementation of `pi-tui`'s Terminal interface. User input must travel through terminal input
and real focus handling. `SessionRuntime`, Agent Definitions, model resolution, Pi's Agent loop, protected-tool policy,
real tools, workflow orchestration, Plan Lifecycle, Session replacement, and validation remain systems under test rather
than bypassed implementations.

## Objective

Create a deep, test-facing Golden TUI Scenario harness that hides terminal emulation, child-process isolation,
deterministic model scripting, interaction decisions, Runtime observation, cleanup, normalization, and diagnostics
behind a small public interface. Prove that interface with:

- a Router-to-Guide `INQUIRY` scenario where Router emits a real `triage_report`, Runtime switches to Guide, Guide may
  make a read-only tool call, and the answer appears through normal thinking/tool/assistant blocks;
- an Escape cancellation example that interrupts active work and returns to a usable Editor;
- a representative non-destructive slash-command example such as `/help` driven through real terminal input and command
  dispatch;
- focused contract tests for actor dispatch, unexpected/missing/unused scripted turns, unavailable tools, timeouts,
  child crashes, failure artifacts, and cleanup;
- a narrow Plan Review transaction contract proving scripted review decisions can pass through real
  `submitPlanForReview` without implementing the full FEATURE workflow portfolio yet.

## Approach

Separate the composed interactive TUI/session lifecycle from process ownership, then build the Golden harness around
that seam. The harness should launch complete scenarios in a fresh Deno subprocess with isolated HOME, project, git,
settings, session, model, worktree, and registry state established before importing RunWield modules. Use
`@xterm/headless` as the test-only virtual terminal adapter aligned with the pinned `@earendil-works/pi-tui` version.

Use Pi's faux-provider capability for deterministic text, thinking, tool calls, response IDs, timestamps, and response
factories. Wrap it in a RunWield scenario actor that validates declared Agent identity, workflow phase, available tools,
interaction sequence, and remaining responses. Dispatch scripted responses by declared Agent/phase identity rather than
a process-global FIFO.

Keep assertions semantic-first: normalized screen text, Runtime events, workflow outcomes, filesystem/Git facts, and
Plan metadata should be primary. Sparse layout snapshots may exist only for stable layouts. The failure path should
retain a normalized last screen, Runtime/event summary, active Agent/workflow state, unmet expectation, remaining
script, and temp artifact path long enough to diagnose issues while successful runs clean up completely.

For Plan Review, inject only a scripted review surface/decision behind the production `submitPlanForReview` transaction.
Do not return approved/rejected values directly from a fake Runtime interaction result, because that would skip
reviewed-content persistence and lifecycle events.

## Files to Modify

- `deno.json` — add the test-only xterm dependency/import and expose a focused `test:golden-tui` task for the harness
  and initial scenarios.
- `deno.lock` — capture dependency changes for `@xterm/headless` or related test-only packages.
- `src/ui/tui/chat-session.js` — split disposable interactive-session composition from the process-owned startup
  wrapper, expose deterministic readiness/idle lifecycle, accept established adapters/dependencies, and preserve
  startup, replay, submission, handoff, replacement, and CLI process-exit behavior.
- `src/ui/tui/tui.js` — preserve the production singleton while allowing explicit Terminal/TUI composition for tests and
  safe repeated disposal.
- `src/ui/tui/tui-manager.js` — harden injected Terminal/TUI lifecycle so partial initialization and repeated disposal
  cannot leave stale terminal state.
- `src/ui/tui/api.js` — make UI-owned animation, prompt, tool, and block resources participate in explicit composition
  cleanup without exposing block internals as the scenario interface.
- `src/ui/tui/runtime-adapter.js` — forward explicit interaction dependencies and dispose Runtime subscriptions/adapters
  reliably.
- `src/ui/tui/runtime-interaction-adapter.js` — support scripted review surfaces through the real Plan Review
  transaction seam while keeping TUI interaction behavior intact.
- `src/ui/tui/boot-logo.js` — integrate boot animation/blinking resources with composition cleanup.
- `src/ui/tui/managed-session-sync.js` — integrate managed sync polling/subscriptions with the composition disposer.
- `src/ui/tui/testing/` — add virtual-terminal, subprocess runner/child protocol, isolated environment, faux-model
  scenario actor, scripted review surface, normalization, semantic assertions, timeout, cleanup, and failure artifact
  modules in pure JavaScript with JSDoc.
- `src/ui/tui/golden-scenarios/` — add initial hand-authored Router-to-Guide inquiry, Escape cancellation,
  slash-command, and harness contract scenario definitions. Keep expected answers and scripts outside Agent-readable
  fixture project roots.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/tui/tui-manager.js:createTuiManager` — existing constructor seam for real versus virtual terminal adapters.
- `src/ui/tui/chat-session.js:startInteractiveSession` — current composition root whose production wrapper behavior
  should be preserved while extracting a disposable composition handle.
- `src/ui/tui/api.js:createUiApi` — canonical TUI presentation surface and prompt/resource owner.
- `src/ui/tui/runtime-adapter.js:attachTuiRuntimeAdapter` — canonical Runtime-event-to-TUI projection and Session
  replacement rendering path.
- `src/ui/tui/runtime-interaction-adapter.js:createTuiInteractionAdapter` — existing typed Runtime interaction mapping
  and review dependency seam.
- `src/ui/review/plan-review.js:submitPlanForReview` — production reviewed-content, feedback, approval, and lifecycle
  transaction; inject only its surface adapter.
- `src/shared/session/session-runtime.js:SessionRuntime` — authoritative Session lifecycle, event, interaction,
  cancellation, and handoff owner.
- `src/shared/session/session-runtime-events.js` — normalized event contract for semantic assertions.
- `src/shared/session/session.js:buildAgentSession` and Pi faux-provider APIs — normal Agent Definition/model/tool
  construction with deterministic model outputs.
- `src/shared/worktree-test-helpers.js:makeRepo` — real temporary Git repository and identity setup.
- Existing `src/ui/tui/*test.js` files — reuse assertion vocabulary and fixture ideas for blocks, keybindings, slash
  dispatch, runtime adapters, managed sync, and prompts.

## Implementation Steps

- [ ] Step 1: Add `@xterm/headless` as a test-only import/dependency aligned with the pinned `@earendil-works/pi-tui`
      version, and create an initial `deno task test:golden-tui` task that can run only the Golden harness tests.
- [ ] Step 2: Refactor `src/ui/tui/chat-session.js` so process-owned startup remains compatible while a reusable
      disposable composition handle owns TUI, Editor, Runtime, adapters, prompts, telemetry, timers, managed sync,
      boot/UI animation, readiness, idle settlement, and idempotent cleanup.
- [ ] Step 3: Harden `tui.js`, `tui-manager.js`, `api.js`, `boot-logo.js`, and `managed-session-sync.js` so partially
      initialized or repeatedly disposed TUI resources cannot leak listeners, intervals, timers, prompts, animation
      state, terminal state, or stale singleton references.
- [ ] Step 4: Update `attachTuiRuntimeAdapter` and `createTuiInteractionAdapter` so composition-owned interaction
      dependencies can be forwarded, while Runtime interaction registration/disposal remains authoritative and
      compatible with production.
- [ ] Step 5: Implement `src/ui/tui/testing/` modules for the virtual terminal adapter, subprocess parent/child
      protocol, pre-import isolated environment setup, deterministic model actor, scripted review surface, scenario
      runner, screen/event normalization, semantic assertions, timeout handling, cleanup, and failure artifact
      reporting.
- [ ] Step 6: Define the public Golden scenario shape: user actions, expected Agent/workflow turns, scripted
      text/thinking/tool-call responses, declared interaction decisions, coverage declarations, and semantic/durable
      assertions. Keep scripts and expected material outside the temporary project root.
- [ ] Step 7: Add the Router-to-Guide inquiry scenario using real terminal input, real `SessionRuntime`, real
      `triage_report`, Runtime handoff to Guide, optional real read-only tool execution, typed Runtime events,
      normalized screen assertions, and a mutation check proving the fixture Project was not changed.
- [ ] Step 8: Add focused Escape cancellation and `/help` slash-command examples that use terminal input and real TUI
      focus/dispatch behavior rather than invoking handlers directly.
- [ ] Step 9: Add focused contract tests for actor matching, unavailable tool calls, unexpected/ambiguous/missing/unused
      scripted turns, unexpected interactions, timeouts, child crashes, complete cleanup, and useful diagnostic
      artifacts.
- [ ] Step 10: Add a narrow Plan Review contract test proving a scripted surface decision passes through
      `submitPlanForReview` and persists reviewed content plus `review_feedback`/`review_approved` lifecycle events,
      without implementing the full FEATURE journey in this slice.

## Verification Plan

- Automated: run `deno task test:golden-tui` and verify the Router-to-Guide inquiry, Escape cancellation, `/help` slash
  command, actor contracts, timeout/crash diagnostics, cleanup, and Plan Review transaction contract pass.
- Automated: run targeted existing TUI tests affected by the refactor, including
  `deno test -A --no-check src/ui/tui/chat-session.test.js src/ui/tui/tui-manager.test.js src/ui/tui/api.test.js src/ui/tui/runtime-adapter.test.js src/ui/tui/runtime-interaction-adapter.test.js src/ui/tui/managed-session-sync.test.js src/ui/tui/keybindings.test.js src/ui/tui/slash-dispatch.test.js`.
- Automated: run `deno task ci` before completion.
- Automated stability check: run `for i in 1 2 3; do deno task test:golden-tui; done` and confirm no leaked child
  processes, worktrees, branches, registry entries, review surfaces, temporary settings, or HOME state after success,
  failure, cancellation, and timeout cases.
- Manual diagnostic check: intentionally break one scripted model expectation and confirm the retained failure artifact
  explains the expected turn, active Agent/phase/tools, last normalized screen, semantic activity, remaining script, and
  durable state.
- Manual snapshot check: if sparse layout snapshots are introduced, inspect them at narrow and wide terminal sizes and
  ensure updates are explicit rather than auto-blessed.
- No headed browser verification is required. This is TUI/test/runtime work; browser Plan Review behavior remains
  covered by existing Workspace/Playwright paths.

## Edge Cases & Considerations

- Subprocess isolation is required because constants, settings, provider registration, TUI singletons, review surfaces,
  and process-global state are captured at import or runtime.
- Child processes must not inherit provider API keys, user model/auth files, real memory/index state, or fixture answers
  inside the Agent-readable project root.
- Xterm writes and `pi-tui` rendering are asynchronous; use polling, flush, and idle/stability detection instead of
  fixed sleeps.
- Normalize generated values only at comparison/reporting edges: UUIDs, timestamps, durations, temp paths, ports, commit
  hashes, worktree suffixes, and animation frames.
- Dispatch model responses by declared Agent/phase identity to avoid races when isolated Agents or post-verification
  activity overlap.
- Plan Review fidelity depends on running the production transaction; do not bypass it with a direct fake interaction
  result.
- Tool calls execute real tools against a temporary Project, so scenarios must use bounded commands and prove writes
  cannot escape the isolated root.
- The harness should remain compatible with future End-to-End Benchmark Harness reuse without adding live-model scoring,
  repetitions, baseline comparison, external benchmark adapters, or reporting scope here.
