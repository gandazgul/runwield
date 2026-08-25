---
classification: "PROJECT"
complexity: "LOW|MEDIUM|HIGH"
summary: "<Brief summary of the project-level change>"
# High-signal paths you have evidence for. RunWield uses these for drift warnings and Plan presentation; they are not
# an exhaustive list and never limit what a child Plan may change.
affectedPaths:
    - "path/to/file1"
    - "path/to/file2"
# Optional: only when the user identifies external demand URLs as Tickets.
# tickets:
#     - url: "https://example.com/tickets/ABC-123"
devServerCommand: null
devServerUrl: null
devServerHmr: null
# Optional: target execution branch for child Plans when explicitly requested by the user.
# worktreeBaseBranch: "feature/base-branch"
createdAt: "<ISO-8601 timestamp>"
status: "draft"
---

# <Plan Title>

## Context

What problem/request this plan addresses and the intended outcome.

## Objective

Clear statement of what changes and why. Reference any ADRs created. Name the main option you did not take and what it
would have cost.

## Vertical Slice Findings

Brief summary of what you traced deeply and how it informs the plan. Show the paths you walked — a call path, a small
`mermaid` flow or state diagram, a before/after of a boundary — wherever that reads faster than prose.

## Expected Change Surface

The boundaries this Epic is expected to touch. This list is guidance, not an allowlist: each child Plan verifies the
real footprint during implementation and changes whatever its Implementation Steps need. Discovery that changes approved
intent — another subsystem joins the Epic, public behavior or architecture shifts, migration risk grows — comes back to
the user, not to the file list.

- `path/to/file` — what changes here and why
- `path/to/another-file` — what changes here and why

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `path/to/existing/module.ts` — what to reuse
- `path/to/utility.ts` — what to reuse

## Verification Plan

- Automated: exact command(s) to run
- Manual: precise user flows / checks
- Expected results for key scenarios

### Outcome Evidence

An Epic is not executed directly, so it does not carry runnable checks of its own. What it owes its children is the
thing only the Epic knows: **what must be observably true when this architecture is real.**

For each Epic outcome, state the evidence that proves it — concrete enough that a child Plan can turn it into a command
that is red before the work and green after. "The migration is complete" is not evidence; "no module outside `storage/`
constructs a database handle" is.

- `<Outcome>` — observable evidence a child Plan can assert against.

Also state, across the whole Epic:

- which existing behavior must still be protected when every child has landed;
- which behavior is expected to stop existing.

Only the Epic knows that difference. Left unsaid, a child deletes a test that no longer compiles and the suite still
passes.

## Edge Cases & Considerations

- Risk 1 + mitigation
- Compatibility or migration concerns
- Open assumptions (if any)
