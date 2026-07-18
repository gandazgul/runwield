---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Implement a feature where typing '?' in an empty input field opens a keyboard help TUI block above the input. This involves updating the TUI keybindings to intercept '?', adding a mechanism in the TUI to render a help block, and ensuring the core can provide the help text."
affectedPaths:
    - "src/ui/tui/keybindings.js"
    - "src/ui/tui/tui.js"
    - "src/ui/tui/blocks.js"
frontend: false
createdAt: "2026-07-17T22:39:12-04:00"
updatedAt: "2026-07-18T13:53:01.151Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-18T03:21:07.444Z"
verifiedAt: "2026-07-18T13:53:01.151Z"
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-07-18T13:53:01.100Z"
routingIntent: "FEATURE"
sessionName: "keyboard help TUI block"
---

# Add Keyboard Help TUI Block

## Context

RunWield currently renders a compact shortcut hint below the startup title and keeps an expanded shortcut list inside
`startInteractiveSession`. `Ctrl+O` expands that startup text together with tool output, but shortcut help is not
exposed through `SessionRuntime` and cannot be presented independently by another UI.

The requested flow is empty editor `?` → public Runtime help request → validated semantic event → expanded transient TUI
block immediately above the editor. The event remains adapter-neutral so ACP, Workspace, or future consumers can ignore
it or present the same content differently.

## Objective

Add a session-scoped Core help event and wire the TUI so an exact `?` keystroke in an empty pending request opens an
expanded RunWield-styled keyboard-help block without inserting or submitting `?`. Preserve literal question marks in
normal User Requests.

## Approach

- Move the existing expanded shortcut title and ordered key/description entries into a small Core module, and emit a
  clone of that structured payload from a public `SessionRuntime.requestSessionHelp(sessionId)` operation.
- Add a fail-fast `KEYBOARD_HELP` Runtime event without TUI component or rendering vocabulary. The TUI Runtime adapter
  maps it to TUI API show/toggle behavior; unsupported consumers need no mapping.
- Render a dedicated transient `KeyboardHelpBlock` in an input-accessory container directly before pasted-image previews
  and the editor, not in the conversation message list. Use existing semantic theme tokens and block primitives, with a
  dense multi-column layout when width permits and a wrapped single-column fallback for narrow terminals.
- Intercept only an exact single-key `?` when both editor text and pasted-image attachments are empty. Multi-character
  paste input, non-empty text, and image-bearing requests continue through the normal editor path.
- Apply the confirmed lifecycle: `?` toggles the block; Esc closes it while retaining normal cancellation behavior; the
  first ordinary input closes it and is still forwarded; User Request submission also closes it.
- Replace the old startup-help expansion: change the compact boot hint to advertise `? help`, remove startup-help state
  from `Ctrl+O`, and leave `Ctrl+O` dedicated to tool-output expansion.

## Files to Modify

- `src/shared/session/session-help.js` — own the immutable canonical keyboard-help title and ordered shortcut entries,
  with clone-on-read output for events.
- `src/shared/session/session-help.test.js` — lock the current ordered payload and verify callers cannot mutate later
  responses.
- `src/shared/session/session-runtime-events.js` — add the event constant, JSDoc payload/event types, discriminated
  union member, and title/item validation.
- `src/shared/session/session-runtime.js` — add the public opaque-ID help request and emit the canonical payload through
  private Runtime fanout.
- `src/shared/session/session-runtime-events.test.js` — cover valid help event construction and malformed payload
  rejection.
- `src/shared/session/session-runtime.test.js` — verify one session-scoped help event per request and consistent
  not-found behavior.
- `src/ui/tui/keybindings.js` — recognize empty-editor `?`, request/hide help through callbacks, close help on Esc or
  forwarded input, and remove startup-help handling from `Ctrl+O`.
- `src/ui/tui/keybindings.test.js` — cover interception, toggling requests, dismissal, normal `?` pass-through, pasted
  images, multi-character input, and unchanged cancellation/tool-output behavior.
- `src/ui/tui/runtime-adapter.js` — translate the semantic help event to the TUI API without duplicating help copy.
- `src/ui/tui/runtime-adapter.test.js` — verify structured forwarding and that help is not rendered as transcript text.
- `src/ui/tui/blocks.js` — add the responsive themed keyboard-help block.
- `src/ui/tui/blocks.test.js` — verify ordered content, wide/narrow layouts, ANSI-safe widths, wrapping, and block
  styling.
- `src/ui/tui/api.js` — show/toggle/hide one help block in a supplied input-accessory container and add matching no-ops
  to silent APIs.
- `src/ui/tui/api.test.js` — verify blocks do not stack, toggle/hide preserve unrelated children, and silent APIs retain
  their complete surface.
- `src/ui/tui/types.js` — define the new TUI API operations and reference the shared payload through JSDoc.
- `src/ui/tui/chat-session.js` — add the pre-editor accessory container, wire callbacks to the current Runtime session,
  hide help on submission, replace the boot hint, and remove local expanded-help/`Ctrl+O` state.

## Reuse Opportunities

- `src/shared/session/session-runtime-events.js` — `createSessionRuntimeEvent`, discriminated event types, and fail-fast
  outward-boundary validation.
- `src/shared/session/session-runtime.js` — nearby synchronous opaque-ID actions such as
  `cycleSessionThinkingLevel(sessionId)` and private `#emitSessionEvent` fanout.
- `src/ui/tui/runtime-adapter.js` — the single registered Runtime subscription as the event-to-TUI boundary.
- `src/ui/tui/blocks.js` — `StyledBlock`, width/wrapping helpers, and semantic theme tokens.
- `src/ui/tui/keybindings.js` — `isEditorEmpty` and callback-based separation between key recognition and Runtime work.
- `src/ui/tui/chat-session.js` — the existing container order around running tasks, image previews, and the editor.

## Implementation Steps

- [ ] Extract the current expanded shortcut title/items into immutable Core data with a clone-on-read helper and focused
      tests. Preserve the current copy and order; correcting individual advertised shortcuts is separate scope.
- [ ] Add `RuntimeEventTypes.KEYBOARD_HELP`, its structured JSDoc type/union member, and validation requiring a
      non-empty title plus an ordered non-empty array of `{ key, description }` strings.
- [ ] Add `SessionRuntime.requestSessionHelp(sessionId)`; return `{ ok: false, error: "not_found" }` for an unknown ID,
      otherwise emit one canonical event and return `{ ok: true }`.
- [ ] Test Runtime payload validation, event session identity/timestamp, exact one-event fanout, clone safety, and
      unknown session IDs.
- [ ] Implement `KeyboardHelpBlock` with aligned responsive columns, safe narrow-width wrapping, and existing RunWield
      block/theme conventions.
- [ ] Extend the TUI API to manage exactly one transient help block in a dedicated input-accessory container; repeated
      help events toggle rather than append, and hide removes only the help block.
- [ ] Map `KEYBOARD_HELP` in the TUI Runtime adapter and test that no conversation/system message is appended.
- [ ] Extend `installKeybindings` with request/hide callbacks: consume exact empty-state `?`; hide before Esc
      cancellation and before forwarding ordinary input; keep `Ctrl+O` limited to tool output.
- [ ] In `startInteractiveSession`, add the accessory container, bind the help request to the current mutable
      `sessionId` so resume/replacement cannot target a stale session, hide on submission, advertise `? help`, and
      delete duplicate expanded-help state.
- [ ] Run focused tests and the complete repository quality gate.

## Verification Plan

- Automated:
  `deno test -A src/shared/session/session-help.test.js src/shared/session/session-runtime-events.test.js src/shared/session/session-runtime.test.js src/ui/tui/keybindings.test.js src/ui/tui/runtime-adapter.test.js src/ui/tui/blocks.test.js src/ui/tui/api.test.js`
- Automated: `deno task ci`
- Manual: start `deno task cli`; with no text or images press `?` and verify no character is inserted/submitted and one
  expanded block appears immediately above the editor with the existing shortcut content.
- Manual: press `?` again to close it; reopen it and press Esc, verifying the block closes and existing cancellation
  still runs; reopen it and type a character, verifying help closes and the character remains in the editor.
- Manual: type text and then `?`; verify a literal question mark is inserted. Repeat with a pasted image and empty text,
  and paste a multi-character string containing `?`, verifying neither case opens help.
- Manual: submit a normal User Request after opening help; verify help closes, the request reaches the active Agent
  Session, and streamed output never moves help into transcript history.
- Manual: verify the boot hint advertises `? help`; `Ctrl+O` now affects tool outputs only; and Shift+Tab, Esc, Ctrl+C,
  queue recall, slash commands, and `!`/`!!` retain their existing behavior.
- Expected: Runtime subscribers receive a validated keyboard-help event with stable session identity/timestamp, while
  consumers with no event mapping remain unaffected.

## Edge Cases & Considerations

- A pasted image makes the pending request non-empty even when editor text is blank, so `?` remains available as image
  caption/request text.
- Terminal input may arrive as a multi-character paste; only exact single-key `?` triggers help.
- The event and block are transient: they are not persisted, replayed, or added to Agent Session history.
- Repeated requests must not stack blocks, and streamed output must not displace help from immediately above the editor.
- Narrow terminals must wrap without corrupting ANSI visible-width calculations or producing negative padding.
- Session replacement must not leave the keybinding callback bound to the previous opaque session ID.
- The existing help includes an explicitly not-implemented external-editor shortcut. Preserve the requested existing
  help content here rather than silently changing shortcut policy.
- Confirmed product decisions: `?` toggles help; Esc, ordinary typing, and submission close it; `Ctrl+O` no longer
  controls startup help and remains dedicated to tool-output expansion.
