---
status: accepted
---

# ADR-011: Exclusive Session Activation and Durable Workflow Checkpoints

## Context

ADR-009 moved mutable runtime state into `HostedSession`, and ADR-010 established `SessionRuntime` as the shared
contract consumed by sibling TUI and ACP adapters. Those decisions provide isolation among Hosted Sessions in one
process, but do not make one JavaScript Runtime instance shareable across TUI, Workspace, and ACP processes.

Personal Remote Workspace requires a user to move one durable Session among surfaces:

- begin planning or ideation in the TUI;
- review a Plan, answer an interaction, or continue the conversation from Workspace on a phone;
- allow approved execution and validation to continue on the laptop;
- return to an already-open TUI and see the browser or ACP changes without manually reopening the Session.

The installed Pi `SessionManager` does not provide cross-process writer coordination. `SessionManager.open()` reads the
JSONL tree and current leaf into process memory. Each process then appends from its own in-memory leaf, and some
operations may rewrite the file. Two writable managers for the same persisted Session can therefore use stale context,
create unintended branches, or lose updates.

A Plan Workflow Lease alone is insufficient. Ordinary conversation turns also mutate Session JSONL, active-Agent
markers, model and thinking state, workflow context, compaction records, and Session names.

The original Personal Remote Workspace direction assumed that TUI and Workspace would attach simultaneously to one live
authoritative Runtime. Product discovery established that simultaneous cross-process control and shared transient
Runtime memory are not required. The required experience is exclusive mutation plus automatic synchronization and
continuation at durable checkpoints.

## Decision

### Sibling Runtime consumers remain

TUI, Workspace, and ACP remain sibling consumers of the adapter-neutral `SessionRuntime` contract. Each process may own
its own `SessionRuntime` and `SessionHost`; no central Runtime proxy or shared JavaScript object is required.

A persistent Workspace process may host several live Sessions for browser clients. A TUI or ACP process may host other
Sessions. Cross-process correctness comes from durable coordination below the adapters, not from routing TUI or ACP
through Workspace application APIs.

A stable RunWield Session ID is the durable product identity. It maps to the internal Pi Session Manager ID and JSONL
path. The current Hosted Session ID remains an in-process identity and must not be used as the cross-process ownership
key.

### Owner coordination store

An owner-only SQLite database under `~/.wld/` coordinates Personal Workspace state. It is distinct from:

- canonical repository Plans, PRDs, ADRs, Work Records, and source code;
- private Session JSONL transcripts;
- derived Mnemosyne and Cymbal indexes;
- public Shared Space ciphertext and capability storage.

The owner database stores only the coordination records needed for registered Projects, stable Session identity,
activation, workflow checkpoints, paired devices, attention projections, and related owner-local runtime state. Session
content remains private and is not ingested into Workspace Intelligence.

### Session Activation Lease

Before a process creates or mutates a writable Pi `SessionManager` for an existing Session, it must atomically acquire a
**Session Activation Lease** keyed by stable RunWield Session ID.

The lease records at least:

- stable Session ID and Project ID;
- activation owner identity and process kind;
- lease generation or fencing token;
- acquisition, heartbeat, and last committed checkpoint times;
- current activation phase;
- the latest committed Session generation known to the owner.

The fencing token is required on writes to durable coordination state. An older owner that wakes after takeover must be
unable to publish a checkpoint or interaction outcome.

The activation lease is held while:

- an Agent turn is running;
- execution, validation, compaction, cancellation settlement, or another mutable operation is active;
- a live process is waiting for a durable interaction response that will resume its in-memory continuation;
- the owner is committing the resulting checkpoint.

The lease is released when the Session reaches a safe idle checkpoint. A TUI window may remain open after release, but
its cached Runtime is no longer writable. Before its next mutation it must reacquire the lease, compare Session
generation, and rehydrate from canonical state if another process advanced the Session.

Lease timeout alone does not prove that an interrupted effect is safe to repeat. A stale activation enters interrupted
or uncertain state. Settled transcript entries may be reloaded, but arbitrary model requests, commands, tools, or
filesystem effects are never replayed automatically.

### Plan Workflow Lease remains separate

A **Plan Workflow Lease** is keyed by Project and Plan and owned by a stable RunWield Session ID. It prevents a
different Session from reviewing, executing, validating, recovering, or otherwise driving the same Plan workflow
concurrently.

Plan workflow ownership is independent of the process holding the Session Activation Lease. The same Session may move
from TUI to Workspace while retaining Plan workflow ownership. A Plan Workflow Lease may outlive one activation and span
multiple durable checkpoints.

A stale or uncertain Plan Workflow Lease requires explicit Plan Recovery or takeover. It is never removed solely because
a process heartbeat expired.

### Durable workflow checkpoints

Cross-process continuation occurs at a **Durable Workflow Checkpoint**, not by serializing an in-memory JavaScript call
stack.

A checkpoint records the minimum typed continuation state required to determine what happens after an outcome:

- checkpoint ID and kind;
- stable Session and Project IDs;
- Plan ID when the workflow is Plan-centered;
- expected Session generation, Plan status/revision, and Plan Workflow Lease generation;
- interaction or decision being awaited;
- current checkpoint state;
- validated outcome when resolved;
- a typed continuation policy;
- timestamps and the activation fencing token that produced it.

Checkpoint states support atomic, idempotent progression such as:

```text
pending -> resolved -> resuming -> consumed
                \-> canceled
                \-> uncertain
```

Resolution and consumption use compare-and-set semantics. Duplicate browser submissions, reconnect retries, or a stale
process cannot apply an outcome twice.

Continuation policies are typed workflow behavior, not persisted function names or arbitrary executable payloads.
Examples include:

- continue a live waiting Runtime when its owning process is still valid;
- begin a new Agent turn with a durable interaction outcome after safe rehydration;
- apply a known Plan transition after validating the expected Plan and lease generations;
- enter operator-confirmed Plan Recovery when prior side effects are uncertain.

Plan review, review Feedback, **Approve & Run**, **Approve for Later**, Plan Recovery choices, human code review, and
other cross-surface gates must use durable checkpoints. Generic interactions may also use checkpoints, but a crashed
arbitrary Agent/tool continuation is not transparently replayed. Its outcome is preserved and the Session resumes from a
new, explicit turn or recovery path.

### Cross-surface interaction behavior

Workspace may render and resolve a durable interaction for a Session whose Runtime currently lives in a TUI or ACP
process. Resolving the interaction does not load a second writable Runtime.

If the original owner is alive, it consumes the durable outcome and continues. If it is gone, a later owner reacquires
the Session, validates the checkpoint, and follows its typed continuation policy. Browser disconnection does not cancel
the waiting Runtime or delete the checkpoint.

### Automatic read synchronization

Every safe Session checkpoint advances a durable Session generation only after the corresponding transcript and
coordination state are committed.

An open, idle, non-owning TUI monitors the stable Session record. When another Workspace or ACP process advances the
Session generation, the TUI automatically:

1. reads the newly committed transcript state through a read-only path that cannot migrate or rewrite the JSONL file;
2. projects only unseen entries into semantic replay events using stable entry and message IDs;
3. refreshes Plan, workflow, Agent, and attention summaries;
4. preserves unsent editor text and other local drafts;
5. shows which surface currently owns activation when the Session is not writable locally.

Read synchronization does not acquire the Session Activation Lease and does not construct a writable `SessionManager`.
Runtime hydration happens only after lease acquisition.

Synchronization is checkpoint-based. A non-owner is not guaranteed every transient model token or tool-progress delta
from another process. It receives committed messages, interaction state, workflow status, and outcomes automatically.
The owning surface continues to render its full live semantic event stream.

### Safe handoff behavior

At an idle checkpoint, TUI, Workspace, or ACP may race to acquire activation; the database transaction chooses one
owner. Other surfaces remain synchronized readers and can retry after the next checkpoint.

Mid-token, mid-command, mid-tool, and mid-filesystem-effect transfer is not supported. A user can nevertheless complete
the intended journeys:

- create a Plan in TUI, review and answer from a phone, and let the waiting owner continue;
- approve execution from Workspace and later see the committed implementation outcome in an already-open TUI;
- finish an ideation turn in one surface, continue from another, and return without manually reopening the Session.

## Consequences

- `SessionRuntime` remains the reusable runtime seam; Workspace does not become a mandatory parent API for TUI or ACP.
- A central process that owns every Runtime and a transport-backed Runtime proxy are not required for Personal Workspace
  v1.
- All writable Session opening paths must acquire an activation lease before calling Pi `SessionManager.open()` or
  otherwise mutating an existing transcript.
- Session activation and Plan workflow ownership are separate concepts with separate generations and recovery rules.
- Existing in-memory interaction promises and monolithic workflow call stacks must gain durable checkpoint seams at
  cross-surface human gates.
- Workspace can resolve interactions for TUI- or ACP-owned Runtimes without loading the Session itself.
- An already-open TUI automatically reflects committed browser or ACP changes while preserving local editor drafts.
- Non-owning clients receive committed semantic state rather than guaranteed live token mirroring. Live cross-process
  event publication may be added later without changing exclusive mutation ownership.
- The owner coordination database is authoritative for leases and checkpoints but not for repository artifacts or
  transcript content.
- Database loss cannot delete source, Plans, Work Records, worktrees, or transcripts. It does require rebuilding
  registration/catalog state and treating ambiguous active workflows as recovery cases.
- Architecture tests should continue enforcing that TUI, Workspace, and ACP adapters do not import one another.

## Rejected Alternatives

### One persistent process owns all live Runtimes

This simplifies simultaneous observation but forces TUI and ACP through a transport proxy, adds process supervision and
wire compatibility to the core local interaction path, and solves a simultaneous-attachment requirement the product does
not have.

### Allow multiple writable Runtime instances and synchronize afterward

Pi Session Managers hold independent in-memory leaves and do not coordinate concurrent writes. Post-hoc synchronization
cannot reliably recover stale prompts, unintended branches, file rewrites, or duplicated side effects.

### Protect only Plan execution and review

Ordinary Session turns and configuration changes also mutate the append-only transcript and workflow context. A Plan
lease cannot prevent two processes from corrupting or diverging one non-Plan Session.

### Serialize and restore JavaScript continuations

Function stacks, open subprocesses, network requests, and arbitrary tool effects are not portable or safely replayable.
Typed durable checkpoints make continuation explicit and allow uncertainty to route to recovery.
