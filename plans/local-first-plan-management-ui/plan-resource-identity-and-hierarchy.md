---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add durable planId identity, planId lookup/backfill, body-safe Plan metadata seams, and shared Epic/child/orphan grouping helpers so CLI and Workspace views use the same Plan model."
affectedPaths:
    - "src/plan-store.js"
    - "src/plan-store.test.js"
    - "src/cmd/plans/index.js"
    - "src/cmd/plans/index.test.js"
createdAt: "2026-06-24T20:14:08.681Z"
updatedAt: "2026-06-24T20:14:08.681Z"
status: "draft"
origin: "internal"
parentPlan: "local-first-plan-management-ui"
dependencies:
    []
---

# Plan Resource Identity and Hierarchy

## Context

The Workspace needs stable project-scoped Plan URLs that survive title/path changes, but the current Plan store treats
the markdown filename as identity. The current `wld plans` command also owns private Epic/child/orphan grouping
semantics that the browser API must not reimplement differently.

## Objective

Add durable `planId` front matter support, idempotent identity backfill, duplicate detection, lookup by `planId`, and
shared Plan hierarchy helpers. Preserve existing filename-based CLI workflows while exposing a resource model the
Workspace can use safely.

## Approach

Extend `src/plan-store.js` as the canonical Plan model boundary. Add `planId` to front matter formatting/parsing,
generate missing IDs with `crypto.randomUUID()`, and build an index that fails loudly on duplicate IDs before returning
ambiguous results. Extract the current Epic/child/standalone/orphan grouping behavior from `src/cmd/plans/index.js` into
reusable Plan-store helpers, then update the CLI to consume those helpers without changing its default output semantics.

## Files to Modify

- `src/plan-store.js` — add `planId` front matter support, identity backfill, duplicate detection, lookup by `planId`,
  and shared hierarchy/progress helpers.
- `src/plan-store.test.js` — cover identity creation, preservation, duplicate handling, lookup, archived-plan hiding,
  and hierarchy grouping.
- `src/cmd/plans/index.js` — replace private grouping helpers with Plan-store shared helpers while preserving existing
  terminal behavior.
- `src/cmd/plans/index.test.js` — assert default listing compatibility and Epic/child/orphan output after helper
  extraction.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.js` — reuse `loadPlan`, `listPlans`, `updatePlanFrontMatter`, recursive plan collection, front matter
  parsing/injection, and archived-plan hiding.
- `src/cmd/plans/index.js` — preserve current `isChildFeaturePlan`, `groupPlans`, and child progress semantics as the
  behavior contract for the shared helpers.
- `src/shared/workflow/plan-lifecycle.js` — reuse `isEpicPlan` rather than duplicating Epic detection rules.

## Implementation Steps

- [ ] Step 1: Add `planId` to the `PlanFrontMatter` JSDoc, known-key set, front matter formatter, and parser
      normalization paths.
- [ ] Step 2: Implement an idempotent `ensurePlanIdentity(cwd, planName)` helper that loads one Plan, preserves an
      existing `planId`, generates one when missing, and rewrites only front matter when needed.
- [ ] Step 3: Implement a Plan identity index helper that lists non-archived Plans, optionally backfills missing IDs,
      detects duplicate `planId` values, and returns plan name/path/front matter metadata.
- [ ] Step 4: Add `findPlanById(cwd, planId)` or equivalent lookup that resolves to canonical `planName`,
      project-relative path, absolute path, front matter, and body metadata.
- [ ] Step 5: Extract shared hierarchy helpers for Epics, child FEATURE Plans, standalone Plans, orphaned children, and
      child progress counts into `src/plan-store.js` or a small shared module imported by both Plan store and CLI.
- [ ] Step 6: Update `src/cmd/plans/index.js` to use the shared hierarchy helpers and keep visible output compatible
      with current tests.
- [ ] Step 7: Add focused tests for missing-ID backfill, existing-ID preservation, duplicate-ID repair errors, lookup by
      ID, nested child Plans, hidden `plans/archived`, and CLI grouping compatibility.

## Verification Plan

- Automated: run `deno task ci`.
- Manual: create Plans with and without `planId`, run the new identity/index helpers through tests or a small local
  script, and verify markdown bodies are unchanged after backfill.
- Expected results for key scenarios: Plan URLs can resolve by stable `planId`; duplicate IDs fail loudly with a
  repair-oriented error; `wld plans` still lists Epics, child FEATUREs, standalone Plans, and orphaned children as
  before.

## Edge Cases & Considerations

- Existing Plans without `planId` must be backfilled once without changing body markdown.
- Existing duplicate IDs must not be silently rewritten because that would break user-owned links and hide data
  corruption.
- Filename/name remains valid for current CLI workflows; `planId` is an additional resource identity, not a replacement
  for all Plan references.
- Shared grouping must keep PROJECT Epic detection as `classification: PROJECT` plus `type: epic`.
- All implementation source must remain JavaScript/JSDoc only; do not add TypeScript files or syntax.
