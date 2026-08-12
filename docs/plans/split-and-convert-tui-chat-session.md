---
classification: "PLANNED_CHANGE"
workKind: "REFACTOR"
complexity: "HIGH"
summary: "Split the interactive TUI chat-session monolith into cohesive TypeScript modules without changing user-visible behavior, as a prerequisite for the Pi 0.84.0 upgrade."
affectedPaths:
    - "src/ui/tui/chat-session.js"
    - "src/ui/tui/chat-session.ts"
    - "src/ui/tui/chat-footer.ts"
    - "src/ui/tui/chat-view.ts"
    - "src/ui/tui/chat-input-controller.ts"
    - "src/ui/tui/interactive-tui-composition.ts"
    - "src/ui/tui/chat-session.test.js"
    - "src/ui/tui/chat-session.test.ts"
    - "src/ui/tui/chat-footer.test.ts"
    - "src/ui/tui/chat-input-controller.test.ts"
    - "src/ui/tui/interactive-session-port.ts"
    - "src/ui/tui/testing/interactive-composition-fixture.ts"
    - "src/ui/tui/testing/scenario-runner.js"
    - "src/ui/tui/golden-scenarios/initial-scenarios.test.js"
    - "src/shared/session/architecture-boundary.test.js"
    - "src/shared/session/claude-cli-model-selection.test.ts"
    - "src/cmd/load-plan/index.ts"
    - "src/cmd/plans/pull.ts"
    - "scripts/language-policy-baseline.json"
objectiveChecks:
    - id: "OC1"
      command: "sh -c 'test ! -e src/ui/tui/chat-session.js || exit 1; for f in src/ui/tui/chat-session.ts src/ui/tui/chat-footer.ts src/ui/tui/chat-view.ts src/ui/tui/chat-input-controller.ts src/ui/tui/interactive-tui-composition.ts; do test -f \"$f\" && test \"$(wc -l < \"$f\")\" -lt 750 || exit 1; done; ! grep -RqsE \"@ts-nocheck|chat-session-(legacy|old)|export \\\\* from .*chat-session\" src/ui/tui'"
      rationale: "Proves the old path is gone, each named owner is bounded, and the monolith was not relocated behind a pass-through facade."
    - id: "OC2"
      command: "grep -q 'export function createChatFooterController' src/ui/tui/chat-footer.ts && grep -q 'export function createChatView' src/ui/tui/chat-view.ts && grep -q 'export function createChatInputController' src/ui/tui/chat-input-controller.ts && grep -q 'export async function createInteractiveTuiComposition' src/ui/tui/interactive-tui-composition.ts && ! grep -RqsE '__[A-Za-z0-9_]*[Dd]ispos' src/ui/tui"
      rationale: "Proves the four owner interfaces exist and the hidden UiAPI lifecycle field was not retained under another disposable-property name."
    - id: "OC3"
      command: "sh -c 'for f in src/ui/tui/chat-footer.test.ts src/ui/tui/chat-input-controller.test.ts src/ui/tui/chat-session.test.ts; do grep -q \"Deno.test\" \"$f\" || exit 1; done; deno run -A scripts/run-tests.js src/ui/tui/chat-footer.test.ts src/ui/tui/chat-input-controller.test.ts src/ui/tui/chat-session.test.ts src/ui/tui/golden-scenarios/initial-scenarios.test.js src/shared/session/architecture-boundary.test.js'"
      rationale: "Proves non-empty owner suites execute together with existing composed-startup and architecture regression coverage."
    - id: "OC4"
      command: "deno task language-policy:check && ! grep -Fq 'src/ui/tui/chat-session.js' scripts/language-policy-baseline.json"
      rationale: "Proves the TypeScript migration is reflected in the enforced production-language ratchet."
    - id: "OC5"
      command: "test ! -e src/ui/tui/chat-session.js && deno task ci"
      rationale: "Prevents a structurally plausible split from passing with broken imports, deleted regression coverage, a new injection seam, or repository-wide failures."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-06T14:59:04-04:00"
updatedAt: "2026-08-06T19:07:24.688Z"
origin: "internal"
userVerifiedAt: null
routingIntent: "PLANNED_CHANGE"
sessionName: "upgrade pi and rendering"
planId: "f3183b8c-58e3-4070-af6f-67807f653cac"
status: "validated_reviewer"
---

# Split and Convert the TUI Chat Session

## Context

`src/ui/tui/chat-session.js` is a 1,657-line production JavaScript module. It currently owns four distinct concerns:
terminal view construction, footer projection, user-input delivery, and interactive Session composition. Its
`startInteractiveSession()` function also owns the cross-concern startup and Session-replacement sequence. This
concentration makes the Pi 0.84.0 upgrade disproportionate: Pi replaces the concrete `TUI` constructor with the `TUI`
interface plus `TuiMainScreen`, but touching this JavaScript monolith requires its TypeScript migration under the
project language policy.

This Plan is the behavior-preserving prerequisite requested by the user. It does **not** upgrade Pi, add LaTeX
rendering, or change Mermaid rendering. After this Plan is implemented and verified, a separate Plan will upgrade all
four `@earendil-works/pi-*` packages to 0.84.0, adopt Pi TUI's built-in Unicode LaTeX rendering, keep RunWield's
existing `beautiful-mermaid` implementation, and make the small remaining Pi compatibility changes.

The follow-on dependency policy is settled: RunWield will not import or call `grok-mermaid`. The user accepts that Pi
0.84.0 itself installs `grok-mermaid` as an unused transitive dependency. Mermaid rendering remains owned by
`src/ui/tui/mermaid-markdown.js` and `beautiful-mermaid`.

## Objective

Replace the `chat-session.js` monolith with cohesive TypeScript modules whose interfaces make ownership clear while
preserving the current interactive terminal user interface (TUI), SessionRuntime event flow, startup ordering, model
onboarding, managed-session behavior, input queueing, image handling, footer output, and deterministic composed-TUI test
surface.

The resulting orchestration module must stay the authority for cross-module sequencing. Extracted modules must own real
capabilities rather than expose arbitrary setup fragments or new dependency-injection seams.

## Approach

Use four cohesive modules behind a reduced `chat-session.ts` interface:

- `chat-footer.ts` owns footer derivation and the live footer controller: location/worktree formatting, workflow labels,
  model/thinking display, usage/context statistics, branch caching, usage-event subscription, and the pending Ctrl+C
  exit notice.
- `chat-view.ts` owns the ordered terminal component tree and returns a typed view interface containing the editor,
  transcript and accessory containers, `UiAPI`, root component, clipboard/image presentation operations, and disposal.
  Header/update-notice behavior remains part of this view owner.
- `chat-input-controller.ts` owns accepted-input behavior from editor submission through local bash handling, slash
  dispatch, steering, next-turn queueing, draft restoration, pasted-image preflight, thinking-level cycling, and
  keybinding installation. It uses the real SessionRuntime and existing environment fixtures; it does not replace
  RunWield-owned machinery with callbacks or dependency bags.
- `interactive-tui-composition.ts` owns the deterministic composition lifecycle currently attached to `UiAPI` through
  the untyped `__goldenTuiDisposables` property. It receives an explicit typed internal session handle from the
  production startup path and exposes the existing `uiAPI`, runtime, Session identity, TUI, terminal, `waitForIdle()`,
  and `dispose()` test interface.

Keep `chat-session.ts` as the source of truth for the ordered startup and Session-replacement transaction. It creates
the real owner-coordination store and SessionRuntime, owns the mutable active Session id, initializes
settings/theme/TUI, loads prompt and Skill metadata, performs model welcome and initial Agent activation, controls
`/init` offer timing, attaches/replaces the Runtime adapter and managed-session synchronization, invokes history replay,
and submits the initial User Request only after model setup succeeds.

Use native TypeScript types. Do not add `any`, `unknown`, or property-free object types. Define named interfaces for the
startup options, runtime snapshot projections, view/controller handles, terminal composition capabilities, queued input,
and disposal lifecycle. Resolve home and current directory through `getHomeDir()` and `getCwd()` at call time; remove
the three direct `Deno.cwd()` reads currently in this module.

## Files to Modify

- `src/ui/tui/chat-session.js` — remove the monolithic JavaScript implementation after its owned behavior moves to the
  TypeScript modules.
- `src/ui/tui/chat-session.ts` — retain the public `startInteractiveSession`, `shouldReplaySessionHistory`,
  `persistThinkingLevel`, `getActiveModel`, `runScopedSubmitHandoffLoop`, and model-selection interface while owning
  only cross-module startup, replacement, and teardown sequencing.
- `src/ui/tui/chat-footer.ts` — own footer formatting exports and the live footer controller.
- `src/ui/tui/chat-view.ts` — own the ordered terminal component tree, header/update notice, `UiAPI` composition,
  editor, transcript/accessory containers, and clipboard/image presentation.
- `src/ui/tui/chat-input-controller.ts` — own editor/keybinding input acceptance, dispatch, queueing, image preflight,
  draft restoration, and thinking-level controls.
- `src/ui/tui/interactive-tui-composition.ts` — own typed production-composition setup, idle waiting, and reverse-order
  disposal without storing hidden fields on `UiAPI`.
- `src/ui/tui/chat-session.test.js` — remove the mixed JavaScript test module and its source-text/source-order
  assertions.
- `src/ui/tui/chat-session.test.ts` — retain orchestration and public-helper coverage through public interfaces and real
  SessionRuntime/TUI fixtures.
- `src/ui/tui/chat-footer.test.ts` — cover pure footer projections plus live usage, Session replacement,
  branch/location, thinking, workflow, context, and Ctrl+C notice behavior through the footer interface.
- `src/ui/tui/chat-input-controller.test.ts` — cover accepted input, local command precedence, steering/queue fallback,
  draft restoration, image preflight, and blocked managed/model states through a real composed TUI and SessionRuntime.
- `src/ui/tui/interactive-session-port.ts` — import the TypeScript chat-session entry point.
- `src/ui/tui/testing/interactive-composition-fixture.ts` — import the dedicated typed composition owner and preserve
  the real in-process composition fixture.
- `src/ui/tui/testing/scenario-runner.js` — update the composition import path only; do not change scenario semantics or
  introduce a replacement runtime.
- `src/ui/tui/golden-scenarios/initial-scenarios.test.js` — update the composition import path and preserve
  startup-failure cleanup coverage.
- `src/shared/session/architecture-boundary.test.js` — replace the old source-file assertion with
  interface/import-boundary assertions that do not depend on private source order.
- `src/shared/session/claude-cli-model-selection.test.ts` — import the canonical model-selection owner or the preserved
  TypeScript re-export.
- `src/cmd/load-plan/index.ts` — import the TypeScript interactive entry point.
- `src/cmd/plans/pull.ts` — update the lazy interactive-session import to the TypeScript entry point.
- `scripts/language-policy-baseline.json` — remove `src/ui/tui/chat-session.js` after the production JavaScript file no
  longer exists; do not add any new JavaScript baseline entry.

## Reuse Opportunities

- `src/ui/tui/testing/interactive-composition-fixture.ts` — use the existing real in-process composed-TUI fixture
  instead of adding test-only seams.
- `src/ui/tui/testing/scenario-runner.js` and `src/ui/tui/golden-scenarios/` — preserve the existing Golden scenarios as
  end-to-end regression evidence for startup, interaction, replacement, interruption, and disposal behavior.
- `src/ui/tui/tui-manager.ts` — keep TUI singleton and explicit Terminal/TUI pair ownership here; extracted modules
  consume its existing interface rather than creating another singleton.
- `src/ui/tui/runtime-adapter.js` — keep SessionRuntime-to-TUI event rendering unchanged and reattach this real adapter
  during Session replacement.
- `src/ui/tui/ui-api-overrides.ts`, `src/ui/tui/keybindings.js`, `src/ui/tui/slash-dispatch.ts`, and
  `src/ui/tui/bash-interceptor.js` — compose these existing behavior owners from the view/input modules instead of
  reimplementing their behavior.
- `src/constants.js::getCwd` and `getHomeDir` — use call-time process-state access that remains safe under the test
  runner's sandboxed HOME and working directory.

## Implementation Steps

- [ ] `src/ui/tui/chat-footer.ts` owns all footer formatting exports formerly declared in `chat-session.js` and exports
      `createChatFooterController()`, whose typed controller component renders current Session location/worktree,
      Agent/workflow, model/thinking, token usage, context pressure, and Ctrl+C pending-exit state. The controller
      resets usage and rebinds its real Runtime subscription when the active Session changes, and disposes its
      timer/subscription without a clock or Git seam.
- [ ] `src/ui/tui/chat-view.ts` exports `createChatView()` and owns the current component order—startup
      logo/title/update/help, transcript, validation panel, running tasks, active interaction, input accessories,
      pasted-image previews, clipboard hint, editor, and footer. Its named view operations/state are the only
      presentation surface used by orchestration and input handling. The view still composes the real `createUiApi` and
      `installUiApiOverrides` paths and preserves focus and theme invalidation behavior.
- [ ] `src/ui/tui/chat-input-controller.ts` exports `createChatInputController()` and owns the complete editor-input
      lifecycle. Local `!`/`!!` commands run before steering; allowed one-shot slash commands can run while streaming;
      other slash commands wait; steering failures queue the exact text/images for the next turn; managed refresh
      restores drafts; model/setup blocks preserve input; pasted images are persisted and preflighted once; accepted
      bash/slash input enters history; and cancellation/keybindings use existing product machinery.
- [ ] `src/ui/tui/chat-session.ts` is the sole cross-module startup/replacement authority and is below 750 lines.
      Startup preserves the existing order from Session creation through settings/theme/TUI construction, boot/update
      display, model welcome, initial Agent activation, `/init`, autocomplete/input activation, history replay, and
      initial request. Session replacement retires or closes the prior Session as appropriate, rebinds footer/runtime
      adapters, resets transcript/input/image/validation projections, restores editor focus, and leaves SessionRuntime
      as truth.
- [ ] `src/ui/tui/interactive-tui-composition.ts` exposes the current deterministic composition interface using a typed
      internal lifecycle handle from `startInteractiveSession`; `UiAPI` has no `__goldenTuiDisposables` or other hidden
      lifecycle field. Failed startup and normal disposal run registered cleanup in reverse order, close real Runtime
      Sessions, stop logo blinking, and stop the TUI exactly once.
- [ ] The original `src/ui/tui/chat-session.js` no longer exists, no renamed `legacy`/`old` monolith or pass-through
      `export *` facade exists, and every production `chat-*.ts` module plus `interactive-tui-composition.ts` is below
      750 lines. All new production modules are TypeScript, contain no `@ts-nocheck`, and no changed TypeScript
      declaration uses `any`, `unknown`, or a property-free object type. All current-directory/home reads in this
      capability use call-time `getCwd()`/`getHomeDir()` rather than direct `Deno.cwd()`/HOME access.
- [ ] Public callers import the new TypeScript owners. `startInteractiveSession`, Session port behavior, model-selection
      behavior, and the deterministic composition interface remain source-compatible apart from repository-local file
      extensions; no compatibility facade, duplicate implementation, or new JavaScript module remains.
- [ ] Tests are organized by behavior owner. Source-text/source-order checks are replaced with public-interface or real
      composed-TUI assertions. They protect component order, non-blocking update refresh, boot-before-activation
      ordering, model-welcome/empty-directory behavior, new-versus-continue replay, managed dormant startup, image
      retention, streaming command precedence, queue/draft restoration, Session replacement resets, footer projections,
      and cleanup. Tests fake only environment/external boundaries and add no injection seam for Runtime, lifecycle,
      registry, or TUI composition machinery.
- [ ] Existing Golden TUI scenarios, architecture-boundary checks, seam ratchet, language-policy ratchet, and the full
      repository continuous integration gate pass with no intended user-visible behavior removal or addition.

## Verification Plan

- Automated structural/type checks:
  - `deno task check`
  - `deno task language-policy:check`
  - `deno task seams:check`
  - Confirm `src/ui/tui/chat-session.js` is absent, `chat-session.ts` is below 750 lines, and
    footer/view/input/composition owners contain their named interfaces and behavior declarations rather than aliases
    back to the orchestrator.
- Automated focused behavior checks:
  - `deno run -A scripts/run-tests.js src/ui/tui/chat-footer.test.ts src/ui/tui/chat-input-controller.test.ts src/ui/tui/chat-session.test.ts`
  - `deno run -A scripts/run-tests.js src/ui/tui/golden-scenarios/initial-scenarios.test.js src/ui/tui/golden-scenarios/presentation-and-terminal.test.js src/shared/session/architecture-boundary.test.js src/shared/session/claude-cli-model-selection.test.ts`
  - Run any renamed `.ts` form of a listed JavaScript test when the implementation migrates that test as required by the
    language policy.
- Full gate: `deno task ci`.
- Mutation proof: temporarily break one input precedence rule (for example, route `!command` through steering), one
  startup order rule (for example, activate before the boot banner), and one replacement reset (for example, retain
  pasted images); confirm the corresponding focused test fails, then restore the implementation.
- Manual TUI smoke check with `deno task cli`: start a new Session, submit Markdown, run a local `!` command, send a
  second message while an Agent is active, interrupt once, and exit. Confirm transcript layout, footer, editor focus,
  queued feedback, and cleanup match the current behavior. Resume one existing Session and confirm history replays only
  on the continue path.
- Expected preserved behavior: all current interactive TUI and Session workflows remain available and visually
  unchanged. Expected removed behavior: none. The only removed implementation surfaces are the monolithic JavaScript
  module, its source-order-dependent tests, and the hidden `UiAPI.__goldenTuiDisposables` field.

### Objective-Failing Checks

- `OC1` —
  `sh -c 'test ! -e src/ui/tui/chat-session.js || exit 1; for f in src/ui/tui/chat-session.ts src/ui/tui/chat-footer.ts src/ui/tui/chat-view.ts src/ui/tui/chat-input-controller.ts src/ui/tui/interactive-tui-composition.ts; do test -f "$f" && test "$(wc -l < "$f")" -lt 750 || exit 1; done; ! grep -RqsE "@ts-nocheck|chat-session-(legacy|old)|export \\* from .*chat-session" src/ui/tui'`
  — proves the old path is gone, every named production owner is substantive but bounded, and the monolith was not
  merely relocated behind a pass-through facade.
- `OC2` —
  `grep -q 'export function createChatFooterController' src/ui/tui/chat-footer.ts && grep -q 'export function createChatView' src/ui/tui/chat-view.ts && grep -q 'export function createChatInputController' src/ui/tui/chat-input-controller.ts && grep -q 'export async function createInteractiveTuiComposition' src/ui/tui/interactive-tui-composition.ts && ! grep -RqsE '__[A-Za-z0-9_]*[Dd]ispos' src/ui/tui`
  — proves the four named owner interfaces exist and the hidden-UiAPI lifecycle escape hatch was not retained under
  another disposable-property name.
- `OC3` —
  `sh -c 'for f in src/ui/tui/chat-footer.test.ts src/ui/tui/chat-input-controller.test.ts src/ui/tui/chat-session.test.ts; do grep -q "Deno.test" "$f" || exit 1; done; deno run -A scripts/run-tests.js src/ui/tui/chat-footer.test.ts src/ui/tui/chat-input-controller.test.ts src/ui/tui/chat-session.test.ts src/ui/tui/golden-scenarios/initial-scenarios.test.js src/shared/session/architecture-boundary.test.js'`
  — proves non-empty owner suites run with existing composed-startup and architecture regression coverage; it fails on
  the current tree because the TypeScript owner suites do not exist.
- `OC4` —
  `deno task language-policy:check && ! grep -Fq 'src/ui/tui/chat-session.js' scripts/language-policy-baseline.json` —
  proves the migration is reflected in the enforced production-language ratchet and cannot pass while the old JavaScript
  baseline entry remains.
- `OC5` — `test ! -e src/ui/tui/chat-session.js && deno task ci` — prevents a structurally plausible split from passing
  with broken imports, deleted regression coverage, a new injection seam, or repository-wide type/lint/test failures; it
  is red today because the old monolith still exists.

## Edge Cases & Considerations

- This Plan is intentionally a prerequisite. Do not update `deno.json`, `deno.lock`, Pi APIs, LaTeX behavior, Mermaid
  behavior, `beautiful-mermaid`, or `grok-mermaid` here.
- Preserve regular terminal-screen behavior. Pi 0.84.0's `TuiMainScreen`/fullscreen choice belongs to the follow-on
  upgrade Plan, not this refactor.
- The current file has timing-sensitive order around update checks, boot banner, model welcome, managed activation,
  `/init`, autocomplete, replay, and initial request. The orchestrator must keep those transitions explicit; extracted
  modules must not start them from constructors.
- Footer values and transcript panels are projections. SessionRuntime and committed Session history remain authority;
  reset/rebind projections on replacement rather than reading them back to decide runtime state.
- `CHAT_BUILTIN_SLASH_NAMES` is currently mutable module state. Make it per-composition state so two composed TUIs
  cannot leak `/init` availability into each other.
- Keep cleanup idempotent under successful exit, startup failure, test disposal, and Session replacement. Reverse-order
  cleanup must not mask the original startup error.
- The repository has unrelated in-progress documentation, PRD, and Agent-definition edits. None overlaps this Plan's TUI
  implementation paths; preserve them and do not include them in this refactor.
