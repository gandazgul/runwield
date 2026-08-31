---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "docs/domain-language.md"
    - "docs/plan-lifecycle.md"
    - "src/shared/workflow/"
    - "src/shared/work-records/auto-generation.ts"
    - "src/shared/work-records/generation.js"
    - "src/shared/work-records/markdown.js"
    - "src/ui/tui/"
    - "src/testing/"
executionAgent: "engineer"
createdAt: "2026-08-31T02:51:48.009Z"
status: "draft"
origin: "internal"
parentPlan: "forge-change-request-delivery"
order: 10
dependencies:
    - "09-handle-stale-source-heads-and-selected-feedback-repair"
planId: "52466902-ca71-4a49-9377-1741c2440f6c"
targetBranch: "project/forge-change-request-delivery"
---

# Fold selected review feedback into Work Records

## Context

Some review feedback is useful planning memory but does not require code repair. The Epic calls this Review Memory Fold.
The term must enter the glossary only with the behavior that makes it true.

## Objective

Let the user select Forge review feedback and fold it into final Work Record Future Planning Notes without changing
code, Plan lifecycle, validation evidence, or delivery proof.

## Approach

Reuse selected feedback receipts from the repair child, but route them to finalization input for the Recorder instead of
the repair Agent. Treat the text as untrusted source material that the Recorder distills.

```text
selected feedback
  -> Fold into planning memory
  -> pending finalization input
  -> Recorder distills Future Planning Notes
  -> no code or lifecycle change
```

The option set aside is to store raw comments as Work Record authority. That would preserve more text, but it would mix
untrusted review content with durable planning memory.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `docs/domain-language.md` — add Review Memory Fold definition, avoided aliases, and stable relationships.
- `docs/plan-lifecycle.md` — describe feedback folding as additive Work Record input with no lifecycle authority.
- Forge coordinator modules under `src/shared/workflow/` — persist pending fold input and feed finalization.
- `src/shared/work-records/auto-generation.ts`, `generation.js`, and `markdown.js` — include distilled selected feedback
  in Future Planning Notes.
- `src/ui/tui/` — expose the fold action where feedback selection exists.
- `src/testing/` — add folding and Work Record generation tests.

## Reuse Opportunities

- Selected feedback receipt model — reuse exact text-version binding from repair.
- Work Record Recorder and auto-generation — reuse existing authoring and idempotent generation.
- Supersession proposal flow — reuse pending-user-decision discipline if folded feedback suggests future supersession.

## Implementation Steps

- [ ] A user can choose Fold into planning memory for selected Forge feedback without entering repair.
- [ ] Folded feedback is persisted as pending finalization input bound to the exact selected text version.
- [ ] Recorder receives folded feedback as untrusted context and distills it into Work Record Future Planning Notes.
- [ ] Folding changes no code, Plan status, validation evidence, delivery receipt, or lifecycle claim.
- [ ] Work Record generation remains idempotent and does not duplicate folded notes on retry.
- [ ] `docs/domain-language.md` defines Review Memory Fold, avoided aliases, and relationships in the same change.

## Verification Plan

- Automated: run focused Review Memory Fold, Work Record generation, retry, and provider parity tests with
  `deno run -A scripts/run-tests.js <test paths>`.
- Automated: prove folding selected feedback does not call repair, does not modify source files, and does not record
  lifecycle events.
- Automated: prove edited feedback after selection requires reselection before fold.
- Automated: prove Work Record retry does not duplicate folded notes.
- Expected result: selected review knowledge can land in planning memory without pretending it changed delivery truth.
- Confirm the glossary describes implemented Review Memory Fold behavior and no unimplemented proposal.

## Edge Cases & Considerations

- Feedback that invalidates a PRD or ADR assumption should route to that artifact later; a Work Record note cannot
  correct the source document.
- Headless completion should leave any required user decision pending rather than applying memory changes silently.
- Raw provider comments should not become default Agent instructions.
