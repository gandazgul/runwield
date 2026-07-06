# ADR-010: SessionRuntime Sibling Adapter Boundary for ACP

## Status

Accepted

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

Session-scoped capabilities must attach to a specific `HostedSession`. Adapter-specific rendering, transport framing,
and user input collection stay outside the core runtime. The ACP adapter maps `SessionRuntime` events and interaction
requests to ACP v1 messages, using standard ACP primitives where possible and RunWield-specific ACP extensions/fallbacks
where no standard primitive exists.

## Consequences

- ACP must not import or call `src/shared/interactive/chat-session.js` TUI internals to submit prompts.
- TUI-specific orchestration that is actually session behavior should move into `SessionRuntime` or lower-level shared
  modules.
- Adapter-neutral event and interaction contracts become first-class and reusable by future WebUI/Takopi integrations.
- The first ACP MVP carries medium complexity because it includes the shared runtime seam, not just JSON-RPC method
  handlers.
- Rich external workflow UX can evolve incrementally on top of the interaction contract without requiring another
  TUI-to-core refactor.
