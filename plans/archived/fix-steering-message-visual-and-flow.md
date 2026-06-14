---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Fix steering messages: show proper visual feedback (user message, not system label), handle images, add defensive isStreaming check, and ensure up-arrow dequeue works for locally-queued fallback messages."
affectedPaths:
    - "src/shared/interactive/chat-session.js"
    - "src/shared/session/session.js"
createdAt: "2026-06-09T05:30:00.000Z"
updatedAt: "2026-06-09T19:13:24.701Z"
status: "completed"
origin: "internal"
---

# Fix Steering Message Visual Feedback and Flow

## Context

When a user types a message while the agent is streaming (`isProcessingSubmission === true`), the `onSubmit` handler
calls `steerRootSession()` which calls `session.steer()` on the pi-coding-agent AgentSession. This queues the message on
the Agent's steering queue. The agent loop polls for steering messages between turns (after tool calls complete, before
the next LLM call) and injects them into the context.

**The steering mechanism works** — the message IS delivered to the LLM via the Agent's steering queue. However:

1. **No visual confirmation of LLM delivery**: The message is shown immediately as a `"Steering: <text>"` system block,
   but it never transitions to a proper user message when the LLM actually receives it. The user can't tell whether it
   was queued or consumed.

2. **Images are dropped**: When steering with image attachments, the images are sent via `session.steer()` but never
   displayed in the TUI.

3. **No error handling**: `steerRootSession().then(...)` has no `.catch()` handler, so if `session.steer()` throws
   (e.g., extension command rejection), the error is swallowed and no visual feedback is shown at all.

4. **No isStreaming guard**: `steerRootSession` always returns `true` if a root session exists, even if the session is
   NOT streaming. In that case, the message gets queued on the Agent's steering queue but is never processed because the
   agent loop has already exited. The message should instead fall through to the `submissionQueue` for processing on the
   next turn.

## Objective

- **Two-phase visual feedback**:
  - **Phase 1 (immediate)**: Show "Steering: <message>" system block — confirms the message was received and queued on
    the agent's steering queue.
  - **Phase 2 (when sent to LLM)**: Replace the system block with a `UserPromptBlock` — confirms the agent loop picked
    up the steering message and injected it into the LLM context.
- Display image attachments in steering messages (both phases).
- Add `.catch()` error handling for failed steer calls.
- Add an `isStreaming` guard so steering messages that arrive after the agent finishes are properly queued for the next
  submission rather than silently lost.
- Up-arrow dequeue works for the local `submissionQueue` fallback (confirmed working, no changes needed).

## Approach

### How steering message consumption is detected

When `session.steer()` is called, the message is pushed to the AgentSession's `_steeringMessages` array AND the Agent's
`steeringQueue`. The agent loop polls `getSteeringMessages` between turns. When it drains a message, it injects it into
context by emitting `message_start` (role: user). The AgentSession's internal handler (`_handleAgentEvent`) detects this
— it finds the message text in `_steeringMessages`, removes it, and emits a `queue_update` event:

```typescript
// AgentSession emits:
{ type: "queue_update", steering: [...remainingTexts], followUp: [...] }
```

Harns can subscribe to `queue_update` events on the root session and compare the `steering` array against
locally-tracked pending messages. When a text disappears from the array, the message was consumed by the LLM.

### Two-phase display

1. **Immediately** on successful steer: Show a `SystemMessageBlock` with header `"Steering:"` and the user's text
   (current behavior, keep it).
2. **On `queue_update`**: When a tracked message is no longer in the steering array, remove its system block and append
   a proper `UserPromptBlock` via `uiAPI.appendUserMessage()`.

### `isStreaming` guard

`steerRootSession` checks `session.isStreaming` before calling `session.steer()`. If the session is not streaming,
returns `false` so the message falls through to `submissionQueue`.

### Files

Two files need changes:

#### `src/shared/interactive/chat-session.js`

Three areas:

1. `onSubmit` steering path — keep immediate system block + track pending messages + `.catch()`
2. `startInteractiveSession` — after `ensureRootAgentSession`, subscribe for `queue_update`
3. Module-level `pendingSteeringMessages` map and cleanup on session rebuild

#### `src/shared/session/session.js`

`steerRootSession` — add `isStreaming` guard.

## Files to Modify

- `src/shared/interactive/chat-session.js` — Two-phase visual feedback + queue_update subscriber
- `src/shared/session/session.js` — Add `isStreaming` guard to `steerRootSession`

## Reuse Opportunities

- `uiAPI.appendUserMessage()` in `src/shared/ui/api.js` renders a `UserPromptBlock` (phase 2)
- `SystemMessageBlock` (with `"Steering:"` header) for phase 1 — already used, just keep it
- `AgentSession.subscribe()` — already used by `attachUiSubscribers`; we add a second subscription
- `AgentSession.clearQueue()` — available for cancel/abort cleanup if needed

## Implementation Steps

### Step 1: Add module-level tracking + queue_update subscriber in chat-session.js

**1a. Add module-level state** at the top of `src/shared/interactive/chat-session.js`:

```js
/**
 * @type {Map<string, { text: string, images: ImageAttachment[], systemBlock: SystemMessageBlock, spacer: Spacer }>}
 * Tracks steering messages that have been queued on the agent but not yet consumed by the LLM.
 * Keyed by message text (consistent with AgentSession._steeringMessages matching by text).
 */
const pendingSteeringMessages = new Map();

/** @type {(() => void) | null} */
let pendingSteeringUnsub = null;
```

**1b. In the `onSubmit` handler** steering path, update to:

```js
if (isProcessingSubmission) {
    // ... /model check omitted for brevity ...

    steerRootSession(userRequest, images).then((steered) => {
        if (steered) {
            // Phase 1: Show "Steering:" system block immediately
            const block = new SystemMessageBlock(userRequest, false, "Steering:");
            const spacer = new Spacer(1);
            messageList.addChild(block);
            messageList.addChild(spacer);
            // Track for phase 2 transition when consumed by LLM
            pendingSteeringMessages.set(userRequest, {
                text: userRequest,
                images: [...images],
                systemBlock: block,
                spacer,
            });
        } else {
            // Fallback: queue for next submission
            const block = new SystemMessageBlock(userRequest, false, "Queued message:");
            const spacer = new Spacer(1);
            messageList.addChild(block);
            messageList.addChild(spacer);
            submissionQueue.push({ text: userRequest, images, block, spacer });
        }
        tui.requestRender();
    }).catch((err) => {
        // On error (e.g. extension command rejected), fall back to queueing
        const block = new SystemMessageBlock(userRequest, false, "Queued message (steer failed):");
        const spacer = new Spacer(1);
        messageList.addChild(block);
        messageList.addChild(spacer);
        submissionQueue.push({ text: userRequest, images, block, spacer });
        tui.requestRender();
    });
    return;
}
```

**1c. In `startInteractiveSession`**, after `ensureRootAgentSession` succeeds (near the bottom of
`startInteractiveSession` where the TUI setup is done), subscribe to the root session's `queue_update` events. Also
subscribe again if the root is rebuilt later:

```js
// ── Steering message consumption tracker ──
// Subscribe to queue_update events so we can transition "Steering:" blocks
// to proper user messages when the LLM consumes them.
function setupSteeringConsumedListener() {
    // Unsubscribe any previous listener
    if (pendingSteeringUnsub) {
        pendingSteeringUnsub();
        pendingSteeringUnsub = null;
    }
    const session = getRootAgentSession();
    if (!session) return;
    pendingSteeringUnsub = session.subscribe((event) => {
        if (event.type !== "queue_update") return;
        const activeSteering = new Set(event.steering);
        for (const [text, entry] of pendingSteeringMessages) {
            if (activeSteering.has(text)) continue;
            // This message was consumed by the LLM!
            // Phase 2: Remove "Steering:" block → add proper user message
            messageList.removeChild(entry.systemBlock);
            messageList.removeChild(entry.spacer);
            uiAPI.appendUserMessage(text);
            if (entry.images.length > 0) {
                for (const img of entry.images) {
                    uiAPI.appendImage?.(img.base64, img.mimeType);
                }
            }
            pendingSteeringMessages.delete(text);
            tui.requestRender();
        }
    });
}
```

Call `setupSteeringConsumedListener()` after the first `ensureRootAgentSession` call, and also in `setActiveAgent` /
`applyPendingRootSwap` whenever the root is rebuilt.

**1d. Clean up on Esc/Ctrl+C (`cancelEverything`):** Clear `pendingSteeringMessages` and unsubscribe:

```js
function cancelEverything() {
    generationGuard.invalidateAll();
    submissionQueue.length = 0;
    pendingSteeringMessages.clear();
    if (pendingSteeringUnsub) {
        pendingSteeringUnsub();
        pendingSteeringUnsub = null;
    }
    dismissActivePrompt();
    const opCanceled = cancelActiveOperation();
    const sessionAborted = abortActiveSession();
    const planCanceled = cancelActivePlanReview();
    forceResetUI();
    return { opCanceled, sessionAborted, planCanceled };
}
```

Also clear the agent's steering queue on abort for consistency:

In `abortActiveSession` (in `session.js`) or in `cancelEverything`, after aborting the root session, also call
`session.clearQueue()` to flush any stale steering messages.

**1e. Handle images in steering messages:** The `onSubmit` handler already captures `images` from `pastedImages` before
the steering path. The tracking entry stores them. The `queue_update` handler displays them via `uiAPI.appendImage()`.

### Step 2: Add isStreaming check in steerRootSession

In `src/shared/session/session.js`, add a `session.isStreaming` guard to `steerRootSession()`:

```js
export async function steerRootSession(text, images) {
    const session = getRootAgentSession();
    if (!session) return false;
    // If the session is not actively streaming, queuing a steering message
    // on the agent would be lost — the agent loop has already exited.
    // Return false so the caller queues it for the next submission instead.
    if (!session.isStreaming) return false;
    /** @type {Array<{type: "image", data: string, mimeType: string}>} */
    const imageContent = images && images.length > 0
        ? images.map((img) => ({ type: /** @type {"image"} */ ("image"), data: img.base64, mimeType: img.mimeType }))
        : [];
    await session.steer(text, imageContent.length > 0 ? imageContent : undefined);
    return true;
}
```

## Verification Plan

### Automated

```bash
deno run ci
```

### Manual

1. **Two-phase steering confirmation**: Start a long agent run (e.g. `read every .js file`). While the agent is
   generating, type a steering message (e.g. `skip node_modules`). **Expected phase 1**: Immediately see
   `"Steering: skip node_modules"` as a system block. **Expected phase 2**: After the agent finishes its current turn
   and picks up the steering, the system block is replaced by a proper `UserPromptBlock` showing the message. The agent
   responds to the steering on its next LLM call.

2. **Steering with images**: During a run, paste an image and submit as a steering message. **Expected**: Image
   attachment appears alongside the user message in phase 2.

3. **Steering after agent finishes**: Type a message that produces a quick response. Immediately after pressing Enter,
   type another message before the agent responds. **Expected**: If the agent finishes before the second message is
   processed, the second message appears as `"Queued message:"` and is sent on the next turn (not as a steering
   message).

4. **Up-arrow dequeue**: During a run, type a message. Before the agent responds, press Escape to cancel. Then type
   another message quickly. Press up-arrow on the empty editor. **Expected**: The last locally-queued message is
   restored to the editor and its visual block is removed from the message list.

5. **Steer with extension command**: During a run, type a `/model` command. **Expected**: The `session.steer()` call
   rejects (extension commands cannot be queued). The `.catch()` handler catches this and shows
   `"Queued message (steer failed):"`.

6. **Esc after steering**: Start a long agent run, type a steering message (see phase 1), then press Escape before the
   agent picks it up. **Expected**: The agent run is aborted, `pendingSteeringMessages` is cleared, the steering system
   block is removed from the message list, and the agent's steering queue is also cleared.

## Edge Cases & Considerations

- **Duplicate message text**: `pendingSteeringMessages` is keyed by message text, matching how AgentSession's
  `_handleAgentEvent` removes consumed messages (`_steeringMessages.indexOf(text)`). If the user sends two identical
  steering messages, only the first is consumed per `queue_update`. The second remains tracked until its consumption
  event. Acceptable for the edge case.

- **Race condition**: If `session.isStreaming` transitions from `true` to `false` between the check and the
  `session.steer()` call, the message could be lost. The fallback `submissionQueue` handles this: the user can resubmit.

- **queue_update timing**: The `queue_update` event fires AFTER the steering message has been injected into the LLM
  context. This is the right timing for phase 2 — the message WAS sent.

- **Session rebuild**: `applyPendingRootSwap` rebuilds the root session. The old subscription is invalidated. Call
  `setupSteeringConsumedListener()` after each rebuild.

- **compatibility**: No breaking changes. `steerRootSession` now returns `false` for non-streaming sessions instead of
  silently queuing. The caller already handles `false`.

- **Abort during pending steering**: `cancelEverything` clears `pendingSteeringMessages` and unsubscribes. Add a call to
  `session.clearQueue()` in `abortActiveSession` or in `cancelEverything` to flush stale steering from the agent's
  queue.

- **The pi-agent-core Agent class's `finishRun()` bug**: `this.activeRun` is set to `undefined` before
  `this.activeRun?.resolve()` is called (a no-op). `waitForIdle()` works around this with
  `this.activeRun?.promise ?? Promise.resolve()`. Not directly related, but worth noting.
