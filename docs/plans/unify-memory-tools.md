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
objectiveCheckWaivers:
    []
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-08T01:08:52-04:00"
origin: "internal"
implementedAt: "2026-08-16T19:07:03.856Z"
userVerifiedAt: null
executionMode: "worktree"
executionBaselineTree: "b97fe13b38b116b60ade98fc43e76b9d421c6eb0"
worktreeId: "b96f7113"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-unify-memory-tools-b96f7113"
worktreeBranch: "worktree/unify-memory-tools-b96f7113"
worktreeBaseBranch: "main"
worktreeStatus: "completed"
validationCiAttempts: 0
validationObjectiveCheckAttempts: 0
executionReport: "- Implemented unified memory tools: `memory_recall` now searches project and global scopes with labeled provenance, missing-binary de-duplication, empty result handling, and partial-scope failure notes; `memory_write` now handles store/delete with project default scope, global init, core tags, delete-by-id, validation errors, and preserved store call messages.\n- Updated advertised capabilities and prompts: protected/Claude capability tool lists, session prompt, agent definitions, router golden tool list, and session tool serialization now use `memory_recall`/`memory_write`; read-only agents do not list `memory_write`, and init-agent prose forbids `scope: \"global\"`.\n- Updated historical consumers: TUI/runtime titles support `memory_write` store/delete and still render retired names; metrics classify `memory_write` by action and still classify retired transcript names.\n- Updated docs: `docs/domain-language.md` now defines Memory-Recall Tool and Memory-Write Tool.\n- Tests changed: memory tool tests were rewritten instead of deleted; global search, project store, global init+store, and delete-by-id coverage now live under `memory_recall`/`memory_write`; net `Deno.test` count change is +3.\n- Verification passed: `deno run -A scripts/run-tests.js src/extensions/mnemosyne/`; `deno run -A scripts/run-tests.js src/shared/session/__tests__/session-tools-policy.test.js src/tools/__tests__/delegate-agent.test.js src/shared/workflow/metrics.test.js src/shared/session/backends/claude-cli/`; `deno task ci`.\n- Manual TUI/session checks from the plan were not run interactively; their covered behavior was verified through updated automated tests and runtime title tests."
validationSemanticRounds: 1
status: "validated_reviewer"
validationCheckpoint: null
updatedAt: "2026-08-16T20:09:00.310Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
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
