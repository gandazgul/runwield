---
planId: "0c7f7798-b7d2-4b32-8ff3-b4c9d7623336"
classification: "FEATURE"
complexity: "HIGH"
summary: "Rename Harns to RunWield with a clean break from hns/.hns/HARNS-era state, while preserving only the Router display name Harns and keeping the CLI binary as wld."
affectedPaths:
    - "src/cli.js"
    - "src/constants.js"
    - "src/shared/settings.js"
    - "src/shared/ui/boot-logo.js"
    - "src/shared/session/root-session.js"
    - "src/shared/models/model-registry.js"
    - "README.md"
    - "install.sh"
createdAt: "2026-06-22T22:20:48-04:00"
updatedAt: "2026-07-17T04:49:47.122Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-06-23T04:55:50.556Z"
workRecord:
    status: "generated"
    recordId: "cb5116f2-17d6-4457-acba-f661afe45a49"
    path: "docs/work-records/2026-07-17-rebranded-harns-to-runwield.md"
    lastAttemptAt: "2026-07-17T04:49:38.334Z"
routingIntent: "FEATURE"
---

# Rename Harns to RunWield

## Context

The product must be rebranded from Harns to RunWield for copyright reasons. The user specifically requested:

- Rename `harns`/`Harns`/`HARNS` occurrences to `runwield`/`RunWield`/`RUNWEILD`, respecting capitalization.
- Rename the installed CLI binary from `hns` to `wld`.
- Rename the global settings directory from `~/.hns` to `~/.wld`.
- Preserve the Router's display name as `Harns` as a nod to the project's origin.
- Replace the boot-logo `H.` shape with `W.` in the same block style, color, and blinking-dot behavior.
- Keep behavior otherwise unchanged.

**User override for review:** this is a clean break. `wld` must not know about or rescue old
`hns`/`.hns`/`HARNS.md`/`harns.active_agent` state. Do not implement migration, fallback reads, compatibility aliases,
old worktree rescue, or deprecated `HNS_*` installer environment variable support.

This is a cross-cutting rename that touches runtime paths, persisted state, docs, release packaging, tests, and agent
prompts.

## Objective

Implement a behavior-preserving rename so users invoke the tool as `wld`, see RunWield branding and docs, store new
global state under `~/.wld`, and still get the same routing/workflow/session behavior. The only intentional visible
legacy name is the Router agent's display name `Harns` in `src/agent-definitions/router.md`.

## Approach

Perform the rebrand in layers rather than a blind replace:

1. Centralize/rename constants first (`CLI_BIN`, directory names, worktree prefixes, version symbol) so runtime surfaces
   and generated strings become `wld`/`runwield` from shared values.
2. Rename persisted-path logic from `.hns` to `.wld` with no Harns compatibility migration/fallbacks. Existing one-time
   Pi migrations may continue only from Pi-owned `~/.pi/agent` into RunWield-owned paths; do not read or copy from
   `~/.hns`.
3. Rename user-facing strings, docs, comments, JSDoc symbols, test fixture values, and generated release asset names
   with capitalization preserved.
4. Rename context files from `HARNS.md` to `RUNWEILD.md`, while preserving `AGENTS.md` fallback behavior. Do not read
   legacy `HARNS.md` as a compatibility path.
5. Update boot logo arrays to render a block `W` plus blinking dot (`W.`), keeping the same `theme.fg("mdCode", ...)`
   styling, `dotOn`/`dotOff` animation, and interval behavior.
6. Sweep with targeted ripgrep to catch remaining `harns`, `Harns`, `HARNS`, `hns`, `HNS`, `.hns`, and old binary/asset
   names. The only allowed product-name exception in runtime/source/docs is Router display name `name: Harns`; archived
   plan/history files may remain excluded from implementation sweeps.

Avoid editing `.git/`, `.history/`, generated binary contents, or third-party lockfile package names unless a lockfile
entry directly encodes the old project binary/package name.

## Files to Modify

- `src/constants.js` — change CLI binary to `wld`; rename product comments/constants to RunWield; update metadata
  directory name to `.wld`; update worktree branch/path prefixes from `harns` to `runwield` for new worktrees.
- `src/cli.js` — update usage examples and error prefixes from `Harns`/`hns` to `RunWield`/`wld`.
- `src/cmd/**` — update command help/usage/messages, install/remove package wrapper messaging, init text, snip-filter
  command text, tests, and any hardcoded `hns` usage.
- `src/shared/settings.js` and `src/shared/settings.test.js` — rename `HarnsSettingsStorage`, custom-setting
  terminology, `~/.hns` target paths, and tests; preserve Pi settings import behavior but target `~/.wld/settings.json`.
- `src/shared/models/model-registry.js` and tests — rename model config helpers and options from Harns terminology to
  RunWield, target `~/.wld/models.json`/`auth.json`, and update migration tests.
- `src/shared/session/session.js`, `src/shared/session/root-session.js`, `src/shared/session/active-agent-session.js`,
  and related tests — update session directories, custom session marker type (`runwield.active_agent`), cache
  directories, global/project context file lookup, debug text, and tests.
- `src/shared/interactive/**` and `src/shared/ui/**` — update boot/header/banner branding and tests; redraw
  `src/shared/ui/boot-logo.js` as `W.`.
- `src/shared/worktree.js`, `src/shared/worktree-registry.js`, and tests — update registry paths and generated worktree
  branch/path prefixes for `runwield`; remove any old `.hns`/`harns/worktree` registry migration, fallback, or rescue
  expectations.
- `src/shared/snip-filters.js`, `src/cmd/snip-filters/**`, and tests — rename managed marker/messages and
  `hns snip-filters` examples to `wld snip-filters`.
- `src/tools/**` — update user-visible system messages, tool names/comments such as `createHarnsGrepToolDefinition` if
  not externally referenced, and tests.
- `src/extensions/**` — update module comments and compatibility wording.
- `src/agent-definitions/**` — rename system prompt language from Harns system to RunWield system, except keep
  `src/agent-definitions/router.md` front matter `name: Harns` unchanged.
- `src/prompt-templates/sleep.md` — update sleep-mode branding.
- `scripts/compile.js` — compile to `./bin/wld` instead of `./bin/hns`.
- `scripts/write-version.js` and `src/shared/version.js` — rename `HNS_VERSION` to a neutral `VERSION`, generated log
  prefix to `[wld]`, and update import sites.
- `.github/workflows/release.yml` — rename workflow, matrix binary names, artifact names, tarball names, and upload
  patterns from `hns` to `wld`; ensure Windows binary becomes `wld.exe`.
- `install.sh` — rename environment variables (`WLD_REPO`, `WLD_INSTALL_DIR`), installer log prefix (`[wld installer]`),
  asset names, binary extraction/install checks, PATH advice, Snip filter examples, and default repo to
  `gandazgul/runwield`.
- `README.md`, `docs/**`, and `TODO.md` — update user-facing docs and examples to RunWield/`wld`/`~/.wld`/`RUNWEILD.md`.
- `HARNS.md` — rename to `RUNWEILD.md`; update references/tests accordingly; no legacy `HARNS.md` read fallback is
  required.
- `.hns/settings.json` and `.gitignore` — rename tracked project settings directory to `.wld`; update ignored
  debug/worktree paths.
- `.idea/modules.xml` and `.idea/harns.iml` — rename IDE module metadata if repository-tracked project names are
  included in the rebrand.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/constants.js` — use central constants (`CLI_BIN`, the renamed `.wld` metadata-dir constant, worktree prefixes)
  rather than scattering string literals.
- `src/shared/settings.js` — keep the existing one-time Pi migration style (`migratePiSettingsOnce`) but target
  `~/.wld`; do not add or keep `~/.hns` migration/fallback behavior.
- `src/shared/models/model-registry.js` — follow existing `migratePiModelConfigOnce` pattern only for Pi-owned
  model/auth import into `~/.wld`; do not add Harns-owned config import.
- `src/shared/session/session.js` — preserve existing layered context lookup patterns
  (`RUNWEILD.md`/`AGENTS.md`/external `AGENTS.md`) and local/home/bundled prompt/skill precedence.
- `src/shared/session/root-session.js` — reuse `encodeCwdForSessionDir` unchanged for session directory names.
- `src/shared/ui/boot-logo.js` — preserve the existing `logo`, `dotOn`, `dotOff`, `renderBootLogo`, and `endBlink`
  structure while changing only the rendered block glyph layout.
- `scripts/write-version.js` + `.github/workflows/release.yml` — keep current generated-version workflow and release
  tarball structure, changing only names.

## Implementation Steps

- [ ] Step 1: Apply the resolved rename boundaries:
  - Full project-local rename: `.hns` -> `.wld` and `HARNS.md` -> `RUNWEILD.md` across tracked files, source, docs,
    fixtures, and tests.
  - Intentionally do not migrate/copy old `~/.hns` data into `~/.wld`, read old Harns markers/paths as fallbacks, or
    rescue old Harns worktrees.
  - Use `gandazgul/runwield` as the default release repository in `install.sh`.
- [ ] Step 2: Rename central constants and generated version symbol:
  - `CLI_BIN: "wld"`.
  - Product comments/docs in `src/constants.js`.
  - Directory constants from Harns names to RunWield names where applicable.
  - `HNS_VERSION` -> `VERSION` in `scripts/write-version.js`, generated `src/shared/version.js`,
    `src/shared/interactive/chat-session.js`, and `src/cmd/version/index.js`.
- [ ] Step 3: Update CLI/runtime user-facing strings:
  - Usage examples in `src/cli.js` and `src/cmd/registry.js` should use `wld`.
  - Error/log prefixes should use `[RunWield]` except Router display-name contexts that intentionally show `Harns`.
  - `/version` should output `runwield <version> (<target-triple>)` unless product capitalization is desired as
    `RunWield` in version output.
- [ ] Step 4: Rename global settings/model/auth storage to `~/.wld`:
  - Update `getSettingsDir("global")`, session base dir, bundled cache dirs, init-state path, model registry dir,
    worktree home parent, and package manager `agentDir` consumers.
  - Do not add or keep one-time legacy copy helpers for existing `~/.hns` files/directories; write/read new data only
    under `~/.wld`.
  - Keep Pi import behavior from `~/.pi/agent` but copy into `~/.wld` when the RunWield file is missing.
- [ ] Step 5: Rename project-local metadata/context paths:
  - Change project metadata directory from `.hns` to `.wld` in constants and direct string literals.
  - Rename tracked `.hns/settings.json` to `.wld/settings.json`.
  - Change global/project context filename from `HARNS.md` to `RUNWEILD.md`, with `AGENTS.md` fallback still supported
    and no legacy `HARNS.md` read fallback.
  - Rename root `HARNS.md` to `RUNWEILD.md` and update tests/fixtures.
- [ ] Step 6: Update session custom marker naming:
  - Change `ACTIVE_AGENT_CUSTOM_TYPE` from `harns.active_agent` to `runwield.active_agent` for newly written markers.
  - Read and write only the new `runwield.active_agent` marker; old `harns.active_agent` markers may be ignored.
  - Update extractor scripts/tests that inspect active-agent markers.
- [ ] Step 7: Update worktree identifiers:
  - Change branch prefix from `harns/worktree/` to `runwield/worktree/` and path prefix from `harns-` to `runwield-` for
    newly created worktrees.
  - Ensure tests and plan front-matter fixtures expect new names.
  - Do not add old `.hns` worktree registry fallbacks, branch detection, or rescue logic. `wld` should create and manage
    only new `.wld`/`runwield/worktree/*` worktrees.
- [ ] Step 8: Redraw `src/shared/ui/boot-logo.js`:
  - Replace the block `H` arrays with a block `W` in comparable dimensions/style.
  - Keep `dotOn` adding a block dot to the right and `dotOff` removing it.
  - Update module comment from Harns to RunWield.
- [ ] Step 9: Update packaging/install/release:
  - `scripts/compile.js` output becomes `./bin/wld`.
  - `.github/workflows/release.yml` workflow/artifact/tarball/binary names become `wld`/`wld.exe`.
  - `install.sh` installs `wld`, downloads `wld-${VERSION}-${SUFFIX}.tar.gz`, checks executable `wld`, and emits
    `wld --help` instructions.
  - Rename installer env vars to `WLD_REPO` and `WLD_INSTALL_DIR`; do not support old `HNS_*` vars as deprecated
    fallbacks.
  - Set the default repo slug to `gandazgul/runwield`.
- [ ] Step 10: Update all source tests and docs:
  - `src/**/*.test.js`, docs, README, TODO, and agent definitions should use RunWield/`wld`/`.wld`/`RUNWEILD.md`.
  - Keep only `src/agent-definitions/router.md` front matter `name: Harns` as the in-repo product-name exception;
    otherwise source/docs/tests should use RunWield naming.
- [ ] Step 11: Sweep and clean up:
  - Run `rg -n --hidden --glob '!.git/**' --glob '!.history/**' --glob '!plans/**' -i 'harns|hns|\.hns|HARNS'`.
  - Classify remaining matches as allowed exceptions only if they are the Router display name or excluded
    archived/history files; otherwise fix them.
  - Run
    `rg -n 'HNS_VERSION|HarnsSettings|HarnsSession|getHarns|createHarns|installHarns|cleanupHarns|HARNS_DIR_NAME' src scripts`
    and rename public/internal symbols; do not keep Harns/HNS aliases for compatibility.
  - Run `git ls-files | rg '(^|/)harns|hns|HARNS|\.hns|Harns'` and rename tracked file paths where appropriate.
- [ ] Step 12: Format and fix all validation failures.

## Verification Plan

- Automated: `deno run ci`
- Automated targeted tests after the rename if failures need narrowing:
  - `deno test -A src/shared/settings.test.js src/shared/models/model-registry.test.js`
  - `deno test -A src/shared/session/session-catalog.test.js src/shared/session/root-session.test.js src/shared/session/active-agent-session.test.js`
    (or nearest existing session tests)
  - `deno test -A src/shared/worktree.test.js src/shared/worktree-registry.test.js`
  - `deno test -A src/cmd/version/index.test.js src/cmd/install/index.test.js src/cmd/help/index.test.js` if
    present/affected
- Automated search gates:
  - `rg -n --hidden --glob '!.git/**' --glob '!.history/**' --glob '!plans/**' -i 'harns|hns|\.hns|HARNS'` should show
    only the Router display name exception in active source/docs/tests.
  - `rg -n 'hns-|/hns| hns|HNS_|\.hns' install.sh .github src README.md docs TODO.md` should return no active
    compatibility or installer-env references.
- Manual:
  - Run `deno run -A src/cli.js --version`; expect RunWield/wld version output with unchanged target triple.
  - Run `deno run -A src/cli.js --help`; expect `wld` usage examples and no old product branding except Router `Harns`
    if listed.
  - Start a TUI session; expect the title/header to say RunWield and boot logo to render `W.` with the dot blinking.
  - Confirm global settings/auth/models/session/init-state files are read/written under `~/.wld`.
  - Confirm old `~/.hns` settings/models/auth/sessions/context files are not required for RunWield startup or resume; no
    migration/read fallback is expected.
  - Run `deno task compile`; expect `bin/wld` to be produced.

## Edge Cases & Considerations

- Project-local rename boundary is resolved: perform the full rename, including `.hns` -> `.wld` and `HARNS.md` ->
  `RUNWEILD.md`.
- Existing user state compatibility is resolved by intentionally breaking from old Harns-owned state: do not
  migrate/copy old `~/.hns` settings, auth, models, sessions, bundled caches, init-state, or worktree registry data into
  `~/.wld`; do not read old Harns paths or markers as fallbacks. Do not delete old data automatically.
- Router exception: Keep `src/agent-definitions/router.md` front matter `name: Harns`. The rest of the Router prompt can
  say RunWield unless the user wants the entire Router persona to remain Harns-branded.
- Custom session marker: Renaming `harns.active_agent` to `runwield.active_agent` can make old sessions lose
  active-agent continuity; that break is accepted by user override.
- Worktree branch prefixes: new worktrees use `runwield/worktree/*`. Do not delete or rename existing `harns/worktree/*`
  branches, but also do not add code that discovers, resumes, migrates, or rescues them.
- Release/install compatibility: If old release assets remain named `hns-*`, the new installer will not install older
  versions. That is acceptable; no legacy fallback is required.
- Repository slug is resolved: `install.sh` should default to `gandazgul/runwield`, while still allowing `WLD_REPO`
  override.
- Pure JavaScript only: Any new helper types should be JSDoc, not TypeScript syntax.
