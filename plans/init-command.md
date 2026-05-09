---
classification: "PROJECT"
complexity: "HIGH"
summary: "Implement `hns init` CLI command and `/init` TUI slash command."
affectedPaths:
    - "src/constants.js"
    - "src/cmd/registry.js"
    - "src/cmd/init/index.js"
    - "src/cmd/init/init-state.js"
    - "src/cmd/init/init-agent.md"
    - "src/shared/interactive/chat-session.js"
    - "src/cmd/help/index.js"
    - "prompts/init.md"
    - "prompts/CONTEXTmd-format.md"
createdAt: "2026-05-08T00:00:00Z"
updatedAt: "2026-05-08T21:19:49.219Z"
status: "completed"
origin: "internal"
---

# Init Command Implementation

## Context

The user wants an `init` command accessible via `hns init` (CLI) and `/init` (TUI). It runs a special "init" agent that
bootstraps a project for Harns. The agent must be **invisible** to `/agent` and `switch_agent` — it can only be
triggered via init. A global state file tracks per-project init status so re-runs are warned against, `/init` disappears
from autocomplete once done, and first-time visitors get an auto-offer.

## Objective

1. Register `init` as both a CLI and slash command.
2. Create the command handler with guard logic (check global state before running).
3. Move the init prompt template into `src/cmd/init/` so it's not discoverable via normal agent/template loading.
4. Build a global state module (`~/.hns/init-state.json`) keyed by CWD hash with `initOffered` and `initDone` booleans.
5. Wire auto-offer at TUI startup for never-offered CWDs.
6. Dynamically exclude `/init` from slash autocomplete once init is done for the current project.

## Vertical Slice Findings

- **Command registry** (`src/cmd/registry.js`): Every command needs a name, `isSlash`, `isCli` flags, and an `execute`
  handler. Slash commands are surfaced in TUI autocomplete via `CHAT_BUILTIN_SLASH_NAMES` (built from `commandRegistry`
  entries where `isSlash` is true) in `chat-session.js`.
- **Agent hiding**: The `/agent` command lists agents from `src/agent-definitions/` and `~/.hns/agents/` via
  `listAgentDefNames()` / `listAvailableAgents()`. The init agent will NOT be placed in those directories — it's loaded
  directly by path in the init handler, using `loadAgentDef` with a custom path or by reading the prompt and dispatching
  via `runAgentSession` directly.
- **Global state**: `~/.hns/` already exists (contains `settings.json`, `agents/`). New state file
  `~/.hns/init-state.json` fits naturally here.
- **Slash dispatch**: `handleSlashCommand` in `slash-dispatch.js` checks `ctx.builtinNames` (which is
  `CHAT_BUILTIN_SLASH_NAMES`). If `/init` is still in that set, it routes to `commandRegistry["init"]`. Removing it from
  the set + filtering from autocomplete hides it.
- **Boot banner / session start**: `startInteractiveSession` in `chat-session.js` is the right place for the auto-offer
  prompt — it already has TUI access and runs before any user input.

## Files to Modify

- **`src/constants.js`** — Add `INIT: "init"` to `COMMAND_NAMES`.
- **`src/cmd/registry.js`** — Register `init` command definition with `isSlash: true`, `isCli: true`,
  `execute: runInitCommand`.
- **`src/cmd/init/index.js`** — New. Command handler: CLI and TUI dispatch, init-state guard, runs init agent via
  `runAgentSession`, records success.
- **`src/cmd/init/init-state.js`** — New. Reads/writes `~/.hns/init-state.json`. Provides `getInitState()`,
  `recordInitOffered()`, `recordInitDone()`, `isInitDone()`, `isInitOffered()`.
- **`src/cmd/init/init-agent-prompt.md`** — New. Content moved from `prompts/init.md`. This is the init agent's system
  prompt.
- **`src/cmd/init/CONTEXTmd-format.md`** — New. Reference doc moved from `prompts/CONTEXTmd-format.md`.
- **`src/shared/interactive/chat-session.js`** — Add auto-offer logic after TUI init but before main loop. Conditionally
  filter `/init` from `CHAT_BUILTIN_SLASH_NAMES` and autocomplete if init already done.
- **`src/cmd/help/index.js`** — No structural change needed (it reads from registry dynamically), but noted for
  awareness.
- **`prompts/init.md`** — Delete after content is moved.
- **`prompts/CONTEXTmd-format.md`** — Delete after content is moved.

## Reuse Opportunities

- `runAgentSession` from `src/shared/session/session.js` — directly used to run the init agent.
- `loadAgentDef` from `src/shared/session/session.js` — can load agent defs from any path; used to load the init agent
  from a non-standard location.
- `CombinedAutocompleteProvider` from `@earendil-works/pi-tui` — already used for slash commands; we filter `/init` out
  conditionally.
- `Deno.env.get("HOME")` pattern already used in `settings.js` and `session.js` for global paths.
- `CHAT_BUILTIN_SLASH_NAMES` set already controls which `/` commands are recognized — filtering from it is the natural
  way to hide `/init`.

## Verification Plan

- **Automated**: `deno run ci` from repo root. All existing tests must pass. New behavior tested manually or with
  temp-dir integration tests.
- **Manual smoke tests**:
  1. Create a temp dir, run `hns init` → should launch init agent, create `~/.hns/init-state.json` with matching CWD
     hash and `initDone: true`.
  2. Run `hns init` again in same dir → should warn about prior init and exit.
  3. Open TUI in a new temp dir → should see `/init` in autocomplete, get auto-offer prompt, `/init` works.
  4. After init completes in TUI → `/init` no longer in autocomplete, `/agent` does not list init agent.
  5. Declining auto-offer → records `initOffered: true, initDone: false`, no more offers on that dir.

## Edge Cases & Considerations

- **CWD hash stability**: Use SHA-256 of absolute CWD path. If user moves the project directory, it's treated as a new
  project (re-offer is acceptable).
- **Race condition on state file**: State writes happen after agent completes. Use synchronous writes
  (`Deno.writeTextFileSync`) since init is a one-shot operation.
- **Init agent failure**: If the agent session throws or is aborted, do NOT record `initDone: true`. The user can retry.
- **Auto-offer UX**: Show a non-blocking prompt (e.g., `uiAPI.promptSelect("Run init?")`) after boot banner but before
  the user's first message. Must not block if TUI is used non-interactively.
- **Prompt template migration**: The `init.md` prompt imports `CONTEXTmd-format.md` via a relative reference. After
  moving both into `src/cmd/init/`, verify the reference still resolves correctly or update it.
- **State file format**: JSON with top-level keys keyed by CWD hash. Example:
  `{"abc123...": {"initOffered": true, "initDone": true}}`. Keep it simple; no schema versioning needed for v1.
