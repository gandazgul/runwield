---
planId: "7f62057d-bf3d-4786-80a8-4e9970c0a52f"
classification: "FEATURE"
complexity: "LOW"
summary: "Add live elapsed timer behavior to TUI tool execution blocks: show \"Elapsed time:\" after 500ms, update every 100ms, then replace with existing \"Took Xs\" footer on completion."
affectedPaths:
    - "src/ui/tui/api.js"
    - "src/ui/tui/blocks.js"
    - "src/ui/tui/blocks.test.js"
    - "src/ui/tui/message-hydration.test.js"
frontend: false
createdAt: "2026-07-13T18:37:50-04:00"
updatedAt: "2026-07-17T04:33:50.166Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-14T00:05:51.584Z"
verifiedAt: "2026-07-14T01:34:48.561Z"
workRecord:
    status: "generated"
    recordId: "fc45270b-42c6-4a57-b073-e03718b246e6"
    path: "docs/work-records/2026-07-17-added-live-elapsed-timers-to-tui-tool-blocks.md"
    lastAttemptAt: "2026-07-17T04:33:50.165Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
---

# Add Live Tool Elapsed Timer

## Context

The TUI currently renders tool execution blocks with a final footer such as `Took 141.3s` only after the tool ends.
Long-running tools can appear active from streaming output, but a quiet long-running tool gives no visible elapsed-time
signal in the block itself. The User Request asks for a live timer in the same tool block area: after 500ms, show
`Elapsed time:` with a seconds counter (`0.5s`, `0.6s`, etc.) updating every 100ms, then replace it with the current
`Took Xs` text once the tool completes.

## Objective

Add a running elapsed-time footer for visible TUI tool execution blocks while preserving existing final duration
behavior, expand/collapse footer hints, block background coloring, and restored persisted tool block rendering.

## Approach

Implement the feature in the existing `ToolExecutionBlock` rendering model and TUI API lifecycle:

- Keep `ToolExecutionBlock` responsible for formatting footer content.
- Track live elapsed footer state in the block without changing the public `ToolExecutionBlockApi` contract if possible.
- In `createUiApi.startToolExecution`, start a delayed render loop for visible tool blocks: wait 500ms, enable the
  elapsed footer if the block has not ended, then request a render every 100ms until `endExecution` is called.
- Wrap or centralize tool block finalization so the elapsed timer is cleaned up and the final
  `Took ${(durationMs / 1000).toFixed(1)}s` text continues to replace the live elapsed text.
- Do not start elapsed timers for `createSilentUiApi`, suppressed output, hydrated already-ended tool blocks, or non-TUI
  test stubs.

The requested behavior is user-visible TUI behavior but not browser frontend work, so `frontend` remains `false` and no
dev server is required.

## Files to Modify

- `src/ui/tui/blocks.js` — add live elapsed footer formatting to `ToolExecutionBlock`, preserving `Took Xs` after
  `endExecution`.
- `src/ui/tui/api.js` — manage the 500ms delay, 100ms render loop, and cleanup for visible running tool blocks.
- `src/ui/tui/blocks.test.js` — cover elapsed footer rendering thresholds and final replacement with `Took Xs`.
- `src/ui/tui/api.test.js` — cover TUI API timer scheduling/cleanup behavior if practical with fake timers or a small
  direct wrapper test.

## Reuse Opportunities

- `src/ui/tui/blocks.js` — reuse `renderFooterContent`, `visibleWidth`, `truncateToWidth`, `theme.fg("dim", ...)`, and
  existing footer left/right layout logic.
- `src/ui/tui/api.js` — reuse the existing spinner-loop pattern of scheduling redraws from the TUI API instead of making
  block rendering own timers.
- `src/ui/tui/blocks.test.js` — reuse `assertBlockBackground` and `stripAnsi` checks to ensure the new footer stays
  inside the colored block.
- `src/ui/tui/api.test.js` — reuse `makeTuiHarness` to count render requests and inspect active tool blocks.

## Implementation Steps

- [ ] Step 1: Extend `ToolExecutionBlock` with live elapsed state.
  - Add fields such as `showElapsedTime` or equivalent, while keeping `startTime`, `durationStr`, and `ended` as the
    source of final state.
  - Add a small helper for formatting elapsed seconds to one decimal place, based on `Date.now() - startTime`.
  - Update `renderFooterContent(innerW)` so the left footer is:
    - `Took X.Xs` when `durationStr` is present after completion.
    - `Elapsed time: X.Xs` only while the block is not ended and the elapsed display has been enabled.
    - empty before 500ms unless an expand/collapse hint is needed.
  - Preserve the existing right-aligned expand/collapse hint behavior when both footer texts are present.

- [ ] Step 2: Add timer lifecycle management in `createUiApi.startToolExecution`.
  - For non-suppressed output, after constructing the block and adding it to `activeToolBlocks`, schedule a `setTimeout`
    for 500ms.
  - When the timeout fires, if the block is still active and not ended, enable the elapsed footer, request a render, and
    start a `setInterval` or recursive `setTimeout` every 100ms to request further renders.
  - Wrap the returned block's `endExecution` method, or add a cleanup helper keyed by tool id, so finalization clears
    the pending timeout/interval before/after calling the original `endExecution`.
  - Ensure calling `endExecution` before 500ms never shows `Elapsed time:` and still renders the final `Took X.Xs`
    footer.
  - Remove or clean the timer entry for completed tool ids; do not remove the block itself from `activeToolBlocks`
    because existing callers can still query completed blocks.
  - If `suppressOutput()` is called while a tool is running, stop the elapsed render loop or make each tick no-op when
    `outputSuppressed` is true so suppression remains silent.

- [ ] Step 3: Keep non-visible and restored tool paths stable.
  - Leave `createSilentUiApi` and the `outputSuppressed` `startToolExecution` no-op return value timer-free.
  - Verify `message-hydration.js` restored tool blocks do not flash live elapsed text because they call `endExecution`
    immediately with restored duration.
  - Avoid changing `bash-interceptor.js`, `runtime-adapter.js`, `shared/session/session.js`, or workflow validation
    callers unless type changes require minor compatibility updates.

- [ ] Step 4: Add focused tests.
  - In `blocks.test.js`, assert a new running block initially omits `Elapsed time:`, shows `Elapsed time: 0.5s` or
    equivalent once elapsed display is enabled at/after 500ms, and shows `Took 0.7s` after `endExecution(false, 700)`
    with no remaining `Elapsed time:` text.
  - Assert footer layout remains consistent with long output/expand hint and block backgrounds remain full width.
  - In `api.test.js`, test that a running visible tool causes render requests after the elapsed timer starts and that
    `endExecution` stops further elapsed render requests. If fake timers are not available in this Deno setup, prefer a
    deterministic helper-level test over a slow wall-clock test.

## Verification Plan

- Automated: run `deno task ci` and fix all failures.
- Targeted automated checks while developing:
  - `deno test -A src/ui/tui/blocks.test.js src/ui/tui/api.test.js`
  - `deno check --doc src/ui/tui/blocks.js src/ui/tui/api.js`
- Manual TUI check:
  - Run a long quiet command through the TUI, for example a bash tool command equivalent to `sleep 2 && echo done`.
  - Expected: no elapsed footer is visible for the first ~500ms; then the tool block footer shows `Elapsed time: 0.5s`,
    `0.6s`, `0.7s`, etc. updating about every 100ms.
  - Expected: when the command completes, the live footer is replaced by `Took X.Xs` and stops updating.
  - Expected: a very fast command completing before 500ms never shows `Elapsed time:` but still shows `Took X.Xs` after
    completion.
  - Expected: a long command with more than six output lines still shows the expand/collapse hint on the right and the
    elapsed/final duration on the left without breaking block background coloring.

## Edge Cases & Considerations

- Timer cleanup: every delayed timeout/interval must be cleared on `endExecution` to avoid background redraws after
  completion.
- Fast tools: tools that finish before 500ms should only show the final `Took X.Xs` footer, not a transient elapsed
  footer.
- Restored history: persisted tool blocks restored during TUI hydration should render as already ended blocks and not
  start live timers.
- Output suppression: suppressed output paths must remain no-op and must not allocate timers.
- Layout: the footer already supports a left duration and right expand/collapse hint; reuse that layout so narrow
  terminals degrade the same way as today.
- Timing precision: match existing final duration precision by using one decimal place for both live elapsed and final
  `Took` text.
