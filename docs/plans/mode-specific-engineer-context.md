---
planId: "35cf472d-05f6-4b4d-ad42-fa2270351488"
classification: "PLANNED_CHANGE"
complexity: "MEDIUM"
summary: "Build Engineer context from a shared kernel plus the instructions for the active Plan, QUICK_FIX, or validation-repair mode."
affectedPaths:
    - "src/agent-definitions/engineer.md"
    - "src/agent-definitions/shared-practice/"
    - "src/shared/session/session.js"
    - "src/shared/session/agent-switching.js"
    - "src/shared/session/request-dispatch.ts"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-08T01:08:52-04:00"
updatedAt: "2026-08-08T01:08:52-04:00"
status: "draft"
origin: "internal"
---

This plan needs to be rewritten after executing split-quick-fix-engineer-from-plan-engineer.md, do not execute this plan
without first executing that one and then rewriting this one with any left over ideas that are still necesary.

# Mode-Specific Engineer Context

## Context

Engineer currently receives instructions for Plan execution, QUICK_FIX, and validation repair together. Plan 2 now
provides a stable dispatch kind, so unrelated mode instructions do not need to remain resident.

## Direction

- Keep one shared Engineer kernel for user authority, repository practice, verification, escalation, and completion.
- Add explicit Plan execution, QUICK_FIX, and validation-repair instruction fragments.
- Select the fragment mechanically from the dispatch kind before the execution session is built.
- Preserve the selected variant across rebuild, provider switch, compaction, and continuation.
- Test the instruction matrix so token savings cannot remove mandatory behavior.

## Questions for Planner

- Which current rules belong in the shared kernel, and which are truly mode-specific?
- Does Frontend Engineer share the same variants or need its own projected fragments?
- How should an interactive continuation recover the original dispatch kind after restart?
- What minimum token reduction justifies the added prompt-composition machinery?

## Later Planning Work

Measure each current section, define the fragment contract and reconstruction source, specify invariant tests for every
mode/backend, and set a before/after resident-context target.
