# RunWield Documentation

RunWield is an opinionated coding harness built on top of [Pi](https://pi.dev). It keeps Pi's terminal-first agent
experience, then adds explicit triage, durable plans, role-scoped agents, workflow validation, project memory, and plan
recovery.

Use these docs for RunWield-specific behavior. When a topic behaves the same as Pi, this index links to the upstream
[Pi documentation](https://pi.dev/docs/latest) instead of duplicating it.

## Get Started

### 1. Install RunWield

On macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/gandazgul/runwield/main/install.sh | bash
```

The installer downloads the `wld` binary and installs it to `~/.local/bin` by default. Make sure that directory is on
your `PATH`.

Contributors can also run from source:

```bash
deno run -A src/cli.js help
deno task compile
./bin/wld help
```

### 2. Install runtime helpers

RunWield works best when these optional-but-expected binaries are available on `PATH`:

- [`mnemosyne`](https://github.com/gandazgul/mnemosyne) for project and global memory.
- [`cymbal`](https://github.com/1broseidon/cymbal) for code search, symbol lookup, impact analysis, and tracing.
- [`snip`](https://github.com/edouard-claude/snip) for compact command-output rewriting. Snip is optional and fail-open.

### 3. Authenticate a model provider

Start an interactive session and run:

```text
/login
```

Then choose a subscription provider or API-key provider. RunWield stores credentials under `~/.wld/auth.json`.

You can also configure providers and custom models manually in `~/.wld/models.json`, for example when using Ollama,
vLLM, LM Studio, API proxies, or custom model entries. RunWield uses Pi's model/provider system, so the full provider
and model configuration format is documented in [Pi Providers](https://pi.dev/docs/latest/providers) and
[Pi Custom Models](https://pi.dev/docs/latest/models). See [RunWield providers](providers.md) for the RunWield-specific
storage paths and commands.

### 4. Initialize a project

Run RunWield from the project root:

```bash
wld init
```

`wld init` explores the repository, writes `CONTEXT.md`, stores durable project memory, and records that the project has
been initialized. You can also run `/init` inside the TUI.

### 5. Start with Router

The default command is `router`, so these are equivalent:

```bash
wld "fix the failing parser test"
wld router "fix the failing parser test"
```

Router is the default Agent for fresh triage. Its `triage_report` assigns one routing intent:

- `INQUIRY` - answer directly through Guide for general help, explanations, and repository questions.
- `IDEATION` - hand off to Ideator for interviews, research, PRDs, or idea sharpening before implementation planning.
- `OPERATION` - execute direct non-code repository/environment work through Operator.
- `QUICK_FIX` - implement bounded no-plan code work through Engineer, followed by Mechanical Validation.
- `FEATURE` - write a reviewable plan before implementation.
- `PROJECT` - design the larger effort as an Epic, then interactively slice it into independently executable child
  FEATURE plans.

## General Usage

### Work through the router by default

Use `wld "request"` when you want RunWield to choose the right workflow. Router records the routing intent through
`triage_report`; implementation intents also record complexity and affected paths. That tool outcome hands off to Guide,
Ideator, Operator, Engineer, Planner, or Architect as appropriate.

### Talk to a specific agent when you know what you need

```bash
wld agent                  # list agents
wld agent engineer "..."   # start with Engineer instead of Router
```

Inside the TUI, use `/agent <name>` to switch agents.

User-selectable bundled agents include `router`, `guide`, `ideator`, `operator`, `planner`, `architect`, `engineer`, and
`tester`. RunWield also uses workflow-only pseudo-agents such as Slicer and Reviewer during plan readiness and
validation; they do not appear in normal `/agent` listings.

Documentation work no longer has a dedicated agent. It is handled through the bundled `documentation` skill, which any
agent (Operator, Engineer, etc.) loads automatically when a task involves updating Markdown project docs. The full list
of bundled skills is available under [`docs/customization.md`](customization.md).

### Use plans for non-trivial work

Plans are Markdown files under `plans/` with YAML front matter. List and resume them with:

```bash
wld plans
wld load-plan <name-or-path>
```

PROJECT plans are Epic containers. After review, the interactive Slicer helps split an Epic into child FEATURE plans
under `plans/<epic-name>/`; each child then moves through the normal review, execution, validation, and recovery states.
See [Plans and workflows](workflows.md) and [Plan Lifecycle](plan-lifecycle.md).

### Use slash commands in the TUI

Type `/` to open command completion. Common commands:

| Command                                | Purpose                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `/login`, `/logout`, `/status`         | Manage model credentials.                                                     |
| `/model`                               | Switch active model.                                                          |
| `/agent`                               | Switch active agent.                                                          |
| `/init`                                | Initialize the current project.                                               |
| `/load-plan`                           | Continue a saved plan.                                                        |
| `/resume`, `/new`, `/name`, `/session` | Manage sessions.                                                              |
| `/compact`                             | Compact the current session context.                                          |
| `/theme`                               | Pick a theme.                                                                 |
| `/reload`                              | Reload settings, instructions, prompts, skills, models, themes, and memories. |
| `/export`, `/share`                    | Export or share a session.                                                    |
| `/quit`                                | Exit.                                                                         |

For editor behavior, message queue behavior, file references, shell commands, and terminal shortcuts that match Pi, see
[Pi Using Pi](https://pi.dev/docs/latest/usage) and [Pi Keybindings](https://pi.dev/docs/latest/keybindings). See
[Using RunWield](usage.md) for RunWield-specific differences.

## Documentation TOC

### RunWield basics

- [Quickstart](quickstart.md) - install, authenticate, initialize, and run the first routed request.
- [Using RunWield](usage.md) - day-to-day commands, routing, agents, plans, and TUI differences from Pi.
- [Plans and workflows](workflows.md) - triage classes, plan review, execution, validation, and recovery.
- [Sessions](sessions.md) - RunWield session paths, root-agent behavior, resume, and compaction notes.
- [Providers and models](providers.md) - RunWield credential/config paths and links to Pi provider setup.
- [Customization](customization.md) - settings, agent overrides, prompts, skills, and themes.
- [Contributing](contributing.md) - development setup, contribution guidelines, ADRs, and PRDs.

### RunWield reference

- [Settings Reference](settings.md) - global/project settings and RunWield custom keys.
- [Themes](themes.md) - RunWield theme package behavior and theme files.
- [Plan Lifecycle](plan-lifecycle.md) - durable plan and worktree state machine.
- [Router Model Selection](router-model-selection.md) - evaluation findings for the Router model choice.
- [Compaction Research](compaction-research.md) - research notes for context compaction behavior.

### Pi docs that mostly apply unchanged

RunWield inherits Pi's terminal UI and much of its model/provider, session, theme, and customization infrastructure. Use
these upstream docs for full detail:

- [Pi documentation home](https://pi.dev/docs/latest)
- [Pi Quickstart](https://pi.dev/docs/latest/quickstart)
- [Pi Usage](https://pi.dev/docs/latest/usage)
- [Pi Providers](https://pi.dev/docs/latest/providers)
- [Pi Settings](https://pi.dev/docs/latest/settings) - pair with [RunWield Settings Reference](settings.md).
- [Pi Keybindings](https://pi.dev/docs/latest/keybindings)
- [Pi Sessions](https://pi.dev/docs/latest/sessions) - pair with [RunWield Sessions](sessions.md).
- [Pi Compaction](https://pi.dev/docs/latest/compaction)
- [Pi Skills](https://pi.dev/docs/latest/skills) - pair with [RunWield Customization](customization.md).
- [Pi Prompt Templates](https://pi.dev/docs/latest/prompt-templates)
- [Pi Themes](https://pi.dev/docs/latest/themes) - pair with [RunWield Themes](themes.md).
- [Pi Terminal Setup](https://pi.dev/docs/latest/terminal-setup)
- [Pi tmux](https://pi.dev/docs/latest/tmux)
- [Pi Windows](https://pi.dev/docs/latest/windows)
- [Pi Termux](https://pi.dev/docs/latest/termux)
