---
planId: "fba5a66e-a528-4abf-bad8-e9b109625a75"
classification: "PLANNED_CHANGE"
workKind: "MAINTENANCE"
complexity: "MEDIUM"
summary: "Move RunWield domain-language artifacts away from CONTEXT.md names and temporarily migrate exact-uppercase legacy files at project startup."
affectedPaths:
    - "CONTEXT.md"
    - "docs/domain-language.md"
    - "docs/domain-language-map.md"
    - "src/cli.ts"
    - "src/cli.ts"
    - "src/shared/domain-language.ts"
    - "src/shared/domain-language.test.ts"
    - "src/agent-definitions/"
    - "src/skills/"
    - "src/cmd/init/"
    - "src/cmd/registry.js"
    - "docs/"
objectiveChecks:
    - id: "OC1"
      command: "test -f docs/domain-language.md && test ! -e CONTEXT.md && test -f src/agent-definitions/document-formats/domain-language-format.md && test ! -e src/agent-definitions/document-formats/CONTEXT-FORMAT.md"
      rationale: "Proves both this repository's glossary and the shipped format moved without compatibility stubs under the colliding names."
    - id: "OC2"
      command: "bash -c 'set -eu; r=$PWD; t=$(mktemp -d); trap \"rm -rf \\\"$t\\\"\" EXIT; mkdir -p \"$t/p\" \"$t/h\"; printf legacy >\"$t/p/CONTEXT.md\"; printf lower >\"$t/p/context.md\"; (cd \"$t/p\" && HOME=\"$t/h\" MNEMOSYNE_DB_PATH=\"$t/h/m.db\" deno run -A \"$r/src/cli.ts\" plans >/dev/null 2>\"$t/e\"); test ! -e \"$t/p/CONTEXT.md\"; test \"$(cat \"$t/p/docs/domain-language.md\")\" = legacy; test \"$(cat \"$t/p/context.md\")\" = lower'"
      rationale: "Launches the real CLI and proves exact-uppercase single-context migration plus lowercase immunity."
    - id: "OC3"
      command: "bash -c 'set -eu; r=$PWD; t=$(mktemp -d); trap \"rm -rf \\\"$t\\\"\" EXIT; mkdir -p \"$t/p/one\" \"$t/h\"; printf \"%s\\n\" \"# Contexts\" \"- [One]\"\"(./one/CONTEXT.md)\" >\"$t/p/CONTEXT-MAP.md\"; printf one >\"$t/p/one/CONTEXT.md\"; (cd \"$t/p\" && HOME=\"$t/h\" MNEMOSYNE_DB_PATH=\"$t/h/m.db\" deno run -A \"$r/src/cli.ts\" plans >/dev/null 2>\"$t/e\"); test ! -e \"$t/p/CONTEXT-MAP.md\"; test ! -e \"$t/p/one/CONTEXT.md\"; test \"$(cat \"$t/p/one/domain-language.md\")\" = one; grep -Fq \"./one/domain-language.md\" \"$t/p/docs/domain-language-map.md\"; ! grep -Fq \"CONTEXT.md\" \"$t/p/docs/domain-language-map.md\"'"
      rationale: "Proves the actual startup boundary migrates a map and its referenced glossary without leaving a dangling legacy link."
    - id: "OC4"
      command: "bash -c 'set -eu; r=$PWD; t=$(mktemp -d); trap \"rm -rf \\\"$t\\\"\" EXIT; mkdir -p \"$t/p/docs\" \"$t/h\"; printf source >\"$t/p/CONTEXT.md\"; printf existing >\"$t/p/docs/domain-language.md\"; (cd \"$t/p\" && HOME=\"$t/h\" MNEMOSYNE_DB_PATH=\"$t/h/m.db\" deno run -A \"$r/src/cli.ts\" plans >/dev/null 2>\"$t/e\"); test \"$(cat \"$t/p/CONTEXT.md\")\" = source; test \"$(cat \"$t/p/docs/domain-language.md\")\" = existing; test -s \"$t/e\"'"
      rationale: "Proves an existing canonical destination wins without data loss and the real CLI surfaces the conflict."
    - id: "OC5"
      command: "! grep -R -n -E 'CONTEXT\\.md|CONTEXT-MAP\\.md|CONTEXT-FORMAT\\.md' src/agent-definitions src/skills src/cmd docs --exclude-dir=work-records"
      rationale: "Proves current shipped guidance and maintained documentation no longer assign RunWield semantics to the colliding filenames."
objectiveChecksBaseline:
    recordedAt: "2026-08-06T01:41:46.566Z"
    head: "bca1ec866721a7d07540546c8e9213ba49bbfca9"
    results:
        - id: "OC1"
          command: "test -f docs/domain-language.md && test ! -e CONTEXT.md && test -f src/agent-definitions/document-formats/domain-language-format.md && test ! -e src/agent-definitions/document-formats/CONTEXT-FORMAT.md"
          rationale: "Proves both this repository's glossary and the shipped format moved without compatibility stubs under the colliding names."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 16
          output: "\n"
        - id: "OC2"
          command: "bash -c 'set -eu; r=$PWD; t=$(mktemp -d); trap \"rm -rf \\\"$t\\\"\" EXIT; mkdir -p \"$t/p\" \"$t/h\"; printf legacy >\"$t/p/CONTEXT.md\"; printf lower >\"$t/p/context.md\"; (cd \"$t/p\" && HOME=\"$t/h\" MNEMOSYNE_DB_PATH=\"$t/h/m.db\" deno run -A \"$r/src/cli.ts\" plans >/dev/null 2>\"$t/e\"); test ! -e \"$t/p/CONTEXT.md\"; test \"$(cat \"$t/p/docs/domain-language.md\")\" = legacy; test \"$(cat \"$t/p/context.md\")\" = lower'"
          rationale: "Launches the real CLI and proves exact-uppercase single-context migration plus lowercase immunity."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 11413
          output: "\n"
        - id: "OC3"
          command: "bash -c 'set -eu; r=$PWD; t=$(mktemp -d); trap \"rm -rf \\\"$t\\\"\" EXIT; mkdir -p \"$t/p/one\" \"$t/h\"; printf \"%s\\n\" \"# Contexts\" \"- [One]\"\"(./one/CONTEXT.md)\" >\"$t/p/CONTEXT-MAP.md\"; printf one >\"$t/p/one/CONTEXT.md\"; (cd \"$t/p\" && HOME=\"$t/h\" MNEMOSYNE_DB_PATH=\"$t/h/m.db\" deno run -A \"$r/src/cli.ts\" plans >/dev/null 2>\"$t/e\"); test ! -e \"$t/p/CONTEXT-MAP.md\"; test ! -e \"$t/p/one/CONTEXT.md\"; test \"$(cat \"$t/p/one/domain-language.md\")\" = one; grep -Fq \"./one/domain-language.md\" \"$t/p/docs/domain-language-map.md\"; ! grep -Fq \"CONTEXT.md\" \"$t/p/docs/domain-language-map.md\"'"
          rationale: "Proves the actual startup boundary migrates a map and its referenced glossary without leaving a dangling legacy link."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 1393
          output: "\n"
        - id: "OC4"
          command: "bash -c 'set -eu; r=$PWD; t=$(mktemp -d); trap \"rm -rf \\\"$t\\\"\" EXIT; mkdir -p \"$t/p/docs\" \"$t/h\"; printf source >\"$t/p/CONTEXT.md\"; printf existing >\"$t/p/docs/domain-language.md\"; (cd \"$t/p\" && HOME=\"$t/h\" MNEMOSYNE_DB_PATH=\"$t/h/m.db\" deno run -A \"$r/src/cli.ts\" plans >/dev/null 2>\"$t/e\"); test \"$(cat \"$t/p/CONTEXT.md\")\" = source; test \"$(cat \"$t/p/docs/domain-language.md\")\" = existing; test -s \"$t/e\"'"
          rationale: "Proves an existing canonical destination wins without data loss and the real CLI surfaces the conflict."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 1266
          output: "\n"
        - id: "OC5"
          command: "! grep -R -n -E 'CONTEXT\\.md|CONTEXT-MAP\\.md|CONTEXT-FORMAT\\.md' src/agent-definitions src/skills src/cmd docs --exclude-dir=work-records"
          rationale: "Proves current shipped guidance and maintained documentation no longer assign RunWield semantics to the colliding filenames."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 152
objectiveCheckWaivers:
    - id: "OC2"
      command: "bash -c 'set -eu; r=$PWD; t=$(mktemp -d); trap \"rm -rf \\\"$t\\\"\" EXIT; mkdir -p \"$t/p\" \"$t/h\"; printf legacy >\"$t/p/CONTEXT.md\"; printf lower >\"$t/p/context.md\"; (cd \"$t/p\" && HOME=\"$t/h\" MNEMOSYNE_DB_PATH=\"$t/h/m.db\" deno run -A \"$r/src/cli.ts\" plans >/dev/null 2>\"$t/e\"); test ! -e \"$t/p/CONTEXT.md\"; test \"$(cat \"$t/p/docs/domain-language.md\")\" = legacy; test \"$(cat \"$t/p/context.md\")\" = lower'"
      source: "mechanical_validation"
      explanation: "Objective check requires a case-sensitive filesystem path distinction that this filesystem cannot represent: $t/p/CONTEXT.md must not exist while $t/p/context.md must exist."
      userNote: "that check would require a case sensitive file system. The code is handling this correctly."
      waivedAt: "2026-08-06T15:39:17.607Z"
    - id: "OC2"
      command: "bash -c 'set -eu; r=$PWD; t=$(mktemp -d); trap \"rm -rf \\\"$t\\\"\" EXIT; mkdir -p \"$t/p\" \"$t/h\"; printf legacy >\"$t/p/CONTEXT.md\"; printf lower >\"$t/p/context.md\"; (cd \"$t/p\" && HOME=\"$t/h\" MNEMOSYNE_DB_PATH=\"$t/h/m.db\" deno run -A \"$r/src/cli.ts\" plans >/dev/null 2>\"$t/e\"); test ! -e \"$t/p/CONTEXT.md\"; test \"$(cat \"$t/p/docs/domain-language.md\")\" = legacy; test \"$(cat \"$t/p/context.md\")\" = lower'"
      source: "mechanical_validation"
      explanation: "Objective check requires a case-sensitive filesystem path distinction that this filesystem cannot represent: $t/p/CONTEXT.md must not exist while $t/p/context.md must exist."
      userNote: "this will never work on case-insensitive file systems"
      waivedAt: "2026-08-06T15:50:53.080Z"
    - id: "OC2"
      command: "bash -c 'set -eu; r=$PWD; t=$(mktemp -d); trap \"rm -rf \\\"$t\\\"\" EXIT; mkdir -p \"$t/p\" \"$t/h\"; printf legacy >\"$t/p/CONTEXT.md\"; printf lower >\"$t/p/context.md\"; (cd \"$t/p\" && HOME=\"$t/h\" MNEMOSYNE_DB_PATH=\"$t/h/m.db\" deno run -A \"$r/src/cli.ts\" plans >/dev/null 2>\"$t/e\"); test ! -e \"$t/p/CONTEXT.md\"; test \"$(cat \"$t/p/docs/domain-language.md\")\" = legacy; test \"$(cat \"$t/p/context.md\")\" = lower'"
      source: "mechanical_validation"
      explanation: "Objective check requires a case-sensitive filesystem path distinction that this filesystem cannot represent: $t/p/CONTEXT.md must not exist while $t/p/context.md must exist."
      userNote: "it would only work on a case-insensitive file system"
      waivedAt: "2026-08-06T16:06:20.671Z"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-04T09:43:39-04:00"
status: "verified"
origin: "internal"
implementedAt: "2026-08-06T01:53:32.098Z"
verifiedAt: "2026-08-06T16:38:20.268Z"
userVerifiedAt: null
workRecord:
    status: "generated"
    recordId: "94b82c81-ed72-45ed-a2fe-495b7abe143b"
    path: "docs/work-records/2026-08-06-moved-domain-language-out-of-context-files.md"
    lastAttemptAt: "2026-08-06T16:38:27.187Z"
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-08-06T16:34:33.798Z"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "5d4a75598b84efc2e46c82d9235dd93cff794cd9"
    targetBranch: "main"
    targetHeadBeforeMerge: "fc2c0b2d7d2753e8e1a042d2942421eabe7ee625"
validationCiAttempts: 0
validationSemanticRounds: 2
updatedAt: "2026-08-09T05:04:27.763Z"
archivedAt: "2026-08-09T05:04:27.763Z"
archivedFromStatus: "verified"
archivedFromPath: "docs/plans/move-domain-language-out-of-context-files.md"
---

# Move Domain Language Out of CONTEXT Files

## Context

RunWield currently claims root `CONTEXT.md` as the single-context domain glossary and root `CONTEXT-MAP.md` as the
multi-context index. Matt Pocock skills and other coding harnesses may assign different meanings to those filenames, so
RunWield can misread unrelated content or compete to update a shared file.

The convention is instruction-driven rather than a runtime loader: bundled Agents, Skills, document formats, and
`wld init` tell models where to read or write domain language. This repository also uses a 605-line root `CONTEXT.md` as
its own glossary. The change therefore needs to update shipped guidance and documentation, move RunWield's own glossary,
and preserve older RunWield projects through a temporary deterministic migration.

The settled canonical layout is:

- Single-context project glossary: `docs/domain-language.md`.
- Multi-context project map: `docs/domain-language-map.md`.
- Per-context glossary: `<context-directory>/domain-language.md`; it does not gain an additional `docs/` directory.

Legacy migration applies only to directory entries whose stored names are exactly uppercase `CONTEXT.md` or
`CONTEXT-MAP.md`. Lowercase `context.md`, lowercase `context-map.md`, and other case variants belong to other tools and
must remain untouched. The migration is temporary compatibility behavior to be removed only through a future breaking
change.

## Objective

Make the new domain-language paths the only convention RunWield Agents and Skills read or write, while automatically and
losslessly migrating exact-uppercase artifacts created by older RunWield versions on the next project-capable RunWield
startup. Existing destinations are authoritative and must never be overwritten or implicitly merged.

## Approach

Introduce a small TypeScript domain-language module that owns canonical and legacy path constants plus an idempotent
startup migration. Integrate it at the central CLI startup boundary before project-capable command dispatch, while
keeping read-only version/help behavior non-mutating. Move the existing CLI implementation to TypeScript and retain
`src/cli.ts` only as the stable compatibility entrypoint used by current tasks, compilation, and source-run guidance.

For a single-context legacy file, preflight the absent destination, create `docs/`, write the destination safely, and
remove the source only after the new file is durable. For a legacy map, parse its local Markdown links, select only
links whose final stored path component is exactly `CONTEXT.md`, preflight all source/destination pairs, rewrite those
links to sibling `domain-language.md` files, and migrate the map plus referenced glossaries as one logical set. A
conflict, unrecognized unsafe link, symlink, or filesystem error leaves legacy source content intact and returns a
concise warning; it never blocks unrelated RunWield startup or falls back to interpreting the old file as domain
language.

Update every current bundled Agent, Skill, format, command description, test assertion, and maintained product document
to the new convention. Do not bulk-rewrite archived Plans or Work Records: those are historical evidence. Rename this
repository's glossary without leaving a root compatibility stub, because freeing that filename is the product outcome.

## Files to Modify

- `CONTEXT.md` → `docs/domain-language.md` — relocate RunWield's own glossary and retitle it as RunWield Domain
  Language; leave no root stub.
- `src/shared/domain-language.ts` — own canonical/legacy names, exact-case discovery, map-link rewriting, migration
  preflight, safe writes/removals, typed outcomes, and temporary-breaking-change removal documentation.
- `src/shared/domain-language.test.ts` — exercise single-context and multi-context migration, exact-case protection,
  idempotency, conflicts, map rewrites, and failure safety in real temporary directories.
- `src/cli.ts`, `src/cli.ts` — retain a thin stable JavaScript entrypoint while moving CLI implementation to TypeScript;
  invoke migration once before project-capable command dispatch and render migration notices on stderr without polluting
  Agent Client Protocol (ACP) stdout.
- `src/agent-definitions/document-formats/CONTEXT-FORMAT.md` →
  `src/agent-definitions/document-formats/domain-language-format.md` — redefine canonical single- and multi-context
  layouts, exact legacy migration semantics, and lazy glossary creation under the new names.
- `src/agent-definitions/document-formats/planner-plan-format.md` — instruct Plans to modify the applicable
  `domain-language.md` file when implementation makes proposed terms true.
- `src/agent-definitions/planner.md`, `src/agent-definitions/ideator.md`, `src/agent-definitions/architect.md`,
  `src/agent-definitions/guide.md` — discover maps/glossaries at the new paths and stop assigning domain-language
  meaning to any `CONTEXT.md` variant.
- `src/agent-definitions/subagent-definitions/init-agent-prompt.md` — create/update `docs/domain-language.md`, use the
  renamed format, create `docs/` as needed, and limit writes to the new glossary path.
- `src/agent-definitions/subagent-definitions/slicer-prompt.md` — put the applicable `domain-language.md` path into
  child Plans whose implementation changes canonical language.
- `src/skills/diagnose/SKILL.md`, `src/skills/research/SKILL.md`, `src/skills/codebase-design/DESIGN-IT-TWICE.md`,
  `src/skills/improve-codebase-architecture/SKILL.md`, and
  `src/skills/improve-codebase-architecture/INTERFACE-DESIGN.md` — consume and update the new canonical locations
  without legacy fallback.
- `src/cmd/init/index.ts`, `src/cmd/init/index.test.ts`, `src/cmd/registry.js` — report that init writes
  `docs/domain-language.md` and preserve the current init completion contract and assertions.
- `src/shared/session/__tests__/session-tools-policy.test.js` — update the Guide policy assertion to the new protected
  domain-language artifact names.
- `docs/index.md`, `docs/quickstart.md`, `docs/user-facing-features.md`, `docs/entity-model.md`,
  `docs/design-system.md`, `docs/workflows.md`, and `docs/plan-lifecycle.md` — update current user/product guidance and
  direct links.
- `docs/prd/runwield-core-prd.md`, `docs/prd/runwield-workspace-PRD.md`, `docs/prd/agent-behavior-evaluation-prd.md`,
  `docs/prd/selective-execution-model-adaptation-prd.md`, `docs/vision/research-evidence-set-prd.md`,
  `docs/vision/runwield-bundles-prd.md`, and `docs/vision/spec-kit-importer-prd.md` — align maintained current/future
  specifications with the canonical names.

## Reuse Opportunities

- `src/shared/settings.js#migratePiSettingsOnce` — follow its explicit one-time migration/result pattern, while adding
  the stronger preflight and no-data-loss behavior needed for project files.
- `src/constants.js#getCwd` — resolve the current project root without directly snapshotting `Deno.cwd()`.
- Existing Deno filesystem APIs and temporary-directory test conventions — exercise real files rather than adding a
  dependency-injection seam for RunWield-owned migration machinery.
- Existing `src/cli.ts` command routing and ACP stdout-purity ordering — preserve command behavior while moving the
  implementation to TypeScript and emitting migration notices only to stderr.

## Implementation Steps

- [ ] `src/shared/domain-language.ts` defines typed canonical paths for `docs/domain-language.md`,
      `docs/domain-language-map.md`, and per-context `domain-language.md`, and defines exact-uppercase legacy names only
      for temporary migration; no RunWield guidance treats a legacy path as a readable fallback.
- [ ] Exact-case discovery compares `Deno.readDir` entry names rather than relying on case-sensitive path lookup, so a
      stored lowercase `context.md`/`context-map.md` remains byte-for-byte unchanged even on a case-insensitive
      filesystem.
- [ ] A successful single-context migration preserves the complete source content at `docs/domain-language.md`, creates
      `docs/` when absent, and removes only the exact uppercase root source after destination durability is established;
      a repeated call is a no-op.
- [ ] A successful multi-context migration moves exact-uppercase glossaries explicitly referenced by the legacy map to
      sibling `domain-language.md` files, rewrites only their local Markdown link targets, installs the rewritten map at
      `docs/domain-language-map.md`, and does not leave the canonical map pointing at a removed or unmigrated file.
- [ ] Destination conflicts, non-file/symlink sources, escaping or unsupported map links, and filesystem failures never
      overwrite either side or delete the only copy; the migration returns structured warnings and handles the single
      glossary and map migration units independently.
- [ ] `src/cli.ts` is a stable thin entrypoint for `deno.json`, compilation, and published launchers, while `src/cli.ts`
      preserves existing CLI routing and runs migration before project-capable TUI, ACP, Workspace, and command startup;
      `--help` and `--version` remain read-only, and notices/errors use stderr so ACP stdout remains protocol-pure.
- [ ] The migration implementation carries an explicit compatibility note that exact-uppercase support is temporary and
      may be deleted only in a future breaking-change Planned Change; it does not create a permanent dual-read policy.
- [ ] RunWield's own canonical glossary exists only at `docs/domain-language.md`, retains its current terms and stable
      relationships, and uses a domain-language title rather than presenting the filename as generic harness context.
- [ ] The bundled format is named `domain-language-format.md`; it specifies the settled single-context, map, and
      per-context layouts, and every Agent/Skill/subagent/template reference uses those paths consistently.
- [ ] `wld init` creates or updates `docs/domain-language.md`, creates the parent directory as needed, advertises that
      path in help/completion output, and tests retain the rule that init's Agent may modify only the canonical
      glossary.
- [ ] Current product docs and maintained PRDs link to or name the new artifacts; archived Plans and Work Records remain
      unchanged as historical evidence.
- [ ] Automated tests prove real migration behavior for exact-uppercase root files, lowercase and mixed-case immunity,
      destination conflicts, idempotent reruns, missing `docs/`, canonical multi-context links, malformed/escaping
      links, partial filesystem failure safety, and stderr-only startup reporting.

## Verification Plan

- Automated:
  `deno run -A scripts/run-tests.js src/shared/domain-language.test.ts src/cmd/init/index.test.ts src/shared/session/__tests__/session-tools-policy.test.js`
- Automated: run any CLI/compile tests affected by the thin `src/cli.ts` compatibility entrypoint, then `deno task ci`.
- Automated: search current guidance (excluding `docs/work-records/` and `plans/`) for `CONTEXT.md`, `CONTEXT-MAP.md`,
  or `CONTEXT-FORMAT.md`; only the migration module and its focused tests may retain those exact legacy literals.
- Manual: in a disposable single-context project, launch RunWield once with exact root `CONTEXT.md`; confirm the content
  appears at `docs/domain-language.md`, the old file is gone, and the migration is reported once.
- Manual: repeat with lowercase `context.md`; confirm no canonical file is created and the lowercase file is untouched.
- Manual: in a disposable multi-context project, use `CONTEXT-MAP.md` links to two nested exact-uppercase glossaries;
  confirm the new map path, sibling glossary paths, rewritten links, and a no-op second launch.
- Manual: pre-create a destination with different content; confirm startup warns on stderr, preserves both files
  exactly, continues running, and never exposes the warning on ACP stdout.
- Preserved behavior: CLI help/version, command routing, TUI startup, ACP protocol purity, init completion, and Agent
  tool policy remain covered. Expected-to-stop behavior: Agents no longer discover, read, create, or update legacy names
  after the startup migration boundary.

### Objective-Failing Checks

- `OC1` —
  `test -f docs/domain-language.md && test ! -e CONTEXT.md && test -f src/agent-definitions/document-formats/domain-language-format.md && test ! -e src/agent-definitions/document-formats/CONTEXT-FORMAT.md`
  — proves both this repository's glossary and the shipped format moved, without compatibility stubs under the colliding
  names.
- `OC2` —
  `bash -c 'set -eu; r=$PWD; t=$(mktemp -d); trap "rm -rf \"$t\"" EXIT; mkdir -p "$t/p" "$t/h"; printf legacy >"$t/p/CONTEXT.md"; printf lower >"$t/p/context.md"; (cd "$t/p" && HOME="$t/h" MNEMOSYNE_DB_PATH="$t/h/m.db" deno run -A "$r/src/cli.ts" plans >/dev/null 2>"$t/e"); test ! -e "$t/p/CONTEXT.md"; test "$(cat "$t/p/docs/domain-language.md")" = legacy; test "$(cat "$t/p/context.md")" = lower'`
  — launches the real CLI and proves exact-uppercase single-context migration plus lowercase immunity rather than
  trusting an implementation-owned test.
- `OC3` —
  `bash -c 'set -eu; r=$PWD; t=$(mktemp -d); trap "rm -rf \"$t\"" EXIT; mkdir -p "$t/p/one" "$t/h"; printf "%s\n" "# Contexts" "- [One]""(./one/CONTEXT.md)" >"$t/p/CONTEXT-MAP.md"; printf one >"$t/p/one/CONTEXT.md"; (cd "$t/p" && HOME="$t/h" MNEMOSYNE_DB_PATH="$t/h/m.db" deno run -A "$r/src/cli.ts" plans >/dev/null 2>"$t/e"); test ! -e "$t/p/CONTEXT-MAP.md"; test ! -e "$t/p/one/CONTEXT.md"; test "$(cat "$t/p/one/domain-language.md")" = one; grep -Fq "./one/domain-language.md" "$t/p/docs/domain-language-map.md"; ! grep -Fq "CONTEXT.md" "$t/p/docs/domain-language-map.md"'`
  — proves the actual startup boundary migrates a map and its referenced glossary without leaving a dangling legacy
  link.
- `OC4` —
  `bash -c 'set -eu; r=$PWD; t=$(mktemp -d); trap "rm -rf \"$t\"" EXIT; mkdir -p "$t/p/docs" "$t/h"; printf source >"$t/p/CONTEXT.md"; printf existing >"$t/p/docs/domain-language.md"; (cd "$t/p" && HOME="$t/h" MNEMOSYNE_DB_PATH="$t/h/m.db" deno run -A "$r/src/cli.ts" plans >/dev/null 2>"$t/e"); test "$(cat "$t/p/CONTEXT.md")" = source; test "$(cat "$t/p/docs/domain-language.md")" = existing; test -s "$t/e"'`
  — proves an existing canonical destination wins without data loss and the real CLI surfaces the conflict.
- `OC5` —
  `! grep -R -n -E 'CONTEXT\.md|CONTEXT-MAP\.md|CONTEXT-FORMAT\.md' src/agent-definitions src/skills src/cmd docs --exclude-dir=work-records`
  — proves current shipped guidance and maintained documentation no longer assign RunWield semantics to the colliding
  filenames; legacy literals remain isolated to the migration module/tests.

## Edge Cases & Considerations

- The execution baseline currently has unrelated uncommitted changes in `src/cmd/registry.js` and other files. Execution
  must begin only after those changes are committed or reconciled so this Plan does not overwrite active work.
- On case-insensitive filesystems, path existence alone cannot distinguish stored casing; exact `readDir` name
  comparison is an invariant, not an optimization.
- A multi-context map is a logical migration unit. Known conflicts must be detected before canonical destinations are
  installed; unexpected failure after destination creation must prefer safe duplication over deleting the only source.
- Local map links may contain `./`, `../`, anchors, or titles. Resolve paths relative to the legacy map, reject links
  escaping the project root, preserve anchors/titles, and rewrite only an exact final `CONTEXT.md` component.
- Existing canonical destinations win. Automatic content merging would make migration code an unintended domain-language
  authority and risks combining unrelated harness files.
- `docs/` may be absent, unwritable, or a non-directory. Warn and retain sources rather than blocking RunWield or losing
  language.
- Archived Plans and Work Records may continue to mention old paths. They are historical records, not current discovery
  instructions, and are deliberately excluded from cleanup checks.
- The temporary migration must not become a permanent fallback. Its future removal is intentionally deferred to a
  separately reviewed breaking-change Plan; that follow-up deletes legacy constants, migration logic/tests/notices, and
  the startup call while leaving canonical paths unchanged.
