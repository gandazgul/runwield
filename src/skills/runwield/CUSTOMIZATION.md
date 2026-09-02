# Customization

Use this file for customization questions. Link to https://github.com/gandazgul/runwield/blob/main/docs/customization.md
for depth.

## Layering model

RunWield resolves project `.wld/` overrides before home `~/.wld/` overrides before bundled defaults.

Resolution lists:

- Agents: `.wld/agents/`, `~/.wld/agents/`, bundled `src/agent-definitions/`.
- Prompt templates: `.wld/prompts/`, `~/.wld/prompts/`, bundled `src/prompt-templates/`, installed Pi package
  `pi.prompts`.
- Skills: `.wld/skills/`, `~/.wld/skills/`, bundled `src/skills/`, external `~/.agents/skills/`.

## Agent overrides

Agent definition scalar Front Matter values override by precedence. A `tools` key fully replaces the lower-layer tool
list. Agent prompts append by default; set `promptOverride: true` when the higher layer must replace the lower prompt
instead.

## Prompt templates

Put user prompt templates in `~/.wld/prompts/` or project templates in `.wld/prompts/`. The filename becomes the slash
command name. RunWield Core resolves the slash command in TUI, Workspace, and ACP sessions.

Prompt Template Front Matter can set `agent`, `model`, and `thinkingLevel` for one auxiliary turn. Missing `agent`
defaults to Operator. Invalid execution fields fail before a model call. The compact slash command stays visible in the
Session, while Core stores the exact resolved expansion for resume.

A prompt template cannot override a built-in slash command name. RunWield warns at startup when an installed package
prompt is blocked by a built-in command collision. Use `/reload` after editing prompt files in an active TUI.

Copy bundled templates for examples: `code-optimizer`, `code-review`, `commit`, and `release`.

## Skills

A skill is a directory with `SKILL.md`. A user invokes it with `/skill:<name>`. The Skill expands into the current
Agent's normal turn and keeps that Agent, model, thinking level, workflow tools, and active workflow working directory.
If the user wants to write one, point them to the bundled `write-a-skill` skill instead of improvising authoring advice.
That skill explains invocation, descriptions, progressive disclosure, and pruning.

Bundled skills:

- `agent-browser-use`: headed browser feedback loop for frontend and browser behavior.
- `codebase-design`: vocabulary for deep modules, seams, and interface design.
- `diagnose`: reproduce, minimize, hypothesize, instrument, fix, and regression-test bugs.
- `documentation`: write or update Markdown project docs from source evidence.
- `front-end-framework-use`: convention-first frontend JavaScript, HTML, and CSS work.
- `handoff`: prepare durable handoffs between agents or sessions.
- `improve-codebase-architecture`: scan architecture and present deepening opportunities.
- `prompt-writing`: write or tighten LLM prompts and agent instructions.
- `prototype`: build throwaway prototypes for state, business logic, or UI options.
- `research`: capture source-backed research findings as Markdown.
- `resolving-merge-conflicts`: resolve in-progress merge or rebase conflicts.
- `runwield`: answer user-facing questions about RunWield and `wld`.
- `tdd`: use a red-green-refactor loop.
- `write-a-skill`: create predictable agent skills.
- `write-tests`: write, update, or repair automated tests.

## Project instructions

`wld init` explores the repository, writes `docs/domain-language.md`, and stores durable project Memory. Project
instructions are read from `RUNWIELD.md` or `AGENTS.md` in the project root. Global instructions are read from
`~/.wld/RUNWIELD.md` or `~/.wld/AGENTS.md`.

## Themes and reload

Themes are selected with `/theme` or `wld theme`. Package themes can be installed with `wld install` and removed with
`wld remove`. Use `/reload` after changing settings, instructions, prompts, skills, models, themes, or memories. Reload
re-scans Prompt Template and Skill layers, rebuilds the active Agent, and replaces autocomplete data only after success.
