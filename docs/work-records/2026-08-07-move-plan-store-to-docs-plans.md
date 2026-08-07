---
kind: "work_record"
recordId: "a264cc8a-3960-42b6-95d6-ef1116da79bc"
status: "approved"
scope: "planned_change"
workKind: "MAINTENANCE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-07T03:49:13.639Z"
provenance:
    sourcePlans:
        - "cef05b40-ce1e-49db-b065-1a2054b3d8e8"
---

# Move Plan Store to docs/plans

## Summary

RunWield now uses `docs/plans/` as the only canonical Plan store. Runtime code, tools, CLI flows, TUI and workflow
surfaces, docs, release guidance, scripts, tests, and tracked Plan files were updated for the clean break. Legacy
`plans/` files are ignored, and no tracked Plan Markdown remains under `plans/`. Workflow Validation passed, including
targeted tests, `deno task test`, and `deno task ci`.

## Deviations from Plan

Implementation also fixed a discovered `plans doctor` root/path bug so active Plans under `docs/plans/` do not
false-report `plan_not_found`.

## Future Planning Notes

Clean-break storage moves need explicit negative tests for the old path and objective filesystem checks, not only
rewritten positive path assertions.

## Execution Report

- Implemented clean-break Plan store move to `docs/plans/` across runtime code, tools, CLI flows, TUI/workflow surfaces,
  docs, release guidance, scripts, and tracked Plan files; no tracked `plans/**/*.md` remain.
- Fixed discovered `plans doctor` root/path bug by passing the project root explicitly into recursive Plan issue
  collection, so active Plans under `docs/plans/` no longer false-report `plan_not_found`.
- Added regression coverage: `src/plan-store.test.js` verifies legacy `plans/` files are ignored;
  `src/tools/__tests__/plan-written.test.js` verifies `plan_written` rejects legacy-only `plans/<name>.md` and accepts
  `docs/plans/<name>.md`.
- Test changes: +2 automated tests total; no tests removed. Existing path/assertion tests were rewritten to the new
  `docs/plans/` store shape; legacy behavior coverage remains only where it proves old `plans/` is ignored or treated as
  implementation diff.
- Verification passed: targeted `deno run -A scripts/run-tests.js ...` suite passed `293 passed | 0 failed`;
  `deno task test` passed `247 files passed | 0 failed`; `deno task ci` passed fully.
- Objective checks passed: `getStoredPlanPath("/project", "demo")` returned `/project/docs/plans/demo.md`;
  `git ls-files 'plans/*.md' 'plans/**/*.md'` returned empty; final grep left only intentional legacy regression text.
