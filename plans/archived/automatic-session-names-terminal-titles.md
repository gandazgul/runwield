---
planId: "fcdc3cfb-4111-4ea4-bef2-9f29d0e0cf51"
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
updatedAt: "2026-06-24T18:47:12.854Z"
status: "verified"
origin: "internal"
implementedAt: "2026-06-24T18:36:32.463Z"
verifiedAt: "2026-06-24T18:47:12.854Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
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
xterm-compatible terminal emulators. Add a small RunWield wrapper/helper for sanitizing and applying titles so chat
startup, triage handling, `/new`, and `/name` share the same formatting.

The Router should always provide `sessionName` in `triage_report` because it already performs semantic Triage. The
runtime, not the Router prompt, decides whether to apply it. This keeps the prompt simple and preserves manual naming:
any existing Session Name prevents auto-naming from overwriting user intent.

## Files to Modify

- `src/tools/triage-report.js` — add `sessionName` to the tool schema, normalize/sanitize it in returned `details`, and
  keep it available to workflow dispatch.
- `src/tools/__tests__/triage-report.test.js` — cover required/normalized `sessionName`, preservation in details, and
  legacy behavior where appropriate.
- `src/agent-definitions/router.md` — instruct Router to include a short 3–6 word `sessionName` in every
  `triage_report`, suitable for both `/session` display and terminal tab title.
- `src/shared/workflow/orchestrator.js` — extend `TriageOutcome` with `sessionName`, preserve it through
  normalization/buildTriageBlock, and apply it to unnamed sessions before dispatching to the next Agent.
- `src/shared/workflow/orchestrator.test.js` — verify `sessionName` survives `readLatestTriageOutcome` and that dispatch
  auto-names only unnamed sessions.
- `src/shared/session/agent-handler.js` — inject/pass any new triage auto-naming dependency if the implementation keeps
  naming in the handler instead of the orchestrator.
- `src/shared/session/agent-handler.test.js` — update expected dispatch arguments if new dependency plumbing is added.
- `src/shared/interactive/chat-session.js` — set the initial Terminal Title after `initTUI()`, add shared title-update
  hooks to slash command context if needed, and ensure current names are mirrored after session/name changes.
- `src/shared/interactive/slash-dispatch.js` — pass any title/name update callbacks through `CommandContext` so slash
  commands can update Terminal Title without reaching into global UI state.
- `src/shared/interactive/slash-dispatch.test.js` — update the built-in command dependency expectations if new context
  fields are passed.
- `src/shared/ui/tui.js` — expose a safe title-setting helper if direct access to `getTUI().terminal.setTitle()` should
  not be repeated across features.
- `src/shared/ui/tui-manager.js` — optionally add manager-level `setTitle(title)` support for testable terminal access.
- `src/shared/ui/tui-manager.test.js` — cover manager title setting and no-op/error-safe behavior if added.
- `src/shared/ui/types.js` — add JSDoc fields for any new `CommandContext`, `TuiAPI`, or title-update callback types.
- `src/cmd/registry.js` — register `/name` as a slash command and import its handler.
- `src/constants.js` — add `COMMAND_NAMES.NAME` to the command-name constants.
- `src/cmd/name/index.js` — implement Pi-compatible `/name` behavior using the active session manager.
- `src/cmd/name/index.test.js` — test outside-interactive warning, setting a name, showing current name, and showing
  usage when unnamed.
- `src/cmd/new/index.js` — after creating a new session, update the Terminal Title to `wld - <provided name>` when named
  or `wld - <cwd basename>` when unnamed.
- `src/cmd/new/index.test.js` — update expectations for title callback behavior if `/new` gets that callback.
- `docs/sessions.md` — document automatic naming, terminal title behavior, and `/name`.
- `docs/usage.md` — add `/name` to slash command reference.
- `docs/index.md` — include `/name` in the common session-management slash commands.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `@earendil-works/pi-tui` `ProcessTerminal.setTitle(title)` — emits `OSC 0;title BEL`; use through RunWield's TUI
  singleton rather than reimplementing escapes.
- `src/shared/ui/tui.js` / `src/shared/ui/tui-manager.js` — existing singleton access to the active terminal/TUI
  instance.
- `SessionManager.appendSessionInfo(name)` and `SessionManager.getSessionName()` — existing persisted session-name
  storage already used by `/new` and `/session`.
- `src/cmd/new/index.js` — pattern for accepting a slash-command argument and appending session info.
- `../pi-mono/packages/coding-agent/src/modes/interactive/interactive-mode.ts` `handleNameCommand` — source behavior for
  Pi-compatible `/name` semantics.
- `src/shared/workflow/orchestrator.js` `normalizeTriageOutcome()` — natural place to preserve `sessionName` and perform
  auto-naming before workflow handoff.
- `src/shared/interactive/slash-dispatch.js` `dispatchBuiltin()` — existing path for injecting session and UI
  dependencies into slash command handlers.

## Implementation Steps

- [ ] Step 1: Add a small terminal-title utility path.
  - Prefer a helper such as `setTerminalTitleFromSessionName(sessionName)` / `setTerminalTitleFallback(cwd)` in
    `src/shared/ui/tui.js` or a focused helper module.
  - Format titles as `wld - <name>`.
  - Sanitize control characters/newlines and trim whitespace.
  - Truncate defensively to a short tab-friendly length (for example 60 visible characters for the final title or about
    40 for the Session Name).
  - Make title setting best-effort: failures or missing terminal title support must not break a session.

- [ ] Step 2: Set an immediate fallback title on TUI startup.
  - In `startInteractiveSession()` after `initTUI()`, compute
    `path.basename(rootSessionManager.getCwd?.() || Deno.cwd())` or equivalent.
  - Set `wld - <cwd basename>` before agent initialization so the tab changes quickly.
  - Add or update tests around the TUI manager/helper rather than trying to spin up the full TUI.

- [ ] Step 3: Extend the Triage Report schema and Router instructions.
  - Add `sessionName` to `TOOL_PARAMS` in `src/tools/triage-report.js` with a description requiring a short descriptive
    title.
  - Normalize `sessionName` in `normalizeTriageParams()` by trimming, removing control characters, collapsing
    whitespace, and truncating.
  - Decide whether schema-level `sessionName` is required. Recommended: make it required for Router calls so every
    future Triage Report carries it; tolerate missing values during legacy normalization/tests if TypeBox allows
    existing direct calls.
  - Update `src/agent-definitions/router.md` to mention `sessionName` in the required `triage_report` fields and give
    examples such as `terminal titles`, `plan board UI`, `fix model routing`.

- [ ] Step 4: Preserve and use `sessionName` in workflow dispatch.
  - Extend the `TriageOutcome` typedef in `src/shared/workflow/orchestrator.js` with optional `sessionName`.
  - Ensure `normalizeTriageOutcome()` preserves a sanitized `sessionName`.
  - Add an `applyAutoSessionName(sessionManager, triage, titleUpdater)` helper or inline equivalent before
    building/decorating handoff context.
  - Only auto-apply when `sessionManager.getSessionName?.()` is empty and `triage.sessionName` is non-empty.
  - Use `sessionManager.appendSessionInfo(triage.sessionName)` to persist it.
  - Immediately update the Terminal Title to mirror the applied or existing Session Name.
  - Include `Session Name` in `buildTriageBlock()` only if useful for downstream agents; avoid letting downstream agents
    treat it as implementation scope.

- [ ] Step 5: Add Pi-compatible `/name`.
  - Add `NAME: "name"` to `COMMAND_NAMES`.
  - Create `src/cmd/name/index.js`.
  - Outside interactive mode, print `The /name command is only available inside an interactive session.` to
    `console.error`.
  - With args: join and trim args, append session info, update Terminal Title, and append a dim/system confirmation like
    `Session name set: <name>`.
  - With no args and an existing name: append/display `Session name: <currentName>`.
  - With no args and no existing name: append/display `Usage: /name <name>`.
  - Do not implement `/name --clear` or empty-string clearing in this feature.

- [ ] Step 6: Wire title updates through slash commands and session changes.
  - Extend `CommandContext` with a callback such as `updateTerminalTitle?: (name?: string) => void` or with a narrower
    `setSessionNameAndTitle?: (name: string) => void` if preferred.
  - Pass this callback from `startInteractiveSession()` into `handleSlashCommand()` and then `dispatchBuiltin()`.
  - Update `/new` to call the callback after replacing the root session manager; use the provided `/new <optional name>`
    if present, otherwise fall back to cwd basename.
  - Ensure `/name` updates the title immediately after persisting the new Session Name.

- [ ] Step 7: Update tests.
  - `triage-report.test.js`: schema includes `sessionName`; execute returns sanitized/preserved `sessionName`;
    legacy/non-plan routing still behaves correctly.
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
  - Start `wld` in Kitty from a project directory; tab title should quickly become `wld - <cwd basename>`.
  - Submit a fresh request that routes through Router; after Triage, `/session` should show the Router-provided Session
    Name and the terminal tab should read `wld - <session name>`.
  - Run `/name custom title`; `/session` and the terminal tab should both show `custom title`.
  - Submit another routed request in that named session; Router may provide a new `sessionName`, but the existing manual
    name must remain unchanged.
  - Run `/new optional name`; the new session should be named `optional name` and the tab should update.
  - Run `/new` without a name; the tab should fall back to `wld - <cwd basename>` until a Router-provided name is
    applied.

## Edge Cases & Considerations

- **Manual override preservation:** The implementation must check `getSessionName()` before applying Router auto-names.
  Do not rely on Router knowing whether the session is named.
- **Title safety:** Strip control characters and newlines from Router-generated names before writing OSC title
  sequences.
- **Terminal compatibility:** Standard OSC title setting should work in Kitty and most xterm-compatible emulators, but
  shell integrations or tmux/screen can overwrite or block titles. This should remain best-effort.
- **No extra model call:** Do not add a cheap/local title model. Router already produces the name during normal Triage.
- **Short names:** Keep Session Names tab-friendly. Favor 3–6 words and avoid full summaries.
- **Continued sessions:** On `--continue`, if the resumed session already has a name, set the Terminal Title to that
  name instead of cwd fallback once the root session manager is loaded.
- **Existing dirty working tree:** Current checkout has unrelated dirty files (`CONTEXT.md`,
  `docs/adr/007-local-first-workspace-plan-board.md`, and `plans/local-first-plan-management-ui.md`). Avoid modifying or
  depending on them except where this plan explicitly lists docs to update.
