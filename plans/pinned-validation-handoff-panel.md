---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add a persistent TUI validation panel above the input that keeps current progress and the latest Engineer and Reviewer reports visible during validation."
affectedPaths:
    - "TODO.md"
    - "src/shared/session/session-runtime-events.js"
    - "src/shared/session/session-runtime-events.test.js"
    - "src/shared/workflow/validation.js"
    - "src/shared/workflow/validation.test.js"
    - "src/acp/event-mapper.js"
    - "src/acp/server.test.js"
    - "src/ui/tui/blocks.js"
    - "src/ui/tui/blocks.test.js"
    - "src/ui/tui/api.js"
    - "src/ui/tui/api.test.js"
    - "src/ui/tui/types.js"
    - "src/ui/tui/runtime-adapter.js"
    - "src/ui/tui/runtime-adapter.test.js"
    - "src/ui/tui/chat-session.js"
    - "src/ui/tui/chat-session.test.js"
frontend: false
createdAt: "2026-07-18T22:51:42-04:00"
updatedAt: "2026-07-19T03:46:35.885Z"
status: "ready_for_work"
origin: "internal"
---

# Pin Validation Progress and Latest Reports Above TUI Input

## Context

During Workflow Validation, the Engineer and Reviewer may alternate through several repair and review passes. The TUI
currently appends Task Completion, Reviewer results, and validation statuses to one scrolling transcript. When a user
returns to the terminal tab, the latest useful reports may be far above repetitive validation activity, forcing them to
search backward to understand the current state.

Task Completion and `review_complete` already produce semantic Runtime assistant messages. Validation cycle and stage,
however, are exposed only as human-readable `SYSTEM_STATUS` text. The TUI should not parse that display text to recover
workflow state.

The agreed interaction model is a full-width pinned panel immediately above the input stack. It shows the current
validation cycle/stage and the fully rendered latest report from both the Engineer and Reviewer. Existing transcript
blocks remain as chronological history. Active working animation stays below the panel, and active workflow questions
such as retrying validation appear below the animation and panel. A terminal result persists until the next User Request
is submitted.

## Objective

Add an adapter-neutral structured validation-progress contract and a TUI validation panel that:

- keeps current Workflow Validation or Mechanical Validation progress visible near the input;
- renders the latest Engineer Task Completion report and latest Reviewer result simultaneously and in full;
- replaces each role's pinned report independently without removing prior transcript history;
- keeps active animation and workflow interactions below the reports;
- persists a terminal verified/failed result until the next User Request submission; and
- avoids a sidebar, text parsing, report truncation, and nested report scrolling.

## Approach

- Extend `RuntimeSystemStatusEvent` with an optional, validated `validationProgress` snapshot. The snapshot will
  identify Workflow Validation versus Mechanical Validation, running/paused/verified/failed outcome, current stage,
  current cycle/maximum (when applicable), repair attempt/maximum (when applicable), and complete current check results
  for CI, Semantic Code Review, human code review, and merge. Each emitted snapshot is complete and immutable so
  consumers can replace state without reconstructing it from prior events.
- Emit structured progress at meaningful transitions in `runValidationLoop` and `runMechanicalValidation` while
  preserving the existing user-facing system-status messages and metrics. Use the current in-batch cycle display (`1/3`
  through `3/3`) and retain any total-cycle value needed to distinguish a retried batch.
- Preserve the existing ACP system-status message mapping and include `validationProgress` in RunWield metadata, so ACP
  and future hosts receive the same structured state without a second duplicate message.
- Add a `ValidationHandoffBlock` using existing TUI `StyledBlock`, Markdown, theme, wrapping, and ANSI-width
  conventions. It will render a compact progress heading followed by the latest Engineer and Reviewer sections. Missing
  sections are omitted; approved and failed states use semantic text and styling rather than color alone.
- Keep panel state in the TUI API, not the transcript blocks. Cache semantic Task Completion and Reviewer messages,
  render the panel once validation progress begins, and update the existing block in place. This prevents OPERATION Task
  Completion—which has no validation loop—from creating a stale panel while allowing QUICK_FIX Mechanical Validation to
  show an Engineer-only variant.
- Insert a dedicated panel container after the scrolling message list and before `SpinnerBlock`. Add a dedicated active
  interaction container after the spinner. Active select/text prompts render there; when settled, persistent prompt
  results move into the transcript so history behavior is retained.
- Mark terminal progress in panel state. A subsequent `USER_MESSAGE` clears a terminal panel before appending the new
  User Request; interaction responses such as “Retry validation” do not clear it. Explicit message clearing and Runtime
  session replacement clear all panel state.

## Files to Modify

- `src/shared/session/session-runtime-events.js` — define and validate the optional structured validation-progress
  snapshot on system-status events.
- `src/shared/session/session-runtime-events.test.js` — cover valid snapshots and reject incomplete, inconsistent, or
  invalid enum/numeric fields at the Runtime boundary.
- `src/shared/workflow/validation.js` — maintain and emit complete validation-progress snapshots across Workflow
  Validation, QUICK_FIX Mechanical Validation, repairs, reviews, merge, pause/halt, and terminal outcomes.
- `src/shared/workflow/validation.test.js` — verify progress sequences and complete snapshots for approval, Reviewer
  feedback/Engineer repair, retry batches, QUICK_FIX repair, cancellation/halt, and successful/failed terminals.
- `src/acp/event-mapper.js` — carry structured validation progress in RunWield metadata on the existing ACP status
  update.
- `src/acp/server.test.js` — verify ACP receives progress metadata without duplicating or changing the visible status
  message.
- `src/ui/tui/blocks.js` — add the full-width Markdown-capable validation handoff block and semantic progress/report
  rendering.
- `src/ui/tui/blocks.test.js` — cover progress labels, optional/latest role sections, approval/failure text, report
  replacement rendering, narrow widths, long Markdown, and ANSI-safe output.
- `src/ui/tui/api.js` — own one panel instance and its cached progress/reports; expose update/clear operations; place
  active prompts in the dedicated interaction container and move settled persistent prompts into history.
- `src/ui/tui/api.test.js` — verify per-role replacement, transcript preservation, panel gating, terminal clearing,
  prompt placement/history transfer, output suppression, and exact container cleanup.
- `src/ui/tui/types.js` — add JSDoc typedef references and TUI API methods for validation progress/report updates and
  clearing.
- `src/ui/tui/runtime-adapter.js` — mirror semantic Task Completion and Reviewer messages into panel state, forward
  structured progress while still appending system statuses, and clear terminal state on the next User Request.
- `src/ui/tui/runtime-adapter.test.js` — cover shared transcript-plus-panel delivery, latest-per-role behavior, terminal
  versus nonterminal User Requests, and unchanged ACP/TUI semantic parity.
- `src/ui/tui/chat-session.js` — add deterministic panel and active-interaction containers in the agreed order, pass
  them into the TUI API, and clear panel state during Runtime session replacement.
- `src/ui/tui/chat-session.test.js` — cover any extracted container-order/lifecycle helper needed to lock panel →
  spinner → interaction → editor ordering.
- `TODO.md` — remove or mark complete the resolved validation-pinning ideation item after the behavior is implemented.

## Reuse Opportunities

- `src/shared/session/session-runtime-events.js` — reuse the existing fail-fast event boundary and optional RunWield
  metadata path instead of introducing TUI-owned parsing.
- `src/shared/session/workflow-messages.js` — reuse `workflowMessage: "task_completed"`,
  `workflowMessage: "review_complete"`, `messageKind`, `agentName`, and `approved` as the report identities; do not
  change tool output contracts.
- `src/shared/workflow/validation.js` — retain existing status emission points, cycle counters, repair counters, and
  Workflow Validation outcome decisions as the sole progress producers.
- `src/ui/tui/blocks.js` — reuse `StyledBlock`, `Markdown`, semantic theme tokens, and visible-width helpers.
- `src/ui/tui/api.js` — reuse the single-instance input-accessory pattern established by keyboard help and the existing
  prompt settlement lifecycle.
- `src/ui/tui/runtime-adapter.js` — keep the Runtime subscription as the only event-to-TUI mapping boundary.
- `src/ui/tui/chat-session.js` — preserve the existing `messageList` → `SpinnerBlock` → input accessories → editor →
  footer composition, inserting explicit panel and interaction seams rather than creating a second sidebar layout.

## Implementation Steps

- [ ] Define a JSDoc `RuntimeValidationProgress` object shape and add optional `validationProgress` to
      `RuntimeSystemStatusEvent`. Validate supported validation kinds, outcomes, stages, check-result values, positive
      cycle/attempt maxima, bounded current values, and required terminal consistency in `assertSessionRuntimeEvent`.
- [ ] Add focused Runtime contract tests proving complete valid snapshots pass and malformed/partial snapshots fail
      fast.
- [ ] In both validation loops, maintain a single current snapshot and emit cloned complete snapshots alongside existing
      status messages at cycle start, CI start/result, Engineer repair, Semantic Code Review start/result, human review,
      merge, paused/canceled/halted states, and terminal success/failure. Preserve existing metrics and visible copy.
- [ ] Cover producer behavior with tests for one-pass Workflow Validation, Reviewer rejection followed by Engineer Task
      Completion and a new cycle, retrying after the three-cycle limit, QUICK_FIX Mechanical Validation repair, and
      terminal failure. Assert consumers never need to infer state from message strings.
- [ ] Add ACP metadata mapping and a regression test showing one existing visible status update plus its complete
      RunWield validation payload.
- [ ] Implement `ValidationHandoffBlock` with a progress heading and optional latest-Engineer/latest-Reviewer Markdown
      sections. Render reports fully, label stale Reviewer feedback as being rechecked when the Engineer has
      subsequently completed a repair, and use explicit approved/rejected/verified/failed wording in addition to theme
      color.
- [ ] Extend `createUiApi` to cache the latest report per semantic role, gate panel visibility on validation progress,
      update one block in place, and clear it on explicit lifecycle requests. Keep transcript append operations
      unchanged so every report remains in chronological history.
- [ ] Add a dedicated active-interaction container. Render live select/text prompts below the spinner; on settlement
      move persistent prompt blocks into `messageList`, while transient prompts are removed as today. Preserve focus,
      cancellation, selection preview, and `persistResult` behavior.
- [ ] Update the TUI Runtime adapter to mirror `task_completed` and `review_complete` messages into the panel, pass
      structured validation snapshots, preserve existing transcript rendering, and clear only a terminal panel on the
      next `USER_MESSAGE`.
- [ ] Wire the panel and interaction containers into `startInteractiveSession` in this order: scrolling transcript,
      pinned panel, active spinner/thinking animation, active workflow interaction, other input accessories, editor,
      footer. Clear panel/report caches when replacing the Runtime session or clearing messages.
- [ ] Add block, API, adapter, and layout regression tests for report replacement, long/narrow rendering, prompt order,
      terminal persistence, nonterminal continuation, next-submission clearing, and OPERATION exclusion.
- [ ] Remove the completed `TODO.md` ideation item, run focused tests, then run the complete repository quality gate.

## Verification Plan

- Automated:
  `deno test -A src/shared/session/session-runtime-events.test.js src/shared/workflow/validation.test.js src/acp/server.test.js src/ui/tui/blocks.test.js src/ui/tui/api.test.js src/ui/tui/runtime-adapter.test.js src/ui/tui/chat-session.test.js`
- Automated: `deno task ci`
- Manual: start `deno task cli`, execute a FEATURE Plan, and verify the first Engineer Task Completion remains in the
  full-width panel above the input when Workflow Validation starts while the original report remains in the transcript.
- Manual: exercise or fixture a rejected Semantic Code Review followed by Engineer repair. Verify the latest report from
  each role is simultaneously and fully visible; a new report replaces only its own role; old reports remain available
  by scrolling the transcript.
- Manual: while the Reviewer or Engineer is active, verify the spinner/thinking animation renders directly below the
  panel. At the validation-cycle limit, verify the retry/stop question appears below both the panel and spinner and
  retains keyboard focus.
- Manual: verify a normal concise multi-bullet report is not collapsed, truncated, or placed in a nested scroller. Use a
  deliberately long report and narrow terminal to confirm the main TUI viewport scrolls naturally while the editor and
  report content remain reachable.
- Manual: complete both successful and failed validation flows. Verify terminal wording is explicit, the panel remains
  visible while the tab is idle, and the next submitted User Request clears it before the new conversation proceeds.
- Manual: run a QUICK_FIX and verify an Engineer-only Mechanical Validation panel; run an OPERATION and verify its Task
  Completion remains transcript-only because no validation starts.
- Expected: existing system statuses, Task Completion messages, Reviewer result blocks, prompts, ACP text updates, and
  validation behavior remain intact; the new panel is a synchronized secondary presentation of structured workflow
  state, not a replacement for transcript history.

## Edge Cases & Considerations

- “Persist” is scoped to the live TUI Agent Session. Durable reconstruction across process restart or `/resume` is not
  required because Reviewer and validation-progress events are not currently stored as one replayable workflow state.
- A Task Completion report may arrive just before the first progress snapshot. Cache it but keep the panel hidden until
  validation starts; this excludes OPERATION without hard-coding display text or racing the validation loop.
- QUICK_FIX has repair attempts but no Reviewer and no Plan Status transition. Render only applicable fields and call
  its terminal state “Mechanical Validation passed/failed,” not “Verified Plan.”
- Retried Workflow Validation batches reset the displayed `1/3` cycle while retaining total-cycle/batch identity in the
  structured snapshot so stale report labeling remains correct.
- Reviewer approval may contain no custom feedback; the semantic approval message must still populate the Reviewer
  section. Reviewer rejection without feedback must remain explicit rather than rendering a blank panel.
- Reports are contractually concise Markdown bullet lists, but malformed or unusually long content must remain readable.
  Do not add a nested scrolling region or silently truncate; rely on the existing main TUI viewport behavior.
- Prompt answers are interaction responses, not new User Requests, and must not clear the panel. A user continuation
  while validation is paused also preserves the nonterminal panel.
- `/clear`, output suppression, Runtime session replacement, cancellation, and terminal errors must not leave orphaned
  panel or prompt components, timers, or stale focus.
- Maintain the SessionRuntime boundary: validation producers publish complete semantic state; TUI and ACP consume it
  without importing validation helpers or parsing user-facing strings.
- The repository currently has unrelated dirty Plan files. They do not overlap this new Plan or its intended execution
  paths and must not be modified or overwritten during implementation.
