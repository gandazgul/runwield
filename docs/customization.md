# Customization

RunWield keeps Pi's customizable terminal-agent foundation and adds RunWield-specific layers for agents, prompts,
skills, settings, and themes.

For the full upstream concepts, see:

- [Pi Settings](https://pi.dev/docs/latest/settings)
- [Pi Skills](https://pi.dev/docs/latest/skills)
- [Pi Prompt Templates](https://pi.dev/docs/latest/prompt-templates)
- [Pi Themes](https://pi.dev/docs/latest/themes)

## Layering model

RunWield resolves customization in this order:

1. Project-local `.wld/`
2. Home `~/.wld/`
3. Bundled defaults in the RunWield install

Project-local resources override home resources, which override bundled resources.

## Settings

Settings live at:

- global: `~/.wld/settings.json`
- project: `.wld/settings.json`

Project settings override global settings. See [Settings Reference](settings.md).

## Agents

Agent definitions are Markdown files. RunWield looks for them in:

1. `.wld/agents/`
2. `~/.wld/agents/`
3. bundled `src/agent-definitions/`

Use agent overrides when you want to change prompts, role behavior, or tool access for a project or user.

## Prompt templates

Prompt templates can become slash commands when they do not collide with built-in commands. RunWield Core resolves and
runs these commands for TUI, Workspace, and ACP sessions. The surface sends the raw slash text, such as
`/commit staged
changes`, and Core stores that compact command while sending the resolved template body to the model.

RunWield loads prompts from:

1. `.wld/prompts/`
2. `~/.wld/prompts/`
3. bundled `src/prompt-templates/`
4. installed Pi package `pi.prompts` resources

Prompt Template Front Matter can include:

```yaml
description: "Explain the current diff"
argument-hint: "<focus>"
agent: operator
model: anthropic/claude-sonnet-4
thinkingLevel: low
```

Templates render into ordinary user messages in the current Session. Their front matter applies normal Session settings:
`agent`, `model` (a `provider/model` reference), and `thinkingLevel`. Omitted fields inherit the current Session's
selections. In a new Session with no explicit selections, the default is Operator with its configured model and thinking
level, so `wld /commit` works without front matter. Changing Agent loads that Agent's defaults, then applies explicit
template model and thinking choices. Applied settings persist for follow-up messages and resume. Invalid settings fail
before the expanded message is submitted.

During an unfinished workflow, including planning before a Plan exists, a template that requests a different Agent
offers **Open in new session** or **Cancel**. Opening a new Session runs the template there and preserves the original
workflow Session for resume. Canceling sends nothing and changes no settings. A client without this interaction tells
the user to start a new Session. Templates that keep the workflow Agent run normally, including normal workflow tools
and validation. Model and thinking changes alone do not interrupt workflow ownership. There is no temporary Agent,
automatic switch back, or special template completion boundary.

Installed package prompts are passive Markdown templates. They do not need the code-extension compatibility marker, but
they cannot override built-in slash command names. RunWield warns at startup when a package prompt is blocked by a
built-in command collision. Run `/reload` after editing prompts in an active session.

## Skills

RunWield loads skills from:

1. project RunWield skills: `.wld/skills/`
2. project external skills: `.agents/skills/`
3. home RunWield skills: `~/.wld/skills/`
4. home external skills: `~/.agents/skills/`
5. bundled skills: `src/skills/`

The first eligible published name or directory alias wins. A project external Skill can therefore replace a home `.wld`
Skill only when the name does not conflict with a bundled Skill. Skills in either `.agents` folder are excluded when
their published name or directory alias conflicts with a bundled Skill. Use project or home `.wld/skills` for an
intentional bundled override. Set `enableExternalSkills` to `false` to omit both `.agents` folders.

Each skill lives in a directory with a `SKILL.md` file. Skills are advertised by name and description, and full
instructions are loaded when invoked with `/skill:<name>`. A Skill invocation expands into the current Agent's ordinary
turn. It does not select another Agent, and it keeps the current model, thinking level, workflow tools, and active
workflow working directory. RunWield ignores Pi-configured, package, and extension Skill catalogs.

Bundled skills include `documentation` (Markdown project docs), `diagnose` (disciplined bug diagnosis), `prototype`
(throwaway prototypes to validate design), `improve-codebase-architecture` (visual architecture review and deepening),
`codebase-design` (shared deep-module vocabulary and interface design), `research` (source-backed Markdown research
notes), `review` (user-requested PR and change reviews against standards and spec), `wizard` (terminal wizards for
human-only external setup), `write-a-skill` (creating new agent skills), `runwield` (user-facing RunWield and `wld`
usage answers), and `agent-browser-use` (headed browser feedback loop for frontend work). The `documentation` skill is
the replacement for the former dedicated docs-writer agent. Skill availability is separate from file-mutation
capability: writable agents use their normal tools for documentation work, while Guide has restricted `write_docs` and
`edit_docs` tools only for explicit requests to preserve or update ordinary `.md` documents from an ongoing Guide
conversation.

## Themes

RunWield includes an embedded `catppuccin-mocha` theme and supports theme packages from npm, git, or local paths.

```bash
wld theme --list
wld theme <name>
wld install npm:<package-spec>
wld install git:<repo-url>
wld install local:<path>
wld remove <source>
```

See [Themes](themes.md).

## Reloading changes

Use `/reload` in the TUI after changing settings, instructions, prompts, skills, models, themes, or memories. Reload
re-scans Prompt Template and Skill layers, rebuilds the active Agent, and replaces the TUI autocomplete and collision
data only after the reload succeeds.
