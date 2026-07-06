# Product Requirements Document (PRD): RunWield Core

This is the implementation-facing PRD for **RunWield Core**. The root [PRD.md](../../PRD.md) describes the broader
product architecture across RunWield Core and RunWield Workspace; this file remains the detailed source for local
harness, TUI, routing, lifecycle, tooling, validation, and core runtime requirements.

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
- local markdown Plans, PRDs, ADRs, and future Work Records
- agent definitions, skills, tools, and model configuration
- future Session Host / ACP runtime boundary for external clients

Where RunWield's product vision does not require deliberate divergence, Core should remain compatible with
`@earendil-works/pi-coding-agent` conventions, APIs, session behavior, model/provider configuration, and skill/tool
ecosystem expectations. RunWield should diverge only where its planning, lifecycle, validation, memory, or Workspace
goals require a distinct product surface.

## 2. Core Philosophies

- **Plan-by-Default:** Material work should become a reviewed Plan unless it is explicitly `OPERATION` or `QUICK_FIX`.
- **Right ceremony for the request:** Router should distinguish inquiry, ideation, operation, quick fix, feature, and
  project work so simple tasks are not over-planned and large work is not under-specified.
- **Artifacts over vibes:** Plans, PRDs, ADRs, validation notes, and future Work Records are durable project memory.
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

- `INQUIRY`: read-mostly understanding work, answered by Guide.
- `IDEATION`: strategic/product exploration and Socratic shaping, handled by Ideator.
- `OPERATION`: direct non-code repository or environment operation, handled by Operator.
- `QUICK_FIX`: bounded no-plan code implementation, handled by Engineer with Mechanical Validation only.
- `FEATURE`: planned executable work, handled by Planner.
- `PROJECT`: Epic-scale work, handled by Architect and Slicer.

Only `FEATURE` and `PROJECT` are Plan-producing classifications. Older `classification` values are treated as legacy
compatibility input and normalized into `routingIntent`.

### 3.3 Router Tool: `triage_report`

`triage_report` is Router-owned and should be called exactly once after enough discovery to classify the request.

Parameters:

- `routingIntent`: one of the six canonical Routing Intents
- `complexity`: `LOW | MEDIUM | HIGH`
- `summary`: concise summary and rationale
- `sessionName`: short human label for unnamed sessions
- `affectedPaths`: ordered vertical-slice paths when relevant

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
- `FEATURE` -> Planner and Plan workflow
- `PROJECT` -> Architect and Epic Plan workflow, then Slicer after approval

After dispatch, the specialist remains the active root Agent.

### 3.4 Plan Tool: `plan_written`

`plan_written` is owned by Planner and Architect. It declares that a Plan file exists and submits it to the review and
readiness workflow.

Parameters:

- `planName`: filename without `.md`

Behavior:

1. Validate that `plans/<planName>.md` exists.
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

- FEATURE Plans reach `ready_for_work` after approval and readiness.
- PROJECT Epics reach `ready_for_decomposition` after approval.
- Slicer finalization moves Epics to `ready_for_work` for child Plan selection.
- PROJECT Epics are containers and are not directly executed as implementation work.
- Child FEATURE Plans execute and validate independently.
- FEATURE Plans reach `verified` only through Workflow Validation.
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

- run the configured local validation command
- compute the workflow diff from the execution baseline
- run semantic review against the approved Plan
- optionally run human code review according to settings
- run repair loops in the execution worktree when validation or review fails
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
- starts an ephemeral Fresh server
- binds to `127.0.0.1` by default
- uses a random token for non-public routes and state-changing requests
- exposes board, detail, lifecycle-action, and body-save APIs
- reads and writes canonical markdown Plans through Plan store and lifecycle APIs
- preserves `plans/` as the source of truth

The local Workspace is a Core client, not the SaaS product. Broader Workspace and SaaS requirements live in
[runwield-workspace-PRD.md](./runwield-workspace-PRD.md).

## 5. Current Collaborative Planning Surface

Core includes the beginning of encrypted collaborative Plan sharing.

Current implemented surface:

- `wld plans share <plan-name-or-id>`
- generated Plan identity when needed
- encrypted Plan payload
- reviewer and maintainer bearer capabilities
- local secret storage
- remote-canonical collaboration metadata in Plan front matter
- Shared Plan Lock that blocks normal local Plan writes while the Plan is remote-canonical

Still incomplete collaboration surface:

- `wld plans pull`
- `wld plans push`
- `wld plans unshare`
- complete shared-review incorporation loop
- hosted/self-hosted server hardening beyond the current remote adapter/protocol work

The full collaboration and Workspace story lives in [runwield-workspace-PRD.md](./runwield-workspace-PRD.md).

## 6. Memory, Context, and Code Intelligence

### 6.1 Current

- **Mnemosyne:** project/global persistent memory for preferences, project facts, and critical context.
- **Init:** `wld init` / `/init` explores the project, writes context, stores memories, and records initialization.
- **Sleep:** `wld sleep` / `/sleep` runs memory and context cleanup prompts.
- **Cymbal:** external semantic/structural code intelligence for search, symbol lookup, impact analysis, tracing, and
  related code queries.
- **Snip:** optional command-output filtering for compact diagnostics.
- **Project context:** `CONTEXT.md`, memories, settings, and Plan files provide durable project knowledge.

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

### 7.3 Skills

Core supports layered Skill discovery:

1. local project skills
2. home skills
3. bundled skills
4. external-compatible skills

Slash-command skill invocation injects full Skill instructions only when needed.

### 7.4 Future / Open

The older "Forge" idea remains aspirational. Current Core supports customization and Skill loading; it does not yet
provide a first-class product flow where Agents build and install their own specializations. Future work should either
define that flow concretely or remove "self-evolution" from the Core product language.

## 8. Models and Providers

Core uses RunWield-owned model/auth config built on Pi's provider system.

Current requirements:

- store RunWield model/auth config under RunWield-owned settings paths
- migrate older Pi config once when useful
- support user-selected model overrides
- support Agent/default/provider model resolution rules
- support OpenAI-compatible provider discovery through `/models`
- support local/custom providers through `models.json`
- support vision fallback configuration for pasted images when the active model is text-only

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

## 10. Session Host and External Integration

### 10.1 Current

Current interactive runtime still has a single process-global session state owner for:

- active Agent
- active model/thinking state
- root Session Manager
- root Agent Session
- active UI API
- pending root swap
- pending return-to-router handoff
- transient sub-Agent Sessions
- active execution workflow
- project-state context

This is sufficient for the current TUI-oriented runtime, but it is not the target architecture for ACP, Workspace-driven
sessions, or messaging transports.

### 10.2 Future / Open

The next major Core architecture goal is the multi-session **Session Host**, described in
[runwield-acp-session-host-PRD.md](./runwield-acp-session-host-PRD.md).

Requirements:

- introduce a Session Host abstraction that owns one or more Hosted Sessions
- move session-scoped state out of process-global `session-state.js`
- make the TUI a client of one Hosted Session
- support multiple independent Hosted Sessions in one process
- expose create/load/prompt/cancel/observe semantics for non-TUI clients
- make ACP the strategic external protocol
- preserve existing TUI behavior while changing the runtime ownership boundary

Session Host comes before ACP. ACP should expose RunWield behavior; it should not reach into TUI globals.

## 11. Technical Stack

Current:

- **Language/runtime:** Deno, pure JavaScript, JSDoc types.
- **CLI/TUI:** Deno CLI plus Pi/Pi-TUI runtime.
- **Agent runtime:** `@earendil-works/pi-coding-agent`.
- **Compatibility:** preserve Pi Coding Agent behavior and configuration compatibility where it does not conflict with
  RunWield's planning/lifecycle product model.
- **Local UI:** Fresh 2, Vite, Preact islands/signals, UnoCSS.
- **Plan persistence:** repo-local markdown under `plans/`.
- **RunWield settings/state:** `~/.wld/` and `.wld/` where appropriate.
- **Memory:** Mnemosyne.
- **Code intelligence:** Cymbal plus command/search tools.
- **Execution isolation:** Git worktrees and `.wld/worktrees.json` runtime registry.
- **Validation:** project-configured validation command, semantic review, optional human review, merge-back.
- **Collaboration:** encrypted Shared Space protocol and local sharing command work in progress.

Future/open:

- Session Host and ACP runtime mode.
- Work Records as first-class local markdown planning memory.
- Complete shared Plan pull/push/unshare lifecycle.
- Any RunWield-owned semantic index if Cymbal is not sufficient.

## 12. Success Metrics

Current Core metrics:

- Router produces correct Routing Intent without excessive exploration.
- Plans reach review quickly and with enough context for approval.
- Approved FEATURE Plans reach `verified` after validation.
- Recovery paths preserve enough state to continue safely after failed execution, validation, or merge-back.
- QUICK_FIX runs remain bounded and validate mechanically without unnecessary Plan ceremony.
- Local Workspace manages Plans without corrupting front matter or bypassing lifecycle rules.

Future Core metrics:

- TUI runs through Session Host with no intended behavior regression.
- Multiple Hosted Sessions can run in one process without state bleed.
- ACP clients can create/load/prompt/cancel sessions and observe workflow events.
- Work Records are generated for verified planned work and improve future planning retrieval.
- Shared Plan pull/push/unshare flows complete the remote-canonical collaboration loop.
