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
updatedAt: "2026-08-16T19:35:00.159Z"
status: "implemented"
origin: "internal"
failureReason: "- The change exposes two memory tools instead of one action-based tool for recall, store, and delete.\n  Plan: Plan Direction: “Expose one memory tool with explicit recall, store, and delete actions.” The objective summary also requires replacing the five resident memory tool definitions with one explicit action-based memory tool.\n  Evidence: src/extensions/mnemosyne/tools.ts defines `memoryRecallToolDef` with only `{ query }` and `memoryWriteToolDef` with `action: \"store\" | \"delete\"`, and `createMnemosyneTools()` returns both `memory_recall` and `memory_write`. src/tools/registry.js also advertises both names.\n- Delete ignores scope and can delete an ambiguous memory ID.\n  Plan: Plan Direction: “Delete identifies its target scope safely and cannot remove an ambiguous memory.”\n  Evidence: src/extensions/mnemosyne/tools.ts `memoryWriteToolDef` marks `scope` as “Not used for delete”, and the delete branch runs `mnemosyne([\"delete\", String(typed.id)])` only. src/extensions/mnemosyne/tools.test.ts adds `memory_write deletes by id without a scope flag`, which passes `scope: \"global\"` but expects only `[\"delete\", \"42\"]`."
implementedAt: "2026-08-16T19:07:03.856Z"
userVerifiedAt: null
executionReport: "- Implemented unified memory tools: `memory_recall` now searches project and global scopes with labeled provenance, missing-binary de-duplication, empty result handling, and partial-scope failure notes; `memory_write` now handles store/delete with project default scope, global init, core tags, delete-by-id, validation errors, and preserved store call messages.\n- Updated advertised capabilities and prompts: protected/Claude capability tool lists, session prompt, agent definitions, router golden tool list, and session tool serialization now use `memory_recall`/`memory_write`; read-only agents do not list `memory_write`, and init-agent prose forbids `scope: \"global\"`.\n- Updated historical consumers: TUI/runtime titles support `memory_write` store/delete and still render retired names; metrics classify `memory_write` by action and still classify retired transcript names.\n- Updated docs: `docs/domain-language.md` now defines Memory-Recall Tool and Memory-Write Tool.\n- Tests changed: memory tool tests were rewritten instead of deleted; global search, project store, global init+store, and delete-by-id coverage now live under `memory_recall`/`memory_write`; net `Deno.test` count change is +3.\n- Verification passed: `deno run -A scripts/run-tests.js src/extensions/mnemosyne/`; `deno run -A scripts/run-tests.js src/shared/session/__tests__/session-tools-policy.test.js src/tools/__tests__/delegate-agent.test.js src/shared/workflow/metrics.test.js src/shared/session/backends/claude-cli/`; `deno task ci`.\n- Manual TUI/session checks from the plan were not run interactively; their covered behavior was verified through updated automated tests and runtime title tests."
humanReviewMode: null
humanReviewDecision: null
validationCheckpoint:
    version: 1
    attemptId: "b96f7113"
    generation: "2c738207-5f27-4c1b-929f-23a41fd03a4e"
    expectedStatus: "implemented"
    nextPhase: "mechanical"
    state: "awaiting_repair"
    repairKind: "semantic"
    repairGeneration: "675916d7-35eb-43d2-b972-761915dab70a"
    reviewState:
        semanticRound: 1
        reviewLedger:
            items:
                - id: "R1-1"
                  openedInRound: 1
                  resolvedInRound: null
                  title: "The change exposes two memory tools instead of one action-based tool for recall, store, and delete."
                  requirement: "Plan Direction: “Expose one memory tool with explicit recall, store, and delete actions.” The objective summary also requires replacing the five resident memory tool definitions with one explicit action-based memory tool."
                  evidence: "src/extensions/mnemosyne/tools.ts defines `memoryRecallToolDef` with only `{ query }` and `memoryWriteToolDef` with `action: \"store\" | \"delete\"`, and `createMnemosyneTools()` returns both `memory_recall` and `memory_write`. src/tools/registry.js also advertises both names."
                - id: "R1-2"
                  openedInRound: 1
                  resolvedInRound: null
                  title: "Delete ignores scope and can delete an ambiguous memory ID."
                  requirement: "Plan Direction: “Delete identifies its target scope safely and cannot remove an ambiguous memory.”"
                  evidence: "src/extensions/mnemosyne/tools.ts `memoryWriteToolDef` marks `scope` as “Not used for delete”, and the delete branch runs `mnemosyne([\"delete\", String(typed.id)])` only. src/extensions/mnemosyne/tools.test.ts adds `memory_write deletes by id without a scope flag`, which passes `scope: \"global\"` but expects only `[\"delete\", \"42\"]`."
            sequence: 2
        repairBaselineTree: "eaa72c72453681e16c1f8ddfabd866c14d738bfb"
    updatedAt: "2026-08-16T19:35:00.148Z"
executionMode: "worktree"
executionBaselineTree: "b97fe13b38b116b60ade98fc43e76b9d421c6eb0"
worktreeId: "b96f7113"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-unify-memory-tools-b96f7113"
worktreeBranch: "worktree/unify-memory-tools-b96f7113"
worktreeBaseBranch: "main"
worktreeStatus: "completed"
validationCiAttempts: 0
validationObjectiveCheckAttempts: 0
validationSemanticRounds: 1
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
