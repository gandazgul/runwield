# Product Requirements Document (PRD): RunWield Core

This is the implementation-facing PRD for **RunWield Core**. The root [docs/domain-language.md](../domain-language.md)
describes the broader product architecture across RunWield Core and RunWield Workspace; this file remains the detailed
source for local harness, TUI, routing, lifecycle, tooling, validation, and core runtime requirements.

RunWield Core is a living product surface. This PRD distinguishes current requirements from future/open requirements so
aspirational work remains visible without confusing it with shipped behavior.

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
- in-process `SessionHost`/`HostedSession` and adapter-neutral `SessionRuntime` boundary for TUI, ACP, and Workspace
  clients

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

New sessions start with the **Router** Agent. Router is not a special runtime mode; it is a normal Agent activated
through the same Agent Handler as other Agents.

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

Only `PLANNED_CHANGE` and `PROJECT` are Plan-producing classifications. Older `classification` values are treated as
legacy compatibility input and normalized into `routingIntent`.

### 3.3 Router Tool: `triage_report`

`triage_report` is Router-owned and should be called exactly once after enough discovery to classify the request.

Parameters:

- `routingIntent`: one of the six canonical Routing Intents
- `complexity`: `LOW | MEDIUM | HIGH`
- `summary`: concise summary and rationale
- `sessionName`: short human label for unnamed sessions

Behavior:

1. Emits the Triage Report to the TUI.
2. Stores the structured outcome in the tool result.
3. Terminates the Router turn.
4. The Agent Handler reads the tool outcome and dispatches through workflow orchestration.

Post-triage dispatch:

- `INQUIRY` -> Guide
- `IDEATION` -> Ideator
- `OPERATION` -> Operator
- `QUICK_FIX` -> Engineer, then no-plan Mechanical Validation after `task_completed`
- `PLANNED_CHANGE` -> Planner and Plan workflow
- `PROJECT` -> Architect and Epic Plan workflow, then Slicer after approval

After dispatch, the specialist remains the active root Agent.

### 3.4 Plan Tool: `plan_written`

`plan_written` is owned by Planner and Architect. It declares that a Plan file exists and submits it to the review and
readiness workflow.

Parameters:

- `planName`: filename without `.md`

Behavior:

1. Validate that `docs/plans/<planName>.md` exists.
2. Resolve effective triage metadata from captured context or Plan front matter.
3. Submit the Plan for review.
4. On approval, record approval and run the classification-aware Readiness Gate.
5. Return a semantic outcome for orchestration.

Outcomes:

- `approved_execute`
- `saved`
- `feedback`
- `canceled`
- `repair_required`
- `no_call`

Feedback remains in the same planning session so the planning Agent can revise and call `plan_written` again.

### 3.5 Plan Lifecycle

Saved Plans are governed by an event-driven lifecycle. Workflow code records Plan Events; the Plan Lifecycle module
decides status and front matter mutations.

Current statuses:

- `draft`
- `feedback`
- `approved`
- `ready_for_decomposition`
- `ready_for_work`
- `in_progress`
- `failed`
- `implemented`
- `verified`
- `closed_without_verification`
- `on_hold`

Current key events:

- `review_feedback`
- `review_approved`
- `readiness_passed`
- `epic_readiness_passed`
- `decomposition_finalized`
- `execution_started`
- `execution_failed`
- `implementation_finished`
- `validation_failed`
- `validation_passed`
- `worktree_merge_failed`
- `recovery_continue`
- `recovery_reset`
- `review_reopened`
- `epic_done_enough`
- `manual_status_change`
- `manual_closed_without_verification`
- `plan_held`
- `hold_resumed`
- `hold_reset_to_draft`

Lifecycle requirements:

- Planned Change Plans reach `ready_for_work` after approval and readiness.
- PROJECT Epics reach `ready_for_decomposition` after approval.
- Slicer finalization moves Epics to `ready_for_work` for child Plan selection.
- PROJECT Epics are containers and are not directly executed as implementation work.
- Child Plans execute and validate independently.
- Planned Change Plans reach `verified` only through Workflow Validation.
- Epics may also reach `verified` through the existing `epic_done_enough` event.
- `closed_without_verification` is a terminal manual closure outcome distinct from `verified`.
- `on_hold` is paused-but-resumable and preserves held-from metadata.
- Manual board movements must call lifecycle helpers rather than editing front matter directly.

### 3.6 Execution, Worktrees, Validation, and Recovery

Executable Plan work starts only from `ready_for_work`.

Execution requirements:

- create or reuse an isolated execution worktree
- capture an `executionBaselineTree`
- record `execution_started`
- run Engineer against the approved Plan body
- require Engineer `task_completed` before implementation is treated as finished
- record `implementation_finished`

Workflow Validation requirements:

- enter and resume planned validation through one supervisor
- repair safe RunWield state before asking the user to act
- use the primary Plan, worktree record, and Git as the authority, in that order
- keep a durable validation checkpoint so one owner resumes once after process loss
- show short plain messages and keep raw errors in logs
- ask before deleting an unmerged worktree or resetting working changes; do not refuse other proven safe repairs
- run the configured local validation command
- compute the workflow diff from the execution baseline
- run semantic review against the approved Plan
- optionally run human code review according to settings
- run repair loops in the execution worktree when validation or review fails
- start each semantic-review repair in a fresh persisted transcript segment under the same stable Session, seeded with
  the bounded review issue packet rather than the predecessor Engineer transcript
- merge validated work back into the primary checkout
- record `validation_passed` only after validation and merge-back succeed
- record `validation_failed` or `worktree_merge_failed` while preserving recoverable state

QUICK_FIX work does not create a Plan and runs Mechanical Validation only.

Recovery requirements:

- loading `in_progress`, `failed`, or `implemented` Plans should open a recovery path
- users can continue, reset to baseline, re-open for review, retry validation, or address merge-back failures
- failed Plans leave recovery through dedicated recovery actions, not casual board movement

## 4. Current Local Workspace Surface

RunWield Core includes a local browser Workspace launched by:

```bash
wld plans ui
```

Current local Workspace requirements:

- scoped to the current checkout
- starts an ephemeral Astro/React Workspace server
- binds to `127.0.0.1` by default
- uses a random token for non-public routes and state-changing requests
- exposes board, detail, lifecycle-action, and body-save APIs
- reads and writes canonical markdown Plans through Plan store and lifecycle APIs
- preserves `docs/plans/` as the source of truth

The local Workspace is a Core client and remains supported alongside the later persistent owner Workspace. Broader
Workspace, Personal Remote Workspace, and SaaS requirements live in
[runwield-workspace-prd.md](./runwield-workspace-prd.md).

## 5. Current Collaborative Planning Surface

Core includes encrypted collaborative Plan sharing through self-hosted remote Workspace Shared Spaces.

Current implemented surface:

- self-hosted remote Workspace Plan Server with SQLite storage and Podman/OCI Compose packaging
- `wld plans share <plan-name-or-id>`
- `wld plans pull <maintainer-url-or-plan-name-or-id>`
- `wld plans push <plan-name-or-id>`
- `wld plans unshare <plan-name-or-id>` for CLI-only destructive delete/recovery
- generated Plan identity when needed
- encrypted Plan and comment payloads
- reviewer and maintainer bearer capabilities stored server-side only as hashes
- local secret storage outside Plan Front Matter and normal settings
- remote-canonical collaboration metadata in Plan Front Matter
- Shared Plan Lock that blocks normal local Plan writes while the Plan is remote-canonical
- browser Shared Space review with Plannotator-backed comments, resolve/reopen, and Revision switching

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

### 6.2 Future / Open

The older Core PRD described hybrid indexing with in-process Tree-sitter and LanceDB. Current Core instead leans on
external Cymbal and command/search tools. Future indexing work should decide whether to:

- continue with Cymbal as the primary code intelligence surface
- add a local RunWield-owned structural index
- add a RunWield-owned semantic index
- retire the LanceDB/Tree-sitter language from Core PRDs if it no longer matches product direction

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

Every Agent's capabilities are defined by front matter `tools`.

Protected tools cannot be removed by overrides when they are both:

- present in the bundled Agent definition
- listed in the global protected-tool policy

Final effective tools:

```text
effective tools = merged override tools + protected bundled tools
```

Runtime `toolNames` can narrow the effective set but cannot add outside it. Runtime `customTools` can be supplied
explicitly by the host.

Guide's bundled tools include the restricted `write_docs` and `edit_docs` Custom Tools. They preserve native write/edit
relative and absolute path behavior but reject targets whose final extension is not `.md` before mutation. They are
intended only for explicit user requests to preserve or update ordinary Markdown documents from an ongoing Guide
conversation; Router dispatch and Operator capabilities are unchanged, and workflow-owned Markdown artifacts remain
outside Guide's policy scope.

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

Core uses RunWield-owned model/auth config built on Pi's provider system and RunWield-owned Execution Backend metadata.
The selected model reference determines which Core Execution Backend runs the turn; UI surfaces are clients of Session
Runtime model selection, not independent model-state owners.

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

In the MVP Claude CLI transcript projection, Claude Code owns its internal file/Bash/tool activity. That internal
file/Bash/tool activity can affect the worktree, but RunWield persists native RunWield tool events for Bridged Tools
exposed through the loopback MCP bridge. Claude Code's internal file, Bash, and native tool activity stays unrecorded as
native RunWield tool events. RunWield Connect remains the separate product mode where Claude Code is the External Agent
Host and owns the user conversation and model calls.

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

The older PRD described mandatory clean-working-tree checks, commit/stash/bypass prompts, shell blacklists, and
`rbash`-style sandboxing. Future safety work should decide which of these are still desired and where they belong.

Open questions:

- Should Core require a clean primary checkout before every Plan execution, or is worktree isolation plus merge-risk
  inspection enough?
- Should dangerous shell command policy live in RunWield itself, in Pi, or in user/project instructions?
- Should a Governance Agent or architecture guardrail become a first-class workflow, or remain a Skill/policy option?

## 10. Session Host, SessionRuntime, and External Integration

### 10.1 Current foundation

Core currently has an in-process multi-session **Session Host** foundation:

- `SessionHost` owns the in-process registry and lifecycle for one or more Hosted Sessions.
- `HostedSession` owns per-session Project root, persisted root Session Manager, active Agent/model/thinking state,
  interaction adapter, workflow context, active execution workflow, event sink, and turn state.
- `SessionRuntime` exposes adapter-neutral create, load, prompt, cancel, close, replay, snapshot, workflow-action,
  event, and interaction semantics.
- TUI and ACP are sibling Runtime consumers and must not import one another or require Workspace application services.
- Workspace may also consume `SessionRuntime` through a native browser adapter rather than routing first-party traffic
  through ACP.

This foundation isolates multiple Hosted Sessions in one process, but it does not make one JavaScript Runtime instance
shareable across TUI, Workspace, and ACP processes. Loading the same Pi Session transcript in two processes without
coordination risks stale context, unintended branches, or duplicated side effects.

### 10.2 Personal Remote Workspace coordination requirements

Personal Remote Workspace v1 adds the cross-process coordination layer accepted in
[ADR-011](../adr/011-exclusive-session-activation-and-durable-workflow-checkpoints.md) while preserving the sibling
Runtime boundary described in [runwield-acp-protocol-prd.md](./runwield-acp-protocol-prd.md).

Core requirements for that layer:

- assign a stable RunWield Session ID above Pi Session Manager IDs and in-process Hosted Session IDs;
- map each stable Session to one Project and an ordered atomic file manifest beside its Pi transcripts under
  `~/.wld/sessions/`, with exactly one current writable segment;
- catalog every new local Session immediately and migrate an older Pi transcript automatically when it is opened,
  without requiring Project registration or user confirmation;
- keep local Session cataloging separate from Workspace access: only explicitly registered Projects appear in or are
  addressable through Workspace;
- keep Core Session identity, lineage, generations, writer safety, and recovery independent of the Workspace database;
- acquire an exclusive operating-system **Session Writer Lock** before any process opens or mutates a writable Pi
  `SessionManager` for an existing Session; process exit releases the lock without a lease timeout or takeover;
- publish committed Session generations only after the corresponding transcript or repository effects are durable;
- support transactional successor-segment rollover for planning-to-execution and semantic-repair context boundaries
  without changing stable Session identity or adding another persisted startup mechanism;
- provide a genuinely non-mutating transcript reader for idle non-owners to project unseen stable entries without
  migrating or rewriting JSONL;
- rely on Pi JSONL for completed tool calls and interaction results, with pending structured interactions remaining
  process-local until their result is committed;
- after owner-process loss during a pending wait, reload committed Pi history and ask the user to retry rather than
  reconstructing the lost wait;
- revalidate canonical Plan status/revision and worktree evidence at the start of each consequential Plan action;
- use endpoint operation receipts only to deduplicate bounded HTTP request delivery;
- treat stale manifest evidence, transcript reconciliation mismatches, stale Plan evidence, and partial filesystem
  effects as recovery cases rather than replaying arbitrary model, command, tool, or filesystem work.

These requirements sit below adapters and above consequential transcript, lifecycle, Plan, and worktree effects. They
must preserve existing local TUI, ACP, current-checkout Plan UI, Shared Plan, QUICK_FIX, non-Git, Plan Lifecycle,
Workflow Validation, and RunWield worktree behavior where that behavior does not violate one-writer ownership.

## 11. Technical Stack

Current:

- **Language/runtime:** Deno, pure JavaScript, JSDoc types.
- **CLI/TUI:** Deno CLI plus Pi/Pi-TUI runtime.
- **Agent runtime:** `@earendil-works/pi-coding-agent`.
- **Compatibility:** preserve Pi Coding Agent behavior and configuration compatibility where it does not conflict with
  RunWield's planning/lifecycle product model.
- **Local UI:** Astro SSR, Vite, React islands, Tailwind/Radix-compatible Workspace primitives.
- **Plan persistence:** repo-local markdown under `docs/plans/`.
- **RunWield settings/state:** `~/.wld/` and `.wld/` where appropriate.
- **Memory:** Mnemoteca.
- **Code intelligence:** Cymbal plus command/search tools.
- **Execution isolation:** Git worktrees and `.wld/worktrees.json` runtime registry.
- **Validation:** project-configured validation command, semantic review, optional human review, merge-back.
- **Collaboration:** encrypted Shared Space protocol and implemented share/pull/push/unshare CLI lifecycle.

Future/open:

- Personal Remote Workspace coordination: file-authoritative stable Sessions, writer locks, committed generations,
  ordered transcript segments, Workspace-only endpoint receipts, and automatic synchronization.
- Per-Project isolated OS worker processes or containers after the Personal Workspace Project Runtime boundary is
  proven.
- Token-level cross-process mirroring of live model streams, tool output, or terminal bytes; current coordination should
  rely on settled committed generations, transcript events, attention state, and canonical recovery evidence.
- Hosted RunWield Workspace / Cloudflare D1 deployment for Shared Spaces and later SaaS composition.
- Any RunWield-owned semantic index if Cymbal is not sufficient.

## 12. Success Metrics

Current Core metrics:

- Router produces correct Routing Intent without excessive exploration.
- Plans reach review quickly and with enough context for approval.
- Approved Planned Change Plans reach `verified` after validation.
- Recovery paths preserve enough state to continue safely after failed execution, validation, or merge-back.
- QUICK_FIX runs remain bounded and validate mechanically without unnecessary Plan ceremony.
- Local Workspace manages Plans without corrupting front matter or bypassing lifecycle rules.

Future Core metrics:

- All writable Session opening paths acquire the Session's OS file lock before mutating an existing transcript.
- Idle non-owning TUI, Workspace, and ACP surfaces synchronize from committed Session generations without constructing
  writable managers.
- Completed Pi interaction results remain visible after restart, while pending process-local waits require explicit
  retry after owner-process loss.
- Consequential Plan actions across CLI, TUI, Workspace, ACP, validation, and recovery paths reject stale Session, Plan
  revision/status, or worktree evidence.
- Session manifests can be reconstructed conservatively from transcript-adjacent recovery descriptors and Pi lineage.
  Deleting the Workspace database does not prevent Core from opening or continuing local Sessions.

### User Verified Plan lifecycle outcome

RunWield supports terminal Plan Status `user_verified` via Plan Event `manual_user_verified`. The event requires
`userVerificationNote`, records `userVerifiedAt`, never records `verifiedAt` or synthesized Delivery Evidence, satisfies
dependencies/Epic completion with distinct User Verified labels, and is archive-eligible subject to existing
recoverable-worktree guards.

[Mnemoteca]: https://github.com/gandazgul/mnemoteca
