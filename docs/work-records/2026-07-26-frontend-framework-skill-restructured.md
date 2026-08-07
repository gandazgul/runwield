---
kind: "work_record"
recordId: "2f15e59b-b2fb-4948-83d8-4653905a34b0"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-26T22:06:34.501Z"
provenance:
    sourcePlans:
        - "8db5439a-35d9-439b-a434-95f01adf1843"
---

# Frontend Framework Skill Restructured

## Summary

Reworked the bundled frontend-framework Skill into a concise convention-first reference index with separate engineering,
UX, and visual-design guides plus a scoped Apache-2.0 license package. Verification passed via Markdown formatting
checks, bundled-skill release checks, scenario audits, and `deno task ci`.

## Future Planning Notes

The Skill intentionally keeps a broad trigger description so one frontend Skill can cover engineering, UX, and visual
design without introducing another model-invoked skill. Browser mechanics remain delegated to `agent-browser-use`.
