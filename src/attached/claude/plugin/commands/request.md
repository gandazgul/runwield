---
description: Plan one FEATURE request with RunWield
argument-hint: <request>
disable-model-invocation: true
---

Start RunWield only for this request: $ARGUMENTS

1. Call the RunWield MCP tool `activate`. Use a new unique `operationId` and put the user's request in
   `payload.requestText`. Use `${CLAUDE_SESSION_ID}` as `payload.hostRequestId`. If that variable is not substituted,
   generate a unique identifier instead. The MCP server supplies host and adapter version evidence.
2. Follow the returned `instructions` for the pending role. Use `workflow.workflowId`, `workflow.revision`, and
   `workflow.nextAction.actionId` in each lifecycle call. Check that the action contract is `runwield.attached.triage/1`
   for the Router or `runwield.attached.planner/1` for the Planner. If another contract is returned, stop and tell the
   user the plugin and Core contract versions do not match.
3. Call `triage_report` after Triage. For a FEATURE Plan, show the setup preview before writing the Plan, then call
   `plan_written` with the Plan name. Follow the next result. A rejection with a pending action lets you repair the
   input and retry with a new `operationId`; reuse an ID only when retrying a call that returned no result.
4. When `workflow.nextAction.kind` is `review`, show `review.url`. Poll `status` with a short shell sleep between calls
   while the browser review is pending. Feedback returns a new Planner action: read its feedback, image paths, and note,
   revise the Plan, then call `plan_written` with the new action ID and current revision. The live browser page is
   reused for the next round. Browser edits are already saved; do not apply them twice.
5. After cancellation, tell the user that review was canceled and ask what to do next. The workflow remains open.
   `/runwield:plan-review` restores the last open workflow in a fresh conversation. For `plan_ready`, report approval
   and readiness; execution handoff is a later Preview step. Answer unrelated requests as ordinary Claude Code.

Use Claude Code's tools and other MCP servers normally. RunWield adds no hooks or tool restrictions. Stay in Claude Code
and the browser; use no RunWield CLI or TUI commands. Claude Code owns all model calls. This plugin supports FEATURE
planning, browser review, and durable review recovery. Execution, installation, and full preflight are separate
capabilities.
