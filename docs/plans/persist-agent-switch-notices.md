---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Show one durable RunWield system notice for every real Agent handoff in the TUI and replay it in the same Session Transcript position after resume."
affectedPaths:
    - "src/shared/session/active-agent-session.js"
    - "src/shared/session/active-agent-session.test.js"
    - "src/shared/session/session.js"
    - "src/shared/session/agent-switching.js"
    - "src/shared/session/session-runtime-events.js"
    - "src/shared/session/session-transcript-projection.js"
    - "src/shared/session/session-transcript-projection.test.js"
    - "src/shared/session/session-transcript-manifest.ts"
    - "src/ui/tui/runtime-adapter.js"
    - "src/ui/tui/runtime-adapter.test.js"
    - "src/ui/tui/golden-scenarios/slash-command-tree-configuration.ts"
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-08-20T20:26:45-04:00"
status: "draft"
objectiveChecks:
    - id: "OC1"
      command: "grep -q 'projection replays one RunWield notice for each real Agent handoff' src/shared/session/session-transcript-projection.test.js && deno run -A scripts/run-tests.js src/shared/session/session-transcript-projection.test.js --filter 'projection replays one RunWield notice for each real Agent handoff'"
      rationale: "The check requires and runs a new behavioral replay test that starts with persisted active-Agent markers and can pass only when real identity changes become ordered, durable notices while initialization and duplicates stay silent."
    - id: "OC2"
      command: "grep -q 'Agent switched to Planner' src/ui/tui/golden-scenarios/slash-command-tree-configuration.ts && deno run -A scripts/run-tests.js src/ui/tui/golden-scenarios/slash-command-configuration.test.ts --filter 'slash-command-agent-preset-model-precedence'"
      rationale: "The existing composed TUI journey does not assert or render this notice today; the check requires the real /agent path to show the expected switch block and pass its Golden TUI scenario."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
updatedAt: "2026-08-21T00:38:21.894Z"
planId: "5d5685b0-9234-495d-ae78-00f0f2eb7edc"
---

# Persist Agent Switch Notices

## Context

RunWield already persists the active Agent as `runwield.active_agent` custom entries in the Session Transcript. A
successful `/agent operator` command also emits an `agent_changed` runtime event. Today, the TUI uses that event only to
refresh the footer, and transcript replay uses the persisted entry only to label later Agent messages. The conversation
therefore gives no visible indication that ownership changed between two messages.

The user chose to show notices for all real Agent handoffs, including workflow-driven handoffs, not only manual `/agent`
commands. Initial Session activation and same-Agent root rebuilds must stay quiet.

## Objective

Show one RunWield system-message block in the ordered conversation whenever the active Agent identity changes. For the
example flow, the block between the Planner response and the next user message reads
`RunWield Agent switched to
Operator`. Preserve enough data in the existing active-Agent entry to replay the same notice
at the same transcript position after Session resume.

## Approach

Keep `runwield.active_agent` as the source of truth instead of adding a second persistence entry. Extend its data with
the Agent display name while retaining the canonical internal name used for resume. The live TUI compares each
`agent_changed` event with the active Agent from its initial snapshot and shows the notice only when the canonical name
changes. Transcript projection applies the same comparison to ordered active-Agent entries: the first entry establishes
the baseline, and each later different name becomes a `system_status` replay event with a stable entry-derived ID.

```text
Agent activation commits
  recordActiveAgent(agentName, displayName)    existing durable entry, richer data
  emit agent_changed(agentName, displayName)   existing live event
       └─ TUI compares with prior name and shows RunWield notice

Session resume
  project ordered active-Agent entries
       ├─ first name: baseline only
       ├─ repeated name: no notice
       └─ different name: replay the same RunWield notice
```

Carry the prior Agent identity across Session Transcript Segment boundaries so a handoff at the start of a successor
segment is neither missed nor mistaken for initial activation.

The set-aside option is a new display-only custom entry for each switch. It would duplicate the existing Agent marker
and create two records that could disagree about ordering, identity, or persistence.

## Files to Modify

- `src/shared/session/active-agent-session.js` — extend active-Agent marker data and reads with a persisted display
  name, while accepting old entries that contain only `agentName` and retaining adjacent canonical-name deduplication.
- `src/shared/session/active-agent-session.test.js` — cover richer marker data, old-entry compatibility, and duplicate
  suppression.
- `src/shared/session/session.js` — pass the loaded Agent definition's display name when the root Agent records its
  durable active-Agent marker.
- `src/shared/session/agent-switching.js` — include the committed Agent display name in live `agent_changed` events
  without changing the event's current footer/state role.
- `src/shared/session/session-runtime-events.js` — define and validate the optional Agent display-name field on
  `agent_changed` events.
- `src/shared/session/session-transcript-projection.js` — convert later, different active-Agent markers into stable
  `system_status` replay events and keep the first marker as a silent baseline.
- `src/shared/session/session-transcript-projection.test.js` — prove ordered notice replay, exact text/header, stable
  IDs, legacy marker fallback, and suppression rules.
- `src/shared/session/session-transcript-manifest.ts` — carry the final active-Agent identity from each ordered Session
  Transcript Segment into projection of the next segment.
- `src/ui/tui/runtime-adapter.js` — track the canonical active Agent from the initial snapshot and append the live
  RunWield system block only for a different Agent name.
- `src/ui/tui/runtime-adapter.test.js` — cover one live notice, initial-event suppression, same-Agent rebuild
  suppression, display names, and continued footer rendering.
- `src/ui/tui/golden-scenarios/slash-command-tree-configuration.ts` — extend the real `/agent` TUI journey to assert the
  visible RunWield notice appears before the next user turn.

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

- [ ] Each newly persisted `runwield.active_agent` entry contains the canonical internal `agentName` and the Agent
      definition's `displayName`; resume still accepts existing entries without `displayName`, and adjacent entries with
      the same canonical name remain deduplicated.
- [ ] A live `agent_changed` event carries both canonical and display identities after a root Agent transaction commits;
      failed Agent construction emits no success notice data and existing Agent/footer state behavior remains intact.
- [ ] The TUI runtime adapter establishes its prior canonical identity from the Session snapshot, then appends
      `Agent switched to <Display Name>` with the `RunWield` header exactly once for each later different canonical
      name. Initial activation, repeated events, and same-Agent forced rebuilds append no switch block.
- [ ] Transcript projection treats the first active-Agent marker as a silent baseline and emits one informational
      `system_status` event for each later different canonical name. The event uses the persisted display name when
      present, a readable legacy fallback when absent, the `RunWield` header, and a stable marker-derived event ID.
- [ ] Aggregate projection carries active-Agent identity across ordered Session Transcript Segments, so a same-Agent
      baseline marker in a successor segment is silent and a different first marker in that segment emits one notice.
- [ ] The composed TUI `/agent` journey proves that a successful Guide-to-Planner switch adds the RunWield switch block
      before the next user message, while command failure tests continue to prove that unsuccessful switches show only
      their current error.

## Approval Confirmation

No Work Records are proposed for supersession.

## Verification Plan

- Automated: run
  `deno run -A scripts/run-tests.js src/shared/session/active-agent-session.test.js src/shared/session/session-transcript-projection.test.js src/ui/tui/runtime-adapter.test.js`.
- Automated: run
  `deno run -A scripts/run-tests.js src/ui/tui/golden-scenarios/slash-command-configuration.test.ts --filter 'slash-command-agent-preset-model-precedence'`.
- Automated regression: run `deno task seams:check`, then `deno task test`.
- Manual: start a TUI Session as Planner, submit a message, run `/agent operator`, and submit another message. Confirm
  that a shared system block with header `RunWield` and text `Agent switched to Operator` is between the Planner
  response and the later user message.
- Manual: close and resume the same Session. Confirm that the block appears once in the same position and that the
  footer still identifies Operator.
- Manual: select the already-active Agent and attempt an unavailable or invalid Agent switch. Confirm that the former
  adds no switch notice and the latter keeps the current error without a success notice.
- Expected preservation: model selection, active workflow release rules, footer updates, Session resume identity, and
  Agent-message labels continue to use the existing active-Agent transaction and marker.
- Expected removal: successful Agent handoffs no longer occur silently in the visible Session history.

## Edge Cases & Considerations

- Old Session Transcripts have no persisted display name. Replay must not fail; use a readable form of the canonical
  name as the display fallback.
- Project-defined Agent names can contain more than one word or custom casing. New entries and live events must use the
  definition's display name rather than title-casing the filename.
- A root can rebuild because its model, working directory, handler, or tools changed while the Agent identity stayed the
  same. This is not an Agent handoff and must not produce a notice.
- The first active-Agent marker in a Session is initialization, not a switch. The first marker in a later Segment is not
  automatically initialization; compare it with the prior Segment's final identity.
- Live and replay paths must use the same wording and header. Stable projected event IDs and the runtime adapter's
  canonical-name comparison prevent duplicate blocks.
- A failed target-Agent construction leaves the previous root transaction and marker intact, so it must not emit or
  replay a success notice.
