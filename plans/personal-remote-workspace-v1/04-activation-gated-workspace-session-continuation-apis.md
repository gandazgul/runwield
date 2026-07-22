---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add the narrow backend/runtime APIs needed for Workspace to safely continue an idle Session under an exclusive activation lease, publish committed generations, and release at idle."
affectedPaths:
    - "src/shared/session/"
    - "src/ui/workspace/server/"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/root-session.js"
frontend: false
createdAt: "2026-07-22T03:56:51.463Z"
updatedAt: "2026-07-22T03:56:51.463Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 4
dependencies:
    - "03-secure-persistent-workspace-bootstrap-and-device-pairing"
---

# Activation-Gated Workspace Session Continuation APIs

## Context

The owner wants to ideate from a phone as early as possible. The first safe backend tracer bullet is narrower than full
cross-surface coordination: a paired Workspace browser should be able to open an eligible idle Session, acquire
exclusive writable activation, send one normal ideation/planning prompt, publish the committed generation after
transcript durability, and release at safe idle.

This slice does not yet harden every TUI/ACP path, implement durable Plan checkpoints, or build the final Session UI
polish. It establishes the minimum safe Runtime seam for the phone ideation UI slice.

## Objective

Implement activation-gated Workspace Session continuation APIs:

- acquire a fenced Session activation lease before any Workspace-owned writable SessionManager load or prompt;
- reject continuation when another surface owns mutation;
- publish committed Session generations only after transcript effects are durable;
- expose semantic timeline/snapshot data needed by the browser UI;
- release activation at a safe idle checkpoint;
- keep APIs adapter-neutral and below Workspace application code where possible.

## Approach

Add an initial activation lease table and shared coordination APIs on top of the owner DB. Integrate Workspace Session
load/prompt code with `SessionRuntime` without making Workspace a central Runtime proxy for TUI or ACP. Keep the
continuation policy intentionally conservative: no activation stealing during live operations, no replay of uncertain
effects, and no durable workflow checkpoint consumption yet.

## Files to Modify

- `src/shared/session/session-runtime.js` — add or wrap Workspace-safe load/prompt operations that require activation
  before writable mutation.
- `src/shared/session/session-host.js` and `src/shared/session/hosted-session.js` — attach stable RunWield Session
  identity and activation metadata where needed.
- `src/shared/session/root-session.js` — support transcript locator usage and generation evidence without adding
  mutating read paths.
- `src/shared/session/` — add activation lease coordination module, schema migration, fencing, heartbeat, generation
  publication, and tests.
- `src/ui/workspace/server/` — add authenticated Session continuation API endpoints using the shared activation module.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session-runtime.js` — preserve adapter-neutral Runtime operations and semantic event output.
- `src/shared/session/session-runtime-events.js` — reuse semantic timeline events rather than inventing
  Workspace-specific transcript projections.
- `src/shared/session/root-session.js` — reuse persisted Session resolution and Pi transcript locators.
- `src/ui/workspace/server/` auth services from slice 3 — reuse paired-device authorization for all continuation
  endpoints.

## Implementation Steps

- [ ] Add owner DB schema migrations for Session activation leases, fencing tokens, committed generations, and heartbeat
      timestamps.
- [ ] Implement activation acquire/heartbeat/release APIs with compare-and-set fencing and conservative stale-owner
      behavior.
- [ ] Add Runtime integration so Workspace-owned writable Session load/prompt requires a current activation lease.
- [ ] Publish the next committed generation only after transcript append or other canonical Session effect is durable.
- [ ] Add Workspace server endpoints for eligible Session list, Session snapshot/timeline, acquire-and-prompt, active
      owner status, and idle release.
- [ ] Add tests for two Workspace clients racing to continue the same Session, stale fencing token rejection,
      transcript-before-generation ordering, and unrelated Sessions proceeding concurrently.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: multi-process or simulated-concurrency tests should prove only one Workspace continuation owns a Session
  mutation, stale owners cannot publish generations, and unrelated Sessions/Projects remain concurrent.
- Manual API check: from a paired browser session, call the Session list/snapshot endpoints and submit one continuation
  prompt while a second client receives an ownership rejection.
- Expected result: Workspace can continue only an idle eligible Session, committed generation advances after transcript
  durability, and the lease releases when the Runtime returns to idle.

## Edge Cases & Considerations

- Heartbeat age is evidence, not permission to replay uncertain work.
- Do not use Pi `SessionManager.open()` for read-only projection in this slice; full non-mutating readers come later.
- If generation publication fails after transcript commit, mark the state reconcile-needed rather than appending
  duplicate transcript entries.
- This slice is intentionally not the full activation rollout for TUI/ACP.
