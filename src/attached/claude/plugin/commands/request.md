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
4. When a result has no role instructions, the RunWield role ends. Tell the user the outcome. A submitted Plan can be
   opened and run with `wld`. Answer later unrelated requests as ordinary Claude Code.

Use Claude Code's tools and other MCP servers normally. RunWield adds no hooks or tool restrictions. Claude Code owns
all model calls. This plugin supports FEATURE planning and Plan submission; browser review, execution, installation, and
full preflight are separate capabilities.
