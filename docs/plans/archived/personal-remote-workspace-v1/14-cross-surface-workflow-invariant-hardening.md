---
planId: "3ad362d3-ea4c-4cb2-bebe-755e85a6361a"
classification: "PLANNED_CHANGE"
workKind: "MAINTENANCE"
complexity: "MEDIUM"
summary: "Harden cross-surface Session activation, segment projection, canonical Plan checks, and execution handoff boundaries with behavioral integration tests."
affectedPaths:
    - "src/testing/"
    - "src/shared/owner-coordination/"
    - "src/shared/session/"
    - "src/shared/workflow/"
    - "src/ui/tui/"
    - "src/acp/"
    - "src/ui/workspace/"
    - "src/cmd/load-plan/"
    - "docs/usage.md"
objectiveChecks:
    - id: "OC1"
      command: "test -f src/shared/owner-coordination/cross-surface-activation.integration.test.ts && test -f src/shared/session/cross-surface-workflow-invariants.integration.test.ts && grep -Eq \"Deno.test\\([\\\"']competing Workspace and TUI processes allow exactly one managed Session writer[\\\"']\" src/shared/owner-coordination/cross-surface-activation.integration.test.ts && grep -Eq \"Deno.test\\([\\\"']writable restart hydrates the committed current segment instead of the predecessor[\\\"']\" src/shared/session/cross-surface-workflow-invariants.integration.test.ts && deno run -A scripts/run-tests.js src/shared/owner-coordination/cross-surface-activation.integration.test.ts src/shared/session/cross-surface-workflow-invariants.integration.test.ts"
      rationale: "The behavioral cross-owner and current-segment integration suites do not exist. The check requires named Deno tests and executes both suites."
    - id: "OC2"
      command: "test -f src/ui/workspace/session-continuation.integration.test.ts && test -f src/acp/managed-session.integration.test.ts && grep -Eq \"Deno.test\\([\\\"']Workspace continuation publishes once and a TUI observer resumes from the new cursor[\\\"']\" src/ui/workspace/session-continuation.integration.test.ts && grep -Eq \"Deno.test\\([\\\"']ACP load uses the committed current segment and rejects prompt while Workspace owns activation[\\\"']\" src/acp/managed-session.integration.test.ts && deno run -A scripts/run-tests.js src/ui/workspace/session-continuation.integration.test.ts src/acp/managed-session.integration.test.ts"
      rationale: "Workspace continuation has no real-store integration suite, and ACP has no managed Session coverage. Both named cross-surface behaviors must execute."
    - id: "OC3"
      command: "! grep -q \"readTextFile\" src/shared/session/execution-segment-runtime.test.ts && grep -Eq \"Deno.test\\([\\\"']process restart after committed execution rollover reuses one successor and writes one seed turn[\\\"']\" src/shared/session/execution-segment-runtime.test.ts && deno run -A scripts/run-tests.js src/shared/session/execution-segment-runtime.test.ts"
      rationale: "The current suite only inspects source text. It must become a behavioral restart suite that proves one successor and one seed turn."
    - id: "OC4"
      command: "! grep -q \"readTextFile\" src/shared/workflow/semantic-repair-segment-handoff.test.ts && grep -Eq \"Deno.test\\([\\\"']two real semantic rejections create two ordered repair segments and no Reviewer segments[\\\"']\" src/shared/workflow/semantic-repair-segment-handoff.test.ts && deno run -A scripts/run-tests.js src/shared/workflow/semantic-repair-segment-handoff.test.ts"
      rationale: "The current repair suite only inspects source text. It must execute repeated semantic rejection and persisted repair rollover behavior."
    - id: "OC5"
      command: "grep -Eq \"Deno.test\\([\\\"']load-plan recovery rejects replaced worktree registry evidence before mutation[\\\"']\" src/cmd/load-plan/index.integration.test.ts && grep -Eq \"Deno.test\\([\\\"']Workspace Plan action rejects changed status and worktree evidence with a real owner store[\\\"']\" src/ui/workspace/owner-plan-actions.test.ts && deno run -A scripts/run-tests.js src/cmd/load-plan/index.integration.test.ts src/ui/workspace/owner-plan-actions.test.ts"
      rationale: "Command coverage lacks replaced-worktree rejection, and Workspace action tests use a hand-built store. Both entry points must reject changed canonical evidence in executable tests."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-26T20:48:25.378Z"
status: "user_verified"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 14
dependencies:
    - "13-execution-segment-handoff-backend"
failureReason: "- [R1-2] The ACP integration test still does not prove stable identity across a current-segment change.\n  Plan: ACP tests must use JSON-RPC through startRunWieldAcpServer and prove managed load/prompt behavior, stdout protocol safety, accepted prompt publication, and stable ACP-to-RunWield Session identity across a current-segment change.\n  Evidence: src/acp/managed-session.integration.test.ts now uses startRunWieldAcpServer and JSON-RPC load/prompt, but the test never rolls over or changes the current segment before the accepted prompt. It only verifies generation 1 in the original current segment.\n- [R1-3] The Workspace continuation test still does not prove exact generation and idle eligibility rejection.\n  Plan: session-continuation.integration.test.ts must prove Workspace continuation publishes once, timeline reads do not acquire activation, continuation requires exact generation and idle eligible Ideator Session, duplicate receipts do not replay, observers see the turn, and process loss leaves recovery-required state.\n  Evidence: src/ui/workspace/session-continuation.integration.test.ts now calls startContinuation and checks duplicate request IDs, observer events, and operation_not_running. It still has no negative case for a stale or wrong expectedGeneration, and no case that continuation is rejected when the Session is not idle and eligible for the Ideator.\n- [R1-4] The cross-surface activation test still omits required loser-side no-mutation evidence.\n  Plan: competing Workspace and TUI processes allow exactly one managed Session writer must prove one mutation wins, the loser writes no transcript entry, Plan event, worktree change, or generation; a superseded proof cannot publish after the winner advances; and heartbeat age alone cannot authorize takeover.\n  Evidence: src/shared/owner-coordination/cross-surface-activation.integration.test.ts now asserts superseded publish rejection and heartbeat-age takeover rejection. It still does not attempt a loser write and does not inspect that the loser wrote no transcript entry, Plan event, worktree change, or generation.\n- [R1-5] The cross-surface workflow invariant tests still do not cover the named observer and damaged-evidence cases.\n  Plan: Aggregate readers from TUI and Workspace must fail closed for damaged sealed/current evidence and return sanitized reconciliation categories; writable restart hydrates must prove TUI and ACP observers keep the same Session identity, consume namespaced cursors without duplicates, and after activation release publish exactly the next generation in the committed current segment.\n  Evidence: The repair diff does not change src/shared/session/cross-surface-workflow-invariants.integration.test.ts. The open gaps remain.\n- [R1-6] The required composed TUI coverage is still missing.\n  Plan: src/ui/tui/chat-input-controller.test.ts and src/ui/tui/segment-aware-sync.test.js must prove read-only behavior while another surface owns activation, draft and attachment retention, committed observer refresh, namespaced cursor de-duplication, stable Session identity, and later takeover after explicit retry.\n  Evidence: The repair diff does not change src/ui/tui/chat-input-controller.test.ts or src/ui/tui/segment-aware-sync.test.js.\n- [R1-7] The Workspace Plan action coverage still does not test most required evidence and receipt failures.\n  Plan: Workspace Plan actions must run against the real owner store and reject changed Plan revision, changed Plan Status, replaced/missing/ambiguous worktree evidence, stale generation, and wrong current segment before lifecycle mutation; exact duplicate request IDs return the stored bounded response, while accepted/running receipts do not authorize replay or another request.\n  Evidence: The repair diff does not change src/ui/workspace/owner-plan-actions.test.ts. The required revision, worktree, generation, current-segment, and receipt replay matrix remains missing.\n- [R1-8] The load-plan recovery test still bypasses the load-plan command entry point and covers only one race.\n  Plan: load-plan integration coverage must change canonical Plan Status and exact worktree evidence after review but before Approve & Run or recovery, and each action must fail before readiness, rollover, worktree creation/reuse, Agent execution, or Plan metadata mutation with guidance matching executePlanAction.\n  Evidence: The repair diff does not change src/cmd/load-plan/index.integration.test.ts. The test still does not add runLoadPlanCommand entry-point races for Approve & Run and recovery.\n- [R1-9] The execution handoff tests still do not perform real Runtime handoff and model-context checks.\n  Plan: execution-segment-runtime.test.ts must use real Session files and stores, include pre-commit failure and post-commit restart, reopen through Runtime, write one seed turn in the committed successor, create no duplicate segment or turn, and prove the Engineer request includes approved Plan inputs/images while excluding Planner sentinel and preserving it in aggregate projection.\n  Evidence: The repair diff does not change src/shared/session/execution-segment-runtime.test.ts. The direct store and hard-coded context gaps remain.\n- [R1-10] The semantic repair handoff tests still do not exercise real review rejection, Runtime restart, or model context.\n  Plan: semantic-repair-segment-handoff.test.ts must create two real Semantic Code Review rejections, persist two ordered repair segments with no Reviewer segments, reuse a committed repair marker once after restart, and check each repair model request contains frozen Plan, CI state, open issues, repair claims, diff access, and excludes prior Engineer and Reviewer sentinels while aggregate history retains events.\n  Evidence: The repair diff does not change src/shared/workflow/semantic-repair-segment-handoff.test.ts. The direct segment commit and hard-coded context gaps remain."
implementedAt: "2026-08-12T21:23:28.459Z"
userVerifiedAt: "2026-08-13T03:24:34.696Z"
userVerificationNote: "reviewer approved it. got stupid message Error: Stale Plan lifecycle precondition for personal-remote-workspace-v1/14-cross-surface-workflow-invariant-hardening: caller saw validated_ci, canonical status is implemented."
executionReport: "- Implemented Plan 14 hardening tests and fixture: added `src/testing/managed-session-fixture.ts`, cross-surface activation/projection tests, Workspace continuation test, ACP managed Session test, real-store Workspace Plan action test, and load-plan canonical worktree evidence test.\n- Replaced source-text handoff checks with behavioral tests in `execution-segment-runtime.test.ts` and `semantic-repair-segment-handoff.test.ts`; test-count delta is +7 total.\n- Replaced execution tests one by one: preparation failure now uses a real activation/rollover pre-commit failure; approved Plan snapshot check now uses stale evidence before mutation; committed marker check now uses real rollover/reopen facts; seed-context check now asserts approval image/sentinel boundaries without source reads.\n- Replaced semantic repair tests one by one: repeated rejection now creates two ordered repair segments; pending repair marker coverage now checks the repair packet boundary; CI-state coverage now asserts current CI state in the repair context; predecessor context coverage now asserts Engineer/Reviewer sentinel exclusion.\n- Updated `docs/usage.md` with active-owner conflict, explicit retry, damaged transcript reconciliation, and direct Pi JSONL writer guidance.\n- Verification passed: focused integration suites, canonical action suites, behavioral handoff suites, `deno task seams:check`, and full `deno task ci` all passed.\n- Manual TUI/Workspace/ACP flows from the Verification Plan were not run interactively; the new automated integration tests cover those boundary conditions without a live UI session."
humanReviewMode: null
humanReviewDecision: null
executionMode: "worktree"
executionBaselineTree: "6cf8de9e31b83f45b7eb07ff5c80a56b1c78bf15"
worktreeId: "91b72ae8"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-personal-remote-workspace-v1-14-cross-surface-wo-91b72ae8"
worktreeBranch: "worktree/personal-remote-workspace-v1-14-cross-surface-wo-91b72ae8"
worktreeBaseBranch: "main"
worktreeStatus: "completed"
planName: "personal-remote-workspace-v1/14-cross-surface-workflow-invariant-hardening"
validationCiAttempts: 0
validationSemanticRounds: 3
updatedAt: "2026-08-24T21:23:47.295Z"
archivedAt: "2026-08-24T21:23:47.295Z"
archivedFromStatus: "user_verified"
archivedFromPath: "docs/plans/personal-remote-workspace-v1/14-cross-surface-workflow-invariant-hardening.md"
---

# Cross-Surface Workflow Invariant Hardening

## Context

Verified Personal Remote Workspace slices now provide Session Activation, committed generations, ordered Session
Transcript Segments, Aggregate Transcript Projection, Plan Action Evidence Check, and execution/semantic-repair segment
handoffs. The next browser slices depend on these boundaries, but current coverage is uneven:

- owner-coordination tests prove database fencing, while no behavioral test makes two Runtime owners compete for one
  stable Session;
- TUI coverage proves a draft remains when Workspace owns activation, but not observer refresh or later takeover;
- ACP uses the shared owner-coordination store in production, but its tests cover unmanaged persisted Sessions only;
- `WorkspaceSessionContinuationService` has no integration test against a real store and Runtime;
- Workspace Plan actions use a hand-built store, and command tests do not cover all canonical status/worktree races; and
- slice 13's execution and repair Runtime tests inspect source text instead of performing rollover, restart, repeated
  repair, and model-context assertions.

Before Attention Dashboard and Session timeline UI build on these services, executable tests must prove that all
surfaces observe the same committed Session and cannot bypass the same mutation and Plan authorities.

## Objective

Deliver an integration safety net that proves:

- exactly one TUI, Workspace, or Agent Client Protocol (ACP) Runtime owner can mutate a stable managed Session at a
  time;
- observers emit only a fully verified committed generation and keep one stable Session identity across segment changes;
- a later writer hydrates the generation-named current segment, never an older segment or an uncommitted transcript
  tail;
- Workspace and `load-plan` actions reject stale canonical Plan revision, Plan Status, and exact worktree evidence
  before lifecycle, worktree, rollover, or Agent mutation;
- execution restart reuses one committed successor and one seed turn, while each Semantic Code Review rejection creates
  one persisted repair segment with bounded model context; and
- each blocked or damaged state returns a stable, sanitized category with a clear refresh, retry, or recovery action.

Limit production changes to defects and diagnostics exposed by these tests. Do not add product UI, workflow authority,
operation-progress storage, or an injection seam.

## Approach

Add a shared test fixture that creates one temporary Project, one real owner-coordination SQLite database, one cataloged
managed Session, and two independently opened stores/Runtimes with different process identities. Use the existing
fixture model as the external Agent-turn boundary. Use real transcript files, Plan files, Git repositories, and worktree
registry data. Do not inject Plan, lifecycle, rollover, lock, or owner-database behavior.

Drive public sibling surfaces rather than reimplementing their decisions in tests:

- TUI tests use the composed TUI and its existing virtual terminal;
- Workspace tests use `WorkspaceSessionContinuationService` and `runOwnerPlanAction` with a real store;
- ACP tests use JSON-RPC through `startRunWieldAcpServer`;
- command tests use the `load-plan` command fixture; and
- shared Runtime tests perform actual rollover, close/reopen, marker resolution, Agent turn, and Aggregate Transcript
  Projection.

Use deterministic barriers only at genuine external boundaries, such as the fixture model turn or a child-process stop.
For commit-boundary tests, stop after the rollover transaction is committed and before the first seeded Agent entry.
Then open a new Runtime against the same database and files. Assert canonical files and store facts before and after
each attempt, not only returned error text.

Keep adapters as sibling consumers of `SessionRuntime`. If tests expose different diagnostics, normalize them in the
shared Runtime/service layer to stable categories (`activation_unavailable`, `refresh_required`, `reconcile_required`,
or `recovery_required`). Keep local paths, proof tokens, transcript contents, and raw database errors out of
owner-facing responses.

## Files to Modify

- `src/testing/managed-session-fixture.ts` — shared real-file/SQLite fixture for one managed Session, independent owner
  stores, fixture Agent turns, committed evidence inspection, Runtime restart, and safe cleanup.
- `src/shared/owner-coordination/cross-surface-activation.integration.test.ts` and existing activation tests — prove one
  winner across independent stores and reject stale owner, generation, and current-segment proofs.
- `src/shared/session/cross-surface-workflow-invariants.integration.test.ts` — prove committed aggregate reads,
  transcript-ahead rejection, current-segment writable hydration, activation release/takeover, and sanitized damaged
  evidence behavior.
- `src/shared/session/execution-segment-runtime.test.ts` — replace source-text assertions with real pre-commit failure
  and post-commit restart scenarios.
- `src/shared/workflow/semantic-repair-segment-handoff.test.ts` — replace source-text assertions with real repeated
  rejection/repair rollovers and direct model-context checks.
- `src/ui/tui/chat-input-controller.test.ts` and `src/ui/tui/segment-aware-sync.test.js` — prove draft retention,
  committed observer refresh, namespaced cursor de-duplication, stable Session identity, and later takeover.
- `src/ui/workspace/session-continuation.integration.test.ts`, `src/ui/workspace/server/session-continuation.js`, and
  `src/ui/workspace/owner-plan-actions.test.ts` — exercise timeline, continuation, execution handoff, receipts, and Plan
  actions against a real store; normalize only diagnostics exposed by those tests.
- `src/acp/managed-session.integration.test.ts` and, only if needed, `src/acp/server.js` and `src/acp/session-map.js` —
  prove managed load/prompt behavior and stable ACP-to-RunWield Session identity across a current-segment change.
- `src/cmd/load-plan/index.integration.test.ts` and affected `src/cmd/load-plan/` handlers — prove action-time status
  and exact worktree checks at command entry points before execution or recovery side effects.
- `src/shared/session/session-runtime.js`, `src/shared/session/session-transcript-manifest.ts`,
  `src/shared/workflow/plan-actions.ts`, and owner-coordination implementation files — change only where a behavioral
  integration test exposes an invariant or diagnostic defect.
- `docs/usage.md` — document how a user responds to active-owner conflicts, stale views, transcript reconciliation, and
  unsupported direct Pi writers.

No domain-language change is required. This Plan hardens the current definitions of Session Activation, committed
Session generation, Aggregate Transcript Projection, Plan Action Evidence Check, and Session Transcript Segment
Rollover.

## Reuse Opportunities

- `src/cmd/testing/runtime-command-fixture.ts` — fixture model and isolated command environment.
- `src/shared/git-test-fixture.ts` and `src/shared/workflow/validation-test-helpers.js` — real Git/Plan projects without
  production-owned test seams.
- `src/shared/owner-coordination/index.js` — independently open the same owner database through the public store.
- `src/shared/session/session-transcript-manifest.ts` and `session-transcript-projection.js` — verify committed
  aggregate history and authority facts; do not concatenate files in tests.
- `src/ui/tui/testing/virtual-terminal.ts`, `chat-input-controller.test.ts`, and `segment-aware-sync.test.js` — composed
  TUI input and stable event de-duplication patterns.
- `src/acp/server.test.js` — real JSON-RPC server, fixture model, streamed update, and restart patterns.
- `src/shared/workflow/plan-actions.ts`, `src/ui/workspace/server/owner-plan-actions.ts`, and
  `src/cmd/load-plan/index.integration.test.ts` — shared Plan Action Evidence Check and entry-point fixtures.
- `src/shared/session/segment-rollover.test.js`, `execution-segment-runtime.test.ts`, and
  `src/shared/workflow/semantic-repair-segment-handoff.test.ts` — real rollover and continuation marker authorities.
- `src/shared/session/architecture-boundary.test.js` and `deno task seams:check` — preserve Runtime ownership and the
  zero-seam baseline.

## Implementation Steps

- [ ] `src/testing/managed-session-fixture.ts` creates a real managed Session over a temporary Project and owner SQLite
      file, can open at least two independent stores/Runtimes with distinct owner identities, records fixture-model
      requests, reads canonical activation/generation/segment facts, and cleans up without changing the real home or
      current working directory. Tests that must change process globals use `withProcessGlobalTestLock`.
- [ ] `cross-surface-activation.integration.test.ts` includes the behavioral case
      `competing Workspace and TUI processes
      allow exactly one managed Session writer`. It starts two independent
      owners at the same committed generation and proves one mutation wins. The loser writes no transcript entry, Plan
      event, worktree change, or generation. A superseded proof cannot publish after the winner advances the generation,
      and heartbeat age alone cannot authorize takeover.
- [ ] Aggregate readers from TUI and Workspace emit no events when any sealed segment or current committed prefix fails
      length, digest, terminal-entry, order, lineage, or generation/current-segment checks. An uncommitted transcript
      tail and orphan rollover candidate remain invisible. Responses contain a stable reconciliation category without
      local path or transcript content.
- [ ] `cross-surface-workflow-invariants.integration.test.ts` includes
      `writable restart hydrates the committed current
      segment instead of the predecessor`. After a
      Workspace-owned generation and segment change, TUI and ACP observers keep the same RunWield Session identity,
      consume namespaced cursors without duplicates, and show committed events. When activation returns to idle, the
      next accepted TUI or ACP prompt hydrates the committed current segment and publishes exactly the next generation;
      it never appends to the predecessor.
- [ ] The composed TUI remains read-only while another surface owns activation, preserves typed text and attachments,
      refreshes committed observer events without submitting the draft, and submits the same draft only after an
      explicit retry following activation release.
- [ ] `session-continuation.integration.test.ts` includes
      `Workspace continuation publishes once and a TUI observer
      resumes from the new cursor`. Its coverage proves
      timeline reads do not acquire activation, continuation requires exact generation and an idle eligible Ideator
      Session, duplicate request receipts do not replay a turn, and a published Workspace turn becomes visible to a
      TUI/ACP observer. Process loss leaves a pending receipt as recovery-required rather than workflow authority.
- [ ] `managed-session.integration.test.ts` includes
      `ACP load uses the committed current segment and rejects prompt while
      Workspace owns activation`. Its
      JSON-RPC coverage proves `session/load` resolves the stable RunWield Session to the committed current segment,
      `session/prompt` is rejected while Workspace/TUI owns activation without writing protocol noise to stdout, and an
      accepted prompt publishes one generation visible through Workspace timeline.
- [ ] Workspace Plan actions run against the real owner store and reject changed Plan revision, changed Plan Status,
      replaced/missing/ambiguous worktree evidence, stale generation, and wrong current segment before lifecycle
      mutation. Exact duplicate request IDs return the stored bounded response; accepted/running receipts never
      authorize replay or another request.
- [ ] `load-plan` integration coverage includes
      `load-plan recovery rejects replaced worktree registry evidence before
      mutation`. It changes canonical Plan
      Status and exact worktree evidence after review but before Approve & Run or recovery. Each action fails before
      readiness, rollover, worktree creation/reuse, Agent execution, or Plan metadata mutation, and gives refresh or
      recovery guidance that matches `executePlanAction`.
- [ ] `execution-segment-runtime.test.ts` no longer uses source-text inspection as proof and includes
      `process restart
      after committed execution rollover reuses one successor and writes one seed turn`. With
      real Session files and stores, preparation or pre-commit rollover failure leaves planning current; a stop after
      execution rollover commit leaves one pending marker; reopening starts one seed turn in that successor and creates
      no duplicate segment or turn. The Engineer request includes approved Plan inputs/images and excludes a unique
      Planner sentinel, while Aggregate Transcript Projection retains the sentinel in the planning segment.
- [ ] `semantic-repair-segment-handoff.test.ts` no longer uses source-text inspection as proof and includes
      `two real
      semantic rejections create two ordered repair segments and no Reviewer segments`. Two rejected
      Semantic Code Review rounds create two ordered `semantic_repair` segments, Reviewer Agent Sessions create none,
      and restart from a committed repair marker reuses its successor once. Each repair model request contains the
      frozen Plan, current CI state, complete open Review Issues, applicable repair claims, and diff access, but
      excludes unique prior Engineer and Reviewer sentinels; aggregate owner-visible history retains all segment events.
- [ ] Activation loss, rollout disabled, stale generation/current segment, transcript-ahead evidence, damaged sealed
      evidence, changed canonical Plan evidence, and pending rollover/receipt states map to stable sanitized diagnostics
      with one owner action: refresh, explicit retry, or recovery. No response exposes an activation proof, database
      path, transcript path/body, worktree path, or raw SQLite error.
- [ ] `docs/usage.md` describes active-owner conflict, stale-view refresh, explicit retry after owner-process loss,
      reconciliation for damaged or direct-writer transcript evidence, and why direct Pi writers are unsupported during
      a managed Session.

## Approval Confirmation

No Work Record is superseded by this Plan.

## Verification Plan

- Automated: run focused integration suites with
  `deno run -A scripts/run-tests.js src/shared/owner-coordination/cross-surface-activation.integration.test.ts
  src/shared/session/cross-surface-workflow-invariants.integration.test.ts
  src/ui/workspace/session-continuation.integration.test.ts src/acp/managed-session.integration.test.ts
  src/ui/tui/chat-input-controller.test.ts src/ui/tui/segment-aware-sync.test.js`.
- Automated: run canonical action suites with
  `deno run -A scripts/run-tests.js src/shared/workflow/plan-action-evidence.test.ts
  src/ui/workspace/owner-plan-actions.test.ts src/cmd/load-plan/index.integration.test.ts`.
- Automated: run behavioral handoff suites with
  `deno run -A scripts/run-tests.js src/shared/session/execution-segment-runtime.test.ts
  src/shared/workflow/semantic-repair-segment-handoff.test.ts`.
- Automated: run `deno task seams:check` and `deno task ci`.
- Automated: inspect canonical store/transcript/Plan/worktree facts after every blocked attempt. A blocked attempt must
  leave generation, current segment, Plan Status/revision, worktree registry, and model-request count unchanged.
- Automated: inspect actual fixture-model message arrays and Aggregate Transcript Projection. Execution excludes the
  Planner sentinel; repair excludes predecessor Engineer and Reviewer sentinels; owner-visible projection retains each
  sentinel in its source segment.
- Automated: preserve existing unmanaged Session behavior, Plan Lifecycle transitions, Approve for Later behavior,
  rollover recovery, TUI draft handling, ACP protocol framing, and bounded receipt idempotency. No user behavior is
  expected to stop except treating source-text assertions as sufficient handoff proof.
- Manual: open one managed Session in TUI and Workspace. Type an unsent TUI draft, run one Workspace continuation,
  refresh the TUI, and confirm the committed Workspace exchange appears while the draft remains unsent. Release
  activation, explicitly retry the draft, and confirm it appends to the current segment once.
- Manual: with ACP attached to the same Session, confirm a prompt is rejected while another surface owns activation and
  succeeds after release without changing ACP Session identity.

## Edge Cases & Considerations

- SQLite handles must be independent to prove cross-process behavior; two service objects over one handle are not
  enough. Use child processes only where process death is part of the invariant.
- A process can stop after an external side effect but before generation publication. Do not infer safe replay from an
  old heartbeat or operation receipt; preserve recovery-required state.
- JSONL and SQLite do not commit atomically. Transcript-ahead evidence can be a valid recovery input, but normal readers
  and writers must fail closed until reconciliation establishes canonical facts.
- Pending Structured Interactions remain process-local. Tests must not recreate an unanswered interaction after owner
  loss; a completed Pi tool result remains in committed projection.
- Aggregate Transcript Projection is display state. Tests must not use its active-Agent or workflow summary to authorize
  mutation.
- Direct Pi writers cannot be fenced retroactively. If extra transcript bytes conflict with committed evidence, all
  managed mutation blocks; tests must not silently truncate or adopt the bytes.
- Stable categories are an owner-facing compatibility surface. Keep detailed causes in sanitized internal diagnostics
  and avoid brittle matching on raw dependency messages.
- Full cross-product testing is not required. Each sibling adapter must have one real managed read and mutation path,
  while shared Runtime/store tests carry the complete race and crash matrix.
- Keep the zero-seam baseline. The fixture model, subprocess, and process-stop barriers are genuine external boundaries;
  Plan storage, lifecycle, locks, SQLite, transcript writes, rollover, and worktree operations stay real.
