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

Prompt templates can become slash commands when they do not collide with built-in commands.

RunWield loads prompts from:

1. `.wld/prompts/`
2. `~/.wld/prompts/`
3. bundled `src/prompt-templates/`
4. installed Pi package `pi.prompts` resources

Installed package prompts are passive Markdown templates. They do not need the code-extension compatibility marker, but
they cannot override built-in slash command names. RunWield warns at startup when a package prompt is blocked by a
built-in command collision. Run `/reload` after editing prompts in an active session.

## Skills

RunWield loads skills from:

1. project skills: `.wld/skills/`
2. home skills: `~/.wld/skills/`
3. bundled skills: `src/skills/`
4. external ecosystem skills: `~/.agents/skills/`

Each skill lives in a directory with a `SKILL.md` file. Skills are advertised by name and description, and full
instructions are loaded when invoked.

Bundled skills include `documentation` (Markdown project docs), `ketch` (web search and doc lookup), `diagnose`
(disciplined bug diagnosis), `prototype` (throwaway prototypes to validate design), `improve-codebase-architecture`
(visual architecture review and deepening), `codebase-design` (shared deep-module vocabulary and interface design),
`research` (source-backed Markdown research notes), and `write-a-skill` (creating new agent skills). The `documentation`
skill is the replacement for the former dedicated docs-writer agent — any agent can load it when a task involves
updating Markdown documentation.

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

Use `/reload` in the TUI after changing settings, instructions, prompts, skills, models, themes, or memories.
