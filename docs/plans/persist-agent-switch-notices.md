---
planId: "5d5685b0-9234-495d-ae78-00f0f2eb7edc"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/session/active-agent-session.js"
    - "src/shared/session/active-agent-session.test.js"
    - "src/shared/session/session.js"
    - "src/shared/session/agent-switching.js"
    - "src/shared/session/agent-switching.test.js"
    - "src/shared/session/session-runtime-events.js"
    - "src/shared/session/session-runtime-events.test.js"
    - "src/shared/session/session-transcript-projection.js"
    - "src/shared/session/session-transcript-projection.test.js"
    - "src/shared/session/session-transcript-manifest.ts"
    - "src/shared/session/session-transcript-manifest.test.js"
    - "src/ui/tui/runtime-adapter.js"
    - "src/ui/tui/runtime-adapter.test.js"
    - "src/ui/tui/golden-scenarios/slash-command-tree-configuration.ts"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-20T20:26:45-04:00"
status: "validated_reviewer"
origin: "internal"
userVerifiedAt: null
targetBranch: "main"
---

# Persist Agent Switch Notices

## Context

RunWield already persists the active Agent as `runwield.active_agent` custom entries in the Session Transcript. A
successful `/agent operator` command also emits an `agent_changed` runtime event. Today, the TUI uses that event only to
refresh the footer, and transcript replay uses the persisted entry only to label later Agent messages. The conversation
therefore gives no visible indication that ownership changed between two messages.

The user chose to show notices for all real root Agent handoffs, including workflow-driven handoffs, not only manual
`/agent` commands. Initial Session activation and same-Agent root rebuilds must stay quiet. A Prompt Template can now
publish a temporary Agent profile for one auxiliary turn. That profile does not change the Session's root Agent and must
not create a switch notice.

## Objective

Show one RunWield system-message block in the ordered conversation whenever Session ownership moves to a different root
Agent. For the example flow, the block between the Planner response and the next user message reads `RunWield` /
`Agent switched to Operator`. Persist the display identity in the existing active-Agent entry so resume replays the same
notice at the same Session Transcript position.

## Approach

Keep `runwield.active_agent` as the source of truth instead of adding a second persistence entry. Extend its data with
the Agent display name while retaining the canonical internal name used for resume.

Mark the existing live `agent_changed` event as a root handoff only when `switchActiveAgent` commits a different
canonical root Agent. Include the committed display name on that event. Initial activation, same-Agent rebuilds, and
temporary Prompt Template profiles continue to update active presentation state, but do not carry the root-handoff
marker. The TUI starts from the snapshot's root Agent and adds a notice only for a marked, different canonical identity.
This preserves current footer refreshes without confusing a one-shot execution profile with a Session ownership change.

Transcript projection applies the same canonical comparison to ordered active-Agent entries. The first Session marker
establishes a silent baseline. Each later different marker becomes a `system_status` replay event with a stable
entry-derived ID. Projection passes the final root-Agent identity from one Session Transcript Segment into the next with
explicit projection state, not module-global state.

```text
Root Agent activation commits
  recordActiveAgent(agentName, displayName)       existing durable entry, richer data
  emit agent_changed(..., rootHandoff: true)      only when canonical identity changed
       └─ TUI shows RunWield / Agent switched to <Display Name>

Initial, refresh, or temporary profile event
  emit agent_changed(..., no rootHandoff)
       └─ presentation refresh only; no notice

Session resume
  project ordered active-Agent entries
       ├─ first Session marker: silent baseline
       ├─ repeated canonical name: no notice
       └─ different canonical name: replay the same RunWield notice
```

The set-aside option is a new display-only custom entry for each switch. It would duplicate the existing Agent marker
and create two records that could disagree about ordering, identity, or persistence.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/session/active-agent-session.js` and `active-agent-session.test.js` — persist and read the display name
  with the canonical active-Agent marker while retaining old-entry compatibility and canonical duplicate suppression.
- `src/shared/session/session.js` — pass the loaded Agent definition's display name when the committed root records its
  active-Agent marker.
- `src/shared/session/agent-switching.js` and `agent-switching.test.js` — publish the committed display identity and an
  explicit root-handoff signal only after a successful switch to a different canonical root Agent.
- `src/shared/session/session-runtime-events.js` and `session-runtime-events.test.js` — define and validate the optional
  display name and root-handoff signal on `agent_changed` without breaking existing event consumers.
- `src/shared/session/session-transcript-projection.js` and `session-transcript-projection.test.js` — convert later,
  different active-Agent markers into stable `system_status` replay events and keep the first Session marker silent.
- `src/shared/session/session-transcript-manifest.ts` and `session-transcript-manifest.test.js` — carry root-Agent
  projection state across ordered Session Transcript Segments.
- `src/ui/tui/runtime-adapter.js` and `runtime-adapter.test.js` — append the live RunWield block only for a marked root
  handoff to a different canonical identity while preserving footer rendering for all `agent_changed` events.
- `src/ui/tui/golden-scenarios/slash-command-tree-configuration.ts` — extend the composed `/agent` journey to prove the
  notice appears in the visible conversation before the next user turn.

`src/shared/session/session-runtime.js` remains the owner of initial and temporary profile events. Those events stay
presentation-only and are deliberately not persisted or shown as root-Agent handoffs.

## Reuse Opportunities

- `src/shared/session/active-agent-session.js` — reuse `ACTIVE_AGENT_CUSTOM_TYPE`, canonical-name normalization, and the
  existing adjacent-marker deduplication as the persistence authority.
- `src/shared/session/session-transcript-projection.js` — follow the existing model/thinking-level transition replay
  pattern and use `makeEventId`/`entryMessageId` for stable replay identity.
- `src/ui/tui/api.js` — use `appendSystemMessage(text, false, "RunWield")` and the current shared system-message block;
  no new visual component or design token is needed.
- `src/shared/session/session-runtime.js` — keep its current initial snapshot and `agent_changed` delivery paths; do not
  add a TUI-specific persistence seam.

## Implementation Steps

- [ ] Each newly persisted `runwield.active_agent` entry contains the canonical internal `agentName` and the loaded
      Agent definition's `displayName`. Resume accepts entries without `displayName`, and adjacent entries with the same
      canonical name remain deduplicated.
- [ ] `agent_changed` supports optional `displayName` and `rootHandoff` data. `switchActiveAgent` sets
      `rootHandoff: true` only after it commits a different canonical root Agent; initial activation, same-Agent
      rebuilds, and temporary Prompt Template profiles do not set it. Failed Agent construction emits no root-handoff
      event.
- [ ] The TUI runtime adapter starts with the snapshot's canonical root identity, keeps all existing footer refreshes,
      and appends `Agent switched to <Display Name>` with the `RunWield` header exactly once for each marked handoff to
      a different canonical name. Unmarked profile events and repeated target events append no switch block.
- [ ] Transcript projection treats the first active-Agent marker in the Session as a silent baseline and emits one
      informational `system_status` event for each later different canonical name. The event uses persisted
      `displayName` when present, the existing project-aware display-name resolver for legacy entries, the `RunWield`
      header, and a stable marker-derived event ID.
- [ ] Aggregate projection passes final root-Agent state across ordered Session Transcript Segments. A repeated marker
      at the start of a successor Segment is silent; a different marker emits one notice; assistant labels before the
      next marker continue to use the carried Agent identity.
- [ ] Behavioral tests fail if the implementation only enriches events or markers without rendering both the live and
      resumed notices. The composed `/agent` journey proves a successful Guide-to-Planner switch adds the RunWield block
      before the next user message, while unsuccessful switches retain only their current error.

## Approval Confirmation

No Work Records are proposed for supersession.

## Verification Plan

- Automated behavior:
  `deno run -A scripts/run-tests.js src/shared/session/active-agent-session.test.js src/shared/session/agent-switching.test.js src/shared/session/session-runtime-events.test.js src/shared/session/session-transcript-projection.test.js src/shared/session/session-transcript-manifest.test.js src/ui/tui/runtime-adapter.test.js`.
  These tests must prove marker compatibility, root-handoff classification, live rendering, stable replay, duplicate
  suppression, and both same-Agent and different-Agent Segment boundaries.
- Automated TUI journey:
  `deno run -A scripts/run-tests.js src/ui/tui/golden-scenarios/slash-command-configuration.test.ts --filter 'slash-command-agent-preset-model-precedence'`.
  The scenario must fail if `/agent planner` changes only the footer and does not add the RunWield switch block before
  the next submitted message.
- Automated preservation: run
  `deno run -A scripts/run-tests.js src/ui/named-invocation-cross-surface.integration.test.ts` to confirm one-shot
  Prompt Template profiles still publish their active profile without becoming root-Agent handoffs.
- Automated regression: run `deno task seams:check`, then `deno task test`.
- Manual: start a TUI Session as Planner, submit a message, run `/agent operator`, and submit another message. Confirm
  that a shared system block with header `RunWield` and text `Agent switched to Operator` is between the Planner
  response and the later user message.
- Manual: close and resume the same Session. Confirm that the block appears once in the same position and that the
  footer still identifies Operator.
- Manual: select the already-active Agent and attempt an unavailable or invalid Agent switch. Confirm that the former
  adds no switch notice and the latter keeps the current error without a success notice.
- Expected preservation: model selection, active workflow release rules, temporary Prompt Template profile events,
  footer updates, Session resume identity, and Agent-message labels continue to use their current owners.
- Expected removal: successful root Agent handoffs no longer occur silently in the visible Session history.

## Edge Cases & Considerations

- Old Session Transcripts have no persisted display name. Replay must not fail; use the existing project-aware resolver
  and fall back to the canonical name if the Agent definition is unavailable.
- Project-defined Agent names can contain more than one word or custom casing. New entries and live events use the
  loaded definition's display name rather than deriving one from the filename.
- A root can rebuild because its model, working directory, handler, tools, or preset changed while the Agent identity
  stayed the same. This is not an Agent handoff and must not produce a notice.
- A Prompt Template can temporarily publish another Agent profile and then restore the root profile. Neither event is a
  Session ownership handoff, so both remain quiet while the footer and other consumers still update.
- The first active-Agent marker in a Session is initialization, not a switch. The first marker in a later Segment is not
  automatically initialization; compare it with the prior Segment's final identity.
- Live and replay paths use the same wording and header. Stable projected event IDs and canonical-name comparison
  prevent duplicate blocks.
- A failed target-Agent construction leaves the previous root transaction and marker intact, so it emits and replays no
  success notice.
- Active-Agent persistence is currently best-effort and must not block root construction. Preserve that failure policy:
  a transcript write failure can prevent resume from reconstructing both the active Agent and its notice, but it must
  not leave a false durable marker or stop an otherwise successful live handoff.
- The current uncommitted `src/shared/session/session.js` edit adds an unrelated static context-token helper near this
  change surface. Preserve it during implementation and resolve any worktree drift without deleting that user change.
