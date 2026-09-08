---
status: accepted
---

# ADR-015: File-Authoritative Session Bundles

## Context

Personal Workspace serves one owner moving between TUI and browser, including a phone. An open window does not own a
Session permanently. Core must preserve one conversation across those surfaces without requiring Workspace
infrastructure for local TUI or ACP use. Workspace registration, device pairing, and request receipts remain Workspace
concerns.

Pi already supplies durable JSONL transcripts. Its entries form an in-file tree with entry IDs and parent IDs; forked or
cloned transcript files also record their parent Session. RunWield can add stable cross-file segment lineage without
introducing a database authority.

## Decision

### Core Session authority is a file bundle

Every local Session uses a bundle under the Project's encoded `~/.wld/sessions/` directory:

- Pi JSONL files remain the transcript content;
- an atomic `manifest.json` stores stable RunWield Session identity, the ordered segment list, the current segment,
  committed generation evidence, and writer state;
- `session.lock` is the target of the operating-system exclusive file lock; and
- each committed transcript has an adjacent `.runwield.json` recovery descriptor containing the last recoverable
  manifest.

Manifest writes use write-sync-rename-parent-sync replacement. Recovery descriptors are refreshed only after the primary
manifest commits. They are redundant recovery evidence, not a second authority.

### One writer uses an OS lock

Before TUI, ACP, Workspace, or another Runtime surface hydrates or mutates a Session, it acquires the bundle's exclusive
OS file lock. Other surfaces may read committed evidence but cannot construct a writable Pi manager.

The lock belongs to the active managed operation, not to the lifetime of an open TUI window or Workspace server. Core
explicitly releases it when the operation settles. This scope protects an operation's transcript context while allowing
the owner to continue from another screen between operations. An idle resumed Session is a dormant reader; other open
surfaces do not need to close first. The operating system also releases a held lock if its process or file descriptor
closes unexpectedly.

Core has no lease duration, heartbeat deadline, or forced takeover. After a crash, the next inspector can acquire the
lock and compare the current transcript with the last committed or activation-baseline evidence:

- an exact match returns the Session to idle;
- changed or ambiguous evidence requires reconciliation; and
- unfinished external effects are never replayed automatically.

Generation and rollover proofs still fence stale in-process work. The OS lock, not a database row or timeout, prevents
simultaneous writers.

### Every Session is segmented

There is no managed/unmanaged or split/normal product distinction after a Session is persisted.

A brand-new empty TUI start is the exception: it is only an in-memory shell until the first submitted user message. It
uses the explicitly requested starting Agent, or Router when none was requested, and may show that Agent and its model
in the footer. It must not create a Session bundle, catalog entry, transcript, planning segment, generation, or embedded
lineage. If the user exits before the first message, `/resume` must not show that empty shell.

The first submitted message is the persistence boundary. The UI renders that message and enters busy state before any
durable Session work begins. RunWield then creates the stable Session ID, transcript, planning segment, and embedded
lineage, appends the submitted message, and contacts the model. The first generation and its evidence are published when
the turn is checkpointed. This persistence and model work happens behind the already-visible busy state and must not
delay the user's immediate feedback. Execution and semantic repair create successor Pi JSONL segments under the same
stable persisted Session.

Resuming a persisted Session reconstructs its committed conversation, last active Agent, and last active model as
in-memory projections. Projection must not rerun a model turn, tool call, workflow action, or other historical side
effect. Normal resumes remain dormant and do not construct a writable root Agent Session until the user's next message.
On that message, RunWield acquires the Session lock, hydrates the transcript, restores the last persisted Agent and
model, and continues normally. Router and current configuration defaults are fallbacks only when the transcript does not
contain an available choice.

Opening an older single Pi transcript silently creates its bundle and planning segment. If manifests are missing,
RunWield groups lineage-bearing transcripts by stable Session ID and orders them through parent segment and parent Pi
Session IDs. Older planning roots that predate embedded lineage can be recovered from their successor's parent IDs.
Malformed or branching lineage fails closed instead of guessing.

An older database-only stable ID may be replaced during file migration when the transcript contains no copy of that ID.
This is an internal identity migration: the visible conversation and transcript are preserved without prompting the
user.

### Read synchronization and live interactions

Read-only projection verifies saved transcript evidence across the ordered segments. It does not acquire a writer lock
or construct a writable Pi manager. Event pagination is a display concern: a successful verified projection with another
page is not corrupt history. Writable hydration uses the current segment; the browser need not render every historical
event before Core can accept a new request.

Open readers use committed generations to discover saved changes without replaying model calls or tool effects. During
an operation, Core exposes a private local socket identified by the existing Session and operation IDs. Workspace reads
Core's live events, pending question, and steering queue through that socket. Answers, steering messages, and Stop reach
the same running agent. The socket closes with the operation; it stores no conversation or recovery state. Both surfaces
run as the same OS user on the same machine or inside the same container. File projection supplies saved history; the
socket supplies live activity.

Pi persists completed tool calls and interaction answers. A pending interaction remains an in-memory wait in its live
process. An answer must reach that process to continue the wait; it does not require a separate durable interaction
state machine. Browser disconnection does not cancel the wait. If the process is lost, the user can ask the Agent to
retry from saved history. Runtime stacks and unfinished external effects are not reconstructed automatically.

### Plan actions and notification delivery

Plan Lifecycle, Plan content, and worktree evidence own their respective workflow facts. A consequential action checks
current evidence at action time. A Session's past association with a Plan does not grant permanent ownership or prove
that an operation is still running. HTTP receipts deduplicate request delivery; they do not own workflow progress.

Core emits semantic notification events and adapters deliver them. Notifications do not require durable attention
records, acknowledgements, or resolution state.

### Workspace database is Workspace-only

Workspace SQLite stores explicitly registered Projects, paired devices, bounded endpoint receipts, and rebuildable
Workspace projections. It does not own Session identity, segment order, generations, or writer coordination. Endpoint
receipts carry stable Session IDs as values and do not foreign-key them to the retired SQLite Session catalog.

Deleting or rebuilding the Workspace database removes Workspace registration, pairing, receipts, and projections. It
does not prevent TUI or ACP from listing, opening, or continuing local Sessions. Registering the Project again lets
Workspace rediscover file-backed Sessions.

### Hosted evolution uses the same contract

`SessionRuntime` consumes a Session-store contract rather than a Workspace database. Local Core implements that contract
with file bundles and OS locks. A hosted RunWield service may later implement it with transactional object storage and a
cloud lock service while preserving stable identity, ordered segments, committed generations, and single-writer
semantics. Workspace remains a consumer and projection layer rather than the source of Session truth.

## Consequences

- TUI and ACP operate with files only and never open the Workspace database.
- A user does not run a migration script, enable an activation protocol, or choose a Session type.
- Workspace database loss is recoverable independently from Session transcripts.
- Transcript deletion still loses the deleted transcript content; manifests do not duplicate conversation history.
- The SQLite Session catalog, activation, generation, and segment tables remain readable only for compatibility and
  migration history. Production Session operations do not write them.
- This ADR defines current Session storage, writer coordination, and continuity. Prior designs are available in Git
  history, not as additional current architectural rules.

## Rejected Alternatives

### Require SQLite in every Core process

This makes the harness heavier, couples local correctness to Workspace lifecycle, and turns a derived product database
into a prerequisite for intact transcripts.

### Use only Pi parent Session headers

Pi parent pointers identify a fork relationship but do not contain RunWield's stable Session ID, segment kind, complete
ordered manifest, committed generation evidence, or writer state. Embedded RunWield lineage complements Pi rather than
replacing it.

### Use a renewable file lease

A timeout cannot prove that the old process stopped or that external side effects are safe to repeat. The OS already
releases a real lock on process loss, so an application-level expiry adds unsafe takeover behavior without benefit.
