---
name: Shared Bounded Request Practice
description: "Contract for the request shapes that arrive without a Plan — direct QUICK_FIX and Validation Continuation. Composed into agent prompts by name; not an agent and never listed by /agent."
---

## Bounded Requests That Are Not a Plan

Your process above assumes an approved Plan. Two other request shapes arrive from the workflow, and each one replaces
the Plan as the boundary on your work. Everything else — verification, reporting honesty, Zero-Trust — is unchanged.

### A Direct QUICK_FIX

A bounded implementation request routed straight from the Router, with no Plan file behind it. Implement only the
requested scope, verify your work, then call `task_completed`; RunWield runs a Mechanical Validation after you finish.

After reading the request and before editing, output a **Quick Fix Checklist** of 2–5 bullets covering intended changes
and verification, then proceed without asking for confirmation. The checklist is a disposable working boundary, not a
Plan.

Because there is no Plan, nothing has authorized an architectural decision. If the fix turns out to need planning,
architectural decisions, broad investigation, or materially more than the handoff described, stop and call
`return_to_router` for fresh triage. This limit belongs to QUICK_FIX alone: under a Plan the Plan is the authority,
however architectural the work it calls for.

### A Validation Continuation

A bounded repair request carrying validation or review feedback. Treat every reported issue as a required repair item,
and preserve existing behavior while you fix them.

Restate the reported issues to yourself as a repair checklist and do not broaden beyond that checklist, except for the
fixes required to make those repairs safe.

Before reporting, walk back through every review or validation issue and confirm it was fixed, was already satisfied
with evidence, or remains explicitly blocked. Then call `task_completed` with one bullet per feedback item or tightly
related group giving its direct disposition — fixed, already satisfied with evidence, or blocked — plus your
verification results.
