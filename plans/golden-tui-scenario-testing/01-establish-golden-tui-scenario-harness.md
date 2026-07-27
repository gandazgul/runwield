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
    - "src/ui/tui/chat-session.test.js"
    - "src/ui/tui/tui-manager.test.js"
    - "src/ui/tui/api.test.js"
    - "src/ui/tui/runtime-adapter.test.js"
    - "src/ui/tui/runtime-interaction-adapter.test.js"
    - "src/ui/tui/managed-session-sync.test.js"
    - "src/ui/tui/keybindings.test.js"
    - "src/ui/tui/slash-dispatch.test.js"
    - "src/ui/tui/testing/"
    - "src/ui/tui/golden-scenarios/"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-26T20:04:06.040-04:00"
updatedAt: "2026-07-27T23:56:42.699Z"
status: "verified"
origin: "internal"
parentPlan: "golden-tui-scenario-testing"
order: 1
dependencies:
    []
implementedAt: "2026-07-27T00:26:42.615Z"
verifiedAt: "2026-07-27T23:56:42.699Z"
userVerifiedAt: null
userVerificationNote: null
executionReport: "- Implemented Golden TUI harness foundations: xterm import/task, virtual terminal, scenario actor/runner, subprocess isolation, scripted review surface, diagnostics/cleanup helpers, and initial golden scenario definitions/tests.\n- Added TUI lifecycle seams: disposable interactive composition handle, interaction dependency forwarding, safer TUI manager init/dispose, UI API disposal, and boot blink cleanup.\n- Added initial Router-to-Guide, Escape cancellation, `/help`, Plan Review contract, actor, timeout/crash, env isolation, and virtual-terminal coverage.\n- Verification passed: `deno task test:golden-tui`; targeted TUI test command; repeated `deno task test:golden-tui` 3x; full `deno task ci`."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "88548b58716f818ec205ebf444002048a8787c64"
    targetBranch: "main"
    targetHeadBeforeMerge: "d41e09f544bca0c27a54fbcf98cfe0bc5326c552"
---

# Establish Golden TUI Scenario Harness

## Context

RunWield has strong focused tests around TUI blocks, keybindings, Runtime event projection, workflow lifecycle, and Plan
Review adapters, but it does not yet have a deterministic test harness that launches the composed `pi-tui` application,
drives real terminal input, observes the rendered screen, and verifies durable Runtime/workflow state. This leaves gaps
where individually tested seams can regress together: startup ordering, focus restoration, cancellation, tool rendering,
Plan Review handoff, Session replacement, worktree state, and cleanup.

This FEATURE is the first child of the Golden TUI Scenario Testing Epic. It establishes the reusable machinery and
proves it with a small vertical/focused set only. The second child consumes the stable harness to add the remaining
role, FEATURE, PROJECT, block, terminal, recovery, release-tiering, and documentation portfolio.

Important existing evidence:

- `src/ui/tui/tui-manager.js:createTuiManager` already injects terminal/TUI constructors, so production can keep
  `ProcessTerminal` while tests provide a virtual implementation of `pi-tui`'s Terminal interface.
- `src/ui/tui/chat-session.js:startInteractiveSession` is currently both the process-owned startup wrapper and the
  interactive composition root. It constructs owner coordination, `SessionRuntime`, the TUI singleton, Editor,
  containers, adapters, polling, focus, and submission behavior, then returns only `uiAPI`. The harness needs a
  disposable composition handle without changing CLI behavior.
- `src/ui/tui/runtime-adapter.js:attachTuiRuntimeAdapter` creates the TUI interaction adapter directly, while
  `src/ui/tui/runtime-interaction-adapter.js:createTuiInteractionAdapter` already accepts review dependencies.
  Forwarding composition-owned dependencies through this seam allows scripted Plan Review decisions to use the
  production `submitPlanForReview` transaction.
- `src/ui/tui/api.js:createUiApi`, `boot-logo.js`, and `managed-session-sync.js` own timers, prompts, animation,
  polling, and long-lived UI state that currently rely too much on process lifetime. Golden scenarios need idempotent
  cleanup to avoid flakes and leaks.
- The accepted Epic direction is to use hand-authored deterministic scenarios, not raw Session Transcript replay. Agent
  identity, workflow phase, available tools, interactions, and unused scripted turns must be validated explicitly.

Production behavior must be preserved. User input must travel through terminal input and real focus handling.
`SessionRuntime`, Agent Definitions, model resolution, Pi's Agent loop, protected-tool policy, real tools, workflow
orchestration, Plan Lifecycle, Session replacement, Plan Workflow Lease behavior, owner coordination, and validation
remain systems under test rather than bypassed implementations. The harness must not introduce a second session/lease
authority, mutate Runtime snapshots or catalog projections directly, or create Golden-only shortcuts that could mask
SessionRuntime or lease conflicts.

## Objective

Create a deep, test-facing Golden TUI Scenario harness that hides terminal emulation, subprocess isolation,
deterministic model scripting, interaction decisions, Runtime observation, cleanup, normalization, and diagnostics
behind a small public interface.

Prove the interface with:

- a Router-to-Guide `INQUIRY` scenario where Router emits a real `triage_report`, Runtime switches to Guide, Guide may
  make a bounded read-only tool call, and the answer appears through normal thinking/tool/assistant blocks;
- an Escape cancellation example that interrupts active work through real Runtime cancellation and returns to a usable
  Editor;
- a representative non-destructive slash-command example such as `/help`, driven through real terminal input and command
  dispatch;
- focused contract tests for actor dispatch, unexpected/missing/unused scripted turns, unavailable tools, unexpected
  interactions, timeouts, child crashes, failure artifacts, and cleanup;
- a narrow Plan Review transaction contract proving scripted review decisions pass through real `submitPlanForReview`
  and persist reviewed content plus lifecycle events, without implementing the full FEATURE workflow portfolio yet.

## Approach

Separate composed interactive TUI/session lifecycle from process ownership, then build the Golden harness around that
seam. Production CLI startup continues to use the default TUI singleton and `ProcessTerminal`; tests launch complete
scenarios in a fresh Deno subprocess with isolated HOME, Project, Git, settings, session, model, worktree, registry, and
review-surface state established before importing RunWield modules. Use `@xterm/headless` as the test-only virtual
terminal adapter aligned with the pinned `@earendil-works/pi-tui` version.

Refactor `startInteractiveSession` by extracting a reusable composition function that returns a handle similar to:

- `sessionId` and `runtime` for semantic assertions and lifecycle observation;
- `uiAPI`, `tui`, `terminal`, and viewport helpers for screen capture without reaching into block internals;
- readiness/idle settlement methods so tests wait for stable behavior instead of sleeping;
- a single idempotent `dispose()` that tears down adapters, prompts, subscriptions, timers, managed sync, boot/UI
  animation, active Runtime sessions, and terminal state.

The production wrapper should keep current startup, replay, initial-request submission, Session replacement, terminal
title, model onboarding, Ctrl+C/Escape behavior, and process-exit policy. The new composition handle is a test/reuse
seam, not an alternate workflow engine. It must call `SessionRuntime`, owner coordination, and Plan Workflow Lease paths
through their production APIs; tests may isolate their backing filesystem/state, but must not replace those state
machines with test-local truth.

Use Pi's faux-provider capability for deterministic text, thinking, tool calls, response IDs, timestamps, and response
factories. Wrap it in a RunWield scenario actor that validates declared Agent identity, workflow phase, available tool
set, interaction sequence, and remaining responses. Dispatch scripted responses by declared Agent/phase identity rather
than a process-global first-in-first-out queue, so future isolated Agents and post-verification activity do not race.

Define a compact public scenario shape in `src/ui/tui/testing/`, for example:

- scenario metadata: name, terminal size, fixture Project, timeout, coverage declarations;
- user actions: typed text, Enter, Escape/Ctrl+C, slash commands, waits for semantic milestones;
- model script: expected Agent name, workflow phase/Routing Intent where applicable, expected/forbidden tools,
  deterministic text/thinking/tool-call response factory;
- interactions: typed Runtime interaction expectations and scripted review-surface decisions;
- assertions: normalized screen text, Runtime events, workflow outcome, filesystem/Git facts, Plan metadata, cleanup
  expectations, and optional sparse layout snapshots.

Keep assertions semantic-first. Normalized screen text, Runtime events, workflow outcomes, filesystem/Git facts, Plan
metadata, and cleanup should be primary. Sparse layout snapshots may exist only for stable layouts and must not be the
sole oracle for a workflow. Normalize generated values only at comparison/reporting edges: UUIDs, timestamps, durations,
temp paths, ports, commit hashes, worktree suffixes, and animation frames.

For Plan Review, inject only a scripted review surface/decision behind the production `submitPlanForReview` transaction.
Do not return approved/rejected values directly from a fake Runtime interaction result, because that would skip
reviewed-content persistence and Plan Lifecycle events.

The failure path should retain useful artifacts long enough to diagnose issues: normalized last screen, Runtime/event
summary, active Agent/workflow state, unmet expectation, remaining script, child stderr/stdout tail, durable state
summary, and temp artifact path. Successful runs should clean up completely.

## Files to Modify

- `deno.json` — add the test-only xterm import/dependency and expose a focused `test:golden-tui` task for the harness
  and initial scenarios. Do not add live-model benchmark tasks in this slice.
- `deno.lock` — capture dependency changes for `@xterm/headless` or related test-only packages.
- `src/ui/tui/chat-session.js` — split disposable interactive-session composition from the process-owned startup
  wrapper; expose deterministic readiness/idle lifecycle; accept established adapters/dependencies; keep startup,
  replay, submission, handoff, replacement, model onboarding, title, keybinding, and CLI process-exit behavior
  compatible.
- `src/ui/tui/tui.js` — preserve the production singleton while allowing explicit Terminal/TUI composition for tests and
  safe repeated disposal.
- `src/ui/tui/tui-manager.js` — harden injected Terminal/TUI lifecycle so failed construction, partial initialization,
  and repeated disposal cannot leave stale terminal state, crash guards, or singleton references.
- `src/ui/tui/api.js` — make UI-owned animation, prompt, tool timer, validation panel, managed-sync block, keyboard
  help, and output-suppression resources participate in explicit composition cleanup without exposing block internals as
  the scenario interface.
- `src/ui/tui/runtime-adapter.js` — accept and forward explicit interaction dependencies, keep Runtime subscription
  disposal authoritative, and preserve Session replacement rendering/rebinding behavior.
- `src/ui/tui/runtime-interaction-adapter.js` — support scripted review surfaces through the real Plan Review
  transaction seam while keeping TUI select/text/approval/code-review interaction behavior intact.
- `src/ui/tui/boot-logo.js` — integrate boot animation/blinking resources with composition cleanup.
- `src/ui/tui/managed-session-sync.js` — integrate managed sync polling/subscriptions with the composition disposer.
- `src/ui/tui/*.test.js` listed in affected paths — adjust or add focused regression tests for new composition/disposal
  seams without weakening existing behavior expectations.
- `src/ui/tui/testing/` — add virtual-terminal, subprocess runner/child protocol, isolated environment, deterministic
  model actor, scripted review surface, scenario runner, screen/event normalization, semantic assertions, timeout,
  cleanup, and failure artifact modules in pure JavaScript with JSDoc typedefs.
- `src/ui/tui/golden-scenarios/` — add initial hand-authored Router-to-Guide inquiry, Escape cancellation,
  slash-command, Plan Review transaction, and harness contract scenario definitions. Keep expected answers and scripts
  outside Agent-readable fixture Project roots.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/tui/tui-manager.js:createTuiManager` — existing constructor seam for real versus virtual terminal adapters.
- `src/ui/tui/chat-session.js:startInteractiveSession` — current production composition root whose wrapper behavior
  should be preserved while extracting a disposable composition handle.
- `src/ui/tui/api.js:createUiApi` and `src/ui/tui/blocks.js` — canonical TUI presentation ownership and block contracts;
  scenarios should observe rendered output instead of constructing blocks directly.
- `src/ui/tui/runtime-adapter.js:attachTuiRuntimeAdapter` — canonical Runtime-event-to-TUI projection and Session
  replacement rendering path.
- `src/ui/tui/runtime-interaction-adapter.js:createTuiInteractionAdapter` — existing typed Runtime interaction mapping
  and review dependency seam.
- `src/ui/review/plan-review.js:submitPlanForReview` — production reviewed-content, feedback, approval,
  execution-policy, and lifecycle transaction; inject only its surface adapter.
- `src/shared/session/session-runtime.js:SessionRuntime` — authoritative Session lifecycle, event, interaction,
  cancellation, queued-message, and handoff owner.
- `src/shared/session/session-runtime-events.js` — normalized event contract for semantic assertions.
- `src/shared/session/session.js:buildAgentSession` and Pi faux-provider APIs — normal Agent Definition/model/tool
  construction with deterministic model outputs.
- `src/shared/worktree-test-helpers.js:makeRepo` — real temporary Git repository and identity setup.
- Existing `src/ui/tui/*test.js` files — reuse assertion vocabulary and fixture ideas for blocks, keybindings, slash
  dispatch, runtime adapters, managed sync, prompts, model welcome, and cancellation behavior.
- `src/testing/process-global-lock.js` — continue using it for focused in-process tests where appropriate; complete
  Golden scenarios should prefer stronger subprocess isolation.

## Implementation Steps

- [ ] Step 1: Add `@xterm/headless` as a test-only import/dependency aligned with the pinned `@earendil-works/pi-tui`
      version, and create an initial `deno task test:golden-tui` task that runs only the Golden harness and initial
      scenario tests.
- [ ] Step 2: Extract a reusable interactive TUI composition function from `src/ui/tui/chat-session.js`. It must
      create/own the TUI, Editor, containers, `SessionRuntime`, UI API, Runtime adapter, interaction dependencies,
      telemetry, managed sync, boot/UI animation, keybindings, image/clipboard state, readiness, idle settlement, and
      idempotent cleanup, while `startInteractiveSession` preserves existing production behavior. Keep SessionRuntime
      and Plan Workflow Lease authority unchanged: no direct snapshot/catalog mutation, no duplicate lease state, and no
      alternate handoff/session-replacement path.
- [ ] Step 3: Update `src/ui/tui/tui.js` and `src/ui/tui/tui-manager.js` so production singleton setup remains
      unchanged, explicit Terminal/TUI pairs can be used in tests, and stop/dispose paths tolerate partial
      initialization and repeated calls.
- [ ] Step 4: Add explicit cleanup support in `createUiApi`, `boot-logo.js`, and `managed-session-sync.js` for busy
      animation, boot blinking, tool elapsed timers, prompts, validation/managed-sync blocks, keyboard help, polling,
      subscriptions, and render callbacks.
- [ ] Step 5: Update `attachTuiRuntimeAdapter` to accept interaction dependencies and pass them into
      `createTuiInteractionAdapter`; verify Runtime interaction registration/disposal remains one-per-session, fail-fast
      on duplicate adapters, and compatible with production.
- [ ] Step 6: Implement `src/ui/tui/testing/virtual-terminal.js` with a `@xterm/headless`-backed implementation of the
      `pi-tui` Terminal interface, including input writing, resize, viewport/screen capture, scrollback capture,
      flushing, and normalized text extraction.
- [ ] Step 7: Implement subprocess parent/child modules that create isolated
      HOME/Project/Git/settings/model/session/worktree/registry state before importing RunWield modules; strip provider
      API keys and real memory/index state from the child environment; enforce per-scenario deadlines and termination.
- [ ] Step 8: Implement the deterministic model actor around Pi's faux-provider response factories. It must match
      scripted turns by Agent/phase identity, validate available/forbidden tools, emit deterministic text/thinking/tool
      calls, and fail closed on unexpected, ambiguous, missing, unused, or unavailable scripted behavior.
- [ ] Step 9: Implement the scripted interaction/review-surface adapter so select/text/approval expectations are
      protocol-checked and Plan Review decisions pass through `submitPlanForReview` with reviewed content and lifecycle
      events persisted.
- [ ] Step 10: Implement the public Golden scenario runner and assertion helpers: scenario definition typedefs, action
      driver, semantic waiters, screen/event normalization, durable-state assertions, cleanup assertions, failure
      artifact collection, and optional sparse snapshot support.
- [ ] Step 11: Add the Router-to-Guide inquiry scenario using real terminal input, real `SessionRuntime`, real
      `triage_report`, Runtime handoff to Guide, optional bounded read-only tool execution, typed Runtime events,
      normalized screen assertions, footer/Agent context checks where stable, and a mutation check proving the fixture
      Project was not changed.
- [ ] Step 12: Add focused Escape cancellation and `/help` slash-command examples that use terminal input and real TUI
      focus/dispatch behavior rather than invoking handlers directly. The cancellation example must prove active work is
      interrupted, cancellation settles, input is re-enabled, focus returns to the Editor, and a subsequent benign input
      can be accepted or queued according to current Runtime rules.
- [ ] Step 13: Add focused harness contract tests for actor matching, unavailable tool calls,
      unexpected/ambiguous/missing/unused scripted turns, unexpected interactions, timeouts, child crashes, artifact
      contents, complete cleanup, and successful-run temp removal.
- [ ] Step 14: Add the narrow Plan Review transaction contract test proving a scripted surface decision passes through
      `submitPlanForReview` and persists reviewed content plus `review_feedback`/`review_approved` lifecycle events,
      without implementing the full FEATURE journey in this slice.
- [ ] Step 15: Update affected focused TUI tests to cover the new composition/disposal seams and preserve existing
      startup, replay, Session replacement, keybinding, slash-command, managed sync, prompt, and model-welcome behavior.

## Verification Plan

- Automated: run `deno task test:golden-tui` and verify the Router-to-Guide inquiry, Escape cancellation, `/help` slash
  command, actor contracts, timeout/crash diagnostics, cleanup, and Plan Review transaction contract pass.
- Automated: run targeted existing TUI tests affected by the refactor:
  `deno test -A --no-check src/ui/tui/chat-session.test.js src/ui/tui/tui-manager.test.js src/ui/tui/api.test.js src/ui/tui/runtime-adapter.test.js src/ui/tui/runtime-interaction-adapter.test.js src/ui/tui/managed-session-sync.test.js src/ui/tui/keybindings.test.js src/ui/tui/slash-dispatch.test.js src/ui/tui/model-welcome.test.js`.
- Automated: run `for i in 1 2 3; do deno task test:golden-tui; done` and confirm deterministic pass/fail behavior plus
  no leaked child processes, worktrees, branches, registry entries, review surfaces, temporary settings, or HOME state
  after success, failure, cancellation, and timeout cases.
- Automated: run `deno task ci` before completion.
- Manual diagnostic check: intentionally break one scripted model expectation and confirm the retained failure artifact
  explains the scenario, expected turn, active Agent/phase/tools, last normalized screen, semantic activity, remaining
  script, child output tail, and durable state location.
- Manual snapshot check: if sparse layout snapshots are introduced, inspect them at narrow and wide terminal sizes and
  ensure updates are explicit rather than auto-blessed.
- Expected result: production `wld` TUI startup, continuation/replay, model onboarding, keybindings, slash commands,
  Plan Review, and Session replacement behavior remain unchanged outside tests.
- No headed browser verification is required. This is TUI/test/runtime work; browser Plan Review behavior remains
  covered by existing Workspace/Playwright paths.

## Edge Cases & Considerations

- Subprocess isolation is required because constants, settings, provider registration, TUI singletons, review surfaces,
  timers, and some test helpers capture process-global state at import or runtime.
- SessionRuntime and Plan Workflow Lease compatibility is an acceptance criterion: Golden scenarios must exercise
  production owner-coordination and lease APIs against isolated state, assert the expected Runtime/lease outcomes where
  relevant, and fail if the harness needs direct state mutation or a parallel lease mechanism.
- Child processes must not inherit provider API keys, user model/auth files, real Mnemosyne/Cymbal state, fixture
  answers, or expected outputs inside the Agent-readable Project root.
- Xterm writes and `pi-tui` rendering are asynchronous; use polling, flush, semantic events, and idle/stability
  detection instead of fixed sleeps.
- Dispatch model responses by declared Agent/phase identity to avoid races when isolated Agents, validation, or
  post-verification activity overlap.
- Plan Review fidelity depends on running the production transaction; do not bypass it with a direct fake Runtime
  interaction result.
- Tool calls execute real tools against a temporary Project, so scenarios must use bounded commands and prove writes
  cannot escape the isolated root.
- Cleanup must be idempotent and robust after partial initialization, cancellation, timeout, child crash, duplicate
  disposal, prompt cancellation, Session replacement, and output suppression.
- The harness should remain compatible with future End-to-End Benchmark Harness reuse without adding live-model scoring,
  repetitions, baseline comparison, external benchmark adapters, ACP parity, or reporting scope here.
- Keep all implementation in pure JavaScript with JSDoc typedefs; do not introduce TypeScript files or TypeScript syntax
  for this TUI work.
