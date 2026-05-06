---
classification: "FEATURE"
complexity: "LOW"
summary: "Improve robustness of task extraction by enforcing structured data in the 'plan_written' tool and relaxing the fallback regex parser. This prevents failures caused by LLM formatting inconsistencies in Markdown tables."
affectedPaths:
    - "src/tools/plan-written.js"
    - "src/shared/workflow/workflow.js"
createdAt: "2026-05-05T00:00:00Z"
updatedAt: "2026-05-06T03:00:07.554Z"
status: "in_review"
origin: "internal"
---

# Harden PROJECT Task Extraction and plan_written Contract

## Context

`extractTasks` currently relies on a strict table-row regex in `src/shared/workflow/workflow.js`. Minor markdown drift
(missing trailing pipe, whitespace variation, slightly different cell formatting) can cause fallback parsing to fail.
The system already supports structured `tasks` via `plan_written`, so task extraction should prioritize structured data
and reduce fragility in markdown fallback behavior.

## Objective

Reduce execution-time failures for PROJECT plans by (1) enforcing presence of structured `tasks` when PROJECT plans are
declared and (2) relaxing fallback markdown row parsing just enough to tolerate common LLM formatting deviations.

## Approach

Keep the `plan_written` schema compatible, but add explicit workflow validation: if classification is `PROJECT`, a
`plan_written` declaration without a non-empty `tasks` array is treated as invalid and the planning loop fails with a
clear error. Keep markdown extraction as a safety net, but make row parsing modestly more tolerant (not a full parser
rewrite) to reduce false negatives.

## Files to Modify

- `src/shared/workflow/workflow.js` — enforce PROJECT-only `tasks` presence from `plan_written` details and relax
  fallback regex behavior in `extractTasks`.
- `src/shared/workflow/workflow_test.js` — add tests for PROJECT validation behavior and/or fallback parsing tolerance.
- `src/cmd/router/triage.js` (optional/minor) — only if extraction helper needs small adjustments for clearer validation
  signaling.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/cmd/router/triage.js` (`extractPlanWritten`) — continue using extracted `details.tasks` as the primary source.
- `src/shared/workflow/workflow.js` (`extractTasks`) — reuse existing section-scoping logic for `### Tasks`, only relax
  row parsing behavior.
- Existing tool test patterns in `src/tools/__tests__/` — mirror existing metadata/execute test style for contract
  changes.

## Implementation Steps

- [ ] Step 1: In `src/shared/workflow/workflow.js`, enforce PROJECT-only validation so missing/empty
      `plan_written.tasks` is rejected early with actionable error text.
- [ ] Step 2: Keep non-PROJECT behavior unchanged so non-PROJECT plans are not forced to send tasks.
- [ ] Step 3: Relax fallback parsing in `extractTasks` (`src/shared/workflow/workflow.js`) to handle common table
      formatting drift (e.g., optional trailing pipe, extra whitespace, slightly looser cell matching).
- [ ] Step 4: Add/update tests in `src/shared/workflow/workflow_test.js` (and related tests if needed) to verify PROJECT
      validation and tolerant fallback parsing.
- [ ] Step 5: Confirm PROJECT execution still prioritizes structured tasks first, using markdown parsing only as
      fallback.

## Verification Plan

- Automated: run targeted tests for modified areas, then full suite command:
  - `deno test src/shared/workflow/workflow_test.js`
  - `deno run ci`
- Manual: validate a PROJECT planning flow where `plan_written` includes `tasks`, and a fallback case with slightly
  malformed markdown table rows still yields extracted tasks.
- Expected results for key scenarios:
  - PROJECT plan declarations without `tasks` are rejected with clear guidance.
  - Non-PROJECT plan declarations are unaffected.
  - Valid structured `tasks` continue to bypass markdown fragility concerns.
  - Fallback parser accepts minor markdown deviations that previously failed.

## Edge Cases & Considerations

- Backward compatibility: older planner behavior that omits `tasks` for PROJECT plans will now fail fast at workflow
  validation and require correction.
- Data quality: relaxed fallback parser should remain strict enough to avoid mis-parsing non-task lines.
- Assumption: PROJECT-only enforcement is sufficient; schema-level global requirement is intentionally avoided to keep
  non-PROJECT flows unchanged.
