---
status: accepted
---

# ADR-010: SessionRuntime Sibling Adapter Boundary for ACP

## Context

ADR-009 established Session Host as the external integration boundary and moved session-scoped runtime state into
`HostedSession`. After the Slice 1 refactor, the TUI is no longer supposed to own root session lifecycle, but important
turn orchestration, UI prompting, event rendering, and handoff loops still live near the interactive TUI adapter.

RunWield now needs ACP support without making ACP a wrapper around TUI code. Future clients such as Workspace WebUI,
Takopi/Telegram, IDE integrations, and other transports should attach to the same core runtime surface as the TUI.

## Decision

Introduce a `SessionRuntime` layer above `SessionHost`/`HostedSession` and below all user-interface adapters.
`SessionRuntime` owns adapter-neutral session operations such as create, load, prompt, cancel, close/dispose, event
emission, and interaction requests. The TUI and ACP stdio server are sibling adapters over `SessionRuntime`; future
WebUI, Takopi, Slack/Discord, or other clients should be additional siblings rather than children of the TUI or ACP
adapter.

Session-scoped capabilities must attach to a specific `HostedSession`. Shared agent switching and pending root-swap
application are session-layer behavior, not TUI behavior, so core workflow modules and tools should use a session-layer
helper rather than importing the TUI adapter. Adapter-specific rendering, transport framing, and user input collection
stay outside the core runtime. The ACP adapter maps `SessionRuntime` events and interaction requests to ACP v1 messages,
using standard ACP primitives where possible and RunWield-specific ACP extensions/fallbacks where no standard primitive
exists.

Each Hosted Session carries an absolute project root. Shared catalogs, layered settings, Plans, workflow metrics, memory
commands, validation, and Worktree operations resolve from that root rather than the server process cwd. A Hosted
Session id is an in-process runtime identity and is deliberately distinct from both persisted SessionManager ids and
transport-facing ACP session ids, so loading the same persisted conversation never aliases mutable runtime state.

Adapters consume ordered semantic events and install a typed interaction adapter. They do not pass a rendering object to
`createPromptReadySession()`, `loadSession()`, or `promptSession()`. During the remaining workflow migration,
`SessionRuntime` owns a private compatibility presentation port that translates legacy engine output calls into the same
event stream; this port is not an adapter extension API. New UIs should use `getSessionSnapshot()`, runtime events,
runtime actions, and interaction requests only.

## Consequences

- ACP must not import or call `src/ui/tui/chat-session.js` TUI internals to submit prompts.
- TUI-specific orchestration that is actually session behavior should move into `SessionRuntime` or lower-level shared
  modules.
- Adapter-neutral event and interaction contracts become first-class and reusable by future WebUI/Takopi integrations.
- The first ACP MVP carries medium complexity because it includes the shared runtime seam, not just JSON-RPC method
  handlers.
- Rich external workflow UX can evolve incrementally on top of the interaction contract without requiring another
  TUI-to-core refactor.
- Same-session turn exclusion and cancellation settlement are runtime invariants. Cancellation does not release the turn
  or permit disposal until the underlying Agent Session prompt settles; different Hosted Sessions remain independently
  promptable.
- Production modules under `src/shared` and `src/tools` cannot import `src/ui` or `src/acp`; automated boundary tests
  enforce the dependency direction.
- TUI composition, terminal integration helpers, and their tests live under `src/ui/tui`. The `src/shared` tree is
  reserved for reusable runtime, session, model, workflow, Plan, tool-support, and platform policy.
- Core requests user attention through semantic runtime events. Desktop notification delivery and terminal activation
  are TUI adapter behavior, so ACP or future server adapters never target the host terminal implicitly.
