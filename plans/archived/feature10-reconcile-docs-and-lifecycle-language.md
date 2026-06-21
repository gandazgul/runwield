---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Update Harns docs and domain language so PROJECT, Epic, Slicer, Ready For Work, and child FEATURE behavior match the new workflow."
affectedPaths:
    - "CONTEXT.md"
    - "docs/plan-lifecycle.md"
    - "docs/prd/done/project-decomposition-PRD.md"
    - "PRD.md"
    - "README.md"
createdAt: "2026-06-16T16:25:04Z"
updatedAt: "2026-06-18T15:04:39.837Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-06-18T15:04:39.837Z"
---

# Reconcile Docs and Lifecycle Language

## Context

This is an `AFK` slice, but it should happen after the behavior exists so the docs describe reality instead of
aspiration.

The existing domain docs define `PROJECT` as large architectural or multi-role work that becomes a task graph. The new
product model says `PROJECT` is an Epic container that gets decomposed into child FEATURE plans. The docs need to make
that distinction obvious without confusing the existing lifecycle language around `ready_for_work` and executable plans.

## Objective

Update project documentation so future agents and users understand the new Epic decomposition workflow and do not revive
the old all-at-once PROJECT DAG model by mistake.

## Approach

Edit the domain glossary and lifecycle docs after implementation stabilizes. Keep the language product-facing in the
PRD, domain-facing in `CONTEXT.md`, and operational in `docs/plan-lifecycle.md`.

## Files to Modify

- `CONTEXT.md` - update terminology for PROJECT, Epic, Slicer, child FEATURE plans, and Task/DAG legacy wording.
- `docs/plan-lifecycle.md` - document Epic lifecycle behavior and how it differs from executable FEATURE lifecycle.
- `docs/prd/done/project-decomposition-PRD.md` - reconcile v1 scope with implementation decisions, especially deferred
  work.
- `PRD.md` - update top-level product description if it still describes PROJECT task slicing as the active path.
- `README.md` - update user-facing command descriptions only if current README behavior changes.

## Reuse Opportunities

- `docs/prd/done/project-decomposition-PRD.md` - use it as the source product vision.
- `CONTEXT.md` - preserve existing glossary style and "avoid" language.
- `docs/plan-lifecycle.md` - preserve the event/status table style.

## Implementation Steps

- [ ] Read the completed code behavior from the preceding slices.
- [ ] Update `CONTEXT.md` so PROJECT means Epic-scale work decomposed into FEATURE plans.
- [ ] Clarify whether "Epic" is accepted domain language or an implementation subtype of PROJECT.
- [ ] Update `docs/plan-lifecycle.md` so `ready_for_work` does not imply direct Epic execution.
- [ ] Remove or clearly mark old task-DAG execution as legacy/future.
- [ ] Reconcile `on_hold` language so v1 docs do not claim an unimplemented status exists.
- [ ] Update README and top-level PRD language where user-facing behavior changed.

## Verification Plan

- Automated: `deno fmt CONTEXT.md docs/plan-lifecycle.md docs/prd/done/project-decomposition-PRD.md PRD.md README.md`
- Automated: `deno run ci`
- Manual: read the updated glossary and lifecycle docs as a fresh agent and verify the intended flow is unambiguous.
- Expected result: docs consistently describe PROJECT as a decomposition workflow, not an executable task DAG.

## Edge Cases & Considerations

- Do not over-document future features such as general `on_hold`, stale child detection, or visual boards as if they
  exist.
- Preserve historical ADRs unless a new ADR is warranted by implementation decisions.
- Keep terms aligned with existing Harns glossary style.
