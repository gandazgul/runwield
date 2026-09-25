# Product Requirements Document (PRD): RunWield Core

**Document role: Living central PRD.** Shared local workflow principles and lasting Core product requirements.

Keep this document as current product guidance. Fold lasting requirements from completed feature PRDs here;
implementation steps belong in Plans, architectural choices in ADRs, and delivery evidence in Work Records.

This PRD defines the user needs and outcomes for **RunWield Core**: local planning, execution, conversation, validation,
and recovery. [Domain language](../domain-language.md) defines the shared product terms. Architecture belongs in ADRs;
implementation steps and remaining work belong in Plans.

Current capabilities and future proposals are distinguished below. A listed capability does not establish that every
journey using it is complete.

<a id="1-vision--strategy"></a>

## Vision & Strategy

**RunWield Core** is an opinionated, local-first coding harness for AI-partnered software planning and execution. It
moves beyond "chat-and-hope" AI by enforcing a Plan-by-Default philosophy, routing requests through specialized Agents,
preserving project/session context, validating implementation work, and keeping durable Plan artifacts in the repo.

Core is the free local engine behind the broader RunWield product:

- local `wld` CLI
- interactive TUI
- local browser Workspace client
- Plan lifecycle and validation workflows
- local markdown Plans, PRDs, ADRs, and Work Records
- agent definitions, skills, tools, and model configuration
- consistent Sessions and workflows across TUI, ACP, and Workspace

Where RunWield's product vision does not require deliberate divergence, Core should remain compatible with
`@earendil-works/pi-coding-agent` conventions, APIs, session behavior, model/provider configuration, and skill/tool
ecosystem expectations. RunWield should diverge only where its planning, lifecycle, validation, memory, or Workspace
goals require a distinct product surface.

<a id="2-core-philosophies"></a>

## Core Philosophies

- **Plan-by-Default:** Material work should become a reviewed Plan unless it is explicitly `OPERATION` or `QUICK_FIX`.
- **Right ceremony for the request:** Router should distinguish inquiry, ideation, operation, quick fix, feature, and
  project work so simple tasks are not over-planned and large work is not under-specified.
- **Artifacts over vibes:** Plans, PRDs, ADRs, validation notes, and Work Records are durable project memory.
- **Session continuity:** Fresh sessions start with Router, but follow-up messages stay with the specialist Agent that
  owns the current topic unless the user explicitly starts fresh or returns to Router. Opening an empty composer does
  not create project runtime state; the first submitted work enters the project runtime.
- **Work protection:** Before normal project runtime access, Core uses Project Runtime Entry to adopt eligible legacy
  state or refuse unsafe layouts. Refusals keep the reason and safe paths, stop writes, and are retryable after cleanup.
  This follows [ADR-017](../adr/017-project-runtime-state-under-wld-internal.md).
- **Tool-driven workflow:** Agents declare intent with custom tools; orchestration code decides lifecycle transitions,
  execution, validation, and recovery.
- **Local-first control:** Core must remain useful without the hosted Workspace.
- **Context parsimony:** Prefer targeted project context, memory recall, code intelligence, and Plan artifacts over
  dumping broad context into every prompt.
- **Pi compatibility by default:** Stay compatible with Pi Coding Agent conventions where RunWield's product vision does
  not intentionally require different behavior.
- **Extensible but guarded:** Agent definitions, skills, prompt templates, and tools are customizable, but protected
  workflow tools preserve Core invariants.

## Capability Requirements

Each capability below owns its named requirements and acceptance scenarios. The scope labels preserve existing product
commitments; they are not a release audit. Internal mechanisms and detailed checks belong in linked ADRs and Plans.
Other surfaces reference these requirements and add only their own user experience.

- [TUI conversation](#tui-conversation)
- [Request routing](#request-routing)
- [Plan review](#plan-review)
- [Plan authoring and external adoption](#plan-authoring-and-external-adoption)
- [Plan lifecycle](#plan-lifecycle)
- [Epic decomposition and hold](#epic-decomposition-and-hold)
- [Execution, validation, and recovery](#execution-validation-and-recovery)
- [Semantic review and repair](#semantic-review-and-repair)
- [Frontend engineering and pair execution](#frontend-engineering-and-pair-execution)
- [Theme selection](#theme-selection)
- [Project context and initialization](#project-context-and-initialization)
- [Compaction and image context](#compaction-and-image-context)
- [Work records](#work-records)
- [Agent and skill customization](#agent-and-skill-customization)
- [Models and providers](#models-and-providers)
- [Installation and updates](#installation-and-updates)
- [Work protection](#work-protection)
- [Session continuity](#session-continuity)
- [Capability-organized product requirements](#capability-organized-product-requirements)

<a id="31-tui-shell-and-root-agent-behavior"></a>

### TUI conversation

**Scope and maturity:** Current baseline.

**Requirement: Keep follow-ups with their active specialist.**

The TUI is currently the primary interactive Core client. It starts a session, renders the conversation, hosts slash
commands, and displays workflow/tool progress. Core owns command meaning; each surface owns only which commands it makes
available and how it presents questions.

New sessions start with the **Router** Agent.

After Router hands off to Guide, Ideator, Operator, Planner, Architect, Engineer, or another specialist, that specialist
remains the active root Agent. This keeps follow-up messages in useful context.

**Requirement: Agent selection replaces active instructions.** Switching Agents preserves conversation history while
replacing the model's system instructions and available tools with those of the selected Agent. Earlier Agents' system
instructions remain historical evidence and must not govern subsequent requests, including after Session resume.

**Requirement: Preserve steering through an Agent handoff.**

When an accepted workflow event starts an Agent handoff, Core stops and settles the outgoing Agent turn before the
replacement Agent starts provider work. Steering Messages submitted from that point belong to the replacement Agent.
Core transfers each pending message once, in order, with its identity, text, images, and notification destination
unchanged. A transfer does not report the message as consumed. Core reports consumption and shows the user message only
when the replacement Agent receives it.

If replacement setup fails, Core keeps the previous Agent active and retains the pending Steering Messages. Canceling a
Session removes pending Steering Messages and ends the handoff. A prior Triage Report cannot start a second handoff.

**Requirement: Announce real Agent changes once.**

A successful change to a different active Agent produces one conversation notice. Initial activation, reloading the same
Agent, and ordinary commands or follow-ups do not repeat that notice.

Users can:

- use `/new` to start a fresh routed session
- use `/agent router` to route the next message in the same session
- use `/resume` for chat-session resume
- use `/load-plan <plan>` for Plan workflow resume

A fully typed `/load-plan <plan>` submits with one Enter, regardless of autocomplete lookup timing. Partial Plan names
remain discoverable through completion; an exact Plan name must not select a longer matching name.

A leading slash that resolves to an available command is a command, not a User Request. Disabled or unknown commands
must fail visibly and must not fall through to Router.

**Requirement: Recover stale terminal visuals without disrupting work.**

Returning focus to the terminal repaints the screen. Ctrl+L also forces a full redraw. Both preserve the unsent draft,
conversation scroll position, active interaction, and running Agent turn.

**Requirement: Keep expanded tool output responsive.**

Ctrl+O toggles only tool groups that intersect the current TUI viewport. Each expanded tool block shows at most 500
output lines. For longer output, it keeps the start and end and shows how many middle lines it omitted.

**Requirement: Keep long conversations responsive and scrolling safe.**

The TUI must not reformat unchanged retained conversation blocks for each live update. Local terminal scroll input must
move the conversation viewport without adding terminal control text to the draft or interrupting the active Agent turn.
A deliberate Escape key remains available to interrupt the turn.

**Acceptance scenarios:**

- Given a new conversation, when the user submits a request, Router handles initial triage; after a specialist handoff,
  follow-up messages stay with that specialist.
- Given a Session previously handled by Router and Ideator, when the user selects Engineer and requests implementation,
  the model receives Engineer's instructions and tools with the earlier conversation intact. Router's triage-only
  instructions no longer apply on the first turn, follow-ups, or a resumed Session. Selecting Router again restores its
  routing instructions and tools.
- Given Router has emitted an accepted Triage Report, when the user sends text or images before the specialist is ready,
  Router settles without another provider request and the specialist receives each message once, in order. The queue
  reports consumption only after delivery.
- Given a fully typed existing Plan name, pressing Enter once opens that Plan, even if a longer Plan name shares its
  prefix and completion lookup has finished.
- After switching to Guide, commands and follow-up messages produce no additional Agent notice unless the active Agent
  changes again.
- Given an existing topic, when the user chooses `/new`, a fresh routed conversation opens; `/agent router` instead
  routes within the same Session.
- Given erased terminal contents while the input still accepts typing, returning focus or pressing Ctrl+L restores the
  input and conversation without submitting or discarding the draft, scrolling, or interrupting the Agent.
- Given a long local conversation while an Agent turn is active, when the user scrolls and types a draft, the viewport
  moves without terminal control text in the draft or interruption of the Agent turn; a deliberate Escape still
  interrupts it.
- Given tool groups above and inside the current viewport, when the user presses Ctrl+O, only the intersecting groups
  toggle. A tool result longer than 500 lines keeps its first and last lines and identifies the omitted middle lines.

<a id="32-routing-intents"></a>
<a id="33-triage-experience"></a>

### Request routing

**Scope and maturity:** Current baseline.

**Requirement: Match planning and checks to the request.**

Router emits one canonical **Routing Intent**:

- `INQUIRY`: answer-focused understanding work, answered by Guide. Guide may preserve an answer as an ordinary `.md`
  document only after an explicit in-session user request.
- `IDEATION`: strategic/product exploration and Socratic shaping, handled by Ideator.
- `OPERATION`: direct non-code repository or environment operation, handled by Operator.
- `QUICK_FIX`: bounded no-plan code implementation, handled by Engineer with Mechanical Validation only.
- `PLANNED_CHANGE`: planned executable work, handled by Planner. Work Kind (`BUG_FIX`, `FEATURE`, `REFACTOR`,
  `MAINTENANCE`, `DOCUMENTATION`) records the nature of the work; legacy `FEATURE` routing/classification normalizes
  here.
- `PROJECT`: Epic-scale work, handled by Architect and Slicer.

Only `PLANNED_CHANGE` and `PROJECT` produce Plans.

After enough discovery to understand the request, Router explains the chosen type of work, complexity, and rationale,
then hands off to the responsible specialist. Users should not receive duplicate triage or unnecessary exploration. The
specialist remains active for follow-up messages.

**Acceptance scenarios:**

- When the user asks how code works, Guide answers without creating a Plan; when they ask for bounded code work,
  Engineer implements and receives Mechanical Validation.
- When a request needs planned implementation, Planner prepares a Planned Change; when it needs coordinated independent
  deliveries, Architect and Slicer shape an Epic. A planned bug remains a bug in Work Kind.

<a id="34-plan-review"></a>

### Plan review

**Scope and maturity:** Current baseline.

**Requirement: Apply the user’s review decision to the saved Plan.**

Planner or Architect presents a saved Plan for review. Users can approve, save it for later, give feedback, or cancel.
Feedback stays in the planning conversation so the Agent can revise it. Approval leads to a readiness check before
execution or decomposition; a Plan needing repair explains what prevents it from proceeding. Formatting-only changes
while review is open, including YAML normalization, prose wrapping, and table padding, do not invalidate the decision.
Changes to Plan meaning, code, execution policy, or workflow evidence still require reviewing the current Plan.

**Requirement: Open saved Plans directly for review.**

Loading a draft, feedback, approved, or ready-for-work Plan with a valid execution policy offers direct Plan Review,
including Plans without custom shell checks. Users can inspect and annotate the saved Plan without first asking Planner
to revise it. Approval, feedback, and cancellation follow the same review flow as a newly presented Plan.

**Requirement: Return to the most recent Plan review in the same Session.**

From an existing Session, `/plan-review` returns the link to its live Plan review when available. Otherwise, when the
Session is idle, it opens that Session's most recently presented Plan for direct review without a new planning request.
This is a saved reference to the last review, not a saved unanswered review decision. The current Plan and its identity
and review eligibility are checked before opening it; the new decision follows the normal Plan review flow. A Session
with no previous review, a busy Session, or a missing, replaced, or no longer reviewable Plan receives an explanation
instead of an invented review or approval.

**Requirement: Keep long review waits responsive.**

Users can leave Plan Review open and return later without the waiting Session accumulating background work or becoming
slower to accept their decision. Terminal progress animations pause during human input and resume when work continues.

**Acceptance scenarios:**

- Given a saved Plan, when the user submits feedback, the planning conversation receives it and can revise the Plan
  before execution.
- When the user approves for later, work does not start; when they approve and run, readiness is checked before the
  appropriate execution or decomposition proceeds.
- Given an open review, when a commit hook reformats the saved Plan without changing its meaning, the user’s decision
  still applies; changed instructions, code, links, or execution policy reject the outdated decision.
- When the user cancels review or readiness fails, the UI explains the next action without treating Agent prose as
  approval.
- Given a ready-for-work Plan without custom shell checks, when the user loads it and chooses **Review plan**, the saved
  Plan opens for review without a planning turn; approving for later keeps it ready for work without starting execution.
- Given a live Plan review in a Session, when the user requests `/plan-review`, they receive its current link when
  available or a notice that it is starting; the command does not open a second review.
- Given a previously presented review and an idle Session, when the user requests `/plan-review`, the current saved Plan
  opens for a new decision without a planning turn. Feedback or approval still follows the normal review flow.
- Given no previous review, a busy Session, or a Plan whose identity or review eligibility has changed, when the user
  requests `/plan-review`, they receive a reason rather than approval of stale content.
- Given a Sequence saved only in its registered planning worktree, when the user reopens its review, the complete group
  decision is checked against that worktree, not a missing or older primary copy.
- Given Plan Review remains open in a browser while `wld` waits in the terminal, progress timers remain paused;
  returning to submit a decision continues the same Session without restarting it or losing the pending review.

### Plan authoring and external adoption

**Scope and maturity:** Standing product requirements; implementation details belong in the
[Plan lifecycle reference](../plan-lifecycle.md#plan-body-ownership-and-external-adoption).

**Requirement: The user owns the Plan body.**

Users can edit Plan prose with any tool, at any time. The body does not need to satisfy a RunWield document parser.
RunWield owns its lifecycle metadata and must preserve the user's current body during metadata repair, transition
failure, or rollback. A metadata problem must never be blamed on the user's prose. Saving content must protect edits
made since that content was opened; protecting those edits is separate from deciding whether metadata can advance.
Actual changes to the intended work still follow normal Plan review and approval.

**Requirement: Domain reasoning fits the user's project.**

For changes affecting domain behavior, Architect and Planner identify relevant concepts, identities, rules, owners,
consistency needs, and external translations using the project's language and conventions. Architect establishes the
relationships and trade-offs; Planner carries affected rules into implementation and verification. Depth follows the
change's needs and risk across software types and languages, without requiring an entity model, additional document, or
prescribed architecture.

**Requirement: Architectural commitments are supported by evidence.**

During Epic design, Architect explains consequential commitments, the practical implications of changing direction, and
the assumptions that could invalidate a choice. It recommends how to proceed using available evidence and focused
experiments where useful, justifies added flexibility, and records conditions for reconsideration. The Epic captures
relevant conclusions at a depth appropriate to the decision; individual ADRs follow the project's policy.

**Requirement: External Markdown Plans are first-class.**

A plain Markdown file in `docs/plans/` is a valid draft even without RunWield metadata. Listing, browsing, or inspecting
it leaves its bytes unchanged and does not label missing metadata as corruption. Deliberate `/load-plan` adoption adds
the required identity and defaults while preserving the body and the file's original age. Loading an adopted Plan again
does not reset its lifecycle or decisions.

**Acceptance scenarios:**

- Given any runtime layout, including unfinished migration or recovery records, opening `/load-plan` without a Plan
  argument only lists local Plan documents. It does not migrate storage, import controller metadata, fetch branches,
  repair worktrees, or change files or Sessions. Cancel leaves everything unchanged. Only selecting a Plan (or supplying
  its name explicitly) enters that Plan's load and recovery flow.
- Given an externally written Plan without metadata, when the user opens a listing or board, it remains readable and
  unchanged; deliberate loading then adopts it without changing its prose.
- Given a user body edit made during a metadata transition, when that transition fails or rolls back, the latest body
  remains intact.
- Given malformed lifecycle metadata, when recovery runs, RunWield repairs its own state rather than rejecting the
  user's prose or requiring the user to edit internal fields.
- Given an already adopted Plan, when it is loaded again, its age, identity, and lifecycle decisions remain intact.
- Given completed runtime migration and files recreated by an older RunWield process, selecting a Plan automatically
  preserves and reconciles those files. The adopted controller remains authoritative: old copies cannot reset review
  decisions, retry counters, execution identity, or publication progress. Missing records and completion reports are
  recovered without claiming validation passed. Originals remain recoverable, and interruption during this recovery
  resumes safely on the next attempt. Empty legacy lock directories do not block continuation.
- Given recreated empty or stale runtime registry files, migration reports, or debug files, selecting a Plan recovers
  them automatically without replacing current attempts. Distinct valid attempts remain available; originals remain
  recoverable. Registry recovery and ordinary writers cannot overwrite each other or wait on their own locks.
- Given a Plan listing or a grouped evidence read, nested reads of the same checkout share runtime-layout verification
  for that operation. Later reads and writes revalidate changed evidence; background work cannot retain verification
  after its initiating read ends. Plan contents, controller state, and publication evidence remain freshly read.
- Given simultaneous runtime migrations, transient files written by the first migration do not cause the second to
  report corruption. It waits for the migration owner and rechecks the resulting state. If an older process holds the
  registry lock, migration waits and validates the registry again after that writer releases it.
- Given a change affecting domain rules, architecture and planning identify their owners and necessary consistency and
  recovery behavior, then carry those rules into verification using the project's existing conventions.
- Given a project without an entity model, or a change needing little domain reasoning, planning proceeds without
  requiring a modeling artifact or imposing classes, services, or events.
- Given a consequential architectural choice, the Epic identifies affected dependencies, lasting effects, and the
  practical changes involved in choosing another direction.
- Given an assumption that could invalidate the design, Architect identifies evidence that would resolve it and
  recommends how to proceed. A proposed experiment states its observable result, effect on the recommendation, and
  whether its implementation is disposable or intended for production.
- Given a choice about flexibility, the Epic explains the concrete concern it addresses, the complexity introduced, and
  the evidence or changed requirement that would justify reconsideration. Routine choices receive brief treatment.

<a id="35-plan-lifecycle"></a>
<a id="user-verified-plan-lifecycle-outcome"></a>

### Plan lifecycle

**Scope and maturity:** Current baseline; status is not evidence that every validation journey succeeds.

**Requirement: Distinguish readiness, validation, delivery, and manual acceptance.**

Plan status tells users whether work needs review, can begin, is running, needs recovery, or is complete.

Users can distinguish drafts, feedback, approval, readiness, work in progress, implementation, validation, delivery,
manual acceptance, failure, and hold. Validation and successful publication are separate outcomes; finishing local
checks must not claim the change has reached its target. Technical status definitions live in the
[Plan lifecycle reference](../plan-lifecycle.md).

Lifecycle requirements:

- Planned Change Plans reach `ready_for_work` after approval and readiness.
- PROJECT Epics reach `ready_for_decomposition` after approval.
- Slicer finalization moves Epics to `ready_for_work` for child Plan selection.
- PROJECT Epics are containers and are not directly executed as implementation work.
- Child Plans execute and validate independently.
- Planned work claims RunWield verification only when the applicable validation requirements pass. Delivery must also be
  confirmed before the workflow reports it as delivered.
- Users can mark an Epic done enough when the delivered child work meets its goal.
- `closed_without_verification` records deliberate user abandonment of remaining work, never an automatic response to
  failure or exhausted retries. It must not claim verification or publication.
- `on_hold` pauses work and lets users resume from its previous stage.
- Board actions preserve the same lifecycle rules as CLI and TUI actions.

Users can mark a Plan `user_verified` with an explicit verification note. This satisfies dependencies and Epic
completion while remaining visibly distinct from automated verification. It is eligible for archival when no recoverable
work would be lost.

User Verification records the owner's acceptance and ends the Plan's execution workflow without claiming automated
validation or publication. Its terminal document, including the verification note, carries from the execution worktree
to the primary checkout. RunWield confirms before removing the execution worktree and its remaining uncommitted changes,
then clears its registry and live controller references. Declining removal keeps the checkout available without
reopening the accepted Plan; cleanup can be confirmed when archiving. Unmerged branch commits remain recoverable. User
Verified and RunWield Verified Plans have the same terminal menu: Archive, Re-open for review, View, and Cancel.

A delivery workflow has only two conclusions: successful publication or the user's deliberate choice to abandon it.
Failed checks, internal inconsistencies, exhausted automatic attempts, waiting for a decision, cancellation of a turn,
and hold are recoverable intermediate conditions. A technical status or a helpful error message does not turn any of
them into a conclusion. Marking an Epic done enough is an explicit choice to end the remaining Epic scope; it does not
claim its unfinished children shipped or authorize deleting their work.

**Acceptance scenarios:**

- Given implemented work whose delivery failed, when the user views the Plan, validation and publication remain distinct
  and a recovery action is available.
- When the user marks a Plan User Verified with a note, dependency and Epic completion checks accept that outcome while
  every presentation distinguishes it from RunWield verification.
- Given a Plan whose editable document is in an execution worktree, User Verification saves that document and note in
  the primary checkout, confirms worktree removal, clears the completed attempt, and generates the Work Record from the
  accepted document. Reloading offers the same terminal actions as RunWield verification.
- When worktree removal is declined, the accepted document remains in the primary checkout and the execution files are
  preserved. Choosing Archive asks for cleanup confirmation again; canceling does not archive or remove those files.
- When the user closes without verification, the Plan records that outcome without claiming checks passed.
- Given an unpublished workflow, User Verification never reports it as published, and canceling a turn does not silently
  abandon it. Removing remaining worktree files requires the user's explicit confirmation.

### Epic decomposition and hold

**Scope and maturity:** Current baseline.

**Requirement: Deliver independent children and preserve paused work.**

An Epic is a larger outcome whose child Plans can ship independently. After Epic approval, Slicer discusses boundaries,
dependencies, priorities, and a useful MVP with the user. **Write a draft** saves reviewable children without finalizing
the decomposition. Finalization makes child selection available; each child still needs its own review and approval. The
conversation can pause and resume. Users can deliver one child, defer the rest, and mark the Epic done enough with a
summary while unfinished children remain available.

`load-plan` offers the appropriate planning, decomposition, child selection, execution, or recovery action. When a new
Epic has no target branch, opening it for child work creates that branch from the repository's default branch before
Planner starts. An existing target branch keeps its own history. Unfinished dependencies are explained before
proceeding. `wld plans` shows Epic progress and child status separately from standalone Plans. Revising an Epic does not
silently authorize changed child scope.

**On hold** means paused and resumable, not completed or archived. Nonterminal Plans can retain their previous stage and
an optional reason. **Resume from hold** checks whether relevant changes or missing work affect continuation, then
resumes, offers warnings, or leaves the Plan held with recovery choices. **Reset status to draft** preserves the Plan
body and offers a way to retain unmerged work; deleting that work requires confirmation.

Holding an Epic pauses access to its children without changing their individual statuses. Resume the parent before
working on a child. A child held independently stays held after the parent resumes. Holding one child leaves its parent
and siblings active. Listings keep held work distinct from active and finished work.

**Acceptance scenarios:**

- Given a new Epic with a missing target branch, when the user opens it to start the first child, the target branch
  starts from the repository's default branch and Planner can use the child Plan.
- Given an approved Epic, when the user saves draft children, they remain drafts; finalizing decomposition enables child
  selection without approving each child.
- Given an independently held child, when the parent Epic is held and resumed, that child stays held and other children
  keep their own statuses.
- When only enough children have shipped to meet the goal, the user can mark the Epic done enough while remaining child
  scope stays visible.

<a id="36-execution-worktrees-validation-and-recovery"></a>

### Execution, validation, and recovery

**Scope and maturity:** Existing execution and validation baseline, with the owner's clarified completion and automatic
recovery requirements below. These requirements do not certify that every current failure path already meets them.
QUICK_FIX keeps its explicitly lighter behavior; answering a question does not require publication. The remote
connection currently has setup/process cleanup and a personal mount; remote Session or workflow recovery remains target
scope.

**Requirement: Clean up connection-owned remote setup without claiming workflow recovery.**

The connection-only remote supervisor monitors its control channel separately from the TUI and stops owned processes,
including the connection-owned personal SFTP/SSHFS transport, on normal exit or detected loss. Failed or interrupted
runtime preparation leaves the existing profile, project files, and verified runtime cache in place; the next attempt
can repair private staging. If process exit cannot be confirmed, report uncertainty. No remote Agent or Session work
exists yet to resume or recover. The broader connected-only and uncertain-effects requirements remain
[proposed](remote-ssh-prd.md#disconnect-and-recovery).

**Acceptance scenarios:**

- Given connection loss or view exit, the supervisor stops its connection-owned view rather than leaving a detached
  Agent; unrelated server processes are not part of its cleanup.
- Given interrupted setup, reconnecting checks the private runtime cache and can prepare the matching executable without
  asking the user to remove internal staging or altering their personal profile. This does not claim recovery of an
  interrupted remote edit or publication.

**Requirement: Publish successfully or end only by deliberate user abandonment.**

RunWield carries an accepted delivery workflow through to confirmed publication unless the user willingly abandons it.
There is no automatic terminal failure path. Internal errors, retry limits, or an Agent ending its turn cannot strand
the user, clear the active workflow, or require them to start a replacement workflow. A pause for approval, an actual
external prerequisite, or a user-requested hold preserves the same work and its immediate continuation path.

**Requirement: Replanning preserves the existing implementation.**

Returning to Planner or reopening Plan review does not abandon the execution attempt. Approve & Run first reuses the
same Plan's available worktree, preserving its commits, staged changes, and untracked files while applying the newly
approved Plan. Reapproval invalidates earlier validation evidence, not the implementation. Only an explicit user reset
or abandonment retires that attempt; published attempts are not reused.

Acceptance scenarios:

- Given an implemented Plan with review findings and committed and uncommitted repairs, when the user revises and
  approves it again, execution continues in the same worktree with the approved revision and all repairs intact.
- Given a restarted Session without cached execution details, approval finds the existing attempt in the registry
  instead of creating a replacement. The primary checkout's unrelated edits remain unchanged.
- Given an explicitly abandoned attempt, approval does not reactivate it or discard its preserved files.

**Requirement: RunWield repairs its own machinery automatically.**

Internal inconsistencies involving locks, settings, storage, lifecycle metadata, registries, or Plan synchronization are
RunWield's responsibility. It diagnoses, reconciles, repairs, and continues automatically without requiring the user to
inspect files, choose storage strategies, run internal repair commands, or understand bookkeeping. These repairs stay
out of the ordinary user experience. Detailed diagnostics remain available for deliberate support/developer inspection;
an explanatory error message alone does not satisfy recovery.

Automatic repair preserves user content, truthful validation, and real permissions. It must not guess that work was
published, overwrite user decisions, repeat uncertain external side effects, or destroy work to make internal state
consistent. A broken internal state never removes the obligation to retain and recover the workflow.

**Requirement: Ask only for an outcome-level decision or a genuine external prerequisite.**

When the user genuinely must act, explain what happened, what RunWield is protecting, the specific missing evidence or
external prerequisite, the action they can take, what Retry will continue, and what each choice means. Offer deliberate
abandonment with work preserved at the safest recoverable point. Commands are copy-ready with real values when an
external action actually requires a command; never substitute internal labels, hashes, or a generic "restore from
backup" instruction. Waiting for that action remains part of the open workflow. Do not make repetitive retry clicks the
normal way to repair RunWield-owned inconsistencies.

**Requirement: Validate and deliver approved work without losing recoverable changes.**

Executable Plan work starts only from `ready_for_work`.

Execution requirements:

- work on the approved Plan in an isolated worktree;
- preserve the user's existing checkout changes and a useful recovery point;
- distinguish implementation being finished from validation succeeding.

Workflow Validation requirements:

- run the project's configured checks and review the change against the approved Plan;
- offer human code review when enabled;
- repair failed checks or review findings within the execution worktree;
- give a repair Agent the relevant findings and instructions without unrelated earlier context;
- keep publication-conflict repairs attached to the publication attempt, not CI or code-review repair checkpoints; an
  accepted `task_completed` continues Git verification and publication without another user prompt, whether the Agent
  staged the resolutions or committed them;
- when publication is pending, keep that distinction visible when loading the parent Epic and offer the child’s
  publication continuation instead of presenting validation as finished delivery;
- preserve Plan document bytes during controller-only updates, including publication retries;
- recover unstaged, formatting-only Plan drift from the sealed candidate on publication retry, without overwriting
  changed definitions, body text, staged changes, or committed changes;
- show interrupted validation as paused, never as still running, while retaining its saved continuation;
- derive the final progress display from confirmed validation and publication results. Failed or canceled checks from a
  previous attempt must not turn successful publication and cleanup into a reported merge failure;
- deliver validated work to its configured target and confirm that outcome before reporting delivery complete;
- reread the active execution Plan before every validation phase and immediately before publication; its current
  `targetBranch` takes precedence over the Session snapshot and the branch recorded at worktree creation. If no target
  is specified, retain the recorded branch. A saved publication with a different target must not silently continue;
- retain the validated implementation commit and actual target branch in the committed Plan; completed delivery must
  remain recognizable from Git after temporary workflow records are removed. In non-Git projects, the completed Plan
  status is sufficient;
- after a normal Plan publication completes, keep follow-up messages with Engineer from the primary checkout, not from
  the removed execution worktree;
- when a published child Plan has an active parent Epic continuation, first leave the child worktree context, then let
  the Epic continuation select its required Agent;
- preserve a useful recovery path when execution, checks, review, or merge-back fails;
- resume interrupted validation without silently repeating finished work;
- resolve internal problems automatically and invisibly; ask only for real user decisions or external prerequisites;
- show short, plain messages with detailed diagnostics available separately;
- ask before deleting unmerged work or resetting working changes.

QUICK_FIX work does not create a Plan and runs Mechanical Validation only.

**One full validation run per handoff:** During managed implementation and repair, Agents run focused tests and
acceptance checks. RunWield owns the complete configured Mechanical Validation command after Task Completion, including
after a repair. Agent guidance must not require an identical full run immediately before that handoff. Diagnosis and
explicit user requests may require earlier full runs. Standalone work still requires the Agent to run full validation.
Reports distinguish completed focused checks from pending full validation; an Agent's success claim never replaces the
runtime gate or permits publication before it passes.

Recovery requirements:

- Before integration, a source-history rewrite or changes to sealed files automatically restart validation against the
  current execution checkout. Preserve the prior publication evidence and repair checkout, invalidate old review
  approvals and the validation stamp, and resume the reset after interruption. An unchanged candidate resumes its
  existing publication. An integration that may already have been pushed must retain its publication proof instead of
  being replayed automatically.
- loading `in_progress`, `failed`, or `implemented` Plans should open a recovery path
- users can continue, reset to baseline, re-open for review, retry validation, or address merge-back failures
- failed Plans leave recovery through dedicated recovery actions, not casual board movement
- before integration, a source-history rewrite or changes to sealed files restart validation against the current
  execution checkout. Preserve prior publication evidence and the repair checkout, invalidate old review approvals and
  the validation stamp, and resume the reset after interruption. An unchanged candidate resumes publication. Once an
  integration may have been pushed, retain its publication proof instead of restarting validation.

**Acceptance scenarios:**

- Given an unpublished sealed candidate whose branch was rewritten, including a rewrite followed by an additional
  `.gitignore` commit, validation automatically checks the current files and then creates new publication evidence.
  Staged edits, untracked files, and saved merge repairs remain intact. A restart during recovery finishes the same
  reset; a stale Session delivery checkpoint cannot skip the new checks.
- Given a managed repair, when the Agent completes focused verification, RunWield reloads the current configured command
  and runs full validation against the repair checkout. A failure still prevents progress; the Agent was not required to
  run that complete command immediately beforehand.
- Given a ready approved Plan and existing checkout edits, when execution starts, the approved work is isolated and the
  user’s edits remain preserved.
- Given a worktree created from `main`, when the execution Plan is edited to target `release/next` after the Session
  loaded it, validation and publication use `release/next`, leave `main` unchanged, and record the actual delivery
  target. Cleanup proves the source commits are on `release/next` before removing the source branch; it does not require
  those commits to be on the current checkout's branch.
- Given a Session that still displays failed or canceled checks from an earlier attempt, when a resumed delivery
  publishes and cleans up successfully, the Session reports delivery complete with the current check results and does
  not ask the user to repeat publication.
- Given a completed Plan without controller records, loading it recognizes delivery when Git proves its validated commit
  belongs to its target branch. A commit on an unrelated branch is not enough. A pending attempt offers continuation of
  publication or cleanup, rather than being treated as finished merely because validation passed.
- Given a committed archived Plan with no active attempt, Doctor reports no publication problem merely because its
  historical target branch or pre-squash commit disappeared. An archived Plan with an unfinished attempt still receives
  the normal recovery check. Archiving alone does not prove publication or authorize deletion of unmerged work.
- When project checks or review fail, the user sees repair progress or a concrete recovery choice; implementation
  completion alone does not claim verification or delivery.
- Given a paused Validation Repair Engineer conversation, when the user replies after compaction, RunWield continues the
  same Session and repair worktree instead of failing because storage and execution roots differ.
- Given a fresh, unpersisted Session, when its first submitted action starts execution or validation, RunWield registers
  the Session before entering the execution worktree. An interrupted repair accepts the next message in that same
  worktree, including after automatic compaction or Session reload. Merely listing Plans remains read-only.
- When publication succeeds, follow-up returns to the primary checkout or the parent Epic’s next action; it does not
  operate in a removed worktree.
- Loading a Plan opens its picker or action menu. It does not remove branches, move leftover files, or resume
  publication cleanup. After confirmed publication, leftover cleanup records do not require the execution document or
  recreate its removed worktree. The user can view the Plan or explicitly choose to remove the published worktree and
  branch.
- Given publication succeeded and the target branch gained later commits, normal publication cleanup or explicitly
  requested cleanup finishes when that branch still contains the published commits, even if temporary checkouts are
  already gone. It does not repeat publication, alter primary-checkout edits, or ask the user to repair normal Git
  history. If the published commits cannot be confirmed on the target, remaining files are kept.
- Given confirmed publication and leftover checkout files whose Git registration is gone, cleanup preserves the entire
  directory in a named saved-files folder and finishes without asking the user to repair Git bookkeeping. It reports
  that folder and never discards uncommitted, untracked, or ignored files on the strength of commit history alone.
- When interrupted validation resumes, preserved work is reused without silently repeating completed actions or deleting
  unmerged changes.
- Given stale locks, inconsistent settings/storage, or mismatched Plan bookkeeping during a workflow, when RunWield
  encounters them, it restores its own consistent state and continues without exposing a repair task to the user.
- Given a Workspace server that remains alive after abandoning a Plan lock, publication reclaims the abandoned file only
  after proving the operating-system lock is free. A live operation keeps its lock even if its heartbeat is late.
  Dashboard and search catalog reads do not acquire the catalog write lock; deliberate identity backfills still do.
- Given publication pauses after automatic recovery, the Session presents the failure once, states what prevented
  publication and what work was preserved, and gives a relevant next action. It does not prescribe reloading a Plan as a
  cure for an unresolved internal error.
- Given exhausted automatic attempts, when publication has not succeeded and the user has not abandoned, the same
  workflow remains recoverable; it cannot disappear into a terminal error even if that error has a detailed message.
- Given a genuine external prerequisite, when RunWield waits, the user gets a specific action and an immediate retry or
  abandonment choice; Retry continues the preserved workflow instead of recreating completed work.
- Given a partially completed external operation, when recovery runs, RunWield establishes its outcome before retrying
  and never reports an unproven rollback or publication.
- When the user deliberately abandons, RunWield ends the workflow with that outcome and retains unmerged work unless
  loss-free cleanup is proven or deletion is explicitly authorized.

### Semantic review and repair

**Scope and maturity:** Current baseline.

**Requirement: Resolve concrete findings through independent review.**

Review evaluates the approved Plan and concrete correctness, regression, or security defects. It must inspect the actual
change, cover material requirements, and report all supported blockers found. It must not invent requirements from
preferences, unrelated code, or generated post-validation notes. Reasonable interpretations of ambiguous requirements
can pass with an advisory; maintainability observations remain nonblocking, and style-only or unrelated suggestions do
not become repair obligations.

The first two rounds inspect the whole change; the second also verifies earlier findings. Later rounds verify unresolved
findings and inspect repair changes for regressions. Each finding remains identifiable across rounds, with resolved and
open items visible. Repair reports address every finding; an independent Reviewer verifies fixes rather than accepting
self-approval.

**Requirement: Use one proposed branch patch.**

For Git worktree execution, the full review patch is the difference from the common ancestor of the recorded target
branch and execution HEAD to all current worktree files. It includes committed, staged, unstaged, and non-ignored
untracked changes. Target-only changes do not appear as proposed reversals. The same comparison supplies Semantic
Review, repair context, and Code Review, including reload and continuation. One shared comparison owner produces the
patch; review tools page it and review interfaces present it without creating another Git comparison.

The recorded target branch remains authoritative when it is not `main`. A missing target, missing execution HEAD, or
absent common ancestor is a recoverable comparison failure, not an empty diff or permission to use another branch. Each
computation resolves one target commit and one execution commit. A later review refresh can use newer commits and
current files. The execution baseline remains authoritative only for recovery and explicit before-and-after repair
comparisons.

**Acceptance scenarios:**

- Given target work imported after execution starts, when review runs, unchanged imported files are absent from the full
  patch and separate worktree changes remain present.
- Given a target that advances without the execution branch importing it, when review refreshes, target-only additions,
  changes, and deletions remain absent while execution changes remain present.
- Given identical target and worktree state, AI review, repair context, and human review receive the same full patch.
- Given a missing recorded target, missing execution HEAD, or unrelated histories, review stops with a recoverable
  comparison failure and does not use `main`, an alternate HEAD-only diff, the recovery baseline, or an empty patch.

**Requirement: Complete inspection before a review decision.**

The Reviewer receives the actual approved Plan content. Rounds one and two must read the complete diff for every changed
file. Round three onward must read the complete repair diff and assess every open issue; those rounds do not rediscover
unrelated defects in the original change. Both approving and rejecting require complete coverage of the relevant diff.
An incomplete decision returns the unread file chunks and instructions for reading them, in the same review context.
Listing files, rereading one chunk, or reading the wrong diff scope cannot satisfy coverage. Coverage proves that the
code was supplied to the Reviewer, not that the judgment is correct.

**Requirement: Distinguish repair claims from confirmed fixes.**

Issue states are `new`, `fix claimed`, `fix confirmed`, and `fix rejected`. Accepted repair completion claims a fix for
each supplied open issue. Independent review confirms or rejects each claim; rejection retains the issue identity and
explains what is still wrong. Only confirmed fixes close issues. These states and rejection reasons survive recovery.
Metrics separately distinguish first-round findings, defects missed in the original change, repair-introduced defects,
and existing issues still open. Origin is Reviewer attribution for diagnosis, not a new issue state or proof of cause.

Semantic and human-feedback repairs receive focused, fresh context in the same user-visible Session and Plan workflow.
Human feedback, annotations, and images must survive the handoff. Unclear references require clarification, not guesses.
Repair is about correctness; it does not introduce Pair design checkpoints.

After three automatic rounds and their repair/checks, users choose another verification round or Human Code Review.
Choosing human review transfers the decision to the user: feedback triggers repair and CI, then returns to human review.
No automatic round limit ends a human-driven review. A stalled Reviewer or repair Agent can be nudged in its existing
conversation with progress preserved; every pause explains what continuing will do.

The round limit bounds automatic review effort, not workflow life. The user can continue toward publication or
deliberately abandon; an exhausted or stalled review cannot become an automatic terminal outcome. Internal dispatch,
lock, and bookkeeping failures use [automatic workflow recovery](#execution-validation-and-recovery), not another review
decision for the user.

Final nonblocking advisories may accompany the delivered Plan as clearly labeled post-validation context, never new
approved requirements or a full review diary. Revalidation must not duplicate them. Review quality is judged by useful
convergence without more escaped defects, not approval rate alone.

**Acceptance scenarios:**

- Given a concrete missing Plan requirement, when independent review identifies it, the finding remains visible through
  repair until the Reviewer verifies the correction.
- Given an unread diff chunk, when the Reviewer attempts either verdict, completion returns its path and read command;
  the review continues with its existing findings and can complete once every required chunk is read.
- Given a round-one rejection, round two checks the entire implementation and prior findings. Round three and later
  check only open issues and repair regressions, including when the workflow resumes in a fresh process.
- Given a claimed fix that is incomplete, review records `fix rejected` and a reason under the same issue identity.
  Another completed repair moves it to `fix claimed`; independent confirmation closes it without creating a new issue.
- Given a prior finding that attributes unchanged target content to the current work, repair reports it as already
  satisfied with evidence and independent review can confirm it without requiring a file edit. The issue keeps its ID.
- Given only a maintainability preference, when review completes, it remains advisory and cannot become an invented
  implementation obligation.
- After the automatic-round boundary, when the user chooses human review, feedback leads to repair and checks and
  returns to that human review without an automatic round limit ending it.

<a id="frontend-engineer-and-pair-execution"></a>

### Frontend engineering and pair execution

**Scope and maturity:** Current baseline across TUI, Workspace, and ACP conversation hosts.

**Requirement: Let the user steer visible increments without bypassing validation.**

Frontend Engineer owns work whose primary outcome is materially visual or interactive, including supporting backend
changes in the same slice. Users can configure its model independently. Planner establishes outcomes, behavior, key
states, accessibility, responsive expectations, and existing design references, while leaving visual treatment open when
user taste is part of the work.

Pairing is optional. A Plan recommendation and conversation-host capability select Pair or autonomous work without an
extra startup question. Noninteractive hosts use autonomous execution. In Pair mode, Plan Engineer or Frontend Engineer
implements a coherent observable increment, reports it in the normal Session conversation, and ends the turn. The user
can ask questions without resuming implementation, request a revision, continue, switch to autonomous work, or stop with
work preserved. TUI, Workspace, and ACP use their normal message composer; Pair does not require a checkpoint form.
Iteration retains the same workflow owner, worktree, working directory, tools, attempt, and conversation.

A checkpoint report is not approval. Only a typed checkpoint resolution based on a later genuine user turn can resume
implementation or authorize final completion. Final approval uses the same report-and-reply flow. Reload and transcript
compaction preserve the active checkpoint and execution context. Stale, same-turn, generated, or quoted text cannot
resolve it. Material scope changes return to planning; ordinary refinements do not.

Both styles verify in the real browser when available and follow existing project tests. A new browser test framework
requires an explicit Plan decision. Pair feedback does not replace validation. Frontend ownership remains through normal
execution; semantic and human-review feedback use the dedicated focused repair behavior above. Measure useful revision
cycles, completion, and checkpoint fatigue without collecting screenshots or feedback in passive metrics.

**Acceptance scenarios:**

- Given a Plan with Pair selected on TUI, Workspace, or ACP, when an observable increment is ready, its report ends the
  Agent turn and the normal conversation accepts questions, revisions, continuation, autonomous switching, or Stop.
- Given an open checkpoint, same-turn output, generated continuation, quoted approval, or stale checkpoint data cannot
  resolve it. A later accepted user turn can.
- Given a final increment, the first completion attempt reports a final checkpoint. Workflow Validation starts only
  after a later user turn accepts it and the Agent submits typed completion again.
- Given a stopped Pair execution, work and workflow state remain available for an explicit later resume.
- Given a noninteractive host, when the same Plan runs, the execution Agent works autonomously; neither Pair feedback
  nor its absence replaces validation.

### Theme selection

**Scope and maturity:** Current baseline.

**Requirement: Preview safely and retain the confirmed theme.**

Users can install or remove themes from npm, Git, or local packages, preview them live in `/theme`, and confirm a choice
that persists across Sessions. Previewing does not overwrite the saved choice. The built-in `catppuccin-mocha` fallback
remains available when a selected theme is missing or invalid. Installing a theme does not activate accompanying
executable extensions. Public configuration is in the [theme reference](../themes.md).

**Acceptance scenarios:**

- When the user previews a theme and cancels, the saved theme stays unchanged; confirming persists the choice for later
  Sessions.
- When a saved theme becomes invalid, the built-in fallback remains usable without activating unrelated executable
  extensions.

<a id="61-current"></a>
<a id="62-future--open"></a>

### Project context and initialization

**Scope and maturity:** Current baseline; compressed Project Brief and further code-intelligence improvements are target
scope. Remote location resolution is available only in the connection-only subset described below; remote Project
Runtime State access is target scope.

**Requirement: Resolve an existing remote location without starting project work.**

`wld remote <host>[:<directory>]` resolves the remote account's home by default or an existing requested directory on
the server. It shows the canonical remote directory in a connection-only TUI. Relative paths and `~` refer to the remote
account. Git is optional; discovery can report a repository or worktree without entering its Project Runtime State. This
connection does not start Init, project tools, an Agent, or a saved Session. Full remote project work remains
[proposed](remote-ssh-prd.md#remote-workflows-and-local-review).

**Acceptance scenarios:**

- Given a remote home without Git, when the user connects without a path, the connection view shows that home and does
  not create a repository or Project Runtime State.
- Given an existing remote path through a symlink or a Git worktree, when the user connects, the view shows its
  canonical directory; a missing or inaccessible directory fails without creating or selecting a fallback directory.

**Requirement: Preserve useful project facts and retrieve relevant context.**

- **Mnemoteca:** project/global persistent memory for preferences, project facts, and critical context.
- **Init:** `wld init` / `/init` explores the project, writes context, stores memories, and records initialization.
- **Sleep:** `wld sleep` / `/sleep` runs memory and context cleanup prompts.
- **Cymbal:** external semantic/structural code intelligence for search, symbol lookup, impact analysis, tracing, and
  related code queries.
- **Snip:** optional command-output filtering for compact diagnostics.
- **Project context:** `docs/domain-language.md`, memories, settings, and Plan files provide durable project knowledge.

**Requirement: Offer an optional guided first change.**

On one eligible new TUI Session, RunWield offers a Tutorial after model setup and the Init decision. The offer
identifies the current project and warns that starting will make a real project change, use the configured model,
require Plan Review, and keep normal checks and delivery approvals. Start and Skip are explicit. The offer and Skip do
not start a model turn or persist a Session, Plan, or repository file. A separately accepted Init can still write its
own artifacts.

Skip or offer cancellation permanently suppresses automatic Tutorial offers at the user level across restarts and
projects. `/onboard` and interactive `wld onboard` remain available. Explicit entry shows consent before model setup or
Init. Non-interactive CLI entry exits without work. An Empty Project Directory receives the same automatic offer after
model setup. Its Tutorial lets the user choose a small starter project instead of an improvement to existing files.

After Start, Planner inspects a bounded area and suggests at most three small changes before Plan authorship. In an
Empty Project Directory, Planner suggests at most three small starter projects instead. The selected change uses normal
Plan Review, approved execution, project checks, AI review, optional Code Review, delivery, and Work Record generation.
Teaching messages follow real workflow events and do not approve, advance, or complete work. Only a RunWield Verified
and published change receives the successful Tutorial recap. Manual verification, closure without verification, pauses,
and failures remain distinct.

**Acceptance scenarios:**

- Given an eligible new TUI Session, when the offer appears, it shows the real-project warning and project path. Skip or
  cancel returns to ordinary input with no Tutorial model call or repository artifact and suppresses later automatic
  offers in this and other projects.
- Given an Empty Project Directory, when the user selects a model during first-run setup, the Tutorial offer appears.
  Given Start, Planner offers up to three small starter projects before it creates a Plan or edits files.
- Given a permanent Skip, when the user runs `/onboard` or interactive `wld onboard`, the warning still appears before
  setup, Init, discovery, or model work.
- Given Start, when the user selects an improvement, one ordinary draft Plan enters Plan Review. Feedback, Approve for
  Later, Approve & Run, validation, repair, Code Review, and delivery keep their normal meanings.
- Given the Plan Review teaching checkpoint, the user can continue guidance, continue the workflow without guidance, or
  request normal Escape cancellation. Given a later resume, RunWield asks before restoring saved guidance. Guidance,
  shown explanations, and the associated Plan survive execution and repair transcript rollover without becoming workflow
  authority.
- Given Init's placeholder verification command, project-check teaching identifies it as a placeholder and does not
  claim real test coverage.
- Given a failed, paused, user-verified, closed-without-verification, or not-yet-verified workflow, the Tutorial does
  not show a verified recap. Given confirmed RunWield Verified publication, the recap uses the Plan, Work Record, and
  available review or QA artifacts.

**Target: concise project briefing.** Provide compressed project context where useful without flooding every prompt.

**Requirement: Glossary layout does not prescribe architecture.** A project may keep one glossary covering several
contexts or use a map linking separate glossaries where distinct terminology makes that useful. Agents discover model
boundaries from behavior, terminology, and ownership, not file count. Separate glossaries may live with code or in
documentation directories without requiring code reorganization.

**Requirement: Keep edit failures focused.** Failed source and Markdown edits report the underlying error without
automatically appending file contents. Agents can retrieve the relevant source separately when needed.

**Requirement: Batch known code reads efficiently.** Agents can request up to five known source or outline reads
together. Reads of the same kind share one Cymbal invocation, with duplicate targets read once. Results retain request
order and identify individual failures without discarding successful reads. Each result receives an equal share of the
50,000-character response limit, including its heading, status, and truncation notice; a large result cannot hide later
results. Agents can request narrower reads for truncated content.

**Requirement: Report code-query failures accurately.** Failed Cymbal commands and invalid responses are errors, not
successful empty queries. Batch results expose success or failure and truncation for each requested item. The whole
batch is marked failed when every item fails; partial success retains successful results and identifies failed items.

Future code-intelligence work should address demonstrated gaps in finding relevant code, understanding dependencies, or
assessing change impact. Indexing technology belongs in architecture and implementation documents.

**Acceptance scenarios:**

- Given an existing project, when Init completes, the project glossary and saved facts provide terminology and context
  for future work.
- Given one glossary describing several contexts, Agents preserve their distinct meanings without assuming a single
  model or requiring separate files. Given a glossary map, Agents follow its links regardless of code layout.
- When an Agent needs a symbol or related prior decision, it can retrieve relevant project code or memory without
  treating operational memory as a Work Record.
- Given an edit that fails, including in a large file, the Agent receives the error without an automatic source dump and
  can request the relevant code before retrying.
- Given interleaved source and outline requests, the Agent receives results in the requested order using at most one
  Cymbal invocation per kind. A missing source target does not hide successful results in the same batch.
- Given an oversized first result and an error in a later item, both remain visible with their statuses, and the full
  response stays within its limit. Truncation is indicated separately from failure.
- Given a missing Cymbal executable or a batch in which all reads fail, the tool reports failure. A successful empty
  query remains successful.

### Compaction and image context

**Scope and maturity:** Current baseline; linked long-run resilience work remains target scope.

**Requirement: Retain useful conversation and attachment context.**

`/compact` summarizes a growing conversation, optionally using the user's emphasis instructions. Automatic compaction
helps with context pressure. Users see progress, completion, failure, and whether input is needed; Escape cancels it.
Compaction retains the goal, constraints, decisions, progress, relevant file context, and recent activity. Reopening the
Session retains useful context. Saved Named Invocation expansions, including image blocks, remain available to
compaction and later turns even though raw user history keeps the compact invocation. Failed or ineffective compaction
must not strand work or claim completion. Later long-run reliability requirements are in
[Session Context Resilience](session-context-resilience-prd.md).

Vision-capable models receive images directly. With a text-only model, users may select a vision fallback globally or
through a model preset; the preset takes precedence and an unset fallback is disabled. The same provider configuration
and authentication apply. Users see which model will describe the image. Missing or unsuitable fallback configuration
explains how to fix setup while preserving typed text and image previews, including after a model change before Send.

Standalone releases include the image resize worker and its image-processing dependencies. Reading or sending an image
must not print worker-loading errors over the terminal interface or silently disable image resizing.

The Agent can ask `see_image` about a saved Session attachment or an explicitly referenced project image. Descriptions
include readable text, relevant visual state, and uncertainty. Resuming retains attachment access; unrelated Sessions do
not inherit it. Future Session deletion also removes its images. See
[vision fallback settings](../settings.md#visionfallback).

**Acceptance scenarios:**

- When compaction finishes and the Session resumes, its goal, decisions, constraints, saved Named Invocation expansion,
  and useful progress survive; failure or cancellation never claims successful compaction.
- Given a text-only destination model and no suitable vision fallback, when the user tries to send an image or changes
  model before Send, setup guidance preserves the typed message and image preview.
- When the user resumes a Session with saved images, those attachments remain available without exposing images from
  unrelated Sessions.
- Given a standalone release running outside the source checkout, resizing an image produces a valid image within the
  requested dimensions without worker-loading errors or stray terminal output.

### Work records

**Scope and maturity:** Current generation and retrieval baseline; manual/external creation and richer authorship remain
follow-up scope.

**Requirement: Preserve outcomes with truthful completion confidence.**

Work Records are concise, repository-owned Markdown accounts of what completed work produced and what future planning
should remember. They retain meaningful deviations, deferred scope, concrete lessons, source Plan links, Ticket links,
and useful evidence without copying chat, review deliberation, or the original Plan in full. Identity and links survive
renaming; search can be rebuilt from the documents.

- Eligible top-level completed Plans and Epics receive auto-approved records by default. An Epic record summarizes
  relevant children, including deferred and archived work; it does not generate a record for every child.
- Completion labels distinguish RunWield verification, user-attested verification with its note, closure without
  verification with its reason, and done-enough Epic outcomes. Missing historical closure reasons are disclosed rather
  than blocking backfill. Records do not turn unverified work into verified work.
- Generation is best effort. Failure reports a useful retry/backfill action and never reverses a completed Plan.
  Disabling automatic generation leaves listing, reading, search, and explicit backfill available.
- `wld wr` provides listing, search, reading, index rebuild, and backfill. Backfill previews missing records for
  eligible active and archived completed Plans and asks before generation. It avoids duplicating existing linked
  records.
- Older Work Records using a non-empty `Result` section remain readable as summaries without rewriting their files. A
  genuinely invalid existing record stops backfill before generation, identifies the filename and required repair, and
  does not produce a fatal stack trace or silently generate a duplicate.
- Default retrieval includes current approved records. Pending, draft, superseded, and archived records require explicit
  historical or maintenance access and clear notices; they are not settled current guidance.
- Ideator, Planner, and Architect retrieve relevant current records. Guide can inspect historical records with their
  confidence labels; Recorder can inspect them for maintenance. Execution primarily uses the approved Plan context.
- Minor corrections can update a record. A later record may replace an earlier account through a user-confirmed
  relation, including a declaration in an approved Plan. A suggestion alone does not hide the earlier record. Archival
  and restoration preserve the record and its completion meaning.
- No-plan QUICK_FIX and ordinary external merges do not generate records automatically. Explicit manual or external
  record creation remains separate scope and requires review before default retrieval; it cannot claim RunWield
  validation that did not occur.

Core retrieval is Project-scoped. Cross-Project knowledge and browser navigation are Workspace requirements. Richer
cross-artifact authorship, manual/imported record creation, and guidance for substantial retrospective edits remain
follow-up product questions.

**Target: explicit external provenance.** A maintainer may explicitly record substantial externally contributed work,
including the source change, contributor, reviewing maintainer, and validation that actually ran. These records are
opt-in and cannot claim RunWield validation. No merge is required to have a Plan or Work Record: Git owns commit-level
history, and RunWield-owned merges should clearly point back to their Plans. Optional record review, historical
compression/reorganization without changing source Plans, and richer authorship remain separately labeled follow-up
scope.

**Acceptance scenarios:**

- Given an eligible completed top-level Plan, when recording succeeds, the record links its source and accurately labels
  how completion was established.
- When generation fails or is disabled, completed work remains intact and explicit backfill stays available without
  duplicating an existing record.
- When planning searches current records, superseded or unapproved material is excluded by default; an explicit
  historical view labels its confidence.
- Given a newer similar record, when replacement is only suggested, the earlier record remains current until the user
  confirms supersession.

<a id="71-agent-definitions"></a>
<a id="72-tool-policy"></a>
<a id="73-skills"></a>
<a id="74-future--open"></a>

### Agent and skill customization

**Scope and maturity:** Current baseline. New specialization proposals follow the project’s document conventions. The
remote personal-resource mount and direct personal Skill file edits have bounded proof on the approved Linux `sct`
pilot; ordinary remote Session customization remains target behavior.

**Requirement: Keep personal files on the laptop during a remote connection.** The approved Linux `sct` pilot mounts
laptop `~/.wld` at a private remote root through stock SFTP/SSHFS; the remote project's `.wld` stays remote. This is
direct trusted-host access, not a copy or a confinement boundary. A normal connection still does not accept user turns.

**Current bounded acceptance scenario:** Given a personal Skill file and a remote project `.wld`, when the personal file
changes through the mount, the laptop sees it; a laptop edit is also visible through the mount, while project `.wld`
remains on the server. This does not establish an ordinary remote Session's resource precedence.

**Requirement: Respect user customization while retaining workflow capabilities.**

Bundled Agents include:

- Router
- Guide
- Ideator
- Operator
- Planner
- Architect
- Engineer
- Frontend Engineer
- Recorder
- Tester
- workflow-only Slicer
- workflow-only Reviewer
- init pseudo-Agent

Agent definitions are markdown files with YAML front matter. Definitions are layered:

1. local project overrides: `./.wld/agents/<agent>.md`
2. home overrides: `~/.wld/agents/<agent>.md`
3. bundled defaults: `src/agent-definitions/<agent>.md`

Scalar front matter overrides by precedence. Prompt bodies append by default unless `promptOverride: true` is set.

**Required tools.**

Users can customize Agent tools, while required workflow capabilities remain available so customization does not break
planning or validation. Guide may save ordinary Markdown documents when explicitly requested in the conversation; this
does not grant authority to change workflow-owned Plans, ADRs, or Work Records.

**Skills and integrations.**

Core uses one Skill catalog for listing, model advertising, and invocation. It selects skills in this order:

1. project `.wld/skills`
2. project `.agents/skills`
3. home `~/.wld/skills`
4. home `~/.agents/skills`
5. bundled skills

Skills in either `.agents` folder cannot use a bundled published name or directory alias. Project and home `.wld` skills
can intentionally replace bundled skills. When external skills are disabled, Core omits both `.agents` folders and uses
project `.wld`, home `.wld`, then bundled skills. Pi-discovered, configured, extension, and package skills do not form a
second catalog.

**Requirement: User-invoked change review is available on install.** The bundled MIT `review` Skill lets a user review
PRs and other selected changes against project standards and the requested behavior. It is separate from the workflow
Reviewer, which judges implementation against an Approved Plan. The bundled Skill keeps the portable instructions and
support files available without a separate install.

Slash-command skill invocation injects full Skill instructions only when needed and does not change the Agent profile.
Prompt Template and Skill expansions reach the active model with the current Agent instructions and tools. The exact
saved expansion remains available after a follow-up, compaction, or resume. Prompt Templates display rendered content;
Skills retain their compact invocation. Built-in command names and aliases take precedence over prompt templates and
Skills on all surfaces, including built-ins unavailable on that surface.

**Requirement: Prompt Templates behave as typed messages with optional Session settings.**

Core renders a Prompt Template and submits it through the ordinary user-message path, with ordinary tools, workflow
transitions, validation, and compaction. Its optional Agent, provider/model, and thinking settings persist for
follow-ups and resume. Omitted settings inherit the current Session. A new Session without explicit selections uses
Operator and its configured model/thinking level. Changing Agent loads that Agent's defaults before explicit template
overrides. Invalid settings fail before message submission.

A template requesting a different Agent during an unfinished workflow offers **Open in new session** or **Cancel**. This
includes planning before a Plan exists and execution/review/recovery waiting for user input. Opening a new Session runs
the template there and preserves the original workflow Session for resume. Cancellation sends nothing and preserves
settings and workflow state. Clients unable to present the choice explain how to run the template in a new Session.
Model/thinking changes alone retain workflow ownership. Templates have no isolated turn or automatic return to a prior
Agent. The rendered message is visible in chat; Core retains the original invocation and exact expansion for history.

Engineer can ask structured questions with `user_interview` and drives the bundled `/release` prompt. Release choices
use the current client's structured question interface where supported, including Workspace, before any release
commands.

CLI tools remain preferred for many integrations. MCP is optional and should not add unused prompt context.
Configuration and loading details belong in [customization documentation](../customization.md).

**Remote target:** [Local personal environment](remote-ssh-prd.md#local-personal-environment) specifies direct access to
laptop `~/.wld` at a fresh private remote mount path, with project `.wld` remaining remote. Personal Agent, prompt, and
Skill file edits change laptop files directly; there is no copy, sync, or special resource-save operation. A private
mount path is not confinement of trusted remote users. This target is not yet a delivered Session.

**Acceptance scenarios:**

- When a user customizes an Agent at project scope, those choices take precedence over home and bundled settings while
  required workflow capabilities remain available.
- When a user invokes a Skill or Prompt Template, its full saved expansion reaches the active model and remains
  available to follow-up and resume. Templates display their rendered message; Skills retain their compact command.
- After installation, `/skill:review` is listed and invokes the portable review instructions and support files for a
  user-selected PR or change. It does not replace the Plan workflow Reviewer.
- Given a non-bundled Skill in project `.agents/skills`, listing, model advertising, and invocation select that project
  file before home customization.
- Given an `.agents` Skill whose published name or directory alias conflicts with a bundled Skill, listing, model
  advertising, and invocation exclude the external copy. A project or home `.wld` Skill with that name can intentionally
  replace the bundled Skill.
- When `enableExternalSkills` is false, neither `.agents` folder participates, while project and home `.wld` Skills and
  bundled Skills remain available.
- Invoking `wld /commit` without template front matter or explicit Session selections uses Operator's configured model
  and thinking level; ordinary follow-ups retain those settings.
- Invoking a template with omitted settings in an existing Session retains its selected Agent/model/thinking level.
  Explicit template settings override the corresponding selections and remain active after resume.
- Invoking `/release` while Planner is discussing a change, before a Plan exists, offers a new Session or cancellation.
  Opening runs with Engineer in the new Session; the original planning conversation remains resumable. Canceling sends
  no expanded message and changes no Agent or settings.
- Invoking a template that retains the active workflow Agent can use that Agent's normal workflow tools. A model or
  thinking override alone does not create another Session or bypass validation.
- Invoking a template with invalid execution settings reports the problem before a user-message event or model call.
- Invoking `/release` from a Router Session presents the release-operation choices as a structured interview on clients
  that support forms; canceling the interview does not start a release.
- **Remote target, not yet delivered:** Given a trusted remote connection with a private mount of laptop `~/.wld`, when
  the user edits a personal Skill file, the laptop file changes directly without a resource copy or sync; a project
  `.wld` override stays on the server.

<a id="8-models-and-providers"></a>

### Models and providers

**Scope and maturity:** Current baseline with explicitly labeled future tuning questions. Remote model execution from an
ordinary remote Session is target behavior. The connection-only view accepts no user turns; an optional native Pi bridge
proof uses a synthetic HTTP provider through the laptop service.

**Requirement: Change models without losing Session or workflow context.**

Users can choose models and providers without changing Session ownership or workflow behavior. The selected model and
its requirements should be visible and consistent across RunWield clients.

Current requirements:

- store RunWield model/auth config under RunWield-owned settings paths
- migrate older Pi config once when useful
- support user-selected model overrides
- support Agent/default/provider model resolution rules
- when Validation Repair Engineer has no configured model or thinking level, use Engineer's configured value before the
  default chain
- support Pi/API-authenticated model Execution Backends through configured providers
- support `claude-cli/sonnet`, `claude-cli/opus`, `claude-cli/haiku`, and `claude-cli/fable` as Claude CLI Core
  Execution Backend aliases
- support Antigravity CLI model selection using an existing Antigravity sign-in
- support OpenAI-compatible provider discovery through `/models`
- support local/custom providers through `models.json`
- support vision fallback configuration for pasted images when the active model is text-only
- keep Pi automatic prompt-cache warming off so RunWield does not add warming requests or charges; a user-facing warming
  setting remains deferred

**Remote boundary and target:** The [Remote SSH proposal](remote-ssh-prd.md#local-personal-environment) keeps
authenticated model requests, credentials, provider callbacks, and renewal in the laptop runtime while remote project
tools execute on the server. On the approved built macOS/Linux `sct` pilot, an optional native Pi proof sent two
synthetic HTTP provider requests; the second contained a remote-only tool result, cancellation closed the upstream
request, and two reconnects completed the bounded path. This is not proof of an authenticated production provider or an
ordinary remote user turn. The active full laptop `.wld` mount can expose credential files through broad standard SFTP
access; local model execution is not filesystem confinement. Ordinary remote Agent support remains target behavior.

**Remote target acceptance scenario (not yet delivered):** Given a Pi provider authenticated only on the laptop, when a
remote Agent uses the model after a remote project tool result, the laptop runtime sends the authenticated request
without a second sign-in or a model substitution. The trusted server can still access laptop-account files via SFTP;
this is not confinement.

**Requirement: Recover from temporary model-service failures.**

For Pi-backed model requests, retry temporary connection, rate-limit, and server failures, including an interrupted
response reported as `Unexpected EOF`. Use the existing [retry settings](../settings.md#retry): by default, three
retries after the first request, with waits of 2, 4, and 8 seconds. Keep partial output and diagnostic evidence from a
failed attempt, but do not repeat completed tools or include failed attempts in the next model request. Show clear
notices for failures, scheduled retries, and exhausted retries without exposing raw response bodies or stack traces.
Saved history shows a neutral failure notice, not a live countdown or a claim that the Session still failed. Do not
automatically retry authentication, quota, invalid-request, or context-overflow failures. Cancellation stops retries
without an API-failure or exhaustion notice.

When automatic retries run out, state how many retries completed and how the user can try again. This stops the current
model attempt, not the Session or its saved work. [Session continuity](#session-continuity) owns history and safe
resumption. [Execution, validation, and recovery](#execution-validation-and-recovery) owns delivery workflow recovery;
provider retry exhaustion does not change its completion or abandonment policy. Wider automatic recovery gaps remain
part of that capability's target, not a promise that every path is already repaired.

Claude CLI is a Core Execution Backend: RunWield shells out to Claude Code from inside a RunWield Session, while
RunWield remains the Session Transcript, workflow, resume, and replay authority. Setup requires installing the Claude
Code CLI and signing in with Claude Code; it does not require a RunWield API-key or subscription login. Missing
executable or authentication state is reported by the first-turn backend preflight, not by provider credential
onboarding.

Users need an honest account of what activity a backend can display and replay. Backend coverage and implementation gaps
belong in its technical documentation and Plans. RunWield Connect is the separate mode where an external host, such as
Claude Code, owns the conversation and model calls.

Antigravity CLI users can select the supported Flash and Pro model families and their thinking level from normal model
controls. Setup uses their installed CLI and existing sign-in. Unsupported selections and attachments explain what must
change before a turn starts. Session history shows the selected model, thinking level, and Antigravity backend
independently of unsent composer changes. Replay includes assistant messages and RunWield tool activity; the CLI's
internal activity is not available in RunWield history. Configuration details are in
[Settings](../settings.md#antigravity-cli). RunWield supplies the active working directory as the backend workspace so
normal project file access does not fail because a noninteractive CLI opened without a workspace. Genuine permission
failures identify the denied action and, when supplied by the CLI, the file target, with sensitive details redacted. The
failure appears once in live Sessions and remains available in replay; it does not discard the pending request.

Future/open requirements:

- keep provider-specific prompt or temperature tuning only where it materially improves behavior
- document realistic provider support in terms of current Pi/RunWield config rather than a static vendor checklist

**Acceptance scenarios:**

- When the user changes a model, the Session and workflow remain the same and the selected model is visible across
  clients.
- Given a Pi-backed response interrupted by `Unexpected EOF`, when a later attempt succeeds, RunWield waits and retries
  under the configured policy. The user sees the interruption and retry progress, then the answer without repeating
  completed tools.
- Given a temporary failure persists through all configured retries, the final notice states the completed retry count
  and that the user can try again. Saved history remains available; replay shows a neutral notice, not a live countdown.
- Given the user cancels during a failed request or its retry wait, no further request starts and no API-failure or
  exhaustion notice appears.
- Given an authentication, quota, invalid-request, or context-overflow failure, RunWield gives a clear, relevant notice
  without retrying the same request automatically.
- Given no cache-warming setting or an existing Pi value of `streaming` or `idle`, RunWield sends no automatic warming
  request and does not rewrite the stored value.
- Given Validation Repair Engineer with no configured model or thinking level, when Engineer has those values
  configured, repair uses Engineer's values before default settings without changing the Session or workflow.
- Given a CLI backend without its required executable or sign-in, when the first turn is attempted, the user receives
  the backend-specific setup action instead of unrelated provider-login instructions.
- When a backend cannot replay its internal activity, history distinguishes visible RunWield activity from unavailable
  backend internals.
- Given an Antigravity turn in a project or execution worktree, reading a file there uses that directory's workspace
  access without requiring a global permission bypass.
- Given an Antigravity result with exit code zero, an empty response, and a denied action, the turn fails with an
  actionable notice shown once in TUI and Workspace. Replay retains the notice and the external conversation ID when
  supplied, without saving raw commands or tool output.

### Installation and updates

**Scope and maturity:** Current Candidate release isolation and shell installation baseline. Prepared Homebrew and
Windows WinGet support; public package availability is pending owner publication/submission. Remote development runtime
preparation is a connection-only development-build subset, not a qualified production release.

**Requirement: Prepare only a matching remote development runtime.**

For the current `wld remote` connection view, build the launcher and Linux artifacts explicitly from the same unchanged
checkout and compiler (Deno 2.9.3 or newer). A connection never compiles on demand or substitutes a released binary for
a missing development artifact. The launcher verifies matching build/protocol identity, human-readable `VERSION`, and
artifact checksum, then privately stages and preflights the executable on the remote host. An interrupted stage is
repaired on a later connection. It does not run the personal installer, change the remote profile or a package-managed
installation, or start a personal profile.

```sh
export ASTRO_KEY="$(openssl rand -base64 32)" # Keep this value private and unchanged for this artifact set.
deno run -A scripts/compile.js --output bin/wld
BUILD_ID=$(deno eval 'console.log(JSON.parse(await Deno.readTextFile("bin/wld.build.json")).buildId)')
deno run -A scripts/compile.js --target x86_64-unknown-linux-gnu --output bin/wld-linux-x64 --expect-build-id "$BUILD_ID"
deno run -A scripts/compile.js --target aarch64-unknown-linux-gnu --output bin/wld-linux-arm64 --expect-build-id "$BUILD_ID"
deno run -A scripts/release-assets.js development bin/wld bin/wld-linux-x64 bin/wld-linux-arm64 bin/remote-build
```

Use `bin/remote-build/wld-launcher` with its adjacent Linux GNU target files and `.build.json` files. The current remote
host needs an OpenSSH server that can allocate a terminal and forward loopback ports, `python3`, a writable private
cache, SSHFS/FUSE for the personal mount, and a runnable glibc-linked Linux x86-64 or ARM64 executable. Git is optional
for a non-Git directory. The approved Linux `sct` pilot starts a stock SFTP/SSHFS personal mount before showing the
dormant view. These steps do not prepare guarded Session access or production release assets; see the
[Remote SSH proposal](remote-ssh-prd.md#remote-connection-and-setup).

**Acceptance scenarios:**

- Given a matching development bundle and a supported remote Linux host, connecting transfers or reuses a verified
  executable, mounts the laptop personal root on the approved `sct` pilot, and opens only the connection view; it does
  not initialize a remote personal profile.
- Given a missing or mismatched artifact, incompatible executable, or missing remote prerequisite, connection fails with
  the cause rather than compiling, using another version, or starting a Session. A later attempt can repair an
  interrupted private staging file without overwriting a package-managed install.

**Requirement: Isolate Candidate stabilization from ongoing feature work.**

For each new release series, maintainers can cut RC1 from an explicitly confirmed commit and stabilize later Candidates
on that series' Release Branch. Later Candidates use pushed release fixes without including unrelated feature work that
continued on `main`. Review controls which changes qualify as release fixes. Stable promotion uses the exact selected
Candidate.

**Acceptance scenarios:**

- Given RC1 for a new version, when the maintainer confirms Candidate creation, the Candidate tag and new Release Branch
  identify the same committed source without including uncommitted files.
- Given feature work continued on `main` after RC1 and a fix was pushed to the Release Branch, when the maintainer
  creates the next Candidate, it includes the fix, excludes the later feature work, and leaves the maintainer's checkout
  unchanged.
- Given a tested Candidate and a Release Branch that has advanced, when the maintainer promotes that Candidate, Stable
  uses the tested Candidate commit rather than the newer branch tip.

Upgrades that change project runtime layout follow [Work protection](#work-protection). Installation must not bypass
safe adoption or blocked-layout preservation.

**Requirement: Qualify release packages before publication and preserve published bytes.**

Candidate and Stable releases must pass native Windows and macOS Homebrew package checks before GitHub publication.
Candidate checks must not update Stable package channels. A packaging recovery must keep the released tag and asset
bytes unchanged, verify the existing asset set, and resume package publication without rebuilding published binaries.
Missing or inconsistent release assets must stop publication rather than cause a silent replacement. Native Homebrew
checks use a supported runner with available dependency bottles, show command progress while work runs, and have a
bounded job duration. A timeout blocks publication; it does not waive installation checks.

**Acceptance scenarios:**

- Given a package check fails for a new Candidate or Stable, no GitHub Release is created.
- Given a native Homebrew check serves Candidate or Stable assets from localhost before publication, the formula and
  installed ownership metadata retain the release version, not a number inferred from the archive architecture.
- Given a slow Homebrew command, its output is visible before it exits. If the job reaches its time limit, publication
  remains blocked and the log identifies the command in progress.
- Given Stable assets are published but tap publication fails, recovery verifies and reuses those assets and leaves the
  tag unchanged.
- Given duplicate asset names, missing required assets, or checksum disagreement, publication stops before upload.

**Requirement: Install required local runtime pieces without hiding package ownership.**

Users can install RunWield as a standalone binary with the shell installer or, after owner publication, with the
`gandazgul/homebrew-tap` macOS tap and the `Gandazgul.RunWield` WinGet package for Windows x64. A package-managed
install must not be overwritten by `wld update`.

Homebrew requirements:

- provide `gandazgul/tap/wld` for macOS Apple Silicon and Intel
- provide independent `gandazgul/tap/mnemoteca`
- use package dependencies for Mnemoteca, Cymbal, Ketch (from Homebrew Core), agent-browser, and Git
- keep Mnemoteca model setup and browser setup as first-use actions
- store package-owner metadata beside the installed executable
- make `wld update` and `wld upgrade` print the package-manager command for package-managed installs
- keep Candidate and exact-version shell-installer options unavailable for Stable package-managed installs
- keep public install docs marked pending until the owner publishes the tap

Windows WinGet requirements:

- provide Windows x64 ZIP assets with `wld.exe`, package metadata, helper executables, and license notices
- use pinned helper URLs and SHA-256 values; no install-time `latest` or global npm install
- declare Git for Windows as a package dependency
- expose private bundled helpers to RunWield and child processes without editing global `PATH`
- keep model and browser payload downloads in per-user first-use locations
- make `wld update` and `wld upgrade` print `winget upgrade --id Gandazgul.RunWield --exact`
- reject Candidate tags for Stable WinGet manifest generation and external submission
- submit each Stable manifest to `microsoft/winget-pkgs` from the release workflow with a repository secret
- keep public install docs marked pending until Microsoft accepts the listing

**Acceptance scenarios:**

- Given a new Homebrew install, when dependencies resolve, Ketch comes from Homebrew Core without the retired
  `1broseidon/tap/ketch` formula. Native package checks must pass before publication.
- Given a Homebrew-owned `wld`, when the user runs `wld update`, RunWield prints `brew upgrade gandazgul/tap/wld` and
  does not run the shell installer.
- Given a WinGet-owned `wld`, when the user runs `wld update`, RunWield prints
  `winget upgrade --id Gandazgul.RunWield --exact` and does not run the shell installer.
- Given a Stable release, when its Windows package and manifest jobs pass, the release workflow submits a PR to
  `microsoft/winget-pkgs`; given a Candidate release, it does not submit one.
- Given a standalone Unix install, when the user runs `wld update`, RunWield can still use the tag-pinned shell
  installer.
- Given a loose native Windows executable without package metadata, when the user runs `wld update`, RunWield gives
  Windows package/release guidance and does not invoke Bash.
- Given missing helpers in a package-owned install, RunWield tells the user to repair packages instead of piping the
  shell installer.
- Given prepared but unpublished package output, public docs distinguish preparation from public availability.

<a id="91-current"></a>
<a id="92-future--open"></a>

### Work protection

**Scope and maturity:** Current baseline; additional command and governance controls remain open questions.

**Requirement: Enter project runtime state before use.**

Core enters project runtime state before normal project-local runtime reads, locks, or writes. RunWield 0.11 performs a
one-way adoption of eligible 0.10 state. Entry adopts eligible legacy state or refuses unsafe layouts with a retryable
reason and safe paths. Refusal stops normal writes and preserves user work. After adoption, downgrade or concurrent use
with 0.10 is not supported. See [ADR-017](../adr/017-project-runtime-state-under-wld-internal.md).

**Requirement: Keep Project Runtime State out of repository changes.**

The managed `.gitignore` block contains only `.wld/internal/`. User `.wld/settings.json`, `.wld/agents/`,
`.wld/skills/`, and `.wld/prompts/` remain normal repository content. If Git already tracks or stages runtime state,
Core refuses checkpoint or publication and reports safe cleanup paths instead of deleting files, changing the index, or
rewriting history. Core preserves and reports a broad user-authored `.wld/` ignore rule because it also hides trackable
configuration. During a long-running process, unchanged ignore warnings appear once per Project and identify its
`.gitignore` path. Routine reads continue checking the rules without repeating the warning; a changed warning, or one
reintroduced after a successful check found it resolved, is reported again. Explicit doctor inspections still report all
current issues.

**Requirement: Preserve user work and require deliberate destructive actions.**

Users retain control of their work through reviewed intent, isolated planned execution, recoverable baselines,
validation, independent review, optional human review, and delivery checks. Dangerous shell actions need guardrails that
respect the user’s permissions and project instructions. Local browser access stays private by default; shared review
uses explicit access and coordinated revisions.

Worktree directories, branches, and Plan files may contain user work. Automatic cleanup requires evidence that nothing
can be lost; otherwise deletion or disposal requires explicit user consent. Unclaimed worktrees are presumed to contain
work worth preserving. Deliberate workflow abandonment is not blanket permission to destroy those contents. Settled
internal journals, stale locks, and obsolete internal records with no work content are RunWield's to clean up
automatically as part of [workflow recovery](#execution-validation-and-recovery).

Open product questions:

- When does requiring a clean checkout protect user work enough to justify interrupting execution?
- What additional controls over dangerous commands do users need beyond their existing project instructions?
- Is architecture governance useful as a dedicated workflow or as an optional policy?

**Acceptance scenarios:**

- Given untracked Project Runtime State and changed user `.wld` configuration, when execution checkpoints or publishes,
  runtime state stays out of commits and user configuration can be committed.
- Given runtime state already tracked, staged, deleted, renamed, or present in newly published history, when Core tries
  to checkpoint or publish, it refuses with safe paths and preserves the worktree, index, files, and target refs.
- Given a broad `.wld/` ignore rule, when Core reconciles ignore rules, it leaves the rule in place and reports that it
  hides settings, Agents, Skills, and prompts.
- Given eligible 0.10 runtime state, when Doctor checks the project, it reports pending adoption without locks,
  migration, ignore writes, controller imports, catalog backfills, journal cleanup, or project-local Git fetches.
- Given the same eligible state, when Doctor repairs it, guarded Project Runtime Entry adopts it once before normal
  diagnostics run.
- Given unfinished 0.10 publication or a saved repair, project entry adopts the bookkeeping without moving publication
  copies, changing their receipts, or discarding repairs. Load Plan opens normally and publication can resume. Retained
  staging copies remain Git-ignored. Checking with Doctor stays read-only and reports pending adoption.
- Given an unsafe 0.10 layout, when Doctor checks or repairs, it preserves all named paths and explains the specific
  conflict. Unfinished publication alone is not an unsafe layout.
- Given a repository with ordinary file or directory symlinks, when Core publishes and retries delivery, it preserves
  the links as Git content and still rejects symlinked runtime roots or publication checkout boundaries.
- Given one legacy project collaboration secret in a linked checkout, when Core enters that checkout, it adopts the
  secret into the primary internal store and collaboration commands can use it. Multiple populated stores cause a
  non-destructive conflict.
- Given Git tracks an old or current collaboration secret or its atomic temporary file, when Doctor reports the refusal,
  it names only the path and explains untracking, history removal, and capability rotation without printing secret
  bytes.
- Given a populated project-local fallback worktree directory, when Core enters the project, it preserves the worktree,
  registry, Git refs, and files and refuses adoption instead of moving them.
- When recovery would reset working changes or delete unmerged work, the user must confirm the destructive action.
- When a local browser surface is opened, it does not silently authorize other users or broaden project access.
- Given an unclaimed worktree, when cleanup runs without proof its contents are disposable, the worktree remains
  preserved until the user decides; settled bookkeeping with no user content is cleaned automatically.

<a id="101-shared-session-experience"></a>
<a id="102-personal-remote-workspace-coordination-requirements"></a>

### Session continuity

**Scope and maturity:** Current shared Session baseline; reliable end-to-end continuation remains required wherever gaps
exist.

**Requirement: Continue the same saved work across clients.**

Users can work with multiple independent Sessions through the TUI, ACP, and Workspace. Each Session retains its project,
conversation, selected Agent and model, and workflow context. Starting, loading, sending, cancelling, and reviewing
history should behave consistently across clients.

Runtime boundaries are documented in [ADR-010](../adr/010-session-runtime-sibling-adapters-and-acp.md).

Personal Workspace lets the same developer move between TUI, browser, and ACP while keeping one Session, its history,
and the selected Agent and model. The user can leave an idle TUI open, continue from a phone, and return to see the new
conversation. Opening a Session does not reserve it for that screen.

Required outcomes:

- new Sessions appear in history after the first submitted message, not from opening an empty composer;
- the owner can reopen and continue saved Sessions without a migration ceremony or Workspace registration for local use;
- open surfaces update when another surface saves work, while preserving unsent drafts;
- a long conversation or completed Plan does not by itself disable the next user message;
- retrying a request after a connection failure does not submit the same work twice;
- automatic workflow and repair handoffs retain the original request as context without emitting it as a new user
  message;
- leaving or reloading the browser does not cancel running work;
- after a process failure, saved history remains available and the user receives a clear next action without silent
  repetition of unfinished work;
- Plan review and execution use the current Plan and preserve the user's explicit approval choices;
- the most recent Plan review can be requested again from its Session after a review has settled, but the saved
  reference never restores an unanswered interaction or authorizes work on its own;
- saved Named Invocation expansions continue through follow-up, compaction, and resume without replaying earlier tools
  or actions;
- rebuilding Workspace registration or pairing does not prevent TUI or ACP from using intact local Sessions;
- TUI Tutorial guidance state survives execution and semantic-repair transcript rollover without becoming workflow
  lifecycle authority. Workspace-native Tutorial controls remain deferred.

The file storage, operation-scoped writer lock, transcript segments, and synchronization design live in
[ADR-015](../adr/015-file-authoritative-session-bundles.md). These mechanisms implement the outcomes above; they do not
create additional product restrictions on which screen the owner may use.

**Requirement: Route attention to the latest user-input surface.**

Notification destination follows the latest accepted user input (TUI, Workspace, or ACP), independently of which process
executes the turn. Sending a message, steering, queueing a follow-up, or answering an interaction changes the
destination; opening a Session, reconnecting an observer, rejected input, and automated continuation do not.
Workspace-originated turns always emit an Agent-stop attention event at settlement, including error and previously
suppressed workflow exits. Delivery still honors the destination's permission and notification settings. ACP continues
to expose turn completion through its client protocol; browser and terminal alerts must not duplicate it on another
surface.

**Acceptance scenarios:**

- Given a fresh empty composer, when the user opens it without submitting work, no project runtime state is created; the
  first submitted work enters the project runtime.
- When validation starts another repair, observers see the repair activity without a second copy of the user's original
  request. Workflow reports keep their call identity across live delivery and saved replay.
- Given an idle open TUI, when its owner sends the next message from a phone, the same Session continues and the TUI
  updates when the owner returns.
- When a browser reloads or a completed Plan receives a follow-up, saved history remains usable and unsent drafts
  survive; an open screen is not exclusive ownership.
- Given a saved Prompt Template or Skill invocation, when the owner resumes and sends a follow-up, the model receives
  the saved expansion and no earlier tool or workflow action runs again.
- When a connection retry repeats the same submission, it does not start duplicate work; process loss leaves history and
  an actionable recovery choice.
- When Workspace registration is rebuilt, intact local Sessions remain available through TUI and ACP.
- Given a review that has ended or whose owner process has exited, when the owner returns to the saved Session and
  requests `/plan-review`, RunWield checks the saved Plan before starting a new review; it does not resume the old
  unanswered interaction or infer an approval.
- Given a Tutorial-enabled Session, when work pauses, reloads, or rolls into execution or semantic repair, TUI guidance
  resumes from committed Session context without repeating explanations, discovery, implementation, or publication.
  Choosing ordinary continuation keeps guidance off while preserving the Plan and workflow.

### Capability-organized product requirements

**Scope and maturity:** Agreed requirement; bundled authoring guidance is updated with this change. This does not
certify model compliance.

**Requirement: Write and maintain observable requirements within the user’s PRDs.**

Ideator, Planner, and Architect use a project's PRDs to describe capabilities through named observable requirements and
representative acceptance scenarios. They respect the user's existing document structure and distinguish current,
target, and deferred behavior. Shared requirements retain one owner; Plans and Epics reference them and carry the
verification and document updates needed by changed behavior. RunWield does not impose its own product names or five-PRD
layout on other projects or require a new PRD for every bounded fix.

PRDs retain user needs, outcomes, and scope; ADRs own architectural decisions; Plans own implementation; Work Records
retain delivery evidence. Scenarios guide verification but do not claim executable test coverage.

**Acceptance scenarios:**

- Given a user project with one existing PRD, when Ideator synthesizes an agreed feature, it uses capability
  requirements and scenarios within that convention without creating RunWield-named product documents.
- Given a changed capability, when Planner or Architect prepares work, it links the owner, preserves unaffected
  behavior, and includes verification and PRD synchronization in the appropriate implementation scope.
- Given an unimplemented proposal, when an Agent revises its PRD, the behavior stays labeled target rather than being
  presented as shipped.

<a id="4-current-local-workspace-surface"></a>
<a id="5-current-collaborative-planning-surface"></a>

## Browser and shared-review requirements

Core includes the local browser client launched by `wld plans ui` and the CLI actions for Shared Plan collaboration. The
[Workspace local Plan management capability](runwield-workspace-prd.md#local-plan-management) and
[shared Plan collaboration capability](runwield-workspace-prd.md#shared-plan-collaboration) own those surface-specific
requirements. They use Core's [Plan lifecycle](#plan-lifecycle), [Plan review](#plan-review), and
[execution and recovery](#execution-validation-and-recovery) without redefining them. Local use remains available
without hosted Workspace.

## Delivery and Architectural References

Core remains usable locally without hosted Workspace. Personal Remote Workspace adds convenient access to the same work
from another device. Hosted collaboration and broader code-intelligence improvements remain separate follow-up scope.

- [Session architecture](../adr/015-file-authoritative-session-bundles.md)
- [Transcript handoffs](../adr/012-segment-session-transcripts-at-execution-handoff.md)
- [ACP compatibility](runwield-acp-protocol-prd.md) and [implementation details](../acp-implementation-details.md)
- [Workspace requirements](runwield-workspace-prd.md) and
  [continuation readiness Plan](../plans/workspace-session-continuation-readiness.md)

## Success Metrics

Current Core metrics:

- Router produces correct Routing Intent without excessive exploration.
- Plans reach review quickly and with enough context for approval.
- Approved Plans complete validation and delivery with accurate, distinct outcomes.
- Recovery paths preserve enough state to continue safely after failed execution, validation, or merge-back.
- QUICK_FIX runs remain bounded and validate mechanically without unnecessary Plan ceremony.
- Local Workspace manages Plans without corrupting front matter or bypassing lifecycle rules.

Acceptance is defined with each capability, especially [Session continuity](#session-continuity). Outcome measurement
does not replace those journeys.

[Mnemoteca]: https://github.com/gandazgul/mnemoteca
