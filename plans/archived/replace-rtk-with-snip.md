---
planId: "4e2360fb-4fbc-419d-b79f-a7bcf77baa9e"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Replace RTK with Snip for command rewriting. This involves renaming/updating the RTK extension to use Snip, updating tests, updating documentation, and creating a `.snip.yaml` configuration file to handle Deno output cleaning."
affectedPaths:
    - "src/extensions/rtk/index.js"
    - "src/extensions/rtk/index.test.js"
    - "README.md"
    - ".snip.yaml"
createdAt: "2026-06-21T23:58:59-04:00"
updatedAt: "2026-07-17T04:50:01.896Z"
status: "verified"
origin: "internal"
implementedAt: "2026-06-22T04:50:46.367Z"
verifiedAt: "2026-06-22T05:01:11.046Z"
workRecord:
    status: "generated"
    recordId: "d19376ea-2d87-4fff-bc8d-49706ebdfef0"
    path: "docs/work-records/2026-07-17-replaced-rtk-command-rewriting-with-snip.md"
    lastAttemptAt: "2026-07-17T04:49:53.582Z"
routingIntent: "FEATURE"
---

# Replace RTK With Snip

## Context

Harns currently has an optional RTK integration: if `rtk` is on `PATH`, Harns registers `src/extensions/rtk/index.js`
and rewrites agent `bash` tool calls through RTK. The request is to remove RTK entirely, use
[`snip`](https://github.com/edouard-claude/snip) instead, and ship Harns with Deno Snip filters because Snip does not
currently include filters for `deno fmt`, `deno lint`, or `deno test`.

## Objective

Replace RTK with Snip, with no backwards compatibility:

- No RTK extension, settings, state helper names, banner text, or docs.
- If `snip` is installed, agent bash commands are run through Snip.
- Harns bundles Deno Snip filters and installs/materializes them into a Harns-owned Snip filter directory.
- Harns does not require `snip trust` for its bundled Deno filters.

## Approach

Keep the change direct:

1. Rename the runtime optimizer integration from RTK to Snip.
2. Replace RTK's `rewrite` call with Harns-side command prefixing to `snip run -- ...`.
3. Bundle three Deno Snip filter YAML files in `src/snip-filters/` and copy them to `~/.hns/snip/filters/` when Snip is
   available.
4. Run Harns-invoked Snip with a generated config at `~/.hns/snip/config.toml` that includes both the user's normal Snip
   filter dir and Harns' bundled Deno filter dir.

Only simple shell commands should be rewritten. If a command is empty, non-bash, already starts with `snip`, or starts
with a shell builtin like `cd`, leave it unchanged. This avoids breaking command chains like `cd repo && deno test`.
Manual `!` / `!!` shell commands remain unaffected because the extension only handles agent `tool_call` events.

## Files to Modify

- `src/extensions/rtk/` — delete; no compatibility wrapper.
- `src/extensions/snip/index.js` — new Snip tool-call extension.
- `src/extensions/snip/index.test.js` — tests for command prefixing/skips/fail-open behavior.
- `src/shared/session/session.js` — register Snip extension when `snip` exists.
- `src/shared/runtime-preflight.js` / `src/shared/runtime-preflight.test.js` — replace `hasRtkBinary()` with
  `hasSnipBinary()`.
- `src/shared/settings.js` — remove `rtkExcludedBinaries` and `getRtkExcludedBinaries()`.
- `src/shared/interactive/boot-banner.js` / `.test.js` — show/warn about Snip instead of RTK.
- `src/cmd/init/init-state.js` / `.test.js` — rename missing optimizer counters/functions from RTK to Snip; no
  migration/aliases.
- `src/snip-filters/deno-fmt.yaml` — bundled Deno fmt filter.
- `src/snip-filters/deno-lint.yaml` — bundled Deno lint filter.
- `src/snip-filters/deno-test.yaml` — bundled Deno test filter.
- `src/shared/snip-filters.js` / `.test.js` — copy bundled filters to `~/.hns/snip/filters/` and write
  `~/.hns/snip/config.toml`.
- `scripts/compile.js` / `.test.js` — include `src/snip-filters` in compiled binary assets.
- `README.md`, `docs/index.md`, `docs/quickstart.md`, `docs/contributing.md` — update docs from RTK to Snip and mention
  bundled Deno filters.

## Reuse Opportunities

- Existing RTK extension/test structure for the event hook and test harness.
- Existing optional runtime preflight pattern.
- Existing boot banner optimizer slot.
- Existing `scripts/compile.js` `--include` pattern for bundled assets.
- Snip upstream YAML filter patterns: `streams`, `strip_ansi`, `keep_lines`, `remove_lines`, `compact_path`,
  `truncate_lines`, `head`, `aggregate`, `on_empty`.

## Implementation Steps

- [ ] Step 1: Add bundled Deno filters
  - Add `src/snip-filters/deno-fmt.yaml` for `deno fmt` and `deno fmt --check` output.
  - Add `src/snip-filters/deno-lint.yaml` for `deno lint` diagnostics.
  - Add `src/snip-filters/deno-test.yaml` for `deno test` pass/fail output.
  - Include inline Snip filter `tests:` examples where practical.
  - Include `src/snip-filters` in `scripts/compile.js` and update compile tests.

- [ ] Step 2: Materialize filters for Snip
  - Add `src/shared/snip-filters.js` with `ensureHarnsSnipFilters()`.
  - Copy bundled YAML files to `~/.hns/snip/filters/` idempotently.
  - Write `~/.hns/snip/config.toml` with filter dirs for `~/.config/snip/filters` and `~/.hns/snip/filters`.
  - Test with temp paths so real user files are not touched.

- [ ] Step 3: Replace RTK extension with Snip extension
  - Move/replace `src/extensions/rtk/` with `src/extensions/snip/`.
  - On session start, ensure bundled Snip filters are materialized.
  - Rewrite simple agent `bash` commands to `SNIP_CONFIG=<harns-config> snip run -- <command>`.
  - Preserve leading env assignments when practical.
  - Skip non-bash, empty, already-Snip, and shell-builtin commands.

- [ ] Step 4: Rename runtime wiring
  - Rename `hasRtkBinary()` to `hasSnipBinary()`.
  - Register `snipExtension` in `src/shared/session/session.js` when Snip is present.
  - Remove RTK settings/state names with no aliases or migrations.
  - Update boot banner text/tests to Snip.

- [ ] Step 5: Update docs and remove RTK traces
  - Replace RTK docs with Snip docs.
  - Explain Harns bundles Deno Snip filters under `~/.hns/snip/` and does not require project `snip trust`.
  - Search Harns-owned source/docs/tests for RTK references and remove them.

- [ ] Step 6: Validate
  - Run focused tests.
  - Run full CI.

## Verification Plan

- Automated:
  - `deno test -A src/shared/snip-filters.test.js src/extensions/snip/index.test.js src/shared/runtime-preflight.test.js src/shared/interactive/boot-banner.test.js src/cmd/init/init-state_test.js scripts/compile.test.js`
  - `deno task ci`
  - If `snip` is installed after materialization: `SNIP_CONFIG=$HOME/.hns/snip/config.toml snip verify`.
  - `rg -i '\\brtk\\b' src docs README.md deno.json` should return no semantic Harns references.

- Manual:
  - Start Harns with `snip` in `PATH`; banner shows `Snip`.
  - Confirm Harns creates/updates `~/.hns/snip/filters/*.yaml` and `~/.hns/snip/config.toml` without `snip trust`.
  - Agent `bash` call for `deno test` runs through `snip run -- deno test` with Harns `SNIP_CONFIG`.
  - Start Harns without `snip`; app still works and warning mentions Snip.

## Edge Cases & Considerations

- Do not preserve RTK names, aliases, settings, or migrations.
- Do not require project-local `.snip` or `snip trust` for Harns' bundled filters.
- Prefix only safe/simple commands; skip ambiguous shell commands rather than risk changing behavior.
- Generated Snip config should include the user's normal Snip filter dir so user filters still work during Harns-invoked
  Snip runs.
- Implementation must be pure `.js` with JSDoc typing only.
- Full CI is required after implementation (`deno task ci`).
