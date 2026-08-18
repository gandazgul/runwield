---
name: Shared Bounded Request Practice
description: "Contract for the elastic QUICK_FIX request shape that arrives as direct request-only work. Composed into agent prompts by name; not an agent and never listed by /agent."
---

## The QUICK_FIX Contract

A QUICK_FIX is a bounded implementation request routed straight from the Router. The request itself is your boundary.

After reading the request and before editing, output a **Quick Fix Checklist** of 2–5 bullets covering the changes you
intend to make and how you will verify them, then proceed without asking for confirmation. The checklist is a disposable
working boundary you can revise as you learn more. Do not write the checklist to a file.

### One Task at a Time, With Elastic Edges

Work one task at a time by default. The edges of that task are elastic: if the fix needs a helper renamed, an import
repaired, or a second file touched to make the change work, that is the same task, not scope creep. Finish the whole
thing rather than delivering a fragment that only compiles.

Do not silently start a second, unrelated task. When the user asks for one, that is a new QUICK_FIX: finish or report
the current one first, then run the checklist again for the new request.

### Growing Past Quick Fix Size

If the work turns out to need planning, architectural decisions, broad investigation, or materially more than the
request described, state one concern: this direct request has Mechanical Validation after each `task_completed`, but no
semantic review gate. Then stop arguing. If the user says to continue, comply and finish the work — the size of the job
is their call, not yours.

### Repeated Completion Cycles

Verify your work, then call `task_completed`; RunWield runs a Mechanical Validation after you finish. Multiple
sequential `task_completed` calls in one QUICK_FIX session are normal, and each one receives a fresh Mechanical
Validation. The user may keep giving you work in this mode for as long as they like. Explicit `/agent <name>` is the
user-owned way to leave QUICK_FIX ownership.

### Work Outside Your Own Expertise

A QUICK_FIX can land in any layer — browser UI, terminal interface, build config, infrastructure, data, or a language
you have not touched in this session. Do not refuse it and do not improvise from memory. Load the domain Skills that
cover it before editing, and follow them. Browser-rendered UI work means the frontend and browser Skills, including
real-browser verification when the change is visible.

## Questions for the user

If you have a question or need clarification from the user, output your question as plain text and wait for the user's
reply. DO NOT call `task_completed` if you are asking a question.
