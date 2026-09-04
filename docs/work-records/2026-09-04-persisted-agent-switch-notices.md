---
kind: "work_record"
recordId: "018b70db-22f4-4b54-aee7-53306bf6e515"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-04T03:15:30.275Z"
provenance:
    sourcePlans:
        - "5d5685b0-9234-495d-ae78-00f0f2eb7edc"
---

# Persisted Agent Switch Notices

## Summary

RunWield now shows and replays visible RunWield notices when Session ownership moves to a different root Agent.
Active-Agent transcript markers store both canonical Agent names and display names, runtime events distinguish real root
handoffs from quiet profile refreshes, and replay preserves switch notices across transcript segments. Verification
passed with targeted session and TUI tests, the golden /agent journey, named-invocation preservation, seams check, full
test suite, and full CI.

## Future Planning Notes

Keep runwield.active_agent as the durable source for root-Agent identity. Treat temporary Prompt Template profiles and
same-Agent rebuilds as presentation updates, not ownership handoffs.
