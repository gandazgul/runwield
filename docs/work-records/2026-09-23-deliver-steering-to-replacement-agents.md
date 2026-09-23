---
kind: "work_record"
recordId: "c2c2d43c-223e-425b-954a-89a13157b230"
status: "approved"
scope: "planned_change"
workKind: "BUG_FIX"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-23T16:07:59.874Z"
provenance:
    sourcePlans:
        - "aa89b924-c36c-45fa-8df6-b156586a1fc4"
---

# Deliver steering to replacement Agents

## Summary

Fixed Agent-handoff steering so the outgoing turn settles before replacement work begins and queued text or images
transfer once, in order, to the new Agent. Added handoff, identity, recall, cancellation, and failed-switch coverage;
focused sandboxed tests, type checks, seam checks, and diff checks passed. Core requirements and domain language now
define the behavior.
