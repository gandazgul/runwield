---
planId: "5a315cc8-5abc-4fb2-a7ad-31b32795d36a"
classification: "PLANNED_CHANGE"
workKind: "MAINTENANCE"
complexity: "HIGH"
affectedPaths:
    - "install.sh"
    - "scripts/install-test-helpers.js"
    - "src/extensions/mnemoteca/"
    - "src/shared/runtime-preflight.ts"
    - "src/shared/session/session.js"
    - "src/shared/work-records/mnemoteca-port.ts"
    - "src/shared/workflow/"
    - "src/cmd/sleep/"
    - "scripts/run-tests.js"
    - "src/testing/home-sandbox.test.js"
    - "README.md"
    - "docs/domain-language.md"
    - "docs/"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-09-03"
status: "in_progress"
origin: "internal"
userVerifiedAt: null
targetBranch: "main"
---

# Adopt Mnemoteca Across RunWield

## Context

The external memory product now uses the Mnemoteca identity. RunWield still uses the pre-rename identity in its runtime
binary calls, installer, database environment variable, source paths, internal port names, test fixtures, documentation,
and durable project Memories.

This is a functional dependency cutover, not only a prose update. Mnemoteca uses the `mnemoteca` executable,
`MNEMOTECA_DB_PATH`, `gandazgul/mnemoteca`, and `mnemoteca_<version>_<os>_<arch>.tar.gz`. It does not read the
pre-rename database or environment names. Its official installer owns the guarded export/import migration.

Discovery found 103 tracked files with 792 case-insensitive occurrences of the former identity, six tracked source files
whose paths use it, and 38 matching Memories in the `runwield` project collection. No matching Global Memories were
found.

The intended release is RunWield v0.10.0. The version is release metadata, not a hard-coded source condition.

## Objective

Make Mnemoteca the only current memory integration identity in RunWield source, tests, documentation, and stored project
Memories. A fresh or upgrading v0.10.0 install must use Mnemoteca. When `mnemoteca` is absent, RunWield delegates
installation and the optional guarded data upgrade to Mnemoteca's official installer. When it is already installed,
RunWield preserves it and does not invoke that installer.

Keep existing Memory Tool behavior, project/global collection selection, Core Memory injection, Sleep backups, Work
Record indexing, and test isolation unchanged apart from the dependency identity.

## Approach

Use one clean internal identity and let the upstream product own its data migration:

```text
RunWield installer
  helper_existing_path("mnemoteca")
  ├─ found   -> preserve it; do not fetch or run the upstream installer
  └─ missing -> fetch and run Mnemoteca's official installer
                with RunWield's resolved install directory
                ├─ fresh user: install Mnemoteca
                └─ upgrade user: offer upstream's guarded export/import flow
```

The runtime then has one direct route to the external dependency:

```text
Agent Session / Claude bridge / Sleep / Work Record index
  -> Mnemoteca-named extension or external port
  -> mnemoteca CLI
  -> project, global, or <project>:work-records collection
```

Pass `INSTALL_DIR` and the new repository override through to the upstream installer so custom RunWield install
locations continue to work. Treat a failed upstream install, or a successful exit that does not produce a usable
`mnemoteca` executable, as a required-helper failure.

Rename source directories, files, symbols, option properties, projection labels, fixtures, and environment variables
rather than leaving internal aliases. Keep the user-facing `memory` Custom Tool and Work Record commands stable.

Before changing external Memories, create a retained Mnemoteca export. Rewrite each matching Memory in place so its
scope, document ID, tags, and non-tag metadata remain stable. Use Mnemoteca terms for current facts and neutral phrases
such as “pre-rename memory CLI” for historical facts; do not turn old historical actions into false current actions.

Direct archive download logic for Mnemoteca is set aside because it would duplicate the upstream migration lifecycle and
could drift from it. The cost of delegation is reliance on the upstream installer contract.

## Expected Change Surface

The boundaries below are guidance, not an allowlist. Verify the real footprint during implementation and change whatever
the Implementation Steps need, including files not named here. Stop and report only when discovery changes approved
intent — the change reaches another subsystem, public behavior or architecture shifts, migration or compatibility risk
grows, or the Verification Plan no longer proves the objective.

- `install.sh` — preserve an existing `mnemoteca`; otherwise invoke the official Mnemoteca installer with the resolved
  RunWield install directory and new repository override, then verify the required executable.
- `scripts/install-test-helpers.js`, `scripts/install-integrity.test.js`, and `scripts/install-platforms.test.js` —
  model the delegated installer, current release identity, custom install directory, failure, and idempotent
  preservation paths.
- `Containerfile.wld-ux`, `.github/workflows/pr.yml`, and `.github/workflows/release.yml` — provide and verify the new
  runtime executable in clean-user, continuous integration, and release qualification environments.
- `src/extensions/mnemoteca/` — own the stable `memory` Custom Tool implementation and subprocess calls under the new
  integration identity; the four pre-rename extension files move here with matching exported names and tests.
- `src/shared/runtime-preflight.ts`, `src/cli.ts`, and `src/ui/tui/chat-session.ts` — require `mnemoteca` and show
  accurate recovery guidance when it is missing.
- `src/shared/session/session.js` and `src/cmd/context/index.js` — use Mnemoteca for Core Memory loading, extension
  registration, Claude CLI bridging, warning recognition, and context projection attribution.
- `src/shared/work-records/mnemoteca-port.ts`, `src/shared/work-records/index-adapter.js`, and
  `src/shared/work-records/test-fixtures/mnemoteca-port.ts` — rename the external Work Record indexing port and run the
  new executable while keeping collection names, locator tags, parsing, and canonical Markdown ownership unchanged.
- `src/shared/work-records/`, `src/shared/workflow/`, `src/tools/`, `src/cmd/`, and `src/ui/workspace/` — carry the
  renamed required Work Record port through all production composition roots and tests without adding a seam or
  fallback.
- `src/cmd/sleep/index.ts`, `src/cmd/sleep/prompt.md`, and their tests — invoke Mnemoteca for the immutable
  pre-maintenance export and give the Engineer current CLI commands.
- `scripts/run-tests.js`, `src/constants.js`, `src/testing/home-sandbox.test.js`, runtime command fixtures, and Golden
  TUI fixtures — use `MNEMOTECA_DB_PATH` atomically so no test can reach the developer's real Mnemoteca database.
- `README.md`, `AGENTS.md`, current product docs, architecture docs, pull request documents, archived Plans, ADRs, and
  Work Records under `docs/` — use current terminology, paths, commands, and `https://github.com/gandazgul/mnemoteca`
  links. Historical statements must remain truthful through neutral pre-rename wording where a direct replacement would
  alter what happened.
- `docs/domain-language.md` — replace the external memory-system term and all related Memory definitions and stable
  relationships in the same change.
- The local `runwield` Mnemoteca project collection — back up and update all matching Memories in place. Rebuild the
  `<project>:work-records` derived index after tracked Work Record text changes. This state is outside Git but is part
  of the requested outcome.

Git object history and untracked `.git/` recovery objects are outside scope. Do not rewrite repository history.

## Reuse Opportunities

- `install.sh:helper_existing_path` and the existing required-helper reporting arrays — retain the current idempotent
  detection and final install summary instead of creating a second presence check.
- Mnemoteca's official installer — reuse its data export, empty-destination check, count verification, retained backup,
  optional cleanup, and compatibility-link workflow.
- `scripts/install-test-helpers.js:createFixture`, `runInstaller`, and `runInstallerInPseudoTty` — extend the existing
  controlled installer harness rather than contacting the live network in automated tests.
- `src/extensions/mnemoteca/tools.ts:resolveProjectCollectionName` — preserve Git common-root based collection identity
  across primary and linked worktrees.
- `src/shared/work-records/index-adapter.js:getWorkRecordIndexCollectionName` and locator-tag helpers — preserve the
  rebuildable `<project>:work-records` projection and stable Work Record identity.
- `withProcessGlobalTestLock`, runtime command fixtures, and Golden isolated environments — keep all process-global
  PATH, HOME, current-directory, and database-environment changes serialized and sandboxed.
- `mnemoteca update` without `--replace-tags` — replace Memory text while preserving existing tags and non-tag metadata.

## Implementation Steps

- The official Mnemoteca installer used by this change verifies its downloaded release archive checksum. This upstream
  contract is an accepted execution assumption supplied by the user; if the published installer does not yet satisfy it,
  stop before changing RunWield's installer and report the unmet prerequisite.
- `install.sh` treats `mnemoteca` as a required helper. It preserves a usable executable found on `PATH` or in
  `WLD_INSTALL_DIR` without fetching the upstream installer. If absent, it downloads and executes Mnemoteca's official
  installer with RunWield's resolved install directory and `WLD_MNEMOTECA_REPO`, then fails closed unless the new
  executable is usable. The old repository override and direct old-asset branch no longer exist.
- Installer fixtures prove distinct results with `MNEMOTECA_DB_PATH` both present and explicitly absent: a missing
  helper executes the official installer into a custom path; an existing helper causes no Mnemoteca installer request;
  and an upstream installer failure or missing resulting executable aborts RunWield installation. A fixture with only a
  pre-rename compatibility executable still invokes upstream rather than treating that executable as current. Construct
  its name from fragments at test runtime so the regression test does not preserve the obsolete spelling. The
  pseudo-terminal fixture also proves that interactive input reaches the delegated installer so its upgrade offer is not
  swallowed by RunWield.
- Clean-user and continuous integration environments provide `mnemoteca`, and both UX container targets execute
  `mnemoteca version`. They contain no dependency on a compatibility executable.
- `src/extensions/mnemoteca/` exports `createMnemotecaTools`, `MnemotecaToolHost`, and the Mnemoteca extension. Memory
  recall, store, scoped delete, Core tags, project/global precedence, collection resolution, error behavior, and Claude
  CLI bridging execute `mnemoteca` with the same supported arguments and results as before.
- `ensureMnemotecaBinary` is the only memory-helper preflight. TUI and Agent Session construction call it,
  missing-helper messages name Mnemoteca, and a PATH containing only a valid `mnemoteca` fixture passes. A PATH that
  contains only a pre-rename compatibility executable, with its name assembled from fragments inside the test, is
  rejected; this proves there is no dynamically hidden runtime fallback.
- Core Memory prompt assembly executes `mnemoteca list -t core -f plain`, keeps its fail-open behavior, and records
  `mnemoteca` as the context projection source. A behavioral test fails if this path calls another executable or omits
  the returned Core Memory text.
- The Work Record index boundary is `WorkRecordMnemotecaPort` in `src/shared/work-records/mnemoteca-port.ts`. All
  callers, validation types, Workspace state, tools, options, test fixtures, function names, errors, and production
  composition roots use `mnemotecaPort` or `workRecordMnemotecaPort` consistently. The system port runs `mnemoteca`;
  canonical Work Record Markdown, collection names, locator tags, update semantics, and search filtering do not change.
- Sleep uses `MnemotecaPort`, `SYSTEM_SLEEP_MNEMOTECA_PORT`, and `exportMnemotecaCollection`. Its backup remains an
  immutable verified JSONL file created before Agent switching or maintenance, and the embedded and source prompts use
  valid current Mnemoteca commands.
- Every test process receives `MNEMOTECA_DB_PATH` inside its sandbox. Every fixture that temporarily changes this
  variable restores it under `withProcessGlobalTestLock`. The safety tripwire fails when the variable is absent or
  points outside `WLD_TEST_SANDBOX_HOME`.
- All six tracked pre-rename source paths move to their Mnemoteca paths, imports and language-policy baselines follow
  the moves, and no forwarding files, aliases, old symbol names, or old projection-source values remain.
- All tracked prose, links, diagrams, command examples, environment names, path examples, archived Plan text, and Work
  Record text use Mnemoteca or accurate neutral pre-rename wording. `docs/domain-language.md` defines Mnemoteca as the
  external semantic memory system and updates Memory, Local Memory, Team Memory, Trusted Branch, Sleep, and Project Name
  relationships. User-facing pages link `https://github.com/gandazgul/mnemoteca` at least once where Mnemoteca appears.
- Before Memory edits, an export of the `runwield` collection is retained outside the repository and its path is
  recorded in the execution report. All 38 baseline matching project Memories, plus any new matches found at execution
  time, are updated in place with context-aware wording. IDs, project scope, Core and other tags, and non-tag metadata
  remain unchanged. The Global collection is checked and any drift matches receive the same treatment; unrelated
  Memories are untouched.
- After tracked Work Record updates, `deno run -A src/cli.ts wr index rebuild` recreates the derived
  `runwield:work-records` Mnemoteca index from canonical Markdown. The rebuild reports zero failures, and Work Record
  search still returns a known current record.
- The final tracked tree has no case-insensitive former-name occurrence in file contents or paths, and project/global
  Mnemoteca searches have no Memory containing that spelling. This absence check supplements, but does not replace, the
  behavioral tests above.

## Approval Confirmation

No Work Record is proposed for `supersedes`. This maintenance updates dependency terminology and integration wiring; it
does not materially replace the decisions or outcomes of prior Work Records.

## Verification Plan

- Automated focused suites:

  ```bash
  deno run -A scripts/run-tests.js \
    scripts/install-integrity.test.js \
    scripts/install-platforms.test.js \
    src/shared/runtime-preflight.test.ts \
    src/extensions/mnemoteca/index.test.js \
    src/extensions/mnemoteca/tools.test.ts \
    src/shared/session/backends/claude-cli/capability-tools.test.ts \
    src/shared/session/session-prompt.test.js \
    src/shared/work-records/work-records.test.js \
    src/cmd/sleep/index.test.ts \
    src/testing/home-sandbox.test.js \
    src/ui/tui/testing/isolated-environment.test.js
  ```

  Expected: the installer delegates only when required; the runtime, Claude bridge, Core Memory load, Sleep export, and
  Work Record port invoke `mnemoteca`; and every subprocess test remains sandboxed.

- Full repository and Golden TUI gate:

  ```bash
  deno task pr:check
  ```

  Expected: type checks, formatting, lint, seam checks, documentation links, all test files, and composed Golden TUI
  scenarios pass. Existing behavior that remains protected includes project/global Memory precedence, scoped deletion,
  Core Memory injection, Work Record add/update/search/rebuild, validation handoffs, immutable Sleep backup before
  mutation, installer idempotence, and per-file database isolation. The only behavior expected to stop is direct use or
  recognition of the pre-rename executable and environment contract inside RunWield.

- Mnemoteca installer integration:
  - A fixture with no `mnemoteca` must record exactly one request for the official installer, receive the resolved
    custom `INSTALL_DIR`, produce the executable there, and let RunWield complete. Run this case once with a sandbox
    `MNEMOTECA_DB_PATH` and once with that variable explicitly removed from the child environment.
  - A fixture with `mnemoteca` already on `PATH` and a second fixture with it only in `WLD_INSTALL_DIR` must complete
    without requesting the official installer.
  - A fixture whose PATH contains only the pre-rename executable, named from runtime string fragments, must still
    request the official installer. A matching runtime-preflight fixture must reject that PATH. These tests fail any
    hidden compatibility fallback even when the obsolete spelling does not appear literally in source.
  - Failure and false-success fixtures must leave RunWield installation failed, not report a complete install.
  - A pseudo-terminal fixture must show that the delegated installer's upgrade prompt can be answered.
  - Inspect the published upstream installer used for the release and confirm that release-archive checksum verification
    is active before v0.10.0 is cut.

- Work Record projection:

  ```bash
  deno run -A src/cli.ts wr index rebuild
  deno run -A src/cli.ts wr search "safe engineer sleep" --all
  ```

  Expected: rebuild has zero failures, and search returns the known Sleep Work Record through Mnemoteca after the
  canonical Markdown terminology update.

- Tracked-content and path absence check. Construct the search term at runtime so this Plan does not preserve the term
  it requires implementation to remove:

  ```bash
  legacy="$(printf '%s%s' 'mnemo' 'syne')"
  ! git grep -Iin "$legacy" -- .
  ! git ls-files | grep -i "$legacy"
  ```

  Expected: both commands succeed because no tracked content or path contains the former identity. This check cannot
  pass a counterfeit implementation by itself; the installer and runtime behavior tests above require real Mnemoteca
  calls.

- External Memory verification:

  ```bash
  legacy="$(printf '%s%s' 'mnemo' 'syne')"
  mnemoteca search --name runwield --format json --fts-only --no-rerank --limit 1000 "$legacy"
  mnemoteca search --global --format json --fts-only --no-rerank --limit 1000 "$legacy"
  ```

  Expected: both JSON results report `count: 0`. Compare the post-edit `runwield` collection with the retained export:
  every edited document keeps its ID and metadata/tags, and the total collection count changes only if unrelated work
  legitimately added a Memory during execution.

- Manual documentation review: README, Quickstart, Troubleshooting, Contributing, architecture diagrams, domain
  language, current product docs, and historical artifacts use Mnemoteca consistently; current commands and links
  resolve; neutral historical wording does not falsely claim that a new command performed an old action.

## Edge Cases & Considerations

- **Upstream release prerequisite:** the plan assumes Mnemoteca's official installer verifies its release archive. Do
  not silently weaken RunWield's required-helper integrity policy if this is not true at execution time.
- **Already installed but not migrated:** by user decision, detection of `mnemoteca` is a no-op. RunWield must not guess
  whether that user's data was upgraded. Documentation should direct such users to rerun the official Mnemoteca
  installer before RunWield v0.10.0 when they still need data from a pre-rename installation.
- **Non-interactive install:** Mnemoteca's installer skips upgrade prompts when it has no terminal. RunWield's automated
  and container paths must complete without waiting for input. A user who needs data migration must run the same install
  from a terminal before starting RunWield.
- **Custom install directory:** pass RunWield's fully resolved directory as upstream `INSTALL_DIR`; do not let the
  nested installer fall back to a different bin directory.
- **Installer ownership:** do not reproduce export/import, cleanup, or compatibility-link decisions in RunWield. That
  logic belongs to Mnemoteca and can evolve there.
- **Memory safety:** project Memory edits are outside Git and are not transactionally rolled back with source changes.
  Export first, update documents in place, stop on the first unexplained failure, retain the export, and report its
  path.
- **Historical accuracy:** a blind string replacement can falsify old commands and paths. Use current Mnemoteca names
  for active contracts and neutral pre-rename wording for historical events while still removing the obsolete spelling.
- **Derived indexes:** direct Work Record Markdown edits do not automatically refresh every index entry. Rebuild the
  Mnemoteca projection after all canonical files settle.
- **Stable interfaces:** the public `memory` tool schema and Work Record command behavior remain unchanged. Collection
  names (`global`, project Git common-root name, and `<project>:work-records`) must not change during the rename.
- **No compatibility fallback:** runtime code must not try a second executable or environment variable. Upgrade support
  comes from the official installer before the v0.10.0 runtime starts.
