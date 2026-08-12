---
planId: "71193aae-92b3-4123-9ac4-ed6cae9b0aa1"
classification: "PROJECT"
complexity: "HIGH"
summary: "Evolve RunWield Workspace into a secure personal multi-Project environment with activated segmented Sessions, canonical Plan actions, remote browser access, search, and a subordinate Code Surface."
affectedPaths:
    - "docs/prd/runwield-workspace-prd.md"
    - "docs/prd/runwield-core-prd.md"
    - "docs/prd/runwield-acp-protocol-prd.md"
    - "docs/adr/011-exclusive-session-activation-and-durable-workflow-checkpoints.md"
    - "docs/adr/012-segment-session-transcripts-at-execution-handoff.md"
    - "src/shared/owner-coordination/"
    - "src/shared/session/"
    - "src/shared/workflow/"
    - "src/shared/worktree-registry.js"
    - "src/shared/work-records/"
    - "src/ui/workspace/"
    - "src/ui/tui/"
    - "src/acp/"
    - "src/cmd/"
    - "src/extensions/cymbal/"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-07-21T22:32:43-04:00"
updatedAt: "2026-07-27T19:30:00.000Z"
status: "ready_for_work"
origin: "internal"
humanReviewMode: null
humanReviewDecision: null
worktreeStatus: "abandoned"
---

# Personal Remote Workspace v1

Recommendation: use SQLite FTS5 as the default durable-artifact index, with canonical Markdown hydration remaining the
source of truth. Keep Typesense behind a replaceable artifact-search provider seam for later adoption if product needs
justify another server process.

## Context

RunWield Workspace is a strong single-checkout Plan surface but not yet the persistent personal environment described by
the Workspace PRD. The owner cannot yet register several trusted Projects, continue one stable Session across TUI,
Workspace, and ACP, see attention across Projects, or search eligible artifacts and source code remotely.

Existing foundations include sibling TUI and ACP consumers of `SessionRuntime`, Pi JSONL model history, Plan Lifecycle,
worktree evidence, Work Records, Workspace Plan/Plannotator surfaces, Mnemosyne retrieval, Cymbal code intelligence, and
the RunWield Design System. Verified children 01–10 add owner catalog, secure bootstrap, Session Activation, managed
read and mutation boundaries, an ordered segment manifest, aggregate projection, and transactional rollover primitives.

One stable RunWield Session owns ordered Pi JSONL Session Transcript Segments. Prior segments are sealed; exactly one is
current and writable. Aggregate projection presents continuous owner-visible history, while model context and writable
hydration use only the current segment. Session Activation is the only cross-process mutation lease and fences all
managed Session mutation.

Pi stores completed tool calls and results in Session history. Pending structured interactions belong to the live owning
process. If that process is lost, another surface reloads committed history and the user asks the Agent to retry. Plan
Lifecycle, Plan revision, and worktree records remain canonical; every consequential Plan action validates those facts
when it starts. Existing endpoint operation receipts may deduplicate one HTTP request but do not represent workflow
progress. Execution and semantic repair use slice 10's opaque rollover continuation marker and no other continuation
store.

The first deployment serves one trusted developer over a private network. Browser devices require local owner-approved
pairing. TUI, Workspace, and ACP remain sibling Runtime consumers rather than clients of a central Runtime proxy.

## Objective

Deliver Personal Remote Workspace v1 so the owner can:

- register and safely operate several local Projects;
- find running, waiting, ready, failed, degraded, and recently completed work;
- start or continue one stable segmented Session from TUI, Workspace, or ACP without concurrent writers;
- review a TUI-created Plan by phone, send Feedback, approve for later or immediate execution, and return to a
  synchronized TUI;
- continue idle ideation/planning conversations across surfaces without manual Session replacement;
- keep Planner history owner-visible while starting Engineer in a fresh execution segment containing only approved Plan
  inputs and current execution state;
- start each semantic repair in a fresh bounded repair segment under the same stable Session and execution worktree;
- continue browser-owned work while its process lives, and retry a pending interaction after owner-process loss;
- recover conservatively from transcript, process, Plan, worktree, or coordination failures;
- search eligible durable artifacts and explicitly scoped Project code;
- inspect or edit a registered Project main checkout through a subordinate code-server surface; and
- preserve existing QUICK_FIX, non-Git, Shared Plan, TUI, ACP, validation, and worktree behavior where compatible.

ADR-011 controls cross-process Session activation and continuity. ADR-012 controls transcript segmentation and the
planning-to-execution context boundary. ADR-008 retains Shared Space authority, and ADR-010 retains sibling adapter
dependency direction.

## Authority Model

### Stable Session identity and segments

The owner coordination database maps a stable Session ID to a registered Project and ordered segment manifest. Each
segment has a guarded Pi locator, stable identity, ordinal, kind, and integrity evidence. One segment is current;
earlier segments are sealed. Minimal private lineage in new segments permits reconstruction without copying conversation
text or Planner summaries.

The owner database also stores Project registration, paired devices, committed Session generations, Session Activation,
segment metadata, rebuildable attention summaries, and bounded endpoint operation receipts. It is not canonical storage
for Plans, PRDs, ADRs, Work Records, source, transcript content, or workflow progress.

### Session Control and Session Activation

Session Control is a client-level permission to submit a request from an authorized surface. It does not itself permit
mutation. Before writable hydration or any managed Session mutation, the stable Session must hold fenced Session
Activation and prove the expected generation and current segment.

Activation covers turns, tools, cancellation settlement, compaction, model/settings changes, live interactions,
execution, validation, and segment rollover. Separate segment locks are forbidden because two segments still belong to
one user-visible Session. Heartbeat age is evidence for recovery, not automatic takeover permission.

Readers do not need activation. They validate a committed generation containing complete sealed-segment evidence and the
committed current-segment prefix before emitting aggregate history. Losing an activation or generation race causes a
refresh and explicit resubmission; local drafts and attachments are preserved.

| Action                    | Required authority                                            | Result                                                  |
| ------------------------- | ------------------------------------------------------------- | ------------------------------------------------------- |
| Observe/reconnect         | Project/device authorization                                  | Validate and read committed aggregate generation        |
| Submit a request          | Session Control + Session Activation                          | Append to proven current segment and publish generation |
| Answer a live interaction | Authorized route to the active owner process                  | Complete the in-process call; Pi records its result     |
| Perform a Plan action     | Session Activation + current canonical Plan/worktree evidence | Delegate to Plan Lifecycle/worktree authorities         |
| Repeat an HTTP request    | Same bounded request ID                                       | Return prior endpoint response when receipt is valid    |

### Commit ordering and recovery

JSONL and repository effects cannot commit atomically with SQLite. Writers therefore synchronize canonical transcript or
repository effects before publishing their new manifest/generation evidence. Reconciliation inspects segment lineage,
stable entry IDs, Plan revisions, and worktree records. Database publication must never claim an effect that canonical
storage does not prove.

A completed Pi tool result survives restart and appears in aggregate projection. A still-pending Promise does not. If
the owner process stops, the next owner opens the committed current segment and the user requests a retry. This
deliberately accepts possible repeated questions rather than reconstructing arbitrary runtime stacks.

### Planning, execution, and semantic repair

Approve & Run first revalidates Plan status/revision and relevant worktree evidence, then passes readiness and execution
preparation. Only then does transactional rollover create, synchronize, and activate a fresh execution segment. Approve
for Later creates no segment.

The execution segment is seeded with the approved Plan, approval annotations/images, current lifecycle/worktree state,
and execution ownership—never Planner messages or a generated Planner summary. Its current opaque marker identifies the
known Engineer startup context. Failure before rollover commits leaves planning current and requires retry. Failure
after commit resumes from the current segment marker.

Execution remains current through implementation, isolated Reviewer passes, and validation. Each semantic rejection
transactionally activates a fresh repair segment seeded with frozen requirements, current execution/CI state, complete
open Review Issues, applicable repair claims, and bounded repository/diff access. It excludes predecessor Engineer and
Reviewer history. Reviewer Sessions remain disposable; repair segments remain owner-visible ordered Session history.

### Canonical Plan actions

Canonical Plan Lifecycle owns statuses and transitions. Plan markdown owns revision-bearing content, and the worktree
registry owns worktree evidence. Owner and remote actions run under Session Activation and reload these authorities
immediately before mutation. Changed revision/status, missing worktree, or conflicting evidence blocks the action and
returns refresh or recovery guidance.

No Session gains persistent ownership of a Plan merely by viewing or acting on it. A later action starts from current
canonical facts. An `owner_session_operations` receipt may make duplicate delivery of one endpoint request idempotent;
it cannot reserve a Plan, authorize another request, or prove that work remains active.

## Workspace Application and Trust

Workspace application services own registered Project lifecycle and path authorization, paired devices, HTTP/WebSocket
security, Project health, attention projections, search, Cymbal fan-out, and code-server supervision. Device pairing
uses short-lived locally approved bootstrap material and revocable hashed credentials. Private-network access still
requires a secure TLS browser boundary.

Owner Workspace storage and routes remain separate from public Shared Space ciphertext/capability storage. Shared Plan
review and owner Plan actions may reuse visual components but never authorization grants.

## Attention, Search, and Code Surface

Attention is a rebuildable display projection derived from Session activation/generations/transcript events, canonical
Plans/worktrees, validation evidence, and Project health. It never authorizes or advances work.

Workspace artifact search hydrates canonical eligible artifacts after an index selects candidates. Session Transcripts
remain owner-private and human-searchable, excluded from Workspace Intelligence and cross-Session Agent retrieval. Human
code search fans bounded Cymbal queries across explicitly selected registered main checkouts. Results preserve Project
identity, expose partial failures, and exclude Plan worktrees.

code-server is subordinate to Workspace and opens only a registered Project main checkout. It cannot claim RunWield
worktrees or mutation authority. Manual edits may stale a Plan or create conflicts that canonical checks must surface.

## Migration and Coexistence

Legacy one-JSONL Sessions migrate to ordinal-zero manifests without rewriting conversation bodies. Before gaining a
successor, managed lineage is synchronized. Ambiguous/cyclic lineage, a missing sealed segment, or an unattached
successor fails closed and enters explicit reconciliation.

All managed TUI, Workspace, ACP, initialization, and Plan-loading paths must converge on Session Activation and
current-segment resolution before cross-surface continuation is enabled. Older/direct Pi processes do not honor owner
coordination and are unsupported concurrent writers; detected conflicting evidence blocks mutation.

A damaged owner database is reconstructed from re-registered Projects, transcript lineage, Plan files, and worktree
evidence. Reconstruction never guesses segment order or repeats uncertain work. Existing Plan IDs and Work Record IDs
remain canonical.

## Child Decomposition

Verified historical children 01–10 remain unchanged. Remaining execution follows this chain:

1. `11-simplify-session-continuity` aligns active architecture, PRDs, domain language, and product-facing source.
2. `12-session-activated-plan-actions` adds action-time canonical Plan/worktree checks under Session Activation.
3. `13-execution-segment-handoff-backend` implements execution and repair rollover using the current marker.
4. `14-cross-surface-workflow-invariant-hardening` tests activation, generations/segments, projection, canonical checks,
   and context boundaries.
5. `15-attention-dashboard-and-multi-project-projections` derives rebuildable attention across Projects.
6. `16-complete-workspace-session-navigation-and-timeline-ux` renders aggregate committed Pi history and live waits.
7. `17-workspace-plan-review-approve-and-recovery-ui` delivers owner Plan actions with bounded request idempotency.
8. `18-workspace-artifact-and-cymbal-search` completes canonical artifact and scoped code search.
9. `19-subordinate-code-surface-supervision-and-deep-links` adds the constrained code-server integration.

## Files to Modify

- Current Workspace/Core/ACP requirements and ADR-011/ADR-012 — align Session activation, segmentation, retry, and
  context-boundary behavior.
- `src/shared/owner-coordination/` — Projects, pairing, stable Sessions, activation, generations, segment manifest, and
  bounded endpoint receipts.
- `src/shared/session/` — lineage, aggregate projection, current-segment hydration, semantic events, and rollover
  marker.
- `src/shared/workflow/`, `src/plan-store.js`, and `src/shared/worktree-registry.js` — canonical action checks,
  execution/repair handoff, validation, and recovery.
- `src/ui/tui/`, `src/acp/`, and `src/cmd/` — stable Session mapping, activation-aware mutation, read synchronization,
  and compatible entry points.
- `src/ui/workspace/` — secure owner APIs, Attention Dashboard, Session timeline, Plan review, search, and Code Surface.
- `src/shared/work-records/` and `src/extensions/cymbal/` — canonical artifact hydration and bounded code federation.
- Design-system and deployment documentation where required by executable frontend and operations slices.

## Reuse Opportunities

- `SessionRuntime` and semantic Runtime events as the adapter-neutral engine.
- `session-transcript-projection.js`, segment manifest, and rollover primitives for aggregate history.
- `session-activations.js` for the sole fenced writer.
- `workflow-context-session.js` for the existing current-segment startup marker.
- `plan-lifecycle.js`, `plan-store.js`, and `worktree-registry.js` as canonical Plan authorities.
- Existing Workspace Plan/Plannotator UI and RunWield Design System.
- Work Record candidate-index plus canonical-hydration patterns.
- Cymbal's installed CLI/JSON contract.
- Shared Space modules only behind their separate trust boundary.

## Verification Plan

- Run `deno task ci` after each executable slice and at Epic integration.
- Prove only one process can hydrate/mutate a stable Session and stale activation/current-segment proofs fail.
- Prove readers validate complete aggregate generation evidence and preserve namespaced cursor continuity.
- Prove compaction, model context, and writable hydration use only the current segment.
- Exercise transcript-ahead/database-behind, orphan successor, damaged sealed segment, and activation-loss recovery.
- Prove Plan actions reject changed status/revision/worktree evidence across Workspace and applicable commands.
- Prove endpoint request deduplication returns a bounded prior response but never authorizes a new action.
- Prove pre-rollover interruption requires retry and post-rollover interruption resumes the current opaque marker.
- Prove execution excludes Planner history and each repair excludes predecessor Engineer/Reviewer history.
- Prove pending process-local interactions are not recreated after owner loss and completed Pi calls remain visible.
- Prove idle TUI/ACP/Workspace readers synchronize aggregate generations without writable hydration or lost drafts.
- Verify Project registration, pairing/revocation, CSRF/Origin policy, root containment, and Shared Space separation.
- Verify attention rebuilds from authority, artifact search canonically hydrates results, Cymbal scope is bounded, and
  code-server targets only registered main checkouts.
- Perform headed phone/desktop journeys for dashboard, Session timeline, Plan review/execution/recovery, search,
  pairing, and Code Surface.

## Edge Cases & Considerations

- **Uncertain side effects:** Activation fencing cannot undo an issued command. Do not auto-take over uncertain work;
  inspect canonical transcript, Plan, and worktree evidence and route ambiguity to recovery.
- **Transcript ahead of database:** Reconcile lineage and stable entries without duplicating content or guessing
  current.
- **Database ahead of canonical storage:** Block projection and mutation; publication order should prevent this state.
- **Sealed integrity:** Missing, truncated, moved, rewritten, or ambiguous sealed segments block complete replay.
- **Identity collisions:** Pi entry IDs are file-local; aggregate events/cursors include segment identity.
- **Read-only behavior:** Observation must not call a Pi API that can migrate or rewrite files.
- **Open clients:** The first activation transaction wins; losing clients refresh and preserve local drafts.
- **Pending interactions:** Browser disconnect does not settle a live wait. Owner-process loss requires an Agent retry.
- **Plan review:** Every consequential action checks current Plan revision/status and relevant worktree evidence.
- **Approve & Run:** Rollover occurs only after readiness/preparation; Approve for Later creates no segment.
- **Manual edits:** Direct repository edits remain possible and are detected through canonical checks.
- **Legacy writers:** Unsupported writers cannot be fenced retroactively; conflicts block managed mutation.
- **Projection authority:** Dashboard and Session summaries are display caches and never workflow truth.
- **Security:** Pairing is authorization, not encryption; owner routes require a secure private browser boundary.
- **Search privacy:** Apply Project selection and opt-out before subprocess launch or result hydration.
- **Frontend quality:** Follow `docs/design-system.md`, shared primitives, semantic `--rw-*` tokens, accessibility, and
  responsive phone behavior.
