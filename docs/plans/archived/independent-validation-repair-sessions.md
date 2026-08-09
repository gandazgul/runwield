---
planId: "4b13c3a5-f10f-4e41-8d4d-f673972bd2e0"
classification: "PLANNED_CHANGE"
workKind: "REFACTOR"
complexity: "MEDIUM"
summary: "Run validation repairs in independent Agent sessions with bounded worktree, Plan-link, and feedback context so repair turns do not inherit the large implementation transcript."
affectedPaths:
    - "src/shared/workflow/validation-repair-prompt.ts"
    - "src/shared/workflow/validation-ports.ts"
    - "src/shared/workflow/validation-session-adapter.ts"
    - "src/shared/workflow/validation-mechanical.ts"
    - "src/shared/workflow/validation-semantic.ts"
    - "src/shared/workflow/validation-merge-repair.ts"
    - "src/shared/workflow/workflow-results.js"
    - "src/ui/tui/testing/scenario-runner.js"
    - "docs/workflows.md"
    - "docs/architecture.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-06T20:48:58.000Z"
status: "user_verified"
origin: "internal"
implementedAt: "2026-08-06T20:48:58.000Z"
userVerifiedAt: "2026-08-06T20:48:58.000Z"
userVerificationNote: "User approved. Worked with Codex outside of RunWield to fix it."
workRecord:
    status: "generated"
    recordId: "92b80df9-a161-4378-815f-24ee6cfc77be"
    path: "docs/work-records/2026-08-06-independent-validation-repair-sessions.md"
    lastAttemptAt: "2026-08-06T20:48:58.000Z"
updatedAt: "2026-08-09T04:59:02.883Z"
archivedAt: "2026-08-09T04:59:02.883Z"
archivedFromStatus: "user_verified"
archivedFromPath: "docs/plans/independent-validation-repair-sessions.md"
---

# Independent Validation Repair Sessions

## Context

Engineer validation repairs reused the main implementation session. Each repair inherited the large Plan prompt,
implementation transcript, tool results, and earlier validation output. This made a small repair expensive and caused
the displayed token total to grow quickly through repeated cache reads.

## Objective

Run each CI, Objective Check, semantic-review, and merge repair in an independent Agent session. Give the repair Agent
only the current checkout context, a link to the saved Plan when one exists, the current validation feedback, and an
instruction to verify the repair and call `task_completed` again.

## Approach

- Add one shared bounded repair-prompt builder.
- Replace root-session repair turns with fresh in-memory repair sessions.
- Include the repair checkout, execution worktree identity, target branch, and Plan link in the repair packet.
- Do not inline the full Plan. Do not add a Plan link for QUICK_FIX work.
- Preserve the existing repair limits, validation gates, and completion contract.
- Update tests, architecture documentation, and the Golden TUI harness for independent Engineer identity.

## Verification

- Focused validation suite passes: 45 tests.
- Repaired-merge Golden scenario passes.
- `deno task check` passes for 572 source files.
- `deno task seams:check` preserves the zero-seam baseline.
- Full `deno task ci` passes: 251 test files, 0 failures.
