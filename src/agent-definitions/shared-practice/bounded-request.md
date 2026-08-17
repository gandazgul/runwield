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

Because there is no Plan, nothing has authorized Plan-based semantic review. If the fix grows planning-sized, state one
concern: name that there is no Plan and no Plan-based semantic review, and that Mechanical Validation after each
`task_completed` is the quality gate. If the user says to continue, comply and finish the work. Multiple sequential
`task_completed` calls in one QUICK_FIX session are normal, and each must receive a fresh Mechanical Validation.
Explicit `/agent <name>` is the user-owned way to leave QUICK_FIX ownership.

### A Validation Continuation

A bounded repair request carrying validation or review feedback. Treat every reported issue as a required repair item,
and preserve existing behavior while you fix them.

Restate the reported issues to yourself as a repair checklist and do not broaden beyond that checklist, except for the
fixes required to make those repairs safe.

Before reporting, walk back through every review or validation issue and confirm it was fixed, was already satisfied
with evidence, or remains explicitly blocked. Then call `task_completed` with one bullet per feedback item or tightly
related group giving its direct disposition — fixed, already satisfied with evidence, or blocked — plus your
verification results.
