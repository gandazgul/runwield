---
planId: "6d94f358-093f-45af-8d8a-2ae4f52c38de"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Implement metadata preservation for Epic/FEATURE plans and recursive plan discovery in `src/plan-store.js`. This includes adding support for `type`, `parentPlan`, and `dependencies` in front matter and updating `listPlans` to find nested plans under `plans/`."
affectedPaths:
    - "src/plan-store.js"
    - "src/plan-store.test.js"
createdAt: "2026-06-16T16:25:04Z"
updatedAt: "2026-07-17T04:42:58.214Z"
status: "verified"
origin: "internal"
implementedAt: "2026-06-16T17:37:18.484Z"
verifiedAt: "2026-06-16T19:15:25.996Z"
workRecord:
    status: "generated"
    recordId: "f4fd907d-f86d-48e4-9b84-a4cfb8240135"
    path: "docs/work-records/2026-07-17-preserved-epic-and-child-plan-metadata.md"
    lastAttemptAt: "2026-07-17T04:42:50.954Z"
executionBaselineTree: "1f1bdaf7cd15c62c13f9688a909f60c9aa7a8ffe"
worktreeId: "74f8b50f"
worktreePath: "/Users/gandazgul/Documents/web/harns-harns-project-breakdown-epic-feature1-preserve-epic-an-74f8b50f"
worktreeBranch: "harns/worktree/project-breakdown-epic-feature1-preserve-epic-an-74f8b50f"
worktreeStatus: "merged"
---

# Preserve Epic and Child Plan Metadata

## Context

This is an `AFK` slice. An agent can implement it unattended because the desired behavior is structural and testable.

The Epic decomposition workflow needs new front matter fields such as `type`, `parentPlan`, and `dependencies`.
Generated child FEATURE plans live under `plans/<epic-name>/`, which means existing top-level-only plan discovery is not
enough. Without this foundation, later slices would create child plans that Harns cannot reliably save, load, list, or
update.

Current `src/plan-store.js` rewrites front matter through a fixed field whitelist and `listPlans` only scans immediate
children of `plans/`. It also treats any argument containing `/` as an external path in `resolvePlan`, so a stored child
plan name such as `project-breakdown-epic/feature1-preserve-epic-and-child-plan-metadata` cannot be resolved as a saved
plan.

## Objective

Extend plan storage so Harns can round-trip Epic and child FEATURE metadata without dropping fields, can safely address
nested plan names under `plans/`, and can discover child FEATURE plans by their loose `parentPlan` pointer.

## Approach

Keep `src/plan-store.js` as the single plan persistence boundary. Add explicit support for the fields required by this
Epic, and change front matter merging so unknown fields from existing markdown are retained instead of silently dropped.
Add safe nested-plan path resolution that prevents `..`/absolute-path escapes from the `plans/` directory, then make
plan listing recursive and deterministic.

Use canonical stored plan names relative to `plans/` without the `.md` extension. Examples:

- top-level Epic: `project-breakdown-epic`
- nested child FEATURE: `project-breakdown-epic/feature1-preserve-epic-and-child-plan-metadata`

For `resolvePlan`, prefer a saved plan lookup for extensionless names (including names containing `/`). Keep `.md` and
explicit relative/absolute path arguments working as external plan loads when no saved plan is found.

## Files to Modify

- `src/plan-store.js` - add front matter support for Epic and child metadata, preserve unknown metadata, safely resolve
  nested stored plan paths, recursively list plans, and add a parent-child lookup helper.
- `src/plan-store.test.js` - cover metadata preservation, nested save/load/update/list/resolve behavior, and
  parent-child discovery.

## Reuse Opportunities

- `src/plan-store.js` - reuse `parsePlanFrontMatter`, `injectFrontMatter`, `updatePlanFrontMatter`, and `resolvePlan` as
  the durable persistence API instead of adding a second store.
- `@std/front-matter` - keep using the existing YAML extraction path.
- `@std/path` - use path helpers such as `join`, `resolve`, `relative`, `dirname`, and separator normalization for safe
  nested plan names.

## Implementation Steps

- [ ] Extend the `PlanFrontMatter` JSDoc with optional `type`, `parentPlan`, and `dependencies` fields: `type` is a
      string such as `"epic"`, `parentPlan` is the canonical parent plan name, and `dependencies` is an array of sibling
      plan identifiers.
- [ ] Add a small stored-plan path helper in `src/plan-store.js` used by `savePlan`, `loadPlan`, `updatePlanStatus`, and
      `updatePlanFrontMatter`; it should normalize `\` to `/`, strip an optional `.md`, reject empty names and path
      escapes, and return both the canonical plan name and file path under `plans/`.
- [ ] Update `savePlan` so nested plan names create their parent directories before writing.
- [ ] Update `formatFrontMatter`, `injectFrontMatter`, and `parsePlanFrontMatter` so `type`, `parentPlan`, and
      `dependencies` round-trip through save/load/update/status changes.
- [ ] Preserve unknown front matter keys by merging existing attrs with normalized known fields before formatting; emit
      known keys in the current stable order, then emit unknown primitive/list fields in a deterministic key order.
- [ ] Update `loadPlan` to use the safe stored-plan helper so nested names load from `plans/<name>.md` without being
      confused with external paths.
- [ ] Update `resolvePlan` so extensionless nested names are attempted as saved plans first; retain external markdown
      path behavior for `.md`, `./...`, `../...`, and absolute path arguments when no saved plan exists.
- [ ] Update `listPlans` to walk `plans/` recursively, skip non-markdown files, parse each discovered file, return names
      relative to `plans/` without `.md`, and sort results lexicographically by name.
- [ ] Add and export `findPlansByParent(cwd, parentPlan)` that calls `listPlans(cwd)` and returns plans whose
      `attrs.parentPlan` matches the canonical parent name, sorted by child plan name.
- [ ] Update existing tests where needed for deterministic sorted recursive results.
- [ ] Add tests for: - top-level Epic metadata with `classification: "PROJECT"` and `type: "epic"`; - nested child
      FEATURE save/load/list/resolve/update using a name under `plans/<epic-name>/`; - `parentPlan` and `dependencies`
      surviving `updatePlanStatus` and `updatePlanFrontMatter`; - unknown front matter fields surviving an inject/update
      round trip; - path traversal or absolute stored plan names being rejected rather than written outside `plans/`; -
      `findPlansByParent` returning only matching children.

## Verification Plan

- Automated: `deno test src/plan-store.test.js`
- Automated: `deno run ci`
- Manual: create a temporary nested plan fixture in a scratch project and confirm `listPlans` returns both the Epic and
  child FEATURE names, with the child name in `epic/child` form.
- Expected result: child FEATURE metadata survives every normal plan-store operation, nested saved plans are
  discoverable and loadable by canonical name, and stored plan names cannot escape `plans/`.

## Edge Cases & Considerations

- Existing plans without new fields must continue to parse with defaults.
- Existing external plan loading should remain compatible with arbitrary markdown paths.
- Recursive listing should tolerate unreadable or malformed individual plan files the same way current `listPlans` skips
  unreadable top-level files.
- Unknown metadata preservation should not destabilize the required Harns front matter fields; normalize known fields
  first and preserve unknowns second.
- Avoid TypeScript syntax; use pure JavaScript with JSDoc only.
