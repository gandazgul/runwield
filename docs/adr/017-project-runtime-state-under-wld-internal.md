---
status: accepted
---

# ADR-017: Project Runtime State Lives Under `.wld/internal/`

## Context

Project `.wld/` contains two different kinds of data. Users can commit project settings, Agent definitions, Skills, and
prompt templates. RunWield also stores controller records, locks, lifecycle journals, publication staging, worktree
registry data, recovery reports, debug data, and project-local collaboration secrets there.

The runtime files currently use many separate `.gitignore` entries. This makes RunWield changes noisy and makes it easy
for a new runtime file to miss Git protection. It also hides the intended boundary between project configuration and
machine-owned state.

The runtime paths do not all use the same checkout. The worktree registry and controller records are shared through the
primary checkout. Plan document locks and some transition journals belong to the selected document checkout. Publication
staging, registry migration reports, and project collaboration secrets currently depend too much on the supplied working
directory and need explicit primary ownership. Publication records can also name an unfinished checkout by absolute
path. These ownership rules and corrections must survive a storage-layout change.

## Decision

### One reserved runtime root

RunWield Core 0.10.0 reserves `.wld/internal/` in each applicable project checkout for machine-owned project runtime
state. The project `.gitignore` managed block contains one runtime entry:

```gitignore
# BEGIN RunWield owned runtime state
.wld/internal/
# END RunWield owned runtime state
```

User-derived project files remain outside this directory. This includes `.wld/settings.json`, `.wld/agents/`,
`.wld/skills/`, and `.wld/prompts/`. RunWield does not classify these paths as runtime state.

The location does not change authority:

- Primary-checkout runtime state includes controller records, the worktree registry and its lock, publication staging,
  registry migration reports, the project collaboration secret store, and project-wide migration metadata. Project
  secrets, publication staging, and registry migration reports become primary-owned in this change; current code does
  not enforce that consistently.
- Selected-checkout runtime state includes Plan document locks, transition journals, and the Work Record supersession
  and supersession-recovery locks that protect a document or checkout-local operation.
- Home-directory state under `~/.wld/` is not part of this decision. Normal execution worktrees remain under
  `~/.wld/worktrees/`. Only the existing no-home project fallback moves under the project internal root.

A shared path module defines the internal root and named paths. Runtime owners use those definitions instead of
constructing `.wld` runtime paths independently.

### One-way 0.10.0 migration

The first 0.10.0 project entry performs one serialized, durable, idempotent migration before normal runtime-store
access. Migration preflight can read legacy registry, lock, publication, and Git evidence. TUI Sessions, Agent Client
Protocol sessions, headless flows, Init, and direct Plan and collaboration commands use this same operation. Commands
that do not enter a project, such as help and version, do not migrate. A new empty TUI remains in memory until the first
submitted message.

The migration adopts inactive legacy runtime data, writes a versioned layout marker, and then reconciles `.gitignore`.
The primary marker records the selected checkout roots included in the completed adoption. Registered execution
checkouts are adopted before the marker commits. A selected checkout first seen later is adopted and added to that
manifest under the same project migration lock before its normal runtime stores are used. An interrupted migration has a
durable phase record and resumes from verified source and destination facts; a partial destination is not treated as an
independent authority.

The migration resolves primary-shared state to the primary checkout and preserves selected-checkout ownership for
document-local state. It does not infer or merge two independently populated authorities. If old and new authoritative
stores both exist without matching migration evidence, RunWield stops and reports the conflict without deleting either
store.

RunWield 0.10.0 does not support downgrade or concurrent use with an older RunWield process after migration. Current
processes use one migration lock. The legacy registry lock is held from publication preflight through durable marker
commit and retirement of legacy authoritative data; it is released before its own obsolete lock file is retired. Each
other legacy lock is tested with its real protocol: a persistent controller lock file is not evidence of a live writer,
while registry, Plan, and Work Record locks retain their existing ownership and stale recovery rules. A proven live
writer causes a safe stop. Readers reject a layout marker newer than they understand.

An unfinished publication or merge-repair record blocks migration before any files move. The user must finish or cancel
that recovery with a pre-0.10.0 RunWield version and then retry the upgrade. This case is intentionally not translated:
validated unpublished work is more important than an automatic upgrade.

Project collaboration secrets move only after Git tracking, symlink, and destination conflicts are checked. The
migration does not follow a symlink at the internal root or a legacy authority path; it stops before reading or writing
outside the applicable checkout. If Git tracks any legacy or current runtime authority, migration stops and requires
explicit repository cleanup; `.gitignore` cannot untrack it. A tracked secret also requires a security warning and
capability rotation guidance. The new internal directory and secret file retain restrictive permissions where the
platform supports them. The migration never keeps two writable secret stores.

### Git behavior during and after migration

The current runtime classifier owns `.wld/internal/` and all descendants. Git staging, dirty-path checks, publication,
and cleanup use that boundary.

A separate legacy-safety classifier continues to recognize known pre-0.10.0 runtime paths. It exists only to migrate old
state, prevent accidental commits, and report unsupported old-writer activity. No normal runtime owner reads or writes a
legacy path.

Gitignore reconciliation replaces managed legacy blocks, removes exact obsolete RunWield runtime lines and duplicates,
and emits the single canonical block. It preserves unrelated user content. A broad user rule such as `.wld/` is not
removed automatically because RunWield cannot know the user's intent; RunWield reports that the rule also hides
trackable project configuration.

Tracked legacy runtime files require explicit repository cleanup. RunWield does not silently rewrite repository history
or claim that `.gitignore` can untrack files. Secrets already committed to Git cause a security warning and require
credential or capability rotation as applicable.

## Consequences

- A new project runtime capability can stay Git-safe by storing its data under one reserved root.
- Users can commit project settings, Agents, Skills, and prompts without maintaining an exception list.
- Runtime owners retain their current primary-checkout or selected-checkout semantics.
- Upgrade is automatic for normal inactive projects and safely stops for unfinished publication recovery or conflicting
  authorities.
- Downgrade after adoption is unsupported. An older binary can recreate legacy state, but 0.10.0 treats that state as a
  conflict or migration hazard rather than a second authority.
- Documentation and recovery messages must use the new paths while explaining the one-way 0.10.0 boundary.

## Options Not Taken

### Keep the enumerated legacy paths

This avoids migration but keeps the noisy `.gitignore` contract and requires every new runtime capability to update
several Git-safety mechanisms. It does not establish a clear ownership boundary.

### Ignore all of `.wld/`

This gives one ignore entry but also hides user-derived settings, Agents, Skills, and prompts. It conflicts with the
intended repository configuration model.

### Move active publication recovery automatically

A migration could move a saved publication clone and rewrite its absolute registry paths. A process stop between those
effects could separate validated work from its recovery authority. The rare upgrade interruption does not justify this
risk.

### Support old and new versions concurrently

This requires both legacy ignore entries and two compatible lock namespaces. It permits old processes to recreate old
authorities after migration and defeats the single-root result. Version 0.10.0 is an explicit breaking boundary instead.
