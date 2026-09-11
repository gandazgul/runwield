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
  owns the current topic unless the user explicitly starts fresh or returns to Router.
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
- [Work protection](#work-protection)
- [Session continuity](#session-continuity)
- [Capability-organized product requirements](#capability-organized-product-requirements)

<a id="31-tui-shell-and-root-agent-behavior"></a>

### TUI conversation

**Scope and maturity:** Current baseline.

**Requirement: Keep follow-ups with their active specialist.**

The TUI is currently the primary interactive Core client. It starts a session, renders the conversation, hosts slash
commands, and displays workflow/tool progress.

New sessions start with the **Router** Agent.

After Router hands off to Guide, Ideator, Operator, Planner, Architect, Engineer, or another specialist, that specialist
remains the active root Agent. This keeps follow-up messages in useful context.

Users can:

- use `/new` to start a fresh routed session
- use `/agent router` to route the next message in the same session
- use `/resume` for chat-session resume
- use `/load-plan <plan>` for Plan workflow resume

**Acceptance scenarios:**

- Given a new conversation, when the user submits a request, Router handles initial triage; after a specialist handoff,
  follow-up messages stay with that specialist.
- Given an existing topic, when the user chooses `/new`, a fresh routed conversation opens; `/agent router` instead
  routes within the same Session.

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
execution or decomposition; a Plan needing repair explains what prevents it from proceeding.

**Acceptance scenarios:**

- Given a saved Plan, when the user submits feedback, the planning conversation receives it and can revise the Plan
  before execution.
- When the user approves for later, work does not start; when they approve and run, readiness is checked before the
  appropriate execution or decomposition proceeds.
- When the user cancels review or readiness fails, the UI explains the next action without treating Agent prose as
  approval.

### Plan authoring and external adoption

**Scope and maturity:** Standing product requirements; implementation details belong in the
[Plan lifecycle reference](../plan-lifecycle.md#plan-body-ownership-and-external-adoption).

**Requirement: The user owns the Plan body.**

Users can edit Plan prose with any tool, at any time. The body does not need to satisfy a RunWield document parser.
RunWield owns its lifecycle metadata and must preserve the user's current body during metadata repair, transition
failure, or rollback. A metadata problem must never be blamed on the user's prose. Saving content must protect edits
made since that content was opened; protecting those edits is separate from deciding whether metadata can advance.
Actual changes to the intended work still follow normal Plan review and approval.

**Requirement: External Markdown Plans are first-class.**

A plain Markdown file in `docs/plans/` is a valid draft even without RunWield metadata. Listing, browsing, or inspecting
it leaves its bytes unchanged and does not label missing metadata as corruption. Deliberate `/load-plan` adoption adds
the required identity and defaults while preserving the body and the file's original age. Loading an adopted Plan again
does not reset its lifecycle or decisions.

**Acceptance scenarios:**

- Given an externally written Plan without metadata, when the user opens a listing or board, it remains readable and
  unchanged; deliberate loading then adopts it without changing its prose.
- Given a user body edit made during a metadata transition, when that transition fails or rolls back, the latest body
  remains intact.
- Given malformed lifecycle metadata, when recovery runs, RunWield repairs its own state rather than rejecting the
  user's prose or requiring the user to edit internal fields.
- Given an already adopted Plan, when it is loaded again, its age, identity, and lifecycle decisions remain intact.

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

That attestation does not establish publication or automatically conclude an undelivered workflow. A delivery workflow
has only two conclusions: successful publication or the user's deliberate choice to abandon it. Failed checks, internal
inconsistencies, exhausted automatic attempts, waiting for a decision, cancellation of a turn, and hold are recoverable
intermediate conditions. A technical status or a helpful error message does not turn any of them into a conclusion.
Marking an Epic done enough is an explicit choice to end the remaining Epic scope; it does not claim its unfinished
children shipped or authorize deleting their work.

**Acceptance scenarios:**

- Given implemented work whose delivery failed, when the user views the Plan, validation and publication remain distinct
  and a recovery action is available.
- When the user marks a Plan User Verified with a note, dependency and Epic completion checks accept that outcome while
  every presentation distinguishes it from RunWield verification.
- When the user closes without verification, the Plan records that outcome without claiming checks passed.
- Given an unpublished workflow, when the user only records a verification note or cancels a turn, the workflow is not
  silently abandoned or reported as published.

### Epic decomposition and hold

**Scope and maturity:** Current baseline.

**Requirement: Deliver independent children and preserve paused work.**

An Epic is a larger outcome whose child Plans can ship independently. After Epic approval, Slicer discusses boundaries,
dependencies, priorities, and a useful MVP with the user. **Write a draft** saves reviewable children without finalizing
the decomposition. Finalization makes child selection available; each child still needs its own review and approval. The
conversation can pause and resume. Users can deliver one child, defer the rest, and mark the Epic done enough with a
summary while unfinished children remain available.

`load-plan` offers the appropriate planning, decomposition, child selection, execution, or recovery action. Unfinished
dependencies are explained before proceeding. `wld plans` shows Epic progress and child status separately from
standalone Plans. Revising an Epic does not silently authorize changed child scope.

**On hold** means paused and resumable, not completed or archived. Nonterminal Plans can retain their previous stage and
an optional reason. **Resume from hold** checks whether relevant changes or missing work affect continuation, then
resumes, offers warnings, or leaves the Plan held with recovery choices. **Reset status to draft** preserves the Plan
body and offers a way to retain unmerged work; deleting that work requires confirmation.

Holding an Epic pauses access to its children without changing their individual statuses. Resume the parent before
working on a child. A child held independently stays held after the parent resumes. Holding one child leaves its parent
and siblings active. Listings keep held work distinct from active and finished work.

**Acceptance scenarios:**

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
QUICK_FIX keeps its explicitly lighter behavior; answering a question does not require publication.

**Requirement: Publish successfully or end only by deliberate user abandonment.**

RunWield carries an accepted delivery workflow through to confirmed publication unless the user willingly abandons it.
There is no automatic terminal failure path. Internal errors, retry limits, or an Agent ending its turn cannot strand
the user, clear the active workflow, or require them to start a replacement workflow. A pause for approval, an actual
external prerequisite, or a user-requested hold preserves the same work and its immediate continuation path.

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
- deliver validated work to its configured target and confirm that outcome before reporting delivery complete;
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

Recovery requirements:

- loading `in_progress`, `failed`, or `implemented` Plans should open a recovery path
- users can continue, reset to baseline, re-open for review, retry validation, or address merge-back failures
- failed Plans leave recovery through dedicated recovery actions, not casual board movement

**Acceptance scenarios:**

- Given a ready approved Plan and existing checkout edits, when execution starts, the approved work is isolated and the
  user’s edits remain preserved.
- When project checks or review fail, the user sees repair progress or a concrete recovery choice; implementation
  completion alone does not claim verification or delivery.
- When publication succeeds, follow-up returns to the primary checkout or the parent Epic’s next action; it does not
  operate in a removed worktree.
- When interrupted validation resumes, preserved work is reused without silently repeating completed actions or deleting
  unmerged changes.
- Given stale locks, inconsistent settings/storage, or mismatched Plan bookkeeping during a workflow, when RunWield
  encounters them, it restores its own consistent state and continues without exposing a repair task to the user.
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
- Given only a maintainability preference, when review completes, it remains advisory and cannot become an invented
  implementation obligation.
- After the automatic-round boundary, when the user chooses human review, feedback leads to repair and checks and
  returns to that human review without an automatic round limit ending it.

<a id="frontend-engineer-and-pair-execution"></a>

### Frontend engineering and pair execution

**Scope and maturity:** Current baseline, with host-dependent Pair support.

**Requirement: Let the user steer visible increments without bypassing validation.**

Frontend Engineer owns work whose primary outcome is materially visual or interactive, including supporting backend
changes in the same slice. Users can configure its model independently. Planner establishes outcomes, behavior, key
states, accessibility, responsive expectations, and existing design references, while leaving visual treatment open when
user taste is part of the work.

Pairing is optional. A Plan recommendation and host capability select Pair or autonomous work without an extra startup
question. Both use Frontend Engineer; noninteractive hosts use autonomous execution. In Pair mode, the Agent runs the
real app early, implements coherent visible increments, checks the browser, and pauses for feedback. Users can revise,
continue, switch to autonomous, or stop with work preserved. Iteration retains the working context, server, and browser.
Material scope changes return to planning; ordinary visual refinements do not.

Both styles verify in the real browser when available and follow existing project tests. A new browser test framework
requires an explicit Plan decision. Pair feedback does not replace validation. Frontend ownership remains through normal
execution; semantic and human-review feedback use the dedicated focused repair behavior above. Measure useful revision
cycles, completion, and checkpoint fatigue without collecting screenshots or feedback in passive metrics.

**Acceptance scenarios:**

- Given a visual Plan with Pair selected on a capable host, when a visible increment is ready, the user can review the
  real app, request refinements, continue autonomously, or stop with work preserved.
- Given a noninteractive host, when the same Plan runs, Frontend Engineer works autonomously; neither Pair feedback nor
  its absence replaces validation.

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
scope.

**Requirement: Preserve useful project facts and retrieve relevant context.**

- **Mnemoteca:** project/global persistent memory for preferences, project facts, and critical context.
- **Init:** `wld init` / `/init` explores the project, writes context, stores memories, and records initialization.
- **Sleep:** `wld sleep` / `/sleep` runs memory and context cleanup prompts.
- **Cymbal:** external semantic/structural code intelligence for search, symbol lookup, impact analysis, tracing, and
  related code queries.
- **Snip:** optional command-output filtering for compact diagnostics.
- **Project context:** `docs/domain-language.md`, memories, settings, and Plan files provide durable project knowledge.

**Target: concise project briefing.** Provide compressed project context where useful without flooding every prompt.

Future code-intelligence work should address demonstrated gaps in finding relevant code, understanding dependencies, or
assessing change impact. Indexing technology belongs in architecture and implementation documents.

**Acceptance scenarios:**

- Given an existing project, when Init completes, the project glossary and saved facts provide terminology and context
  for future work.
- When an Agent needs a symbol or related prior decision, it can retrieve relevant project code or memory without
  treating operational memory as a Work Record.

### Compaction and image context

**Scope and maturity:** Current baseline; linked long-run resilience work remains target scope.

**Requirement: Retain useful conversation and attachment context.**

`/compact` summarizes a growing conversation, optionally using the user's emphasis instructions. Automatic compaction
helps with context pressure. Users see progress, completion, failure, and whether input is needed; Escape cancels it.
Compaction retains the goal, constraints, decisions, progress, relevant file context, and recent activity. Reopening the
Session retains useful context. Failed or ineffective compaction must not strand work or claim completion. Later
long-run reliability requirements are in [Session Context Resilience](session-context-resilience-prd.md).

Vision-capable models receive images directly. With a text-only model, users may select a vision fallback globally or
through a model preset; the preset takes precedence and an unset fallback is disabled. The same provider configuration
and authentication apply. Users see which model will describe the image. Missing or unsuitable fallback configuration
explains how to fix setup while preserving typed text and image previews, including after a model change before Send.

The Agent can ask `see_image` about a saved Session attachment or an explicitly referenced project image. Descriptions
include readable text, relevant visual state, and uncertainty. Resuming retains attachment access; unrelated Sessions do
not inherit it. Future Session deletion also removes its images. See
[vision fallback settings](../settings.md#visionfallback).

**Acceptance scenarios:**

- When compaction finishes and the Session resumes, its goal, decisions, constraints, and useful progress survive;
  failure or cancellation never claims successful compaction.
- Given a text-only model and no suitable vision fallback, when the user tries to send an image, setup guidance
  preserves the typed message and image preview.
- When the user resumes a Session with saved images, those attachments remain available without exposing images from
  unrelated Sessions.

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

**Scope and maturity:** Current baseline. New specialization proposals follow the project’s document conventions.

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

Core supports layered Skill discovery:

1. local project skills
2. home skills
3. bundled skills
4. external-compatible skills

Slash-command skill invocation injects full Skill instructions only when needed.

CLI tools remain preferred for many integrations. MCP is optional and should not add unused prompt context.
Configuration and loading details belong in [customization documentation](../customization.md).

**Acceptance scenarios:**

- When a user customizes an Agent at project scope, those choices take precedence over home and bundled settings while
  required workflow capabilities remain available.
- When a user invokes a Skill, its full instructions are available for that task without requiring every Skill or
  optional integration in every prompt.

<a id="8-models-and-providers"></a>

### Models and providers

**Scope and maturity:** Current baseline with explicitly labeled future tuning questions.

**Requirement: Change models without losing Session or workflow context.**

Users can choose models and providers without changing Session ownership or workflow behavior. The selected model and
its requirements should be visible and consistent across RunWield clients.

Current requirements:

- store RunWield model/auth config under RunWield-owned settings paths
- migrate older Pi config once when useful
- support user-selected model overrides
- support Agent/default/provider model resolution rules
- support Pi/API-authenticated model Execution Backends through configured providers
- support `claude-cli/sonnet`, `claude-cli/opus`, `claude-cli/haiku`, and `claude-cli/fable` as Claude CLI Core
  Execution Backend aliases
- support Antigravity CLI model selection using an existing Antigravity sign-in
- support OpenAI-compatible provider discovery through `/models`
- support local/custom providers through `models.json`
- support vision fallback configuration for pasted images when the active model is text-only

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
[Settings](../settings.md#antigravity-cli).

Future/open requirements:

- keep provider-specific prompt or temperature tuning only where it materially improves behavior
- document realistic provider support in terms of current Pi/RunWield config rather than a static vendor checklist

**Acceptance scenarios:**

- When the user changes a model, the Session and workflow remain the same and the selected model is visible across
  clients.
- Given a CLI backend without its required executable or sign-in, when the first turn is attempted, the user receives
  the backend-specific setup action instead of unrelated provider-login instructions.
- When a backend cannot replay its internal activity, history distinguishes visible RunWield activity from unavailable
  backend internals.

<a id="91-current"></a>
<a id="92-future--open"></a>

### Work protection

**Scope and maturity:** Current baseline; additional command and governance controls remain open questions.

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
- leaving or reloading the browser does not cancel running work;
- after a process failure, saved history remains available and the user receives a clear next action without silent
  repetition of unfinished work;
- Plan review and execution use the current Plan and preserve the user's explicit approval choices;
- rebuilding Workspace registration or pairing does not prevent TUI or ACP from using intact local Sessions.

The file storage, operation-scoped writer lock, transcript segments, and synchronization design live in
[ADR-015](../adr/015-file-authoritative-session-bundles.md). These mechanisms implement the outcomes above; they do not
create additional product restrictions on which screen the owner may use.

**Acceptance scenarios:**

- Given an idle open TUI, when its owner sends the next message from a phone, the same Session continues and the TUI
  updates when the owner returns.
- When a browser reloads or a completed Plan receives a follow-up, saved history remains usable and unsent drafts
  survive; an open screen is not exclusive ownership.
- When a connection retry repeats the same submission, it does not start duplicate work; process loss leaves history and
  an actionable recovery choice.
- When Workspace registration is rebuilt, intact local Sessions remain available through TUI and ACP.

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
