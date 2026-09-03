---
status: accepted
---

# ADR-011: Exclusive Session Activation and Pi-Native Session Continuity

> Storage amendment: [ADR-015](./015-file-authoritative-session-bundles.md) supersedes this ADR's SQLite Session
> authority, renewable lease, heartbeat-expiry, and forced-takeover design. ADR-011 still defines exclusive mutation,
> committed-history synchronization, and conservative non-replay boundaries.

## Context

ADR-009 moved mutable runtime state into `HostedSession`, and ADR-010 established `SessionRuntime` as the shared
contract consumed by sibling TUI and ACP adapters. Those decisions isolate Hosted Sessions inside one process, but they
do not make one JavaScript Runtime instance shareable across TUI, Workspace, and ACP processes.

Personal Remote Workspace requires the owner to move one stable RunWield Session among surfaces:

- begin planning or ideation in the TUI;
- review a Plan, answer a live interaction, or continue the conversation from Workspace on a phone;
- allow approved execution and validation to continue on the laptop;
- return to an already-open TUI and see committed browser or ACP changes without manually reopening the Session.

The installed Pi `SessionManager` does not provide cross-process writer coordination. `SessionManager.open()` reads the
JSONL tree and current leaf into process memory. Each process then appends from its own in-memory leaf, and some
operations may rewrite the file. Two writable managers for the same persisted Session can therefore use stale context,
create unintended branches, or lose updates.

The owner does not need simultaneous cross-process control over one live Runtime. The required experience is exclusive
mutation, committed-history synchronization, and conservative retry after process loss.

## Decision

### Sibling Runtime consumers remain

TUI, Workspace, and ACP remain sibling consumers of the adapter-neutral `SessionRuntime` contract. Each process may own
its own `SessionRuntime` and `SessionHost`; no central Runtime proxy or shared JavaScript object is required.

A persistent Workspace process may host several live Sessions for browser clients. A TUI or ACP process may host other
Sessions. Cross-process correctness comes from durable coordination below the adapters, not from routing TUI or ACP
through Workspace application APIs.

A stable RunWield Session ID is the durable product identity. It maps to the internal Pi Session Manager identity and
ordered JSONL segment manifest. The current Hosted Session ID remains an in-process identity and must not be used as the
cross-process ownership key.

### Owner coordination store

An owner-only SQLite database under `~/.wld/` coordinates Personal Workspace state. It is distinct from:

- canonical repository Plans, PRDs, ADRs, Work Records, and source code;
- private Session JSONL transcript content;
- derived Mnemoteca and Cymbal indexes;
- public Shared Space ciphertext and capability storage.

The owner database stores only coordination records needed for registered Projects, paired devices, stable Session
identity, Session Activation, committed generations, ordered segment metadata, rebuildable attention projections, and
bounded endpoint operation receipts. Session content remains private Pi JSONL history and is not ingested into Workspace
Intelligence.

The owner database is not a workflow-progress authority for Plans, interactions, or execution stacks. Canonical Plan
files, Plan Lifecycle events, worktree registry evidence, and Pi transcript entries remain the authorities for their own
domains.

### Session Activation Lease

Before a process creates or mutates a writable Pi `SessionManager` for an existing stable Session, it must atomically
acquire a **Session Activation Lease** keyed by stable RunWield Session ID.

The lease records at least:

- stable Session ID and Project ID;
- activation owner identity and process kind;
- lease generation or fencing token;
- acquisition and heartbeat times;
- current activation phase;
- expected committed Session generation; and
- expected current Session Transcript Segment.

The fencing token is required on writes to owner coordination state. An older owner that wakes after takeover must be
unable to publish a generation or segment update.

The activation lease is held while:

- an Agent turn is running;
- execution, validation, compaction, cancellation settlement, model/settings mutation, or another mutable operation is
  active;
- a live process is waiting for an in-memory interaction answer that will continue that process if it remains alive;
- segment rollover or generation publication is committing.

A TUI window may remain open without activation, but its cached Runtime is no longer writable. Before its next mutation
it must reacquire the lease, compare committed Session generation and current segment evidence, and rehydrate if another
process advanced the Session.

Lease timeout alone does not prove that an interrupted effect is safe to repeat. Settled transcript entries may be
reloaded, but arbitrary model requests, commands, tools, open subprocesses, filesystem effects, and pending Promises are
never replayed automatically.

After the heartbeat deadline, an owner may run explicit **Forced Session Control Recovery**. The recovery validates the
ordered segment manifest and the structurally valid current transcript before it changes coordination state. Exact
published evidence returns the Session to idle. A valid transcript-ahead extension can become the next committed
generation. Corrupt, truncated, rewritten, sealed-segment, or ambiguous history blocks recovery. The recovery bumps the
fence so the old owner cannot heartbeat, change phase, or publish later coordination state.

### Ordered Pi Session Transcript Segments

One stable RunWield Session owns ordered **Session Transcript Segments** backed by separate Pi JSONL files. Prior
segments are sealed; exactly one segment is current and writable. The committed segment manifest and generation evidence
define the owner-visible Session timeline.

Readers validate a committed generation, complete sealed-segment evidence, and the committed current-segment prefix
before emitting aggregate projection. They do not acquire Session Activation and do not construct a writable
`SessionManager`.

Writable hydration uses only the current segment after activation. Planning-to-execution and semantic-repair rollovers
create fresh current segments under the same stable Session so model context is bounded while owner-visible history
remains continuous.

### Interaction continuity

Pi records completed tool calls and their results in Session JSONL. A completed `user_interview`, Plan review answer, or
other structured interaction therefore survives restart as committed history and appears in aggregate projection.

Pending interactions are process-local. A still-pending structured interaction is live process state. Workspace may
display and answer it only through an authorized route to the active owner process. If that process stops before Pi
writes the completed result, there is no separate durable interaction to consume. A later owner reloads committed
Session history and the user asks the Agent to retry the question or action.

This deliberately accepts possible repeated questions rather than reconstructing arbitrary Runtime stacks. Browser
disconnection does not by itself resolve or cancel a live wait; process loss makes the wait unavailable and requires
retry.

### Canonical Plan actions

Canonical Plan Lifecycle owns statuses and transitions. Plan markdown owns revision-bearing content, and the worktree
registry owns worktree evidence. Owner and remote Plan actions run under Session Activation and reload these authorities
immediately before mutation.

Changed Plan revision, changed status, missing worktree, replaced worktree evidence, or conflicting repository state
blocks the action and returns refresh or recovery guidance. No stable Session gains persistent Plan ownership merely by
viewing or acting on a Plan.

Endpoint operation receipts may make duplicate delivery of one HTTP request return the prior bounded endpoint response.
A receipt cannot reserve a Plan, authorize a later request, or prove workflow progress.

### Automatic read synchronization

Every committed Session generation is published only after corresponding transcript or repository effects are durable.

An open, idle, non-owning TUI monitors the stable Session record. When another Workspace or ACP process advances the
Session generation, the TUI automatically:

1. reads newly committed transcript state through a read-only path that cannot migrate or rewrite JSONL;
2. projects only unseen entries using stable entry and message IDs;
3. refreshes Plan, workflow, Agent, and attention summaries from canonical sources;
4. preserves unsent editor text and other local drafts;
5. shows which surface currently owns activation when the Session is not writable locally.

Read synchronization does not acquire the Session Activation Lease. Runtime hydration happens only after lease
acquisition.

A non-owner is not guaranteed every transient model token or tool-progress delta from another process. It receives
committed messages, completed interaction results, workflow status derived from canonical artifacts, and owner-visible
attention updates. The owning surface continues to render its full live semantic event stream.

### Safe handoff behavior

At a safe idle boundary, TUI, Workspace, or ACP may race to acquire activation; the database transaction chooses one
owner. Other surfaces remain synchronized readers and can retry after refresh.

Mid-token, mid-command, mid-tool, and mid-filesystem-effect transfer is not supported. A user can nevertheless complete
the intended journeys:

- create a Plan in TUI, review and answer from a phone while the owner process remains alive, and let that process
  continue;
- approve execution from Workspace and later see the committed implementation outcome in an already-open TUI;
- finish an ideation turn in one surface, continue from another, and return without manually reopening the Session;
- after owner-process loss during a pending wait, reopen the stable Session and ask the Agent to retry.

## Consequences

- `SessionRuntime` remains the reusable runtime seam; Workspace does not become a mandatory parent API for TUI or ACP.
- A central process that owns every Runtime and a transport-backed Runtime proxy are not required for Personal Workspace
  v1.
- All writable Session opening paths must acquire an activation lease before calling Pi `SessionManager.open()` or
  otherwise mutating an existing transcript.
- Ordered Pi Session Transcript Segments are the continuity authority for completed conversation/tool history.
- Existing in-memory interaction promises remain process-local. They are not reconstructed after process loss.
- Workspace can answer a live interaction for another surface only by reaching the active owner process.
- An already-open TUI automatically reflects committed browser or ACP changes while preserving local editor drafts.
- Non-owning clients receive committed semantic state rather than guaranteed live token mirroring. Live cross-process
  event publication may be added later without changing exclusive mutation ownership.
- The owner coordination database is authoritative for Session Activation, committed generations, segment metadata, and
  endpoint request receipts, but not for repository artifacts, transcript content, Plan progress, or interaction waits.
- Database loss cannot delete source, Plans, Work Records, worktrees, or transcripts. It does require rebuilding
  registration/catalog state and treating ambiguous active work as recovery cases.
- Architecture tests should continue enforcing that TUI, Workspace, and ACP adapters do not import one another.

## Rejected Alternatives

### One persistent process owns all live Runtimes

This simplifies simultaneous observation but forces TUI and ACP through a transport proxy, adds process supervision and
wire compatibility to the core local interaction path, and solves a simultaneous-attachment requirement the product does
not have.

### Allow multiple writable Runtime instances and synchronize afterward

Pi Session Managers hold independent in-memory leaves and do not coordinate concurrent writes. Post-hoc synchronization
cannot reliably recover stale prompts, unintended branches, file rewrites, or duplicated side effects.

### Persist a generic workflow state machine

A second general-purpose state machine for arbitrary pending interactions, outcomes, and continuations would duplicate
Pi completed-history storage and overstate what can be safely resumed. RunWield instead persists canonical artifacts,
ordered transcript segments, lifecycle/worktree evidence, and the narrow rollover marker used by execution handoff.

### Add persistent Plan ownership separate from Session Activation

A separate long-lived Plan ownership record would create another authority to reconcile with canonical Plan markdown,
Plan Lifecycle, and worktree registry state. Consequential Plan actions instead revalidate current canonical evidence
under the active Session Activation Lease.

[Mnemoteca]: https://github.com/gandazgul/mnemoteca
