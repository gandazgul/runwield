# Product Requirements Document (PRD): RunWield Core

**Document role: Living central PRD.** Shared local workflow principles and lasting Core product requirements.

Keep this document as current product guidance. Fold lasting requirements from completed feature PRDs here;
implementation steps belong in Plans, architectural choices in ADRs, and delivery evidence in Work Records.

This PRD defines the user needs and outcomes for **RunWield Core**: local planning, execution, conversation, validation,
and recovery. [Domain language](../domain-language.md) defines the shared product terms. Architecture belongs in ADRs;
implementation steps and remaining work belong in Plans.

Current capabilities and future proposals are distinguished below. A listed capability does not establish that every
journey using it is complete.

## 1. Vision & Strategy

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

## 2. Core Philosophies

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

## 3. Current Core Product Surface

### 3.1 TUI Shell and Root Agent Behavior

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

### 3.2 Routing Intents

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

### 3.3 Triage Experience

After enough discovery to understand the request, Router explains the chosen type of work, complexity, and rationale,
then hands off to the responsible specialist. Users should not receive duplicate triage or unnecessary exploration. The
specialist remains active for follow-up messages.

### 3.4 Plan Review

Planner or Architect presents a saved Plan for review. Users can approve, save it for later, give feedback, or cancel.
Feedback stays in the planning conversation so the Agent can revise it. Approval leads to a readiness check before
execution or decomposition; a Plan needing repair explains what prevents it from proceeding.

### 3.5 Plan Lifecycle

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
- `closed_without_verification` is a terminal manual closure outcome distinct from `verified`.
- `on_hold` pauses work and lets users resume from its previous stage.
- Board actions preserve the same lifecycle rules as CLI and TUI actions.

### Epic Decomposition and Hold

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

### 3.6 Execution, Worktrees, Validation, and Recovery

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
- resolve recoverable internal problems before asking the user to act;
- show short, plain messages with detailed diagnostics available separately;
- ask before deleting unmerged work or resetting working changes.

QUICK_FIX work does not create a Plan and runs Mechanical Validation only.

Recovery requirements:

- loading `in_progress`, `failed`, or `implemented` Plans should open a recovery path
- users can continue, reset to baseline, re-open for review, retry validation, or address merge-back failures
- failed Plans leave recovery through dedicated recovery actions, not casual board movement

### Semantic Review and Repair

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

Final nonblocking advisories may accompany the delivered Plan as clearly labeled post-validation context, never new
approved requirements or a full review diary. Revalidation must not duplicate them. Review quality is judged by useful
convergence without more escaped defects, not approval rate alone.

### Frontend Engineer and Pair Execution

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

### Theme Selection

Users can install or remove themes from npm, Git, or local packages, preview them live in `/theme`, and confirm a choice
that persists across Sessions. Previewing does not overwrite the saved choice. The built-in `catppuccin-mocha` fallback
remains available when a selected theme is missing or invalid. Installing a theme does not activate accompanying
executable extensions. Public configuration is in the [theme reference](../themes.md).

## 4. Current Local Workspace Surface

RunWield Core includes a local browser Workspace launched by:

```bash
wld plans ui
```

Local Workspace requirements:

- manage Plans in the current checkout through a board, detail view, review, and lifecycle actions;
- keep repository Markdown Plans editable and usable outside the UI;
- keep local access private by default;
- preserve lifecycle behavior when users save or move a Plan.

The local Workspace is a Core client and remains supported alongside the later persistent owner Workspace. Broader
Workspace, Personal Remote Workspace, and SaaS requirements live in
[runwield-workspace-prd.md](./runwield-workspace-prd.md).

## 5. Current Collaborative Planning Surface

Core includes encrypted collaborative Plan sharing through self-hosted remote Workspace Shared Spaces.

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

The full collaboration and Workspace story lives in [runwield-workspace-prd.md](./runwield-workspace-prd.md).

## 6. Memory, Context, and Code Intelligence

### 6.1 Current

- **Mnemoteca:** project/global persistent memory for preferences, project facts, and critical context.
- **Init:** `wld init` / `/init` explores the project, writes context, stores memories, and records initialization.
- **Sleep:** `wld sleep` / `/sleep` runs memory and context cleanup prompts.
- **Cymbal:** external semantic/structural code intelligence for search, symbol lookup, impact analysis, tracing, and
  related code queries.
- **Snip:** optional command-output filtering for compact diagnostics.
- **Project context:** `docs/domain-language.md`, memories, settings, and Plan files provide durable project knowledge.

### Compaction and Image Context

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

### Work Records

Work Records are concise, repository-owned Markdown accounts of what completed work produced and what future planning
should remember. They retain meaningful deviations, deferred scope, concrete lessons, source Plan links, Ticket links,
and useful evidence without copying chat, review deliberation, or the original Plan in full. Identity and links survive
renaming; search can be rebuilt from the documents.

- Eligible top-level completed Plans and Epics receive records by default. An Epic record summarizes relevant children,
  including deferred and archived work; it does not generate a record for every child.
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

### 6.2 Future / Open

Future code-intelligence work should address demonstrated gaps in finding relevant code, understanding dependencies, or
assessing change impact. Indexing technology belongs in architecture and implementation documents.

## 7. Agent Definitions, Skills, and Tool Policy

### 7.1 Agent Definitions

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

### 7.2 Tool Policy

Users can customize Agent tools, while required workflow capabilities remain available so customization does not break
planning or validation. Guide may save ordinary Markdown documents when explicitly requested in the conversation; this
does not grant authority to change workflow-owned Plans, ADRs, or Work Records.

### 7.3 Skills

Core supports layered Skill discovery:

1. local project skills
2. home skills
3. bundled skills
4. external-compatible skills

Slash-command skill invocation injects full Skill instructions only when needed.

### 7.4 Future / Open

No additional requirements are currently tracked in this section. Existing customization remains covered by Agent
definition and Skill layering above; any new specialization product should be introduced through a separate PRD before
returning to Core requirements.

## 8. Models and Providers

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

Future/open requirements:

- keep provider-specific prompt or temperature tuning only where it materially improves behavior
- document realistic provider support in terms of current Pi/RunWield config rather than a static vendor checklist

## 9. Safety and Guardrails

### 9.1 Current

Current safety is centered on:

- Plan-by-default routing
- protected workflow tools
- Plan Lifecycle state machine
- execution worktree isolation
- baseline-tree recovery
- local validation
- semantic review
- optional human code review
- merge-back checks and repair loops
- Shared Plan Lock for remote-canonical collaboration
- token-protected local Workspace server

### 9.2 Future / Open

Open product questions:

- When does requiring a clean checkout protect user work enough to justify interrupting execution?
- What additional controls over dangerous commands do users need beyond their existing project instructions?
- Is architecture governance useful as a dedicated workflow or as an optional policy?

## 10. Sessions and External Integration

### 10.1 Shared Session Experience

Users can work with multiple independent Sessions through the TUI, ACP, and Workspace. Each Session retains its project,
conversation, selected Agent and model, and workflow context. Starting, loading, sending, cancelling, and reviewing
history should behave consistently across clients.

Runtime boundaries are documented in [ADR-010](../adr/010-session-runtime-sibling-adapters-and-acp.md).

### 10.2 Personal Remote Workspace coordination requirements

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

## 11. Delivery and Architectural References

Core remains usable locally without hosted Workspace. Personal Remote Workspace adds convenient access to the same work
from another device. Hosted collaboration and broader code-intelligence improvements remain separate follow-up scope.

- [Session architecture](../adr/015-file-authoritative-session-bundles.md)
- [Transcript handoffs](../adr/012-segment-session-transcripts-at-execution-handoff.md)
- [ACP compatibility](runwield-acp-protocol-prd.md) and [implementation details](../acp-implementation-details.md)
- [Workspace requirements](runwield-workspace-prd.md) and
  [continuation readiness Plan](../plans/workspace-session-continuation-readiness.md)

## 12. Success Metrics

Current Core metrics:

- Router produces correct Routing Intent without excessive exploration.
- Plans reach review quickly and with enough context for approval.
- Approved Plans complete validation and delivery with accurate, distinct outcomes.
- Recovery paths preserve enough state to continue safely after failed execution, validation, or merge-back.
- QUICK_FIX runs remain bounded and validate mechanically without unnecessary Plan ceremony.
- Local Workspace manages Plans without corrupting front matter or bypassing lifecycle rules.

Session acceptance journeys:

- The owner leaves an idle TUI open, continues on a phone, and sees the new conversation on returning.
- Reloading a browser preserves saved work and does not stop a running task.
- After interruption, the user can inspect saved history and take a clear next action without silent duplicate work.
- Completed interactions remain in history. A question interrupted by process loss explains how to retry.
- Local Sessions remain usable if Workspace registration needs rebuilding.

### User Verified Plan lifecycle outcome

Users can mark a Plan `user_verified` with an explicit verification note. This satisfies dependencies and Epic
completion while remaining visibly distinct from automated verification. It is eligible for archival when no recoverable
work would be lost.

[Mnemoteca]: https://github.com/gandazgul/mnemoteca
