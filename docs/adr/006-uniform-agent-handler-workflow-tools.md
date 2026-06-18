# ADR-006: Active Agents Use One Workflow-Aware Handler

## Status

Accepted

## Context

Harns previously treated Router as both an Agent and a workflow entrypoint. The runtime had a Router-specific handler
that consumed `triage_report`, while other Agents used a separate handler that consumed `plan_written` and
`task_completed`.

That split made Agent activation shallow and fragile. Boot, `/agent`, `return_to_router`, `load-plan`, and workflow
restores all had to know which handler to install. If any path activated Router with the normal Agent handler, Router
could call `triage_report` successfully but nothing would dispatch the workflow afterward.

## Decision

All active Agents use one Agent Handler.

The Agent Handler runs the active Agent turn, then inspects workflow Custom Tool outcomes from that turn:

- `triage_report` starts post-triage workflow dispatch.
- `plan_written` starts Plan execution or keeps the planning Agent active, depending on the Review Loop outcome.
- `task_completed` continues active execution or Workflow Validation when execution context exists.

Router is the default Agent for fresh Triage, but Router has no special runtime handler. If another Agent is granted
`triage_report`, the same post-triage workflow dispatch runs from that tool outcome.

Agent switching is uniform. Boot, `/agent`, `return_to_router`, Plan recovery, validation restore, and workflow steps
activate an Agent by installing the same Agent Handler for the chosen Agent Name.

Workflow-only Agent Definitions such as Reviewer, Slicer, and Init are still Agents. They may be hidden from `/agent`
selection and may be run as one-shot workflow Agent Sessions, but they are not special runtime modes. When a
workflow-only Agent remains active for follow-up turns, such as Slicer during Epic decomposition, Harns uses the same
Agent Handler with explicit session data for that Agent Definition and its workflow-scoped Custom Tools.

## Consequences

### Positive

- **Locality**: workflow outcome interpretation is concentrated in the Agent Handler instead of spread across activation
  call sites.
- **Leverage**: adding a workflow Custom Tool to an Agent preserves the tool's semantics without new handler code.
- **Simpler session model**: active Agent identity is data; there is no hidden "Router mode."
- **Better tests**: regressions can assert that any Agent emitting `triage_report` dispatches workflow.

### Negative

- The Agent Handler now knows about all first-class workflow Custom Tool outcomes. That is intentional: the handler is
  the seam between Agent Sessions and workflow orchestration.
- Callers that previously injected handler factories for tests must use `createAgentHandler`; older alternate handler
  names are intentionally removed.
