---
planId: "7c2a6b78-6dbd-4e78-8979-fbe3aa49621e"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Expand the initial Workspace activation tracer bullet into comprehensive writable Session activation enforcement for TUI, ACP, initialization, compaction, cancellation, and all Runtime mutation paths."
affectedPaths:
    - "src/shared/session/"
    - "src/ui/tui/"
    - "src/acp/"
    - "src/cmd/acp/"
    - "src/cmd/"
    - "src/shared/session/session-runtime.js"
createdAt: "2026-07-22T03:56:51.473Z"
updatedAt: "2026-07-22T03:56:51.473Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 7
dependencies:
    - "06-read-only-transcript-projection-and-idle-tui-sync"
---

# Activation Enforcement Hardening Across Adapters

## Context

Slice 4 enables a narrow Workspace continuation tracer bullet. Personal Remote Workspace v1 requires all writable
Runtime hydration and mutation paths to honor exclusive activation. TUI, Workspace, and ACP remain siblings, but none
may load or mutate the same stable Session concurrently.

## Objective

Harden activation enforcement across adapters and Runtime operations:

- all writable Session creation/load/continuation paths use stable RunWield Session IDs and activation leases;
- TUI, Workspace, and ACP reject or refresh when another surface owns mutation;
- compaction, cancellation settlement, local shell/tool exchange recording, image persistence, prompt, model changes,
  and workflow operations require valid ownership where they mutate transcript/session state;
- heartbeat loss, stale fencing, process restart, and unsupported older-binary scenarios degrade conservatively.

## Approach

Move activation checks below adapter-specific routes and commands so there is one enforcement layer. Audit
`SessionRuntime` methods and adapter entry points for mutating operations. Add helper assertions that require active
ownership for mutation and read-only alternatives for projection. Keep ACP independent from Workspace application
services while mapping transport-facing ACP Session IDs to stable RunWield Session IDs.

## Files to Modify

- `src/shared/session/session-runtime.js` — require activation ownership for all writable operations and expose clear
  errors for losing surfaces.
- `src/shared/session/hosted-session.js` — track stable Session ID, owner process, activation generation, and turn
  ownership metadata.
- `src/shared/session/session-host.js` — adopt/create Sessions with stable identity and activation state.
- `src/ui/tui/` — integrate activation-aware prompts, ownership display, close/reopen behavior, and safe refresh after
  losing ownership.
- `src/acp/server.js` and `src/cmd/acp/` — map ACP sessions to stable IDs and reject concurrent loads/prompts safely.
- `src/cmd/` — ensure initialization, load-session, and other Session-related commands converge on activation rules.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session-runtime.js` busy-operation tracking — reuse to define activation hold periods during
  mutable work.
- `src/shared/session/hosted-session.js` turn and interaction state — integrate ownership metadata without changing
  adapter event contracts.
- `src/acp/server.js` session mapping — extend existing ACP mapping rather than exposing owner DB details to transport
  clients.
- `src/ui/tui/runtime-adapter.js` — reuse semantic rendering while adding ownership states.

## Implementation Steps

- [ ] Audit every public `SessionRuntime` method and classify read-only versus mutating behavior.
- [ ] Add shared activation ownership assertions for mutating Runtime operations and writable SessionManager hydration.
- [ ] Update TUI Session creation/load/prompt/cancel/compact paths to acquire or require activation appropriately.
- [ ] Update ACP new/load/prompt/close behavior to map stable Session IDs and reject concurrent mutation with clear
      protocol errors.
- [ ] Update Workspace continuation APIs from slice 4 to use the hardened common enforcement layer.
- [ ] Add process heartbeat/release cleanup and explicit stale-owner/recovery states without automatic unsafe takeover.
- [ ] Add startup/version warning or detection for older binaries that do not understand owner coordination leases where
      feasible.
- [ ] Add broad tests for same-Session concurrency, unrelated-Session concurrency, stale fencing, cancellation,
      compaction, and ACP/TUI/Workspace rejection behavior.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: multi-process integration tests should prove only one process can hydrate or mutate a stable Session,
  fencing rejects stale owners, and unrelated Sessions/Projects remain concurrent.
- Automated: tests should cover cancellation settlement, compaction, queued prompts, image persistence, ACP load, TUI
  load, and Workspace continuation under activation rules.
- Manual: open one Session in TUI and Workspace, attempt simultaneous prompts, and verify one writer wins while the
  loser refreshes or explains ownership without corrupting transcript history.

## Edge Cases & Considerations

- Activation takeover is never automatic during live operations.
- Heartbeat expiry does not prove filesystem/tool side effects are safe to replay.
- Do not let TUI or ACP import Workspace application services.
- Preserve existing local QUICK_FIX, non-Git, Shared Plan, and Plan Lifecycle behavior unless ownership invariants
  require a compatibility transition.
