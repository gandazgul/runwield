---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Introduce the owner-local coordination database, registered Project records, stable RunWield Session IDs, and lazy legacy transcript cataloging needed by all cross-surface behavior."
affectedPaths:
    - "src/shared/owner-coordination/"
    - "src/shared/session/root-session.js"
    - "src/shared/session/root-session.test.js"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-21T23:56:51.405-04:00"
updatedAt: "2026-07-22T17:31:44.766Z"
status: "ready_for_work"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 2
dependencies:
    - "01-align-personal-workspace-prds-with-adr-011"
---

# Owner Coordination Database and Session Catalog

## Context

Personal Remote Workspace needs stable identity above process-local Runtime UUIDs and Pi Session Manager IDs. An
owner-only coordination database under `~/.wld/` must map registered Projects to stable RunWield Session IDs and private
Pi transcript locators before later slices can add device authorization, Session Activation Leases, committed
generations, Durable Workflow Checkpoints, or Plan Workflow Leases.

The database is coordination-critical but reconstructible. It must not duplicate canonical Plans, PRDs, ADRs, Work
Records, source, worktree evidence, transcript bodies, Shared Space ciphertext/capabilities, or derived Mnemosyne/Cymbal
indexes. Existing Shared Space SQLite code provides useful migration and transaction conventions, but its database and
trust boundary must remain separate.

RunWield Core and its CLI remain focused on one Project at a time. Multi-Project administration belongs to the owner
Workspace UI and future SaaS, so this foundation exposes shared APIs but adds no new CLI commands. The following
Workspace slice will provide registration and repair controls.

## Objective

Build the reusable owner-coordination foundation that:

- opens and migrates a separate owner SQLite database at `~/.wld/owner-coordination.sqlite3`, with explicit test-path
  overrides;
- preserves stable Project identity across disable, removal, restoration, and explicit root relinking;
- reports filesystem registration health without requiring a Git repository;
- assigns stable RunWield Session IDs distinct from Pi Session IDs and in-process Runtime IDs;
- lazily catalogs existing Session JSONL locators when a Project's Sessions are first listed, without opening a writable
  Pi Session Manager, ingesting transcript content, or rewriting files;
- gives later Workspace, TUI, ACP, activation, and workflow slices a narrow shared API rather than raw SQLite access.

## Approach

Create `src/shared/owner-coordination/` as an adapter-neutral package. Reuse the WAL, foreign-key, ordered-migration,
`BEGIN IMMEDIATE`, and newer-schema refusal patterns from the Workspace Shared Space database, but define a distinct
schema and path. Keep database handles and SQL private behind Project and Session catalog services.

The initial schema should contain only:

- migration records;
- stable Projects with lifecycle state (`enabled`, `disabled`, or retained `removed` tombstone), display metadata, and
  timestamps;
- current and historical Project root records so explicit relinking preserves Project identity and legacy transcript
  discovery evidence;
- stable RunWield Sessions owned by exactly one Project; and
- one guarded Pi transcript locator per Session in v1, including Pi Session ID, JSONL path, transcript cwd evidence, and
  catalog timestamps.

Use foreign-key restrictions and uniqueness constraints so removing a Project never cascades into Session identity,
repeated or concurrent catalog scans converge on the existing stable ID, and one transcript locator cannot silently map
to two Sessions. Do not add activation leases, process ownership, committed generations, checkpoints, devices, attention
projections, or Plan ownership in this slice.

Project registration resolves the supplied directory and records both its entered absolute path and canonical realpath.
Symlink aliases converge on one Project. Removal revokes eligibility but retains a tombstone; registering the same
canonical root later restores the same Project ID and Session associations. A moved root is never guessed from a missing
path: `relinkProject` validates the replacement root, preserves root history, and retains the Project ID. Health is
computed separately from lifecycle so disabled/removed Projects can still report missing, non-directory, unreadable, or
symlink-retargeted roots.

Legacy cataloging uses a bounded, metadata-only JSONL header reader beside `root-session.js`. It discovers candidate
files under the current or retained historical RunWield Session directories, verifies path containment and Pi
Session/header cwd evidence against the Project root history, then inserts or returns the stable mapping
transactionally. The normal Session-list service performs an incremental scan on demand; an explicit full-rescan service
is reserved for the Workspace repair UI. Full branch parsing and semantic projection remain in slice 6.

## Files to Modify

- `src/shared/owner-coordination/paths.js` — resolve the default owner database path at call time and support explicit
  temporary paths for tests without mutating ambient `HOME`.
- `src/shared/owner-coordination/schema.js` — define ordered owner-only migrations, schema version, constraints, and
  indexes independently of Shared Space schema.
- `src/shared/owner-coordination/database.js` — open SQLite with foreign keys, WAL for on-disk databases, bounded busy
  timeout, transactions, pre-upgrade backup behavior, corruption errors, and refusal of unsupported newer schemas.
- `src/shared/owner-coordination/projects.js` — implement Project registration, listing, health, enable/disable,
  tombstoned removal/restoration, explicit relinking, and enabled-root authorization.
- `src/shared/owner-coordination/sessions.js` — implement stable RunWield Session mapping, locator lookup,
  lazy/incremental Project cataloging, list/inspect APIs, and full-rescan support for later Workspace UI.
- `src/shared/owner-coordination/index.js` — expose typed JSDoc service APIs while keeping raw SQL and database handles
  internal.
- `src/shared/owner-coordination/*.test.js` — cover migrations, Project lifecycle/health, reconstruction, identity, and
  concurrent catalog behavior with temporary databases and filesystem fixtures.
- `src/shared/session/root-session.js` — add catalog-safe Session directory and bounded JSONL locator/header discovery
  helpers without changing existing writable open/create behavior.
- `src/shared/session/root-session.test.js` — verify locator validation, containment, malformed input handling, and
  strict non-mutation of transcript files.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/workspace/server/remote-db.js` — copy its foreign-key, WAL, immediate-transaction, and migration organization
  patterns into the shared owner package; do not import its database or reuse Shared Space credentials.
- `src/ui/workspace/server/remote-schema.js` — follow its versioned SQL organization while improving newer-schema checks
  so refusal occurs before any schema write.
- `src/shared/session/root-session.js` — reuse `getRunWieldSessionsBaseDir`, `getRunWieldSessionDir`, path guarding, and
  persisted Session terminology; do not use `openPersistedRootSession` or `SessionManager.open()` for cataloging.
- `src/shared/worktree-registry.js` — follow its realpath-variant and missing-path handling patterns without moving
  worktree registry state into SQLite.
- `src/ui/workspace/workspace.test.js` — reuse the existing SQLite migration/newer-schema test style in focused shared
  owner-coordination tests rather than expanding the monolithic Workspace suite.

## Implementation Steps

- [ ] Add the owner database path resolver and opener. Create `~/.wld/` with owner-only permissions where supported, use
      `~/.wld/owner-coordination.sqlite3` by default, accept an explicit `dbPath`, enable foreign keys and WAL,
      configure a bounded busy timeout, and expose a rollback-safe `BEGIN IMMEDIATE` transaction helper.
- [ ] Implement ordered, idempotent schema migrations for `schema_migrations`, Projects, Project root history, stable
      RunWield Sessions, and Pi transcript locators. Check the recorded version before applying any migration, refuse a
      newer schema without mutation, and create a timestamped backup before upgrading an existing on-disk database.
- [ ] Add stable random ID generation through injectable factories for tests. Name identity fields explicitly as
      `projectId`, `runwieldSessionId`, and `piSessionId`; never overload the in-process `runtimeSessionId` used by
      `SessionHost`/`HostedSession`.
- [ ] Implement `registerProject`, `listProjects`, `getProjectHealth`, `setProjectEnabled`, `removeProject`,
      `restoreProject`, `relinkProject`, and `requireEnabledProjectRoot`. Canonicalize existing directories, reject
      files and conflicting roots, converge direct/symlink duplicates, keep disabled records disabled on duplicate
      registration, and restore removed records with their original Project ID when the same canonical root is
      registered again.
- [ ] Keep lifecycle and health independent. Return explicit health evidence for available, missing, non-directory,
      unreadable, and canonical-root/symlink mismatch cases; treat non-Git directories as valid Projects; never delete,
      rename, initialize, or otherwise modify a registered root during health checks.
- [ ] Preserve prior root evidence during `relinkProject`. Validate that the new canonical root is not owned by another
      Project, retain old root/session-directory locators for legacy cataloging, and require explicit relinking rather
      than inferring a move from filesystem similarity.
- [ ] Add catalog-safe discovery helpers beside `root-session.js` that enumerate candidate `.jsonl` files and read only
      a bounded header record. Verify absolute-path containment, header shape, Pi Session ID/path consistency, and cwd
      correspondence to current or historical Project root evidence without calling `SessionManager.open()` or parsing
      message bodies.
- [ ] Implement `ensureSessionCatalogRecord`, `findSessionByLocator`, `getSessionById`, `listProjectSessions`, and
      `catalogProjectSessions`. Session listing should lazily run an incremental metadata scan; full rescan should be an
      explicit API for the later Workspace repair action. Existing mappings win on retries, while contradictory locator
      evidence produces a visible catalog conflict instead of reassignment.
- [ ] Make catalog scans resilient per file: return diagnostics for malformed, truncated, out-of-root, wrong-cwd, or
      conflicting transcripts while continuing to catalog valid candidates. Store locator and operational catalog
      evidence only—never message text, first-message previews, tool payloads, or transcript bodies.
- [ ] Add focused database, Project, and Session tests using explicit temporary `dbPath` values. Include two independent
      database connections racing to register the same root or locator so uniqueness/transaction behavior proves that
      they converge on one stable ID.
- [ ] Document the package boundary in module JSDoc: slice 3 consumes Project/catalog services for owner Workspace UI;
      slice 4 adds activation/generation migrations; slice 6 owns complete read-only transcript projection; slice 7
      adopts stable IDs across all writable TUI/ACP paths. No adapter may issue owner-database SQL directly.

## Verification Plan

- Automated: run `deno task ci` and fix all failures.
- Automated: migration tests cover a new database, ordered upgrade, idempotent reopen, transaction rollback, foreign-key
  enforcement, WAL on disk, pre-upgrade backup, corruption failure without auto-deletion, and newer-schema refusal
  without applying schema changes or recording migration rows.
- Automated: Project tests cover direct/symlink duplicate registration, removed-root restoration to the same Project ID,
  disabled versus removed authorization, explicit relink with retained root history, symlink retargeting, missing,
  unreadable and non-directory roots, root conflicts, and healthy non-Git directories.
- Automated: Session tests cover stable ID reuse, one-Project ownership, duplicate Pi IDs/paths, concurrent catalog
  convergence, incremental rescans, malformed/truncated/wrong-cwd/out-of-root JSONL files, and catalog diagnostics that
  do not block valid files.
- Automated: non-mutation tests spy on or isolate Pi APIs to prove cataloging never invokes `SessionManager.open()`,
  then compare transcript bytes and modification times before and after listing/full rescan.
- Automated: reconstruction test deletes only the temporary owner database, explicitly re-registers the Project, and
  confirms valid transcripts can receive conservative stable mappings again without changing repository or transcript
  files; no claim is made that regenerated IDs equal IDs lost with the database.
- Manual source review: verify the shared owner package has no imports from TUI, ACP, Workspace application routes, or
  Shared Space adapters, and that this slice adds no CLI or browser surface.
- Expected result: later Workspace code can authorize one enabled Project root and list stable Session records through
  shared APIs, while existing one-Project CLI/TUI behavior remains unchanged until later activation slices adopt the
  catalog.

## Edge Cases & Considerations

- **Database loss:** stable IDs in a destroyed database cannot be recreated identically without another durable copy.
  Reconstruction preserves canonical files and assigns conservative mappings after explicit re-registration; ambiguous
  active workflows must later enter recovery rather than pretending ownership survived.
- **Removal is not deletion:** removed Projects remain tombstoned so re-registration restores the same Project and
  Session associations. Removal, disable, relink, and health checks never delete repository data, Plans, Work Records,
  worktrees, images, memory backups, or Session Transcripts.
- **Moved roots:** a missing path is not proof of a move. Only explicit relinking changes the current root, and retained
  historical roots remain locator evidence rather than active filesystem authorization.
- **Path reuse and symlink retargeting:** if current filesystem evidence conflicts with retained identity, report a
  conflict for Workspace resolution; do not silently transfer a Project or transcript to another stable ID.
- **Encoded directory collisions:** `encodeCwdForSessionDir()` is not sufficient identity evidence by itself. Cataloging
  must validate JSONL header cwd and stored Project root evidence before insertion.
- **Malformed or live transcripts:** an incomplete candidate may be skipped with diagnostics and discovered on a later
  incremental scan. Cataloging must not repair, truncate, migrate, or rewrite it.
- **Scope boundary:** Project initialization health shown by Workspace may later combine this slice's registration
  health with existing `~/.wld/init-state.json` evidence. This slice does not refactor the current cwd-oriented init
  command or make registration run `/init`.
- **Future schema:** activation, device, checkpoint, Plan lease, and attention tables belong to their owning child
  Plans; do not add speculative columns or generic process metadata now.
