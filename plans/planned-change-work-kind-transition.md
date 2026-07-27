---
classification: "FEATURE"
complexity: "HIGH"
summary: "Transition RunWield from FEATURE-as-workflow terminology to PLANNED_CHANGE plus explicit work kind metadata with legacy compatibility"
affectedPaths:
    - "src/constants.js"
    - "src/tools/triage-report.js"
    - "src/shared/workflow/orchestrator.js"
    - "src/plan-front-matter.js"
    - "src/plan-store.js"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/shared/workflow/workflow.js"
    - "src/shared/workflow/workflow-prompts.js"
    - "src/shared/workflow/workflow-slicer.js"
    - "src/shared/work-records/"
    - "src/ui/tui/chat-session.js"
    - "src/ui/workspace/components/PlanDetail.jsx"
    - "src/agent-definitions/"
    - "docs/prd/runwield-core-prd.md"
    - "docs/prd/work-records-prd.md"
    - "CONTEXT.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-26T21:10:30-04:00"
updatedAt: "2026-07-27T01:13:53.008Z"
status: "ready_for_work"
origin: "internal"
userVerifiedAt: null
userVerificationNote: null
---

# Planned Change and Work Kind Transition

## Context

A user reported a bug, and Router correctly sent it through the reviewed planning workflow because the likely fix was
too broad or design-sensitive for `QUICK_FIX`. The user was confused because the current Routing Intent and Plan
Classification label was `FEATURE`, which ordinary users read as new functionality rather than a bug fix. The agreed
product direction is to split workflow ceremony from the nature of work: planned executable work should be
`PLANNED_CHANGE`, while bug vs feature vs refactor is captured separately as Work Kind.

This Plan itself uses legacy `classification: FEATURE` because the current runtime has not yet been transitioned. The
implementation should preserve legacy compatibility so existing Plans, transcripts, tests, Work Records, and older
agent/tool outputs that say `FEATURE` remain usable.

## Objective

Replace `FEATURE` as the canonical planned-work workflow label with `PLANNED_CHANGE`, while adding explicit `workKind`
metadata for the nature of requested work.

The delivered behavior should be:

- Router can emit `PLANNED_CHANGE` for reviewed executable work and include `workKind: BUG_FIX` for planned bug fixes.
- Legacy `routingIntent: FEATURE`, `classification: FEATURE`, and Work Record `scope: feature` remain accepted and
  normalize to planned-change semantics.
- New Plans use `classification: PLANNED_CHANGE` plus optional `workKind`.
- New Work Records use planned-change terminology and preserve `workKind` when known.
- User-facing labels say `Planned bug fix`, `Planned feature`, or neutral `Planned change` instead of leaking `FEATURE`
  for workflow routing.
- Existing old Plans without `workKind` display neutrally as `Planned change`, not as new feature work.

## Approach

Implement a compatibility-first taxonomy transition rather than a one-shot repository artifact migration.

Create shared normalization helpers for Routing Intent, Plan Classification, Work Kind, and Work Record scope. Use those
helpers at all decision points that currently compare directly to `FEATURE`. Accept both `FEATURE` and `PLANNED_CHANGE`
as executable planned work during the transition, but emit and serialize `PLANNED_CHANGE` for newly created Plans and
Router output.

Add `workKind` to Plan Front Matter and propagate it through triage metadata, Plan writing, Slicer child descriptors,
approval/review handoff, execution prompts, and Work Record generation. Keep `workKind` optional for legacy Plans; use
neutral labels when it is absent.

Avoid bulk rewriting existing Plans and Work Records. This preserves durable history and reduces risk. The transition
should be observable through new artifacts and display labels, not by mutating old completed artifacts.

## Files to Modify

- `src/constants.js` — add `PLANNED_CHANGE` to canonical Routing Intent values and define or export Work Kind constants
  if this remains the project's shared constants home.
- `src/tools/triage-report.js` — accept `PLANNED_CHANGE`, accept legacy `FEATURE`, normalize legacy to `PLANNED_CHANGE`,
  carry optional `workKind`, and update tool descriptions so Router does not call planned bug fixes features.
- `src/shared/workflow/orchestrator.js` — update `TriageOutcome`, normalization, dispatch, triage block rendering,
  metrics details, and plan-producing intent checks so `PLANNED_CHANGE` routes to Planner while legacy `FEATURE` still
  works.
- `src/shared/session/workflow-context-session.js` — normalize persisted workflow context so historical `FEATURE`
  session markers remain readable and new markers can use `PLANNED_CHANGE`.
- `src/plan-front-matter.js` — add ordered `workKind` support after `classification` or near `summary`, preserving
  deterministic front matter serialization.
- `src/plan-store.js` — update `PlanFrontMatter` JSDoc, defaults, parsing, saving, Plan list ordering, execution-policy
  resolution, child-plan detection, Epic child materialization, and dependency helpers to treat `PLANNED_CHANGE` and
  legacy `FEATURE` as the same executable Plan class.
- `src/shared/workflow/plan-lifecycle.js` — replace direct `classification === "FEATURE"` lifecycle checks with
  planned-change helper checks so readiness, validation, delivery evidence, and Epic completion continue to work for new
  and legacy Plans.
- `src/shared/workflow/execution-context.js` — update Workflow Validation context messages and checks from FEATURE-only
  to planned-change-compatible.
- `src/shared/workflow/workflow.js` — update execution metrics, comments, and routing conditions so single-plan
  execution accepts `PLANNED_CHANGE` and legacy `FEATURE`.
- `src/shared/workflow/workflow-prompts.js` — update Engineer prompt text from “FEATURE request” to `Planned change`,
  with Work Kind label when available.
- `src/shared/workflow/workflow-slicer.js` — update Slicer schema descriptions and child materialization wording; allow
  child descriptors to include `workKind`; create child Plans with `classification: PLANNED_CHANGE`.
- `src/agent-definitions/router.md` — update Router taxonomy and Diagnostic Triage rules so broad bug fixes become
  `PLANNED_CHANGE` with `workKind: BUG_FIX`, while small bugs remain `QUICK_FIX`.
- `src/agent-definitions/planner.md`, `src/agent-definitions/engineer.md`, `src/agent-definitions/frontend-engineer.md`,
  `src/agent-definitions/recorder.md`, and related workflow prompts — replace workflow uses of FEATURE with Planned
  Change terminology while keeping Work Kind language distinct.
- `src/agent-definitions/document-formats/` and bundled plan format source if present — add `workKind` to the canonical
  Plan Front Matter template once runtime support exists; until the template is updated, implementation tests should
  account for the current Plan using legacy `FEATURE`.
- `src/shared/work-records/schema.js` and `src/shared/work-records/generation.js` — add Work Record `workKind`, emit
  neutral planned-change scope for new planned executable records, and read legacy `scope: feature` as planned-change
  scope.
- `src/shared/work-records/search.js`, `src/shared/work-records/list.js`, `src/shared/work-records/index-adapter.js`,
  and `src/cmd/wr/index.js` — update display/search/indexing labels so legacy feature scope does not confuse planned bug
  fixes.
- `src/ui/tui/chat-session.js` — update footer route metadata to label `PLANNED_CHANGE` as `Planned Change`; legacy
  `FEATURE` should display as `Planned Change`, not `Feature`.
- `src/ui/workspace/components/PlanDetail.jsx` and nearby Workspace plan board/list components — update child Plan and
  classification labels to Planned Change terminology; display Work Kind where useful.
- `docs/prd/runwield-core-prd.md` — update canonical routing and Plan lifecycle language.
- `docs/prd/work-records-prd.md` — update Work Record scope/workKind language and legacy compatibility notes.
- `CONTEXT.md` — ensure the final glossary captures `PLANNED_CHANGE`, Work Kind, `BUG_FIX`, `FEATURE` Work Kind, and
  legacy `FEATURE` normalization.
- Tests touching the above files — update expectations and add legacy compatibility coverage.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/constants.js` — existing Routing Intent and complexity constants provide the natural home or import source for
  new enums.
- `src/shared/workflow/orchestrator.js::normalizeTriageOutcome` — existing legacy `classification` fallback is the right
  seam for accepting old `FEATURE` tool details.
- `src/tools/triage-report.js::normalizeTriageParams` — existing tool-level normalization can canonicalize Router output
  before dispatch and metrics.
- `src/plan-store.js::parsePlanFrontMatter`, `injectFrontMatter`, `savePlan`, and `updatePlanFrontMatter` — existing
  front matter normalization and deterministic serialization should be extended, not bypassed.
- `src/plan-store.js::isChildFeaturePlan` and `isEpicPlan` — keep exported compatibility helpers if widely used, but
  route their internals through a new planned-change helper; optionally add a new `isChildPlannedChangePlan` alias and
  migrate callers gradually.
- `src/shared/workflow/plan-lifecycle.js::isEpicPlan` — mirror the Plan Store helper pattern for classification-aware
  lifecycle checks.
- `src/ui/tui/chat-session.js::FOOTER_ROUTING_META` — existing display metadata map is the correct footer label seam.
- `src/shared/work-records/generation.js::deriveWorkRecordScope` — existing source-to-record classification seam should
  derive planned-change scope and Work Kind in one place.
- Existing tests in `src/tools/__tests__/triage-report.test.js`, `src/shared/workflow/orchestrator.test.js`,
  `src/plan-store.test.js`, `src/shared/workflow/plan-lifecycle.test.js`,
  `src/shared/work-records/work-records.test.js`, and `src/ui/tui/chat-session.test.js` already exercise the affected
  workflows and should be expanded rather than replaced.

## Implementation Steps

- [ ] Step 1: Add shared taxonomy constants/helpers.
  - Introduce canonical values for `PLANNED_CHANGE`, `PROJECT`, `QUICK_FIX`, and Work Kinds such as `BUG_FIX`,
    `FEATURE`, `REFACTOR`, and `MAINTENANCE`.
  - Provide helper functions such as `normalizeRoutingIntent`, `normalizePlanClassification`,
    `isPlannedChangeClassification`, `normalizeWorkKind`, and `formatPlannedWorkLabel` in an appropriate shared module.
  - Ensure `FEATURE` normalizes to `PLANNED_CHANGE` only when it is used as a Routing Intent, Plan Classification, or
    Work Record scope compatibility value. Do not treat Work Kind `FEATURE` as legacy.

- [ ] Step 2: Update Router and triage tool behavior.
  - Add `PLANNED_CHANGE` to `ROUTING_INTENTS` while accepting legacy `FEATURE` inputs.
  - Extend `triage_report` parameters to accept optional `workKind`.
  - Canonicalize tool details so new broad bug reports can return `routingIntent: PLANNED_CHANGE`,
    `classification: PLANNED_CHANGE`, `workKind: BUG_FIX`.
  - Update Router instructions: unknown-cause small bugs still prefer `QUICK_FIX`; multi-file or design-level bug fixes
    route `PLANNED_CHANGE` with `workKind: BUG_FIX`; new functionality routes `PLANNED_CHANGE` with `workKind: FEATURE`;
    Epic-scale work remains `PROJECT`.
  - Add tests proving legacy `routingIntent: FEATURE` and `classification: FEATURE` still dispatch to Planner as
    planned-change work.

- [ ] Step 3: Update workflow dispatch, session workflow context, and user-facing triage summaries.
  - Route `PLANNED_CHANGE` to Planner wherever `FEATURE` currently routes to Planner.
  - Preserve reading historical persisted workflow context with `FEATURE` and convert displayed labels to planned-change
    terminology.
  - Update Triage Report blocks and system status messages to include Work Kind when present, for example
    `Routing Intent: PLANNED_CHANGE`, `Work Kind: BUG_FIX`.
  - Keep metrics structured enough to understand legacy source values if needed, but canonical details should use
    `PLANNED_CHANGE`.

- [ ] Step 4: Extend Plan Front Matter parsing and writing.
  - Add `workKind` to `PLAN_FRONT_MATTER_KEYS` and `PlanFrontMatter` JSDoc.
  - Change new default executable Plan classification from `FEATURE` to `PLANNED_CHANGE`.
  - Preserve old Plans with `classification: FEATURE` by normalizing behavior on read and comparison, without bulk
    rewriting their files.
  - When saving new Slicer child Plans or Planner-authored Plans, write `classification: PLANNED_CHANGE` and set
    `workKind` from triage or child descriptor when available.
  - Ensure existing unknown front matter preservation remains intact.

- [ ] Step 5: Update Plan lifecycle and execution checks.
  - Replace direct `classification === "FEATURE"` checks with planned-change helper checks in lifecycle, validation,
    execution context, execution policy, Worktree handoff, Epic continuation, and dependency logic.
  - Keep PROJECT/Epic semantics unchanged.
  - Update error messages from `FEATURE validation_passed requires...` to planned-change wording.
  - Ensure both `classification: PLANNED_CHANGE` and legacy `classification: FEATURE` can reach `ready_for_work`,
    execute, validate, and become terminal.

- [ ] Step 6: Update Slicer and Epic child terminology.
  - Rename user-facing “Child FEATURE Plan” strings to “Child Planned Change Plan” or a shorter consistent label.
  - Allow child descriptors to carry `workKind`; default to `FEATURE` only when the Epic decomposition clearly
    represents new functionality, otherwise omit for neutral planned-change display or preserve explicit child values.
  - Materialize new children with `classification: PLANNED_CHANGE`.
  - Keep compatibility helper names where renaming them would be high churn, but add clear comments that old helper
    names are legacy aliases.

- [ ] Step 7: Update Engineer, Frontend Engineer, Planner, Recorder, and workflow prompt wording.
  - Replace workflow uses of `FEATURE plan/request` with Planned Change wording.
  - Keep “feature” only when referring to Work Kind `FEATURE` or ordinary product functionality.
  - In Engineer prompts, include Work Kind label when available: `This is a planned bug fix`,
    `This is a planned feature`, or neutral `This is a planned change`.
  - Update `task_completed` description and agent scope language so bug reporters no longer see planned work called
    FEATURE.

- [ ] Step 8: Update Work Records for planned-change terminology.
  - Add `workKind` to Work Record schema and markdown serialization.
  - Introduce canonical planned-change Work Record scope or equivalent neutral field for planned executable work; accept
    legacy `scope: feature` and display it as planned-change scope unless `workKind: FEATURE` is present.
  - Generate Work Records from planned-change Plans with the new neutral scope and propagate Plan `workKind`.
  - Keep historical Work Records readable and searchable; do not bulk rewrite completed records.
  - Update search/list/index tags and Work Record rendering so planned bug fixes are not surfaced as “feature” records.

- [ ] Step 9: Update UI labels.
  - TUI footer labels should display `Planned Change` for `PLANNED_CHANGE` and legacy `FEATURE` workflow context.
  - Workspace Plan detail and Epic child sections should use Planned Change terminology and optionally show Work Kind
    badges/metadata.
  - Plan board/list grouping should sort `PLANNED_CHANGE` in the same position legacy `FEATURE` occupied.
  - Existing `routingFeature` visual token can remain internally if renaming it is not necessary; user-visible label
    must change.

- [ ] Step 10: Update documentation and glossary.
  - Update `docs/prd/runwield-core-prd.md` to list `PLANNED_CHANGE` as the planned executable Routing Intent and
    Plan-producing classification.
  - Update `docs/prd/work-records-prd.md` for Work Record scope/workKind compatibility.
  - Update agent document-format templates to include `workKind` once the runtime supports it.
  - Keep historical `docs/prd/done/` files as historical unless they are actively consumed as current instructions;
    avoid rewriting old completed PRDs solely for terminology.
  - Ensure `CONTEXT.md` reflects final accepted domain language.

- [ ] Step 11: Add focused compatibility tests.
  - Triage tool: new `PLANNED_CHANGE` with `BUG_FIX`; legacy `FEATURE` input normalizes to planned-change; non-plan
    intents do not retain classification.
  - Orchestrator: `PLANNED_CHANGE` routes to Planner; legacy `FEATURE` still routes to Planner; PROJECT still routes to
    Architect.
  - Plan Store: new saved Plans serialize `classification: PLANNED_CHANGE`; legacy `classification: FEATURE` parses and
    executes as planned-change; `workKind` is preserved.
  - Lifecycle/execution: both new and legacy executable Plan classifications pass readiness, execution, validation, and
    recovery checks.
  - Slicer: child Plans materialize as `PLANNED_CHANGE` and preserve explicit Work Kind.
  - Work Records: planned bug-fix Plan generates a planned-change Work Record with `workKind: BUG_FIX`; legacy
    feature-scope records still parse and display neutrally.
  - TUI/Workspace labels: legacy `FEATURE` context displays as `Planned Change`, not `Feature`.

- [ ] Step 12: Run full validation and fix regressions.
  - Run targeted tests for changed modules as they are updated.
  - Run full repository CI before completion.
  - Inspect representative generated Plan and Work Record markdown for deterministic front matter ordering and legacy
    compatibility.

## Verification Plan

- Automated: `deno task ci`
- Automated targeted checks while developing:
  - `deno test -A src/tools/__tests__/triage-report.test.js`
  - `deno test -A src/shared/workflow/orchestrator.test.js`
  - `deno test -A src/plan-store.test.js`
  - `deno test -A src/shared/workflow/plan-lifecycle.test.js src/shared/workflow/workflow.test.js`
  - `deno test -A src/shared/work-records/work-records.test.js src/cmd/wr/index.test.js`
  - `deno test -A src/ui/tui/chat-session.test.js`
- Manual: create or simulate a Triage Report for a broad bug fix and confirm the TUI/session output labels it as
  `Planned bug fix` or `Planned Change` with `BUG_FIX`, not `Feature`.
- Manual: load a legacy Plan containing `classification: FEATURE` and no `workKind`; confirm it remains executable and
  displays neutrally as `Planned change`.
- Manual: create a new planned bug-fix Plan and confirm front matter includes `classification: PLANNED_CHANGE` and
  `workKind: BUG_FIX`.
- Manual: generate a Work Record from that Plan and confirm it does not call the bug fix a feature.
- Expected results for key scenarios:
  - Old transcripts and Plans with `FEATURE` do not break routing, loading, execution, validation, Work Record
    generation, or display.
  - New Router output, new Plans, and new Work Records use `PLANNED_CHANGE` plus Work Kind.
  - `FEATURE` remains valid as a Work Kind only when it means new or enhanced functionality.
- Execution policy matrix:
  - FEATURE Plans may omit `executionAgent`; omission defaults to `engineer` for backward compatibility.
  - FEATURE Plans may set `executionAgent: "engineer"` with `collaborationRecommendation: "autonomous"` or omitted.
    `pair` is invalid for Engineer-owned execution.
  - FEATURE Plans may set `executionAgent: "frontend-engineer"` with `collaborationRecommendation: "autonomous"` or
    `"pair"`.
  - Use `frontend-engineer` for browser-rendered UI work whose primary outcome is materially visual or interactive;
    otherwise use `engineer` (including TUI work and incidental frontend-file edits).
  - Recommend `pair` only when live visual judgment is valuable; use `autonomous` otherwise. Include known dev-server
    hints and exact headed-browser checks. Real-browser verification is mandatory for Frontend Engineer unless
    externally blocked.
  - PROJECT Epics are non-executable containers and must not define `executionAgent` or `collaborationRecommendation`;
    execution policy belongs only on child FEATURE Plans.
  - Legacy `frontend: true` on FEATURE Plans is still accepted as Frontend Engineer/autonomous compatibility metadata,
    but new Plans should use canonical `executionAgent` / `collaborationRecommendation` instead. Legacy
    `frontend: false` remains Engineer compatibility metadata and is distinct from an absent canonical owner.

## Edge Cases & Considerations

- The word `FEATURE` must not be globally replaced. It remains a valid Work Kind and appears in historical docs/tests.
  Replace only workflow/classification uses or display them via compatibility labels.
- Existing Plans and Work Records should not be bulk rewritten. Read-time normalization and new-artifact serialization
  are safer and preserve historical artifacts.
- Legacy `classification: FEATURE` must not imply `workKind: FEATURE`; absent Work Kind displays as neutral Planned
  Change.
- Work Record scope migration is a compatibility risk because existing records and tests use `scope: feature`. Implement
  read/display compatibility before changing generation defaults.
- Agent prompts and tool descriptions matter as much as code branches; Router will keep emitting confusing labels if its
  instructions still say FEATURE.
- The current Plan format template still uses `classification: FEATURE`. Update runtime compatibility first, then update
  templates so future Plans can include `classification: PLANNED_CHANGE` and `workKind` safely.
- Some internal names such as `isChildFeaturePlan` may be high-churn to rename immediately. It is acceptable to keep
  legacy function names temporarily if behavior and user-facing text are corrected, but add new planned-change helper
  names for new code.
- The worktree currently contains unrelated dirty files. Implementation should avoid overwriting unrelated modified
  Plans or source files except those required by this approved Plan and should inspect `git status` before edits.
