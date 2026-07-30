---
kind: "work_record"
recordId: "d5e515b2-6f8c-4a8d-8b4f-08a7d27c0bd9"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-29T15:29:54.561Z"
provenance:
    sourcePlans:
        - "6c43c06a-1c9b-4f11-8d92-61679b424caf"
---

# RunWield entity model documentation added

## Summary

Added `docs/entity-model.md` as a source-grounded companion to `architecture.md`, with bounded Mermaid ER diagrams,
identity/ownership/lifecycle notes, and a persistence/authority table. Updated `architecture.md` with links to the
entity model and refreshed current workflow terminology from legacy `FEATURE` wording to `PLANNED_CHANGE` where
appropriate. Formatting verification passed with `deno fmt --check architecture.md docs/entity-model.md`; broader code
checks were not run because the change was documentation-only.

## Future Planning Notes

For future architecture docs, keep entity relationships separate from control-flow/dependency diagrams and explicitly
distinguish durable sources of truth from projections, caches, transient workflow objects, and externally owned
lifecycle state.

## Execution Report

- Created `docs/entity-model.md` with four small Mermaid ER diagrams plus identity/ownership/lifecycle/source-of-truth
  notes and a persistence/authority table.
- Updated `architecture.md` with prominent and targeted links to the entity model, and replaced current-workflow
  `FEATURE` wording with `PLANNED_CHANGE` while preserving only explicit legacy/Work Kind references.
- Verified formatting with `deno fmt --check architecture.md docs/entity-model.md` (passed).
- Manually checked Mermaid fence completeness, link target presence, canonical terminology, legacy `FEATURE` usage, and
  source-of-truth caveats; `deno task check` was not run because only Markdown docs were changed.
