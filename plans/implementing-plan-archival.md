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
updatedAt: "2026-06-24T18:18:57.646Z"
status: "draft"
origin: "internal"
---

# Plan Archival and Retrieval

## Context

The old archival plan still addresses a real problem: completed, abandoned, or stale Plans should stop crowding active
Plan workflows while remaining available as project history. However, several original assumptions are no longer
correct:

- The archive location should be `plans/archived/`, not `.hns/plans/archive/`. This convention already exists in the
  repo and `src/plan-store.js` already hides top-level `plans/archived` from `listPlans()`.
- Do not add LanceDB/FTS just for archived Plans. There is no current LanceDB integration in this checkout, and archived
  Plan search can start as a bounded filesystem scan over markdown/front matter. Future semantic search can index
  archived Plans through the broader search/indexing direction instead of creating a second one-off database.
- Do not patch a non-existent `src/tools/find.js`. The repo has a custom `grep` wrapper but no custom `find` wrapper.
  Blanket hiding archives from all code-search/file tools is also not desirable because agents sometimes need historical
  context explicitly.
- Do not run an automatic boot sweep from `src/cli.js`. Auto-moving Plans based on age is risky now that Plans can have
  worktree/recovery state, Epic/child relationships, and future `on_hold` semantics. Archival should start explicit and
  reversible.
- ADR number `007` is already used by the local-first Workspace Plan Board. This feature should create ADR `008` if an
  ADR is still warranted.

Ordering against `plans/local-first-plan-management-ui.md`: implement this archival feature **before** fresh Plan UI
work in the current checkout if that UI is not actively being merged, because it is smaller, establishes the canonical
archive APIs, and keeps the future board from inventing its own archive model. If the Plan UI implementation is already
active in another worktree/branch, merge or coordinate that work first because both efforts touch `src/plan-store.js`
and `src/cmd/plans/index.js`. Archival should not block the UI lifecycle work for `closed_without_verification` or
`on_hold`; this slice should default to archiving `verified` Plans and allow deliberate forced archival of other
non-recovery Plans.

## Objective

Build first-class, local-file Plan archival around `plans/archived/`:

- Move active Plans into `plans/archived/` while preserving relative names and markdown readability.
- Keep `wld plans` focused on active Plans using the existing hidden-archive behavior.
- Let users list, filter, search, read, and restore archived Plans without introducing a database.
- Record archive metadata in Front Matter without adding an `archived` Plan Status.
- Preserve compatibility with future local-first Plan UI APIs by centralizing archive operations in `src/plan-store.js`.

## Approach

Add archive primitives to `src/plan-store.js` and expose them through a `wld plans archive ...` subcommand module. Treat
the archive directory as a physical storage/visibility concern, not a lifecycle status. The Plan's last real status
remains meaningful (`verified`, `implemented`, `draft`, etc.), while new archive metadata explains why and when it was
moved.

Recommended command surface:

- `wld plans archive move <plan-name> [--reason <text>] [--force]` — move an active Plan to
  `plans/archived/<plan-name>.md`.
- `wld plans archive list [--status <status>] [--query <text>]` — list archived Plans with optional metadata filters.
- `wld plans archive search <query> [--limit <n>]` — bounded case-insensitive search over archived Plan summaries,
  affected paths, Front Matter, headings, and bodies.
- `wld plans archive read <archived-plan-name>` — print a specific archived Plan path/metadata/body for inspection.
- `wld plans archive restore <archived-plan-name> [--to <plan-name>]` — move an archived Plan back into active `plans/`.

Safety rules:

- Preserve nested names: `plans/my-epic/01-child.md` archives to `plans/archived/my-epic/01-child.md`.
- Refuse to overwrite an existing archive or active restored file unless an explicit overwrite option is later added.
- Archive `verified` Plans without `--force`.
- Require `--force` for non-terminal or ambiguous statuses, and block or strongly guard Plans with active/recoverable
  worktree state (`worktreeStatus: active`, `execution_failed`, `validation_failed`, or `merge_conflict`).
- Do not archive `on_hold` by default when that status exists; on-hold means paused/resumable, not done or archived.
- Do not automatically modify child FEATURE Plans when archiving an Epic, or vice versa. Bulk Epic archival can be a
  later feature once the UI/lifecycle semantics are settled.

## Files to Modify

- `docs/adr/008-plan-archival-and-retrieval.md` — create an ADR that records `plans/archived/` as the archive location,
  filesystem-backed search for v1, explicit/reversible commands, no boot sweep, and no one-off LanceDB archive index.
- `docs/plan-lifecycle.md` — add a short section distinguishing physical archival from Plan Status, `on_hold`,
  `verified`, and future `closed_without_verification`.
- `src/plan-store.js` — add archive metadata fields, archive path helpers, `archivePlan`, `listArchivedPlans`,
  `loadArchivedPlan`, `searchArchivedPlans`, and `restoreArchivedPlan` while reusing existing parsing/canonicalization.
- `src/plan-store.test.js` — cover archive move/restore, nested paths, metadata preservation, active list hiding,
  archived listing/search, overwrite refusal, forced non-terminal archival, and worktree-state guards.
- `src/cmd/plans/index.js` — evolve `wld plans` into a small subcommand dispatcher while preserving current list
  behavior as the default.
- `src/cmd/plans/index.test.js` — cover default listing compatibility, archive subcommand delegation, help text, and
  argument parsing.
- `src/cmd/plans/archive.js` — implement the `wld plans archive ...` command surface and human-readable output.
- `README.md` — document the new archive commands briefly, especially that archives remain plaintext markdown under
  `plans/archived/` and can be restored.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.js` — reuse `getPlansDir`, `ensurePlansDir`, canonical stored Plan names, `loadPlan`,
  `parsePlanFrontMatter`, `injectFrontMatter`, and the existing top-level `HIDDEN_PLAN_DIRS` behavior.
- `src/plan-store.test.js` — extend the existing `listPlans hides archived plans` coverage instead of creating a
  separate archive fixture harness.
- `src/cmd/plans/index.js` — preserve the current Epic/child/standalone/orphan listing as the default command behavior.
- `src/shared/workflow/plan-lifecycle.js` — use lifecycle terminology for safety checks, but do not add new lifecycle
  statuses/events in this slice.
- `plans/archived/` — use the repo's existing archive convention and historical Plan examples as manual test fixtures.

## Implementation Steps

- [ ] Step 1: Add archive metadata support in `src/plan-store.js` (`archivedAt`, `archiveReason`, `archivedFromStatus`,
      and optionally `restoredAt`) while preserving unknown Front Matter keys.
- [ ] Step 2: Add archive path helpers that resolve active Plan names and archived Plan names safely under `plans/` and
      `plans/archived/`, preserving nested relative paths and preventing path traversal.
- [ ] Step 3: Implement `archivePlan()` with safety validation, metadata injection, destination directory creation,
      no-overwrite behavior, and atomic-enough move semantics for local files.
- [ ] Step 4: Implement `listArchivedPlans()`, `loadArchivedPlan()`, and `searchArchivedPlans()` as bounded filesystem
      scans over `plans/archived/` that return concise metadata/snippets rather than dumping entire files by default.
- [ ] Step 5: Implement `restoreArchivedPlan()` to move a Plan back to active `plans/`, preserve body/front matter, add
      restore metadata, and refuse active-file overwrites.
- [ ] Step 6: Add `src/cmd/plans/archive.js` with `move`, `list`, `search`, `read`, and `restore` handlers plus clear
      error messages for blocked archival and missing Plans.
- [ ] Step 7: Update `src/cmd/plans/index.js` to dispatch `archive` while keeping bare `wld plans` output unchanged.
- [ ] Step 8: Write/extend tests for plan-store archive helpers and command parsing/output.
- [ ] Step 9: Add ADR/docs/README updates explaining the archive model and why v1 does not use a database or automatic
      age-based sweep.
- [ ] Step 10: Run full validation and fix issues.

## Verification Plan

- Automated: `deno task ci`
- Manual: Run `wld plans` and verify archived Plans do not appear in the active list.
- Manual: Archive a verified Plan with `wld plans archive move <plan-name> --reason "done"`; verify the file moved to
  `plans/archived/<plan-name>.md` and Front Matter records archive metadata.
- Manual: Attempt to archive a draft/in-progress/failed Plan without `--force`; verify the command refuses with a clear
  reason.
- Manual: Use `wld plans archive list`, `search`, and `read` to find and inspect archived Plans without dumping the
  whole archive by default.
- Manual: Restore an archived Plan and verify it appears in `wld plans` again and no markdown body content changed.

## Edge Cases & Considerations

- Existing dirty files: implementation should not assume the archive directory is clean; refuse overwrites rather than
  silently replacing history.
- Nested child Plans: preserve path shape, but do not cascade archive/restore parent-child relationships automatically.
- Malformed Front Matter: search/list should skip or degrade gracefully; move/restore should avoid destroying body text
  and report parse issues clearly.
- Worktree recovery: active or failed worktree states should not be hidden by archival without an explicit user
  decision.
- Future Plan UI: expose archive operations through plan-store helpers so `wld plans ui` can reuse them later instead of
  inventing direct filesystem mutations.
- Future semantic search: archived Plan content can be indexed later by a unified search system; do not add a dedicated
  LanceDB archive store now.
- Tool visibility: do not blanket-ignore `plans/archived/` in all grep/find-style tools. Prefer active Plan APIs for
  normal workflows and explicit archive commands/search when historical context is needed.
