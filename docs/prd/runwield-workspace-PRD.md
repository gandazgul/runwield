---
title: RunWield Workspace
status: living-roadmap
createdAt: "2026-07-06T00:00:00.000Z"
updatedAt: "2026-07-22T09:30:00-04:00"
---

# RunWield Workspace PRD

**Status:** Living roadmap — current local Plan Workspace implemented; Personal Remote Workspace v1 next\
**Last Updated:** 2026-07-22

## 1. Objective

Evolve RunWield Workspace from a browser Plan Board for one checkout into the primary browser environment for working
the RunWield way across multiple registered Projects.

The next product milestone is **Personal Remote Workspace v1**: one trusted developer uses a persistent Workspace on
their own machine through a private network. The developer can move among Projects, create and resume durable Sessions,
observe synchronized Session state, resolve durable human gates, review and execute Plans, receive attention signals,
search durable project knowledge and selected source code, and open a subordinate Code Surface.

This milestone must preserve RunWield Core's existing ownership of:

- SessionRuntime semantics;
- Plan Lifecycle and Workflow Validation;
- RunWield-owned Plan worktrees;
- Plan Recovery;
- canonical repository artifacts;
- local developer agency.

The same Project Runtime model should later support isolated SaaS containers without turning the personal deployment
into a throwaway prototype.

## 2. Problem Statement

The current Workspace is useful but scoped to one checkout and centered on a Plan Board. RunWield Sessions primarily
live in terminal processes, while browser review, Shared Plan collaboration, TUI operation, ACP clients, and future chat
channels are separate surfaces.

That creates five product gaps:

1. **No persistent multi-Project home.** The user cannot register trusted Projects and see attention, active work,
   Sessions, Plans, and recent outcomes across them.
2. **No exclusive cross-surface Session activation.** Reopening the same transcript in another process is not equivalent
   to continuing one durable Session and risks competing transcript writers unless writable activation is coordinated.
3. **No complete browser workflow.** Workspace cannot yet carry one Session through ideation, Plan review, execution,
   validation, and recovery using semantic Runtime events.
4. **Knowledge is fragmented.** Plans and Work Records can inform future work, but Workspace lacks a deliberate
   Project-level and cross-Project retrieval experience. Source-code search is likewise confined to the active Project.
5. **Remote access is not a product boundary.** The current random launch token and loopback-oriented server are not
   sufficient for a persistent remotely reachable owner Workspace.

The answer is not a generic Agent manager, issue tracker, transcript memory system, or browser IDE. Workspace should
remain a Plan- and workflow-first RunWield product.

## 3. Product Thesis and Principles

RunWield Workspace is **AI-native collaborative software planning and workflow continuity**.

Its core loop is:

```text
ideate or inquire
    -> materialize durable artifacts when useful
    -> review and approve a Plan
    -> execute and validate locally
    -> distill the outcome into a Work Record
    -> use durable records to plan better
```

Product principles:

- **Workspace is the primary browser shell.** Plans, Sessions, workflows, review, knowledge, and attention define the
  product; code-server is subordinate.
- **Projects are explicit trust boundaries.** Workspace accesses only registered roots and never treats an incidental
  local cache as authorization.
- **Sessions are durable, not simultaneously writable.** TUI, Workspace, and ACP remain sibling Runtime consumers;
  exactly one process may hold writable Session activation while other surfaces synchronize committed state.
- **Plans own planned-work lifecycle.** Once a Plan exists, its workflow surface becomes the durable center for review,
  execution, validation, recovery, changes, and associated Sessions.
- **Approval is not execution authorization.** The user can approve and run now or approve for later.
- **Artifacts outrank transcripts.** Plans, PRDs, ADRs, and Work Records form durable Project and Workspace
  intelligence. Raw Session Transcripts do not.
- **Local-first does not mean browser-bound.** Work continues safely when the browser disconnects and stops only at
  completion, cancellation, failure, or the next required human decision.
- **Preserve local agency.** Personal mode does not force every QUICK_FIX, manual edit, or supported in-place workflow
  into a Plan worktree.
- **Explicit scope beats ambient reach.** Cross-Project source search and future Agent access must never silently
  broaden from one Project to every registered Project.
- **Use the RunWield Design System.** Workspace, Plannotator, and related browser surfaces should remain visually and
  behaviorally coherent.

## 4. Current Baseline

RunWield currently provides:

- a local browser Workspace for one checkout;
- Plan and Epic boards, detail views, body editing, and lifecycle-safe actions;
- Plannotator-based Plan and code review;
- encrypted Shared Plan Spaces with capability-based review;
- stable Plan identity and canonical markdown storage;
- Work Records and Work Record retrieval;
- a multi-session in-process Session Host and adapter-neutral SessionRuntime;
- TUI and ACP as sibling Runtime adapters;
- an ACP stdio MVP that can create, load, prompt, cancel, close, and replay Sessions;
- Cymbal as the current-Project, working-tree-aware code-intelligence layer.

The current Session Host is an in-process Runtime boundary, not a cross-process authority. Personal Remote Workspace v1
adds coordination below the sibling adapters through stable Session identity, fenced activation leases, committed
generations, and Durable Workflow Checkpoints. The current Workspace token model is also not the remote
owner-authentication model described here.

Existing local Plan management and Shared Plan collaboration remain supported foundations. Personal Remote Workspace v1
expands their containing product model rather than replacing their lifecycle or canonical storage.

## 5. Resolved Product Model

### 5.1 Workspace

**Workspace** is the browser environment containing registered Projects, durable Sessions, Plans, PRDs, ADRs, Work
Records, review surfaces, search, attention, and Code Surfaces.

The default home is the cross-Project **Attention Dashboard**, not a Project grid or a global Plan board.

### 5.2 Project and Project Runtime

A **Project** is a trusted repository or project directory registered with Workspace. Registration authorizes Workspace
to operate within that root; it does not make every path on the machine accessible.

Each Project has a **Project Runtime** responsible for its Sessions, Plan workflows, artifact discovery, code search,
health, and optional Code Surface. Several Projects may have live Sessions concurrently. Inactive Project Runtimes may
be dormant and restart without losing durable Session or workflow identity.

The first version operates on local roots on the owner's machine. A later SaaS mode mounts or clones each Project into
an isolated container while retaining the same conceptual contract.

### 5.3 Session and Agent Session

A **Session** is the durable user-facing conversation and workflow thread within one Project. It spans Router Triage and
specialist Agent handoffs and has a stable identity and human-readable Session Name.

An **Agent Session** is an internal specialist invocation within a Session. It is not the main navigation object.

A Session may begin without a Plan for ideation, inquiry, operation, or QUICK_FIX work. When a Plan materializes, the
Session becomes associated with it and the Plan workflow becomes the primary route. Starting from an existing artifact
creates a fresh associated Session; **Resume** re-enters the same Session.

Workspace does not introduce a generic Work Item above Sessions, Plans, and artifacts.

### 5.4 Durable artifacts

- **Plan:** owns planned implementation lifecycle and may become the center of one or more associated Sessions.
- **PRD:** independent product-intent artifact that may inform multiple Sessions or Plans and does not participate in
  Plan Lifecycle.
- **ADR:** authoritative architecture-decision artifact.
- **Work Record:** retrospective account of completed planned work and its durable future planning lessons.
- **Session Transcript:** owner-private raw history used for human resume and search, not shared knowledge.

Repository artifacts remain canonical. Workspace may index and project them, but must not silently replace them with
browser-database-only copies.

## 6. Personal Remote Workspace v1

### 6.1 Target user and environment

The first version serves:

- one trusted developer;
- on the developer's own machine;
- through Tailscale, WireGuard, or an equivalent private network;
- from owner-approved paired browser devices;
- across several registered local Projects;
- with no team accounts or shared-machine concurrency.

This is a durable personal self-hosted mode, not merely a development demonstration.

### 6.2 Attention Dashboard

The default Workspace home aggregates only actionable or recent information across Projects:

- **Needs You:** pending interviews, approvals, recovery choices, failed work, and other required judgment;
- **Running:** Sessions and Plan workflows currently progressing;
- **Ready:** Plans that are Ready For Work but not executing;
- **Recently Finished:** recent verified, closed, failed, or otherwise completed outcomes.

Project navigation remains available, but users should not have to inspect every Project to discover blocked or finished
work.

Browser and system notifications should point back to the stable Session or Plan workflow checkpoint that needs
attention. Notifications are attention signals, not an alternate workflow state store.

### 6.3 Project experience

For each registered Project, Workspace shows:

- registration and RunWield initialization health;
- active, held, failed, implemented, verified, and closed Plans;
- standalone and Plan-associated Sessions;
- PRDs, ADRs, Work Records, and related research;
- artifact and Project knowledge search;
- current code-index health;
- access to the main-checkout Code Surface;
- relevant workflow, Git, validation, and recovery health.

Registration, disabling, and removal affect Workspace access and indexing only. They must not delete repository data,
Plans, Work Records, Session history, branches, or RunWield worktrees.

### 6.4 Session experience

Workspace must support creating, resuming, observing, and mutating Sessions through semantic `SessionRuntime` events
only after the owning process has the required Session Activation Lease. Non-owning surfaces synchronize committed
Session generations through read-only projection. The primary timeline represents:

- user and Agent messages;
- Agent identity and handoffs;
- tool progress and structured output;
- pending human interactions;
- Plan review links and outcomes;
- execution and validation progress;
- cancellation, failure, and recovery;
- usage and Session status where useful.

Terminal-byte streaming is not the primary Session UI. A raw WebTUI may remain an optional future advanced/debug
surface.

Several Sessions may run across several Projects. Closing a browser tab or losing network access does not cancel work.
On reconnection, Workspace reloads the stable Session record, receives committed semantic state, and either remains a
synchronized reader or acquires writable activation at a safe boundary before continuing.

### 6.5 Activation, checkpoints, and synchronization

Cross-surface Session behavior uses three separate mechanisms:

- **Session Activation Lease:** before Workspace, TUI, ACP, or another process opens or mutates a writable Pi
  `SessionManager` for an existing Session, it must acquire a fenced lease keyed by the stable RunWield Session ID. Only
  the current activation owner may publish fenced coordination state for the Session.
- **Durable Workflow Checkpoints:** Plan review, Feedback, **Approve & Run**, **Approve for Later**, Plan Recovery,
  human code review, and cross-surface structured interactions are resolved through typed checkpoint records with
  compare-and-set outcome and consumption semantics. Workspace may render and resolve a checkpoint for a TUI- or
  ACP-owned Runtime without loading a second writable Runtime.
- **Automatic read synchronization:** idle non-owning surfaces monitor committed Session generations, read transcript
  updates through a non-mutating path, replay only unseen stable entries, refresh summaries, preserve unsent drafts and
  local annotations, and show which surface currently owns activation.

At an idle checkpoint, Workspace, TUI, and ACP may race to acquire activation; the database transaction chooses one
owner and all other surfaces remain synchronized readers. Mid-token, mid-command, mid-tool, and mid-filesystem-effect
transfer is out of scope. Ambiguous activation, stale fencing, or uncertain side effects require visible recovery rather
than implicit last-writer-wins behavior.

### 6.6 Plan workflow ownership

Exactly one Session may drive consequential actions for a Plan at a time across TUI, Workspace, ACP, and future hosts. A
durable **Plan Workflow Lease** enforces that rule.

The lease belongs to the workflow-owning Session, not to the current process or UI. The same Session may move from TUI
to Workspace while retaining Plan workflow ownership, but a different Session is rejected until the workflow is
released, held, completed, or explicitly recovered/taken over.

A stale or uncertain lease cannot be silently deleted. Workspace must present an explicit takeover or Plan Recovery
choice grounded in durable Plan, worktree, and Session state.

### 6.7 Plan workflow surface

Once a Plan exists, one Plan-centered surface unifies:

- Plan content and related PRDs, ADRs, research, and Work Records;
- associated Session activity;
- Plannotator review and Feedback;
- readiness and execution authorization;
- execution progress and affected files;
- validation, semantic review, Guided Review, and repair activity;
- Plan worktree state and changes;
- failure details and Plan Recovery;
- terminal outcome and resulting Work Record.

Review offers distinct outcomes:

- **Approve & Run:** approve the Plan and authorize the current Session to proceed through readiness, execution, and
  Workflow Validation.
- **Approve for Later:** approve and prepare the Plan as Ready For Work without authorizing immediate execution.

Plan approval never implies ambient permission for a different Session to execute it.

### 6.8 Durable knowledge search

Workspace provides two human-facing durable-artifact scopes:

1. **Project Knowledge Search:** Plans, PRDs, ADRs, Work Records, and eligible research within one Project.
2. **Workspace Intelligence Search:** eligible durable artifacts across registered Projects.

Registered Projects contribute durable artifacts to Workspace Intelligence by default, with a per-Project opt-out for
sensitive repositories. Results always identify their Project and artifact type.

Session Transcripts remain:

- searchable by their owner for human navigation;
- unavailable to cross-Session Agent retrieval;
- excluded from Workspace Intelligence;
- unavailable to collaborators;
- non-authoritative when they disagree with durable artifacts.

Source code is also excluded from Workspace Intelligence. Artifact retrieval and source-code search are distinct modes
with different scope and trust semantics.

### 6.9 Human cross-Project code search

Personal Remote Workspace v1 includes RunWield-owned Cymbal federation:

- the user explicitly selects one or more registered Projects;
- Workspace queries each selected Project's Cymbal index with bounded concurrency;
- results are grouped or clearly labeled by Project;
- first-use indexing, refresh, partial results, failures, and freshness are visible;
- absolute local paths are not exposed to the browser as ambient filesystem authority;
- duplicate symbols across Projects are not silently collapsed;
- relationship, reference, trace, and impact results remain Project-scoped unless a real cross-Project dependency is
  known.

Global code search targets registered Projects' main checkouts. RunWield Plan worktrees are excluded to prevent
conflicting versions, duplicate results, and exposure of intermediate work. Plan-worktree code remains available through
its Plan workflow and review surfaces.

Cross-Project code search is human-only in the first version. Existing Agent code tools remain scoped to the Session's
Project. Users may deliberately bring selected findings into a Session, but Workspace must not silently grant an Agent
access to other Projects.

Sourcebot is not a first-version dependency. It remains an optional future provider for organization-scale or remote
committed-code search.

### 6.10 Code Surface

Workspace may launch or connect to code-server as the subordinate **Code Surface** for a Project's main checkout.

The Code Surface:

- supports manual inspection and editing without replacing Workspace navigation;
- does not own Sessions, Plan Lifecycle, validation, recovery, or RunWield worktrees;
- opens global code-search results at the corresponding main-checkout location when valid;
- never pretends Plan-worktree-only content is present in the main checkout;
- preserves code-server's separate security boundary and limits its filesystem reach to the intended Project.

Manual changes and commits remain the developer's responsibility. They may make active Plans stale or create merge
conflicts, which RunWield handles through normal lifecycle and integration checks.

Personal mode preserves existing local agency: QUICK_FIX and supported in-place workflows may modify the main checkout
without being forced into Plan worktrees.

### 6.11 Pairing and remote trust

Private networking is necessary but not sufficient authorization. The first version requires owner-approved browser
device pairing:

- bootstrap approval is short-lived and intentional;
- paired-device sessions persist but are revocable;
- Workspace provides a paired-device and revocation view;
- WebSocket and ordinary browser requests share the same authorization boundary;
- CSRF and Origin policy protect state-changing owner Workspace requests;
- browser access requires a secure TLS boundary at non-loopback addresses, using a documented trusted terminator if
  RunWield does not manage certificates itself;
- direct plaintext non-loopback exposure is not a safe default;
- Project roots are allowlisted independently of browser authorization;
- consequential execution, terminal, filesystem, and destructive actions remain explicit and auditable;
- secrets and bearer credentials do not enter Plan front matter, Session Transcripts, URLs beyond bootstrap necessity,
  or repository artifacts.

The first version does not require usernames, passwords, team accounts, account recovery, public-internet exposure, or
organization roles.

Shared Plan capability authorization remains separate from Workspace device authorization. A paired Workspace device
does not automatically receive a Shared Plan capability, and possessing a Shared Plan link does not authorize the owner
Workspace.

## 7. Technical Approach

This section describes product-level boundaries, not final implementation design.

### 7.1 Sibling Runtimes with owner coordination

TUI, Workspace, and ACP remain sibling consumers of the adapter-neutral `SessionRuntime` contract. Each process may own
its own in-process `SessionHost`; Workspace is not a mandatory Runtime proxy or parent API for TUI or ACP. Cross-process
correctness comes from shared owner coordination below the adapters.

A stable RunWield Session ID is the durable product identity. It maps to one registered Project and the underlying Pi
Session Manager identity/JSONL locator. In-process Hosted Session IDs remain runtime implementation details and must not
be used as cross-process ownership keys.

The owner-only SQLite database under `~/.wld/` coordinates Project registration, paired browser devices, stable Session
identity, activation leases, committed Session generations, Durable Workflow Checkpoints, Plan Workflow Leases,
attention projections, and related owner-local runtime state. It is distinct from canonical repository artifacts,
private Session Transcripts, derived Mnemosyne/Cymbal indexes, and public Shared Space ciphertext/capability storage.

Writable Runtime hydration must acquire a Session Activation Lease before constructing or mutating a writable Pi
`SessionManager`. Every safe checkpoint advances the committed Session generation only after the transcript or
repository effect is durable; fenced SQLite checkpoint/generation publication follows canonical writes. If
reconciliation finds transcript-ahead/database-behind or uncertain Plan/worktree evidence, Workspace must route to
explicit recovery rather than claiming that an arbitrary effect can be replayed.

Workspace should use a native `SessionRuntime` adapter appropriate for browser clients. ACP remains the canonical
host-agnostic external protocol for editors and replaceable external hosts, but first-party Workspace browser traffic
does not need to route through ACP merely for symmetry.

### 7.2 Project Runtime lifecycle

The Workspace service coordinates registered Project Runtimes. A Project Runtime may activate when it has live Sessions,
pending workflow work, indexing activity, or an open Code Surface and may otherwise become dormant. Dormancy must not
change Session identity, Plan Workflow Leases, or recoverable workflow state.

Resource limits must prevent one Project's indexing, validation, or Agent activity from starving unrelated Projects.

### 7.3 Canonical storage

Repository markdown remains canonical for Plans, PRDs, ADRs, Work Records, and project-specific context. Workspace-owned
state may store registration, device authorization, Session indexing, attention projections, and runtime coordination,
but it must not become a competing source of truth for repository artifacts.

Session Transcripts remain private Session data. Shared and Agent-retrievable knowledge is derived from explicit durable
artifacts, not transcript ingestion.

### 7.4 Search boundaries

Durable artifact search uses the Project registry to enforce eligible Project scope and contribution policy. Cymbal
federation likewise uses the Project registry rather than Cymbal's global cache listing as authorization.

The first version federates per-Project Cymbal queries rather than physically merging SQLite databases. This preserves
Project boundaries and working-copy freshness while remaining operationally light for a personal Workspace.

### 7.5 Browser and Code Surface

The existing Astro/React Workspace and RunWield Design System remain the browser foundation. Plannotator remains the
review foundation. code-server is integrated as a bounded subordinate service rather than used as the Workspace shell.

Dense desktop workflow layouts should collapse to focused views or drawers on smaller screens. Remote continuation and
human-gate handling must remain usable from a phone, although full code editing need not be optimized for mobile.

## 8. First-Version Acceptance Criteria

Personal Remote Workspace v1 is complete only when one trusted developer can:

1. Reach Workspace over a private network, pair a browser deliberately, list paired devices, and revoke one.
2. Register at least two local Projects and verify Workspace cannot browse or search unregistered roots.
3. See Needs You, Running, Ready, and Recently Finished work across those Projects on the Attention Dashboard.
4. Create a standalone Session in Workspace, resume it later, and retain one durable identity across Agent handoffs.
5. Run live Sessions in at least two Projects concurrently without Session, tool, interaction, or workflow state bleed.
6. Disconnect the browser during active work, let the activation owner continue to completion or its next durable human
   gate, reconnect, and resume from committed Session state.
7. Keep TUI and Workspace open on the same stable Session, allow exactly one writable activation owner at a time, and
   synchronize non-owning surfaces from committed generations without creating simultaneous writers.
8. Associate a Session with a Plan and ensure a second Session cannot drive consequential actions while the first holds
   the Plan Workflow Lease.
9. Complete a bounded FEATURE journey through planning, Plannotator review, **Approve & Run**, execution, Workflow
   Validation, and Work Record visibility from Workspace.
10. Use **Approve for Later** to leave an approved Plan Ready For Work without starting execution.
11. Recover an interrupted or uncertain Plan through an explicit operator-confirmed recovery path rather than blind
    replay or silent lease deletion.
12. Search eligible Plans, PRDs, ADRs, and Work Records within one Project and across contributing registered Projects.
13. Search source code across explicitly selected Projects through Cymbal federation, receive Project-labeled partial
    results when one index fails, and avoid Plan-worktree duplicates.
14. Confirm that another Session's Transcript is absent from Agent retrieval and Workspace Intelligence while remaining
    searchable by the owner for navigation.
15. Open a Project's main checkout in code-server without granting it ownership of RunWield Plan worktrees.
16. Receive an actionable attention signal for a required human interaction and return to the correct Session or Plan
    workflow.

## 9. Success Measures

The first version succeeds when:

- the owner can complete the acceptance journey remotely without depending on an active TUI process;
- browser reconnect and open TUI/ACP clients never create competing transcript writers or duplicate workflow owners;
- multiple Projects can make progress concurrently while human attention remains understandable;
- consequential Plan actions are rejected or recovered safely when Session or lease ownership is ambiguous;
- artifact and code search return only eligible, explicitly scoped Project data;
- repository artifacts remain usable through existing CLI and TUI workflows without migration to Workspace-only data;
- users can distinguish durable knowledge, private transcript history, main-checkout code, and Plan-worktree changes;
- Workspace feels like a Plan/workflow product rather than an Agent fleet dashboard or browser IDE wrapper.

## 10. Risks and Mitigations

| Risk                                                                     | Product mitigation                                                                                                                                                                                                    |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistent remote access expands the local attack surface.               | Require private networking, device pairing, revocation, trusted Project roots, shared authorization across HTTP/WebSocket paths, and explicit consequential actions.                                                  |
| TUI, Workspace, or ACP can create split-brain Session or Plan execution. | Require fenced Session Activation Leases before writable Runtime access, synchronize idle readers from committed generations, use idempotent Durable Workflow Checkpoints, and enforce separate Plan Workflow Leases. |
| Background continuation surprises the user.                              | Show Running and Needs You state prominently, notify at human gates, expose cancellation, and preserve explicit execution authorization.                                                                              |
| Multi-Project concurrency exhausts a developer laptop.                   | Allow dormant Project Runtimes, bound indexing and Session concurrency, surface health, and degrade to partial results rather than blocking Workspace globally.                                                       |
| Cross-Project search leaks sensitive code or paths.                      | Query only explicitly selected registered Projects, sanitize absolute paths, keep Agent tools Project-scoped, and support artifact-intelligence opt-out.                                                              |
| Global search conflates incompatible symbol versions.                    | Keep Project identity visible, group results by Project, exclude Plan worktrees, and avoid invented cross-Project call graphs.                                                                                        |
| code-server becomes an unbounded filesystem or terminal backdoor.        | Treat it as a separately bounded Code Surface tied to the intended Project and never as authorization for other roots or Plan worktrees.                                                                              |
| Session history becomes accidental shared memory.                        | Keep Transcripts owner-private and out of Agent retrieval; require durable artifact creation for reusable knowledge.                                                                                                  |
| Workspace drifts into generic Agent management.                          | Organize around attention, Projects, Sessions, and Plan workflows; do not add generic Tasks or Work Items.                                                                                                            |
| Personal architecture cannot evolve to SaaS.                             | Keep Project Runtime, Session identity, authorization, and storage boundaries compatible with later per-Project isolated containers and organization policy.                                                          |

## 11. Out of Scope for Personal Remote Workspace v1

- Public-internet exposure without a private network.
- Team accounts, roles, organization membership, or shared-machine concurrency.
- Collaborator access to Session Transcripts.
- Cross-Session Agent retrieval from Session Transcripts.
- Agent access to cross-Project Cymbal search.
- A generic Work Item, Task, ticket, Scrum, or issue-tracker layer.
- Replacing markdown Plans, PRDs, ADRs, or Work Records with database-only documents.
- Rebuilding VS Code, language servers, terminals, debugging, or extension management inside Workspace.
- Opening or editing RunWield-owned Plan worktrees through code-server.
- Requiring Git, GitHub, pull requests, or Plan worktrees for every supported workflow.
- Bundling Sourcebot or depending on its services, authentication, or license.
- Making a raw WebTUI the primary Session experience.
- Blind workflow replay after a crash.
- Transparent automatic Plan Workflow Lease takeover.
- Hosted SaaS execution, billing, organization policy, or multi-tenant infrastructure.
- Replacing Shared Plan capability links with Workspace device identity.

## 12. Sequencing

### Current foundation

Retain and build on:

- current local Plan Workspace;
- Plannotator review;
- Shared Plan collaboration;
- Work Records;
- SessionRuntime and the in-process multi-session host;
- TUI/ACP sibling adapters;
- Cymbal current-Project code intelligence.

### Next: Personal Remote Workspace v1

Deliver the complete first-version boundary in this PRD, including registered Projects, persistent Sessions, remote
device pairing, Attention Dashboard, Session Activation Leases, Durable Workflow Checkpoints, automatic synchronization,
Plan Workflow Leases, unified Plan workflow, notifications, artifact intelligence, human cross-Project Cymbal search,
and the code-server Code Surface.

Cross-Project search is part of the first version, not a later add-on: a multi-Project Workspace should support
deliberate search across both durable planning artifacts and source code while preserving their different semantics.

### Following: OpenAB/Telegram compatibility

After Personal Remote Workspace establishes stable Session identity, activation, checkpoint, synchronization, and
workflow-ownership coordination, complete the OpenAB/Telegram Stage 1 proof against the same shared coordination model.
Telegram remains a secondary notification and continuation channel rather than a parallel Session owner or primary
product shell.

ACP remains the replaceable external-client contract, and full ACP v1 compliance remains valuable independently of
Telegram.

### Later: collaborative SaaS Workspace

Extend the same concepts with:

- isolated Project Runtime containers;
- team and organization membership;
- Project-level authorization and policy;
- collaborator-visible durable artifacts and review;
- organization-scale Workspace Intelligence;
- optional external cross-repository search providers;
- hosted execution only after planning, workflow, isolation, and recovery semantics are proven.

## 13. References

- [RunWield Core PRD](./runwield-core-prd.md)
- [Session Host and ACP PRD](./runwield-acp-session-host-PRD.md)
- [Workspace Agent Sessions and Web IDE handoff](../handoffs/2026-07-20-workspace-agent-sessions-and-web-ide.md)
- [Cymbal multi-Project federation research](../research/cymbal-multiproject-search-federation.md)
- [Sourcebot integration research](../research/sourcebot-workspace-integration.md)
- [Local-First Plan Management UI PRD](./local-first-plan-management-ui-PRD.md)
- [Collaborative Planning PRD](./collaborative-planning-PRD.md)
- [ADR-007: Local-First Workspace Plan Board](../adr/007-local-first-workspace-plan-board.md)
- [ADR-008: Remote-Canonical Collaborative Shared Spaces](../adr/008-remote-canonical-collaborative-shared-spaces.md)
- [ADR-010: SessionRuntime sibling adapters and ACP](../adr/010-session-runtime-sibling-adapters-and-acp.md)
- [ADR-011: Exclusive Session Activation and Durable Workflow Checkpoints](../adr/011-exclusive-session-activation-and-durable-workflow-checkpoints.md)
- [RunWield Design System](../design-system.md)
