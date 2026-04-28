# Implement explicit abort / exit mechanics for Harns

## Context
When interacting with Harns, users expect standard UNIX terminal conventions to apply even if an LLM is evaluating a request or streaming a response.
Currently, typing `/quit` or trying `Esc`, `Ctrl+C` doesn't always have an immediate effect, especially during plannotator's busy waiting or during long LLM inferences.

We need to implement a mechanism to:
1. Ensure the `/quit` command exits Harns immediately.
2. `Esc` interrupts (aborts) current LLM operations.
3. `Ctrl+c` behaves like `Esc` (abort) on the first press.
4. `Ctrl+c` behaves like `/quit` (exit) on the second press right after the first.
5. This has to work even when Harns is waiting for a plannotator plan review.

## Approach

1.  **Global AbortController state:** Introduce a mechanism in `src/shared/chat-session.js` (or a dedicated `abort-state.js` module) to keep track of a global `AbortController` (or an array of controllers, or a single standard cancellable signal) that active tools or LLM calls should respect. 
2.  **Key interception:** Hook into the TUI's input logic in `src/shared/chat-session.js` to capture `Ctrl+C`, `Esc`, and `/quit` explicitly *before* processing normal text. 
    * `Ctrl+C`: Maintain timestamp of last press. If delta < 500ms, exit. Otherwise, abort active request.
    * `Esc`: Abort active request.
    * `/quit`: Exit immediately.
3.  **Passing AbortSignal to Pi:** The underlying `pi-agents` SDK most likely supports `AbortSignal` for interrupting operations. We need to find how we pass an `AbortSignal` when starting agents or interactive sessions and wire our global abort signal into it. 
4.  **Plannotator interrupt:** Modify `src/tools/submit-plan.js` to accept the `AbortSignal` (or a related callback) to stop waiting for the browser. 

## Exploration required
1. How `startInteractiveSession` wires up to agents (how do we interrupt the LLM stream?).
2. How to pass a signal to `server.waitForDecision()` in `submit-plan.js` or forcefully unblock it when abort/quit is requested.

## Files to modify
- `src/shared/chat-session.js`
- `src/tools/submit-plan.js`
- (possibly others depending on exploration)

## Steps
- [ ] TBD

## Verification
- Start Harns, type a prompt that takes time. Press `Esc` - should cancel immediately.
- Type `/quit` while planning is running - should exit immediately.
- Submit a plan to plannotator. Press `Ctrl+C` once - should abort the wait.
- Double press `Ctrl+C` - should quit immediately.