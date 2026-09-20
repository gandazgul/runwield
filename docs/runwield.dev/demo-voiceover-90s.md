# RunWield — 90-second voice-over

Practice against `demo-media/runwield-main-flow-90s.mp4`. Leave the first three seconds silent. Each paragraph starts at
the indicated cue; pause if you reach the next cue early. The video already has short on-screen captions.

**0:03 — Request and routing**

I ask RunWield to add account lockout. Router recognizes an authentication policy change and hands it to Planner, which
clarifies the requirements before code changes begin.

**0:15 — Plan Review**

In Plannotator, I review the Plan and inspect the affected files. Here, I add a concurrency requirement: two failed
logins must never overwrite each other's counters. I send that feedback to Planner. It revises the Plan and adds a test.
I inspect the changes, then approve execution.

**0:38 — Execution**

The Engineer implements the approved Plan in an isolated worktree, including tests and documentation.

**0:45 — Validation and repair**

A failed check triggers repair. All twenty-nine tests pass. Review then catches a timing-dependent test. RunWield fixes
the findings and validates again.

**0:57 — Code Review**

Plannotator's Guided Review explains the implementation and concurrency design. I can move into the actual diff, inspect
the code side by side, and give the final human approval.

**1:16 — Delivery and Workspace**

RunWield records the work and merges it to main. The same Session, repair evidence, and Plan remain available in
Workspace.

**1:26 — Close**

Review the Plan. Steer the work. Prove the result.
