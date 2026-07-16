---
planId: "16e5c776-d721-4a70-ae0f-a940b3fb140f"
classification: "FEATURE"
complexity: "HIGH"
summary: "Rename the local RunWield checkout directory from /Users/gandazgul/Documents/web/harns to /Users/gandazgul/Documents/web/runwield without rebranding source or changing the GitHub repository, after current linked-worktree work finishes naturally, while preserving Mnemosyne Memory and resumable RunWield, Claude Code, and Codex sessions plus path-keyed indexes, shell configuration, and IDE state."
affectedPaths:
    - "/Users/gandazgul/Documents/web/harns"
    - "/Users/gandazgul/.wld/sessions/--Users-gandazgul-Documents-web-harns--"
    - "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-harns--"
    - ".wld/worktrees.json"
    - "/Users/gandazgul/.zshrc"
    - "/Users/gandazgul/.local/bin/wld"
    - "/Users/gandazgul/.wld/init-state.json"
    - ".claude/settings.local.json"
    - "/Users/gandazgul/Library/Application Support/Code/User"
    - "/Users/gandazgul/Library/Application Support/JetBrains"
    - "/Users/gandazgul/.claude/projects/-Users-gandazgul-Documents-web-harns"
    - "/Users/gandazgul/.claude/history.jsonl"
    - "/Users/gandazgul/.codex/config.toml"
    - "/Users/gandazgul/.codex/state_5.sqlite"
    - "/Users/gandazgul/.codex/sessions"
    - "/Users/gandazgul/.codex/archived_sessions"
frontend: false
createdAt: "2026-07-10T09:36:24-04:00"
updatedAt: "2026-07-16T14:08:45.056Z"
status: "draft"
origin: "internal"
---

# Rename the Local Checkout Folder to `runwield`

## Context

The product, CLI, remote repository, tracked IDE module, and project-local configuration are already named RunWield, but
the primary checkout still lives at `/Users/gandazgul/Documents/web/harns`. This Plan covers a **local checkout folder
rename only** to `/Users/gandazgul/Documents/web/runwield`; it does not rename source symbols, package metadata, Git
branches, release assets, or `origin` (`git@github.com:gandazgul/runwield.git`).

A 2026-07-16 refresh confirms the rename is still pending: `/Users/gandazgul/Documents/web/runwield` does not yet exist,
the old RunWield and Claude path-keyed session directories still exist, Codex and `.zshrc` still contain old-root
references, and active worktrees still block cutover.

The folder basename and absolute path are operational identities for several tools, not just cosmetic labels:

- Mnemosyne derives the **Project Name** from `basename(cwd)`, so the current `harns` collection (522 documents at the
  2026-07-16 refresh) would otherwise be replaced by a new empty `runwield` collection.
- RunWield stores Agent Sessions under an encoded absolute-cwd directory. The current namespace contains 547 JSONL files
  plus image and Memory-backup artifact directories; 535 JSONL session headers currently declare the exact old cwd,
  while 12 declare `harns_clone` and must not be coerced into the renamed checkout.
- RunWield worktree parents are keyed by the encoded primary-project path. The 2026-07-16 refresh found three live
  linked worktrees beyond the primary checkout, all under the old encoded parent; `.wld/worktrees.json` still records
  those three validation-failed entries plus two stale completed/merged entries whose directories are already gone.
- The shell contributes `harns/bin` to `PATH`, but the active `wld` currently resolves first to
  `/Users/gandazgul/.local/bin/wld` and then to `harns/bin/wld`; this conflicts with the user's earlier choice to keep
  `wld` resolving directly from the renamed repository's `bin/wld`, so the cutover must also remove or reorder the
  `~/.local/bin` shadowing binary after backing it up if needed.
- Cymbal, VS Code, JetBrains IDEs, terminals, Git clients, scripts, and recent-project registries may key state by the
  absolute path. VS Code has live folder/workspace identities for the old root, while JetBrains workspace XML contains
  old-root tree/open-file state.
- Claude Code has a 22 MB path-keyed project-session directory for this checkout, currently 22 session JSONL files plus
  project auto-memory/artifacts and 194 matching global history rows. Codex has the old root in its trusted project
  config and process-manager state, plus 164 SQLite `threads.cwd` rows and 165 active/archived rollout files with
  structural `session_meta` old-cwd values. These are separate from RunWield Agent Sessions; the user selected full
  resume-preserving migration for both rather than archive-only retention.

The user chose to defer the cutover until current Plan work finishes naturally and all linked worktrees are gone, rather
than abandoning work for the rename or repairing active Git metadata. The cutover must then run from the parent
directory after all RunWield, Claude Code, Codex, IDE, and path-owning processes have exited. It should not be executed
as a normal RunWield worktree-backed implementation, because renaming the primary checkout while RunWield is using it
would invalidate the executing process's cwd and Git administration paths.

## Objective

Move the checkout to `/Users/gandazgul/Documents/web/runwield` with a reversible, verified migration that:

- preserves the working tree and Git/submodule integrity;
- makes the existing project Memory available under Project Name `runwield` without deleting the `harns` source
  collection during the initial cutover;
- preserves resumable primary-checkout RunWield Agent Sessions and their image/Memory-backup artifacts;
- migrates Claude Code's path-keyed project sessions and auto memory plus Codex's cwd-indexed active/archived sessions
  so all three Agent histories remain resumable from the new root;
- waits for current linked-worktree work to finish, then removes all linked worktrees through normal cleanup before the
  move instead of abandoning work or hand-editing Git administration files;
- updates the executable/PATH and reopens IDE/tool state at the new path; and
- leaves historical transcripts, Git logs, archived Plans, and editor history unchanged unless they are operational
  pointers.

## Approach

Use a drain-backup-migrate-verify sequence rather than a blind `mv` followed by global search-and-replace:

1. Wait for in-flight Plan work to finish naturally, then remove each now-finished linked worktree through its normal
   cleanup path so no `.git/worktrees/*` gitfile points back to the old primary checkout. Do not abandon current work
   merely to accelerate this rename.
2. Close RunWield, IDE windows, dev servers, terminals whose cwd is inside the checkout, and any ACP/Session Host
   process. Perform the remaining work from `/Users/gandazgul/Documents/web` in a fresh shell.
3. Back up path-keyed state, rename the folder atomically on the same filesystem, and update only operational absolute
   paths.
4. Migrate Mnemosyne and Agent Session identities deliberately. Do not rewrite old paths embedded in conversation text,
   logs, Git reflogs, archived Plans, or editor history.
5. Rebuild/reindex disposable caches at the new path and verify Git, RunWield, Memory, Agent Session resume, IDEs, and
   developer commands before deleting any old-state backups.

## Files to Modify

- `/Users/gandazgul/Documents/web/harns` → `/Users/gandazgul/Documents/web/runwield` — atomically rename the primary
  checkout from its parent directory; no tracked source-content rename is expected.
- `.wld/worktrees.json` — before cutover, let current Plans finish and clear their recorded worktrees through normal
  RunWield merge/cleanup so old absolute paths are no longer recoverable execution state; avoid manual edits.
- `/Users/gandazgul/.wld/sessions/--Users-gandazgul-Documents-web-harns--` →
  `/Users/gandazgul/.wld/sessions/--Users-gandazgul-Documents-web-runwield--` — move the complete primary-checkout Agent
  Session namespace and change only each JSONL header's `cwd` field when it exactly equals the old root.
- Mnemosyne collection `harns` → `runwield` — export the source collection with embeddings, import it under the new
  Project Name, and retain the old collection until post-cutover verification succeeds.
- `/Users/gandazgul/.zshrc` — replace the old checkout `bin` PATH entry with the renamed repository's `bin` path and
  ensure repository `bin/wld` precedes any generic user-bin `wld`.
- `/Users/gandazgul/.local/bin/wld` — currently shadows the development checkout binary; back it up/remove it or adjust
  PATH ordering so the selected direct-checkout resolution policy is true after cutover.
- `/Users/gandazgul/.wld/init-state.json` — update the old-root initialization record to the new root after backup.
- `.claude/settings.local.json` — project-local Claude permissions contain exact old-root command allowlist entries;
  update only active permission patterns that should remain valid from the renamed checkout.
- `/Users/gandazgul/Library/Application Support/Code/User/**` — reopen the renamed folder and let VS Code create a new
  workspace identity; update only live workspace references/settings when needed, not bulk History records.
- `/Users/gandazgul/Library/Application Support/JetBrains/**` — reopen/import the new path and remove stale recent
  project entries through the IDE; tracked `.idea/modules.xml` already uses `$PROJECT_DIR$` and `.idea/runwield.iml`.
- `/Users/gandazgul/.claude/projects/-Users-gandazgul-Documents-web-harns` →
  `/Users/gandazgul/.claude/projects/-Users-gandazgul-Documents-web-runwield` and exact structural project/cwd metadata
  in Claude history/session JSONL — migrate 22 project session files and the project auto-memory directory so resume and
  continue work at the new path.
- `/Users/gandazgul/.codex/config.toml`, `/Users/gandazgul/.codex/state_5.sqlite`, active/archived rollout JSONL, Codex
  global project state, and live process-manager state — migrate exact structural old-root fields for the currently
  indexed 164 threads, preserve trusted-project status, and terminate stale old-cwd processes before editing.
- Any discovered live shell scripts, launchd/cron jobs, MCP/editor allowlists, Git-client bookmarks, or sibling-project
  configs containing the old absolute path or `../harns` — update only after classifying them as operational.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/root-session.js#encodeCwdForSessionDir` — authoritative mapping from absolute cwd to the old and
  new Agent Session directory names.
- `src/shared/session/root-session.js#listPersistedRootSessions` and `openPersistedRootSession` — verification seams;
  they require the session header cwd to match the new absolute cwd, so moving files alone is insufficient.
- `src/extensions/mnemosyne/index.js` — confirms Project Name is `basename(cwd)` and that `runwield` will be
  auto-created on first launch.
- Mnemosyne `export`/`import --name` — preserve vectors and metadata while changing the collection name; use `forget`
  only after a separate retention decision.
- `src/shared/worktree.js#resolveWorktreeParent` and `src/shared/worktree-registry.js` — authoritative old/new worktree
  namespace and registry behavior; use existing Plan Recovery and `git worktree remove/prune` instead of editing
  `.git/worktrees` internals.
- Git's relative submodule gitfile (`third_party/plannotator/.git`) and relative `core.worktree` configuration — these
  should survive when the whole primary checkout moves after linked worktrees are drained.
- Tracked `.idea/modules.xml`, `.idea/runwield.iml`, and `.vscode/launch.json` — already use project-relative variables
  and should travel without content changes.

## Implementation Steps

- [ ] Establish the migration boundary and maintenance window:
  - Confirm this is only a local folder rename; keep `origin`, package names, product branding, branch names, source
    text, and remote repository name unchanged.
  - Preserve resumable sessions for all three selected Agents: RunWield, Claude Code, and Codex. Keep immutable
    pre-migration backups because Claude/Codex state formats are external-tool implementation details.
  - Do not start the cutover from a RunWield execution worktree or while this Agent Session is open.
  - Record the old/new absolute paths and encoded names once and reuse them in commands to avoid typo-based partial
    migrations.
- [ ] Make the primary checkout recoverable before touching path state:
  - Review `git status --short`; the 2026-07-16 refresh found primary-checkout user changes in
    `plans/collaborative-planning-remote-shared-spaces/10-remote-review-plannotator-markdown-annotations.md` and
    `src/prompt-templates/release.md`, and this Plan revision itself may be dirty after finalization. Commit, stash, or
    explicitly retain them according to the user's normal workflow; the migration must never silently stage or discard
    them.
  - Capture `git rev-parse HEAD`, current branch, `git remote -v`, `git submodule status`,
    `git worktree list --porcelain`, `.wld/worktrees.json`, Mnemosyne collection counts, and Agent Session file/artifact
    counts in a timestamped migration log outside the checkout.
  - Create backups of the `harns` Mnemosyne export, the old Agent Session namespace, `.wld/worktrees.json`, chosen
    Claude/Codex state, and shell/IDE live configuration before edits. Keep backups until the rollback window closes.
    Budget for at least 283 MB of RunWield Agent Sessions, 22 MB of Claude project state, and roughly 612 MB of Codex
    active/archived rollout state plus database/WAL backup overhead. The old worktree namespace is 3.6 GB and should
    disappear through normal completed-work cleanup rather than be duplicated wholesale.
- [ ] Wait for and drain all linked worktrees before renaming:
  - Treat the rename as blocked while current Plan work remains. Let each Plan reach its intended terminal/recovery
    outcome and use normal merge/cleanup afterward; do not select Delete/abandon solely for this folder rename.
  - The 2026-07-16 refresh found three live `validation_failed` linked worktrees, two stale registry entries
    (`completed`/`merged`) whose directories are already gone, a dirty remote-review annotations worktree, and a dirty
    guided-review worktree; recheck rather than relying on this snapshot because concurrent Agent Sessions are still
    changing primary and worktree state.
  - Separately inspect `git worktree list --porcelain` for any non-RunWield linked worktree and remove it through
    `git worktree remove` only after preserving wanted changes; do not assume RunWield's registry owns every entry.
  - Verify every linked worktree is clean or its changes are preserved before removal. Run `git worktree prune` only
    after removal.
  - Gate the rename on `git worktree list --porcelain` showing only the primary checkout and on no recoverable old-path
    entry remaining in `.wld/worktrees.json`. Retain branches if desired; branch names do not depend on checkout paths.
- [ ] Quiesce path users and perform the atomic folder rename:
  - Exit all RunWield TUI/ACP/Session Host processes cleanly so JSONL writes have flushed; stop Workspace/dev servers,
    file watchers, test watchers, and shells/editors rooted inside the checkout.
  - From `/Users/gandazgul/Documents/web`, verify `runwield` does not already exist, then rename `harns` to `runwield`
    on the same filesystem. Do not copy/delete unless an atomic rename is unavailable.
  - Start a fresh shell at the new path; do not rely on an existing process's stale cwd or shell command hash.
- [ ] Migrate the primary Agent Session namespace:
  - If the new encoded session directory does not exist, rename the old directory as a unit so JSONL files, image
    directories, and Memory-backup directories stay together. If both exist, back up both and merge by unique session
    ID/filename rather than overwriting.
  - Parse each JSONL file and update only the first `type: "session"` record's `cwd` when it exactly equals
    `/Users/gandazgul/Documents/web/harns`; do not global-replace old paths in messages, tool results, compactions, or
    exported historical content.
  - Investigate the 12 current JSONL files that did not match the exact old header instead of coercing them. Their
    headers currently declare `/Users/gandazgul/Documents/web/harns_clone`; preserve or return them to that checkout's
    namespace rather than changing them to `runwield`.
  - Preserve file timestamps/permissions where practical and compare pre/post file and artifact counts.
- [ ] Migrate Claude Code sessions and project auto memory:
  - Close every Claude process and verify the destination encoded project directory is absent or backed up. Anthropic's
    current [session documentation](https://docs.anthropic.com/en/docs/agent-sdk/sessions) confirms resume is cwd-scoped
    under `~/.claude/projects/<encoded-cwd>` and a mismatched cwd can produce a fresh session instead of the requested
    history.
  - Back up `~/.claude/projects/-Users-gandazgul-Documents-web-harns` and `~/.claude/history.jsonl`, then move/copy the
    complete project directory to the `runwield` encoded name, including `memory/` and any session artifacts.
  - Parse JSONL record-by-record and change only structural `cwd` fields exactly equal to the old root in the 22 project
    session files; update exact structural `project` fields in Claude's global history so project history follows the
    new identity. Do not replace old-root text inside prompts, tool output, snapshots, summaries, or memory prose.
  - Preserve session IDs, UUID/parent chains, timestamps, branch metadata, permissions, and file names. Validate JSONL
    before replacing each original, using temporary files plus atomic renames.
- [ ] Migrate Codex session, trust, and index state:
  - Close Codex CLI/Desktop/app-server processes and confirm SQLite WAL activity has stopped. Back up `config.toml`,
    `.codex-global-state.json`, process-manager state, active and archived rollout JSONL, and the `state_5.sqlite` DB
    together with its `-wal`/`-shm` files before any transform.
  - Rename the exact `[projects.'/Users/gandazgul/Documents/web/harns']` table key in `config.toml` to the new root
    while preserving `trust_level = 'trusted'`; update only structural old-root project entries in Codex global state.
  - For the 165 currently matching active/archived rollout files, parse every record and change only
    `type: "session_meta"` → `payload.cwd` values exactly equal to the old root. Multiple `session_meta` records can
    occur in one rollout (715 matches at the 2026-07-16 refresh), so validate every transformed line while leaving
    prompts/tool output untouched.
  - In one SQLite transaction, update `threads.cwd` from old root to new root with an exact predicate and assert the
    affected-row count matches the preflight count (164 at the 2026-07-16 refresh). Run `PRAGMA integrity_check`
    afterward. Do not modify unrelated goals, logs, Memory databases, thread IDs, rollout paths, or source metadata.
  - Remove/reconcile closed old-cwd process-manager entries rather than making dead processes appear live. Let Codex
    rebuild disposable ambient-suggestion/cache state unless the current version documents a safe structural migration.
  - Verify both the cwd-filtered `codex resume` picker and `codex resume <SESSION_ID> -C <new-root>`; current Codex help
    confirms the default picker filters by cwd and `--all` disables that filter, so `--all` is the fallback for picker
    indexing omissions.
- [ ] Migrate Project Memory from `harns` to `runwield`:
  - Export the `harns` collection with embeddings to a timestamped JSONL backup, initialize/confirm `runwield`, and
    import with `mnemosyne import <backup> --name runwield`.
  - Verify document count, Core Memory presence, representative semantic searches, tags, and no accidental duplicate
    import. The current refresh baseline is 522 documents in `harns`; re-read the live count at execution time.
  - Keep Global Memory unchanged. Do not automatically consolidate the many worktree-basename collections into the main
    project collection; export non-empty old worktree collections for retention and audit them separately.
  - Keep `harns` available as rollback state until the user explicitly approves deletion; then optionally run
    `mnemosyne forget --name harns`.
- [ ] Restore command and local RunWield path resolution:
  - Update `.zshrc` line 18 (or its live equivalent at execution time) from `.../harns/bin` to `.../runwield/bin`, then
    resolve the current `~/.local/bin/wld` shadowing binary by backing it up/removing it or reordering PATH so the
    user's choice to run `wld` directly from the renamed repository's `bin/wld` is actually true.
  - Open a new shell or run `rehash`/`hash -r`, then verify `type -a wld`, `command -v wld`, `wld --version`, and
    `wld --help` resolve from the intended repository `bin/wld` location first and have no old-root result.
  - The project-local `.wld/settings.json` moves with the checkout. Recheck any path-valued global settings, external
    Skill/Agent paths, review launchers, notification hooks, and permissions for old-root references. Update
    `.claude/settings.local.json` permission entries only when they are active allowlist patterns, not historical
    command evidence.
- [ ] Reconcile RunWield worktree and initialization state:
  - Confirm the moved `.wld/worktrees.json` contains no recoverable old-path worktree. Archive/remove the old
    `~/.wld/worktrees/--Users-gandazgul-Documents-web-harns--` directory only after it is empty and every wanted branch
    or patch is preserved.
  - Let future execution create the new encoded worktree parent automatically; verify the first new worktree is keyed by
    the `runwield` root and can be removed normally.
  - Update the existing old-root entry in `~/.wld/init-state.json` to the new path, preserving its `initOffered`/
    `initDone` state. Back up the file first and verify RunWield does not offer duplicate initialization after cutover.
- [ ] Refresh disposable indexes and language/tool caches:
  - From the renamed root run `cymbal index . --force`, then verify Cymbal searches and `cymbal ls --repos` identify the
    new root. Treat the old indexed path as stale cache metadata; remove it only through a supported Cymbal mechanism,
    not by editing an unknown database directly.
  - Restart language servers, Deno/npm tooling, test watchers, and Workspace dev servers so they bind to the new root.
    Reinstall dependencies only if path-bearing generated links fail; do not delete `node_modules` or Deno caches by
    default.
  - Rebuild or delete generated `dist/workspace*` artifacts if they still contain old-root build metadata; do not
    hand-edit generated bundles. Recompile `bin/wld` if its development/release workflow expects a fresh artifact at the
    renamed path.
- [ ] Reopen IDEs and external project integrations:
  - Open `/Users/gandazgul/Documents/web/runwield` as a new VS Code/JetBrains project. Confirm source control, Deno,
    launch configurations, tasks, breakpoints, terminals, and indexing use the new root.
  - Let IDEs create new path-keyed workspace storage. Do not bulk-rewrite VS Code History/chat-editing records or
    JetBrains internal workspace databases; keep them as historical state and remove stale Recent entries through UI.
  - Repoint Git GUI clients, terminal profiles/bookmarks, Finder aliases, tmux/zoxide/autojump entries, local file URLs,
    MCP roots, Claude/Codex project permissions, launchd/cron jobs, and sibling-repository scripts that actively target
    the old path. The planning-time sibling-repository scan found no live source/config references outside this
    checkout, while project-local ignored files such as `.idea/workspace.xml`, `.claude/settings.local.json`, and
    generated `dist/` artifacts do contain old-root references; rerun the scan because local state can change.
  - For Claude/Codex, close live processes first, migrate path identity and structural cwd/project metadata as
    specified, retain the old backups for rollback, and prove both old-session resume and new-session creation from
    `runwield`.
- [ ] Run final validation and retain rollback state through a short observation period.

## Verification Plan

- Automated pre-cutover gates:
  - `git status --short` is understood and intentionally preserved; no migration command stages or discards user work.
  - `git worktree list --porcelain` shows only `/Users/gandazgul/Documents/web/harns` before the move.
  - `git fsck --no-dangling`, `git submodule status`, and a recorded `git rev-parse HEAD` succeed.
- Automated post-cutover Git/project checks from `/Users/gandazgul/Documents/web/runwield`:
  - `pwd -P`, `git rev-parse --show-toplevel`, `git rev-parse HEAD`, `git remote -v`, `git status --short`,
    `git worktree list --porcelain`, and `git submodule status` all show the expected new root and unchanged repository
    identity/state.
  - `deno run ci` passes; fix all code-quality failures only if they are caused by the migration, without mixing
    unrelated source changes into this operation.
- Memory checks:
  - `mnemosyne collections` shows `runwield` with the same live document count as the exported `harns` collection.
  - Representative `mnemosyne search --name runwield ...` queries return known project and Core Memories; Global Memory
    results remain unchanged.
- Agent Session checks:
  - RunWield pre/post JSONL file, image-directory, and Memory-backup-directory counts match after accounting for the 12
    `harns_clone` outliers. `wld --continue` and `/resume` list old primary-checkout Agent Sessions; open at least one
    recent and one older session, verify transcript/image hydration, then exit without cwd mismatch.
  - Claude's session list/resume under the new directory finds the same 22 project session IDs and loads the migrated
    `memory/` content; resume one recent and one older ID, then verify `--continue` selects the new-root recent session.
  - Codex's cwd-filtered picker finds the 164 migrated threads, `codex resume --all` still shows them, and direct resume
    of one recent plus one archived ID under `-C /Users/gandazgul/Documents/web/runwield` succeeds. SQLite
    `PRAGMA integrity_check` returns `ok` and no `threads.cwd` row remains for the old root.
- Tool/IDE checks:
  - `command -v wld` resolves to `/Users/gandazgul/Documents/web/runwield/bin/wld`; `type -a wld` has no old-root result
    and no higher-priority `~/.local/bin/wld` shadow; `wld --version` and `wld --help` work from a new shell.
  - Cymbal symbol search reports files under the new root and does not select the stale old root for current-project
    queries.
  - VS Code and the JetBrains IDE open the tracked project, detect Git/Deno, run the existing launch configuration, and
    use terminals whose `pwd` is the new root.
  - Claude Code and Codex recognize the new project/trust identity, start in the new cwd, and resume one migrated old
    session in each tool without reopening the deleted old path.
- Path audit:
  - Search live configuration scopes for `/Users/gandazgul/Documents/web/harns` and `../harns`. Remaining matches must
    be classified as historical content (session messages, Git reflogs, archived Plans, editor History) or intentionally
    retained rollback metadata, not executable configuration.
- Rollback drill/result:
  - If a critical check fails, close path users, rename the folder back, restore RunWield/Claude/Codex session and index
    backups plus the Mnemosyne source collection, restore `.zshrc`/live IDE config backups, and reindex at the old root.
    Do not delete source backups until this path is proven.

## Edge Cases & Considerations

- **Current in-flight state:** the 2026-07-16 refresh found a dirty primary checkout, five RunWield registry entries,
  and three live linked worktrees. These are hard preconditions, not cleanup suggestions; renaming first would break
  linked-worktree gitfiles and Plan Recovery paths.
- **Current Agent Session:** this Plan's own JSONL file will still be receiving writes until RunWield exits. Session
  migration must happen afterward from a separate shell/process.
- **RunWield Session header mismatch:** moving the encoded directory alone is insufficient because
  `openPersistedRootSession` rejects a header cwd that differs from the requested cwd. Conversely, global replacement
  would corrupt historical evidence and user content; edit only the session header.
- **External session formats:** Claude and Codex state layouts are not RunWield APIs and may change before the deferred
  cutover. Re-discover current file counts/schema and CLI help immediately before migration, transform parsed records
  rather than raw text, and restore backups if resume verification fails.
- **Destination collisions:** launching RunWield once from the new directory before migration may create empty
  `runwield` Memory and Agent Session destinations. Merge safely after backup; never overwrite by directory rename.
- **Mnemosyne duplicate IDs/imports:** make import idempotence observable with before/after counts. Do not repeat import
  after a partial success without inspecting the destination.
- **Worktree Memory/Agent Sessions:** linked worktrees have their own basename/path-derived collections and session
  namespaces. Preserve wanted work before deleting worktrees, but do not silently merge all of that state into the main
  project because it changes retrieval semantics and may duplicate facts.
- **Git internals:** historical `.git/logs` paths do not need rewriting. The main worktree can move safely when no
  linked worktrees remain and no `core.worktree` override exists; the Plannotator submodule uses relative
  gitdir/worktree paths.
- **IDE state:** tracked `.idea` and `.vscode` files are already path-relative and RunWield-named. Path-keyed IDE
  caches, local history, chats, recents, and breakpoints may not transfer perfectly; preserve them as backup but prefer
  clean re-open/reindex over editing internal databases.
- **No source rebrand:** old `harns` strings in archived Plans, history, session text, old branch/worktree names, and
  memories are historical. This operation should not revive the completed product rename or rewrite provenance.
- **External references are unbounded:** other repositories, scripts, CI runners, local URLs, aliases, automation, and
  cloud/editor allowlists cannot all be inferred from this checkout. The execution-time path audit must cover the user's
  actual shell, IDE, Git GUI, automation, and sibling-project scopes before declaring the move complete.
- **Resolved user choices:** defer the rename until current Plan work naturally finishes and all linked worktrees are
  gone; preserve resumable RunWield, Claude Code, and Codex session history; and keep `wld` resolving directly from the
  renamed repository's `bin/wld`. Hand-repairing active linked-worktree metadata and switching to a stable user-bin
  installation are intentionally out of scope.
