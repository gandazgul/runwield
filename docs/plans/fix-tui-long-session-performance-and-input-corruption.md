---
planId: "ac424dd4-8296-41f1-aad1-2684d9d920e9"
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "HIGH"
affectedPaths:
    - "src/ui/tui/chat-view.ts"
    - "src/ui/tui/api.js"
    - "src/ui/tui/tui-manager.ts"
    - "src/ui/tui/terminal-focus-state.ts"
    - "src/ui/tui/keybindings.ts"
    - "src/ui/tui/chat-view.test.ts"
    - "src/ui/tui/terminal-focus-state.test.ts"
    - "src/ui/tui/api.test.js"
    - "docs/prd/runwield-core-prd.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-09-22"
origin: "internal"
userVerifiedAt: null
status: "in_progress"
targetBranch: "main"
---

# Restore long-Session TUI responsiveness and safe scrolling

## Context

Long local Sessions in Ghostty become slow before they fail visibly. While the TUI is degraded, scrolling can place
terminal mouse-wheel escape-sequence fragments into the editor. The existing Escape binding then treats one fragment as
deliberate Escape input and cancels the active Agent turn. A fresh Session does not show the input corruption, so the
performance and input failures must be tested together under retained-history load.

This changes the current Core TUI conversation capability in
[runwield-core-prd.md#31-tui-shell-and-root-agent-behavior](../prd/runwield-core-prd.md#31-tui-shell-and-root-agent-behavior).
The existing requirements to preserve the draft, conversation scroll position, and running Agent turn remain. Add the
long-Session responsiveness and safe-scroll acceptance scenario in the same implementation change. No new domain term is
needed, and no Session or Agent authority changes.

Current evidence:

- `RunWieldTui` uses Pi `TuiAltScreen`; Ghostty sends SGR mouse-wheel reports.
- Pi `StdinBuffer` normally reassembles input, but flushes incomplete sequences after its timeout.
- `terminal-focus-state.ts` filters focus reports only and can pass non-focus fragments through.
- `keybindings.ts` intentionally cancels the runtime for a recognized Escape.
- `chat-view.ts` renders the retained message tree through `ScrollView`; the installed Pi 0.85.1 ScrollView renders its
  complete child before clipping. Sidebar/footer snapshot reads and per-tool elapsed timers add work to repaint cycles.
- The prior manifest-scan issue is partly mitigated by the current manifest cache; it must not be treated as the fix
  without current measurements.

The working tree already has unrelated modified files and an unrelated untracked Plan. This Plan names a new file only
and must not overwrite or absorb those changes.

## Objective

A long-running TUI Session remains usable while output continues or the user reads older transcript content. Repainting
and retained-memory work are reduced at the measured hot path. Ghostty scroll input is consumed as mouse input, not
typed into the editor, and scrolling never cancels a running Agent turn. Deliberate Escape still cancels when it is
received as a real Escape key event.

## Approach

First create a deterministic test and measurement loop at the real boundaries. Do not choose a cache, history limit, or
Pi upgrade only because it sounds plausible.

```text
Ghostty wheel bytes
  -> Pi StdinBuffer sequence framing
  -> RunWield focus-report filter
  -> TuiAltScreen mouse dispatch
  -> ScrollView movement
  -> editor only for input not consumed above

runtime event / timer
  -> tui.requestRender
  -> chat-view layout and retained transcript rendering
  -> terminal frame diff
```

Measure separately:

1. Render cost and allocation growth as retained message/tool blocks, output size, and Session metadata grow.
2. Input latency and sequence delivery while the same render path is busy.
3. Whether repeated snapshot reads, full transcript rendering, block formatting, timers, or terminal output is the
   dominant cost.

The preferred repair is the smallest one that makes repeated work proportional to changed or visible content and keeps
terminal input framing lossless. If the measurement proves the defect belongs to Pi 0.85.1, use a verified compatible Pi
release or a durable repository-supported patch path; do not edit ignored `node_modules` or silently combine this work
with the separate Pi 0.87 compatibility Plan. A blanket rule that drops Escape or arbitrary control bytes is explicitly
set aside because it would hide real cancellation and keyboard input.

## Expected Change Surface

The boundaries below are high-signal guidance, not an allowlist. The Engineer may change an adjacent test or helper when
the measured call path requires it.

- `src/ui/tui/chat-view.ts` — avoid repeated Session snapshot reads within one frame and reduce retained
  transcript/layout work only where the measurement proves it is needed; preserve viewport position, pinned
  composer/footer, sidebar content, tool visibility, and live updates.
- `src/ui/tui/api.js` and `src/ui/tui/blocks.js` — remove or coalesce repaint/timer work that remains unnecessary during
  long turns, and avoid rebuilding unchanged full block content on every frame. Preserve active tool elapsed time,
  streaming text, output limits, and paused review behavior.
- `src/ui/tui/tui-manager.ts`, `src/ui/tui/terminal-focus-state.ts`, and `src/ui/tui/tui.ts` — harden the actual local
  terminal input boundary if the red test identifies fragmented SGR reports or focus filtering as the loss point. Keep
  complete mouse reports consumed by `TuiAltScreen` and keep standalone Escape available to the deliberate cancel
  binding.
- `src/ui/tui/keybindings.ts` — preserve the explicit cancellation contract while ensuring malformed or incomplete mouse
  input cannot reach the generic Escape cancellation path.
- `src/ui/tui/chat-view.test.ts`, `src/ui/tui/api.test.js`, `src/ui/tui/blocks.test.js`,
  `src/ui/tui/terminal-focus-state.test.ts`, and any focused input-framing test — prove behavior through real TUI
  composition and the real Pi input parser where available. Do not add a seam for RunWield-owned rendering,
  cancellation, persistence, or lifecycle machinery.
- `docs/prd/runwield-core-prd.md` — update the owning TUI capability and acceptance scenarios to state that long
  retained conversations remain responsive and local terminal scrolling preserves draft and Agent-turn state.

No browser UI, Session storage authority, Runtime cancellation semantics, or new architectural boundary is in scope.
ADR-010 continues to require TUI-specific rendering and terminal framing to stay in the TUI adapter; no ADR change is
expected unless the implementation changes that boundary.

## Reuse Opportunities

- `src/cmd/testing/runtime-command-fixture.ts` and existing interactive composition fixtures — create realistic retained
  Session content without external model calls.
- `testing/virtual-terminal.js`, `RunWieldTui`, `TuiAltScreen`, and existing scroll-preservation tests — exercise the
  real layout, viewport, and terminal output path.
- Pi's exported `StdinBuffer` and existing `terminal-focus-state` tests — cover every split position and timeout
  boundary instead of testing only already-complete strings.
- Existing `MAX_MESSAGE_LIST_CHILDREN`, tool-group/output limits, paused elapsed timers, and cursor-suppression behavior
  — preserve these protections and improve their measured cost rather than adding a second retention policy.

## Implementation Steps

1. **The regression loop is red-capable.** A focused test fixture creates a long retained transcript with active
   streaming or tool work, records render/input observations, and fails on the reported symptom rather than only
   asserting that the TUI does not throw. It can run through `deno run -A scripts/run-tests.js` without a live provider.
   The fixture bounds terminal output capture between samples so the test harness itself does not create the memory
   signal.
2. **The input boundary preserves terminal sequences.** Through Pi `StdinBuffer` and the RunWield focus/TUI path,
   complete SGR wheel reports remain mouse events for every split position that arrives within the parser window. A
   delayed or incomplete sequence cannot append its control payload to the editor. Scrolling leaves the draft unchanged,
   does not call runtime cancellation, and does not submit input. A standalone Escape still invokes the existing
   cancellation behavior.
3. **The measured repaint hotspot is bounded.** The implementation removes the selected source of repeated work—snapshot
   duplication, full retained-content formatting, timer-driven renders, terminal writes, or another measured hotspot—and
   records the invariant in a focused test. The scaling test uses fixed viewports and retained-content samples such as
   100, 500, 1,000, and 2,000 blocks. During repeated frames where only one active block changes, unchanged off-screen
   blocks must not be reformatted once per frame; visible old content and the active block must still render. The test
   records actual child/block render or formatting counts, snapshot calls, timer callbacks, and frame duration, not only
   top-level `requestRender` calls or `children.length`. A counterfeit implementation that merely returns an empty
   frame, drops old messages, disables scrolling, or suppresses all renders must fail because the test still checks
   visible retained content, live updates, scroll position, and input readiness.
4. **Long-session memory remains intentional.** Retained content uses the existing limits or an explicitly measured
   bounded projection. Completed tool output, images, Session Transcript continuity, current Agent context, and active
   blocks retain their existing semantics. The change does not silently delete user-visible history or mutate the
   file-authoritative Session Transcript to make the TUI appear faster.
5. **Existing TUI behavior remains protected.** Current tests continue to prove live updates do not snap a scrolled-up
   viewport, Ctrl+L/focus recovery preserves draft and scroll, viewport-only Ctrl+O behavior, active tool elapsed
   timing, paused Plan Review timers, and deliberate Agent cancellation. Tests that become obsolete must be identified
   as behavior intentionally stopped; no test may be removed only because the new rendering shape no longer compiles.
6. **Product requirements match the delivered behavior.** The owning TUI capability and scenarios state the implemented
   long-Session responsiveness and safe local-scroll behavior. No requirement claims a numeric latency or memory
   guarantee that the measurement did not establish, and unrelated Core capabilities remain unchanged.

## Approval Confirmation

No Work Record supersession is proposed. This Plan addresses the current Ghostty long-Session regression and does not
replace the completed timer, scroll, cursor, or Session-runtime Work Records; those behaviors remain preserved where
they still apply.

## Verification Plan

### Automated checks

Run tests only through the repository's sandboxed runner:

```sh
deno run -A scripts/run-tests.js --isolated \
  src/ui/tui/terminal-focus-state.test.ts \
  src/ui/tui/chat-view.test.ts \
  src/ui/tui/api.test.js \
  src/ui/tui/blocks.test.js

deno task check
deno task seams:check
deno task ci
```

Include the new input-framing and long-session performance tests in the focused command. Do not run `deno test`
directly.

### Required distinguishing evidence

- **Ghostty-style scroll:** feed complete and split SGR wheel reports through the real parser and TUI, using the same
  input callback that reaches `RunWieldTui`, not only a direct `scrollBy()` call. Assert that the wheel bytes move the
  viewport, the draft is byte-for-byte unchanged, no control-sequence text appears in the editor, and the runtime
  cancellation method is not called. Feed a deliberate Escape separately and assert that cancellation still occurs.
- **Slow-session reproduction:** grow retained content in fixed increments and record frame duration, actual
  per-child/block render or formatting counts, snapshot calls, timer callbacks, terminal output, and process memory
  after settlement. The post-fix observation must show the measured hotspot no longer grows in the same way, while
  visible old content and live updates remain present. Use repeated samples and report variance instead of a
  machine-specific absolute threshold.
- **Viewport behavior:** while streaming or running a tool, scroll up and verify the visible screen stays at the
  selected position; scroll back to the end and verify follow mode resumes. The test must fail if the implementation
  renders only the composer, clears old content, or forces the viewport to the bottom.
- **Memory ownership:** after completed blocks are pruned or cached, verify the intended limits and disposal behavior.
  Do not treat VirtualTerminal's unbounded scrollback capture as product memory, and do not claim a heap leak fix
  without a retained object or bounded-growth observation.
- **Preserved behavior:** rerun existing cursor suppression, paused review, timer cleanup, cancellation settlement, and
  Ctrl+L/focus recovery scenarios. Runtime cancellation remains owned by `SessionRuntime`; the TUI only requests it for
  a deliberate cancel event.
- **Documentation:** verify the Core PRD links still resolve and describe current behavior, not an unimplemented
  performance target. No glossary update is required.

### Manual Ghostty check

Run a real long Session with enough retained messages and tool output to reproduce degradation. While an Agent turn is
active:

1. Scroll upward repeatedly in Ghostty.
2. Type a short draft without submitting it.
3. Confirm no `65;...M` or other escape payload appears in the draft.
4. Confirm the Agent turn continues.
5. Return to the end, submit the draft, and confirm the intended follow-up is sent once.
6. Repeat after a fresh Session as a control; both fresh and long Sessions must preserve normal scroll input.

## Edge Cases & Considerations

- Ghostty local input is the confirmed environment. SSH, tmux, and transport-specific escape timeouts are not acceptance
  requirements, but the parser fix must not regress ordinary keyboard sequences.
- The slowdown may be render starvation rather than a heap leak. Measure heap retention separately from frame time and
  input delay.
- A complete wheel report may contain multiple reports in one read, or one report may cross input chunks. Both must
  remain ordered and isolated from ordinary text.
- A real Escape key must remain cancel-capable; only recognized mouse/focus/control sequences may be consumed.
- If Pi 0.85.1 is confirmed as the owner of the defect and no compatible local fix exists, stop before editing ignored
  dependency files and report the smallest durable upgrade or patch decision needed. Do not silently expand into the
  separate Pi 0.87 compatibility Plan.
