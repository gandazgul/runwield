---
planId: "cb44395f-4684-4a0a-a80e-f78f474f6457"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Remove 'Front matter summary' section from Plan and Epic detail screens. Move all front matter metadata into the 'Metadata' section, organized into logical groups. Use constants for front matter keys to ensure consistency with RunWield's planning mechanics."
affectedPaths:
    - "src/plan-store.js"
    - "src/ui/workspace/components/PlanDetail.jsx"
    - "src/ui/workspace/components/EpicDetail.jsx"
createdAt: "2026-06-30T13:04:13-04:00"
updatedAt: "2026-07-17T04:53:08.834Z"
status: "verified"
origin: "internal"
implementedAt: "2026-06-30T17:43:15.946Z"
verifiedAt: "2026-06-30T19:14:41.928Z"
workRecord:
    status: "generated"
    recordId: "dcdffa13-e562-4254-b007-72fc9d0f406b"
    path: "docs/work-records/2026-07-17-grouped-workspace-detail-metadata.md"
    lastAttemptAt: "2026-07-17T04:53:03.128Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
routingIntent: "FEATURE"
sessionName: "refactor plan metadata display"
---

# Group Workspace Detail Metadata

## Context

The Workspace Plan detail sidebar currently shows a short `Metadata` block followed by a separate `Front matter summary`
block. This duplicates fields such as `planId`, `classification`, and `complexity`, and makes the detailed front matter
feel detached from the canonical Plan metadata.

The request is to remove the `Front matter summary` section and make all visible metadata available under the Metadata
section, organized into logical groups. The implementation should also centralize front matter key names so the UI does
not drift from the Plan front matter mechanics in `src/plan-store.js`.

Product intent sources:

- User request: remove `Front matter summary`; show metadata under `Metadata`; organize it logically; use constants for
  front matter keys.
- Existing behavior to preserve: Workspace summaries/detail payloads intentionally omit absolute filesystem paths such
  as `worktreePath`; keep that redaction unless the product decision changes later.
- Proposed assumption: show front matter values that are present and meaningful, plus resource identity fields such as
  `Path`; do not render every possible schema key with empty placeholder values.

## Objective

Build a single grouped metadata sidebar for both FEATURE Plan details and Epic details that:

- Removes the separate `Front matter summary` heading/list.
- Displays front matter metadata under the Metadata/Epic metadata area without duplicating values.
- Uses shared front matter key constants exported from the planning mechanics.
- Keeps unknown/custom front matter visible in an `Additional metadata` group.
- Preserves existing redaction of absolute paths and body-only editing behavior.

## Approach

Export canonical front matter key constants from `src/plan-store.js`, derive the existing known-key set from those
constants, and update formatting code to use the constants where it writes YAML keys.

Refactor `src/ui/workspace/components/PlanDetail.jsx` so `DetailMetadata` renders grouped metadata sections from
`plan.frontMatter` plus safe resource fields. Keep the group definitions in the component, but reference the exported
constants for all known front matter keys. Remove `FrontMatterSummary` entirely and update `EpicDetail.jsx`
imports/rendering accordingly.

Recommended group structure:

- `Identity`: Plan ID, path, origin, type.
- `Planning`: classification, complexity, summary, affected paths, created/updated timestamps.
- `Hierarchy & dependencies`: parent Epic and dependencies.
- `Lifecycle`: status, failure/implementation/verification timestamps and failure reason.
- `Execution worktree`: execution baseline, worktree id/branch/status. Do not re-expose `worktreePath` because the
  adapter currently strips it.
- `Review`: human review mode/decision/timestamp.
- `Epic completion`: Epic done-enough mode/timestamp/summary.
- `Hold`: held-from status, held-at timestamp, hold reason, hold staleness baseline.
- `Additional metadata`: any remaining front matter keys, sorted or stable in source order.

## Files to Modify

- `src/plan-store.js` — export front matter key constants/order and derive `KNOWN_FRONT_MATTER_KEYS` from them; use
  constants in YAML formatting to reduce drift.
- `src/ui/workspace/components/PlanDetail.jsx` — replace `DetailMetadata` and remove `FrontMatterSummary`; add grouped
  rendering helpers using shared constants and safe value formatting.
- `src/ui/workspace/components/EpicDetail.jsx` — stop importing/rendering `FrontMatterSummary`; keep `DetailMetadata`
  for Epic sidebar metadata.
- `src/ui/workspace/static/styles.css` — remove obsolete `.front-matter-summary` styling and add lightweight grouped
  metadata styles if needed.
- `src/ui/workspace/workspace.test.js` — add/update SSR assertions for Plan and Epic details: no `Front matter summary`,
  grouped metadata includes known/custom fields, no absolute worktree path exposure.
- `src/plan-store.test.js` — add a small constant/formatting regression test if useful, ensuring exported key constants
  match formatted/known front matter behavior.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.js` — reuse the existing `PlanFrontMatter` typedef, `formatFrontMatter`, and known-key ordering as the
  source of truth for constants.
- `src/ui/workspace/server/plan-adapter.js` — keep using `frontMatter: workspaceSafeFrontMatter(resource.attrs)` as the
  safe detail source; do not bypass its `worktreePath` redaction.
- `src/ui/workspace/components/PlanCard.jsx` — keep reusing `ComplexityLabel` for complexity display.
- `src/ui/workspace/static/styles.css` — extend existing `.meta-list` styles instead of inventing a separate sidebar
  visual system.

## Implementation Steps

- [ ] Step 1: In `src/plan-store.js`, define and export `PLAN_FRONT_MATTER_KEYS` as a frozen object mapping semantic
      names to front matter key strings, plus `PLAN_FRONT_MATTER_KEY_ORDER` as a frozen array in canonical YAML output
      order.
- [ ] Step 2: Replace the private literal `KNOWN_FRONT_MATTER_KEYS` initialization with
      `new Set(PLAN_FRONT_MATTER_KEY_ORDER)` and update `formatFrontMatter()` `appendYamlField()` calls to use
      `PLAN_FRONT_MATTER_KEYS.*` constants.
- [ ] Step 3: In `src/ui/workspace/components/PlanDetail.jsx`, import the constants from `../../../plan-store.js` and
      add helper functions for metadata value formatting, key labeling, grouped entry selection, and fallback/additional
      metadata detection.
- [ ] Step 4: Refactor `DetailMetadata({ plan })` to render group sections under one `<dl>`/metadata container. Use
      `plan.frontMatter || plan.attrs || {}` as the metadata source, with resource fallbacks for `planId`,
      `relativePath`, `status`, `classification`, `complexity`, and other summary fields already present on the
      serialized detail.
- [ ] Step 5: Ensure grouped metadata suppresses only `undefined` and empty-string values, preserves `null`, `false`,
      `0`, arrays, and custom front matter, and renders arrays/readable objects safely without throwing.
- [ ] Step 6: Remove `FrontMatterSummary` from `PlanDetail.jsx`, remove its export, and delete the
      `Front matter summary` heading/render call in `PlanDetail`.
- [ ] Step 7: Update `src/ui/workspace/components/EpicDetail.jsx` to import only `boardHrefForPlanStatus`,
      `DetailMetadata`, and `tabForPlanStatus`; remove the Epic `Front matter summary` heading/render call.
- [ ] Step 8: Adjust `src/ui/workspace/static/styles.css`: remove `.front-matter-summary`; add small classes such as
      `.metadata-group`, `.metadata-group-title`, or `.metadata-section` only if needed to keep sidebar grouping
      readable.
- [ ] Step 9: Update Workspace SSR tests to cover a Plan detail and an Epic detail with representative metadata:
      lifecycle, hierarchy/dependency, Epic completion, hold/review/worktree fields, and a custom field. Assert the page
      does not include `Front matter summary`, does include the grouped metadata labels/values, and still does not
      expose `worktreePath`.
- [ ] Step 10: Add/update a `plan-store` test if the exported constants need direct regression coverage; otherwise rely
      on existing front matter round-trip tests plus Workspace rendering tests.

## Verification Plan

- Automated: `deno run ci`
- Manual:
  - Start the Workspace Plan UI and open a normal FEATURE Plan detail.
  - Confirm the sidebar has one Metadata section with grouped fields and no `Front matter summary` heading.
  - Open an Epic detail and confirm `Epic metadata` uses the same grouped metadata display.
  - Confirm custom/unknown front matter appears in `Additional metadata`.
  - Confirm `worktreePath` is still not visible in the UI/API output.
- Expected results:
  - Plan and Epic detail screens show all safe front matter metadata in logical groups under Metadata/Epic metadata.
  - There are no duplicated Plan ID/classification/complexity blocks.
  - Existing lifecycle actions and body editor behavior are unchanged.

## Edge Cases & Considerations

- `worktreePath` is a front matter key but is intentionally redacted by `workspaceSafeFrontMatter`; this plan preserves
  that existing safety behavior and treats it as out of scope to expose absolute paths.
- Unknown/custom metadata must not disappear; render it in an `Additional metadata` group after known groups.
- Empty strings are omitted to avoid noisy blank rows, matching the current `FrontMatterSummary` filtering behavior;
  explicit `null` values should still be visible if present.
- Keep implementation in pure JavaScript with JSDoc only; do not introduce TypeScript syntax.
- The Workspace components are server-rendered; avoid moving plan-store imports into client islands.
