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
- **Session Persistence:** Branching, tree-based session states that can span days and survive interruptions.

## 3. Core Features & Functional Requirements

### 3.1 The TUI Shell & Agent Workflows

The primary interface for Harns is the TUI Shell. It acts as a universal host for interacting with different agents. By
default, when the TUI opens, the user talks to the **Router** agent. The Router is not a special system wrapper; it is a
peer agent (like the Architect, Planner, or Coder) that simply acts as the default triage point.

**The Router (Adaptive Path Engine):** When active, the Router automatically triages incoming requests into one of three
paths:

- **Quick Fix:** Troubleshooting and rapid changes with no upfront decisions. Uses Debugger or Execution agents.
- **Feature:** Requires upfront clarification and a structured plan. Can be decomposed into dependent tasks.
- **Project:** Large-scale changes. The **Architect Agent** performs deep vertical-slice exploration and produces a
  formal proposal with task decomposition.

**Dynamic Agent Switching:** Users can switch the active agent they are conversing with using slash commands (e.g.
`/resume <plan>`). When `/resume` is invoked, the TUI drops the Router and connects the user directly to the Planner or
Architect agent managing that specific plan. This works seamlessly whether the TUI was already running or if it was
started via `hns resume <plan>`.

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
model: ollama-cloud/gemma4:31b-cloud
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
- **Versioning:** Support for Git Worktrees to isolate agent execution from the primary workspace.

## 5. Success Metrics

- **Token Efficiency:** Reduction in average prompt context compared to competitors.
- **Success Rate:** Percentage of tasks successfully executed without manual plan revision.
- **Speed to First Plan:** Latency from prompt to the delivery of an actionable blueprint.
