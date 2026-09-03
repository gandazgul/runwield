# Contributing

Thanks for helping improve RunWield. RunWield is source-available and accepts issues and pull requests, but it is not
open source yet. Before contributing, read the [license](../LICENSE).

## Start with the design docs

RunWield has strong workflow opinions. Before changing behavior, read the docs that explain the current model:

- [Core Architecture](architecture.md) maps the runtime boundary, workflow orchestration, Plan lifecycle, validation,
  persistence, and source guide.
- [Entity Model](entity-model.md) maps durable entities, transient workflow objects, adapter projections, and storage
  authorities.
- [Plan Lifecycle](plan-lifecycle.md) explains Plan statuses, events, validation, repair, and delivery.
- [Settings Reference](settings.md) documents configuration files, precedence, and commands.
- [Themes](themes.md) and the [Design System](design-system.md) cover user-facing UI conventions.

Product and architecture history:

- [ADRs](adr/) hold Architecture Decision Records. Read the relevant ADRs for any architectural seam you touch.
- [PRDs](prd/) hold product requirements and living specifications. Start with
  [RunWield Core PRD](prd/runwield-core-prd.md) when behavior affects routing, sessions, plans, validation, Workspace,
  or core agent policy.

## Development setup

Contributors use Deno. Common commands:

```bash
deno task cli "your request"
deno task check
deno task test
deno task ci
deno task compile
```

`deno task ci` starts the eight pre-test gates together: submodule checks, Snip filter checks, Deno checks, Workspace
checks, lint, language-policy checks, seam checks, and doc-link checks. Tests start only after all eight gates pass. The
test task still uses `scripts/write-version.js` and the safe `scripts/run-tests.js` runner. Always use `deno task test`
or `deno run -A scripts/run-tests.js <deno test args>` for tests; do not run `deno test` directly, because the test
runner sandboxes `HOME` and process-global state per file.

The ordinary test task does not include the Golden TUI Scenario portfolio; it is too slow for the everyday loop.
`deno task test` excludes `src/ui/tui/golden-scenarios` and `src/ui/tui/testing`, and `deno task test:golden-tui` runs
exactly those. `deno task pr:check` is the full gate — `deno task ci` followed by the portfolio — and it is the same
command the GitHub PR workflow runs. `deno task test:golden-tui:extensive` is the release-tier alias, which
`deno task release:check` runs.

Interactive RunWield sessions expect these helper binaries in `PATH`:

- [`mnemoteca`](https://github.com/gandazgul/mnemoteca) for memory-backed agent behavior.
- [`cymbal`](https://github.com/1broseidon/cymbal) for code intelligence.
- [`agent-browser`](https://github.com/vercel-labs/agent-browser) for browser-driven UI/UX verification.
- [`snip`](https://github.com/edouard-claude/snip) for compact command-output rewriting. Snip is optional at runtime and
  fail-open, but local validation tasks may invoke it when installed by the standard setup path.

The installer is the normal recovery path for missing helper binaries. RunWield also ships bundled Snip filters for Deno
validation output; install or remove user-level copies with:

```bash
wld snip-filters install
wld snip-filters cleanup
```

## Codebase guide

Use this as an orientation map, not a directory inventory:

- `src/cli.ts` is the executable entry point and command dispatch module. It delegates command behavior to handlers
  registered from `src/cmd/`.
- `src/cmd/` owns CLI command boundaries such as `router`, `load-plan`, `plans`, `workspace`, `init`, settings, auth,
  and install/update helpers.
- `src/shared/session/` is the live Session runtime center of gravity: hosted sessions, agent construction, transcript
  segments, adapter-neutral events, and continuation control.
- `src/shared/workflow/` owns routing decisions, Plan approval/execution orchestration, lifecycle transitions,
  mechanical and semantic validation, repairs, and Epic/FEATURE flow.
- `src/shared/` also contains cross-cutting project state, settings, model/resource handling, collaboration, worktrees,
  work records, and runtime preflight helpers.
- `src/agent-definitions/`, `src/prompt-templates/`, and `src/skills/` are the bundled agent, slash-prompt, and skill
  layers. Project `.wld/` overrides home `~/.wld/`, which overrides these bundled defaults.
- `src/extensions/` contains runtime integrations for Mnemoteca, Cymbal, and Snip. Keep integration-specific tools,
  hooks, and tests isolated there when practical.
- `src/tools/` contains RunWield-specific agent tools that are not better owned by an extension package.
- `src/ui/tui/` is the terminal adapter. `src/ui/workspace/`, `src/review-workspace-server.js`, and `src/ui/review/` are
  the browser Workspace and review surfaces. Shared visual language belongs in `src/ui/design-system/` and
  `src/ui/theme/`.
- `docs/plans/` stores durable Plan Markdown. `docs/` (outside `docs/plans/`) stores user, contributor, architecture,
  ADR, PRD, and product docs.

## Golden TUI Scenarios

Golden TUI Scenarios are deterministic, Playwright-like regression tests for the composed terminal UI and workflow
runtime. Run them with:

```bash
deno task test:golden-tui
# release-tier alias, run by deno task release:check
deno task test:golden-tui:extensive
```

Each test file runs in its own sandboxed process. That is most of the portfolio's wall time and is what keeps the
scenarios isolated, but it also made the portfolio too expensive for `deno task ci`, which every change waits on. The
portfolio now runs at the two slower gates instead:

- `deno task pr:check` locally and the `pr-gate` GitHub workflow on every pull request.
- `deno task release:check` locally and in the release workflow's `release-check` job.

Run `deno task test:golden-tui` yourself whenever you change the TUI or the workflow runtime; `deno task ci` alone will
not catch a composed scenario regression.

Author scenarios under `src/ui/tui/golden-scenarios/` and shared harness helpers under `src/ui/tui/testing/`:

- use hand-written scenario scripts and assertions; do not use raw Session Transcript JSONL as the scenario format;
- drive user behavior through terminal actions or the public Golden runner, not by reaching into private TUI blocks;
- keep expected answers, scripts, images, and fixtures outside the temporary Project root when an Agent's tools could
  discover them;
- declare coverage capabilities on scenarios and back each declaration with an assertion wrapped by
  `assertCoverageWith`;
- prefer semantic assertions: normalized screen text, Runtime events, Plan metadata, workflow outcomes, worktree/Git
  facts, Session replacement identity, validation evidence, Work Records, and cleanup state;
- normalize unstable UUIDs, paths, ports, durations, commit hashes, and animation frames only at comparison/reporting
  edges.

When diagnosing a failure, inspect the retained artifact path in the thrown error. Golden diagnostics should identify
the scenario, active Agent/phase, recent Runtime activity, last normalized screen, remaining scripted turns, and durable
temp state. Update expected output only when the user-visible workflow behavior intentionally changed; do not weaken a
scenario to bypass a real Runtime, workflow, Plan Review, validation, worktree, or TUI defect.

Golden TUI Scenarios are not browser Plan Review tests, live-model benchmarks, ACP parity tests, or true-PTY smoke
tests. Browser behavior remains owned by Workspace/Playwright coverage; future PTY smoke tests should stay as a thin
startup/raw-terminal layer rather than replacing these deterministic scenarios.

## Bundled runtime extensions

Runtime integrations live under `src/extensions/`. They are loaded as Pi extension factories during Agent Session setup.

- `src/extensions/mnemoteca/` adds memory recall, storage, and deletion tools backed by Mnemoteca.
- `src/extensions/cymbal/` adds code search, symbol lookup, impact analysis, and tracing tools backed by Cymbal.
- `src/extensions/snip/` adds a fail-open `tool_call` hook that prefixes eligible agent `bash` commands with Snip.

Keep extension behavior isolated to the extension package where practical. Session wiring should decide whether an
extension is available and register it; the extension should own its event handlers, tool definitions, command
rewriting, and focused tests.

## Code style

- New production source files should be TypeScript (`.ts` or `.tsx` as appropriate). Existing JavaScript with JSDoc is
  still valid; do not force-convert unrelated files, but migrate JS files when you are already touching them for source
  changes and the migration is reasonably bounded.
- Keep Deno-native execution. Use real file extensions in imports, do not add a `tsc` emit pipeline for runtime code,
  and let `deno check`/CI be the type gate.
- Do not use `any`, `unknown`, or bare `object` in TypeScript types. Define named object shapes instead of inline
  complex types.
- In remaining JavaScript, use JSDoc for types. Prefer `@typedef` for object shapes and type function parameters in the
  `@param` block rather than adding casts or body-local `@type` declarations.
- Keep CLI entry points thin. Command behavior belongs under `src/cmd/<command>/`; shared behavior belongs under
  `src/shared/` or the narrower center of gravity that owns it.
- Resolve home and cwd through `getHomeDir()` and `getCwd()` from `src/constants.js` in `src/`. Do not read
  `Deno.env.get("HOME")` or `Deno.cwd()` directly in source, and do not cache process-global state at module scope.
- Wrap tests that mutate `HOME` or the working directory in `withProcessGlobalTestLock` from
  `src/testing/process-global-lock.js`.
- Preserve the layered customization model: project `.wld/` overrides home `~/.wld/`, which overrides bundled defaults.
- Keep docs, plans, ADRs, PRDs, and Work Records as Markdown.

## Pull request checklist

1. Create a branch.
2. Make focused changes.
3. Update docs when behavior changes.
4. Run `deno task ci` for code changes.
5. For docs-only or config-only changes, run `deno fmt` at minimum.
6. Open a PR with:
   - a summary,
   - the affected routing intent or flow (`INQUIRY`, `IDEATION`, `OPERATION`, `QUICK_FIX`, `PLANNED_CHANGE`, or
     `PROJECT`),
   - validation notes,
   - any follow-up work or known gaps.

## Workflow expectations

RunWield itself is plan-by-default for non-trivial work. Contributions should preserve that product shape:

- `INQUIRY` handling should stay answer-focused through Guide.
- `IDEATION` handling should clarify ideas through Ideator before routing implementation work.
- `OPERATION` work should stay non-code and self-verified by Operator.
- `QUICK_FIX` work should stay small, code-bounded, and pass Mechanical Validation after Engineer completion.
- `PLANNED_CHANGE` work should be traceable to a reviewable plan when the blast radius is non-trivial.
- `PROJECT` work should be represented as an Epic: Architect owns the design, interactive Slicer owns child
  PLANNED_CHANGE boundaries, and execution happens through those child PLANNED_CHANGE plans.
- Workflow validation should remain an independent acceptance gate for saved plan execution.

## License note

RunWield is source-available and free to use, inspect, and run for personal, internal, or commercial work. You may
submit issues and pull requests.

You may not distribute modified versions, publish derivative works, rebrand RunWield, or offer it as a competing product
or service without prior written permission.
