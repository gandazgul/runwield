---
planId: "42910b23-b1a5-46f6-9312-0562840f5890"
classification: "FEATURE"
complexity: "LOW"
summary: "Implement a new command or flag to archive all plans with 'verified' status. This involves adding a bulk archival operation in `src/plan-store.js` and exposing it via `src/cmd/plans/archive.js`."
affectedPaths:
    - "src/cmd/plans/archive.js"
    - "src/plan-store.js"
frontend: false
createdAt: "2026-07-04T23:29:50-04:00"
updatedAt: "2026-07-17T04:41:28.487Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-05T04:03:31.628Z"
verifiedAt: "2026-07-05T04:12:50.650Z"
workRecord:
    status: "generated"
    recordId: "1b9dd2d0-7eb9-4335-a35a-7b36f6ece4d4"
    path: "docs/work-records/2026-07-17-bulk-archive-verified-plans.md"
    lastAttemptAt: "2026-07-17T04:41:20.973Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
archivedAt: "2026-07-05T04:13:26.531Z"
archivedFromStatus: "verified"
archivedFromPath: "plans/archive-all-verified-plans.md"
routingIntent: "FEATURE"
sessionName: "archive verified plans"
---

# Archive All Verified Plans

## Context

The existing Plan archival flow supports archiving one active Plan at a time with `wld plans archive <plan-name-or-id>`.
Archived Plans are moved under `plans/archived/`, hidden from normal `wld plans` listings, and can be restored later.
Current policy already allows `verified` Plans to archive without `--force`; this feature adds a bulk path for the
common cleanup request: archive every active Plan that is already verified.

Important existing decisions to preserve:

- `wld plans archive` with no target lists archived Plans.
- Single-plan archival continues to support `verified` and `closed_without_verification` by default; other statuses
  require `--force`.
- Recoverable worktree states (`active`, `execution_failed`, `validation_failed`, `merge_conflict`) remain blocked.
- Archived markdown stays plaintext and reversible under `plans/archived/`.

User-confirmed product decisions:

- Public CLI shape: `wld plans archive --all --status verified [--reason <text>]` rather than a dedicated
  `--all-verified` flag.
- Failure mode: best effort. The command should archive Plans that can be archived safely and report Plans that were
  blocked.

Planner assumption for review: if best-effort bulk archival has any failures, the CLI should still print the
success/failure summary but finish with a thrown error/non-zero exit so scripts can detect partial completion.

## Objective

Add a safe, documented bulk archive command that moves all active verified Plans to `plans/archived/` while preserving
the existing metadata behavior and single-plan command behavior.

## Approach

Implement a plan-store bulk helper that discovers active Plans by exact lifecycle status using `listPlans(cwd)`,
archives each matching Plan independently, and records both successes and failures. Expose the verified cleanup path
through `wld plans archive --all --status verified` so the existing no-argument archive listing remains unchanged and
future status-filtered bulk archival has an obvious extension point.

The bulk operation should be conservative and transparent:

- Only include active non-archived Plans returned by `listPlans(cwd)`.
- For this feature’s main path, include Plans whose normalized `attrs.status` is exactly `verified`.
- Require `--status <status>` whenever `--all` is used; do not let `--all` archive every active Plan accidentally.
- Validate `--status` against known Plan lifecycle statuses so typos fail clearly instead of silently no-oping.
- Preserve the existing archive policy per Plan: `verified` and `closed_without_verification` are allowed by default;
  other statuses require `--force`; recoverable worktree states stay blocked.
- Continue after a matching Plan fails, so safe Plans are still archived.
- Return structured success and failure entries so the CLI can print a clear summary.

## Files to Modify

- `src/plan-store.js` — add and export a bulk helper such as `archivePlansByStatus(cwd, status, options)`, reusing
  existing single-plan archival behavior for each matching Plan.
- `src/plan-store.test.js` — add filesystem tests for bulk verified archival, no-op behavior, metadata, nested plan
  handling, and best-effort failure reporting.
- `src/cmd/plans/archive.js` — parse `--all` and `--status`, call the new helper, print a clear summary, and reject
  incompatible usage.
- `src/cmd/plans/archive.test.js` — add CLI tests for the new flags, summary output, no-op output, partial-failure
  reporting, and invalid argument combinations.
- `src/cmd/registry.js` — update command usage/help notes to include the new bulk archival flags.
- `README.md` — document the bulk command in the saved Plans and archive examples.
- `docs/adr/008-plan-archival-and-retrieval.md` — record the follow-up command surface decision without rewriting the
  original v1 history.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.js` `listPlans(cwd)` — source of active non-archived Plans; already hides `plans/archived/`.
- `src/plan-store.js` `archivePlan(cwd, planNameOrId, options)` — existing single-plan archival semantics and metadata
  behavior; best-effort bulk archival can call this per matching plan.
- `src/plan-store.js` `TERMINAL_ARCHIVABLE_STATUSES`, `RECOVERABLE_WORKTREE_STATUSES`, `getArchivedPlanLocation`, and
  `fileExists` — existing validation policy if implementation chooses to factor out richer preflight/failure details.
- `src/cmd/plans/archive.js` current `parseArgs`, dependency injection, and console-output style.
- Existing tests in `src/plan-store.test.js` and `src/cmd/plans/archive.test.js` for test structure and temporary
  filesystem setup.

## Implementation Steps

- [ ] Step 1: In `src/plan-store.js`, introduce an exported bulk helper and JSDoc typedefs, e.g.
      `archivePlansByStatus(cwd, status, options = {})` returning `{ matched, archived, failed }` arrays/counts.
- [ ] Step 2: Validate the requested status against the known Plan lifecycle status set, then collect
      `listPlans(cwd).filter(plan => plan.attrs.status === status)`, sorted by canonical plan name, and return an empty
      success result when there are no matching active Plans.
- [ ] Step 3: For each matching Plan, call `archivePlan(cwd, plan.name, { reason, force, now })` inside a try/catch;
      push success entries with `name` and `relativePath`, and failure entries with `name`, source `relativePath`, and
      message.
- [ ] Step 4: Use one shared `now` timestamp for all attempted archives in a single bulk run so successful Plans have
      consistent archive metadata and tests are deterministic.
- [ ] Step 5: Preserve existing single-plan policy through `archivePlan`: verified Plans archive without `--force`;
      non-terminal statuses only archive in bulk when `--force` is provided; recoverable worktree states and destination
      collisions are reported as failures.
- [ ] Step 6: In `src/cmd/plans/archive.js`, add `all` as a boolean parse flag and `status` as a string parse flag, wire
      the bulk helper through dependency injection, and invoke it when `--all` is present.
- [ ] Step 7: Reject invalid command combinations with helpful errors: `--all` without `--status`, `--status` without
      `--all`, `--all` with a positional plan target, and `restore ... --all`/`restore ... --status`.
- [ ] Step 8: Print user-friendly bulk output: a no-op message when no active Plans match, archived paths for successes,
      failure lines for blocked Plans, and a final summary count.
- [ ] Step 9: If one or more matching Plans failed, throw an error after printing the summary so the process exits
      non-zero while still preserving best-effort successful archives.
- [ ] Step 10: Update help/README/ADR documentation to include
      `wld plans archive --all --status verified [--reason <text>]` and clarify the command archives matching active
      Plans by exact status.
- [ ] Step 11: Add/update tests for store helper and CLI behavior.

## Verification Plan

- Automated: `deno test src/plan-store.test.js src/cmd/plans/archive.test.js src/cmd/plans/index.test.js`
- Automated: `deno run ci`
- Manual: In a temporary fixture or disposable repo state, create multiple active Plans with statuses `verified`,
  `draft`, and `closed_without_verification`; run `wld plans archive --all --status verified --reason "done"`; confirm
  only the verified Plans move under `plans/archived/` and `wld plans` no longer lists them.
- Manual: Run `wld plans archive --all --status verified` when there are no active verified Plans; confirm it exits
  successfully with a clear no-op message.
- Manual: Create two verified Plans where one has a destination collision under `plans/archived/`; run the bulk command
  and confirm the safe Plan archives, the blocked Plan remains active, failures are printed, and the command exits
  non-zero.

## Edge Cases & Considerations

- Bulk archival must not accidentally change the no-argument archive-list behavior.
- Use pure JavaScript with JSDoc typedefs; do not introduce TypeScript syntax.
- The command should archive child FEATURE Plans and top-level Plans alike when their own status matches the requested
  status.
- Existing archived Plans are excluded because `listPlans(cwd)` hides `plans/archived/`.
- `closed_without_verification` remains archivable one-at-a-time by existing policy and can naturally work with
  `--all --status closed_without_verification`; the requested/manual verification path should focus on
  `--status verified`.
- Best-effort behavior means a bulk run may leave a partially cleaned plan set by design; the printed summary and
  non-zero partial-failure exit are the safety signal.
