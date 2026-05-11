# Harns — Context Overview

**Harns** (Plan-by-Default Coding Harness) is an AI-powered CLI and interactive TUI agent that helps developers plan,
implement, and execute coding tasks. It uses a triage-based workflow: a **Router** agent classifies incoming requests,
then dispatches them to specialized agents (Operator for quick fixes, Planner for features, Architect for projects).
Plans are persisted as markdown files with YAML front matter and can be reviewed via a browser-based UI (Plannotator).
The system is built on top of the `@earendil-works/pi-coding-agent` framework and uses **Cymbal** for codebase
indexing/search and **Mnemosyne** for persistent memory.

## Language

### Key Concepts

| Term                    | Definition                                                                                                                                                                   | Aliases to avoid                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Router**              | The triage agent that classifies user requests into QUICK_FIX, FEATURE, or PROJECT and dispatches to the appropriate downstream agent.                                       | Avoid calling it "dispatcher" or "orchestrator" in user-facing text. |
| **Operator**            | The execution agent for QUICK_FIX tasks — makes small, focused changes (edits, commits, config tweaks).                                                                      | Not "executor" or "runner".                                          |
| **Planner**             | Agent for FEATURE-classified requests — writes a plan, submits it for review, and upon approval triggers execution.                                                          |                                                                      |
| **Architect**           | Agent for PROJECT-classified requests — does deep exploration, writes structured plans with task tables, and coordinates parallel task execution.                            |                                                                      |
| **Engineer**            | Agent that executes approved plan bodies (for FEATURE) or individual tasks (for PROJECT).                                                                                    |                                                                      |
| **Triage**              | The classification step: assigns `classification` (QUICK_FIX/FEATURE/PROJECT), `complexity` (LOW/MEDIUM/HIGH), `summary`, and `affectedPaths`.                               |                                                                      |
| **Plan**                | A markdown file in `plans/` with YAML front matter (classification, complexity, status, etc.). Plans go through draft → in_review → approved/feedback → completed lifecycle. |                                                                      |
| **Plan-Written Tool**   | Custom tool (`plan_written`) that triggers the plan review lifecycle — opens browser UI, waits for user approval/feedback, returns outcome to the agent.                     |                                                                      |
| **Triage-Report Tool**  | Custom tool (`triage_report`) that the Router calls to emit its classification. Terminates the Router's turn and triggers orchestrator dispatch.                             |                                                                      |
| **Switch-Agent Tool**   | Custom tool (`switch_agent`) that lets an agent hand off to another agent mid-conversation.                                                                                  |                                                                      |
| **User-Interview Tool** | Custom tool (`user_interview`) for structured multi-question clarification flows.                                                                                            |                                                                      |
| **Cymbal**              | External binary for AST-aware code indexing, search, symbol tracing, and impact analysis.                                                                                    |                                                                      |
| **Mnemosyne**           | External binary for persistent semantic memory storage and retrieval (project + global scopes).                                                                              |                                                                      |
| **CWD**                 | Current working directory — used throughout as the project root. Stored in `src/constants.js`.                                                                               |                                                                      |
| **Prompt Template**     | Markdown files (in `src/prompt-templates/`, `~/.hns/prompts/`, or `<cwd>/.hns/prompts/`) that define slash commands available in the TUI.                                    | Not "slash command definition" — use "prompt template".              |
| **Agent Definition**    | Markdown files with YAML front matter defining an agent's name, model, tools, and system prompt.                                                                             | Not "agent config" — use "agent definition".                         |
| **Agent Name**          | The internal identifier for an agent, derived from the file name without the `.md` extension.                                                                                |                                                                      |
| **Agent Display Name**  | The human-readable name specified inside the front-matter of the agent definition. Used as the header when outputting agent messages.                                        |                                                                      |
| **Session Manager**     | From `@earendil-works/pi-coding-agent` — persists conversation history to disk (`~/.hns/sessions/`).                                                                         |                                                                      |

## Key Files

| File                                                   | Purpose                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `src/cli.js`                                           | CLI entry point — parses args, dispatches commands                                    |
| `src/cmd/registry.js`                                  | Central command registry mapping command names to handler functions and metadata      |
| `src/cli.js` → `commandRegistry[COMMAND_NAMES.ROUTER]` | Default route — launches the interactive TUI with the router orchestrator             |
| `src/cmd/router/index.js`                              | Router command handler — starts interactive session with triage flow                  |
| `src/shared/session/session.js`                        | Core `runAgentSession()` — orchestrates a single agent invocation end-to-end          |
| `src/shared/session/agents.js`                         | Agent definition loading, merging, and discovery across layered dirs                  |
| `src/shared/session/types.js`                          | Type definitions: AgentDefinition, AgentMessageHandler, SessionManagerLike            |
| `src/shared/session/direct-agent.js`                   | Creates a direct agent handler (bypasses router triage)                               |
| `src/shared/session/root-session.js`                   | Root session lifecycle — creates SessionManager, exports to HTML/JSONL                |
| `src/shared/session/session-state.js`                  | Mutable global state for the interactive session (active agent, model, UI API)        |
| `src/shared/workflow/orchestrator.js`                  | Post-triage dispatcher — reads triage outcome, routes to Operator/Planner/Architect   |
| `src/shared/workflow/workflow.js`                      | Plan execution logic — runs planning agents, executes plans, manages parallel tasks   |
| `src/shared/workflow/submit-plan.js`                   | Plan review submission — starts Plannotator server, opens browser, waits for decision |
| `src/plan-store.js`                                    | Plan persistence — front matter injection, save/load/list/resolve plans               |
| `src/tools/triage-report.js`                           | `triage_report` tool definition — emits structured classification                     |
| `src/tools/plan-written.js`                            | `plan_written` tool — plan review lifecycle (declare, review, approve, save)          |
| `src/tools/switch-agent.js`                            | `switch_agent` tool — agent hand-off mid-conversation                                 |
| `src/tools/user-interview.js`                          | `user_interview` tool — structured clarification questions                            |
| `src/tools/registry.js`                                | PROTECTED_TOOL_NAMES — tools that cannot be removed from an agent's tool list         |
| `src/extensions/cymbal/index.js`                       | Cymbal extension — wraps cymbal binary as code_search, code_trace, etc. tools         |
| `src/extensions/mnemosyne/index.js`                    | Mnemosyne extension — wraps mnemosyne binary as memory_recall, memory_store, etc.     |
| `src/shared/interactive/chat-session.js`               | Main TUI loop — manages editor, message rendering, slash commands, agent switching    |
| `src/shared/interactive/slash-dispatch.js`             | Routes `/command` submissions to built-in commands or prompt templates                |
| `src/shared/interactive/generation-guard.js`           | Generation gating — prevents stale async results from leaking into UI                 |
| `src/shared/ui/api.js`                                 | UiAPI factory — all UI interactions (messages, prompts, tool blocks, spinner)         |
| `src/shared/settings.js`                               | SettingsManager with Harns custom storage (global + project scoped)                   |
| `src/agent-definitions/*.md`                           | Bundled agent definitions (router, operator, planner, architect, engineer, etc.)      |
| `src/prompt-templates/*.md`                            | Bundled prompt templates (slash commands like /sleep, /grill-me, etc.)                |
| `src/skills/*/SKILL.md`                                | Bundled skill definitions                                                             |
| `deno.json`                                            | Project config — dependencies, tasks (ci, test, check, fmt, compile)                  |

## Patterns & Conventions

### Architecture

- **Thin CLI entry**: `src/cli.js` only parses global flags and delegates to `commandRegistry` handlers
- **All business logic lives in `src/cmd/<command>/index.js`** modules
- **Agent definitions** are markdown files with YAML front matter, layered: bundled < home (`~/.hns/agents/`) < local
  (`.hns/agents/`)
- **Prompt templates** follow the same layered priority: bundled < home (`~/.hns/prompts/`) < local (`.hns/prompts/`)
- **Extensions** (Cymbal, Mnemosyne) wrap external binaries as tools and register lifecycle hooks via `pi.on()` events

### Data Flow

1. User submits request via CLI or TUI editor
2. Router agent classifies via `triage_report` tool (QUICK_FIX / FEATURE / PROJECT)
3. Orchestrator reads triage outcome from message stream and dispatches to:
   - **QUICK_FIX** → Operator (direct execution)
   - **FEATURE** → Planner (writes plan, review, then Engineer executes)
   - **PROJECT** → Architect (deep exploration, structured plan with task table, parallel execution)
4. Plans are saved as `plans/<name>.md` with YAML front matter; lifecycle: draft → in_review → approved/feedback →
   completed
5. Plan review happens via Plannotator browser UI (in-process server)

### Tool System

- Tools are defined via `@earendil-works/pi-coding-agent`'s `defineTool()` with Zod-like schema from `@sinclair/typebox`
- **PROTECTED_TOOL_NAMES** (`src/tools/registry.js`) are always re-added to agents even if a higher layer narrows the
  tool list
- Custom tools (switch_agent, plan_written, triage_report, user_interview) are auto-wired when referenced in agent front
  matter
- Extension tools (cymbal, mnemosyne) register at session start via extension factories

### Coding Style

- JSDoc `@module`, `@typedef`, `@param`, `@returns` documentation throughout
- Named exports for testability (`runInitCommand`, `createRouterOrchestratorHandler`, etc.)
- Dependency injection via `options.__testDeps` for testing (mockable functions)
- `Deno` APIs used directly (no Node.js compatibility layer); `Deno.readTextFile`, `Deno.writeTextFile`, `Deno.readDir`,
  etc.
- Import map in `deno.json` uses `jsr:` and `npm:` specifiers
- Formatting: 4-space indent, 120-char line width (per `deno.json`)

### Error Handling

- Graceful fallbacks: file-not-found returns null, missing front matter gets defaults
- Extension warnings logged but don't crash (e.g., mnemosyne binary missing)
- Init state guard prevents duplicate init runs (with manual override via `~/.hns/init-state.json`)

### Testing

- Tests use Deno's built-in `Deno.test()` with `@std/assert` (assertEquals, assertMatch)
- Test files live alongside source as `__tests__/` directories or `*.test.js` / `*_test.js` patterns
- Tools tested via mock UiAPI and direct `executeTool()` calls
- Key test files: `switch-agent_test.js`, `user-interview_test.js`, `user-interview-combinations_test.js`,
  `plan-written_test.js`, `triage-report_test.js`

### CI / Deployment

- `deno task ci` runs: check → lint → fmt:check → test
- `deno task compile` builds the binary via `scripts/compile.js`
- `deno task cli` runs the CLI in source mode: `deno run -A src/cli.js`
- External dependencies: `mnemosyne` and `cymbal` binaries must be in PATH

### Memory & Persistence

- **Mnemosyne** stores project memories in `~/.mnemosyne/<project-name>/` and global memories in `~/.mnemosyne/global/`
- **Session state** persisted via `SessionManager` to `~/.hns/sessions/`
- **Settings** stored at `~/.hns/settings.json` (global) and `<cwd>/.hns/settings.json` (project)
- **Init state** tracked at `~/.hns/init-state.json` keyed by SHA-256(CWD)

### Front Matter Convention

- YAML front matter `---` blocks used in plans, agent definitions, and skill files
- Plan front matter fields: `classification`, `complexity`, `summary`, `affectedPaths`, `createdAt`, `updatedAt`,
  `status`, `origin`
- Agent definition front matter fields: `name`, `model`, `description`, `tools`, `promptOverride`
