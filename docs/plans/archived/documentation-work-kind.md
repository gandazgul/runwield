---
planId: "a6abad0e-eeb6-412c-9b2a-e412e65b3a4b"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Add DOCUMENTATION as a canonical Work Kind for Planned Change Plans and Work Records."
affectedPaths:
    - "docs/domain-language.md"
    - "src/constants.js"
    - "src/tools/triage-report.js"
    - "src/plan-store.js"
    - "src/tools/plan-written.js"
    - "src/shared/workflow/orchestrator.js"
    - "src/shared/workflow/workflow-slicer.js"
    - "src/shared/work-records/schema.js"
    - "src/agent-definitions/router.md"
    - "src/agent-definitions/workflow-prompts/slicer-prompt.md"
    - "src/agent-definitions/document-formats/planner-plan-format.md"
    - "docs/prd/runwield-core-prd.md"
    - "docs/prd/work-records-prd.md"
    - "docs/product-rules.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-29T09:33:58-04:00"
updatedAt: "2026-07-30T11:53:12.040Z"
archivedAt: "2026-07-01"
status: "verified"
origin: "internal"
implementedAt: "2026-07-29T21:11:14.217Z"
verifiedAt: "2026-07-30T11:52:56.038Z"
userVerifiedAt: null
executionReport: "- Added `DOCUMENTATION` Work Kind across constants, labels, normalization docs/JSDoc, triage and Slicer schemas, Router/Planner/Slicer prompts, PRDs, product rules, and glossary language without changing Routing Intent semantics.\n- Added regression coverage for `DOCUMENTATION` normalization/labeling, triage preservation/omission, plan review/approval handoff, Plan front matter and child materialization, Slicer/Engineer handoff text, and Work Record read/search/list display.\n- Verification passed: `deno run -A scripts/run-tests.js -A src/constants.test.js`; focused triage/plan-review/plan-store/workflow/work-record test groups with forwarded `-A`; manual `deno eval` sample parsed `workKind: DOCUMENTATION` and returned label `Planned documentation`; `deno task ci` passed.\n- Note: the plan’s focused command form without forwarded `-A` was attempted once and failed because child `deno test` lacked env permission for the sandbox guard; reran the same focused files with forwarded `-A` successfully."
workRecord:
    status: "generated"
    recordId: "2c924629-39e4-400b-8de4-3cb1eee10ac8"
    path: "docs/work-records/2026-07-30-added-documentation-work-kind.md"
    lastAttemptAt: "2026-07-30T11:53:03.716Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "e380936a7fd5548f7bf2facd32a1d059290f3873"
    targetBranch: "main"
    targetHeadBeforeMerge: "39cfd3895c1b5de4b19b0fa13a3e40ace37f1283"
routingIntent: "PLANNED_CHANGE"
sessionName: "documentation work kind"
---

# Add Documentation Work Kind

## Context

RunWield already separates workflow ceremony from work nature: `PLANNED_CHANGE` is the executable Plan Classification,
and the optional `workKind` Front Matter field currently records `BUG_FIX`, `FEATURE`, `REFACTOR`, or `MAINTENANCE`. The
user wants planned documentation work to have its own Work Kind instead of being forced into `FEATURE` or `MAINTENANCE`.

Repository evidence shows Work Kind values are accepted and surfaced through a vertical slice: `src/constants.js` owns
`WORK_KINDS`, normalization, and user-facing labels; `triage_report` and Slicer tools duplicate the allowed values in
tool schemas; Plan and Work Record Front Matter normalize through `normalizeWorkKind`; agent prompts and PRDs document
the same set. The prior Work Record for the taxonomy change explicitly recommends compatibility-first normalization and
moving prompts, UI labels, schemas, and tests together.

This Plan uses current terminology from `docs/domain-language.md`: the new value is a Work Kind for `PLANNED_CHANGE`,
not a new Routing Intent or Plan Classification. The canonical value will be `DOCUMENTATION`, as discussed with the
user.

## Objective

Add `DOCUMENTATION` as a first-class Work Kind for Planned Change Plans, Epic child Plans, and Work Records so Router,
Planner, Slicer, Plan review, lifecycle handoff, Work Record search/read output, and documentation all preserve and
display planned documentation work accurately.

This must not change Routing Intent semantics: small direct documentation typos can still route as `QUICK_FIX` when
bounded, and non-materializing documentation questions remain `INQUIRY`. `DOCUMENTATION` only describes the nature of
planned executable work after the request is classified as `PLANNED_CHANGE`.

## Approach

Extend the existing Work Kind taxonomy in place with a compatibility-first change:

- Add `DOCUMENTATION` to the central `WORK_KINDS` list and all JSDoc/literal unions that currently enumerate Work Kind
  values.
- Add a user-facing label, `Planned documentation`, through `formatPlannedWorkLabel` so TUI/Workspace/Work Record
  displays update automatically where they already call the formatter.
- Update Router, Planner-format, and Slicer prompts so future agents can emit `workKind: DOCUMENTATION` intentionally
  for documentation-primary planned work.
- Update Plan, Work Record, and external-Plan onboarding documentation plus `docs/domain-language.md` so the glossary
  and product docs match implemented behavior.
- Add focused regression tests that prove the new value survives triage normalization, Plan Front Matter
  parsing/formatting, Slicer child materialization, and Work Record read/search/list display.

Do not bulk rewrite historical Plans or Work Records. Existing values must continue to parse unchanged, and unknown Work
Kind values should remain normalized away exactly as they do today.

## Files to Modify

- `docs/domain-language.md` — update the Work Kind definition list and add a `DOCUMENTATION` Work Kind glossary entry
  with avoided aliases.
- `src/constants.js` — add `DOCUMENTATION` to `WORK_KINDS`, update JSDoc return unions, and add the
  `Planned documentation` label in `formatPlannedWorkLabel`.
- `src/tools/triage-report.js` — allow `workKind: DOCUMENTATION` in the tool parameter schema and update its
  description.
- `src/plan-store.js` — update `PlanFrontMatter`, `ChildFeaturePlanDescriptor`, `SavedChildFeaturePlan`, and related
  JSDoc unions so Plan parsing/saving documents the new value accurately.
- `src/tools/plan-written.js` — update the local `TriageMeta` JSDoc union for `workKind` so approval/lifecycle handoff
  types match normalization.
- `src/shared/workflow/orchestrator.js` — update workflow triage metadata JSDoc for the new Work Kind value.
- `src/shared/workflow/workflow-slicer.js` — allow `DOCUMENTATION` in the Slicer child descriptor schema so Epic
  decomposition can create documentation child Plans.
- `src/shared/work-records/schema.js` — update Work Record Front Matter JSDoc to include `DOCUMENTATION`.
- `src/agent-definitions/router.md` — teach Router to use `workKind: DOCUMENTATION` for planned documentation creation
  or substantial documentation updates, while preserving existing Routing Intent rules.
- `src/agent-definitions/workflow-prompts/slicer-prompt.md` — add `DOCUMENTATION` to child Work Kind guidance.
- `src/agent-definitions/document-formats/planner-plan-format.md` — include `DOCUMENTATION` in the canonical Plan Front
  Matter template.
- `docs/prd/runwield-core-prd.md` — update the Work Kind list in Routing Intent documentation.
- `docs/prd/work-records-prd.md` — update the Work Record `workKind` schema example.
- `docs/product-rules.md` — update external Plan onboarding guidance that enumerates known Work Kind values.
- `src/constants.test.js` — add direct coverage for `normalizeWorkKind("DOCUMENTATION")` and the `Planned documentation`
  label.
- `src/tools/__tests__/triage-report.test.js` — add coverage that `workKind: DOCUMENTATION` is accepted only for
  `PLANNED_CHANGE` and appears in result details/status/metrics.
- `src/tools/__tests__/plan-written.test.js` — add or update coverage that approval/lifecycle handoff preserves
  `DOCUMENTATION` when it comes from triage metadata or approved Plan Front Matter.
- `src/ui/review/plan-review.test.js` — add or update Plan review coverage showing triage metadata with `DOCUMENTATION`
  is injected and re-parsed as trusted Plan Front Matter.
- `src/plan-store.test.js` — add or update coverage that Plan Front Matter and child Plan materialization round-trip
  `DOCUMENTATION`.
- `src/shared/workflow/workflow.test.js` and/or `src/shared/workflow/workflow-prompts.test.js` — add coverage that
  Slicer prompts/materialization and Engineer handoff text carry `DOCUMENTATION` without forcing parent Work Kind
  behavior.
- `src/shared/work-records/work-records.test.js`, `src/tools/work-record-read.test.js`, and/or
  `src/tools/work-record-search.test.js` — add focused coverage that Work Records with `workKind: DOCUMENTATION`
  normalize, index/search, and display as `Planned documentation`.

## Reuse Opportunities

- `src/constants.js::normalizeWorkKind` — keep this as the single normalization gate for Plans, Triage metadata, and
  Work Records.
- `src/constants.js::formatPlannedWorkLabel` — reuse the existing formatter so display surfaces pick up the new label
  consistently.
- `src/shared/work-records/list.js::formatWorkRecordScopeLabel` — no new display branch should be needed once
  `formatPlannedWorkLabel` handles `DOCUMENTATION`.
- `src/plan-store.js::parsePlanFrontMatter` and `src/plan-store.js::formatFrontMatter` — preserve existing
  parse/serialize behavior; the new value should flow through existing `workKind` handling.
- `src/shared/workflow/workflow-slicer.js::materializeSlicerDraft` and `saveChildFeaturePlans` — preserve current child
  Work Kind preservation semantics; only add the accepted literal.
- Existing test harnesses under `src/tools/__tests__/`, `src/plan-store.test.js`, and `src/shared/work-records/` —
  extend focused tests instead of introducing new infrastructure.

## Implementation Steps

- [ ] Step 1: Update `docs/domain-language.md` to make the new domain language true: change the Work Kind definition to
      list `DOCUMENTATION`; add a `DOCUMENTATION` Work Kind entry describing documentation-primary planned executable
      work; distinguish it from `INQUIRY`, `OPERATION`, and small `QUICK_FIX` documentation edits. Update
      `docs/product-rules.md` in the same language pass so external Plan onboarding no longer claims the old four-value
      set is complete.
- [ ] Step 2: Update `src/constants.js` by adding `DOCUMENTATION` to `WORK_KINDS`, expanding JSDoc unions for
      `normalizeWorkKind`, and adding a `case "DOCUMENTATION": return "Planned documentation";` branch in
      `formatPlannedWorkLabel`.
- [ ] Step 3: Update code-level schema/type documentation that mirrors Work Kind values: `src/plan-store.js`,
      `src/tools/plan-written.js`, `src/shared/workflow/orchestrator.js`, and `src/shared/work-records/schema.js`.
- [ ] Step 4: Update executable tool schemas: add `DOCUMENTATION` to `src/tools/triage-report.js` `StringEnum` and to
      `src/shared/workflow/workflow-slicer.js` child `workKind` `Type.Union`; refresh descriptions to say it is for
      documentation creation or substantial documentation updates.
- [ ] Step 5: Update agent-facing guidance: `src/agent-definitions/router.md`,
      `src/agent-definitions/workflow-prompts/slicer-prompt.md`, and
      `src/agent-definitions/document-formats/planner-plan-format.md`. Router guidance should explicitly avoid routing
      every docs-related request to `PLANNED_CHANGE`; the Work Kind applies after planned-work routing is chosen.
- [ ] Step 6: Update product/schema docs in `docs/prd/runwield-core-prd.md` and `docs/prd/work-records-prd.md` to
      include `DOCUMENTATION` in Work Kind lists.
- [ ] Step 7: Add targeted tests:
  - `src/constants.test.js`: `normalizeWorkKind("DOCUMENTATION")` returns `DOCUMENTATION`; unknown/non-string values
    still return `undefined`; `formatPlannedWorkLabel("DOCUMENTATION")` returns `Planned documentation`.
  - `src/tools/__tests__/triage-report.test.js`: `DOCUMENTATION` is accepted for `PLANNED_CHANGE`, preserved in
    details/metrics, and omitted for non-`PLANNED_CHANGE` routing just like other Work Kinds.
  - `src/tools/__tests__/plan-written.test.js` and/or `src/ui/review/plan-review.test.js`: Plan review and
    approval/lifecycle handoff preserve `DOCUMENTATION` from triage metadata or approved Plan Front Matter.
  - `src/plan-store.test.js`: parsing/saving Plan Front Matter with `workKind: DOCUMENTATION` preserves it; unknown
    values still normalize away; child Plan save/materialization can write `DOCUMENTATION`.
  - `src/shared/workflow/workflow.test.js` or `src/shared/workflow/workflow-prompts.test.js`: Slicer prompt/context
    includes `Work Kind: DOCUMENTATION`, child descriptors with this Work Kind pass schema/materialization, and Engineer
    handoff text describes the work as a planned documentation change.
  - Work Record tests: `workKind: DOCUMENTATION` normalizes and displays/searches as `Planned documentation` with the
    raw `workKind: DOCUMENTATION` metadata preserved.
- [ ] Step 8: Run formatter/lint-friendly cleanup without broad JS-to-TS migration. These are existing JavaScript/JSDoc
      files; keep edits scoped and consistent with current style.

## Verification Plan

- Automated: run focused tests first:
  - `deno run -A scripts/run-tests.js src/constants.test.js`
  - `deno run -A scripts/run-tests.js src/tools/__tests__/triage-report.test.js src/tools/__tests__/plan-written.test.js src/ui/review/plan-review.test.js`
  - `deno run -A scripts/run-tests.js src/plan-store.test.js`
  - `deno run -A scripts/run-tests.js src/shared/workflow/workflow.test.js src/shared/workflow/workflow-prompts.test.js`
  - `deno run -A scripts/run-tests.js src/shared/work-records/work-records.test.js src/tools/work-record-read.test.js src/tools/work-record-search.test.js`
- Automated: run the full project gate with `deno task ci`.
- Manual: inspect the Router prompt and Plan format template to confirm `DOCUMENTATION` is described as a Work Kind, not
  a Routing Intent or Plan Classification.
- Manual: create or parse a sample Plan Front Matter block containing `classification: PLANNED_CHANGE` and
  `workKind: DOCUMENTATION`; expected result is parsed attrs preserving `workKind: "DOCUMENTATION"` and display labels
  saying `Planned documentation`.
- Expected result: existing `BUG_FIX`, `FEATURE`, `REFACTOR`, and `MAINTENANCE` tests continue to pass; legacy
  `classification: FEATURE` still normalizes to `PLANNED_CHANGE`; invalid Work Kind values still do not persist through
  normalization.
- Expected result: Work Records with `scope: planned_change` and `workKind: DOCUMENTATION` display/search/read as
  `Planned documentation` and retain `workKind: DOCUMENTATION` in metadata output.
- Glossary/docs check: confirm `docs/domain-language.md`, `docs/product-rules.md`, PRDs, code behavior, and prompts all
  use the same `DOCUMENTATION` Work Kind language and do not promote unimplemented Routing Intent behavior.
- Execution policy matrix:
  - Planned Change Plans may omit `executionAgent`; omission defaults to `engineer` for backward compatibility.
  - Planned Change Plans may set `executionAgent: "engineer"` with `collaborationRecommendation: "autonomous"` or
    omitted. `pair` is invalid for Engineer-owned execution.
  - Planned Change Plans may set `executionAgent: "frontend-engineer"` with `collaborationRecommendation: "autonomous"`
    or `"pair"`.
  - Use `frontend-engineer` for browser-rendered UI work whose primary outcome is materially visual or interactive;
    otherwise use `engineer` (including TUI work and incidental frontend-file edits).
  - Recommend `pair` only when live visual judgment is valuable; use `autonomous` otherwise. Include known dev-server
    hints and exact headed-browser checks. Real-browser verification is mandatory for Frontend Engineer unless
    externally blocked.
  - PROJECT Epics are non-executable containers and must not define `executionAgent` or `collaborationRecommendation`;
    execution policy belongs only on child Plans.
  - Legacy `frontend: true` on legacy Planned Change Plans is still accepted as Frontend Engineer/autonomous
    compatibility metadata, but new Plans should use canonical `executionAgent` / `collaborationRecommendation` instead.
    Legacy `frontend: false` remains Engineer compatibility metadata and is distinct from an absent canonical owner.

## Edge Cases & Considerations

- **Compatibility**: Do not rewrite historical Plans or Work Records. Existing front matter remains valid; new artifacts
  can use `DOCUMENTATION` once this ships.
- **Routing clarity**: `DOCUMENTATION` must not become a new Routing Intent. It should only be emitted with
  `PLANNED_CHANGE` when the planned work is documentation-primary.
- **Small docs edits**: Router guidance should preserve current quick-path behavior for bounded typo-level documentation
  fixes; those do not need a Plan solely because `DOCUMENTATION` exists.
- **Unknown values**: `normalizeWorkKind` currently drops unknown/non-string values. Preserve that behavior; only
  `DOCUMENTATION` joins the accepted set.
- **Prompt/schema drift**: The main risk is updating code normalization without updating prompts and docs. Mitigate by
  changing all enumerated Work Kind lists in the same implementation and adding tests for both machine schemas and
  user-facing labels.
- **Terminology**: Update `docs/domain-language.md` in the same change so the glossary describes implemented behavior
  when the new value lands.
