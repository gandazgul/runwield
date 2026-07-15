---
kind: work_record
recordId: ac7469b4-a3b4-41bd-b61b-b65be06eae18
status: approved
scope: feature
origin: external
completionMode: verified
createdAt: 2026-07-14T08:32:00-04:00
provenance:
    evidence:
        - path: src/shared/session/agent-switching.js
          note: Implements the atomic switch primitive, staging the matching handler before committing replacement root state.
        - path: src/shared/session/session-runtime.js
          note: Owns atomic activation plus aggregate busy lifecycles for prompts and direct model or workflow operations.
        - path: src/shared/session/agent-handler.js
          note: Produces explicit completion or handoff results without scheduling mutable agent-switch state.
        - path: src/shared/session/session-runtime-events.js
          note: Publishes completed semantic agent changes for sibling consumers without a presentation dependency.
        - path: src/ui/tui/runtime-adapter.js
          note: Consumes Runtime agent-change events and renders authoritative Runtime snapshot state without a core UI setter.
        - path: src/shared/session/architecture-boundary.test.js
          note: Enforces the consumer-neutral boundary and absence of the deleted two-phase activation API.
---

# Atomic Active Agent Switching

## Summary

RunWield now performs every active-agent transition as one Runtime-owned operation. Initial activation, resumed
sessions, explicit consumer requests, workflow transitions, and agent-requested handoffs all finish with a matching root
Agent Session and Agent Handler before control returns or a completed `agent_changed` event is published. Handler
construction is staged before root replacement, so construction failures preserve the previous usable pair instead of
leaving a partially switched session.

The refactor removed scheduled root swaps, pending handoff state, caller-managed apply steps, the public two-phase
`setSessionHandler`/`ensureSessionReady` seam, and the TUI-specific agent-info setter. Agent Handlers now return
explicit typed completion or handoff results, which SessionRuntime consumes between settled turns while preserving
cancellation, handoff limits, session isolation, and model/tool-policy rebuild rules. TUI and ACP remain sibling
consumers of the same semantic Runtime state and events; neither constructs handlers or reaches into root-session
switching internals. Runtime also reference-counts busy operations across prompts, planning, Slicer, execution,
validation, isolated agents, and compaction, preserving consumer animations without restoring a presentation call in
Core. Full repository CI, Workspace production build, release packaging, and release-binary smoke testing verified the
completed boundary.
