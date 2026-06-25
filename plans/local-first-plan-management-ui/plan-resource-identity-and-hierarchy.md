---
planId: "03cb86ea-7c25-4b61-b539-757437c25dfd"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add durable planId identity, planId lookup/backfill, body-safe Plan metadata seams, and shared Epic/child/orphan grouping helpers so CLI and Workspace views use the same Plan model."
affectedPaths:
    - "src/plan-store.js"
    - "src/plan-store.test.js"
    - "src/cmd/plans/index.js"
    - "src/cmd/plans/index.test.js"
createdAt: "2026-06-24T20:14:08.681Z"
updatedAt: "2026-06-25T01:37:31.570Z"
status: "verified"
origin: "internal"
parentPlan: "local-first-plan-management-ui"
dependencies:
    []
verifiedAt: "2026-06-25T01:37:31.570Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
---

# Plan Resource Identity and Hierarchy

## Context

The Workspace needs stable project-scoped Plan URLs that survive title/path changes, but the current Plan store treats
the markdown filename as identity. The current `wld plans` command also owns private Epic/child/orphan grouping
semantics that the browser API must not reimplement differently.

This slice is the data-model prerequisite for the read-only Workspace board. It should not build UI routes or
body-editing saves; it should make Plan resources addressable by a durable ID and make hierarchy semantics reusable
without changing existing CLI behavior.

## Objective

Add durable `planId` front matter support, idempotent identity backfill, duplicate detection, lookup by `planId`, and
shared Plan hierarchy helpers. Preserve filename-based CLI workflows while exposing a resource model the Workspace can
use safely.

## Approach

Extend `src/plan-store.js` as the canonical Plan model boundary. Add `planId` to front matter formatting/parsing,
generate missing IDs with `crypto.randomUUID()`, and build a two-phase identity index that detects duplicate existing
IDs before writing any missing IDs. Backfill should rewrite only Plan metadata/front matter and preserve the parsed
markdown body exactly.

Extract the current Epic/child/standalone/orphan grouping behavior from `src/cmd/plans/index.js` into reusable
Plan-store helpers, then update the CLI to consume those helpers without changing its default output semantics. Because
`src/shared/workflow/plan-lifecycle.js` already imports `src/plan-store.js`, do not import `plan-lifecycle.js` into
`plan-store.js`; keep Epic detection semantics identical (`classification: PROJECT` and `type: epic`) in a cycle-free
helper.

## Files to Modify

- `src/plan-store.js` — add `planId` front matter support, body-preserving identity backfill, duplicate detection,
  lookup by `planId`, Plan resource metadata helpers, and shared hierarchy/progress helpers.
- `src/plan-store.test.js` — cover identity creation, preservation, duplicate handling, lookup, archived-plan hiding,
  body preservation during metadata rewrites, and hierarchy grouping.
- `src/cmd/plans/index.js` — replace private grouping/progress helpers with Plan-store shared helpers while preserving
  existing terminal behavior.
- `src/cmd/plans/index.test.js` — assert default listing compatibility and Epic/child/orphan output after helper
  extraction.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.js` — reuse `loadPlan`, `listPlans`, `updatePlanFrontMatter`, recursive plan collection, front matter
  parsing/formatting, canonical path handling, and archived-plan hiding.
- `src/cmd/plans/index.js` — preserve current `isChildFeaturePlan`, `groupPlans`, and child progress semantics as the
  behavior contract for the shared helpers.
- `src/shared/workflow/plan-lifecycle.js` — mirror the existing `isEpicPlan` rule exactly, but avoid importing this
  module into `plan-store.js` because that would introduce a circular dependency.

## Implementation Steps

- [ ] Step 1: Add `planId` to the `PlanFrontMatter` JSDoc, `KNOWN_FRONT_MATTER_KEYS`, `formatFrontMatter`,
      `injectFrontMatter`, and `parsePlanFrontMatter` normalization paths. Treat only non-empty string values as
      existing IDs; missing/blank/non-string IDs should be absent after parsing.
- [ ] Step 2: Add a small body-preserving front matter rewrite seam for metadata-only updates used by identity backfill.
      It may normalize the YAML front matter order/quoting, but it must concatenate the newly formatted front matter
      with the original parsed body without trimming or otherwise editing body markdown.
- [ ] Step 3: Implement `ensurePlanIdentity(cwd, planName, options?)` that loads one Plan, preserves an existing
      `planId`, generates one with `crypto.randomUUID()` when missing, rewrites only front matter when needed, and
      returns canonical `planName`, project-relative markdown path, absolute path, `planId`, front matter, and body
      metadata. Keep any test-only ID generator injection private/optional and JSDoc-typed.
- [ ] Step 4: Implement a Plan identity index helper, e.g. `listPlanResources(cwd, { backfillMissing = true } = {})`,
      that lists non-archived Plans, checks duplicate existing `planId` values before backfilling, optionally backfills
      missing IDs, retries generated-ID collisions defensively, and returns stable resource entries sorted like
      `listPlans`.
- [ ] Step 5: Add `findPlanById(cwd, planId)` or equivalent lookup that builds the non-archived resource index, resolves
      exactly one Plan by durable ID, and returns canonical `planName`, `relativePath` such as `plans/name.md`, absolute
      `path`, `attrs`, `body`, and original `markdown`. Throw a repair-oriented error for duplicate IDs and a clear
      not-found error for unknown IDs.
- [ ] Step 6: Extract shared hierarchy helpers into `src/plan-store.js`: a child FEATURE predicate, an Epic predicate
      with the same rule as lifecycle (`PROJECT` + `type: epic`), `groupPlanHierarchy(plans)`, and a progress-count
      helper returning verified/active/failed/remaining/total counts for child Plans.
- [ ] Step 7: Update `src/cmd/plans/index.js` to import the shared hierarchy/progress helpers, keep all
      formatting/console output behavior compatible with existing tests, and avoid changing the `wld plans` default
      command contract.
- [ ] Step 8: Add focused tests for `planId` round-trip formatting/parsing, missing-ID backfill, existing-ID
      preservation, body preservation during backfill, duplicate-ID errors, generated collision retry behavior if
      practical, lookup by ID, nested child Plans, hidden `plans/archived` resources, hierarchy grouping, child progress
      counts, and CLI grouping compatibility.

## Verification Plan

- Automated: run `deno task ci`.
- Manual: create Plans with and without `planId`, run the new identity/index helpers through tests or a small local
  script, and verify markdown bodies are unchanged after backfill.
- Expected results for key scenarios: Plan URLs can resolve by stable `planId`; duplicate IDs fail loudly with a
  repair-oriented error before ambiguous lookup; `wld plans` still lists Epics, child FEATUREs, standalone Plans, and
  orphaned children as before.

## Edge Cases & Considerations

- Existing Plans without `planId` must be backfilled once without changing body markdown.
- Existing duplicate IDs must not be silently rewritten because that would break user-owned links and hide data
  corruption.
- Existing blank or non-string `planId` values should be treated as missing and replaced during backfill.
- Filename/name remains valid for current CLI workflows; `planId` is an additional resource identity, not a replacement
  for all Plan references.
- Shared grouping must keep PROJECT Epic detection as `classification: PROJECT` plus `type: epic` and must not introduce
  a `plan-store.js` ↔ `plan-lifecycle.js` circular import.
- This slice intentionally does not add the body-only save/hash editor seam; that is covered by the dependent
  `body-only-plan-detail-editor` FEATURE.
- All implementation source must remain JavaScript/JSDoc only; do not add TypeScript files or syntax.
