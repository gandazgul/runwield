---
kind: "work_record"
recordId: "b4ee683d-de4d-4f5f-8f91-b3513e1970c4"
status: "approved"
scope: "planned_change"
workKind: "MAINTENANCE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-10-06T12:19:00.047Z"
provenance:
    sourcePlans:
        - "12d49502-432a-4d2a-8c5e-475ff0a869f4"
---

# Validated Laptop-Owned Remote Save Proof

## Summary

Validated an isolated proof of real Pi turns over SSH with synchronous, laptop-owned Session saves. Native locks, save
ordering, five fault/recovery cases, duplicate and authentication checks, stale-delivery rejection, and compiled
macOS/Linux paths passed. Results support design review, not production adoption. Production code, dependencies,
configuration, and tests were unchanged; proof code and raw evidence remain ignored.

## Deviations from Plan

1. Superseded requirement: Use Pi 0.87.1, described by the Plan as the installed, locked dependency, for the real Pi
   Session persistence proof. Replacement requirement: Use the execution checkout's locked Pi 1.0.0 for the real Pi
   Session persistence proof. Inspect and verify its in-memory Session construction and persistence hooks before
   implementation. Record the actual version and compatibility findings. Do not modify production dependencies. Reason:
   The execution checkout locks Pi 1.0.0. The owner approved using that version without changing production
   dependencies.

## Deferred Work

Owner usability judgment and the storage-design decision remain open; production child03 stays paused. Production
integration, Pi lifecycle paths outside the intercepted hooks, rollover, attachments, broader provider/platform
coverage, network partitions, and power-loss durability remain unqualified.

## Future Planning Notes

Keyboard response was 77/327/841/2581 ms with added acknowledgement delays of 0/50/150/500 ms, and 4967 ms during a
stall. Independent Stop took 642 ms. These are samples, not latency promises. Recovery must discard unsaved Pi state and
reload laptop evidence without replaying external actions; a save acknowledgement is not a distributed transaction.
