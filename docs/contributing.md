# Contributing

Thanks for helping improve Harns. Harns is source-available and accepts issues and pull requests, but it is not open
source yet. Before contributing, read the [license](../LICENSE).

## Start with the design docs

Harns has strong workflow opinions. Before changing behavior, read the docs that explain the current model:

### Architecture Decision Records

- [ADR 000: Initial Tech Stack](adr/000-initial-tech-stack.md)
- [ADR 001: Codebase Optimization Types and Handlers](adr/001-codebase-optimization-types-and-handlers.md)
- [ADR 002: Two-Tier Tool System](adr/002-two-tier-tool-system.md)
- [ADR 003: Plan Recovery Baseline Tree](adr/003-plan-recovery-baseline-tree.md)
- [ADR 004: Plan Lifecycle Event Module](adr/004-plan-lifecycle-event-module.md)
- [ADR 005: Concurrent Worktree Isolation](adr/005-concurrent-worktree-isolation.md)

### PRDs

- [Collaborative Planning PRD](prd/collaborative-planning-PRD.md)
- [Project Decomposition PRD](prd/project-decomposition-PRD.md)
- [Theme Extensions PRD](prd/theme-extensions.md)

### Related reference docs

- [Plan Lifecycle](plan-lifecycle.md)
- [Settings Reference](settings.md)
- [Themes](themes.md)

## Development setup

Contributors use Deno.

```bash
deno task cli "your request"
deno task check
deno task test
deno task ci
deno task compile
```

`deno task ci` runs check, lint, format check, and tests.

Development and interactive workflow testing use these binaries in `PATH`:

- [`mnemosyne`](https://github.com/gandazgul/mnemosyne) for memory-backed agent behavior.
- [`cymbal`](https://github.com/1broseidon/cymbal) for code intelligence.
- [`snip`](https://github.com/edouard-claude/snip) for compact command-output rewriting. Harns runtime treats Snip as
  optional and ships bundled filters for compact `deno fmt`, `deno lint`, and `deno test` output.

  **How Harns integrates Snip at runtime:**

  During session setup (`src/shared/session/session.js`), Harns checks whether `snip` is on `PATH`. If found, it
  registers the `snipExtension` from `src/extensions/snip/index.js` as a `tool_call` event handler.

  The extension listens for agent-initiated `bash` tool calls and prefixes simple eligible commands with
  `SNIP_CONFIG=~/.hns/snip/config.toml snip run --`. Harns materializes its bundled Deno filters under
  `~/.hns/snip/filters/` and writes `~/.hns/snip/config.toml` so Harns-invoked Snip runs can use those filters without
  project-local `.snip` files. The extension skips non-`bash` tools, empty commands, commands already prefixed with
  `snip`, and shell builtins such as `cd`. If Snip is missing or setup fails for any reason, the original command runs
  unchanged (fail-open). Manual `!`/`!!` shell shortcuts are never rewritten — the hook only intercepts programmatic
  agent bash tool calls.

## Code style

- Write pure JavaScript (`.js`). Do not add TypeScript files.
- Use JSDoc for types. Do not use TypeScript syntax in executable code.
- Keep CLI entry points thin. Command behavior belongs under `src/cmd/<command>/` and shared behavior belongs under
  `src/shared/`.
- Preserve the layered customization model: project `.hns/` overrides home `~/.hns/`, which overrides bundled defaults.
- Keep docs and plans as Markdown.

## Project structure

```text
src/
  agent-definitions/   bundled agent markdown definitions
  cmd/                 command handlers and registry
  extensions/          Cymbal and Mnemosyne integrations
  prompt-templates/    bundled slash-command prompt templates
  shared/
    interactive/       TUI chat loop, slash dispatch, keybindings
    models/            model registry and validation
    session/           agent/session loading and execution
    ui/                TUI components and theme glue
    workflow/          triage dispatch, plan execution, validation
  skills/              bundled skill definitions
  tools/               Harns-specific agent tools
plans/                 persisted plans
docs/                  ADRs, PRDs, and feature docs
```

## Pull request checklist

1. Create a branch.
2. Make focused changes.
3. Update docs when behavior changes.
4. Run `deno task ci` for code changes.
5. For docs-only or config-only changes, run `deno fmt`.
6. Open a PR with:
   - a summary,
   - the affected routing intent or flow (`INQUIRY`, `IDEATION`, `QUICK_FIX`, `FEATURE`, or `PROJECT`),
   - validation notes,
   - any follow-up work or known gaps.

## Workflow expectations

Harns itself is plan-by-default for non-trivial work. Contributions should preserve that product shape:

- `INQUIRY` handling should stay answer-focused through Guide.
- `IDEATION` handling should clarify ideas through Ideator before routing implementation work.
- `QUICK_FIX` work should stay small and self-verified.
- `FEATURE` work should be traceable to a reviewable plan when the blast radius is non-trivial.
- `PROJECT` work should be represented as an Epic: Architect owns the design, interactive Slicer owns child FEATURE
  boundaries, and execution happens through those child FEATURE plans.
- Workflow validation should remain an independent acceptance gate for saved plan execution.

## License note

Harns is source-available and free to use, inspect, and run for personal, internal, or commercial work. You may submit
issues and pull requests.

You may not distribute modified versions, publish derivative works, rebrand Harns, or offer it as a competing product or
service without prior written permission.
