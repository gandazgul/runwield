---
planId: "39b939be-a544-422f-a765-8d65c632814c"
classification: "PLANNED_CHANGE"
complexity: "MEDIUM"
summary: "Replace the five resident memory tool definitions with one explicit action-based memory tool while preserving scope and provenance."
affectedPaths:
    - "src/extensions/mnemosyne/index.js"
    - "src/tools/registry.js"
    - "src/shared/session/SYSTEM_PROMPT_TEMPLATE.md"
    - "src/shared/session/tool-event-title.js"
    - "src/shared/workflow/metrics.js"
    - "src/agent-definitions/"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-08T01:08:52-04:00"
origin: "internal"
updatedAt: "2026-08-16T18:56:06.149Z"
status: "ready_for_work"
userVerifiedAt: null
---

# Unify Memory Tools

## Context

RunWield advertises separate project/global recall and store tools plus delete. The existing accepted recall contract
requires one recall operation to search project and global memories, label provenance, and prefer project decisions.

## Direction

- Expose one memory tool with explicit recall, store, and delete actions.
- Unified recall searches project and global scopes together and returns labeled provenance.
- Store keeps project scope as the safe default and requires an explicit choice for global storage.
- Delete identifies its target scope safely and cannot remove an ambiguous memory.
- Preserve worktree-to-primary project collection resolution, core tagging, privacy, metrics, and UI titles.
- Prove that the unified schema reduces resident tool context before adopting it.

## Questions for Planner

- Should scope be required for every mutation or only global mutations?
- Does delete require scope, a globally unique memory ID, or a prior recall token?
- Are old tool names removed as a pre-1.0 break or translated temporarily outside model context?
- Is one discriminated schema actually smaller and clearer than a smaller recall tool plus a mutation tool?

## Later Planning Work

Measure the current and proposed provider schemas, settle mutation scope and compatibility, enumerate every Agent and
backend integration, and define behavioral parity tests before changing the public tool contract.
