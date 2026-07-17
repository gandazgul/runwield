---
planId: "64cd784c-67b2-4ae5-a4cd-186c2d912ee7"
classification: "FEATURE"
complexity: "HIGH"
summary: "Finish the SessionRuntime sibling-adapter refactor so TUI, ACP, and future UIs share one project-isolated engine contract for lifecycle, prompting, events, interactions, and concurrency."
affectedPaths:
    - "src/constants.js"
    - "src/shared/types.js"
    - "src/shared/session/"
    - "src/shared/workflow/"
    - "src/shared/interactive/"
    - "src/tools/"
    - "src/acp/"
    - "src/ui/tui/"
    - "src/cmd/new/"
    - "src/cmd/resume/"
    - "docs/adr/010-session-runtime-sibling-adapters-and-acp.md"
frontend: false
createdAt: "2026-07-09T15:23:25-04:00"
updatedAt: "2026-07-17T04:50:48.026Z"
status: "verified"
origin: "user"
verifiedAt: "2026-07-14T21:46:28.049Z"
workRecord:
    status: "generated"
    recordId: "684c71d5-d421-465a-94a5-34db50c2dde6"
    path: "docs/work-records/2026-07-17-unified-tui-and-acp-behind-sessionruntime.md"
    lastAttemptAt: "2026-07-17T04:50:38.786Z"
archivedAt: "2026-07-14T21:46:28.049Z"
archiveReason: "Verified after moving ACP prompt overlap ownership into SessionRuntime; remaining audit findings deferred."
archivedFromStatus: "verified"
archivedFromPath: "plans/session-runtime-sibling-adapter-boundary.md"
routingIntent: "FEATURE"
sessionName: "session runtime sibling adapters"
---

# Finish the SessionRuntime Sibling Adapter Boundary

## Context

The Session Host and ACP refactor established the right major concepts: `SessionHost` owns multiple `HostedSession`
instances, `SessionRuntime` exposes lifecycle and prompt operations, runtime events describe streaming output, and
runtime interaction adapters let ACP or TUI answer user prompts. ACP and the TUI now both reach this runtime layer, and
the ACP adapter no longer imports the TUI chat loop.

The live architecture is not yet a fully shared, UI-independent engine:

- `HostedSession.cwd` is not consistently honored. Shared workflow, Plan, local agent/skill/prompt discovery, metrics,
  and Mnemosyne paths still use the process-wide `CWD`, so simultaneous ACP sessions for different projects can read or
  mutate the server launch project.
- `SessionRuntime` and `AgentMessageHandler` still accept the TUI-shaped imperative `UiAPI`. ACP must fabricate a
  partial no-op TUI object to run the engine.
- Core agent subscribers both emit semantic runtime events and render directly through `UiAPI`, creating two output
  paths and possible duplicate ACP status updates.
- The TUI creates, resumes, replaces, and mutates Hosted Sessions through `SessionHost` and command-specific code
  instead of using the same `SessionRuntime` lifecycle operations as ACP.
- ACP owns same-session prompt exclusion and cancellation races. A future sibling adapter could accidentally start two
  turns against one Hosted Session.
- TUI-only composition modules and tests are placed under `src/shared/interactive`, and existing dependency tests forbid
  only one narrow ACP-to-chat-session import rather than enforcing the complete shared-core boundary.
- The event contract lacks several durable state events and a current snapshot API needed by reconnecting or richer UIs.

ADR-009 requires real multi-session isolation, while ADR-010 requires TUI, ACP, Workspace, and future transports to be
sibling adapters over `SessionRuntime`, with adapter-specific rendering and input collection outside core.

## Objective

Make `SessionRuntime` the single UI-independent application boundary for RunWield sessions so that:

- Every Hosted Session uses its own absolute project root for tools, workflows, Plans, layered project configuration,
  metrics, memory commands, and persistence.
- Session lifecycle, active-turn concurrency, cancellation settlement, agent switching, and prompt orchestration are
  owned by the runtime rather than recreated by adapters.
- Core emits typed semantic events and requests typed interactions without invoking TUI render methods.
- The TUI becomes a genuine runtime adapter that consumes events and supplies interactions, matching the same lifecycle
  semantics ACP uses.
- ACP maps runtime events and interactions directly and no longer fabricates a TUI-shaped `UiAPI`.
- Future in-process UIs can depend on a small public runtime client contract, while out-of-process clients can continue
  using ACP.
- Boundary and parity tests prevent shared core from regaining UI dependencies.

## Approach

Implement the refactor in dependency order. First make project context trustworthy, because every later runtime contract
depends on sessions operating on the correct root. Next centralize the adapter-neutral JSDoc contracts and move
same-session turn ownership into `SessionRuntime`. Then make semantic events/interactions the only presentation
boundary, add a TUI adapter over that contract, and route TUI lifecycle actions through the runtime. Finally add
snapshots and semantic state events for richer clients, move TUI-only composition into the TUI tree, and lock the design
with cross-project, adapter-parity, concurrency, and import-boundary tests.

Use pure JavaScript and JSDoc typedefs. Prefer explicit `projectRoot`/`cwd` parameters or a centralized `ProjectContext`
typedef over implicit reads of `constants.CWD`. Keep `CWD` only at CLI composition roots as the default supplied when a
new runtime session is created.

## Files to Modify

- `src/shared/types.js` — add centralized adapter-neutral runtime, project-context, event-sink, snapshot, prompt, and
  interaction typedefs; remove duplicated TUI-shaped cross-module contracts.
- `src/shared/session/hosted-session.js` — require an absolute project root, own active-turn state, and remove adapter
  render objects from core session state once event migration is complete.
- `src/shared/session/session-host.js` — preserve registry/lifecycle ownership while returning stable session metadata
  and preventing partially initialized sessions from remaining adopted.
- `src/shared/session/session-runtime.js` — become the sole lifecycle/prompt/cancel/observe boundary; enforce turn
  exclusion and cancellation settlement; expose state snapshots and session-layer actions.
- `src/shared/session/session-runtime-events.js` — add typed state and workflow events needed by TUI and future clients.
- `src/shared/session/session-runtime-interactions.js` — retain only adapter-neutral request/response brokering; move
  the TUI interaction implementation out of shared core.
- `src/shared/session/session.js` — make Pi Agent Session subscribers emit runtime events only, pass the Hosted Session
  project root through configuration/tool assembly, and remove direct TUI rendering dependencies.
- `src/shared/session/types.js` and `src/shared/session/agents.js` — use centralized contracts and make local layered
  agent discovery project-root aware with caches keyed by project root.
- `src/shared/session/agent-handler.js` and `src/shared/session/agent-switching.js` — replace process `CWD` and render
  calls with Hosted Session context and runtime state/status events.
- `src/shared/workflow/` — pass the target project root through Plan, Worktree, validation, metrics, routing, Slicer,
  and notification operations; replace imperative UI output/input with runtime events/interactions.
- `src/tools/plan-written.js` and other UI-aware tools — capture the Hosted Session project root and publish semantic
  outcomes/interactions without importing or requiring TUI contracts.
- `src/ui/tui/` — add the TUI runtime event renderer and TUI interaction adapter; receive runtime snapshots/events and
  own all Pi-TUI rendering behavior.
- `src/shared/interactive/` — remove after relocating the TUI composition root, operation-generation guard, hydration,
  keybindings, UI overrides, slash-shell wiring, and their tests under `src/ui/tui/`; delete unused onboarding-state
  persistence that has no production consumer.
- `src/cmd/new/index.js` and `src/cmd/resume/index.js` — call runtime lifecycle operations instead of constructing or
  mutating Hosted Sessions directly.
- `src/acp/server.js` — remove the fabricated ACP runtime `UiAPI`, rely on runtime events/interactions, and let runtime
  own prompt exclusion/cancellation settlement.
- `src/acp/event-mapper.js` — map new state events/snapshots while preserving ACP redaction and standard primitives.
- `src/acp/session-map.js` — keep protocol-id mapping and request metadata only; remove engine concurrency ownership.
- `docs/adr/010-session-runtime-sibling-adapters-and-acp.md` — document the finalized public contract and migration
  consequences if implementation choices materially refine the accepted decision.

## Reuse Opportunities

- `src/shared/session/session-runtime-events.js` — extend the existing semantic event vocabulary instead of introducing
  a second event bus.
- `src/shared/session/session-runtime-interactions.js` — retain the current adapter-neutral interaction request/outcome
  model and cancellation broker.
- `src/acp/event-mapper.js` and `src/acp/interaction-mapper.js` — preserve the clean protocol mapping boundaries.
- `src/ui/tui/api.js` — reuse its block/render primitives inside a new TUI event renderer rather than deleting mature
  TUI presentation code.
- `src/shared/session/session-host.js` and `src/shared/session/hosted-session.js` — preserve the existing registry and
  per-session state work while tightening ownership and public access.
- Existing temp-directory, fake Agent Session, session subscriber, and ACP NDJSON harnesses — extend them for project
  isolation, transcript parity, lifecycle, and cancellation tests.

## Implementation Steps

- [x] Make project context session-scoped end to end:
  - [x] Define a reusable `ProjectContext`/project-root contract and require an absolute root at runtime session
        creation.
  - [x] Replace shared runtime/workflow/tool reads of `CWD` with `hostedSession.cwd`, explicit `projectRoot`, or an
        execution Worktree cwd where appropriate.
  - [x] Make local agent, prompt, skill, AGENTS.md, settings, metrics, and Mnemosyne resolution project-root aware.
  - [x] Key layered settings and catalog caches by project root so sessions cannot reuse another project's overrides.
  - [x] Add two-project integration coverage proving Plan, settings, agent, prompt, and skill isolation; existing
        workflow suites cover the explicit metrics, memory, tool, validation, and Worktree cwd seams.
- [x] Centralize the runtime extension contracts in JSDoc:
  - [x] Define session request/result, project context, event sink/listener, interaction adapter, snapshot, and
        capability typedefs once in shared core.
  - [x] Replace TUI `UiAPI` imports from `src/shared/session`, tools, and shared workflow signatures.
  - [x] Replace duplicated adapter option shapes at the runtime boundary with shared contracts.
- [x] Move active-turn ownership into `SessionRuntime`/`HostedSession`:
  - [x] Reject overlapping prompts per Hosted Session at the runtime boundary.
  - [x] Keep separate sessions concurrently promptable.
  - [x] Ensure cancellation does not release the turn lock until the underlying Agent Session prompt has settled.
  - [x] Make close/dispose await active turns and interactions through settled lifecycle operations.
- [x] Make runtime events and runtime interactions the adapter presentation contract:
  - [x] Route runtime-bound Pi subscriber and workflow output through a private core event bridge; retain the direct
        rendering fallback only for standalone/test callers outside `SessionRuntime`.
  - [x] Emit typed events for assistant/thinking/tool/status/usage/turn output and typed interaction requests for
        select, text, approval, and links.
  - [x] Eliminate duplicate event-plus-port status paths in runtime-bound sessions.
  - [x] Move the TUI prompt interaction implementation under `src/ui/tui/`.
- [x] Build the TUI sibling adapter:
  - [x] Subscribe to one Hosted Session's runtime event stream and render through existing TUI blocks/API helpers.
  - [x] Install the TUI interaction adapter for prompts and approvals.
  - [x] Route create, resume/load, prompt, cancel, close, root swap, and session replacement through `SessionRuntime`.
  - [x] Preserve current TUI behavior, hydration, steering, slash commands, footer state, model selection, and terminal
        title behavior through adapter-owned code.
- [x] Simplify ACP to the same engine contract:
  - [x] Delete `createAcpRuntimeUi()` and pass no rendering object into runtime prompts.
  - [x] Keep ACP framing, capability negotiation, ids, event mapping, elicitation, and redaction in `src/acp` only.
  - [x] Move active prompt/turn exclusion into runtime while retaining ACP request ids and cancellation responses in the
        ACP session map.
- [x] Add reconnectable state and reusable actions for future UIs:
  - [x] Add a `getSessionSnapshot()` API containing lifecycle, cwd, active Agent/model/thinking level, busy/turn state,
        workflow state, and supported interaction capabilities without exposing mutable Hosted Session internals.
  - [x] Add semantic events such as `agent_changed`, `model_changed`, `thinking_level_changed`, `session_renamed`,
        `busy_changed`, and relevant Plan/workflow transitions.
  - [x] Add reusable runtime actions for create/load/prompt/cancel/close, rename, model, and thinking state so future
        adapters do not need an Editor or TUI object.
- [x] Enforce source ownership:
  - [x] Move TUI-only composition modules from `src/shared/interactive` to `src/ui/tui` and update imports.
  - [x] Move the remaining TUI-only helpers and tests so `src/shared/interactive` no longer exists.
  - [x] Move the terminal clipboard integration from `src/shared` to `src/ui/tui`.
  - [x] Replace core desktop-notification side effects with semantic attention events handled by the TUI adapter.
  - [x] Delete the unused model-welcome state module and its self-only test instead of preserving dead TUI code.
  - [x] Add an automated dependency test forbidding shared core and tools from importing `src/ui/**` or `src/acp/**`.
  - [x] Apply the adapter-import boundary to tests as well as production modules.
  - [x] Keep adapter-to-core imports allowed and core-to-adapter imports forbidden.
- [x] Add contract and regression tests:
  - [x] Prove local Plans/catalogs/settings are isolated for two simultaneous project roots and retain focused cwd tests
        for metrics, memories, tools, validation, and Worktrees.
  - [x] Drive TUI and ACP adapters from the same deterministic runtime fixture and compare semantic transcripts.
  - [x] Test same-session overlap rejection and different-session concurrency.
  - [x] Test that cancellation waits for prompt settlement before another prompt or disposal.
  - [x] Test lifecycle events, snapshots, transactional creation, create/load/prompt/cancel/close, and reconnect state.
  - [x] Test that retry and compaction statuses cross the runtime bridge exactly once.

## Verification Plan

- Automated focused suites during each phase:
  - `deno test -A src/shared/session src/shared/workflow src/tools src/acp src/ui/tui src/cmd/new src/cmd/resume`
  - Add dedicated project-isolation, adapter-contract, import-boundary, and cancellation-settlement test files.
- Final automated verification:
  - `deno task check`
  - `deno task lint`
  - `deno task fmt:check`
  - `deno task test`
- Manual TUI verification:
  - Start a new TUI session, submit a routed request, exercise Agent switching, model selection, an interactive
    approval, `/new`, `/resume`, cancellation, retry/compaction status, and one Plan review flow.
  - Confirm rendering, footer state, terminal title, prompts, hydration, and steering match existing behavior.
- Manual ACP verification:
  - Start `wld --mode acp`, initialize, create two sessions for different project roots, prompt them concurrently,
    cancel one, load a persisted session, and close both.
  - Confirm each session uses only its own local configuration and files, updates are ordered and non-duplicated, and a
    new prompt cannot begin until cancellation has settled.
- Expected result:
  - No shared runtime/workflow module requires a TUI or ACP type/implementation.
  - TUI and ACP are thin sibling adapters over the same runtime lifecycle and semantic event/interaction contracts.
  - Additional in-process UIs require only a runtime event renderer plus an interaction adapter; external UIs can use
    ACP without losing RunWield workflow semantics.

## Edge Cases & Considerations

- Preserve correct execution-cwd behavior: a Hosted Session's project root owns Plans/config/memory, while an active
  execution Worktree may intentionally become the file-tool and validation cwd for that workflow.
- Project-global persisted settings may be shared intentionally by sessions rooted in the same project; mutable turn,
  Agent, model override, interaction, and workflow state must remain per Hosted Session.
- Event listeners must not crash the engine, but ordering and adapter failure diagnostics should remain observable.
- A reconnecting client needs a snapshot plus subsequent ordered events; it should not depend on observing the original
  `session_created` event.
- TUI startup and model-setup recovery currently require rendering before the first Agent Session is fully ready. Keep
  session initialization transactional so failure does not leave a half-adopted Hosted Session.
- ACP clients vary in elicitation capability. Unsupported interactions must produce explicit outcomes without silently
  accepting safety-sensitive prompts.
- Keep ACP protocol ids separate from persisted RunWield Session ids and internal Hosted Session ids.
- Do not broaden ACP capability advertisement until the corresponding runtime action and mapper are implemented and
  tested.
