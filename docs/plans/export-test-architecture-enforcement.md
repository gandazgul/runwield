---
planId: "e16197ef-5655-4ea4-a410-bf23427a85c6"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
summary: "Export RunWield's test-architecture enforcement through wld init and wld check, backed by a reviewed project manifest of genuine external capability ports, then adopt that manifest in RunWield CI so product-owned machinery cannot become injectable under a new spelling."
affectedPaths:
    - ".wld/test-architecture.json"
    - "AGENTS.md"
    - "deno.json"
    - "docs/user-facing-features.md"
    - "docs/testing.md"
    - "scripts/check-injection-seams.js"
    - "scripts/check-injection-seams.test.js"
    - "src/cmd/check/"
    - "src/cmd/init/index.ts"
    - "src/cmd/init/index.test.ts"
    - "src/cmd/registry.js"
    - "src/shared/test-architecture/"
objectiveChecks:
    - id: "OC1"
      command: "test -f src/cmd/check/index.test.ts && deno run -A scripts/run-tests.js src/cmd/check/index.test.ts"
      rationale: "The new public command has behavioral coverage; this fails today because wld check and its test module do not exist."
    - id: "OC2"
      command: "grep -q 'test-architecture.json' src/cmd/init/index.test.ts && deno run -A scripts/run-tests.js src/cmd/init/index.test.ts"
      rationale: "Init scaffolds the project policy through its real fixture flow; this fails today because init has no test-architecture behavior."
    - id: "OC3"
      command: "test -f .wld/test-architecture.json && deno run -A src/cli.js check test-architecture"
      rationale: "RunWield consumes the same project-facing manifest and command it ships downstream; this fails today because neither exists."
    - id: "OC4"
      command: "grep -q 'deno run -A src/cli.js check' deno.json && deno task ci"
      rationale: "The exported command is a required RunWield CI gate rather than documentation-only advice; this fails today because CI invokes only the repository-local seam script."
createdAt: "2026-08-04T23:55:00-0400"
updatedAt: "2026-08-04T23:55:00-0400"
status: "draft"
origin: "user"
---

# Export Test-Architecture Enforcement through `wld init` and `wld check`

## Context

RunWield has reached a zero injection-seam baseline after removing dependency bags, optional implementation fallbacks,
test-only production branches, and replaceable product-owned machinery. The repository-local
`scripts/check-injection-seams.js` ratchet prevents known spellings from returning, and the bundled `write-tests` skill
teaches agents to exercise real machinery with fixture environments while faking only genuine external boundaries.

Two gaps remain:

1. the current detector infers ownership from names and syntax. A required constructor or parameter can still make an
   internal collaborator replaceable while avoiding the optional-fallback shapes that the ratchet recognizes;
2. downstream projects initialized with RunWield receive testing guidance but not the mechanical enforcement, so the
   same failure mode can reappear as soon as an agent finds dependency injection convenient.

The durable rule is ownership-based: an injection seam is a public claim that a capability is external. A project should
maintain a small reviewed list of the contracts that truly cross its boundary. Every other product-owned collaborator
remains composed and is exercised through public behavior using real fixtures.

## Objective

Ship a project-facing test-architecture check that:

- gives `wld init` a deterministic, idempotent way to scaffold a versioned project manifest and report injectable
  collaborator candidates requiring ownership classification;
- gives `wld check test-architecture` a stable non-interactive command that scans project production source, validates
  the manifest, and exits non-zero with actionable file/line findings;
- makes bare `wld check` run every configured RunWield project check, including test architecture;
- permits required injection only for contracts explicitly declared as genuine external capabilities in the manifest;
- always rejects dependency bags, optional production fallbacks, conditional test branches, and replaceable
  product-owned machinery, even when a declared external port is involved;
- adopts the same manifest and public command inside RunWield itself, replacing the private zero-count ratchet as the CI
  entry point without weakening any existing detector coverage;
- exports the policy to JavaScript and TypeScript projects first, with a clear unsupported-language result instead of
  pretending a text heuristic provides cross-language enforcement.

## Resolved Decisions

### The manifest is an ownership allowlist, not a debt baseline

The project file is `.wld/test-architecture.json`. It is versioned with the repository and contains:

- `version`;
- production `sourceGlobs` and explicit test/fixture exclusions;
- `externalCapabilities`, each with a stable id, a contract reference (`path#exportedTypeOrInterface`), the external
  system it represents, and a human-readable ownership rationale.

It does not contain counts, accepted violations, per-site suppressions, wildcard parameter names, or a way to adopt new
findings. Adding an external capability is a reviewable architecture change. A declaration permits only a required,
typed port; it never permits an optional fallback or an override bag.

RunWield's initial manifest lists only genuine boundaries already present in production composition: Git/subprocesses,
browser launch, model/agent turns, hosted CI, clocks, process exit/update network, GitHub CLI, and Mnemosyne. Pi-owned
low-level session/model machinery may be declared where RunWield consumes it as an external package boundary;
RunWield-owned SessionRuntime, Plan Lifecycle, Work Record storage/generation, registries, transactions, locks, and
persistence coordinators may not.

### Detection is syntax-aware and language-scoped

Move the reusable detection and reporting logic under `src/shared/test-architecture/`. Parse JavaScript, JSX,
TypeScript, and TSX syntax rather than extending regular-expression capture groups. Preserve the old detector's
regression corpus as characterization tests, including renamed bags, destructuring aliases, positional defaults,
property fallbacks, constructor assignments, inline callbacks, conditional bags, and known false-positive cases.

The ownership pass additionally finds required behavioral collaborators accepted through function parameters,
constructor parameters, option properties, and stored fields. A site is allowed only when its type/JSDoc contract
resolves to an exact manifest entry. Untyped production injection is a finding; downstream projects must type the
external contract or keep the machinery internally composed. Data/configuration parameters are not collaborators.

The first release supports JS/TS-family files only. Other language files are ignored with an explicit summary stating
that no architecture claim was made for them; future language analyzers plug into the same finding contract.

### `wld init` scaffolds; it does not silently classify ownership

On a project without `.wld/test-architecture.json`, `wld init` atomically writes a schema-valid manifest with detected
production source globs and no approved external capabilities, then runs discovery. It reports candidate contracts and
plain-language instructions to classify only systems outside the product boundary. It never writes candidates into the
allowlist and never changes an existing manifest.

The Init Agent remains responsible for `docs/domain-language.md`; the command's deterministic setup owns the manifest.
This avoids asking an LLM to make and persist architecture exceptions during onboarding. Re-running init is
byte-for-byte idempotent for the manifest.

### `wld check` is the public CI surface

Add a CLI-only `check` command:

- `wld check` runs all checks configured by RunWield for the current project;
- `wld check test-architecture` runs only this policy;
- `wld check test-architecture --discover` prints undeclared candidate contracts without changing files;
- machine-readable `--format json` and human-readable default output share one typed result model;
- invalid/missing manifests, findings, and unsupported manifest versions have distinct actionable diagnostics and a
  non-zero exit; an absent manifest tells the user to run `wld init`.

RunWield's `deno task ci` calls the public command. The old script remains temporarily as a thin CLI compatibility
wrapper over the shared analyzer only if repository tooling still needs `seams:check`; it may not retain a second
implementation or separate baseline.

## Files to Modify

- `src/shared/test-architecture/` — manifest schema/types, JS/TS parser adapter, candidate ownership analysis, legacy
  seam rules, typed findings, and human/JSON reporting.
- `src/cmd/check/index.ts` and `index.test.ts` — CLI parsing and behavior for aggregate and focused project checks.
- `src/cmd/init/index.ts` and `index.test.ts` — isolated-project scaffolding, discovery output, preservation of existing
  manifests, and idempotence.
- `src/cmd/registry.js` — register the CLI-only `check` command and help.
- `scripts/check-injection-seams.js` and its tests — delegate to the shared analyzer while preserving the existing
  characterization corpus during migration; remove the zero-count baseline once public-command parity is proven.
- `.wld/test-architecture.json` — RunWield's reviewed external-capability manifest.
- `deno.json` — route CI through `wld check`; retain a named local task only as an alias to the public command.
- `AGENTS.md`, `docs/testing.md`, and `docs/user-facing-features.md` — document ownership declarations, init/check
  workflow, supported languages, and the rule that the manifest is not a suppression file.

## Implementation Steps

1. **One shared analyzer owns every seam verdict.** The existing regression corpus passes against a typed analyzer under
   `src/shared/test-architecture/`, and `scripts/check-injection-seams.js` contains no independent pattern matcher.
2. **The versioned manifest can express only reviewed external ownership.** Parsing rejects unknown versions, malformed
   contract references, duplicate ids/contracts, wildcard exemptions, per-site ignores, and entries without an
   external-system description and rationale.
3. **Required internal collaborators become findings.** Analyzer fixtures prove that constructor, positional,
   destructured, stored-field, and options-property injection of product-owned machinery fails even without an optional
   fallback, while data parameters and internally constructed machinery pass.
4. **Declared external ports pass only in the safe shape.** Fixtures prove an exact allowlisted typed contract passed as
   a required argument is accepted, but optional defaults, `||`/`??` fallbacks, dependency bags, conditional test paths,
   and untyped lookalikes still fail.
5. **`wld check test-architecture` is deterministic and automation-ready.** It resolves the project root, loads the
   manifest, scans only configured production files, emits stable human/JSON findings with paths and lines, and returns
   correct exit codes without reading or writing home-global RunWield state.
6. **Bare `wld check` composes configured checks without hiding failures.** The command reports each check and exits
   non-zero when any configured check fails; focused subcommand and help behavior remain available through the canonical
   command registry.
7. **`wld init` installs policy without granting exceptions.** In a temporary fixture project and isolated HOME, first
   init atomically creates the empty reviewed allowlist plus discovered source globs, reports candidates, and second
   init preserves identical bytes. A pre-existing manifest is never overwritten.
8. **RunWield dogfoods the exported policy.** `.wld/test-architecture.json` names every genuine external contract and no
   product-owned machinery; all current source passes `wld check test-architecture`; deleting one declaration produces a
   finding for its real usage, while making an internal collaborator injectable produces a finding without changing the
   manifest.
9. **CI and guidance use the public surface.** `deno task ci` invokes `wld check`, the legacy task delegates to it, and
   docs tell downstream projects to review manifest additions like API-boundary changes rather than re-baselining.
10. **Counterfeit resistance is demonstrated.** Mutation checks reintroduce a renamed bag, a required internal
    constructor dependency, an optional fallback for an allowed port, and a wildcard-like manifest exception; each
    mutation makes the focused check fail before being reverted.

## Preserved Behavior

- Existing `wld init` model setup, bundled-asset extraction, Init Agent execution, `docs/domain-language.md` generation,
  and init-state recording remain intact.
- Existing detector true positives and false-positive exclusions remain protected by the current test corpus.
- No test or command reads the user's real `~/.wld`, settings, Plans, Mnemosyne database, browser, or checkout state;
  command tests use temporary project roots and isolated HOME.
- Runtime production ports remain explicitly composed at application composition roots; this change does not introduce
  new injectable collaborators merely to test the checker.

## Verification Plan

- Objective-Failing Checks: OC1–OC4 from Front Matter.
- Focused analyzer tests cover every legacy detector fixture, required internal injection, exact manifest matching,
  malformed manifests, unsupported versions, JS/JSDoc, TypeScript, JSX/TSX, exclusions, and stable JSON output.
- Focused command tests exercise the real command registry, filesystem scanner, manifest reader/writer, and Init command
  in temporary roots; fake only process exit when an isolated subprocess is not cheaper.
- Mutation proof: restore each forbidden form named in Step 10 and confirm that the specific focused test and
  `wld check test-architecture` go red, then revert the mutation.
- Run `deno task check`, `deno task lint`, `deno task doc-links:check`, the focused command/analyzer tests,
  `deno run -A src/cli.js check`, and full `deno task ci` through `scripts/run-tests.js` isolation.
- Confirm test-count deltas and account for every rewritten detector test; migration to the shared analyzer must not
  delete a behavioral case merely because the old script entry point disappears.

## Edge Cases & Considerations

- Imported third-party types and project-owned adapters can share a name; manifest identity is resolved by canonical
  project-relative contract path plus export, never by a suffix such as `Port`.
- A port aggregate is allowed only when the aggregate contract itself is declared and every member represents the same
  external system; a generic `ports` or `deps` bag is a finding.
- Tests and fixtures may implement declared external contracts, but production source exclusions cannot be broadened to
  hide a finding. Generated/vendor directories use explicit source-glob exclusions.
- Source parse failures are check failures with file/line diagnostics, not silently skipped files.
- The Init command must not modify `.gitignore`, package scripts, CI workflows, AGENTS.md, or an existing manifest
  without an explicit later user action; onboarding creates only the new manifest in addition to its existing outputs.
- The external-capability list is expected to be small. If adopting RunWield reveals a large list, that is architecture
  feedback to resolve, not a reason to add wildcard support.
