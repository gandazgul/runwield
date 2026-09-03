---
planId: "39b939be-a544-422f-a765-8d65c632814c"
classification: "PLANNED_CHANGE"
complexity: "MEDIUM"
summary: "Replace the five resident memory tool definitions with one explicit action-based memory tool while preserving scope and provenance."
affectedPaths:
    - "src/extensions/mnemoteca/index.js"
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
status: "verified"
origin: "internal"
implementedAt: "2026-08-16T19:07:03.856Z"
verifiedAt: "2026-08-16T20:09:01.070Z"
userVerifiedAt: null
executionReport: "- Implemented unified memory tools: `memory_recall` now searches project and global scopes with labeled provenance, missing-binary de-duplication, empty result handling, and partial-scope failure notes; `memory_write` now handles store/delete with project default scope, global init, core tags, delete-by-id, validation errors, and preserved store call messages.\n- Updated advertised capabilities and prompts: protected/Claude capability tool lists, session prompt, agent definitions, router golden tool list, and session tool serialization now use `memory_recall`/`memory_write`; read-only agents do not list `memory_write`, and init-agent prose forbids `scope: \"global\"`.\n- Updated historical consumers: TUI/runtime titles support `memory_write` store/delete and still render retired names; metrics classify `memory_write` by action and still classify retired transcript names.\n- Updated docs: `docs/domain-language.md` now defines Memory-Recall Tool and Memory-Write Tool.\n- Tests changed: memory tool tests were rewritten instead of deleted; global search, project store, global init+store, and delete-by-id coverage now live under `memory_recall`/`memory_write`; net `Deno.test` count change is +3.\n- Verification passed: `deno run -A scripts/run-tests.js src/extensions/mnemoteca/`; `deno run -A scripts/run-tests.js src/shared/session/__tests__/session-tools-policy.test.js src/tools/__tests__/delegate-agent.test.js src/shared/workflow/metrics.test.js src/shared/session/backends/claude-cli/`; `deno task ci`.\n- Manual TUI/session checks from the plan were not run interactively; their covered behavior was verified through updated automated tests and runtime title tests."
workRecord:
    status: "generated"
    recordId: "2d976ac0-ab27-40c0-8715-c3c27bbe6e62"
    path: "docs/work-records/2026-08-16-unified-memory-tools.md"
    lastAttemptAt: "2026-08-16T20:09:06.910Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
validationCheckpoint: null
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "a939ad32b97cff397410025745cc80506bb1cae3"
    targetBranch: "main"
    targetHeadBeforeMerge: "af93e86721a3fdee14c4aa5a0b8cbff546e62c0a"
validationCiAttempts: 0
validationObjectiveCheckAttempts: 0
validationSemanticRounds: 1
updatedAt: "2026-08-16T20:28:50.178Z"
archivedAt: "2026-08-16T20:28:50.178Z"
archivedFromStatus: "verified"
archivedFromPath: "docs/plans/unify-memory-tools.md"
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

[Mnemoteca]: https://github.com/gandazgul/mnemoteca
