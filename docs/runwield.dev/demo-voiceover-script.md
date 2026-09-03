# RunWield Demo Voice-over — Rough Script

This is written for a future story edit, not the full 53-minute source. Read it naturally and leave pauses around the
Plan Review, validation failure, and Code Review. Those are the moments worth seeing rather than talking over.

## Opening

Most coding agents begin by changing files. RunWield begins by deciding what kind of work this is, how much process it
deserves, and where a human decision will have the most leverage.

For this demo, I am asking for an account-lockout policy: five failed logins, a fixed fifteen-minute lock, generic error
messages, documentation, and deterministic tests. Because this changes authentication policy, I have explicitly asked
for a Plan before any code changes.

## Router and Planner

Router reads the request in the context of the repository. It classifies the work as a medium Planned Change and hands
the Session to Planner.

Planner inspects the real authentication code and asks the policy questions that the request did not answer: whether a
locked request extends the window, whether a correct password should be denied during the lock, whether a successful
login resets prior failures, and whether existing tokens should remain valid.

Those answers become a concrete, durable Plan. This is important: RunWield is not asking me to approve a vague promise.
It gives me the objective, change surface, implementation steps, edge cases, and verification plan before implementation
begins.

## Plannotator Plan Review

This is the center of the workflow: Plannotator's Plan Review.

I can read the Plan as a document, inspect every affected file beside it, and check the proposed verification work. I am
not reviewing generated code yet. I am reviewing intent while changing direction is still cheap.

Here I catch a concurrency detail. The fifth failed login must be atomic; two requests cannot both read the same stale
counter. I leave that as a review annotation and send it back.

Planner accepts the feedback, revises the Plan to require `BEGIN IMMEDIATE`, and adds a deterministic two-connection
race test. In the Changes view I can see exactly what moved. Once the contract is right, I approve it and authorize
execution.

## Execution

RunWield creates an isolated worktree and gives the implementation Agent the approved Plan. The Agent changes the real
repository, expands the test suite from eighteen tests to twenty-nine, updates the policy documentation, and reports the
evidence it collected.

The useful distinction is that execution remains anchored to reviewed intent. The Plan is not a preamble that gets
forgotten once code starts moving.

## Validation and repair loops

The first validation run fails. RunWield does not hide that or rename the work complete. It sends the precise failure to
a focused repair Agent, applies the fix, and runs the checks again.

Then semantic review catches a subtler problem: the concurrency test itself uses polling and wall-clock delays, which
violates the Plan's deterministic-test requirement. A second repair replaces polling with worker-ready messages and
documents the remaining system-clock limitation. The full twenty-nine-test suite passes again.

This is what completion means here: not that an Agent stopped typing, but that the work survived the repository's real
checks and a review against the approved contract.

## Plannotator Code Review

Before merge, the same review surface opens for code.

Plannotator can show the direct diff, but it can also generate a Guided Review. The guide explains the login decision
sequence, the repository-owned lockout state machine, the migration, the two-worker concurrency ordering, and the
external no-disclosure behavior.

I can move from that explanation directly into the changed files, switch between unified and side-by-side diff, leave a
final review note, and approve the change. That approval returns to the live TUI Session, where RunWield creates the
Work Record, merges the validated commits, and cleans up the worktree.

## The same Session in Workspace

Now I switch surfaces. This is the same `Add Account Lockout Policy` Session in Workspace, not a copied transcript and
not a second run.

The routed request, Planner decisions, review feedback, implementation activity, validation findings, repair report,
Operator checklist, and Plan artifact are all still together. The completed Plan also appears on the project's validated
board.

The terminal is ideal when I am working directly in the repository. Workspace gives me a wider view of Sessions, Plans,
artifacts, and role controls without abandoning context.

## Guide, Ideator, and Operator

Not every request needs this entire workflow.

Guide answers questions about the repository without changing it. Ideator helps shape an unclear product idea before it
becomes implementation work. Operator performs direct environment work and focused verification. Router chooses the
right starting point and keeps the ceremony proportional to the request.

## Close

RunWield leaves behind more than a diff. It leaves a reviewed Plan, the decisions that shaped it, validation evidence, a
human code-review decision, and a durable Session that can continue in either interface.

Plan clearly. Execute confidently.
