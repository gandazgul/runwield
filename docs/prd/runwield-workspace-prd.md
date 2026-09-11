---
title: RunWield Workspace
status: living-roadmap
createdAt: "2026-07-06T00:00:00.000Z"
updatedAt: "2026-09-11"
---

# RunWield Workspace PRD

**Document role: Living central PRD.** Principles and lasting requirements for the browser workspace, personal
continuity, and later team collaboration.

Keep this document as current product guidance. Fold lasting requirements from completed feature PRDs here;
implementation steps belong in Plans, architectural choices in ADRs, and delivery evidence in Work Records.

**Status:** Living roadmap — current local Plan Workspace implemented; Personal Remote Workspace v1 next\
**Last Updated:** 2026-09-11

<a id="1-objective"></a>

## Objective

Evolve RunWield Workspace from a browser Plan Board for one checkout into the primary browser environment for working
the RunWield way across multiple registered Projects.

The personal product serves one developer using their own machine through a private network. The same person can start
work in the TUI, walk away with their phone, continue in Workspace, and return to the TUI with the conversation updated.
They can move among Projects, review and execute Plans, receive notifications, and search project knowledge.
Simultaneous multi-user collaboration is later scope. Reliable Session start and continuation are required for this
product to be useful; completion of earlier implementation slices does not establish that readiness.

The browser experience preserves existing Plan approval, validation, recovery, and local developer control. A later team
product should build on the personal experience; future collaboration must not burden ordinary use today.

<a id="2-problem-statement"></a>

## Problem Statement

The current Workspace is useful but scoped to one checkout and centered on a Plan Board. RunWield Sessions primarily
live in terminal processes, while browser review, Shared Plan collaboration, TUI operation, ACP clients, and future chat
channels are separate surfaces.

That creates five product gaps:

1. **No persistent multi-Project home.** The user cannot register trusted Projects and see attention, active work,
   Sessions, Plans, and recent outcomes across them.
2. **Moving between screens is unreliable.** The owner needs to continue their own conversation on a phone without
   closing an idle TUI, losing context, or navigating repair controls for an ordinary resume.
3. **No complete browser workflow.** Workspace cannot yet carry one Session through ideation, Plan review, execution,
   validation, and recovery with clear progress and next actions.
4. **Knowledge is fragmented.** Plans and Work Records can inform future work, but Workspace lacks a deliberate
   Project-level and cross-Project retrieval experience. Source-code search is likewise confined to the active Project.
5. **Remote access is not a product boundary.** The current random launch token and loopback-oriented server are not
   sufficient for a persistent remotely reachable owner Workspace.

The answer is not a generic Agent manager, issue tracker, transcript memory system, or browser IDE. Workspace should
remain a Plan- and workflow-first RunWield product.

<a id="3-product-thesis-and-principles"></a>

## Product Thesis and Principles

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
- **One owner, one conversation across screens.** Leaving a TUI or browser open does not reserve a Session. The owner
  can continue it from another screen and see the resulting conversation when they return.
- **Familiar behavior across screens.** Session commands, Agent defaults, and manual override behavior match the TUI.
  Browser conveniences such as dropdowns and an image picker make the same actions easier to reach; they do not
  introduce different Session semantics. Changing Agents resets model and thinking choices to the selected Agent's
  settings.
- **Plans own planned-work lifecycle.** Once a Plan exists, its workflow surface becomes the durable center for review,
  execution, validation, recovery, changes, and associated Sessions.
- **Approval is not execution authorization.** The user can approve and run now or approve for later.
- **Artifacts outrank transcripts.** Plans, PRDs, ADRs, and Work Records form durable Project and Workspace
  intelligence. Raw Session Transcripts do not.
- **RunWield replaces the forge workflow layer by default.** Intent, review, and memory are RunWield capabilities. A
  forge may remain the remote git host, merge substrate, and identity provider, but pull-request review is a
  per-repository opt-in, not the default human review loop.
- **Local-first does not mean browser-bound.** Work continues safely when the browser disconnects and stops only at
  completion, cancellation, failure, or the next required human decision.
- **Continuity should be ordinary.** Opening, refreshing, or changing screens preserves the conversation and unsent
  drafts. Both TUI and Workspace update automatically as new work is saved from the other screen. A long history or
  completed Plan does not make the conversation read-only.
- **Explicit scope beats ambient reach.** Cross-Project source search and future Agent access must never silently
  broaden from one Project to every registered Project.
- **Use the RunWield Design System.** Workspace, Plannotator, and related browser surfaces should remain visually and
  behaviorally coherent.

<a id="4-current-baseline"></a>

## Current Baseline

RunWield currently provides:

- a local browser Workspace for one checkout;
- Plan and Epic boards, detail views, body editing, and lifecycle-safe actions;
- Plannotator-based Plan and code review;
- encrypted Shared Plan Spaces with capability-based review;
- stable Plan identity and canonical markdown storage;
- Work Records and Work Record retrieval;
- a multi-session in-process Session Host and adapter-neutral SessionRuntime;
- TUI and ACP as sibling Runtime adapters;
- an ACP stdio implementation that can create, load, prompt, cancel, close, and replay Sessions;
- Cymbal as the current-Project, working-tree-aware code-intelligence layer.

Workspace already provides browser Session and Plan surfaces. The remaining readiness work is to make the complete owner
journey dependable, especially starting and continuing Sessions across TUI and phone. The architectural decisions are
recorded in ADR-015. Continuation fixes are tracked in
[Restore Ordinary Workspace Session Continuation](../plans/workspace-session-continuation-readiness.md); existing
implementation restrictions are not product requirements.

Existing local Plan management and Shared Plan collaboration remain supported foundations. Personal Remote Workspace v1
expands their containing product model rather than replacing their lifecycle or canonical storage.

## Product Model

<a id="51-workspace"></a>

<a id="1-workspace"></a>

### Workspace

**Workspace** is the browser environment containing registered Projects, durable Sessions, Plans, PRDs, ADRs, Work
Records, review surfaces, search, and notifications

The default home is the cross-Project **Attention Dashboard**, not a Project grid or a global Plan board.

<a id="52-project-and-project-runtime"></a>

<a id="2-project-and-project-runtime"></a>

### Project and Project Runtime

A **Project** is a trusted repository or project directory registered with Workspace. Registration authorizes Workspace
to operate within that root; it does not make every path on the machine accessible.

Each Project contains its own Sessions, Plans, knowledge, and health information. Several Projects can make progress at
once; returning to an inactive Project preserves its saved work. The first version uses local roots on the owner's
machine. Hosted Projects are later scope.

<a id="53-session-and-agent-session"></a>

<a id="3-session-and-agent-session"></a>

### Session and Agent Session

A **Session** is the durable user-facing conversation and workflow thread within one Project. It spans Router Triage and
specialist Agent handoffs and has a stable identity and human-readable Session Name.

An **Agent Session** is an internal specialist invocation within a Session. It is not the main navigation object.

Agent and workflow handoffs stay within one continuous conversation. Users can review the full history even when a new
phase receives only the context relevant to its task. Internal Agent invocations are not separate navigation objects.

A Session may begin without a Plan for ideation, inquiry, operation, or QUICK_FIX work. When a Plan materializes, the
Session becomes associated with it and the Plan workflow becomes the primary route. Starting from an existing artifact
creates a fresh associated Session; **Resume** re-enters the same Session.

Workspace does not introduce a generic Work Item above Sessions, Plans, and artifacts.

<a id="54-durable-artifacts"></a>

<a id="4-durable-artifacts"></a>

### Durable artifacts

- **Plan:** owns planned implementation lifecycle and may become the center of one or more associated Sessions.
- **PRD:** product-intent artifact with capability-organized requirements and acceptance scenarios. It may inform
  multiple Sessions or Plans and does not participate in Plan Lifecycle.
- **ADR:** authoritative architecture-decision artifact.
- **Work Record:** retrospective account of completed planned work and its durable future planning lessons.
- **Session Transcript:** owner-private raw history used for human resume and search, not shared knowledge.

Repository artifacts remain canonical. Workspace may index and project them, but must not silently replace them with
browser-database-only copies.

## Delivery Audience

The first version serves:

- one trusted developer;
- on the developer's own machine;
- through Tailscale, WireGuard, or an equivalent private network;
- from owner-approved paired browser devices;
- across several registered local Projects;
- with no team accounts or shared-machine concurrency.

This is a durable personal self-hosted mode, not merely a development demonstration.

## Capability Requirements

The capabilities below own browser-specific requirements. They reference Core for shared lifecycle, validation, and
Session behavior. Scope labels distinguish the existing foundation, the required Personal v1 journey, and later team
work; they do not claim rollout completion.

- [Local Plan management](#local-plan-management)
- [Shared Plan collaboration](#shared-plan-collaboration)
- [Attention dashboard](#attention-dashboard)
- [Project access and navigation](#project-access-and-navigation)
- [Browser Sessions](#browser-sessions)
- [TUI and phone continuity](#tui-and-phone-continuity)
- [Browser Plan review and workflow](#browser-plan-review-and-workflow)
- [Durable knowledge search](#durable-knowledge-search)
- [Human cross-Project code search](#human-cross-project-code-search)
- [Main-checkout Code Surface](#main-checkout-code-surface)
- [Device pairing and remote trust](#device-pairing-and-remote-trust)
- [Team planning and governance](#team-planning-and-governance)
- [Team artifact privacy and authorship](#team-artifact-privacy-and-authorship)
- [Team planning intelligence](#team-planning-intelligence)
- [Team code review and delivery](#team-code-review-and-delivery)

### Local Plan management

**Scope and maturity:** Current local browser baseline.

**Requirement: Edit and navigate Plans without changing their lifecycle accidentally.**

`wld plans ui` remains a useful local browser board for the current checkout. It shows Plans by stage, separates active,
held, and finished work, and presents Epics as top-level cards with child progress. Opening a Plan is read-first;
editing has a clear action and saves explicitly. Refresh can recover an unsaved draft. Markdown structure and ordinary
CLI use remain intact, and body editing does not accidentally change workflow fields.

Manual board moves record the user's choices without claiming automated review or verification. Users can reflect
externally started or completed work, close without verification, or hold work. Failure and hold offer the appropriate
recovery or resume actions. Plan, Epic, and useful filtered-view links remain stable after renaming. Local links need a
running Workspace; sharing access remains explicit.

These local outcomes are the foundation, not a restriction to one Project in the personal multi-Project product. Later
document surfaces should feel consistent while keeping Plan lifecycle controls specific to Plans.

**Acceptance scenarios:**

- Given a Plan opened from the board, when the user edits its body and saves, Markdown remains usable from the CLI and
  lifecycle fields do not change accidentally.
- When the user moves or manually closes work, the board reflects that choice without claiming automatic verification;
  failure and hold expose recovery or resume.
- When a Plan or Epic is renamed, its existing links still resolve and child progress remains visible.

### Shared Plan collaboration

**Scope and maturity:** Current self-hosted baseline; hosted deployment and additional browser actions remain deferred.

**Requirement: Share review revisions with explicit access.**

Workspace supports encrypted collaborative Plan sharing through self-hosted remote Workspace Shared Spaces.

Current collaboration capabilities:

- self-hosted encrypted Shared Spaces;
- `wld plans share`, `pull`, `push`, and `unshare` for the review and publishing cycle;
- distinct reviewer and maintainer links without exposing secrets in Plan documents;
- browser comments, resolution/reopening, and Revision switching;
- one agreed shared review version, with clear publishing and unsharing actions.

The [Collaborative Planning PRD](collaborative-planning-PRD.md) defines these journeys. Storage and protocol details are
in [collaboration documentation](../collaboration.md).

Deferred collaboration surface:

- hosted RunWield Workspace / Cloudflare D1 deployment
- browser-side push, close, unshare/delete, or Plan body editing
- automated notifications
- Forge Change Request Delivery through GitHub or GitLab as an explicitly selected delivery and review mode (see
  [forge-change-request-delivery-prd.md](./forge-change-request-delivery-prd.md)); RunWield-native review and Direct
  Delivery remain the default

Shared review consumes [Core Plan review](runwield-core-prd.md#plan-review) and
[Plan lifecycle](runwield-core-prd.md#plan-lifecycle).

**Acceptance scenarios:**

- Given a deliberately shared Plan, when a reviewer follows their link, they can comment and switch Revisions within
  that access without receiving maintainer secrets.
- When the maintainer publishes a new review version or unshares, participants see the corresponding shared-review
  outcome; ordinary repository documents do not acquire sharing secrets.

<a id="62-attention-dashboard"></a>

### Attention dashboard

**Scope and maturity:** Personal Remote Workspace v1 target; existing UI is not proof of the complete journey.

**Requirement: Surface the owner’s next consequential action.**

The default Workspace home is an attention-first queue across registered Projects. Its primary question is:

> What do I need to work on next?

The dashboard should not list every active Session with equal weight or reward multitasking. It ranks attention by
workflow consequence while preserving exploration paths for users who want the broader state.

Default ordering:

1. **Pinned:** user-pinned Sessions, Projects, Plans, or workflow items. Pinning makes work easier to find.
2. **Needs You:** actual human decisions or external prerequisites, such as approval, feedback, human review, or a Pair
   checkpoint. Internal repair, failed validation, and retry exhaustion alone do not create user chores.
3. **Ready to Continue:** approved Plans ready for work, paused workflows, child Plans ready in a PROJECT sequence, or
   other safe next actions.
4. **Recently Finished:** successfully published or deliberately abandoned delivery workflows, and completed
   non-delivery requests. Failed attempts and verification attestations alone do not finish an undelivered workflow.
5. **Running Quietly:** Sessions and Plan workflows currently progressing without a required human decision.

The first screen should emphasize the top actionable queue and keep Running Quietly secondary. Project navigation,
filters, all-active views, Session transcripts, Plan details, validation evidence, Work Records, and Project health
remain explorable, but users should not have to inspect every Project to discover blocked or finished work.

The Dashboard shows current work across Projects and links to the Session or Plan where the owner can act. It does not
create an additional approval step or change which work the owner can continue.

**Acceptance scenarios:**

- Given two registered Projects with blocked, ready, finished, and running work, when the owner opens Workspace, the
  queue surfaces what needs attention without opening each Project.
- When the owner pins work, it becomes easier to find but does not gain approval or execution permission.
- When work reaches a required human decision, the attention signal leads to the correct Session or Plan; quietly
  running work stays secondary.

<a id="63-project-experience"></a>

### Project access and navigation

**Scope and maturity:** Personal Remote Workspace v1 target.

**Requirement: Limit Workspace reach to registered Projects.**

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

**Acceptance scenarios:**

- Given two registered roots and one unregistered directory, when the owner browses Projects, only the registered roots
  are available to Workspace.
- When a Project is disabled or removed, Workspace access and indexing stop without deleting repository data, saved
  Sessions, branches, or worktrees.

<a id="64-session-experience"></a>

### Browser Sessions

**Scope and maturity:** Existing browser baseline with the complete Personal v1 journey required.

**Requirement: Preserve conversation, drafts, and controls in the browser.**

The owner can create, reopen, follow, and continue Sessions in Workspace. The experience preserves the same conversation
and selected Agent and model across TUI and browser. The primary timeline represents:

- user and Agent messages;
- Agent identity and handoffs;
- tool progress and structured output;
- live human interactions while the owner process is active;
- Plan review links and outcomes;
- execution and validation progress;
- cancellation, failure, and recovery;
- usage and Session status where useful.

Terminal-byte streaming is not the primary Session UI.

Session lists use the saved title, then the first user message. Commands are valid first messages. A Session with
neither is omitted from lists. The owner can attach, paste, view, and send images from the browser, including while the
same Session is open in the TUI; unsent text and images survive a refresh and remain available after a failed send.

Every workflow tool appears as a prominent, fully expanded block. Its report, decisions, review notes, checklist, and
outcome remain readable in live and saved history. Completed workflow calls must not remain marked as running.

Several Sessions may run across several Projects. Closing a browser tab or losing network access does not cancel work.
On reconnection, Workspace shows the latest saved conversation and current work. The user can continue when the Session
is ready for input without a separate takeover or preparation step.

Shared behavior: [Core TUI conversation](runwield-core-prd.md#tui-conversation),
[models and providers](runwield-core-prd.md#models-and-providers), and
[Session continuity](runwield-core-prd.md#session-continuity). Browser command controls follow the same Agent defaults
and override rules; switching Agents resets model and thinking choices to that Agent’s settings.

**Acceptance scenarios:**

- When the owner starts a Session with a command, it can use that first message as its list title; an empty Session with
  no title or message does not appear.
- Given a typed message and image attachments, when sending fails or the browser refreshes, the draft and previews
  remain available.
- When a workflow tool finishes, its full report and outcome remain readable in live and saved history and its block
  stops showing Running.
- When the owner changes Agents through browser controls, the selected Agent, model defaults, and thinking behavior
  match the TUI.

<a id="65-moving-between-tui-and-phone"></a>

### TUI and phone continuity

**Scope and maturity:** Personal v1 required journey; continuation fixes do not narrow this commitment.

**Requirement: Change screens without losing input or duplicating work.**

- As the owner, I can start a conversation in the TUI, leave it open, and send the next message from my phone when the
  Agent is ready for input, so I can keep working away from my desk.
- When I return to the TUI, it shows the messages and results produced from my phone without reopening the Session. The
  same applies when I move from Workspace back to the TUI.
- I can read the conversation while work is running. Changing screens or refreshing does not cancel that work, repeat a
  submitted request, or discard my draft.
- I can answer an Agent question from my phone and have the same work continue. If the process handling that question
  has stopped, the UI explains that the question needs to be retried and keeps the saved conversation available.
- I can continue a long conversation without loading every older message first. Completed work remains available for
  discussion and follow-up.
- If work is still running, I see what is happening and what I can do next. Merely having another screen open is not a
  reason to block me or ask me to recover the Session.
- I can steer the running Agent from either screen and see that message and its response in the same conversation.
- If an actual failure interrupts the Session, I keep my input and receive a concrete next action. Routine screen
  changes do not require recovery steps or technical knowledge.

The shared authority is [Core Session continuity](runwield-core-prd.md#session-continuity); these are its browser/phone
journeys.

**Acceptance scenarios:**

- Given an idle TUI left open, when the owner continues from a paired phone, the same conversation advances and
  automatically appears in the TUI on return.
- Given a long history or completed Plan, when the owner sends a follow-up from either screen, it proceeds without
  loading every old message or a takeover ceremony.
- When the browser disconnects during work, work continues; reconnecting shows saved progress and retains the draft
  without duplicate submission.
- When a process handling a live question has stopped, the owner sees that it needs retry rather than a dead control or
  an invented answer.

<a id="66-plan-actions"></a>
<a id="67-plan-workflow-surface"></a>

### Browser Plan review and workflow

**Scope and maturity:** Current review baseline with the complete Personal v1 journey required.

**Requirement: Review the current Plan and preserve explicit execution choices.**

The owner can review, give feedback, approve for later, or approve and run the current Plan from Workspace. Opening a
Plan or its associated Session does not give that screen permanent control of the work.

If a Plan changes after the owner opens it, Workspace shows the changed content before accepting an approval for the new
version. Repeated delivery of the same click does not run the action twice. Actual failures explain what happened and
how to continue without silently discarding work.

Once a Plan exists, one Plan-centered surface unifies:

- Plan content and related PRDs, ADRs, research, and Work Records;
- associated Session activity;
- Plannotator review and Feedback;
- readiness and execution authorization;
- execution progress and affected files;
- validation, semantic review, Guided Review, and repair activity;
- Plan worktree state and changes;
- failure details and Plan Recovery;
- confirmed publication or deliberate abandonment, with the applicable Work Record.

Review offers distinct outcomes:

- **Approve & Run:** approve the Plan and authorize the current Session to proceed through readiness, execution, and
  Workflow Validation.
- **Approve for Later:** approve and prepare the Plan as Ready For Work without authorizing immediate execution.

Plan approval never implies ambient permission for a different Session to execute it.

Shared rules: [Core Plan review](runwield-core-prd.md#plan-review), [lifecycle](runwield-core-prd.md#plan-lifecycle),
and [execution, validation, and recovery](runwield-core-prd.md#execution-validation-and-recovery).

Internal locks, settings, storage, and synchronization are repaired automatically. Workspace keeps delivery active
through failures and pauses; cancelling a turn does not abandon the workflow. When a real user decision or external
prerequisite is needed, explain the outcome at stake and offer continuation or deliberate abandonment without exposing
internal repair procedures.

**Acceptance scenarios:**

- Given a Plan changed since the review opened, when the owner tries to approve, the changed content is shown before the
  approval is accepted.
- When the same approval click is delivered twice, the action occurs once; Approve for Later never starts execution.
- Given an executing Plan, when the owner opens its workflow surface, its review, changes, validation, recovery, and
  resulting record are accessible in context.
- Given a failed attempt caused by internal state, the workflow stays active while RunWield repairs it; it does not
  become Recently Finished or require the owner to fix storage or locks.

<a id="68-durable-knowledge-search"></a>

### Durable knowledge search

**Scope and maturity:** Personal Remote Workspace v1 target; existing record retrieval is the foundation.

**Requirement: Retrieve eligible artifacts with scope and confidence visible.**

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

Work Record results show the summary, Project, source links, and completion confidence. Users can tell automated
verification from user attestation, skipped verification, and a done-enough Epic. Default search favors current approved
records. Explicit history views expose drafts, superseded, pending, and archived records with clear notices. Plan
surfaces link the relevant outcome record or explain that generation needs retry. Retrieval must not treat a completed
PRD, old Plan, or Work Record as proof that a current end-to-end journey works.

[Core Work records](runwield-core-prd.md#work-records) owns record generation, eligibility, correction, and completion
confidence. [Core capability-organized requirements](runwield-core-prd.md#capability-organized-product-requirements)
owns PRD authoring behavior.

**Acceptance scenarios:**

- Given a sensitive Project opted out of Workspace Intelligence, when the owner searches across Projects, its artifacts
  are absent and returned results identify their Project and type.
- When an Agent retrieves planning knowledge, owner-private transcripts and source-code search results are not silently
  included.
- When the user opens historical Work Records, their completion and approval distinctions remain visible; a past record
  does not prove a current journey works.

<a id="69-human-cross-project-code-search"></a>

### Human cross-Project code search

**Scope and maturity:** Personal Remote Workspace v1 target; cross-Project Agent search remains excluded.

**Requirement: Search only deliberately selected Projects.**

Personal Remote Workspace v1 includes RunWield-owned Cymbal federation:

- the user explicitly selects one or more registered Projects;
- searching selected Projects remains responsive while other work continues;
- results are grouped or clearly labeled by Project;
- first-use indexing, refresh, partial results, failures, and freshness are visible;
- a result links only to content the owner authorized Workspace to access;
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

**Acceptance scenarios:**

- Given selected registered Projects with duplicate symbol names, when the owner searches, results keep Project identity
  and exclude Plan-worktree duplicates.
- When one selected index fails, available results and the failure/freshness notice remain visible while unrelated work
  continues.
- When the user brings a chosen result into a Session, the Agent does not gain ambient access to the other Projects.

<a id="610-code-surface"></a>

### Main-checkout Code Surface

**Scope and maturity:** Personal Remote Workspace v1 target; code-server remains subordinate and separately secured.

**Requirement: Inspect and edit the authorized checkout without owning workflows.**

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

**Acceptance scenarios:**

- When the user opens a global code result, the Code Surface navigates to its authorized main-checkout location rather
  than pretending a worktree-only version exists there.
- When the user edits through the Code Surface, normal stale-Plan and merge checks still apply; the editor does not take
  ownership of Plan lifecycle or other roots.

<a id="611-pairing-and-remote-trust"></a>

### Device pairing and remote trust

**Scope and maturity:** Personal Remote Workspace v1 target.

**Requirement: Authorize devices explicitly and allow revocation.**

Private networking is necessary but not sufficient authorization. The first version requires owner-approved browser
device pairing:

- bootstrap approval is short-lived and intentional;
- paired-device sessions persist but are revocable;
- Workspace provides a paired-device and revocation view;
- all browser activity respects the same device access permissions;
- another website cannot act on the owner’s Workspace without authorization;
- browser access requires a secure TLS boundary at non-loopback addresses, using a documented trusted terminator if
  RunWield does not manage certificates itself;
- direct plaintext non-loopback exposure is not a safe default;
- pairing a device grants access only to registered Projects;
- consequential execution, terminal, filesystem, and destructive actions remain explicit and auditable;
- secrets and bearer credentials do not enter Plan front matter, Session Transcripts, URLs beyond bootstrap necessity,
  or repository artifacts.

The first version does not require usernames, passwords, team accounts, account recovery, public-internet exposure, or
organization roles.

Shared Plan capability authorization remains separate from Workspace device authorization. A paired Workspace device
does not automatically receive a Shared Plan capability, and possessing a Shared Plan link does not authorize the owner
Workspace.

**Acceptance scenarios:**

- Given a new browser device, when it requests access, the owner must deliberately pair it; revoked devices cannot
  continue using Workspace.
- Given a Shared Plan link without owner-device authorization, when someone follows it, they receive only the
  shared-review access and cannot operate owner Workspace.
- When Workspace is reached beyond loopback, access uses the documented secure boundary and exposes only registered
  Projects; another website cannot act as the owner.

### Team planning and governance

**Scope and maturity:** Later collaborative SaaS scope; not Personal v1.

**Requirement: Support team-chosen roles and approval policy.**

Personal Workspace keeps its [Attention dashboard](#attention-dashboard). Team planned work uses the following
Plan-centered experience.

Primary areas:

- Ideas
- Planning
- Review
- Ready
- In Progress
- Verifying
- Done
- On Hold

These are product-facing states for PMs, tech leads, and developers. Raw Core lifecycle statuses can remain visible in
detail views for transparency and debugging.

Natural actions from the Plan screen:

- start a new idea
- create or refine a PRD
- create a Plan
- create an Epic
- review a Plan
- inspect Work Records and planning memory

Searching Work Records is important, but secondary to the Plan workspace.

**Roles and permissions.**

The team product adds independently hosted Projects, team and organization membership, Project-level authorization and
policy, and collaborator-visible durable artifacts.

The later team Workspace should start with minimal roles:

- **Admin**
- **Member**
- **Reviewer/Guest**

Do not encode PM, tech lead, or developer job-title roles by default. Teams should decide how strictly they divide
planning, architecture, and execution responsibilities.

Later, Workspace may allow more granular Member permissions, but this should not be required at launch.

**Approval policy.**

Workspace should use lightweight defaults with optional strictness.

Default behavior:

- Members can create and collaborate with minimal ceremony.
- Important Plans go through review.
- Work Records auto-approve after Recorder generation.
- Epics require explicit approval before decomposition/work.

Optional stricter settings:

- restrict who can approve Plans
- require Work Record review before retrieval
- require ADR links for architectural Plans
- require explicit approval before a Plan can enter Ready

**Acceptance scenarios:**

- Given a team using default policy, when members shape a Plan, they can collaborate without job-title roles while
  important Plans and Epics receive their required review.
- When a team enables stricter approval or Work Record review, those choices govern the relevant transition or retrieval
  without redefining Core verification.
- When a user opens team planning, they can move from an idea or PRD into a Plan or Epic and later discover the
  resulting Work Record.

### Team artifact privacy and authorship

**Scope and maturity:** Later collaborative SaaS scope; owner-private conversation remains a product-wide principle.

**Requirement: Share durable artifacts without sharing private working transcripts.**

Workspace should persist durable artifacts, not raw planning conversation minutia.

Requirements:

- Plans, PRDs, ADRs, and Work Records are team-visible artifacts according to workspace permissions.
- User/agent working conversations are private-first by default.
- Individual chat messages should not be attached to Plans by default.
- Code-review discussion, assignment, and approval state are collaboration process data. Workspace hosts them outside
  the repository, as it does working conversations; only durable results — Plans, Work Records, and commits — enter the
  repo.
- Artifact metadata can store user and Agent authorship.
- Details screens can show quiet metadata such as author, drafting Agent, approval mode, and source references.
- Admin/debug session access may exist where policy allows.
- Product analytics should be anonymized and aggregated for RunWield improvement unless users explicitly opt into
  broader sharing.

**Acceptance scenarios:**

- Given a collaborator permitted to read a Plan, when they inspect its context, eligible artifacts and authorship are
  visible but the author’s private working transcript is not.
- When review discussion is saved, process data stays in Workspace; repository artifacts contain durable results, not
  raw conversation or passive analytics content.

### Team planning intelligence

**Scope and maturity:** Later collaborative SaaS scope; distinct from Personal v1 human search.

**Requirement: Retrieve trusted planning knowledge across permitted Projects.**

The paid Workspace moat is shared cross-project planning intelligence.

```text
A trusted planning system where every material change has a reviewable intent, governed execution, independently verified outcome, and reusable record of what the team learned.
```

Workspace should extend Core's repo-local records with:

- team-wide Work Record search
- cross-project retrieval for new Plans
- context packs for Ideator, Planner, and Architect
- compression/deduplication of older records over time
- answers to "what did we decide before?" across projects
- filtering by project, area, Plan type, completion mode, and status

This is a key reason to pay for Workspace. It should strengthen planning without reframing RunWield as hosted agent
management. Organization-scale intelligence and optional external cross-repository search providers extend this later
scope.

**Acceptance scenarios:**

- Given permitted current records across team Projects, when a Planner retrieves context, results retain provenance,
  completion confidence, and applicable Project scope.
- When older records are compressed or deduplicated, source Plans remain intact and the current guidance stays
  distinguishable from historical material.

### Team code review and delivery

**Scope and maturity:** Later collaborative SaaS scope; owner-only review remains Personal v1.

**Requirement: Preserve review responsibility and require shared checks before merge.**

Teams adopting Workspace receive assignable human review with Agent assistance and a clear path from validated work to
shared CI and merge. Required outcomes:

- Human review defaults to Workspace. Discussion, assignment, and approval state stay outside the repository; only
  durable results such as Plans, Work Records, and commits enter it.
- Teams can explicitly select forge-hosted or Dual Review per repository, team, or instance. The gates do not
  synchronize decisions or silently satisfy one another.
- Workspace merges validated, approved work only after shared CI succeeds. Local checks remain a fast tier and never
  replace shared CI. Publication uses a labeled Forge Change Request as the CI-and-merge envelope, preserving the actual
  author, reviewer, and merger identities.
- Approval counts, required checks, and self-merge policy have familiar forge-style meanings. GitHub sign-in and correct
  person attribution are high-priority roadmap requirements; identity, audit, and review responsibility stay explicit.
- Externally contributed work can become source material for a maintainer-owned Plan while preserving contributor and
  maintainer provenance.

**Shared requirements:** [Core execution and validation](runwield-core-prd.md#execution-validation-and-recovery) and
[team planning and governance](#team-planning-and-governance). Independent hosted Projects, membership, and Project
policy belong to team governance; broader search belongs to [team planning intelligence](#team-planning-intelligence).
Hosted execution follows proven planning, workflow, isolation, and recovery.

**Acceptance scenarios:**

- Given validated work awaiting team delivery, when local checks pass but shared CI fails, Workspace must not merge it.
- When a teammate is assigned review, assistance, decisions, and merge attribution preserve the author, reviewer, and
  merger identities.
- Given a repository explicitly using Dual Review, when one review gate changes, the other gate is not silently
  synchronized or satisfied.
- Given an external contribution, when a maintainer adopts it, the Plan and delivery preserve both contributor and
  maintainer provenance.

<a id="7-product-constraints-and-architectural-reference"></a>

## Product Constraints and Architectural Reference

- Local TUI and ACP use must remain available without starting Workspace or maintaining its registration database.
- Workspace accesses only Projects the owner registered, and the owner can revoke device access.
- Project data and conversation history remain private according to their existing sharing choices. Viewing a Project
  does not authorize wider Agent access.
- Projects can make progress independently. One Project's indexing or failure should not make unrelated work unusable.
- Browser, TUI, and ACP preserve the same Session identity and supported workflow behavior.
- Existing repository artifacts remain usable outside Workspace. Workspace must not require users to move their Plans or
  knowledge into a proprietary document store.

Session storage, synchronization, and writer coordination are described in
[ADR-015](../adr/015-file-authoritative-session-bundles.md). Product requirements above define the experience that
design must support. Internal lock phases, file layouts, and recovery algorithms belong in architecture and
implementation records, not as additional user obligations.

<a id="8-first-version-acceptance-criteria"></a>

## First-Version Acceptance Criteria

This cross-capability journey proves that the independently described capabilities work together. Personal Remote
Workspace v1 is complete only when one trusted developer can:

1. Reach Workspace over a private network, pair a browser deliberately, list paired devices, and revoke one.
2. Register at least two local Projects and verify Workspace cannot browse or search unregistered roots.
3. See an attention-first Dashboard across those Projects that ranks Pinned, Needs You, Ready to Continue, Recently
   Finished, and Running Quietly work without requiring Project-by-Project inspection.
4. Create a standalone Session in Workspace, resume it later, and retain one durable identity across Agent handoffs.
5. Run live Sessions in at least two Projects concurrently without Session, tool, interaction, or workflow state bleed.
6. Start work in Workspace, disconnect the browser, and reconnect to the saved conversation and current progress without
   repeating the request or losing the draft.
7. Start a Session in TUI, leave its window open, send the next message from a phone when the Agent is ready, and return
   to the updated TUI. Repeat in the other direction. Include a long conversation and a completed Plan follow-up.
8. Associate a Session with a Plan, change the Plan after opening its review, and confirm Workspace shows the update
   before accepting approval of the changed content.
9. Complete a bounded FEATURE journey through planning, Plannotator review, **Approve & Run**, execution, Workflow
   Validation, and Work Record visibility from Workspace.
10. Use **Approve for Later** to leave an approved Plan Ready For Work without starting execution.
11. After an interrupted operation, reopen the saved conversation and follow the stated next action without losing input
    or silently repeating work whose outcome is uncertain.
12. Search eligible Plans, PRDs, ADRs, and Work Records within one Project and across contributing registered Projects.
13. Search source code across explicitly selected Projects through Cymbal federation, receive Project-labeled partial
    results when one index fails, and avoid Plan-worktree duplicates.
14. Confirm that another Session's Transcript is absent from Agent retrieval and Workspace Intelligence while remaining
    searchable by the owner for navigation.
15. Open a Project's main checkout in code-server without granting it ownership of RunWield Plan worktrees.
16. Receive an actionable attention signal for a required human interaction, return to the correct Session or Plan
    workflow. Pinning affects which work is easy to find; it does not change what the owner can do.

<a id="9-success-measures"></a>

## Success Measures

The first version succeeds when:

- the owner can complete the acceptance journey remotely without depending on an active TUI process;
- the TUI → phone → TUI journey works with both screens left open and preserves the selected Agent, model, and history;
- ordinary continuation needs no takeover, manual preparation, or full-history download;
- multiple Projects can make progress concurrently while human attention remains understandable;
- repeated requests do not duplicate work, and changed Plans are shown before approval;
- artifact and code search return only eligible, explicitly scoped Project data;
- repository artifacts remain usable through existing CLI and TUI workflows without migration to Workspace-only data;
- users can distinguish durable knowledge, private transcript history, main-checkout code, and Plan-worktree changes;
- Workspace feels like a Plan/workflow product rather than an Agent fleet dashboard or browser IDE wrapper.

<a id="10-risks-and-mitigations"></a>

## Risks and Mitigations

| Risk                                                                  | Product mitigation                                                                                                                                        |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistent remote access expands the local attack surface.            | Require private networking, device pairing, revocation, trusted Project roots, consistent access permissions, and explicit consequential actions.         |
| Switching screens loses work or blocks ordinary continuation.         | Prove the TUI → phone → TUI journey with open clients, long history, preserved drafts, and follow-up after completed work.                                |
| Background continuation surprises the user.                           | Show Running and Needs You state prominently, notify at human gates, expose cancellation, and preserve explicit execution authorization.                  |
| Multi-Project concurrency exhausts a developer laptop.                | Keep inactive Projects inexpensive, show resource pressure, and return partial results when one Project is unavailable.                                   |
| Cross-Project search leaks sensitive code or paths.                   | Query only explicitly selected registered Projects, sanitize absolute paths, keep Agent tools Project-scoped, and support artifact-intelligence opt-out.  |
| Global search conflates incompatible symbol versions.                 | Keep Project identity visible, group results by Project, exclude Plan worktrees, and avoid invented cross-Project call graphs.                            |
| code-server becomes an unbounded filesystem or terminal backdoor.     | Treat it as a separately bounded Code Surface tied to the intended Project and never as authorization for other roots or Plan worktrees.                  |
| Session history becomes accidental shared memory.                     | Keep Transcripts owner-private and out of Agent retrieval; require durable artifact creation for reusable knowledge.                                      |
| Workspace drifts into generic Agent management or noisy multitasking. | Organize around an attention-first queue, Projects, Sessions, and Plan workflows; keep Running Quietly secondary; do not add generic Tasks or Work Items. |
| Personal architecture cannot evolve to SaaS.                          | Preserve independent Project access and a consistent Session experience so later team hosting can extend the product.                                     |

<a id="11-out-of-scope-for-personal-remote-workspace-v1"></a>

## Out of Scope for Personal Remote Workspace v1

- Public-internet exposure without a private network.
- Team accounts, roles, organization membership, or shared-machine concurrency.
- Multiplayer code review, review assignment, and Workspace-side merge; these arrive with the collaborative SaaS
  Workspace, while Personal v1 review stays owner-only.
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
- Silently repeating unfinished work after a crash without knowing its outcome.
- Separate hosted execution environments for each Project.
- Identical token-by-token animation on every open screen. Each screen must still update automatically as work is saved.
- Hosted SaaS execution, billing, organization policy, or multi-tenant infrastructure.
- Replacing Shared Plan capability links with Workspace device identity.

<a id="12-sequencing"></a>

## Sequencing

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
device pairing, Attention Dashboard, reliable Session continuation, automatic conversation updates, canonical Plan
action checks, unified Plan workflow, notifications, artifact intelligence, human cross-Project Cymbal search, and the
code-server Code Surface.

Cross-Project search is part of the first version, not a later add-on: a multi-Project Workspace should support
deliberate search across both durable planning artifacts and source code while preserving their different semantics.

### Following: OpenAB/Telegram compatibility

After Personal Remote Workspace establishes reliable Session continuation, automatic updates, and consistent Plan action
coordination, complete the OpenAB/Telegram Stage 1 proof against the same shared coordination model. Telegram remains a
secondary notification and continuation channel rather than a parallel Session owner or primary product shell.

ACP remains the replaceable external-client contract, and full ACP v1 compliance remains valuable independently of
Telegram.

### Later: collaborative SaaS Workspace

Deliver [team planning and governance](#team-planning-and-governance),
[artifact privacy](#team-artifact-privacy-and-authorship), [team intelligence](#team-planning-intelligence), and
[team review and delivery](#team-code-review-and-delivery). Hosted execution follows proven planning, workflow,
isolation, and recovery.

<a id="13-proposed-domain-language"></a>

## Proposed Domain Language

**Workspace Intelligence Search**: Deliberate retrieval over eligible durable artifacts across registered Projects,
preserving source Project, artifact type, status, and freshness. _Avoid_: Public global search, Session Transcript
search, unscoped organization access

**Project Evidence Graph**: A rebuildable provenance projection connecting durable project intent, decisions, Plans,
delivery evidence, and outcomes without replacing source artifacts as project truth. _Avoid_: Plan Evidence Graph,
Session Transcript graph, source of truth

**Assignable Human Review**: Workspace-hosted human code review assigned to a teammate, with Agent assistance for
reviewer and author. Review discussion and approval state are Workspace process data held outside the repository; only
durable results are committed. _Avoid_: pull request, PR review, review sync

**Forge** (proposed redefinition): under the default posture the Forge is the remote git host and merge substrate;
review and repository policy are RunWield capabilities that a team may explicitly delegate to the Forge per repository.
_Avoid_: system of record for intent, review, or memory; required review gate

These terms remain proposed until their respective capabilities ship. Workspace Intelligence Search does not itself
establish the proposed Project Evidence Graph.

<a id="14-references"></a>

## References

- [RunWield Core PRD](./runwield-core-prd.md)
- [Session Host and ACP PRD](./runwield-acp-protocol-prd.md)
- [Cymbal multi-Project federation research](../research/cymbal-multiproject-search-federation.md)
- [Shared Core Plan lifecycle](./runwield-core-prd.md#plan-lifecycle)
- [Collaborative Planning PRD](./collaborative-planning-PRD.md)
- [Forge Change Request Delivery PRD](./forge-change-request-delivery-prd.md)
- [ADR-007: Local-First Workspace Plan Board](../adr/007-local-first-workspace-plan-board.md)
- [ADR-008: Remote-Canonical Collaborative Shared Spaces](../adr/008-remote-canonical-collaborative-shared-spaces.md)
- [ADR-010: SessionRuntime sibling adapters and ACP](../adr/010-session-runtime-sibling-adapters-and-acp.md)
- [ADR-015: File-Authoritative Session Bundles](../adr/015-file-authoritative-session-bundles.md)
- [RunWield Design System](../design-system.md)
