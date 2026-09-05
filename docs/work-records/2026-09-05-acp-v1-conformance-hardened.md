---
kind: "work_record"
recordId: "d5c9b240-39a9-4d59-9c67-0b2fed44f46a"
status: "approved"
scope: "planned_change"
workKind: "BUG_FIX"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-05T03:42:31.979Z"
provenance:
    sourcePlans:
        - "28e93cd2-f201-4fd7-873c-c7ca4fbe9d5d"
---

# ACP v1 Conformance Hardened

## Summary

RunWield’s ACP v1 adapter was hardened against the remaining audit gaps. It now locks the ACP SDK at 1.4.0, negotiates
protocol version 1, reports the generated RunWield version, sends schema-valid cumulative USD usage cost, and returns
cancellation only after Runtime settlement and pending updates. Verification passed with focused ACP/MCP tests, seams
check, type/check gates, full CI, full test suite, and a manual negotiation check.

## Deferred Work

HTTP/SSE MCP, MCP prompts/resources, optional Session methods, exact context capacity, ACP v2, registry metadata, and
broader client delegation remain out of scope.

## Future Planning Notes

Keep ACP v1 SDK upgrades explicit and covered by schema characterization tests. ACP cost must remain Session-cumulative,
and cancellation completion must stay owned by Runtime settlement rather than adapter-local promises.
