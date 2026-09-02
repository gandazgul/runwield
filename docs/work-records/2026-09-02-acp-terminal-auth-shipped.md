---
kind: "work_record"
recordId: "bf95aaac-2076-40f5-9d08-d74b018d380c"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-02T22:05:05.789Z"
provenance:
    sourcePlans:
        - "4977717f-6eee-4732-ac1b-c44bef919fa8"
---

# ACP Terminal Auth shipped

## Summary

RunWield now advertises ACP Terminal Auth when the client supports it, blocks `session/new` with ACP `-32000` until
login and a usable default model are ready, and supports `wld login` plus `wld acp login` as setup-only flows that do
not create a Session. Verification passed through focused tests, the real NDJSON initialize probe, mutation proof, seams
check, type check, full test suite, CI, and compile.

## Deviations from Plan

Manual external ACP Client UI testing was not exercised. Equivalent wire behavior and setup behavior were verified with
the real NDJSON server and virtual terminal tests.

## Deferred Work

External ACP Registry publication remains separate: versioned agent metadata, icon creation, and upstream pull request.
Agent Auth, ACP logout, `authenticate`, and active-session token refresh remain out of scope.

## Future Planning Notes

Treat ACP readiness as credentials or authenticated backend plus a usable default model, not credential storage alone.
Keep Terminal Auth routed through existing login and model-selection owners so setup-only flows and live `/login`
behavior do not diverge.
