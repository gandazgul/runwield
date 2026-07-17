---
kind: "work_record"
recordId: "684c71d5-d421-465a-94a5-34db50c2dde6"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-17T04:50:38.786Z"
provenance:
    sourcePlans:
        - "64cd784c-67b2-4ae5-a4cd-186c2d912ee7"
---

# Unified TUI and ACP Behind SessionRuntime

## Summary

Completed and verified the SessionRuntime sibling-adapter refactor. SessionRuntime now owns project-isolated lifecycle,
prompting, concurrency, cancellation settlement, snapshots, actions, semantic events, and interactions. TUI and ACP
consume the same adapter-neutral runtime contract, TUI-only composition moved out of shared core, and boundary,
isolation, parity, lifecycle, and concurrency tests protect the architecture.

## Deviations from Plan

A direct rendering fallback remains for standalone and test callers outside SessionRuntime; runtime-bound sessions
exclusively use semantic events and interactions.

## Deferred Work

Remaining audit findings outside the completed ACP prompt-overlap ownership change were deferred for separate planning.

## Future Planning Notes

Future in-process adapters should use runtime snapshots, actions, events, and interaction adapters without accessing
mutable HostedSession internals. Preserve the enforced core-to-adapter import boundary.
