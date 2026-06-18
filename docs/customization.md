# Customization

Harns keeps Pi's customizable terminal-agent foundation and adds Harns-specific layers for agents, prompts, skills,
settings, and themes.

For the full upstream concepts, see:

- [Pi Settings](https://pi.dev/docs/latest/settings)
- [Pi Skills](https://pi.dev/docs/latest/skills)
- [Pi Prompt Templates](https://pi.dev/docs/latest/prompt-templates)
- [Pi Themes](https://pi.dev/docs/latest/themes)

## Layering model

Harns resolves customization in this order:

1. Project-local `.hns/`
2. Home `~/.hns/`
3. Bundled defaults in the Harns install

Project-local resources override home resources, which override bundled resources.

## Settings

Settings live at:

- global: `~/.hns/settings.json`
- project: `.hns/settings.json`

Project settings override global settings. See [Settings Reference](settings.md).

## Agents

Agent definitions are Markdown files. Harns looks for them in:

1. `.hns/agents/`
2. `~/.hns/agents/`
3. bundled `src/agent-definitions/`

Use agent overrides when you want to change prompts, role behavior, or tool access for a project or user.

## Prompt templates

Prompt templates can become slash commands when they do not collide with built-in commands.

Harns loads prompts from:

1. `.hns/prompts/`
2. `~/.hns/prompts/`
3. bundled `src/prompt-templates/`

Run `/reload` after editing prompts in an active session.

## Skills

Harns loads skills from:

1. project skills: `.hns/skills/`
2. home skills: `~/.hns/skills/`
3. bundled skills: `src/skills/`
4. external ecosystem skills: `~/.agents/skills/`

Each skill lives in a directory with a `SKILL.md` file. Skills are advertised by name and description, and full
instructions are loaded when invoked.

## Themes

Harns includes an embedded `catppuccin-mocha` theme and supports theme packages from npm, git, or local paths.

```bash
hns theme --list
hns theme <name>
hns install npm:<package-spec>
hns install git:<repo-url>
hns install local:<path>
hns remove <source>
```

See [Themes](themes.md).

## Reloading changes

Use `/reload` in the TUI after changing settings, instructions, prompts, skills, models, themes, or memories.
