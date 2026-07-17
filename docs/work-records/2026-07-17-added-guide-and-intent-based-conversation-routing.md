---
kind: "work_record"
recordId: "d9042849-7372-4cea-baf8-09644d4a7b90"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-17T04:50:13.149Z"
provenance:
    sourcePlans:
        - "6ab008c5-ee7a-40e3-9bc9-a441448d5bc5"
---

# Added Guide and intent-based conversation routing

## Summary

Introduced the read-mostly Guide agent and canonical Routing Intent handling. Non-materializing inquiries and ideation
now route to Guide and Ideator, while execution and plan-producing workflows retain their existing behavior. Added
legacy classification normalization, return-to-Router boundaries, agent tool-policy coverage, dispatch tests, and
verification through the project quality gate.
