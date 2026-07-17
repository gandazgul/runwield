---
planId: "cd648640-2ad9-464f-9108-1945d4630fcf"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Implement first-class Plan archival using the existing plans/archived convention, with safe move/restore commands and lightweight filter/search over archived Plans."
affectedPaths:
    - "docs/adr/008-plan-archival-and-retrieval.md"
    - "docs/plan-lifecycle.md"
    - "src/plan-store.js"
    - "src/plan-store.test.js"
    - "src/cmd/plans/index.js"
    - "src/cmd/plans/index.test.js"
    - "src/cmd/plans/archive.js"
    - "README.md"
createdAt: "2026-06-24T14:15:10-04:00"
updatedAt: "2026-07-17T04:48:09.184Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-07-01T04:04:49.744Z"
workRecord:
    status: "generated"
    recordId: "678a0125-9a62-4686-9dc4-3e4b0a10319d"
    path: "docs/work-records/2026-07-17-implemented-first-class-plan-archival-and-retrieval.md"
    lastAttemptAt: "2026-07-17T04:47:59.602Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
---

# Plan Archival and Retrieval

## Context

Completed, closed, abandoned, or stale Plans should stop crowding active Plan workflows while remaining available as
plain-text project history. The current repo already has the right convention: top-level `plans/archived/` is hidden by
`src/plan-store.js:listPlans()`, while explicit loads by archived path still work. This feature turns that convention
into first-class, safe APIs and CLI commands.

Current constraints and decisions that this plan must preserve:

- Archive location is `plans/archived/`, not `.hns/plans/archive/`.
- Archival is a physical storage/visibility concern, not a Plan Status. Do not add an `archived` lifecycle status.
- Do not add LanceDB/FTS or a CLI archive search in this slice. Archived Plan discovery starts with a plain archive
  list; richer search can be added later to the UI/search surface.
- Do not patch a non-existent `src/tools/find.js`, and do not blanket-hide `plans/archived/` from grep/find-style tools.
  Historical context should remain available when explicitly requested.
- Do not run an automatic boot sweep from `src/cli.js`. Age-based auto-moving is risky with worktree/recovery state,
  Epic/child relationships, `on_hold`, and manual closure semantics.
- ADR number `007` is already used by the local-first Workspace Plan Board; this feature should create ADR `008`.
- Product decision from clarification: `verified` and `closed_without_verification` can be archived without `--force`.
  Other statuses require `--force`, and recoverable worktree states remain guarded.

Ordering against `plans/local-first-plan-management-ui.md`: implement this archival feature before new Plan UI archive
controls if that UI is not actively being merged, because it establishes the canonical plan-store APIs. If another
worktree/branch already touches `src/plan-store.js` or `src/cmd/plans/index.js` for Plan UI work, coordinate/merge
first.

## Objective

Build first-class, local-file Plan archival around `plans/archived/`:

- Archive active Plans into `plans/archived/` while preserving relative names and markdown readability.
- Keep `wld plans` focused on active Plans using the existing hidden-archive behavior.
- Let users list archived Plans, archive a Plan with a short command, restore archived Plans, and read either active or
  archived Plans without introducing a database.
- Record archive/restore metadata in Front Matter without changing the Plan's durable lifecycle status.
- Preserve compatibility with future local-first Plan UI APIs by centralizing archive operations in `src/plan-store.js`.

## Approach

Add archive primitives to `src/plan-store.js` and expose them through a `wld plans archive ...` subcommand module. Treat
the archive directory as a physical location. The Plan's last real status remains meaningful (`verified`,
`closed_without_verification`, `implemented`, `draft`, etc.), while archive metadata explains why and when it was moved.

Recommended command surface:

- `wld plans archive` — list archived Plans.
- `wld plans archive <plan-name-or-id> [--reason <text>] [--force]` — archive an active Plan at
  `plans/archived/<plan-name>.md`.
- `wld plans archive restore <archived-plan-name-or-id> [--to <plan-name>]` — restore an archived Plan back into active
  `plans/`.
- `wld plans read <plan-name-or-id>` — print one active or archived Plan's path, metadata, and body for inspection.

Do not add `wld plans archive move`, `wld plans archive list`, `wld plans archive search`, or `wld plans archive read`
aliases in this slice. The short `archive` form archives the target when an argument is provided and lists the archive
when no argument is provided.

Safety rules:

- Preserve nested names: `plans/my-epic/01-child.md` archives to `plans/archived/my-epic/01-child.md`.
- Refuse to overwrite an existing archive or active restored file. Do not add overwrite behavior in this slice.
- Archive `verified` and `closed_without_verification` Plans without `--force`.
- Require `--force` for other statuses, including `draft`, `feedback`, `approved`, `ready_for_decomposition`,
  `ready_for_work`, `in_progress`, `failed`, `implemented`, and `on_hold`.
- Even with `--force`, block Plans with recoverable worktree states (`active`, `execution_failed`, `validation_failed`,
  or `merge_conflict`) unless a future explicit abandon/cleanup flow changes that policy.
- Do not archive `on_hold` by default; on-hold means paused/resumable, not done or archived.
- Do not automatically modify child FEATURE Plans when archiving an Epic, or vice versa. Bulk Epic archival can be a
  later feature once UI/lifecycle semantics are settled.

## Files to Modify

- `docs/adr/008-plan-archival-and-retrieval.md` — create an ADR recording `plans/archived/` as the archive location,
  explicit/reversible commands, no boot sweep, no CLI archive search in this slice, and no one-off LanceDB archive
  index.
- `docs/plan-lifecycle.md` — add a short section distinguishing physical archival from Plan Status, `on_hold`,
  `verified`, and `closed_without_verification`.
- `src/plan-store.js` — add archive metadata fields, archive path helpers, active/archived plan-name-or-id resolvers,
  `archivePlan`, `listArchivedPlans`, `loadArchivedPlan`, and `restoreArchivedPlan` while reusing existing
  parsing/canonicalization.
- `src/plan-store.test.js` — cover archive/restore, nested paths, metadata preservation, active list hiding, archived
  listing, read/load behavior, overwrite refusal, forced non-terminal archival, terminal-status defaults, and
  worktree-state guards.
- `src/cmd/plans/index.js` — dispatch `archive` and `read` subcommands while preserving current bare `wld plans`
  behavior and existing `ui` delegation.
- `src/cmd/plans/index.test.js` — cover default listing compatibility, `archive`/`read` subcommand delegation, `ui`
  delegation, help text, and argument parsing.
- `src/cmd/plans/archive.js` — implement `wld plans archive`, `wld plans archive <plan-name-or-id>`, and
  `wld plans archive restore ...` with human-readable output/errors.
- `src/cmd/plans/archive.test.js` — add focused tests for archive command parsing, output, dependency injection, and
  plan-store helper calls.
- `src/cmd/plans/read.js` — implement `wld plans read <plan-name-or-id>` for active Plans and archived Plans.
- `src/cmd/plans/read.test.js` — cover read command resolution/output for active Plans, archived Plans, and ambiguous
  duplicate names.
- `src/cmd/registry.js` — update `plans` command usage/notes so `wld help plans` exposes archive and read commands.
- `README.md` — document the new archive commands briefly, especially that archives remain plaintext markdown under
  `plans/archived/` and can be restored.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.js` — reuse `getPlansDir`, `ensurePlansDir`, canonical stored Plan names, `loadPlan`, `findPlanById`,
  `parsePlanFrontMatter`, `injectFrontMatter`, `PLAN_FRONT_MATTER_KEYS`, `PLAN_FRONT_MATTER_KEY_ORDER`, and the existing
  top-level `HIDDEN_PLAN_DIRS` behavior.
- `src/plan-store.test.js` — extend the existing `listPlans hides archived plans` and Plan resource tests instead of
  creating a separate filesystem harness.
- `src/cmd/plans/index.js` — preserve the current Epic/child/standalone/orphan listing as the default command behavior
  and follow the existing `ui` delegation pattern for the new `archive` and `read` dispatchers.
- `src/cmd/registry.js` and `src/cmd/help/index.js` — command help is registry-driven, so update registry metadata
  rather than adding special help logic.
- `src/shared/workflow/plan-lifecycle.js` — use lifecycle terminology for safety checks, but do not add lifecycle
  statuses or events in this slice.
- `plans/archived/` — use the repo's existing archive convention and historical Plan examples as manual fixtures.

## Implementation Steps

- [ ] Step 1: Add archive metadata keys to `PLAN_FRONT_MATTER_KEYS`, `PLAN_FRONT_MATTER_KEY_ORDER`, `PlanFrontMatter`,
      `injectFrontMatter()`, and `parsePlanFrontMatter()` in `src/plan-store.js`: `archivedAt`, `archiveReason`,
      `archivedFromStatus`, `archivedFromPath`, `restoredAt`, and `restoredFromPath`.
- [ ] Step 2: Add path helpers and resolvers that accept a canonical Plan name or durable `planId`, resolve active Plan
      names and archived Plan names safely under `plans/` and `plans/archived/`, preserve nested relative paths, reject
      path traversal, and prevent using `archived/...` as an active source name for `archivePlan()`.
- [ ] Step 3: Implement `archivePlan(cwd, planNameOrId, options)` with safety validation, metadata injection,
      destination directory creation, no-overwrite behavior, and local rename/move semantics.
- [ ] Step 4: Implement `listArchivedPlans(cwd)` and `loadArchivedPlan(cwd, archivedPlanNameOrId)` as bounded filesystem
      scans/lookups over `plans/archived/` that return concise metadata and full content only when explicitly reading.
      `listArchivedPlans()` should include plan name/path/status/summary and `planId` when present so users can target
      restore/read commands.
- [ ] Step 5: Implement `restoreArchivedPlan(cwd, archivedPlanNameOrId, options)` to move a Plan back to active
      `plans/`, preserve body/front matter, add restore metadata, and refuse active-file overwrites.
- [ ] Step 6: Add `src/cmd/plans/archive.js` with list-on-no-args, archive-target-arg, and `restore` handlers, clear
      help text, parse-args dependency injection for tests, and clear error messages for blocked archival/missing Plans.
- [ ] Step 7: Add `src/cmd/plans/read.js` so `wld plans read <plan-name-or-id>` prints active or archived Plan content.
- [ ] Step 8: Update `src/cmd/plans/index.js` to dispatch `archive` and `read` before default list parsing while keeping
      bare `wld plans` output and existing `ui` behavior unchanged.
- [ ] Step 9: Update `src/cmd/registry.js` so `wld help plans` includes archive/read usage examples and notes.
- [ ] Step 10: Write/extend automated tests for plan-store archive helpers, read behavior, command parsing/output,
      default listing compatibility, archive hiding, and help metadata.
- [ ] Step 11: Add ADR/docs/README updates explaining the archive model and why v1 does not use a database, CLI archive
      search, or automatic age-based sweep.
- [ ] Step 12: Run full validation and fix issues.

## Verification Plan

- Automated: `deno task ci`
- Manual: Run `wld plans` and verify archived Plans do not appear in the active list.
- Manual: Archive a verified Plan with `wld plans archive <plan-name> --reason "done"`; verify the file moved to
  `plans/archived/<plan-name>.md` and Front Matter records archive metadata.
- Manual: Archive a `closed_without_verification` Plan without `--force`; verify it succeeds with archive metadata.
- Manual: Attempt to archive a draft/in-progress/failed Plan without `--force`; verify the command refuses with a clear
  reason.
- Manual: Attempt to archive a Plan with `worktreeStatus: active`, `execution_failed`, `validation_failed`, or
  `merge_conflict`; verify the command blocks and explains the recoverable worktree state.
- Manual: Use `wld plans archive` to list archived Plans.
- Manual: Use `wld plans read <plan-name>` for an active Plan and an archived Plan; verify it prints the correct path,
  metadata, and body.
- Manual: Restore an archived Plan with `wld plans archive restore <plan-name-or-id>` and verify it appears in
  `wld plans` again and no markdown body content changed.

## Edge Cases & Considerations

- Existing dirty files: implementation should not assume the archive directory is clean; refuse overwrites rather than
  silently replacing history.
- Nested child Plans: preserve path shape, but do not cascade archive/restore parent-child relationships automatically.
- Malformed Front Matter: archived listing and read should skip or degrade gracefully; archive/restore should avoid
  destroying body text and report parse issues clearly.
- Worktree recovery: active or failed worktree states should not be hidden by archival without an explicit user decision
  and a future abandon/cleanup policy.
- `closed_without_verification`: treat as a terminal user outcome for archive default eligibility, but do not imply
  Workflow Validation passed.
- Future Plan UI: expose archive operations through plan-store helpers so `wld plans ui` can reuse them later instead of
  inventing direct filesystem mutations.
- Future semantic search: archived Plan content can be indexed later by a unified search/UI system; do not add a
  dedicated LanceDB archive store or CLI archive search now.
- Read ambiguity: if active and archived Plans share the same name, `wld plans read <name>` should prefer the active
  Plan and print its path; users can still read the archived copy via an explicit archived name/path if supported by the
  implementation.
- Tool visibility: do not blanket-ignore `plans/archived/` in all grep/find-style tools. Prefer active Plan APIs for
  normal workflows and explicit archive listing/read commands when historical context is needed.
