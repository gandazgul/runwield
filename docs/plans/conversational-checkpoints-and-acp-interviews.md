---
planId: "0793ef3b-1dfa-465e-8873-2035c55d4f8b"
classification: "PROJECT"
type: "sequence"
complexity: "HIGH"
affectedPaths:
    - "src/tools/pair-checkpoint.ts"
    - "src/tools/task-completed.ts"
    - "src/tools/user-interview.ts"
    - "src/shared/session/"
    - "src/shared/workflow/execution-collaboration.ts"
    - "src/acp/"
    - "src/ui/workspace/"
    - "src/ui/tui/runtime-interaction-adapter.js"
    - "docs/prd/"
    - "docs/domain-language.md"
tickets:
    - url: "https://github.com/openabdev/openab/pull/1533"
createdAt: "2026-09-20"
origin: "internal"
userVerifiedAt: null
status: "validated"
epicCompletionMode: "done_enough"
epicDoneEnoughAt: "2026-09-24T17:54:00.206Z"
epicDoneEnoughSummary: "All 2 child plans are completed after conversational-checkpoints-and-acp-interviews/02-acp-interview-chat-fallback."
workRecord:
    status: "generated"
    recordId: "d140df78-c3cc-43d8-a0c8-8f588a67a5e7"
    path: "docs/work-records/2026-09-24-conversational-pair-checkpoints-and-acp-interview-chat-fallback.md"
    lastAttemptAt: "2026-09-24T17:55:02.869Z"
---

# Conversational Pair Checkpoints and ACP Interview Fallback

## Context

The owner wants real conversation at Pair checkpoints, not a one-answer feedback box. OpenAB also did not merge the
form-elicitation PR, so `user_interview` needs a chat fallback that does not require a client patch or local browser.

The agreed scope is two ordered changes. Pair becomes conversational in TUI, Workspace, and ACP, including its final
checkpoint. ACP interviews keep native forms where supported; otherwise numbers/labels select choices and other
meaningful text reaches the model as Other. Command menus, workflow decisions, and browser reviews are not converted.

Owning capabilities: [Core Pair Execution](../prd/runwield-core-prd.md#frontend-engineering-and-pair-execution),
[Core Session continuity](../prd/runwield-core-prd.md#session-continuity),
[Workspace Browser Sessions](../prd/runwield-workspace-prd.md#browser-sessions), and
[ACP interactions](../prd/runwield-acp-protocol-prd.md#protocol-negotiation-and-interactions). Each child updates its
requirements, scenarios, glossary, and affected architectural references with the implementation. These are proposed
changes, not delivery claims.

## Objective

Let the user discuss implementation and answer interviews through ordinary messages without weakening workflow
validation or depending on OpenAB form support. Keep native forms for interviews when the client supports them.

A larger feedback form was rejected because it still prevents conversation. Replacing every menu with model
interpretation was excluded: command choices still need exact values, and that broader work is not requested.

## Ordered Children

1. [Make Pair checkpoints a conversation](conversational-checkpoints-and-acp-interviews/01-conversational-pair-checkpoints.md).
   Report an increment, settle the turn, then discuss or record the user's natural-language direction in the same
   execution context. Include final assent and ACP support. Engineer owns this shared workflow change; Pair execution is
   recommended so the owner can exercise the conversation.
2. [Answer ACP interviews in chat without native forms](conversational-checkpoints-and-acp-interviews/02-acp-interview-chat-fallback.md).
   Deliver numbered questions and convert ordinary replies into the existing interview result. Preserve native forms and
   unchanged non-interview interactions. Engineer owns this transport change; autonomous execution is recommended.

## Vertical Slice Findings

Current Pair forms hold the Agent turn open. Both `pair_checkpoint` and initial Pair `task_completed` own such waits;
changing only the browser form would miss final completion and ACP. Ordinary follow-ups already use the active Agent
handler, but execution state and workflow tools need correct restoration between turns.

Current ACP `session/prompt` returns only when Runtime settles. The no-form adapter waits on a local browser. A text
answer cannot reach that wait through another normal prompt while the current ACP request remains open.

The children therefore have different lifetimes:

- **Pair:** committed checkpoint -> Runtime turn ends -> ordinary conversation continues on later turns.
- **Interview:** ACP question response ends -> the same live Runtime tool waits -> the next ACP request supplies its
  answer. No durable suspended tool is introduced.

## Expected Change Surface

The boundaries this Epic is expected to touch. This list is guidance, not an allowlist: each child Plan verifies the
real footprint during implementation and changes whatever its Implementation Steps need. Discovery that changes approved
intent — another subsystem joins the Epic, public behavior or architecture shifts, migration risk grows — comes back to
the user, not to the file list.

- Shared checkpoint, completion, and Session activation paths — preserve typed decisions and same-worktree conversation.
- TUI, Workspace, and ACP — present Pair reports through ordinary conversation; no new feedback form.
- ACP request/operation coordination and interview mapping — native-first fallback without losing the waiting tool.
- Tests, Agent guidance, owning PRDs, ADR-006/010/015, and glossary — behavior and current guidance land together.

## Reuse Opportunities

Use existing managed Session settlement, execution handoff identity, typed completion journal, interaction broker,
normal composers, and ACP response-write ordering. Do not create a gateway, database authority, permanent client fork,
or separate conversation for either feature.

## Verification Plan

Each child owns exact test commands and manual evidence. The container is not directly executable and adds no release
gate. Child 2 includes the combined OpenAB check after both changes land.

### Outcome Evidence

- Pair supports real discussion: a checkpoint settles, a later question changes no implementation or validation state,
  and a requested revision changes the same worktree before another checkpoint. Reload retains the conversation.
- Final assent remains distinct from delivery: only a valid recorded decision plus accepted `task_completed` enters
  existing validation. Prose or a checkpoint alone cannot complete a Plan.
- Unmodified no-form ACP works: an interview question response finishes before the user replies; free text returns as
  Other in the original tool result. A later normal message and a Pair conversation both work in that Session.
- Preserve native interviews, exact command choices, browser Plan/code review, cancellation, autonomous execution,
  Session ownership, and the publication-or-abandonment completion rule.
- Retire Pair feedback forms, ACP's form-based Pair exclusion, and no-form interview browser dependence. Do not delete
  unrelated interaction coverage when replacing those tests.

## Edge Cases & Considerations

Native forms remain preferred only for interviews; Pair is conversational on every supported interactive surface. This
does not claim remote reachability for other local browser review/question pages. Process-local unanswered ACP
interviews still require retry after process loss; committed Pair discussion does not depend on a live form Promise.

The older `fix-workspace-pair-checkpoint-decisions` draft proposes buttons and conflicts with this direction. Do not
execute it alongside this Sequence. No unrelated Plan status or Work Record supersession is part of this approval.
