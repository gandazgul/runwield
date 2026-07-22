---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Introduce the owner-local coordination database, registered Project records, stable RunWield Session IDs, and lazy legacy transcript cataloging needed by all cross-surface behavior."
affectedPaths:
    - "src/shared/session/"
    - "src/shared/workflow/"
    - "src/cmd/"
    - "src/ui/workspace/server/"
    - "src/shared/session/root-session.js"
frontend: false
createdAt: "2026-07-22T03:56:51.405Z"
updatedAt: "2026-07-22T03:56:51.405Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 2
dependencies:
    - "01-align-personal-workspace-prds-with-adr-011"
---

# Owner Coordination Database and Session Catalog

## Context

Personal Remote Workspace needs stable identity above process-local Runtime UUIDs and Pi Session Manager IDs. The
owner-local database under `~/.wld/` is the coordination authority for registered Projects, stable RunWield Session IDs,
transcript locators, schema migrations, process metadata, and later leases/checkpoints. It must not duplicate canonical
Plans, Work Records, source files, or transcript bodies.

Existing SQLite conventions live in the Workspace Shared Space remote database code, but that database has a different
trust boundary and must not be reused for owner coordination state.

## Objective

Build the reusable owner coordination foundation:

- open and migrate a separate owner SQLite database under `~/.wld/`;
- register, list, disable, remove, and health-check trusted local Projects by canonical root;
- assign stable RunWield Session IDs mapped to one Project and Pi transcript locator;
- lazily catalog existing transcript JSONL files without rewriting them;
- expose small shared APIs and CLI entry points for later Workspace, TUI, ACP, and workflow slices.

## Approach

Create a shared owner-coordination module below adapter code, likely under `src/shared/session/` or a new adjacent
shared coordination directory. Reuse the repository's SQLite migration/WAL transaction style from
`src/ui/workspace/server/remote-db.js`, but keep schema, path, and credentials separate from Shared Space. Keep initial
tables focused on Projects, Sessions, schema migrations, and lightweight process/catalog metadata; later slices can add
activation, checkpoints, Plan leases, attention, search, and devices.

## Files to Modify

- `src/shared/session/` — add owner coordination database, schema, Project registry, Session catalog, and transcript
  catalog helpers.
- `src/shared/session/root-session.js` — reuse persisted transcript discovery while adding catalog-safe locator
  metadata.
- `src/cmd/` — add or extend commands for Project registration/list/health and basic catalog inspection.
- `src/ui/workspace/server/` — prepare server-side services to consume the owner database without mixing it with
  `remote-db.js` Shared Space state.
- `src/shared/workflow/` — expose durable Plan ID or Project identity helpers only where needed by later workflow
  ownership slices.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/workspace/server/remote-db.js` — reuse migration, WAL, transaction, and schema-versioning conventions for a
  separate owner DB.
- `src/ui/workspace/server/remote-schema.js` — reuse schema migration organization, not the Shared Space schema itself.
- `src/shared/session/root-session.js` — reuse RunWield session directory and persisted root Session discovery.
- `src/shared/worktree-registry.js` — reuse canonical-root/worktree evidence patterns without storing worktree registry
  data in SQLite.

## Implementation Steps

- [ ] Add an owner DB path resolver under `~/.wld/` with test overrides so tests never touch a real user database.
- [ ] Implement schema migrations for `schema_migrations`, registered Projects, stable Sessions, transcript locators,
      and minimal process/catalog metadata.
- [ ] Implement Project registration with canonical realpath containment, duplicate detection, moved/missing root health
      states, disable/remove behavior, and no repository data deletion.
- [ ] Implement stable Session catalog APIs that can create/map RunWield Session IDs to Project IDs and Pi transcript
      locators.
- [ ] Implement lazy legacy transcript cataloging from existing persisted Session directories without rewriting JSONL
      bodies.
- [ ] Add CLI entry points for registering/listing Projects and inspecting cataloged Sessions.
- [ ] Add unit and integration tests for migrations, newer-schema refusal, registration edge cases, transcript
      cataloging, and reconstruction-friendly behavior.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: targeted tests should cover schema migration ordering, WAL/transaction behavior, newer-schema refusal,
  Project duplicate/move/disable/remove states, non-Git Project registration, and lazy transcript catalog assignment.
- Manual: register the current repository as a Project, list it, inspect a cataloged existing Session if present,
  disable/re-enable or remove the Project record, and confirm no repository data or transcript files are rewritten.

## Edge Cases & Considerations

- The owner database is coordination-critical but reconstructible; do not make it canonical for Plans, Work Records,
  transcript content, or source code.
- Resolve symlinks and duplicate roots deterministically.
- A missing or damaged database must fail visibly and support explicit re-registration later.
- Shared Space ciphertext/capability storage remains separate from owner Workspace state.
