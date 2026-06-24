---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Implement automatic terminal tab titles and session naming. This includes updating the `triage_report` tool schema and Router prompt to provide a `sessionName`, implementing the logic to apply this name to unnamed sessions, setting the initial terminal title to `wld - <cwd>`, and adding a `/name` slash command for manual session naming."
affectedPaths:
  - "src/tools/triage-report.js"
  - "src/agent-definitions/router.md"
  - "src/shared/interactive/chat-session.js"
  - "src/cmd/registry.js"
  - "src/cmd/name/index.js"
  - "src/shared/ui/tui.js"
createdAt: "2026-06-24T13:51:44-04:00"
updatedAt: "2026-06-24T18:45:28.488Z"
status: "implemented"
origin: "internal"
failureReason: "Primary checkout has uncommitted changes that overlap execution worktree changes; refusing to merge: plans/local-first-plan-management-ui.md"
implementedAt: "2026-06-24T18:36:32.463Z"
worktreeStatus: "merge_conflict"
routingIntent: "FEATURE"
---
# Automatic Session Names and Terminal Titles

## Context

RunWield currently starts interactive TUI sessions with terminal tabs that only identify the process as `wld`, making
multiple active tabs hard to distinguish. The desired behavior is to set an immediate title based on the current
project, then let Router Triage provide a short semantic Session Name that is persisted and mirrored into the Terminal
Title. Users must retain manual control through a Pi-compatible `/name` slash command.

## Objective

Implement automatic, short Session Names and Terminal Titles without introducing an additional model call:

- Set the initial Terminal Title to the current Session Name when resuming a named session, otherwise
  `wld - <cwd basename>`.
- Add a required short `sessionName` field to Router calls to `triage_report`, and update the Router prompt so Router
  explicitly knows to provide it.
- Apply Router-provided names only when the current session is unnamed.
- Persist the applied name with the existing SessionManager session-info mechanism.
- Mirror the current Session Name into the Terminal Title as `wld - <session name>`.
- Add `/name` with upstream Pi behavior: `/name <name>` sets the Session Name, `/name` shows the current name or usage
  when unnamed, and no clear command is added.

## Approach

Use the existing `@earendil-works/pi-tui` title support instead of terminal-specific integrations.
`ProcessTerminal.setTitle(title)` already emits the standard OSC title escape that works in Kitty and most
xterm-compatible terminal emulators. Create a small RunWield terminal-title helper that sanitizes names, formats titles
as `wld - <name>`, and best-effort calls the active TUI terminal.

The Router should always provide `sessionName` in `triage_report` because it already performs semantic Triage. The
runtime, not the Router prompt, decides whether to apply it. This keeps the prompt simple and preserves manual naming:
any existing Session Name prevents auto-naming from overwriting user intent.

## Files to Modify

- `src/shared/ui/terminal-title.js` — create a focused helper for sanitizing Session Names, formatting Terminal Titles,
  and best-effort setting the active terminal title through `getTUI().terminal.setTitle()`.
- `src/shared/ui/terminal-title.test.js` — cover formatting, whitespace/control-character sanitization, truncation, and
  best-effort terminal update behavior.
- `src/tools/triage-report.js` — add required `sessionName` to the tool schema, normalize/sanitize it in returned
  `details`, and keep it available to workflow dispatch.
- `src/tools/__tests__/triage-report.test.js` — cover required/normalized `sessionName`, preservation in details, and
  continued classification normalization.
- `src/agent-definitions/router.md` — instruct Router to include a short 3–6 word `sessionName` in every
  `triage_report`, suitable for both `/session` display and terminal tab title.
- `src/shared/workflow/orchestrator.js` — extend `TriageOutcome` with `sessionName`, preserve it through
  normalization/buildTriageBlock, and apply it to unnamed sessions before dispatching to the next Agent.
- `src/shared/workflow/orchestrator.test.js` — verify `sessionName` survives `readLatestTriageOutcome` and that dispatch
  auto-names only unnamed sessions.
- `src/shared/interactive/chat-session.js` — set the initial Terminal Title after `initTUI()` using the current Session
  Name if one exists, otherwise cwd basename.
- `src/cmd/registry.js` — register `/name` as a slash command and import its handler.
- `src/constants.js` — add `COMMAND_NAMES.NAME` to the command-name constants.
- `src/cmd/name/index.js` — implement Pi-compatible `/name` behavior using the active session manager.
- `src/cmd/name/index.test.js` — test outside-interactive warning, setting a name, showing current name, and showing
  usage when unnamed.
- `src/cmd/new/index.js` — after creating a new session, update the Terminal Title to `wld - <provided name>` when named
  or `wld - <cwd basename>` when unnamed.
- `src/cmd/new/index.test.js` — update expectations for title behavior in named and unnamed new sessions.
- `docs/sessions.md` — document automatic naming, terminal title behavior, and `/name`.
- `docs/usage.md` — add `/name` to slash command reference.
- `docs/index.md` — include `/name` in the common session-management slash commands.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `@earendil-works/pi-tui` `ProcessTerminal.setTitle(title)` — emits `OSC 0;title BEL`; use through RunWield's TUI
  singleton rather than reimplementing escapes.
- `src/shared/ui/tui.js` `getTUI()` — existing singleton access to the active terminal/TUI instance.
- `SessionManager.appendSessionInfo(name)` and `SessionManager.getSessionName()` — existing persisted session-name
  storage already used by `/new` and `/session`.
- `src/cmd/new/index.js` — pattern for accepting a slash-command argument and appending session info.
- `../pi-mono/packages/coding-agent/src/modes/interactive/interactive-mode.ts` `handleNameCommand` — source behavior for
  Pi-compatible `/name` semantics.
- `src/shared/workflow/orchestrator.js` `normalizeTriageOutcome()` — natural place to preserve `sessionName` and perform
  auto-naming before workflow handoff.

## Implementation Steps

- [ ] Step 1: Add terminal title helpers in `src/shared/ui/terminal-title.js`.
  - Export a pure `sanitizeSessionName(value)` that stringifies, trims, removes ASCII control characters/newlines,
    collapses whitespace, and truncates to a tab-friendly maximum around 40 characters.
  - Export a pure `formatTerminalTitle(name)` that returns `wld - <sanitized name>` and falls back to `wld` if no usable
    name is provided.
  - Export `setTerminalTitleForName(name)` that best-effort calls
    `getTUI().terminal.setTitle(formatTerminalTitle(name))` and silently ignores missing TUI/terminal support.
  - Export `setTerminalTitleForSession(sessionManager, cwd)` that uses `sessionManager.getSessionName?.()` when present,
    otherwise the cwd basename.

- [ ] Step 2: Set the startup Terminal Title in `src/shared/interactive/chat-session.js`.
  - After `rootSessionManager` is created and `initTUI()` returns, call
    `setTerminalTitleForSession(rootSessionManager, Deno.cwd())`.
  - This makes continued named sessions show their existing name immediately and unnamed sessions show
    `wld - <cwd basename>` before agent initialization.

- [ ] Step 3: Extend `triage_report` and Router instructions.
  - Add `sessionName: Type.String(...)` to `TOOL_PARAMS` in `src/tools/triage-report.js`; because `Type.Object` fields
    are required by default in this codebase, update tests and Router prompt accordingly.
  - In `normalizeTriageParams()`, sanitize `sessionName` with the shared helper before returning details. If
    sanitization yields empty text, use a safe fallback derived from `summary` or `"RunWield session"` so the returned
    detail is always non-empty.
  - Update `src/agent-definitions/router.md` to list `sessionName` as a required `triage_report` field and give examples
    such as `terminal titles`, `plan board UI`, `fix model routing`.

- [ ] Step 4: Preserve and use `sessionName` in workflow dispatch.
  - Extend the `TriageOutcome` typedef in `src/shared/workflow/orchestrator.js` with `sessionName`.
  - Ensure `normalizeTriageOutcome()` preserves a sanitized `sessionName` when present, while tolerating missing
    `sessionName` in older persisted/historical tool results.
  - Add an `applyAutoSessionName(sessionManager, triage, setTitle = setTerminalTitleForName)` helper or inline
    equivalent near the start of `dispatchPostTriage()`.
  - Only auto-apply when `sessionManager.getSessionName?.()` is empty and `triage.sessionName` is non-empty.
  - Persist with `sessionManager.appendSessionInfo(triage.sessionName)`.
  - Update the Terminal Title to the effective Session Name: the newly auto-applied name if unnamed, otherwise the
    existing manual name.
  - Include `Session Name` in `buildTriageBlock()` only if useful for downstream agents; avoid making downstream agents
    treat it as implementation scope.

- [ ] Step 5: Add Pi-compatible `/name`.
  - Add `NAME: "name"` to `COMMAND_NAMES`.
  - Create `src/cmd/name/index.js`.
  - Outside interactive mode, print `The /name command is only available inside an interactive session.` to
    `console.error`.
  - With args: join and trim args, sanitize the result, append session info, update Terminal Title, and append a
    dim/system confirmation like `Session name set: <name>`.
  - With no args and an existing name: append/display `Session name: <currentName>`.
  - With no args and no existing name: append/display `Usage: /name <name>`.
  - Do not implement `/name --clear` or empty-string clearing in this feature.

- [ ] Step 6: Register `/name` and update `/new` title behavior.
  - Import and register `runNameCommand` in `src/cmd/registry.js` with slash surface only, display name `Session Name`,
    and summary `Set or show the current session name.`
  - Add `/name <name>` and `/name` usage rows.
  - In `src/cmd/new/index.js`, after replacing the root session manager, call
    `setTerminalTitleForSession(rootSessionManager, Deno.cwd())` so `/new name` and `/new` both update the tab
    immediately.

- [ ] Step 7: Update tests.
  - `terminal-title.test.js`: pure sanitization/formatting plus injected or mocked terminal update behavior.
  - `triage-report.test.js`: schema includes required `sessionName`; execute returns sanitized/preserved `sessionName`;
    plan Classification preservation remains unchanged.
  - `orchestrator.test.js`: `readLatestTriageOutcome()` keeps `sessionName`; auto-naming appends session info only when
    unnamed; existing names are not overwritten; title updater is called with the effective name.
  - `name/index.test.js`: all Pi-compatible command branches.
  - `new/index.test.js`: title helper/dependency invoked for named and unnamed new sessions.

- [ ] Step 8: Update user-facing docs.
  - Add `/name` to `docs/usage.md` slash command table.
  - Update `docs/sessions.md` to describe automatic Router-provided Session Names, manual override through `/name`, and
    title fallback behavior.
  - Update `docs/index.md` common commands row from `/resume`, `/new`, `/session` to include `/name`.

## Verification Plan

- Automated: `deno task ci`
- Targeted during development:
  - `deno test -A src/shared/ui/terminal-title.test.js`
  - `deno test -A src/tools/__tests__/triage-report.test.js`
  - `deno test -A src/shared/workflow/orchestrator.test.js src/cmd/name/index.test.js src/cmd/new/index.test.js`
  - `deno check --doc src/**/*.js`
- Manual:
  - Start `wld` in Kitty from a project directory; tab title should quickly become `wld - <cwd basename>` for an unnamed
    session.
  - Continue a named session; tab title should quickly become `wld - <existing session name>`.
  - Submit a fresh request that routes through Router; after Triage, `/session` should show the Router-provided Session
    Name and the terminal tab should read `wld - <session name>`.
  - Run `/name custom title`; `/session` and the terminal tab should both show `custom title`.
  - Submit another routed request in that named session; Router may provide a new `sessionName`, but the existing manual
    name must remain unchanged.
  - Run `/new optional name`; the new session should be named `optional name` and the tab should update.
  - Run `/new` without a name; the tab should fall back to `wld - <cwd basename>` until a Router-provided name is
    applied.
  - its ok if deno fmt formats other not related files formatting only changes are ok

## Edge Cases & Considerations

- **Manual override preservation:** The implementation must check `getSessionName()` before applying Router auto-names.
  Do not rely on Router knowing whether the session is named.
- **Title safety:** Strip control characters and newlines from Router-generated names before writing OSC title
  sequences.
- **Terminal compatibility:** Standard OSC title setting should work in Kitty and most xterm-compatible emulators, but
  shell integrations or tmux/screen can overwrite or block titles. This should remain best-effort.
- **No extra model call:** Do not add a cheap/local title model. Router already produces the name during normal Triage.
- **Short names:** Keep Session Names tab-friendly. Favor 3–6 words and avoid full summaries.
- **Historical sessions:** Older persisted `triage_report` details may not contain `sessionName`; normalization should
  tolerate that while new tool calls require it.
- **Existing dirty working tree:** Current checkout has unrelated dirty files (`CONTEXT.md`,
  `docs/adr/007-local-first-workspace-plan-board.md`, and `plans/local-first-plan-management-ui.md`). Avoid modifying or
  depending on them except where this plan explicitly lists docs to update.
