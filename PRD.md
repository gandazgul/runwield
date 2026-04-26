# Product Requirements Document (PRD): Project "Harns"

## 1. Vision & Strategy

**Harns** is an opinionated, developer-first coding harness designed for deep
architectural alignment and token efficiency. It moves beyond "chat-and-hope" AI
by enforcing a "Plan-by-Default" philosophy, utilizing persistent project
memory, and treating the SDLC as a series of intentional gates.

## 2. Core Philosophies

- **Plan-by-Default:** Most tasks start with structural planning rather than
  immediate code execution.
- **Token Parsimony:** Minimize context pollution. Spend tokens upfront
  (indexing/init) to save them during every subsequent turn.
- **Architectural Intent:** Provide specialized agents (Architect, PM, Coder,
  etc.) that respect the project's "Gravity Centers."
- **Session Persistence:** Branching, tree-based session states that can span
  days and survive interruptions.

## 3. Core Features & Functional Requirements

### 3.1 Adaptive Path Engine (The Router)

The system must automatically triage incoming requests into one of three paths:

- **Quick Fix:** Troubleshooting and rapid changes with no upfront decisions.
  Uses Debugger or Execution agents. Exception for operational tasks (e.g.,
  "deploy to prod") which don't require a plan.
- **Feature:** Requires upfront clarification and a structured plan (inspired by
  Plannotator.ai). Can be decomposed into dependent tasks.
- **Project:** Large-scale changes or new initiatives. Requires a dedicated
  **Explore Agent** for context gathering and an **Architect Agent** for a
  formal proposal.

### 3.2 Advanced Memory & Indexing

- **Mnemosyne Integration:** (Active) A "Day Zero" memory system that gathers core memories, user preferences, and project architecture during `init`. Supports global and project-scoped persistent memory with `core` tagging for critical context.
- **Memory Maintenance:** Includes a `sleep` command for memory cleanup, organization, and optimization using built-in operator prompts.
- **Hybrid Indexing:** Fast structural mapping using `ripgrep` and `Tree-sitter`, with semantic search powered by `LanceDB`.
- **Project Brief:** A highly compressed "DNA" summary injected into every prompt to maintain context without bloat.

### 3.3 Dynamic Agent Specialization ("The Forge")

- **Base Agents:** Systems Architect, Product Manager, Documentation Writer,
  Coder, Debugger, Test Writer, Security Reviewer, Operator.
- **Customization:** Users can "plug in" skills to create specialized agents
  (e.g., "Playwright Test Writer").
- **Self-Evolution:** The agent must be capable of building its own
  specializations or extensions.

### 3.4 Multi-Model Broker

- **Mapping:** Configuration-based mapping of LLMs to tasks based on Price/Skill
  ratio.
- **Provider Support:** Support for Anthropic, OpenAI, Gemini, OpenCode Zen,
  Ollama, and LMStudio.
- **Provider-Specific Prompts:** Ability to tweak system prompts per
  provider/agent combo for quality optimization.

### 3.5 Skills & Tools

- **Open Standard:** Support for the skill open standard (used by Claude
  Code/OpenCode).
- **CLI Focus:** Favor CLI-based tools (e.g., `gh`, `glab`) over heavy MCP
  implementations.
- **MCP Plugin:** MCP support remains an optional, non-default plugin to avoid
  context pollution.

### 3.6 Safety & Guardrails

- **Git Awareness:** Mandatory check for a clean working tree. Offer to commit,
  stash, or bypass.
- **Shell Safety:** Integration of OS-level guardrails (e.g., `rbash`
  principles) and regex blacklists for destructive commands.
- **Governance Agent:** Optional "Architecture Guardrail" skill to check diffs
  against `GUIDELINES.md`.

## 4. Technical Stack

- **CLI Environment:** Deno (for security and native permissions).
- **Frontend/Dashboard:** Potential Astro integration for visual plan reviews
  and Plannotator wrapping.
- **Persistence:** SQLite/LanceDB for local indexing and Mnemosyne storage.
- **Versioning:** Support for Git Worktrees to isolate agent execution from the
  primary workspace.

## 5. Success Metrics

- **Token Efficiency:** Reduction in average prompt context compared to
  competitors.
- **Success Rate:** Percentage of tasks successfully executed without manual
  plan revision.
- **Speed to First Plan:** Latency from prompt to the delivery of an actionable
  blueprint.
