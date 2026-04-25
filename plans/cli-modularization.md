# Plan: Modularize `src/cli.js`

## Context
- The current CLI implementation is concentrated in `src/cli.js` and currently handles argument parsing, command routing, and all command flows in one file.
- Requested outcomes:
  1. Use `parseArgs` from `@std/cli/parse-args` for parsing `Deno.args`.
  2. Split each command into its own module under `cmd/[command]/`.
  3. Extract shared constants into `src/constants.js` with docs.
  4. Move router behavior into `cmd/router/` and make it the default command (`cli.js <prompt>` == `cli.js router <prompt>`).
  5. Add `--help` usage output.

## Approach
- Introduce a command-module structure under `src/cmd/[command]/` and keep `src/cli.js` as a lightweight entrypoint.
- Parse `Deno.args` with `parseArgs` from `@std/cli/parse-args` in a two-stage flow:
  - Stage 1 (global parse): detect `--help` / `help` and identify command token.
  - Stage 2 (command parse): each command handles its own args/options and `--help` output.
- Route unknown/omitted command tokens to the router command so:
  - `cli.js "prompt"` and `cli.js router "prompt"` are equivalent.
- Keep this refactor dependency-light (no new CLI framework for now); use `parseArgs` + a small internal command registry for command metadata and help rendering.
- Centralize shared constants (paths, enums, usage/help text constants, shared tool lists) into `src/constants.js` with docs.
- Ensure backward compatibility for existing flows (`resume`, `plans`, and prompt-first usage).

## Files to modify
- `src/cli.js`
- `src/constants.js` (new)
- `src/cmd/router/index.js` (new)
- `src/cmd/resume/index.js` (new)
- `src/cmd/plans/index.js` (new)
- `src/cmd/help/index.js` (new; global help command)
- `src/cmd/_shared/` modules as needed (new; shared command utilities/contracts)
- `deno.json` (import map update is required for `@std/cli/parse-args`)
- `README.md` (usage/help updates)

## Reuse
- `runSession(...)` in `src/cli.js` should be reused as a shared orchestration utility (likely moved to `src/cmd/_shared/session.js`).
- Existing flow handlers in `src/cli.js` to reuse/split with minimal logic change:
  - `handleResume(...)`
  - `handleListPlans(...)`
  - router triage + classification path logic currently in `main()`
- Existing utility modules to preserve:
  - `src/plan-store.js`
  - `src/tools/triage-report.js`
  - `src/tools/submit-plan.js`
- Discovery note: `@std/cli/parse-args` is not currently in the import map, so `deno.json` needs an entry (or equivalent direct JSR import strategy).

## Steps
- [ ] Audit current `src/cli.js` responsibilities and map to command boundaries.
- [ ] Add/confirm `@std/cli/parse-args` import configuration in `deno.json`.
- [ ] Define command contract for `src/cmd/[command]/index.js` modules (metadata + `run()` handler + command help text).
- [ ] Add `parseArgs`-based global parsing and command dispatch in `src/cli.js`.
- [ ] Implement `src/cmd/help/` for global `help` and command help lookup.
- [ ] Move router/default prompt flow into `src/cmd/router/`.
- [ ] Move `resume` flow into `src/cmd/resume/`.
- [ ] Move `plans` flow into `src/cmd/plans/`.
- [ ] Extract shared constants to `src/constants.js` and add inline docs for each constant group.
- [ ] Implement per-command `--help`/`help` handling (`router`, `resume`, `plans`).
- [ ] Update README usage examples for new explicit `router` command and help entrypoints.

## Verification
- Run type check:
  - `deno check src/cli.js`
- Manual command checks:
  - `deno run -A src/cli.js --help`
  - `deno run -A src/cli.js help`
  - `deno run -A src/cli.js help resume`
  - `deno run -A src/cli.js resume --help`
  - `deno run -A src/cli.js plans --help`
  - `deno run -A src/cli.js router --help`
  - `deno run -A src/cli.js router "<request>"`
  - `deno run -A src/cli.js "<request>"` (must match router behavior)
  - `deno run -A src/cli.js resume <plan-name-or-path>`
  - `deno run -A src/cli.js plans`
- Smoke-test one QUICK_FIX and one FEATURE request path to ensure routing still works end-to-end.

## Decisions captured
- Command modules will live in `src/cmd/[command]/...`.
- Help UX will include both:
  - global help (`--help`, `help`), and
  - per-command help (`help <command>`, `<command> --help`).
- Router/default behavior will support exactly these two equivalent forms:
  - `deno run -A src/cli.js "<prompt>"`
  - `deno run -A src/cli.js router "<prompt>"`
- Keep implementation simple for now: no additional CLI framework (no yargs/cliffy adoption in this change).
