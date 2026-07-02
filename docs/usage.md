# Using RunWield

This page covers daily RunWield usage and the places where RunWield differs from Pi.

For editor features, terminal shortcuts, image paste, file references, shell commands, and message queue behavior that
RunWield inherits from Pi, see [Pi Usage](https://pi.dev/docs/latest/usage) and
[Pi Keybindings](https://pi.dev/docs/latest/keybindings).

## Default workflow: Router first

The default CLI command is `router`:

```bash
wld "fix the bug in the parser"
wld router "fix the bug in the parser"
```

Router is the default Agent for fresh triage. It calls `triage_report`, and that tool outcome starts the workflow:

| Routing intent | Use when                                            | Typical path                                                                                                          |
| -------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `INQUIRY`      | The user needs an answer, explanation, or guidance. | Guide answers directly and can return to Router if the request becomes executable work.                               |
| `IDEATION`     | The user wants to explore or sharpen an idea.       | Ideator interviews, researches, and produces a PRD or synthesis before routing implementation back through Router.    |
| `OPERATION`    | Direct non-code repository/environment work.        | Operator executes directly and self-verifies; no RunWield validation loop runs afterward.                             |
| `QUICK_FIX`    | Bounded no-plan code implementation.                | Engineer implements directly, then RunWield runs Mechanical Validation only.                                          |
| `FEATURE`      | Non-trivial implementation needs a reviewable plan. | Planner writes a plan, user approves it, Engineer executes it, RunWield validates it.                                 |
| `PROJECT`      | Large work needs architecture and slicing.          | Architect designs the Epic, interactive Slicer creates child FEATURE plans, execution proceeds one feature at a time. |

## Interactive sessions

Start an interactive session with:

```bash
wld
```

A new interactive session starts with Router. After `triage_report` dispatches to Guide, Ideator, Operator, Planner,
Architect, or another specialist, that specialist remains the active root agent so follow-up messages stay in the same
working context.

Use:

- `/new` to start a fresh routed session.
- `/agent router` to send the next message in the same session back through Router.
- `/resume` to browse recent sessions.
- `/session` to inspect the active session.

### Image attachments with text-only models

If the active model supports image input, RunWield sends pasted images directly to it. If the active model is text-only,
configure [`visionFallback.model`](settings.md#visionfallback) to let RunWield save pasted images as session attachments
and expose the `see_image` tool to the active agent. Without a configured fallback, image paste/submission is blocked
with a link back to the `visionFallback` settings section.

## Agents

List agents:

```bash
wld agent
```

Talk directly to one agent:

```bash
wld agent engineer "implement the approved plan"
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
wld plans
```

Load a plan by name or path:

```bash
wld load-plan my-feature
wld load-plan plans/my-feature.md
```

Loading a plan lets you inspect it, continue work, recover failed work, or re-open review depending on the plan status.

Plans live under `plans/` and use Markdown plus YAML front matter. RunWield treats the plan file as durable workflow
state, not just a generated note.

PROJECT plans are Epic containers by default. Loading an approved or decomposing Epic opens the interactive Slicer so
you can discuss child FEATURE boundaries and materialize drafts under `plans/<epic-name>/`. Once decomposition is
finalized, loading the Epic offers child FEATURE selection; loading a child FEATURE runs the normal FEATURE review,
execution, validation, and recovery flow.

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
| `/name`          | Set or show the current session name.                                         |
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
wld help                         # global help
wld help <command>               # command help
wld version                      # version and platform architecture
wld router "request"             # explicit routing
wld agent [name] [request]       # list or use agents
wld model <provider>/<model_id>  # switch model
wld plans                        # list plans
wld load-plan <name-or-path>     # continue a plan
wld init                         # initialize project context
wld sleep                        # memory/context cleanup prompt
wld theme <name>                 # set theme
wld theme --list                 # list themes
wld install <source>             # install a theme package
wld remove <source>              # remove a theme package
```

## File references and shell commands

RunWield inherits Pi's TUI behavior:

- Type `@` to fuzzy-search project files.
- Use `!command` to run a shell command and send output to the model.
- Use `!!command` to run a shell command without adding output to model context.
- Use the Pi editor shortcuts for multiline input, external editor, and queued messages.

Full details: [Pi Usage](https://pi.dev/docs/latest/usage).

## Project data locations

RunWield uses RunWield-owned paths instead of Pi-owned paths:

| Data                         | Location                                   |
| ---------------------------- | ------------------------------------------ |
| Global settings              | `~/.wld/settings.json`                     |
| Credentials                  | `~/.wld/auth.json`                         |
| Custom models                | `~/.wld/models.json`                       |
| Sessions                     | `~/.wld/sessions/`                         |
| Global RunWield instructions | `~/.wld/RUNWEILD.md` or `~/.wld/AGENTS.md` |
| Home agents                  | `~/.wld/agents/`                           |
| Home prompts                 | `~/.wld/prompts/`                          |
| Project settings             | `.wld/settings.json`                       |
| Project agents               | `.wld/agents/`                             |
| Project prompts              | `.wld/prompts/`                            |
| Project plans                | `plans/`                                   |

On first use, RunWield imports some Pi config files into `~/.wld/` when the RunWield copy does not exist.
