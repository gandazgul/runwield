# RunWield Demo Voiceover — Rough Script

Target length: 3 minutes 39 seconds. Read calmly and leave a little air at each cut. The video is intentionally silent
so this can be recorded as a clean voice-over track.

## 0:00 — Intent before action

Most coding agents begin by changing files.

RunWield begins one step earlier: it decides what kind of work this is, and how much process the request actually
deserves.

That keeps small tasks small, while changes with a larger blast radius slow down where human judgment matters.

## 0:15 — Router to Planner

First, I am asking for account lockout after repeated failed logins. Because this changes authentication policy, I have
also asked for a Plan before any code is touched.

Router reads the request in the context of the repository. It inspects the relevant authentication code and tests,
classifies the work as a medium Planned Change, and hands the Session to Planner.

Router is not choosing another chat application. It is choosing the workflow this request deserves.

## 0:51 — A durable Plan

To see the rest of the lifecycle without waiting through a full model run, I am switching to another real authentication
Session that has already completed. Planner turned this request into a concrete implementation contract.

The Plan records the objective, the affected files, the intended approach, important edge cases, and the checks that
must prove the result. Here, the approved Plan adds a protected current-user endpoint while keeping every expected
authentication failure generic and safe.

Because the Plan is stored with the project, it is durable project knowledge—not reasoning trapped in a temporary
conversation. This is also the cheapest place to correct direction, before there is a large diff to unwind.

## 1:19 — Execution with evidence

Approval authorizes execution. RunWield gives the implementation Agent the approved Plan and an isolated place to work.

The Agent changes the real repository, expands the test suite, and performs the manual authentication checks described
by the Plan. The activity remains visible, but I do not have to watch every raw command to know what is happening.

The important point is that execution stays anchored to intent I could review first.

## 1:44 — The same Session in Workspace

I started in the terminal, and now I am looking at the same Session in Workspace.

This is not a copied transcript or a second conversation. The approved Plan, implementation report, Agent state, and
Operator checklist are all part of the same durable Session.

The terminal is ideal when I am working directly in the repository. Workspace gives me a wider view of Sessions, Plans,
artifacts, and progress. I can move between them without abandoning context or starting over.

## 2:23 — Validation is a lifecycle result

RunWield does not treat the implementation Agent saying “done” as proof.

The repository's real test command runs, semantic review checks the implementation against the approved Plan, and manual
verification remains visible. Only after that evidence exists does the Plan move into the validated column.

If a check fails or the implementation misses the intent, the work returns through a bounded repair loop instead of
quietly being called complete.

## 2:45 — Guide, Ideator, and Operator

Not every request needs a Plan.

Ideator helps explore an unclear product idea before anybody commits to an implementation. Guide answers questions about
the repository and gives grounded next steps without changing it. Operator handles direct environment work and focused
verification.

The active role, model, and thinking level remain visible in the same Workspace. Router keeps the ceremony proportional
to the work.

## 3:27 — Close

At the end, RunWield leaves behind more than a finished diff. The approved Plan, validation outcome, Manual QA guidance,
and Session history become durable context for whatever comes next.

Plan clearly. Execute confidently.
