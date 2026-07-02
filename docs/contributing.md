# Contributing

Thanks for helping improve RunWield. RunWield is source-available and accepts issues and pull requests, but it is not
open source yet. Before contributing, read the [license](../LICENSE).

## Start with the design docs

RunWield has strong workflow opinions. Before changing behavior, read the docs that explain the current model:

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
- [`snip`](https://github.com/edouard-claude/snip) for compact command-output rewriting. RunWield runtime treats Snip as
  optional and ships bundled filters for compact `deno check`, `deno fmt`, `deno lint`, and `deno test` output.

  **How RunWield integrates Snip at runtime:**

  During session setup (`src/shared/session/session.js`), RunWield checks whether `snip` is on `PATH`. If found, it
  registers the `snipExtension` from `src/extensions/snip/index.js` as a `tool_call` event handler.

  The extension listens for agent-initiated `bash` tool calls and prefixes simple eligible commands with `snip run --`.
  The bundled Deno filters are installed into Snip's default user filter directory by the installer or by
  `wld snip-filters install`, so RunWield does not maintain a separate Snip config. The extension skips non-`bash`
  tools, empty commands, commands already prefixed with `snip`, and shell builtins such as `cd`. If Snip is missing or
  setup fails for any reason, the original command runs unchanged (fail-open). Manual `!`/`!!` shell shortcuts are never
  rewritten — the hook only intercepts programmatic agent bash tool calls.

  To make the bundled Deno filters available to plain Snip commands, run `wld snip-filters install`. This copies
  RunWield-managed filters into `~/.config/snip/filters/` without overwriting non-RunWield files. Remove those
  user-level copies with `wld snip-filters cleanup`.

  **Why RunWield uses Snip instead of RTK:**

  RunWield switched from RTK to Snip because runtime command optimization must preserve agent trust in command output.
  RTK's caching and aggressive truncation made some workflows worse: cached `git` output can hide fresh repository
  state, and truncated test or CI output can make the model rerun commands or search for alternate evidence, spending
  more tokens than the compression saved.

  RunWield-owned Snip filters should optimize for decision-quality output, not maximum compression. For stateful
  commands like `git status`, `git diff`, and `git log`, freshness is more important than savings. For validation
  commands, success output should collapse to a clear pass summary; failure output should keep the actionable diagnostic
  detail rather than leaving the agent to guess what failed. Snip is a better fit because it is an extensible filter
  engine: command behavior lives in declarative YAML filters that can be added, tested, overridden, and reviewed without
  growing special cases in RunWield core.

## Bundled runtime extensions

Runtime integrations live under `src/extensions/`. They are loaded as Pi extension factories during Agent Session setup
in `src/shared/session/session.js`.

- `src/extensions/mnemosyne/` adds memory recall, storage, and deletion tools backed by Mnemosyne.
- `src/extensions/cymbal/` adds code search, symbol lookup, impact analysis, and tracing tools backed by Cymbal.
- `src/extensions/snip/` adds a fail-open `tool_call` hook that prefixes eligible agent `bash` commands with Snip.

Keep extension behavior isolated to the extension package where practical. Session wiring should decide whether an
extension is available and register it; the extension should own its event handlers, tool definitions, command
rewriting, and focused tests.

## Code style

- Write pure JavaScript (`.js`). Do not add TypeScript files.
- Use JSDoc for types. Do not use TypeScript syntax in executable code.
- Keep CLI entry points thin. Command behavior belongs under `src/cmd/<command>/` and shared behavior belongs under
  `src/shared/`.
- Preserve the layered customization model: project `.wld/` overrides home `~/.wld/`, which overrides bundled defaults.
- Keep docs and plans as Markdown.

## Project structure

```text
src/
  agent-definitions/   bundled agent markdown definitions
  cmd/                 command handlers and registry
  extensions/          bundled runtime integrations for Mnemosyne, Cymbal, and Snip
  prompt-templates/    bundled slash-command prompt templates
  shared/
    interactive/       TUI chat loop, slash dispatch, keybindings
    models/            model registry and validation
    session/           agent/session loading and execution
    ui/                TUI components and theme glue
    workflow/          triage dispatch, plan execution, validation
  skills/              bundled skill definitions
  tools/               RunWield-specific agent tools
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
   - the affected routing intent or flow (`INQUIRY`, `IDEATION`, `OPERATION`, `QUICK_FIX`, `FEATURE`, or `PROJECT`),
   - validation notes,
   - any follow-up work or known gaps.

## Workflow expectations

RunWield itself is plan-by-default for non-trivial work. Contributions should preserve that product shape:

- `INQUIRY` handling should stay answer-focused through Guide.
- `IDEATION` handling should clarify ideas through Ideator before routing implementation work.
- `OPERATION` work should stay non-code and self-verified by Operator.
- `QUICK_FIX` work should stay small, code-bounded, and pass Mechanical Validation after Engineer completion.
- `FEATURE` work should be traceable to a reviewable plan when the blast radius is non-trivial.
- `PROJECT` work should be represented as an Epic: Architect owns the design, interactive Slicer owns child FEATURE
  boundaries, and execution happens through those child FEATURE plans.
- Workflow validation should remain an independent acceptance gate for saved plan execution.

## License note

RunWield is source-available and free to use, inspect, and run for personal, internal, or commercial work. You may
submit issues and pull requests.

You may not distribute modified versions, publish derivative works, rebrand RunWield, or offer it as a competing product
or service without prior written permission.
