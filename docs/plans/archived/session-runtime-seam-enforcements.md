---
planId: "31e4273d-63f6-4ac5-858a-422d79f60e6d"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add RunWield-specific architecture enforcement tests that catch model-authored SessionRuntime seam, sibling adapter, and Session Activation Lease protocol violations before review."
affectedPaths:
    - "src/shared/session/architecture-boundary.test.js"
    - "src/shared/session/session-runtime.test.js"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-27T12:46:28-04:00"
updatedAt: "2026-07-27T17:07:51.482Z"
archivedAt: "2026-07-01"
status: "verified"
origin: "internal"
implementedAt: "2026-07-27T16:54:15.212Z"
verifiedAt: "2026-07-27T17:07:04.728Z"
userVerifiedAt: null
executionReport: "- Implemented `src/shared/session/architecture-boundary.test.js` RunWield-specific seam enforcements: JS/TS production scanning, TUI/ACP/Workspace sibling import fence, consumer public-Runtime-only fence, writable transcript hydration allowlist, owner-coordination mutator allowlist, read-only sync guard, stable Session ID hygiene, Runtime event producer/normalizer fence, and positive `SessionRuntime` public surface allowlist.\n- Implemented `src/shared/session/session-runtime.test.js` managed activation source-order guards for acquiring Session Activation Lease before writable hydration and checkpointing before generation publication in managed prompt/workflow paths.\n- Verification passed: `deno fmt src/shared/session/architecture-boundary.test.js src/shared/session/session-runtime.test.js`; `deno test -A --no-check src/shared/session/architecture-boundary.test.js src/shared/session/session-runtime.test.js`; `deno task ci` (1876 passed, 0 failed).\n- No browser/TUI manual verification required; this was CI/source-seam enforcement only."
workRecord:
    status: "generated"
    recordId: "f25372d5-dbb4-4132-ab33-f39c05d64e2b"
    path: "docs/work-records/2026-07-27-sessionruntime-seam-enforcement-tests.md"
    lastAttemptAt: "2026-07-27T17:07:43.471Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "8b9f90d0010602cadb2553c19906d0b1f38defe6"
    targetBranch: "main"
    targetHeadBeforeMerge: "9772fdbd5d7f6544dca3d41b38d20bcccc83e034"
---

# SessionRuntime Seam Enforcement Tests

## Context

RunWield already has architecture-boundary coverage in `src/shared/session/architecture-boundary.test.js` to keep
`SessionRuntime` as the public live-session seam and prevent TUI, ACP, commands, and scripts from reaching into
`HostedSession`, `SessionHost`, root-session, active-Agent, event-producer, and presentation internals.

Recent product direction and implemented code add more failure-prone seams:

- `TUI`, `Workspace`, and `Agent Client Protocol (ACP)` are sibling consumers over adapter-neutral `SessionRuntime`; no
  one surface should import, wrap, or become the parent API for another.
- writable managed Session hydration must acquire a fenced **Session Activation Lease** before opening or mutating an
  existing Pi `SessionManager`.
- read synchronization must project committed transcript state without constructing a writable manager or acquiring
  control.
- durable ownership must use stable RunWield Session IDs, while in-process Hosted Session IDs, Pi Session IDs, display
  snapshots, and catalog projections remain non-authoritative.
- Session Activation Lease and **Plan Workflow Lease** are separate concepts; activation expiry must not imply Plan
  workflow takeover or cleanup.

The user wants repo-specific enforcement checks, not a generic lint plugin, so the implementation should add CI-enforced
Deno tests that fail with explicit messages when a model-authored change violates these seams.

## Objective

Add RunWield-specific architecture enforcement tests that make common model mistakes mechanically visible during
`deno task test` / `deno task ci`:

1. prevent TUI, ACP, and Workspace from importing one another or session internals;
2. prevent consumer surfaces from opening writable transcripts or using owner-coordination lease mutators directly
   outside approved seams;
3. enforce read-only synchronization paths for committed transcript projection;
4. protect stable RunWield Session ID ownership and Runtime public-surface depth;
5. add focused source-order checks for managed Session Activation Lease acquisition before writable hydration and
   generation publication after checkpointing.

## Approach

Extend the existing architecture-boundary style instead of introducing a new lint framework. The checks should remain
plain Deno tests that scan production source files for narrowly targeted forbidden patterns and allowlisted modules.
This matches the existing repository pattern, produces readable assertion failures, and avoids new dependencies.

Use two test layers:

- `src/shared/session/architecture-boundary.test.js` for cross-module and cross-surface static seam checks.
- `src/shared/session/session-runtime.test.js` for Runtime-specific source-order checks that protect managed activation
  sequencing around `promptManagedSession` and `#runWorkflowOperation`.

Keep all enforcement code in pure JavaScript with JSDoc if types are needed. Do not add TypeScript syntax outside
`src/ui/workspace/`.

## Files to Modify

- `src/shared/session/architecture-boundary.test.js` — extend the source scanner to include production `.js`, `.jsx`,
  `.ts`, and `.tsx` files where appropriate; add sibling-adapter, Workspace, writable-transcript, owner-coordination
  mutator, read-sync, stable-ID hygiene, Runtime event-producer, and public Runtime surface checks.
- `src/shared/session/session-runtime.test.js` — add focused source-order tests for managed Session Activation Lease
  acquisition, writable hydration, active-Agent resolution from persisted transcript state, checkpoint phase transition,
  and generation publication/release ordering.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/architecture-boundary.test.js` — reuse and generalize `productionJavaScriptFiles()` /
  `findViolations()` rather than adding a parallel scanner with different behavior.
- `src/shared/session/session-runtime.test.js` — reuse the existing source-order test pattern around
  `promptManagedSession` and `#runWorkflowOperation`; keep the new checks close to the existing managed Session tests.
- `docs/adr/010-session-runtime-sibling-adapters-and-acp.md` — source of truth for the sibling Runtime adapter seam.
- `docs/adr/011-exclusive-session-activation-and-durable-workflow-checkpoints.md` — source of truth for Session
  Activation Lease, Durable Workflow Checkpoint, read synchronization, and Plan Workflow Lease separation semantics.
- `docs/adr/012-segment-session-transcripts-at-execution-handoff.md` — source of truth for stable Session ownership
  across transcript segment rollover.
- `docs/domain-language.md` — canonical terminology for `Session`, `Session Control`, `Session Activation Lease`,
  `Plan Workflow Lease`, `Session Transcript`, and `Session Transcript Segment`.

## Implementation Steps

- [ ] Step 1: Generalize the architecture-boundary scanner in `src/shared/session/architecture-boundary.test.js`.
  - Rename or update `productionJavaScriptFiles()` so it can scan `.js`, `.jsx`, `.ts`, and `.tsx` production files.
  - Continue excluding `*.test.js`, `*.test.jsx`, `*.test.ts`, `*.test.tsx`, and `_test.*` files.
  - Preserve the existing behavior for current JS-only checks.
  - Ensure ignored/generated directories remain naturally excluded by the traversal roots chosen in each test.

- [ ] Step 2: Add a sibling-adapter import fence.
  - Add a Deno test that scans `src/ui/tui`, `src/acp`, and `src/ui/workspace` production files.
  - Fail if `src/ui/tui/**` imports `src/acp/**` or `src/ui/workspace/**`.
  - Fail if `src/acp/**` imports `src/ui/tui/**` or `src/ui/workspace/**`.
  - Fail if `src/ui/workspace/**` imports `src/ui/tui/**` or `src/acp/**`.
  - Allow all three surfaces to import adapter-neutral `src/shared/session/session-runtime.js`,
    `session-runtime-events.js`, `session-runtime-interactions.js`, and other appropriate `src/shared/**` modules.

- [ ] Step 3: Extend consumer-internal Runtime fences to Workspace and TypeScript sources.
  - Apply the existing “public Runtime surface only” forbidden patterns to `src/ui/workspace` production files in
    addition to `src/ui/tui`, `src/acp`, `src/cmd`, and `scripts`.
  - Include `.ts`/`.tsx` Workspace files in the scan.
  - Continue forbidding consumer references/imports for `HostedSession`, `SessionHost`, `hosted-session`,
    `session-host`, `agent-handler`, `agent-switching`, `root-session`, `session.js`, `getRootAgentSession`,
    `getRootSessionManager`, `createRootSessionManager`, and `openPersistedRootSession` unless a current source-backed
    exception is required.
  - If an exception is required for an existing safe read-only helper, encode it as a path-specific allowlist with a
    comment that explains the seam.

- [ ] Step 4: Add a writable transcript open fence.
  - Add a Deno test that scans production code under `src` and `scripts`.
  - Forbid direct production use of `SessionManager.open`, `openPersistedRootSession`, and `createRootSessionManager`
    outside `src/shared/session/root-session.js` and `src/shared/session/session-runtime.js`.
  - Keep test files excluded so existing unit tests can build fake managers and call low-level helpers directly.
  - Failure messages should state that writable transcript hydration must go through `SessionRuntime` and the Session
    Activation Lease protocol.

- [ ] Step 5: Add an owner-coordination mutator allowlist.
  - Add a Deno test that scans production code for direct calls to owner-coordination lease mutators:
    - `acquireSessionActivation`
    - `changeSessionActivationPhase`
    - `heartbeatSessionActivation`
    - `publishGenerationAndRelease`
    - `releaseUnchangedActivation`
    - `markSessionUncertain`
    - `markSessionReconcileRequired`
  - Allow calls only in:
    - `src/shared/owner-coordination/**`
    - `src/shared/session/session-runtime.js`
    - `src/ui/workspace/server/session-continuation.js` for the currently implemented Workspace bootstrap/continuation
      service.
  - Do not forbid opening or passing an owner-coordination store at composition roots such as ACP or Workspace server
    startup; the guard is for state-machine mutators, not dependency wiring.

- [ ] Step 6: Add a read-only synchronization fence.
  - Add a Deno test focused on Workspace timeline/synchronization modules and any current/future TUI managed-sync
    modules.
  - In read-sync/projection paths, forbid `runtime.loadSession`, `runtime.adoptManagedSession`, `promptSession`,
    `promptManagedSession`, `openPersistedRootSession`, and `SessionManager.open`.
  - Allow `projectCommittedTranscript`, `captureTranscriptEvidence`, and other read/projection helpers where source
    evidence shows they do not construct writable managers.
  - The test name and failure message should explicitly say that non-owning surfaces synchronize committed Session
    generations read-only.

- [ ] Step 7: Add stable RunWield Session ID hygiene checks.
  - Add static anti-pattern checks for obvious ownership-key mistakes, including:
    - `runwieldSessionId: session.id`
    - `runwieldSessionId: runtimeSessionId`
    - `runwieldSessionId: sessionManagerId`
    - `runwieldSessionId: piSessionId`
    - `ownerSessionId: session.id` or similar fields if present in the current code.
  - Keep patterns narrow enough to avoid noisy failures on harmless tests or comments.
  - Add comments explaining that Session Activation Lease ownership is keyed by stable RunWield Session ID, not Hosted
    Session ID or Pi Session Manager ID.

- [ ] Step 8: Expand Runtime event-producer and normalization fences to Workspace.
  - Extend the existing consumer-side event normalization restrictions to cover `src/ui/workspace` production files.
  - Forbid consumers from calling or importing Runtime event producers/normalizers such as `createSessionRuntimeEvent`,
    `emitHostedSessionRuntimeEvent`, `normalizeRuntimeToolResult`, `normalizeRuntimeUsage`, `describeRuntimeTool`, and
    `formatToolEventTitle` unless an existing source-backed exception is necessary for a test helper outside production
    scans.
  - Preserve legitimate adapter mappers that translate already-received Runtime events into TUI, Workspace, or ACP
    presentation/protocol state.

- [ ] Step 9: Replace the negative-only Runtime compatibility check with a positive public surface check.
  - In `src/shared/session/architecture-boundary.test.js`, keep the existing assertions that deleted compatibility APIs
    remain absent.
  - Add an explicit allowlist for `Object.getOwnPropertyNames(SessionRuntime.prototype)`.
  - Include the current intended public Runtime methods only, such as session creation/loading, prompting, cancellation,
    replay, snapshots, workflow operations, interactions, subscriptions, shell command, model/thinking operations,
    help/context/reporting, image persistence/preflight, compaction/reload/export, queued-message operations, managed
    synchronization/adoption/public prompting, and close methods.
  - Ensure the allowlist intentionally excludes escape hatches like `getHostedSession`, `getSession`,
    `getActivationProof`, `withSessionManager`, `setSessionHandler`, `attachRuntimeEventSink`, `emitSessionEvent`, and
    `recordLocalToolExchange`.
  - If the current prototype has intentional public methods not listed in the initial allowlist, update the allowlist
    with a short comment tying each method to the adapter-neutral Runtime interface.

- [ ] Step 10: Add managed activation source-order checks in `src/shared/session/session-runtime.test.js`.
  - For `promptManagedSession`, assert the source order is:
    1. inspect/validate managed activation state;
    2. `acquireSessionActivation`;
    3. emit accepted user-message event if applicable;
    4. `#openPersistedRootSession`;
    5. resolve persisted active Agent from the opened transcript;
    6. activate the Agent;
    7. delegate to `promptSession`;
    8. transition to `checkpointing`;
    9. publish generation/release or mark recovery state.
  - For `#runWorkflowOperation`, assert the source order is:
    1. acquire Session Activation Lease for dormant managed Session operations;
    2. open persisted root session only after acquisition;
    3. resolve persisted active Agent instead of falling back to `managed.activeAgent`;
    4. activate the Agent;
    5. run the workflow operation;
    6. transition to `checkpointing` before publishing generation/releasing activation.
  - Keep these checks narrow and paired with existing behavioral tests so source-order brittleness only protects
    essential lease sequencing.

- [ ] Step 11: Run the focused tests and adjust false positives.
  - Run
    `deno test -A --no-check src/shared/session/architecture-boundary.test.js src/shared/session/session-runtime.test.js`.
  - If false positives appear, prefer path-specific allowlists with comments over weakening the regex globally.
  - Do not silently allow consumer-surface imports of sibling adapters or session internals.

- [ ] Step 12: Run full repository verification.
  - Run `deno task ci`.
  - If failures are unrelated dirty-worktree effects from pre-existing user changes, document them clearly in the
    implementation handoff rather than modifying unrelated files.

## Verification Plan

- Automated:
  `deno test -A --no-check src/shared/session/architecture-boundary.test.js src/shared/session/session-runtime.test.js`
- Automated: `deno task ci`
- Manual: no browser or TUI manual flow is required; this is CI enforcement around source seams.
- Expected results for key scenarios:
  - A TUI file importing ACP or Workspace code fails the sibling-adapter test.
  - An ACP, TUI, Workspace, command, or script file importing `hosted-session.js`, `session-host.js`, `root-session.js`,
    or `session.js` fails the Runtime-internal fence.
  - A consumer surface calling `openPersistedRootSession` or `SessionManager.open` fails the writable transcript fence.
  - A non-owner read-sync path hydrating a writable Runtime fails the read-only synchronization fence.
  - New public `SessionRuntime` prototype escape hatches fail until explicitly reviewed and added to the allowlist.
  - Moving managed writable hydration before `acquireSessionActivation` fails the source-order test.
  - Using catalog/display projection fields such as `managed.activeAgent` as active-Agent authority remains blocked by
    existing and expanded checks.
- Execution policy matrix:
  - FEATURE Plans may omit `executionAgent`; omission defaults to `engineer` for backward compatibility.
  - FEATURE Plans may set `executionAgent: "engineer"` with `collaborationRecommendation: "autonomous"` or omitted.
    `pair` is invalid for Engineer-owned execution.
  - FEATURE Plans may set `executionAgent: "frontend-engineer"` with `collaborationRecommendation: "autonomous"` or
    `"pair"`.
  - Use `frontend-engineer` for browser-rendered UI work whose primary outcome is materially visual or interactive;
    otherwise use `engineer` (including TUI work and incidental frontend-file edits).
  - Recommend `pair` only when live visual judgment is valuable; use `autonomous` otherwise. Include known dev-server
    hints and exact headed-browser checks. Real-browser verification is mandatory for Frontend Engineer unless
    externally blocked.
  - PROJECT Epics are non-executable containers and must not define `executionAgent` or `collaborationRecommendation`;
    execution policy belongs only on child FEATURE Plans.
  - Legacy `frontend: true` on FEATURE Plans is still accepted as Frontend Engineer/autonomous compatibility metadata,
    but new Plans should use canonical `executionAgent` / `collaborationRecommendation` instead. Legacy
    `frontend: false` remains Engineer compatibility metadata and is distinct from an absent canonical owner.

## Edge Cases & Considerations

- Regex/source-scan false positives: keep patterns narrow and add path-specific allowlists with explanatory comments
  only when source evidence shows the dependency is an approved seam.
- Workspace TypeScript exception: scanner must read `.ts`/`.tsx` files, but enforcement tests themselves should remain
  pure JavaScript.
- Existing dirty worktree: current repository state includes unrelated modified and untracked files. Implementation
  should modify only the Plan’s target test files and avoid touching existing unrelated work.
- Source-order brittleness: use source-order checks only for essential lease sequencing and keep broader semantic
  behavior covered by existing managed Session tests.
- Future Durable Workflow Checkpoint and Plan Workflow Lease APIs may require additional enforcement once their
  production modules stabilize. This Plan should not invent those APIs; it should add current checks and comments that
  preserve the separation principle without blocking absent future modules.
- New Runtime public methods are not forbidden forever, but adding one should require an explicit update to the positive
  allowlist with a comment explaining why it belongs to the adapter-neutral interface rather than exposing
  implementation internals.
