# Using Harns

This page covers daily Harns usage and the places where Harns differs from Pi.

For editor features, terminal shortcuts, image paste, file references, shell commands, and message queue behavior that
Harns inherits from Pi, see [Pi Usage](https://pi.dev/docs/latest/usage) and
[Pi Keybindings](https://pi.dev/docs/latest/keybindings).

## Default workflow: Router first

The default CLI command is `router`:

```bash
hns "fix the bug in the parser"
hns router "fix the bug in the parser"
```

Router is the default Agent for fresh triage. It calls `triage_report`, and that tool outcome starts the workflow:

| Classification | Use when                                            | Typical path                                                                                        |
| -------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `QUICK_FIX`    | Small, low-risk changes or questions.               | Operator executes directly and self-verifies.                                                       |
| `FEATURE`      | Non-trivial implementation needs a reviewable plan. | Planner writes a plan, user approves it, Engineer executes it, Harns validates it.                  |
| `PROJECT`      | Large work needs architecture and slicing.          | Architect designs the epic, Slicer decomposes it into feature plans, execution proceeds by feature. |

## Interactive sessions

Start an interactive session with:

```bash
hns
```

A new interactive session starts with Router. After `triage_report` dispatches to a specialist, that specialist remains
the active root agent so follow-up messages stay in the same working context.

Use:

- `/new` to start a fresh routed session.
- `/agent router` to send the next message in the same session back through Router.
- `/resume` to browse recent sessions.
- `/session` to inspect the active session.

## Agents

List agents:

```bash
hns agent
```

Talk directly to one agent:

```bash
hns agent engineer "implement the approved plan"
```

Inside the TUI:

```text
/agent engineer
```

Specific Agent usage bypasses the default Router prompt. Use it when you intentionally do not want fresh triage.

User-selectable bundled agent definitions live in `src/agent-definitions/` and can be overridden by home or project
definitions. Workflow-only pseudo-agents such as Slicer and Reviewer are loaded from workflow prompts and do not appear
in normal `/agent` listings. See [Customization](customization.md).

## Plans

List saved plans:

```bash
hns plans
```

Load a plan by name or path:

```bash
hns load-plan my-feature
hns load-plan plans/my-feature.md
```

Loading a plan lets you inspect it, continue work, recover failed work, or re-open review depending on the plan status.

Plans live under `plans/` and use Markdown plus YAML front matter. Harns treats the plan file as durable workflow state,
not just a generated note.

See [Plans and workflows](workflows.md) and [Plan Lifecycle](plan-lifecycle.md).

## Slash commands

Type `/` in the editor for completion.

| Command          | Description                                                                   |
| ---------------- | ----------------------------------------------------------------------------- |
| `/login`         | Configure subscription or API-key credentials.                                |
| `/logout`        | Remove stored credentials.                                                    |
| `/status`        | Show configured providers and available models.                               |
| `/model`         | Switch active model.                                                          |
| `/agent`         | Switch active agent.                                                          |
| `/init`          | Initialize the current project.                                               |
| `/load-plan`     | Continue a saved plan.                                                        |
| `/resume`        | Browse and resume a recent session.                                           |
| `/new`           | Start a new root session.                                                     |
| `/session`       | Show current session information.                                             |
| `/sleep`         | Run the bundled sleep prompt for memory/context cleanup.                      |
| `/compact`       | Compact session context.                                                      |
| `/theme`         | Pick a theme.                                                                 |
| `/reload`        | Reload settings, instructions, prompts, skills, models, themes, and memories. |
| `/export`        | Export the current session to HTML or JSONL.                                  |
| `/share`         | Export and upload the session as a secret GitHub Gist.                        |
| `/quit`, `/exit` | Exit.                                                                         |

Prompt templates and skills can also appear as slash commands. See [Customization](customization.md).

## CLI commands

```bash
hns help                         # global help
hns help <command>               # command help
hns version                      # version and platform architecture
hns router "request"             # explicit routing
hns agent [name] [request]       # list or use agents
hns model <provider>/<model_id>  # switch model
hns plans                        # list plans
hns load-plan <name-or-path>     # continue a plan
hns init                         # initialize project context
hns sleep                        # memory/context cleanup prompt
hns theme <name>                 # set theme
hns theme --list                 # list themes
hns install <source>             # install a theme package
hns remove <source>              # remove a theme package
```

## File references and shell commands

Harns inherits Pi's TUI behavior:

- Type `@` to fuzzy-search project files.
- Use `!command` to run a shell command and send output to the model.
- Use `!!command` to run a shell command without adding output to model context.
- Use the Pi editor shortcuts for multiline input, external editor, and queued messages.

Full details: [Pi Usage](https://pi.dev/docs/latest/usage).

## Project data locations

Harns uses Harns-owned paths instead of Pi-owned paths:

| Data                      | Location                                |
| ------------------------- | --------------------------------------- |
| Global settings           | `~/.hns/settings.json`                  |
| Credentials               | `~/.hns/auth.json`                      |
| Custom models             | `~/.hns/models.json`                    |
| Sessions                  | `~/.hns/sessions/`                      |
| Global Harns instructions | `~/.hns/HARNS.md` or `~/.hns/AGENTS.md` |
| Home agents               | `~/.hns/agents/`                        |
| Home prompts              | `~/.hns/prompts/`                       |
| Project settings          | `.hns/settings.json`                    |
| Project agents            | `.hns/agents/`                          |
| Project prompts           | `.hns/prompts/`                         |
| Project plans             | `plans/`                                |

On first use, Harns imports some Pi config files into `~/.hns/` when the Harns copy does not exist.
