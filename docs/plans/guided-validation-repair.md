---

planId: "7dda74a4-02f8-4c21-8292-e17c3dfab037" classification: "PLANNED_CHANGE" workKind: "FEATURE" complexity: "HIGH"
summary: "Let users enter a durable Guided Repair conversation with a Plan's execution Agent in its existing worktree
from Workflow Validation or load-plan, then resume validation without creating a second worktree or conflating the flow
with Pair Execution." affectedPaths:

- "src/cmd/load-plan/plan-recovery-flow.ts"
- "src/cmd/load-plan/plan-recovery-actions.ts"
- "src/cmd/load-plan/plan-recovery-worktree.ts"
- "src/cmd/load-plan/plan-session-types.ts"
- "src/cmd/load-plan/plan-session-surface.ts"
- "src/cmd/load-plan/plan-recovery-flow.test.ts"
- "src/cmd/load-plan/index.integration.test.ts"
- "src/cmd/load-plan/guided-repair.integration.test.ts"
- "src/shared/types.js"
- "src/shared/session/hosted-session.js"
- "src/shared/session/agent-handler.ts"
- "src/shared/session/session-runtime.js"
- "src/shared/session/guided-repair-session.ts"
- "src/shared/session/guided-repair-session.test.ts"
- "src/shared/workflow/validation-checkpoint.ts"
- "src/shared/workflow/validation-ports.ts"
- "src/shared/workflow/validation-types.ts"
- "src/shared/workflow/validation-session-adapter.ts"
- "src/shared/workflow/validation-interactions.ts"
- "src/shared/workflow/validation-mechanical.ts"
- "src/shared/workflow/validation-semantic.ts"
- "src/shared/workflow/validation-supervisor.ts"
- "src/shared/workflow/validation-repair-prompt.ts" ... more files changed
