---
planId: "0eaac4ba-cad8-41c2-83be-60f7ef1fbd52"
classification: "PLANNED_CHANGE"
workKind: "REFACTOR"
complexity: "MEDIUM"
affectedPaths:
    - "src/agent-definitions/engineer.md"
    - "src/agent-definitions/plan-engineer.md"
    - "src/agent-definitions/frontend-engineer.md"
    - "src/agent-definitions/subagent-definitions/reviewer-feedback-engineer.md"
    - "src/shared/session/agents.js"
    - "src/shared/session/types.js"
    - "src/shared/session/agent-contracts.test.ts"
    - "src/ui/tui/golden-scenarios/session-resume-workflow.ts"
    - "src/ui/tui/golden-scenarios/session-resume-workflow.test.ts"
    - "src/ui/tui/golden-scenarios/planned-change-workflow.js"
    - "src/ui/tui/golden-scenarios/planned-change-workflow.test.js"
objectiveChecks:
    - id: "OC1"
      command: "deno eval 'import { loadAgentDef } from \"./src/shared/session/agents.js\"; const expected={engineer:\"quick-fix\",\"plan-engineer\":\"plan-execution\",\"frontend-engineer\":\"frontend-plan-execution\",\"reviewer-feedback-engineer\":\"validation-repair\"}; for (const [name,contract] of Object.entries(expected)) { const def=await loadAgentDef(name); if(def.contextContract!==contract) throw new Error(`${name} did not expose ${contract}`); }'"
      rationale: "The current loader does not expose contextContract, so this fails until all four declarations are parsed and returned as Agent metadata."
    - id: "OC2"
      command: "grep -q 'declared context contracts and prompt boundaries' src/shared/session/agent-contracts.test.ts && grep -q 'contextContract' src/shared/session/agent-contracts.test.ts && deno run -A scripts/run-tests.js src/shared/session/agent-contracts.test.ts --filter 'declared context contracts and prompt boundaries'"
      rationale: "The baseline has no named contract-matrix test. The check requires a focused test that executes against real loaded definitions and contract metadata."
    - id: "OC3"
      command: "grep -q 'execution Agent context identity survives recovery' src/ui/tui/golden-scenarios/session-resume-workflow.test.ts && grep -q 'systemPrompt' src/ui/tui/golden-scenarios/session-resume-workflow.test.ts && grep -q 'runtime:agent:' src/ui/tui/golden-scenarios/session-resume-workflow.test.ts && deno run -A scripts/run-tests.js src/ui/tui/golden-scenarios/session-resume-workflow.test.ts --filter 'execution Agent context identity survives recovery'"
      rationale: "The baseline has no recovery identity scenario. The check requires a focused golden test with runtime/system-prompt evidence, not only a new Agent definition."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-19T22:32:06-04:00"
status: "validated"
origin: "internal"
userVerifiedAt: null
workRecord:
    status: "generated"
    recordId: "1a30facb-3349-43a9-94e8-5936e4d13bdb"
    path: "docs/work-records/2026-08-22-execution-agent-context-contracts-hardened.md"
    lastAttemptAt: "2026-08-22T23:51:13.485Z"
validationObjectiveCheckAttempts: 0
archivedAt: "2026-08-28T15:10:13.868Z"
archivedFromStatus: "validated"
archivedFromPath: "docs/plans/execution-agent-context-boundaries.md"
---

# Harden Execution-Agent Context Boundaries

## Context

The earlier `mode-specific-engineer-context` draft proposed rebuilding one Engineer prompt from a shared kernel plus
Plan, QUICK_FIX, and validation-repair fragments. The completed Engineer split made that architecture unnecessary:
selectable Engineer now owns QUICK_FIX work, Plan Engineer owns approved Planned Change execution, Frontend Engineer
owns browser-heavy Planned Change execution, and Validation Repair Engineer receives a focused repair prompt.

The useful remaining concern is not recombining those prompts. It is proving that each execution Agent keeps the correct
context after launch, resume, provider switch, compaction, transcript-segment rollover, and validation repair.

Current static measurements are a baseline, not a full per-turn cost model. Approximate prompt sizes are:

- Engineer: 13,530 characters, approximately 3,383 tokens.
- Plan Engineer: 18,172 characters, approximately 4,543 tokens.
- Frontend Engineer: 18,164 characters, approximately 4,541 tokens.
- Validation Repair Engineer plus a representative repair packet: approximately 3,091 tokens.

Known shared-practice duplication has already been removed. This Plan does not pursue another prompt split unless a new
measurement proves that the saving justifies added runtime complexity.

## Objective

Make execution-Agent context boundaries explicit and regression-tested.

The change will:

- add a machine-readable `contextContract` declaration to each execution Agent;
- expose that declaration through the loaded Agent definition without using it as runtime authority;
- replace scattered prompt assumptions with one data-driven static contract matrix;
- extend golden TUI coverage to prove the actual Agent/system-prompt identity survives recovery paths; and
- preserve the existing Agent split, shared-practice composition, runtime resolver, and user-visible Agent behavior.

Success means a future prompt edit can fail a focused test when it adds Quick Fix rules to Plan execution, removes
browser evidence rules from Frontend Engineer, or resumes a workflow with the wrong Agent context.

## Approach

Use frontmatter for the contract identifier and tests for the detailed assertions.

```text
Agent definition frontmatter
        |
        v
loadAgentDef -> AgentDefinition.contextContract
        |
        +--> static contract matrix: required / forbidden context
        |
        +--> runtime golden scenarios: launch / resume / recovery identity
```

`description` remains human-facing discovery text. It is not a contract. The new identifier is metadata for validation,
diagnostics, and future measurement; it must not select or authorize an Agent. Existing policy-to-runtime resolution and
durable workflow fields remain the sources of truth for runtime identity.

The matrix will cover these contracts:

| Agent                      | Contract                  | Required behavior                                              | Forbidden behavior                                           |
| -------------------------- | ------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------ |
| Engineer                   | `quick-fix`               | bounded QUICK_FIX process and Quick Fix Checklist              | approved Plan execution and validation-continuation ceremony |
| Plan Engineer              | `plan-execution`          | Plan scope, completion, validation continuation, Pair behavior | QUICK_FIX and Quick Fix Checklist                            |
| Frontend Engineer          | `frontend-plan-execution` | Plan execution plus headed-browser and browser-evidence rules  | QUICK_FIX and Quick Fix Checklist                            |
| Validation Repair Engineer | `validation-repair`       | bounded repair-packet process                                  | general Plan and Quick Fix process                           |

The main option set aside is dynamic prompt composition by dispatch kind. The Agent split already provides clearer
separation; recomposing the prompts would add lifecycle and recovery state without a demonstrated product benefit.

## Files to Modify

- `src/agent-definitions/engineer.md` — declare the `quick-fix` context contract.
- `src/agent-definitions/plan-engineer.md` — declare the `plan-execution` context contract.
- `src/agent-definitions/frontend-engineer.md` — declare the `frontend-plan-execution` context contract.
- `src/agent-definitions/subagent-definitions/reviewer-feedback-engineer.md` — declare the `validation-repair` context
  contract.
- `src/shared/session/agents.js` — read and return the contract identifier as Agent metadata while preserving existing
  prompt composition and workflow-only behavior.
- `src/shared/session/types.js` — describe the optional or required contract field using the repository's existing
  AgentDefinition type conventions.
- `src/shared/session/agent-contracts.test.ts` — replace hardcoded prompt-shape assumptions with a table-driven matrix
  that checks declarations, shared practices, required language, forbidden cross-contract language, and discoverability.
- `src/ui/tui/golden-scenarios/session-resume-workflow.ts` — add or extend real resume scenarios that retain the
  expected Plan or Quick Fix execution identity.
- `src/ui/tui/golden-scenarios/session-resume-workflow.test.ts` — assert the resumed runtime Agent and loaded prompt
  identity, not only footer or display projections.
- `src/ui/tui/golden-scenarios/planned-change-workflow.js` — extend the production-shaped Plan workflow fixture for
  provider-switch, compaction, or segment-continuation identity evidence where the existing fixture supports it.
- `src/ui/tui/golden-scenarios/planned-change-workflow.test.js` — protect Plan Engineer and Frontend Engineer identity
  through the applicable golden workflow paths.

No domain-language update is required: `contextContract` is internal Agent metadata, not a user-facing domain term. The
existing Agent, Plan Engineer, Frontend Engineer, QUICK_FIX, and Validation Repair Engineer terminology remains
canonical.

## Reuse Opportunities

Existing functions, modules, and tests to reuse:

- `loadAgentDef` in `src/shared/session/agents.js` — preserve the current frontmatter merge and shared-practice
  composition path.
- `resolvePlanExecutionRuntimeAgent` and `resolveActiveWorkflowRuntimeAgent` in `src/shared/workflow/execution-agent.ts`
  — keep runtime identity resolution authoritative; do not replace it with `contextContract`.
- `src/shared/session/agent-contracts.test.ts` — retain its current coverage while making the assertions data-driven.
- `src/ui/tui/golden-scenarios/session-resume-workflow.ts` — use the existing persisted-session and continuation
  fixture.
- Existing Plan execution and validation-repair golden scenarios — extend them instead of creating a parallel fake
  session harness.

## Implementation Steps

- [ ] Each execution Agent definition declares exactly one stable `contextContract`: `quick-fix`, `plan-execution`,
      `frontend-plan-execution`, or `validation-repair`; the declarations do not change Agent selectability or workflow
      authorization.
- [ ] `loadAgentDef` returns the declared contract in `AgentDefinition`, while project and home Agent layering follows
      the existing frontmatter merge rules and missing or invalid contract values cannot silently become a valid runtime
      identity.
- [ ] `agent-contracts.test.ts` contains a real `declared context contracts and prompt boundaries` table-driven test
      against the loaded definitions and fails when a contract loses required behavior, gains forbidden cross-contract
      behavior, declares the wrong shared practices, or disagrees with workflow-only/discoverability rules.
- [ ] Golden TUI coverage contains a real `execution Agent context identity survives recovery` scenario proving that
      Quick Fix launches with Engineer, Plan execution resolves to Plan Engineer or Frontend Engineer according to
      policy, and the actual next-turn Agent/system-prompt identity remains correct after session resume, provider
      switch, compaction, and execution-segment continuation where each path is supported by the existing fixture.
- [ ] Validation repair remains focused on Validation Repair Engineer context and does not inherit general Plan Engineer
      or Quick Fix instructions; its repair-packet behavior remains covered by the existing validation prompt tests.
- [ ] The implementation records the measured static prompt baseline in test or developer-facing output without claiming
      that it represents full per-turn cost; no new prompt-composition layer is added solely to reduce the measured
      character counts.

## Approval Confirmation

No prior Work Record is listed as superseded. The completed Engineer split is a dependency and evidence source, not a
record this narrower Plan replaces.

## Verification Plan

- Automated: `deno run -A scripts/run-tests.js src/shared/session/agent-contracts.test.ts`.
- Automated: run the focused golden TUI suites covering planned-change execution and session resume, including the new
  context-identity scenarios.
- Automated: run the existing validation prompt and validation-repair workflow suites to prove the focused repair
  context remains intact.
- Automated: run `deno task ci`, including type checking, language-policy checks, documentation checks, and
  `deno task seams:check`.
- Manual: inspect one Quick Fix launch, one ordinary Plan execution, one Frontend Plan execution, and one resumed Plan
  execution. Confirm that the displayed Agent and the actual model-turn Agent agree, and that no unrelated mode ceremony
  appears in the prompt contract evidence.
- Expected result: a provider switch, compaction, or resume never changes a Plan workflow into selectable Engineer Quick
  Fix context; validation repair remains bounded and does not regain the full implementation transcript.
- Existing behavior that must remain protected: Agent discoverability, workflow-only filtering, policy-to-runtime Agent
  resolution, Pair behavior, browser preflight/evidence, validation repair completion, and user-owned Agent switching.
- Behavior that must not return: one combined Engineer prompt containing both the Plan execution and QUICK_FIX
  contracts.

## Edge Cases & Considerations

- **Project overrides:** a project or home Agent override may alter prompt content, but the merged `contextContract`
  must remain valid or fail clearly; an override must not silently relabel runtime ownership.
- **Runtime authority:** `contextContract` is descriptive metadata. Plan Front Matter, active workflow policy, runtime
  Agent resolution, and focused repair dispatch remain authoritative.
- **Legacy sessions:** historical transcripts may contain old Engineer names. Resume must use the current persisted
  workflow policy and runtime resolver without rewriting historical transcript content.
- **Frontend parity:** Plan Engineer and Frontend Engineer may share most Plan execution practice. Similar prompt size
  is acceptable when the shared contract is intentional; split only behavior that is proven unrelated or redundant.
- **Golden projections:** footer labels and snapshots are useful evidence but are not sufficient alone. Tests must
  inspect the runtime Agent or loaded system prompt used for the next turn.
- **Baseline limitation:** static character and rough token counts exclude tools, Skills, memories, project context, and
  request packets. Treat them as comparison data, not as a complete cost claim.
