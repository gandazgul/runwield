---
classification: "PLANNED_CHANGE"
workKind: "REFACTOR"
complexity: "MEDIUM"
summary: "Remove affectedPaths from the triage_report tool contract and Router prompt; downstream agents discover paths themselves"
affectedPaths:
    - "src/tools/triage-report.ts"
    - "src/shared/workflow/orchestrator.ts"
    - "src/agent-definitions/router.md"
    - "src/agent-definitions/operator.md"
    - "CONTEXT.md"
    - "docs/index.md"
    - "docs/prd/runwield-core-prd.md"
    - "src/tools/__tests__/triage-report.test.js"
    - "src/shared/workflow/orchestrator.test.ts"
    - "src/shared/session/agent-handler.test.ts"
    - "src/ui/tui/golden-scenarios/initial-scenarios.js"
    - "src/ui/tui/golden-scenarios/role-journeys.js"
objectiveChecks:
    - id: "OC1"
      command: "! grep -q \"affectedPaths\" src/tools/triage-report.ts"
      rationale: "The triage_report PARAMETERS schema, TriageReportDetails interface, and triage_reported metric must no longer reference affectedPaths; all three contain it today."
    - id: "OC2"
      command: "! grep -qiE \"affectedPaths|vertical slice\" src/agent-definitions/router.md"
      rationale: "Router prompt step 7 currently requires an ordered affectedPaths list and step 6 instructs identifying the vertical slice; both mentions exist today."
    - id: "OC3"
      command: "! grep -q \"affectedPaths\" src/shared/workflow/orchestrator.ts"
      rationale: "TriageOutcome/TriageOutcomeInput declare affectedPaths and normalizeTriageOutcome hard-requires Array.isArray(details.affectedPaths) today; the removal must update all four occurrences or triage dispatch breaks."
    - id: "OC4"
      command: "! grep -q \"affectedPaths\" docs/prd/runwield-core-prd.md"
      rationale: "The living PRD documents affectedPaths as a triage_report parameter (line ~97) today."
    - id: "OC5"
      command: "! grep -q \"summary, affected paths\" CONTEXT.md"
      rationale: "CONTEXT.md's Triage Report definition currently lists affected paths among its contents."
    - id: "OC6"
      command: "! grep -q \"summary, affected paths\" src/agent-definitions/operator.md"
      rationale: "operator.md's Router-handoff input description currently lists affected paths."
    - id: "OC7"
      command: "! grep -q \"complexity and affected paths\" docs/index.md"
      rationale: "docs/index.md currently says implementation intents record complexity and affected paths."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-04T21:38:25-04:00"
updatedAt: "2026-08-05T01:41:44.477Z"
status: "ready_for_work"
origin: "internal"
userVerifiedAt: null
routingIntent: "PLANNED_CHANGE"
sessionName: "remove triage affected paths"
planId: "a4311ccc-d963-4f35-94cd-1c41f9a04733"
---

# Remove affectedPaths from triage_report

## Context

The Router's `triage_report` tool requires an ordered `affectedPaths` vertical-slice list, and
`src/agent-definitions/router.md` instructs the Router to explore enough to produce it before routing. The user reports
that nothing consumes the triage-collected paths and that the instruction invites the Router to get distracted with
exploration instead of calling `triage_report` promptly. The dispatched agents (Guide, Ideator, Operator, Engineer,
Planner, Architect) do their own discovery and do not need the Router to pre-collect a file list.

Read-only exploration confirms the triage-supplied `affectedPaths` is only:

1. rendered into the handoff prompt via `buildTriageReport` (`- Affected paths: ...` line), and
2. recorded in workflow metrics (`affectedPaths` / `affectedPathCount` keys on the `triage_reported` event).

Crucially, Plan front matter `affectedPaths` is a **separate, live field**: it is written by the Planner/Architect
through `plan_written`, persisted by `plan-store.js`, used by the Slicer for child materialization, and rendered into
planned-execution prompts. It stays fully intact.

## Objective

Remove `affectedPaths` from the triage tool contract end to end — tool schema, tool details, outcome normalization,
Router/Operator prompt language, and docs — while preserving Plan front matter `affectedPaths` and every other triage
behavior (six-intent dispatch, session naming, legacy `FEATURE` normalization, Work Kind preservation).

## Approach

Straight removal with one critical dependency ordered first: `normalizeTriageOutcome` in
`src/shared/workflow/orchestrator.ts` currently hard-requires `Array.isArray(details.affectedPaths)` or it returns
`null`, which would break every triage dispatch once the tool stops emitting the field. The tool schema change and the
orchestrator normalization change must land together.

`buildTriageReport` in `src/shared/workflow/workflow-prompts.js` is **intentionally unchanged**: it renders
`- Affected paths:` only when its input carries `affectedPaths`, and its planned-execution callers pass Plan front
matter attrs (which keep the field): `buildEngineerRequest` (`workflow-prompts.js:276`), plan resume
(`src/cmd/load-plan/plan-presentation.ts`), and Epic child resume (`src/shared/workflow/epic-continuation.ts:174`). Once
`TriageOutcome` drops the field, the Router-sourced call site (`orchestrator.ts:312`) simply renders nothing. Same for
`buildSlicerRequest`'s `triageMeta.affectedPaths` render.

## Files to Modify

- `src/tools/triage-report.ts` — remove the `affectedPaths` property from `PARAMETERS`, the field from the exported
  `TriageReportDetails` interface, the copy in `normalizeTriageParams`, and the `affectedPaths`/`affectedPathCount` keys
  from the `triage_reported` metric details.
- `src/shared/workflow/orchestrator.ts` — remove `affectedPaths` from `TriageOutcome` and `TriageOutcomeInput`; change
  `normalizeTriageOutcome` validation from
  `if (!details.complexity || !details.summary || !Array.isArray(details.affectedPaths)) return null;` to
  `if (!details.complexity || !details.summary) return null;` and drop `affectedPaths` from the constructed outcome.
- `src/agent-definitions/router.md` — routing process step 7 calls `triage_report` with `routingIntent`, `complexity`,
  `summary`, `sessionName` only; step 6 no longer instructs identifying "the vertical slice of code that will be
  affected" (scope assessment is already covered by step 5's "how many files are truly impacted"); no remaining mention
  of `affectedPaths` or "vertical slice".
- `src/agent-definitions/operator.md` — the "Your Inputs" Router-handoff description no longer lists affected paths.
- `CONTEXT.md` — domain language follows the behavior in the same change: the **Triage Report** definition drops
  "affected paths"; **Affected Paths** is redefined as the ordered set of files a Plan's front matter lists as expected
  to change (no longer "identified during Triage"); the stable-relationship lines are updated so a Triage Report
  contains routing intent, complexity, and summary (the "zero or more Affected Paths" relationship and the
  Empty-Project-Directory note about Triage are removed or re-anchored to Plans).
- `docs/index.md` — Router usage paragraph no longer says implementation intents "record complexity and affected paths".
- `docs/prd/runwield-core-prd.md` — the `triage_report` parameter list drops the `affectedPaths` line (line ~97).
- `src/tools/__tests__/triage-report.test.js` — remove `affectedPaths` from all `execute()` params; the INQUIRY test's
  `assertEquals(result.details, params)` stays valid because both sides lose the field.
- `src/shared/workflow/orchestrator.test.ts` — remove `affectedPaths` from `triageToolResult` fixtures and expected
  outcomes; add a regression test that `readLatestTriageOutcome` normalizes a report **without** `affectedPaths` (this
  exact input returns `null` today).
- `src/shared/session/agent-handler.test.ts` — remove `affectedPaths` from the mocked `triage_report` tool call.
- `src/ui/tui/golden-scenarios/initial-scenarios.js` — remove `affectedPaths` from the two mocked `triage_report`
  argument blocks (router-to-guide-inquiry ~line 135, protocol check ~line 313).
- `src/ui/tui/golden-scenarios/role-journeys.js` — remove `affectedPaths` from the mocked `triage_report` arguments
  (~line 28).

Explicitly **not** modified: `src/plan-store.js` and all Plan front matter `affectedPaths` fixtures (plan-store tests,
workflow-slicer, golden `plans/*.md` fixture text), `src/shared/workflow/workflow-slicer.ts`,
`src/agent-definitions/subagent-definitions/slicer-prompt.md`,
`src/agent-definitions/document-formats/{planner,architect}-plan-format.md`, `src/shared/workflow/workflow-prompts.js`
(`buildTriageReport`/`buildSlicerRequest` renders kept for Plan-attrs callers), `src/shared/workflow/metrics.js`
(sanitizer preserves Plan-metric `affectedPaths`), `docs/plan-lifecycle.md`, `docs/product-rules.md`.

## Reuse Opportunities

- `src/shared/workflow/workflow-prompts.js` — `buildTriageReport` already tolerates a missing `affectedPaths`
  (`Array.isArray` guard); no wrapper or fork needed.
- `src/testing/workflow-metrics-fixture.ts` (`withWorkflowMetricsFixture`) — existing harness for the triage metric
  assertions; update assertions in place rather than adding new fixtures.

## Implementation Steps

- [ ] `src/tools/triage-report.ts` contains zero occurrences of `affectedPaths`: the `PARAMETERS` schema, the
      `TriageReportDetails` interface, `normalizeTriageParams`, and the `triage_reported` metric details all omit it.
- [ ] `src/shared/workflow/orchestrator.ts` contains zero occurrences of `affectedPaths`: `TriageOutcome` and
      `TriageOutcomeInput` declare no such field, `normalizeTriageOutcome` validates only
      `complexity`/`summary`/`routingIntent`, and the constructed outcome carries no `affectedPaths`.
- [ ] `src/agent-definitions/router.md` contains no occurrence of `affectedPaths` and no occurrence of the phrase
      "vertical slice"; routing process step 7 lists exactly `routingIntent`, `complexity`, `summary`, `sessionName`.
- [ ] `src/agent-definitions/operator.md` no longer lists affected paths among the Router-handoff inputs.
- [ ] `CONTEXT.md` is updated in the same change: the **Triage Report** definition lists routing intent, complexity,
      summary, and optional Session Name only; **Affected Paths** is defined as Plan front matter metadata; the
      stable-relationship bullets no longer claim a Triage Report contains Affected Paths.
- [ ] `docs/index.md` and `docs/prd/runwield-core-prd.md` describe `triage_report` without an `affectedPaths` parameter.
- [ ] `src/shared/workflow/orchestrator.test.ts` includes a test asserting `readLatestTriageOutcome` returns a
      normalized outcome for a `triage_report` result that has no `affectedPaths` field, and no fixture or expectation
      in `src/tools/__tests__/triage-report.test.js`, `src/shared/workflow/orchestrator.test.ts`, or
      `src/shared/session/agent-handler.test.ts` passes `affectedPaths` to `triage_report`.
- [ ] The Golden TUI mocks in `src/ui/tui/golden-scenarios/initial-scenarios.js` and
      `src/ui/tui/golden-scenarios/role-journeys.js` pass `triage_report` arguments without `affectedPaths`, while
      `affectedPaths: []` in Golden `plans/*.md` front matter fixture text remains untouched.
- [ ] `deno task test` is green, including the Golden TUI scenarios and the workflow/orchestrator suites.

## Verification Plan

- Automated: `deno task test` from the repository root (never `deno test` directly);
  `deno check
  src/tools/triage-report.ts src/shared/workflow/orchestrator.ts src/shared/session/agent-handler.ts`.
- Manual: run `wld "how does routing pick an agent?"` in a scratch project — the Router calls `triage_report`
  successfully without `affectedPaths`, the TUI shows the Routing Intent status line, and Guide is dispatched. Repeat
  with a small code-fix request to confirm QUICK_FIX → Engineer dispatch still works end to end.
- Expected results: all six routing dispatches work; session auto-naming from `sessionName` still applies; legacy
  `classification: "FEATURE"` still normalizes to `PLANNED_CHANGE`; `workKind` is still preserved only for
  PLANNED_CHANGE outcomes.
- Protected behavior that must survive this reshape: planned-execution prompts built from Plan front matter still render
  `- Affected paths:` — `buildEngineerRequest`, plan resume (`plan-presentation.ts`), and Epic child resume
  (`epic-continuation.ts`) are unchanged, and `workflow-prompts.test.js`'s "buildTriageReport preserves the Router's
  structured context" test must remain green **unmodified**; Plan front matter `affectedPaths` parsing/writing in
  `plan-store.js` and Slicer child materialization are untouched; `metrics.js` sanitizer behavior is unchanged.
- Behavior expected to stop existing: the `- Affected paths:` line in Router-sourced triage handoff blocks; the
  `affectedPaths`/`affectedPathCount` keys in `triage_reported` metric details; the Router's instruction to collect an
  ordered path list.
- Glossary check: after the change, `CONTEXT.md` describes the implemented behavior — Triage Reports carry no Affected
  Paths, and the Affected Paths term refers to Plan front matter only.

### Objective-Failing Checks

- `OC1` — `! grep -q "affectedPaths" src/tools/triage-report.ts` — the tool schema, details type, and metric no longer
  reference the field.
- `OC2` — `! grep -qiE "affectedPaths|vertical slice" src/agent-definitions/router.md` — the Router prompt no longer
  instructs collecting an ordered path list.
- `OC3` — `! grep -q "affectedPaths" src/shared/workflow/orchestrator.ts` — outcome normalization no longer requires or
  carries the field.
- `OC4` — `! grep -q "affectedPaths" docs/prd/runwield-core-prd.md` — the living PRD's `triage_report` parameter list is
  updated.
- `OC5` — `! grep -q "summary, affected paths" CONTEXT.md` — the Triage Report glossary definition is updated.
- `OC6` — `! grep -q "summary, affected paths" src/agent-definitions/operator.md` — the Operator handoff description is
  updated.
- `OC7` — `! grep -q "complexity and affected paths" docs/index.md` — the Router usage docs are updated.

## Edge Cases & Considerations

- **Legacy session JSONLs**: resumed sessions may contain old `triage_report` tool results that include `affectedPaths`.
  After the change, `normalizeTriageOutcome` reads only the fields it needs, so extra legacy keys are ignored at runtime
  — no data migration needed. The new regression test covers the forward path (reports without the field normalize
  correctly).
- **Golden scenario harness**: the mocks script `triage_report` tool calls; the harness must not receive argument keys
  the live schema no longer declares. Removing the field from the three mock sites keeps the Golden TUI suite faithful.
- **Decision recorded (reviewable)**: Plan front matter `affectedPaths` stays, and `buildTriageReport` keeps its render
  for Plan-attrs callers. If the user later wants the planned-execution prompts to drop the line too, that is a
  separate, equally small change.
- **Decision recorded (reviewable)**: `CONTEXT.md`'s **Affected Paths** term is redefined as Plan metadata rather than
  deleted, because the Slicer and plan formats still produce and consume the front matter field.
- **No seam changes**: this plan adds no injection seams; `deno task seams:check` (part of `deno task ci`) is
  unaffected.
