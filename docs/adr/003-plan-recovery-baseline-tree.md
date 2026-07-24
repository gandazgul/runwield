---
status: accepted
---

# ADR-003: Plan Recovery Uses Execution Baseline Trees

## Decision

When a Plan enters execution, RunWield captures a baseline git tree for the current worktree and uses that tree as the
reset target during Plan Recovery. Resetting an In-Progress Plan should restore the worktree to the exact pre-execution
snapshot, preserving changes that existed before execution began and discarding changes made afterward, including
unrelated user edits. This is a deliberate recovery trade-off until RunWield supports isolated execution trees.
