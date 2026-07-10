---
planId: "3ad308ff-84a9-4526-b09d-9b0cbeb49f70"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Make sleep mode create a session-scoped Mnemosyne backup mechanically, show its path, and continue with Engineer for follow-up memory cleanup."
affectedPaths:
    - "src/cmd/sleep/index.js"
    - "src/cmd/sleep/index.test.js"
    - "src/cmd/sleep/prompt.md"
    - "src/shared/session/root-session.js"
    - "src/shared/session/root-session.test.js"
    - "src/cmd/registry.js"
frontend: false
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-07-09T23:35:35-04:00"
status: "draft"
origin: "internal"
---

# Safe Engineer Sleep Mode

## Context

`/sleep` currently asks a disposable Operator Agent Session to run `mnemosyne export --no-embeddings` into the project
root before optimizing the current project's memories. That leaves backup creation to Agent judgment, creates untracked
repository files, and returns follow-up User Requests to the previous Agent. The requested behavior is a RunWield-owned
safety checkpoint: export the relevant Mnemosyne collection outside the repository before any mutation, tell the user
where it was saved, then make Engineer the active root Agent Session so the user can inspect or correct the cleanup.

The existing command-owned prompt must remain non-overridable. The working tree also contains intentional, uncommitted
conservative sleep-prompt refinements (lossless consolidation rules, deletion classification, manifesting, and a
large-deletion approval threshold). Preserve those safety rules, but remove responsibility for creating or protecting
the pre-maintenance recovery backup from the Agent prompt. The backup is for the current project's Mnemosyne collection,
including memories tagged `core`; sleep mode does not broaden its cleanup scope to unrelated project collections.

## Objective

Make sleep mode deterministically create a restorable, session-scoped Mnemosyne JSONL backup under
`~/.wld/sessions/<encoded-cwd>/<session-id>_memory-backups/`, announce the absolute backup path before Engineer starts
memory optimization, and keep Engineer active after the initial sleep turn for follow-up User Requests.

## Approach

Add a root-session path helper parallel to the existing image-artifact helper, and have the slash-command path derive a
unique timestamped backup path from the active Hosted Session/root SessionManager. Run
`mnemosyne export --name <collection> --no-embeddings -o <absolute-path>` directly through a checked subprocess. Create
the destination directory first, verify the subprocess succeeded and produced the expected file, and fail closed—do not
start Engineer if the safety backup cannot be created.

After a successful export, emit a RunWield system message containing the absolute backup path, switch the Hosted Session
to an Engineer message handler through the existing `setActiveAgent`/`applyPendingRootSwap` seam, and run the built-in
sleep instructions as an Engineer root turn rather than a disposable Operator invocation. Pass the immutable backup path
to Engineer as run-specific context so it can inspect the exported collection, but remove every instruction that makes
Engineer create, choose, overwrite, or validate the pre-maintenance backup. Preserve the prompt's existing conservative
mutation rules and keep the inlined prompt and `prompt.md` synchronized for compiled and source use. Any manifest,
post-maintenance export, or report retained by those rules must use the same session artifact directory rather than the
repository root.

For standalone `wld sleep`, launch the normal interactive TUI with Engineer as the initial Agent and `/sleep` as its
initial submission. The existing TUI startup path will then dispatch the same built-in slash command after creating the
persisted SessionManager, so the backup uses the real Session ID and the TUI remains open for Engineer follow-ups. Per
the user's choice, preserve `--no-embeddings`; restoration must re-embed the imported memory documents.

## Files to Modify

- `src/cmd/sleep/index.js` — route standalone invocation into an Engineer TUI, create and validate the mechanical
  Mnemosyne backup on slash execution, announce its path, and activate/run Engineer as the persistent root Agent
  Session.
- `src/cmd/sleep/index.test.js` — cover standalone TUI startup, export ordering, command arguments/path, fail-closed
  behavior, Engineer root activation, follow-up handler persistence, and the backup-path system message.
- `src/cmd/sleep/prompt.md` — preserve the current uncommitted conservative cleanup rules, remove Agent-owned recovery
  backup creation/validation, and redirect retained manifest/post-maintenance-export/report artifacts away from the
  repository root.
- `src/shared/session/root-session.js` — expose a canonical session-scoped memory-backup directory helper alongside the
  image artifact helper.
- `src/shared/session/root-session.test.js` — verify memory-backup paths stay under the encoded RunWield Session
  directory and are namespaced by Session ID.
- `src/cmd/registry.js` — update sleep command summary/notes to describe Engineer, the mechanical backup, and persistent
  TUI follow-ups instead of an isolated Operator session.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/root-session.js` — reuse `getRunWieldSessionDir` and mirror `getRunWieldSessionImageDir` naming
  and containment rather than constructing a separate home-directory convention.
- `src/shared/session/agent-switching.js` — use the active-Agent switch and pending-root-swap lifecycle so subsequent
  TUI submissions continue with Engineer.
- `src/shared/session/agent-handler.js` — install `createAgentHandler(AGENTS.ENGINEER, { hostedSession })` for follow-up
  User Requests.
- `src/shared/session/session.js` — run the first cleanup instruction through the rebuilt root Agent Session
  (`runRootTurn` or the equivalent root-session path), not `useRootSession: false`.
- `src/ui/tui/chat-session.js` — reuse `startInteractiveSession("/sleep", ..., { initialAgentName: AGENTS.ENGINEER })`
  for standalone `wld sleep`; the existing initial-submission path already dispatches built-in slash commands after the
  persisted SessionManager and TUI UI API exist, so this module should not require modification.
- `src/extensions/mnemosyne/index.js` — match its project collection-name derivation from the working-directory
  basename, including the existing `global` to `default` normalization.
- `src/shared/runtime-preflight.js` — retain `ensureMnemosyneBinary` before attempting export.

## Implementation Steps

- [ ] Add and test a canonical `getRunWieldSessionMemoryBackupDir(cwd, sessionId)` helper that returns a sibling
      artifact directory under the encoded RunWield Session directory, parallel to `<session-id>_images`.
- [ ] Split `runSleepCommand` by invocation surface: without a TUI `uiAPI`, launch the normal interactive TUI with
      Engineer as the initial Agent and `/sleep` as the initial submission; from slash dispatch, continue with the
      backup-and-cleanup flow without recursively starting another TUI.
- [ ] Refactor sleep command dependencies into testable JSDoc-typed helpers for TUI startup, the Mnemosyne subprocess,
      current time, Agent handler creation, active-Agent switching, and root-turn execution without introducing
      TypeScript syntax.
- [ ] Resolve the project collection name, active Session ID, artifact directory, and collision-resistant timestamped
      `.jsonl` path; create the directory and mechanically invoke
      `mnemosyne export --name <collection> --no-embeddings -o <absolute-path>` without a shell or confirmation prompt.
- [ ] Treat directory creation, nonzero export status, or missing output as a hard safety failure: report/throw the
      actionable error and leave the current Agent and all memories untouched.
- [ ] After export success, append the first RunWield system message with the absolute backup path, then activate
      Engineer with a workflow-aware handler, apply the pending root swap, and submit the sleep instructions plus the
      run-specific, read-only backup/artifact path to Engineer's root Agent Session so later TUI User Requests retain
      the same Engineer context.
- [ ] Synchronize both copies of the command-owned sleep prompt from the current conservative working-tree version:
      preserve lossless-consolidation, deletion-classification, manifest, approval-threshold, and reporting safeguards;
      remove every instruction that delegates pre-maintenance backup creation or validation to Engineer; and keep any
      retained manifest, post-maintenance export, or report output in the supplied session artifact directory rather
      than the project root.
- [ ] Update registry help text and unit tests for the new safety and Agent Session lifecycle, including standalone CLI
      startup into an Engineer TUI and slash-command execution without recursive startup.
- [ ] Run formatting and the full configured quality gate, fixing all failures introduced by the change.

## Verification Plan

- Automated: run `deno test src/cmd/sleep/index.test.js src/shared/session/root-session.test.js` during focused
  iteration.
- Automated: run
  `deno fmt --check src/cmd/sleep/index.js src/cmd/sleep/index.test.js src/cmd/sleep/prompt.md src/shared/session/root-session.js src/shared/session/root-session.test.js src/cmd/registry.js`.
- Automated: run the repository's full required quality gate, `deno task ci`, and fix all failures.
- Manual: in a disposable Mnemosyne collection/session, invoke `/sleep`; verify the first sleep-specific system message
  shows an absolute path under `~/.wld/sessions/<encoded-cwd>/<session-id>_memory-backups/`, the JSONL exists before the
  first Engineer tool call, Engineer receives that path as read-only context, and no backup, manifest, or report appears
  in the repository root.
- Manual: run standalone `wld sleep`; verify it opens the normal TUI directly on Engineer, executes the same mechanical
  backup and cleanup flow using the persisted Session ID, and remains open for follow-up User Requests.
- Manual: after each invocation surface's initial cleanup response, submit a follow-up question and verify the
  footer/response remains on Engineer with the same root Agent Session context.
- Manual: force the export subprocess to fail (or use a test double) and verify Engineer is not activated, no memory
  mutation begins, and the user receives an actionable error.
- Expected: repeated sleep runs create distinct backups and never overwrite an earlier recovery point.
- Expected: the `--no-embeddings` backup imports successfully into a disposable Mnemosyne collection and Mnemosyne
  re-embeds the restored documents.

## Edge Cases & Considerations

- Backup safety takes precedence over cleanup: export failure must abort before Engineer can delete or rewrite memories.
- Session IDs and timestamps must be used only as path segments generated by RunWield; avoid accepting user-controlled
  output paths and ensure parent directories are created recursively.
- Preserve command-owned prompt behavior so local/home prompt-template overrides cannot weaken the mechanical backup or
  cleanup rules. The existing uncommitted conservative prompt edits are approved input to this feature and must not be
  discarded while synchronizing the inlined prompt.
- The user explicitly chose consistent follow-ups on both surfaces: standalone `wld sleep` must open an Engineer TUI,
  while `/sleep` must switch the current TUI to Engineer.
- The user explicitly chose compact `--no-embeddings` backups. Recovery therefore depends on Mnemosyne's import-time
  re-embedding and may not preserve byte-identical vectors, but it must preserve exported memory documents and tags.
- The working tree already contains unrelated modifications (`CONTEXT.md`, other Plans, runtime-adapter files, and root
  JSONL exports). The implementation must not overwrite, clean, or incorporate those files. The sole exception is the
  approved uncommitted `src/cmd/sleep/prompt.md` input described above.
