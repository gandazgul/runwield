# PRD: RunWield Session Host and ACP Integration

**Status:** Draft\
**Author:** Gandazgul + RunWield Ideator\
**Last Updated:** 2026-07-03

---

## 1. Objective

Make RunWield usable from external clients without coupling those clients to the TUI. The strategic integration contract
is **Agent Client Protocol (ACP)** in RunWield core, backed by a multi-session **Session Host** that can power the
existing TUI, IDE integrations, Workspace UI actions, and a Takopi-based Telegram bridge.

The first milestone is not an ACP demo. It is a TUI-preserving internal refactor: the existing TUI must run through the
Session Host with no intended behavior change.

## 2. Problem Statement

RunWield currently behaves like a single interactive TUI session. Runtime concepts such as the root Agent Session,
active Agent, active UI API, pending root swap, pending handoff, model state, and execution workflow are stored in
global process state. That works for one terminal session, but it blocks richer external clients:

- ACP clients need explicit session create/load/prompt/cancel semantics.
- Telegram needs multiple chat/topic/project contexts, potentially active at the same time.
- Workspace UI should eventually start or resume RunWield sessions without booting a terminal UI.
- Plannotator/collab links should be returned to external clients as workflow events, not TUI-only interactions.
- A custom RunWield RPC would be less useful long term than ACP unless it could reuse Pi's protocol almost directly,
  which appears unlikely because RunWield owns additional workflow semantics.

## 3. Resolved Assumptions

| Decision                                             | Rationale                                                                                                                                                                                                                                |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ACP is the canonical external protocol**           | ACP is a broader ecosystem bet for IDEs and super-harness integrations. Telegram should not drive a one-off protocol if ACP can serve the long-term shape.                                                                               |
| **ACP lives in RunWield core**                       | A separate adapter would still need a stable machine-controllable RunWield surface. Implementing ACP in core avoids an extra translation layer.                                                                                          |
| **Session Host comes before ACP**                    | ACP should expose RunWield behavior; it should not be forced to reach into TUI globals.                                                                                                                                                  |
| **Multi-session is required**                        | IDEs, Telegram topics, project contexts, and future Workspace sessions all need more than one live session per process.                                                                                                                  |
| **Replace global session state rather than shim it** | This is an architecture shake-up; keeping compatibility globals risks preserving the single-session assumption. The safer long-term cut is to move state ownership into Hosted Sessions and rely on tests to catch behavior regressions. |
| **Use an isolation branch for the refactor**         | Slice 1 is intentionally allowed to break internals while the Session Host boundary is established; normal development should continue outside the branch until the TUI behavior is recovered.                                           |
| **TUI becomes a Session Host client**                | The existing TUI remains supported but should no longer be the owner of core session lifecycle.                                                                                                                                          |
| **No `--print --mode json` MVP**                     | Pi-compatible JSONL is useful, but likely throwaway if ACP is the strategic interface.                                                                                                                                                   |
| **Takopi project selection is reused**               | Takopi already supports project aliases, chat/topic context binding, and cwd resolution.                                                                                                                                                 |
| **Takopi branch/worktree is ignored initially**      | RunWield owns Plan-scoped worktree semantics. Takopi `@branch` integration can be revisited later.                                                                                                                                       |
| **Telegram MVP is natural language**                 | Full RunWield command/approval UX can come later; the first bridge only needs natural-language interaction routed through RunWield.                                                                                                      |

## 4. Technical Approach

### Slice 1 — Multi-session Session Host refactor

Create a non-TUI Session Host abstraction that owns one or more **Hosted Sessions**. A Hosted Session contains the
runtime state currently treated as process-global for the interactive root session.

Each Hosted Session should own, at minimum:

- Session id / persisted session manager
- cwd / project context
- active Agent name and handler
- root Agent Session
- transient sub-Agent Sessions
- active model/thinking state
- pending root swap and pending switch handoff
- active execution workflow state
- project-state context note
- event sink / UI adapter boundary

The existing TUI should be adapted to create/use exactly one Hosted Session. Success for Slice 1 is: **the existing TUI
runs entirely through Session Host with no intended behavior change.**

### Slice 2 — SessionRuntime + ACP MVP

Add `wld acp` and `wld --mode acp` core entry points that speak ACP JSON-RPC over stdio. ACP is a sibling adapter over a
shared SessionRuntime/Session Host boundary, not a wrapper around TUI internals.

MVP ACP capabilities:

- initialize and advertise only implemented safe capabilities
- create session with cwd
- load/resume session
- prompt session
- cancel session
- stream assistant text and tool/status updates
- return stable session ids

The ACP implementation should call the SessionRuntime/Session Host boundary directly and must not import TUI modules.

### Slice 3 — MVP Takopi RunWield plugin

Create a Takopi engine plugin for RunWield that connects Telegram to `wld --mode acp`.

MVP behavior:

- Takopi resolves project/cwd.
- Plugin starts or connects to RunWield ACP.
- Telegram chat/topic/reply context maps to a RunWield ACP session.
- Natural-language messages are sent as ACP prompts.
- ACP updates are translated to Takopi progress/final events.
- Takopi `@branch`/worktree semantics are ignored initially.

### Slice 4 — Rich external workflow UX

Expand beyond natural-language prompting:

- Surface Plannotator/collab review links in Telegram and ACP clients.
- Let users approve/save/give feedback naturally from Telegram.
- Add button-based Telegram affordances where useful.
- Expose RunWield command-like actions over ACP where appropriate.
- Improve tool/workflow event mapping for plans, validation, execution, and failures.
- Support richer session list/load UX in IDEs and Telegram.

## 5. Out of Scope for Initial Milestones

- Native Telegram transport in RunWield core.
- Takopi-owned worktree execution for RunWield tasks.
- Full ACP feature coverage on day one.
- Full RunWield slash/CLI command parity in Telegram.
- Replacing Plannotator with Telegram UI.
- Slack/Discord support before the Takopi plugin proves the model.

## 6. Future Work Unlocked

- IDE integrations via ACP-compatible editors.
- Workspace UI actions that start, resume, or monitor RunWield sessions.
- Starting a Plan or Review Loop from Workspace without TUI boot.
- Rich Telegram planning flows using shared Plannotator/collab links.
- Slack and Discord bridges through Takopi transports.
- Native RunWield Telegram transport if Takopi becomes limiting.
- Multiple concurrent Hosted Sessions in one RunWield process.
- Better long-running workflow dashboards over the same Session Host event stream.

## 7. Slice 1 Open Design Areas

Slice 1 needs focused design before implementation:

- Exact Hosted Session state boundary.
- How existing `session-state.js` globals are replaced by per-HostedSession state.
- How TUI UI API calls become Session Host event sinks.
- How pending root swaps and return-to-router handoffs become per-session.
- How workflow execution state is scoped per session.
- Whether Plan/worktree operations remain process-global or become Hosted Session operations with cwd guards.
