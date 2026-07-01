# ADR 008: Plan archival and retrieval

## Status

Accepted

## Context

Completed, closed, abandoned, or stale Plan files should stop crowding active Plan workflows while remaining available
as project history. RunWield already treats top-level `plans/archived/` as hidden from normal `wld plans` listing while
still allowing explicit file access.

Archival is a storage concern, not a lifecycle state. The durable Plan status (`verified`,
`closed_without_verification`, `implemented`, `on_hold`, etc.) remains meaningful after the file moves.

## Decision

RunWield archives Plans by physically moving markdown files from `plans/` to `plans/archived/`, preserving nested
relative paths. For example, `plans/my-epic/01-child.md` archives to `plans/archived/my-epic/01-child.md`.

The first command surface is explicit and reversible:

- `wld plans archive` lists archived Plans.
- `wld plans archive <plan-name-or-id> [--reason <text>] [--force]` archives one active Plan.
- `wld plans archive restore <archived-plan-name-or-id> [--to <plan-name>]` restores one archived Plan to active
  `plans/`.
- `wld plans read <plan-name-or-id>` inspects active or archived Plans.

Archive and restore metadata is recorded in front matter (`archivedAt`, `archiveReason`, `archivedFromStatus`,
`archivedFromPath`, `restoredAt`, `restoredFromPath`) without adding an `archived` status.

`verified` and `closed_without_verification` Plans can be archived without `--force`. Other statuses require `--force`.
Plans with recoverable worktree states (`active`, `execution_failed`, `validation_failed`, or `merge_conflict`) are
blocked until a separate abandon/cleanup flow handles that recovery state.

## Non-decisions

- No automatic boot sweep moves Plans by age. Automatic movement is risky around worktree recovery, Epic/child
  relationships, `on_hold`, and manual closure semantics.
- No CLI archive search is added in this slice. Discovery starts with a plain archive list; richer search belongs in a
  unified UI/search surface later.
- No one-off LanceDB or full-text archive index is added. Archived markdown remains plain text and can be indexed later
  by a broader search system.
- No bulk Epic/child archival is added. Archiving an Epic does not automatically archive child FEATURE Plans, and
  archiving a child does not modify its Epic.

## Consequences

Normal active workflows stay focused because `wld plans` and active Plan resource APIs hide `plans/archived/`.
Historical context remains available in plaintext and can be listed, read, restored, or targeted by explicit paths.
Future Plan UI controls should call the centralized `src/plan-store.js` archive helpers instead of moving files
directly.
