# Product Requirements Document (PRD): Project "Harns"

## 1. Vision & Strategy

**Harns** is an opinionated, developer-first coding harness designed for deep architectural alignment and token
efficiency. It moves beyond "chat-and-hope" AI by enforcing a "Plan-by-Default" philosophy, utilizing persistent project
memory, and treating the SDLC as a series of intentional gates.

## 2. Core Philosophies

- **Plan-by-Default:** Most tasks start with structural planning rather than immediate code execution.
- **Token Parsimony:** Minimize context pollution. Spend tokens upfront (indexing/init) to save them during every
  subsequent turn.
- **Architectural Intent:** Provide specialized agents (Architect, PM, Coder, etc.) that respect the project's "Gravity
  Centers."
- **Session Persistence:** Branching, tree-based session states that can span days, preserve the active agent, and
  survive interruptions.

## 3. Core Features & Functional Requirements

### 3.1 The TUI Shell & Agent Workflows

The primary interface for Harns is the TUI Shell. It acts as a universal host for interacting with different agents. By
default, when the TUI opens, the user talks to the **Router** agent. The Router is not a special system wrapper; it is a
peer agent (like the Architect, Planner, or Coder) that simply acts as the default triage point.

**The Router (Adaptive Path Engine):** When active, the Router automatically triages incoming requests into one of three
paths:

- **Quick Fix:** Troubleshooting and rapid changes with no upfront decisions. Uses Debugger or Execution agents.
- **Feature:** Requires upfront clarification and a structured executable plan. Child FEATURE plans can declare sibling
  dependencies when they belong to an Epic.
- **Project:** Epic-scale changes that are too large to execute directly. The **Architect Agent** performs deep
  vertical-slice exploration and produces an Epic proposal; the Slicer decomposes approved Epics into child FEATURE
  plans that execute independently.

**Dynamic Agent Switching:** Users can switch the active agent they are conversing with using slash commands (e.g.
`/resume <plan>`). When `/resume` is invoked, the TUI drops the Router and connects the user directly to the Planner or
Architect agent managing that specific plan. This works seamlessly whether the TUI was already running or if it was
started via `hns resume <plan>`.

#### Routing & Lifecycle Tools

Routing and the planning lifecycle are driven by a small set of **declaration tools** plus a session-level orchestrator.
Factory tools are auto-wired by the session runner and capture TUI/session context (`uiAPI`, `sessionManager`,
`triageMeta`) at session-start time, so the same tool name is implemented by a different concrete instance per session.
The agent declares intent by calling the tool; Harns orchestration code decides what happens next.

**`triage_report` (router-only)**

- **Owner:** the Router agent. The Router's only job is to explore narrowly, classify, and call this tool exactly once.
- **Parameters:** `classification` (`QUICK_FIX | FEATURE | PROJECT`), `complexity` (`LOW | MEDIUM | HIGH`), `summary`,
  `affectedPaths` (ordered vertical-slice).
- **Behavior on `execute`:**
  1. Emits the triage report to the TUI.
  2. Stores the structured triage outcome in the tool result.
  3. Terminates the Router turn so the session-level orchestrator can dispatch without extra Router prose.
- **Post-tool orchestration:** after the Router turn ends, the orchestrator reads the latest `triage_report` outcome and
  runs the downstream flow on the **same root session**:
  - `QUICK_FIX` → set active agent to Operator and run the Operator with the user request plus triage block.
  - `FEATURE` → set active agent to Planner, ensure `plans/`, and call the planning workflow.
  - `PROJECT` → set active agent to Architect for targeted deep exploration and Epic planning. After approval, the
    readiness flow opens Slicer decomposition instead of executing the PROJECT directly.
- After the downstream agent finishes, the active agent **stays** on the assigned Planner, Architect, or Operator. There
  is no automatic restoration to Router; the user can `/agent router` explicitly to triage a new request.
- **No parallel router/operator process model:** execution happens through the same root session manager. "Switching
  agents" means rebinding the active agent name and message handler, while persisted active-agent markers allow
  `/resume` to reopen the session with the correct specialist.

**`plan_written` (planner / architect)**

- **Owner:** the Planner and Architect agents. It is auto-wired into any agent whose frontmatter `tools:` list contains
  `plan_written` (currently planner.md and architect.md).
- **Parameters:** `planName` (filename without `.md`).
- **Behavior on `execute`:**
  1. Validate that `plans/<planName>.md` exists; if not, return guidance text as the tool result so the agent writes the
     file first and re-calls.
  2. Resolve `triageMeta` (factory-captured value first, plan front matter as fallback).
  3. Call `submitPlanForReview` (browser UI) and wait for the user's decision.
     - **Approved:** record durable approval, run the classification-aware readiness gate, then ask save-vs-proceed. On
       `proceed`, return an `approved_execute` outcome so the orchestrator can execute the plan after the planning agent
       turn ends.
     - **Feedback submitted:** return the user's feedback as the tool result so the agent revises the plan in the same
       session and calls `plan_written` again.
     - **Canceled:** return a "control returned to the user" tool result; the active agent stays on the planner so the
       user can resume the conversation.
     - **Readiness repair required:** if legacy project task slicing fails or produces invalid tasks, keep the plan
       approved and return corrective feedback so the agent can retry the readiness step. PROJECT Epics instead route to
       Slicer decomposition.
- **Readiness Gate:** `FEATURE` plans promote from approved to executable without another LLM call. PROJECT Epics
  promote to `ready_for_decomposition` and open the interactive Slicer; finalizing decomposition with child FEATURE
  plans moves the Epic to `ready_for_work` for child selection. Legacy non-Epic PROJECT plans keep the task-table Slicer
  compatibility path.
- **Tool result `details.outcome`:** one of
  `approved_execute | saved | feedback | canceled | repair_required | no_call`. Callers use
  `readLatestPlanOutcome(messages)` to drive UI state — for example, executing an approved plan, saving for later, or
  keeping the planner mid-conversation for feedback.
- **Free-form clarification questions are allowed.** If the planner needs clarification it cannot phrase via
  `user_interview`, it stops without calling any tool. The session ends and control returns to the user; the planner
  remains the active agent and the conversation continues on the user's next message. There is no "agent did not declare
  a plan" hard error — `plan_written` is the lifecycle trigger, not a session terminator.

#### Plan Lifecycle, Validation, and Recovery

Saved plans are governed by an event-driven lifecycle rather than direct status mutation. Workflow code records facts as
Plan Events, and the Plan Lifecycle decides the durable status and front matter updates.

**Canonical statuses:**

- `draft`: a plan exists but has not completed review.
- `feedback`: the review loop returned user feedback, or the planning agent was interrupted while handling feedback.
- `approved`: the user approved the plan, but readiness work may still be unfinished.
- `ready_for_decomposition`: an approved PROJECT Epic is ready for Slicer decomposition, but is not executable.
- `ready_for_work`: the only executable status for FEATURE and legacy non-Epic PROJECT plans; on PROJECT Epics, it means
  child FEATURE selection is available.
- `in_progress`: execution has started and may have partially changed the worktree.
- `failed`: execution began but implementation did not finish.
- `implemented`: implementation finished, but workflow validation has not passed.
- `verified`: implementation and workflow validation both passed.

**Lifecycle gates:**

- **Review Gate:** Plannotator approval records `review_approved`; feedback records `review_feedback`.
- **Readiness Gate:** approved `FEATURE` plans promote directly to `ready_for_work`; approved PROJECT Epics promote to
  `ready_for_decomposition` and later to `ready_for_work` when the Slicer finalizes child FEATURE plans. Legacy non-Epic
  PROJECT plans promote only after the Slicer produces a valid task table.
- **Execution Gate:** execution can start only from `ready_for_work`, records `execution_started`, and captures an
  `executionBaselineTree` for scoped diffs and recovery.
- **Implementation Gate:** successful implementation records `implementation_finished` and moves the plan to
  `implemented`.
- **Workflow Validation Gate:** executable FEATURE and legacy non-Epic PROJECT plans run local validation plus semantic
  review. Passing validation records `validation_passed` and moves the plan to `verified`; failing validation records
  `validation_failed` while keeping the implementation state visible. PROJECT Epics are containers; their child FEATURE
  plans validate independently.

**Recovery:**

Loading an `in_progress`, `failed`, or `implemented` plan opens a recovery path rather than guessing what happened. The
user can inspect the scoped diff, continue from the current worktree, reset to the captured execution baseline tree and
retry, re-open the plan for review, or retry workflow validation when implementation already finished. Baseline-tree
recovery restores the worktree snapshot captured at execution start and records the corresponding recovery event before
execution resumes.

### 3.2 Advanced Memory & Indexing

- **Mnemosyne Integration:** (Active) A "Day Zero" memory system that gathers core memories, user preferences, and
  project architecture during `init`. Supports global and project-scoped persistent memory with `core` tagging for
  critical context.
- **Memory Maintenance:** Includes a `sleep` command for memory cleanup, organization, and optimization using built-in
  operator prompts.
- **Hybrid Indexing:** Fast structural mapping using `ripgrep` and `Tree-sitter`, with semantic search powered by
  `LanceDB`.
- **Project Brief:** A highly compressed "DNA" summary injected into every prompt to maintain context without bloat.

### 3.3 Dynamic Agent Specialization ("The Forge")

- **Base Agents:** Systems Architect, Product Manager, Documentation Writer, Coder, Debugger, Test Writer, Security
  Reviewer, Operator.
- **Customization:** Users can "plug in" skills to create specialized agents (e.g., "Playwright Test Writer").
- **Self-Evolution:** The agent must be capable of building its own specializations or extensions.

#### Agent Tool Policy

Every agent's capabilities are defined declaratively via a YAML frontmatter `tools` list in its agent definition file.
Tools are resolved using a layered override system with a strict allowlist policy.

**Definition format:**

```yaml
---
name: router
model: super-smart-9000
description: "Triage agent that classifies user requests."
tools:
    - read
    - grep
      ...
---

System prompt goes here. You can use the tools defined above to perform actions.
```

**Layered override precedence (highest wins):**

1. **Local overrides:** `./.hns/agents/<agent>.md`
2. **Home overrides:** `~/.hns/agents/<agent>.md`
3. **Bundled defaults:** `src/agent-definitions/<agent>.md`

Each layer that defines a `tools` list replaces the lower layer's tool set entirely. Prompt bodies append by default
unless `promptOverride: true` is set.

**Protected tools:**

A core set of tools cannot be removed by any override. The protected set is computed per-agent as the intersection of:

- That agent's bundled (`src/agent-definitions/`) frontmatter tools, and
- The global `PROTECTED_TOOL_NAMES` list (exported from `src/tools/registry.js`).

If a bundled agent declares a protected tool in its frontmatter, it cannot be removed by any override. If a bundled
agent does not declare a protected tool, it is not granted to that agent.

**Final tool resolution:**

For each agent, effective tools = `merged_override_tools ∪ (bundled_tools ∩ PROTECTED_TOOL_NAMES)`.

This means:

- Overrides can add any tool (including user-installed extension tools).
- Overrides can remove non-protected bundled tools (e.g., `bash`, `edit`, `write`).
- Overrides cannot remove protected tools that were present in the bundled definition.
- At runtime, `toolNames` overrides can narrow the tool set but cannot add tools outside the effective set.
- At runtime, `customTools` (user-provided or extension tools) are always available when passed through the API.

**Example:**

If bundled `router.md` declares `[read, grep, find, ls, bash, triage_report]` and a local override declares
`tools: [read]`, the final tool set is:

```yaml
- read
- triage_report # protected (was in bundled frontmatter and in protected list)
```

`bash`, `grep`, `find`, and `ls` are removed because they are not in the protected list.

### 3.4 Multi-Model Broker

- **Mapping:** Configuration-based mapping of LLMs to tasks based on Price/Skill ratio.
- **Provider Support:** Support for Anthropic, OpenAI, Gemini, OpenCode Zen, Ollama, and LMStudio.
- **Provider-Specific Prompts:** Ability to tweak system prompts per provider/agent combo for quality optimization.

### 3.5 Skills & Tools

- **Open Standard:** Support for the skill open standard (used by Claude Code/OpenCode).
- **Layered Skill Discovery:** Load skills from local project, home, bundled, and external-compatible directories, with
  slash-command expansion that injects the full skill instructions only when explicitly invoked.
- **CLI Focus:** Favor CLI-based tools (e.g., `gh`, `glab`) over heavy MCP implementations.
- **MCP Plugin:** MCP support remains an optional, non-default plugin to avoid context pollution.

### 3.6 Safety & Guardrails

- **Git Awareness:** Mandatory check for a clean working tree. Offer to commit, stash, or bypass.
- **Shell Safety:** Integration of OS-level guardrails (e.g., `rbash` principles) and regex blacklists for destructive
  commands.
- **Governance Agent:** Optional "Architecture Guardrail" skill to check diffs against `GUIDELINES.md`.

## 4. Technical Stack

- **CLI Environment:** Deno (for security and native permissions).
- **Frontend/Dashboard:** Potential Astro integration for visual plan reviews and Plannotator wrapping.
- **Persistence:** SQLite/LanceDB for local indexing and Mnemosyne storage.
- **Versioning & Recovery:** Capture git tree snapshots at execution start for scoped diffs, workflow validation, and
  baseline-tree recovery, with Git Worktree isolation available for separating agent execution from the primary
  workspace.

## 5. Success Metrics

- **Token Efficiency:** Reduction in average prompt context compared to competitors.
- **Success Rate:** Percentage of tasks successfully executed without manual plan revision.
- **Speed to First Plan:** Latency from prompt to the delivery of an actionable blueprint.
