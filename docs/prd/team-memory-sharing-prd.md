# Product Requirements Document: Team Memories

Last updated: 2026-07-23 08:28 EDT

## Objective

Allow RunWield teams to share useful Mnemosyne project Memories through normal Git collaboration without committing
Mnemosyne's SQLite database, embeddings, or other derived index state.

RunWield should classify likely team-useful Memories without interrupting the user, materialize them as reviewable text
at safe checkpoints, and reconcile accepted Team Memories into each contributor's local Mnemosyne database. Sharing
should feel automatic while preserving repository review, privacy boundaries, and protection against untrusted memory
injection.

## Problem Statement

Mnemosyne currently gives RunWield durable project and global Memory across Agent Sessions, but its working database is
local to one user. Consequently, a useful project fact learned by one contributor is unavailable to teammates unless it
is repeated elsewhere or communicated manually.

Committing the SQLite database would distribute those Memories, but it would also introduce an opaque binary artifact
that Git cannot meaningfully diff or merge. Routine Memory writes would dirty the repository; parallel contributors
would conflict over the whole database; embeddings and search indexes would bloat history; model or schema changes could
rewrite derived data; and an active WAL-mode database could be captured inconsistently. A committed database would also
make it difficult to review sensitive content or detect a malicious Core Memory before it influenced Agents.

Requiring users to approve or promote every Memory individually would avoid some disclosure risk but create enough
friction that sharing would likely be skipped. RunWield needs an agent-classified, Git-reviewed lifecycle that shares
Mnemosyne Memories without conflating them with CONTEXT, ADRs, PRDs, Plans, Work Records, or other durable artifact
types.

## Resolved Assumptions

### Memory Audience and Importance Are Independent

Project Memories have two independent dimensions:

| Audience | Importance | Meaning                                                                    |
| -------- | ---------- | -------------------------------------------------------------------------- |
| Local    | Ordinary   | Searchable only in the owner's local Mnemosyne context                     |
| Local    | Core       | Local to the owner and injected into every Agent Session                   |
| Team     | Ordinary   | Shared with repository collaborators and retrieved when relevant           |
| Team     | Core       | Shared with repository collaborators and injected into every Agent Session |

- **Local Memory** and **Team Memory** describe audience.
- **Core Memory** describes always-on injection, not sharing.
- Core never implies Team, and Team never implies Core.
- Agents must continue using Core sparingly.
- Global Memories remain local cross-project preferences and do not participate in repository sharing.

### Agent-Classified Sharing

- Agents classify each new project Memory without asking the user whether to share it.
- A stable, repository-safe Memory likely to help another contributor becomes a **Team Memory Candidate**.
- Personal preferences, machine-specific details, transient progress, unresolved speculation, sensitive information, and
  uncertain cases remain Local.
- When classification is uncertain, Local is the safe default.
- Classification guidance applies to every Agent allowed to create project Memories.
- A user may still explicitly request that a Memory remain Local or become a Team Memory Candidate.

### Team Memories Remain a Distinct Mnemosyne Concept

- Team Memories are the shareable form of the concise facts, decisions, and preferences already represented as Mnemosyne
  Memories.
- Promotion does not convert a Memory into CONTEXT, an ADR, PRD, Plan, Work Record, Session Transcript, or another
  artifact type.
- Existing artifact synchronization and indexing retain their current roles.
- RunWield must not use Team Memory promotion as a reason to duplicate or rewrite unrelated durable artifacts.

### Canonical Text, Derived Database

- Mnemosyne's SQLite database, embeddings, FTS structures, vector indexes, WAL files, and local document IDs are never
  committed.
- A Team Memory has one canonical, deterministic, human-readable repository representation.
- Once promoted, canonical text owns the Team Memory; local Mnemosyne records are derived searchable copies.
- Canonical Team Memory text must support meaningful Git diffs, ordinary code review, parallel additions, stable
  identity, updates, supersession, and deletion without relying on local database IDs.
- Generated or machine-specific values that create diff churn, including embeddings and export timestamps, do not belong
  in canonical text.
- The exact serialization and repository path are reversible implementation choices, provided they satisfy these
  requirements.

### Promotion Uses Git Review Instead of Per-Memory Approval

- A Team Memory Candidate begins as Local Mnemosyne state and remains usable by its author.
- At safe Session or workflow checkpoints, and during Sleep maintenance, RunWield materializes pending candidates as
  canonical-text changes in the working tree.
- Materialization does not automatically stage, commit, push, or merge changes.
- The normal Git diff and pull-request process is the human approval surface.
- RunWield should present candidate changes as one concise batch rather than interrupting for each Memory.
- Reviewers may edit, accept, or remove proposed Team Memories like other repository text.
- A candidate removed or rejected during review must not be proposed repeatedly unless it is materially revised or the
  user explicitly reopens it for sharing; it otherwise returns to Local status.

### Trusted Activation

- Presence in a checked-out branch does not make a Team Memory trusted or active.
- Each project has a configured **Trusted Branch**, normally its reviewed default integration branch.
- Only the accepted committed Team Memory state reachable through the Trusted Branch may be reconciled automatically
  into collaborators' active Mnemosyne indexes.
- Team Memory additions or modifications in an untrusted feature branch or pull request remain visible for review but
  cannot alter active shared retrieval or Core Memory injection merely because the branch was checked out.
- A locally authored candidate may remain active for its author as Local state while awaiting review.
- Trusting Team Memories follows repository authority: anyone able to merge into the Trusted Branch can approve shared
  Agent context.

### Reconciliation Is Convergent

- RunWield reconciles the accepted Trusted Branch snapshot into the local Mnemosyne database before using Team Memories
  as active shared context.
- Repeated reconciliation must be idempotent and must not append duplicate Memories.
- Added canonical Memories create derived local records.
- Updated canonical Memories update their corresponding derived records.
- Removed or superseded canonical Memories cease to participate in active local retrieval and Core injection.
- Reconciliation must distinguish derived Team Memories from independent Local Memories, even when their text is
  similar.
- A contributor must be able to rebuild all derived Team Memory state from canonical text without a database backup.
- Reconciliation failure must leave the last known trusted state usable or fail closed; it must not partially activate
  an untrusted or inconsistent snapshot.

## Product Experience

### Creating a Memory

When an Agent stores a project Memory, it evaluates both dimensions independently:

1. Is the Memory important enough to be Core?
2. Is it stable, safe, and useful enough to become a Team Memory Candidate?

The Agent stores the Memory without prompting unless the content itself requires clarification. The normal interaction
should not become a sequence of sharing questions.

### Reviewing Candidates

At the next safe checkpoint, RunWield reports that Team Memory candidates were materialized and points to the resulting
working-tree diff. The user can continue working, edit the text, include it in a normal commit, or discard it. RunWield
does not claim that a candidate is shared merely because text was generated locally.

### Receiving Team Memories

After reviewed Team Memory changes enter the Trusted Branch, each collaborator's RunWield environment reconciles them
into local Mnemosyne state. Ordinary Team Memories become semantically searchable; Team Core Memories become eligible
for normal Core injection. Contributors do not import exports or copy database files manually.

### Branch Review

Checking out an external or unmerged branch may display proposed Team Memory changes, but those changes do not persist
into active shared Memory. Returning to another branch must not leave behind untrusted derived records.

## Technical Approach

### Agent Memory Contract

RunWield's project-Memory creation capability must carry an audience classification independently from Core importance.
Agent instructions must define the Team classification criteria consistently and preserve Local as the fallback for
uncertain content. Mnemosyne may retain the classification as local metadata, but local representation does not define
the canonical Team Memory format.

### Candidate Materialization

RunWield owns promotion from local candidates to repository text. Materialization must:

- operate only at safe checkpoints rather than modifying the repository on every Memory tool call;
- produce deterministic, reviewable text without embeddings;
- retain stable identity across edits and local database rebuilds;
- batch changes without hiding the individual Memories being proposed;
- avoid repeatedly emitting rejected or unchanged candidates;
- never commit on the user's behalf.

### Trusted Snapshot Reconciler

RunWield owns synchronization between canonical Team Memory text and local Mnemosyne derived state. The reconciler must
read the accepted Trusted Branch snapshot rather than trusting arbitrary working-tree content. It requires stable
external identity and create/update/remove behavior; Mnemosyne's current backup-oriented, append-only import behavior is
insufficient as the synchronization contract by itself.

### Safety Controls

- Team classification must exclude likely credentials, tokens, personal data, local paths with sensitive information,
  and content the Agent cannot confidently classify as repository-safe.
- Repository review remains required even when agent classification is confident.
- Untrusted Team Core Memories must never enter automatic prompt injection.
- Team Memory text has the same audience as the repository; per-Memory access control is not implied.
- Sync and promotion reporting must identify what changed without exposing Local Memory content unnecessarily.

## Success Criteria

- Two contributors using the same Trusted Branch can retrieve the same accepted Team Memory without sharing a database.
- Creating a Team Memory Candidate does not prompt for individual approval.
- Candidate promotion produces a meaningful text diff and never a binary database diff.
- Parallel contributors can add unrelated Team Memories without resolving a whole-database conflict.
- Repeated reconciliation creates no duplicate derived Memories.
- Editing or deleting a canonical Team Memory converges local derived indexes to the accepted state.
- A Local Core Memory remains private and a Team ordinary Memory remains non-Core.
- Checking out an untrusted branch cannot persistently change shared retrieval or Core injection.
- A fresh local Mnemosyne database can rebuild Team Memory state entirely from trusted repository text.
- RunWield never automatically commits, pushes, or merges Team Memory changes.

## Risks and Mitigations

### Agent Misclassification

An Agent may mark sensitive content as Team or keep useful knowledge Local. Conservative instructions, repository-safe
content checks, batched diffs, and normal review reduce disclosure risk. Sleep may reassess existing Local Memories, but
uncertainty must continue to resolve to Local.

### Review Fatigue

Too many low-value candidates could cause reviewers to ignore Team Memory diffs. Agents should store crystallized
Memories rather than transcripts or temporary state, and checkpoint materialization should consolidate exact duplicates
without combining distinct decisions or losing rationale.

### Persistent Prompt Injection

A malicious pull request could propose misleading Team Core Memories. Trusted Branch activation ensures that merely
checking out or reviewing the branch does not activate them; repository merge authority remains the approval boundary.

### Local and Team Divergence

A Local Memory may overlap with a later Team Memory, or a canonical Team Memory may be revised while an older local copy
exists. Stable canonical identity and provenance-aware reconciliation must update derived copies without deleting
independent Local knowledge solely because its text is similar.

## Out of Scope

- Committing or merging Mnemosyne SQLite databases, embeddings, FTS data, vector indexes, WAL files, or local IDs.
- Real-time peer-to-peer or hosted Memory synchronization.
- Sharing Global Memories, personal preferences, Session Transcripts, or arbitrary Agent conversation history.
- Replacing or redefining CONTEXT, ADRs, PRDs, Plans, Work Records, or their existing synchronization behavior.
- Automatically converting other durable artifacts into Team Memories.
- Automatically staging, committing, pushing, merging, or approving Team Memory changes.
- Activating Team Memories from untrusted branches merely to provide branch-specific context.
- Per-Memory team ACLs, encryption for subsets of repository collaborators, or sharing with users who cannot access the
  repository.
- Selecting the final canonical text path, file granularity, or serialization syntax in this PRD.
