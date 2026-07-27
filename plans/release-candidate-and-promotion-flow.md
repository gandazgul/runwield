---
classification: "FEATURE"
complexity: "HIGH"
summary: "Add a candidate-first-capable release workflow with explicit Operator choices, portable release policy, deterministic WLD tagging and promotion, and CI-enforced Candidate versus Stable publication semantics."
affectedPaths:
    - "RELEASING.md"
    - "README.md"
    - "deno.json"
    - ".github/workflows/release.yml"
    - "src/agent-definitions/operator.md"
    - "src/prompt-templates/release.md"
    - "src/shared/session/__tests__/session-tools-policy.test.js"
    - "src/shared/session/session-catalog.test.js"
    - "scripts/release.js"
    - "scripts/release.test.js"
    - "scripts/release-policy.test.js"
    - "scripts/write-version.js"
    - "scripts/write-version.test.js"
    - "scripts/release-check.js"
    - "scripts/release-check.test.js"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-26T18:50:18-04:00"
updatedAt: "2026-07-26T23:18:46.013Z"
status: "in_progress"
origin: "internal"
userVerifiedAt: null
userVerificationNote: null
humanReviewMode: null
humanReviewDecision: null
executionMode: "worktree"
executionBaselineTree: "678b590b2177fbb690fad035e13f5364ad707770"
worktreeId: "c4ad153f"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-release-candidate-and-promotion-flow-c4ad153f"
worktreeBranch: "runwield/worktree/release-candidate-and-promotion-flow-c4ad153f"
worktreeBaseBranch: "main"
worktreeStatus: "active"
---

# Release Candidate and Promotion Flow

## Context

The bundled `/release` Prompt Template currently follows one linear Stable-release procedure: infer a version, write a
changelog, push a tag, create a GitHub or GitLab release directly, and monitor CI. RunWield needs an explicit Candidate
flow so maintainers can publish and dogfood a qualified build without displacing the current Stable release, then
promote the exact Candidate source commit by rebuilding it with Stable release identity.

The current WLD tag workflow triggers for every `v*` tag, but it does not validate release-tag grammar or distinguish
Candidates from Stable releases when setting GitHub prerelease/latest state. The prompt and workflow can also race to
create the same GitHub release. WLD has no portable release-policy document or deterministic Candidate/promotion entry
point. Build identity normally comes from GitHub or an exact local tag, which becomes ambiguous when Candidate and
Stable tags intentionally point to the same commit.

The planning conversation settled these product rules:

- Keep one `/release` Prompt Template; do not create a separate RC prompt.
- Every invocation asks the user to choose **Create Candidate**, **Promote Candidate**, or **Create Stable Directly**.
- Give `user_interview` to Operator as a role capability; passive Prompt Templates must not grant or escalate tools.
- Use root `RELEASING.md` as WLD's canonical, portable release policy; do not add `.wld/release-instructions.md`.
- A Candidate tag is the canonical source reference. Do not persist a duplicate commit hash.
- Promotion resolves the Candidate tag's commit, rebuilds that exact source with Stable identity, and reseals artifacts.
- CI owns GitHub release creation. Operator waits for publication, then edits in curated release notes; notes are not
  committed to the repository.
- A Candidate must remain a GitHub prerelease and must never replace the current Stable/latest release.

## Objective

Provide a safe, documented release lifecycle that supports Candidate creation, Candidate-to-Stable promotion, and
exceptional direct Stable releases without duplicating prompt workflows or weakening Agent tool policy. WLD release
commands must fail closed before tags are pushed, promotion must prove exact source-commit reuse, generated binaries
must report the selected Candidate or Stable identity, and the GitHub workflow must enforce channel semantics rather
than relying on prompt timing.

## Approach

Keep the bundled `/release` prompt repository-neutral and orchestration-focused. Its first action will always be one
structured release-kind question through Operator. It will then perform operation-specific inspection of conventional
release documentation, scripts/tasks, and CI configuration; follow the repository's canonical procedure; ask for
confirmation immediately before the first irreversible tag/push action; monitor publication; and install curated notes
only after the host release exists. If repository policy and automation conflict, or the chosen lifecycle operation is
unsupported, it will stop instead of improvising.

Add `RELEASING.md` as WLD's canonical policy. Define Candidate tags as `vMAJOR.MINOR.PATCH-rc.N` with positive `N`,
Stable tags as `vMAJOR.MINOR.PATCH`, and promotion as a new Stable tag pointing to the peeled Candidate-tag commit.
Document cumulative changelog scope from the previous Stable, RC-specific validation guidance, recovery after partial
publication, explicit Candidate installation by tag, and the rule that a release is incomplete until Operator has
successfully edited its notes after CI publication.

Implement WLD's deterministic mechanics in a pure-JavaScript/JSDoc release CLI exposed through narrow Deno tasks for
Candidate creation, promotion, direct Stable creation, and workflow metadata. Separate read-only preflight from tag
creation/push, support dry-run inspection, and inject command/host dependencies so temporary repositories and stubbed
GitHub responses can prove behavior without touching real releases. All modes validate strict tag grammar, clean and
synchronized source state, existing local/remote tags, version relationships, and no-side-effect failure ordering.
Promotion additionally verifies that the Candidate GitHub release completed successfully as a prerelease with expected
assets before targeting its immutable tag commit.

Make release build identity explicit through an environment value used by local qualification and CI. Refactor release
qualification only enough to pass that identity into compilation, assert the standalone binary reports it, and restore
the generated version file on success or failure. Update the tag workflow to validate metadata before expensive jobs,
set the same explicit identity in qualification and every matrix build, serialize per tag, and publish Candidates with
`prerelease: true`/`make_latest: false` while publishing Stable tags with Stable/latest semantics. The workflow remains
the sole GitHub release creator; Operator edits notes only after successful workflow completion.

## Files to Modify

- `RELEASING.md` — define WLD's canonical Candidate, promotion, direct-Stable, changelog, publication, recovery, and
  explicit Candidate-install procedures.
- `README.md` — link maintainers to `RELEASING.md` from the development/release documentation without duplicating
  policy.
- `deno.json` — expose non-interactive `release:candidate`, `release:promote`, `release:stable`, and release-metadata
  tasks while retaining `release:check` as qualification.
- `.github/workflows/release.yml` — validate tag metadata, inject build identity, serialize releases, distinguish
  Candidate/Stable GitHub flags, and keep CI as sole release creator.
- `src/agent-definitions/operator.md` — add protected `user_interview` access and concise guidance for structured
  operational choices and pre-side-effect confirmations.
- `src/prompt-templates/release.md` — replace the linear release recipe with repository discovery, the settled three-way
  interview, policy/script delegation, confirmation, monitoring, and post-publication notes behavior.
- `src/shared/session/__tests__/session-tools-policy.test.js` — prove the effective bundled Operator retains
  `user_interview` through layered tool policy.
- `src/shared/session/session-catalog.test.js` — prove adversarial Prompt Template `tools:` front matter is discarded
  rather than exposed as invokable-template capability metadata.
- `scripts/release.js` — implement strict tag parsing, release-mode preflight, Candidate qualification, exact-commit
  promotion, annotated tag creation/push, dry-run output, and workflow metadata.
- `scripts/release.test.js` — cover release CLI parsing, preflight, source selection, qualification, failure ordering,
  and temporary Git remote behavior.
- `scripts/release-policy.test.js` — assert the portable policy, prompt contract, and workflow Candidate/Stable safety
  invariants without invoking a real release.
- `scripts/write-version.js` — add validated explicit build identity ahead of GitHub/exact-tag/hash fallbacks.
- `scripts/write-version.test.js` — cover Candidate/Stable explicit identity, shared-commit tag ambiguity, invalid
  input, and existing fallback behavior.
- `scripts/release-check.js` — accept an expected build identity, propagate it to compilation, verify `wld --version`,
  and restore generated source state.
- `scripts/release-check.test.js` — cover identity propagation/assertion, stage ordering, short-circuit behavior, and
  generated-version restoration while preserving current binary-resource checks.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/tui/slash-dispatch.js` — preserve the existing invariant that Prompt Templates switch to Operator before the
  expanded root turn; no prompt-specific tool-grant mechanism is needed.
- `src/shared/session/agents.js` and `src/tools/registry.js` — rely on existing bundled protected-tool enforcement so
  local/home Operator overrides cannot accidentally remove `user_interview` once it is bundled.
- `src/shared/session/__tests__/session-tools-policy.test.js` — follow current `loadAgentDef` assertions for effective
  bundled and overridden Agent toolsets.
- `scripts/write-version.js` — extend the current GitHub-tag/exact-tag/hash resolution chain rather than adding a second
  version writer.
- `scripts/release-check.js` — preserve its standalone compile, bundled Markdown extraction, and real Workspace review
  smoke tests while adding release-identity verification and cleanup.
- `scripts/check-submodule-fetchability.js` and the `submodules:check:remote` task — reuse the committed remote pin
  proof from local release preflight without copying its network implementation into the new release CLI.
- `.github/workflows/release.yml` — retain the existing source-quality, qualification, five-target build, packaging,
  checksums, schema asset, and `softprops/action-gh-release` stages.
- `install.sh` — reuse its existing positional version support for Candidate dogfooding; default `/releases/latest`
  remains the Stable channel and needs no production logic change.
- Existing temporary-directory and injected-command patterns in `scripts/*.test.js` — use them for isolated Git remotes
  and stubbed `gh`/workflow responses rather than contacting GitHub in tests.

## Implementation Steps

- [ ] Add `user_interview` to the bundled Operator tool list and update Operator guidance to use structured questions
      only when an operational choice or confirmation changes the action. Extend session tool-policy coverage to assert
      the effective Operator includes it and layered Prompt Templates still cannot grant tools.
- [ ] Rewrite `src/prompt-templates/release.md` as one generic lifecycle orchestrator. Make its first action an
      unconditional `user_interview` with exactly Create Candidate, Promote Candidate, and Create Stable Directly; then
      discover `RELEASING.md` or conventional linked release docs plus tasks/scripts and CI for the chosen operation.
      Stop on cancellation, unsupported choices, or conflicting policy, and request a final yes/no confirmation before
      the first tag/push side effect.
- [ ] In the prompt, preserve the current user-focused changelog style but make its range operation-aware: Candidate and
      Stable notes are cumulative from the previous Stable, later Candidates also summarize validation-relevant changes
      since the prior Candidate, and promotion removes Candidate warnings without treating the same source commit as an
      empty release. Keep notes in a temporary file, wait for CI to create the host release, edit the release through
      `gh`/`glab`, verify the resulting notes, and report an exact retry command if notes remain pending.
- [ ] Create root `RELEASING.md` and link it from `README.md`. Document WLD's strict tag grammar, Candidate ordinal
      selection, clean/synchronized `main` prerequisite, required CLIs/authentication, qualification, exact
      Candidate-tag promotion, exceptional direct Stable path, cumulative notes, CI ownership, post-publication note
      editing, Candidate installation (`bash install.sh vX.Y.Z-rc.N`), rollback/current-Stable preservation, and
      recovery from local tag creation, remote tag push, workflow failure, or notes-edit failure.
- [ ] Implement `scripts/release.js` with JSDoc typedefs and exported pure helpers for tag parsing, Candidate-to-Stable
      mapping, numeric SemVer/RC ordering, remote tag inspection, peeled commit resolution, expected asset validation,
      and Candidate/Stable workflow metadata. Reject malformed tags (including `rc.0`, alternate prerelease labels,
      missing `v`, control/path characters), base-version mismatches, regressions, moved/existing tags, and ambiguous
      source state.
- [ ] Add exact non-interactive command contracts: `deno task release:candidate --tag vX.Y.Z-rc.N [--dry-run]`,
      `deno task release:promote --candidate vX.Y.Z-rc.N [--dry-run]`, and
      `deno task release:stable --tag vX.Y.Z [--dry-run]`. Candidate/direct Stable preflight the clean checkout at
      synchronized `main` and run the existing `submodules:check:remote` proof before qualification; promotion fetches
      tags, verifies the selected Candidate is a successful prerelease with the complete WLD asset set, resolves its
      peeled commit, and qualifies that source in a temporary detached release worktree with Stable build identity.
      Perform every check before creating an annotated local tag; push only that tag; record only
      `Promoted-From: <Candidate tag>` as source provenance in the Stable annotation (no duplicate commit field); and
      make `--dry-run` perform read-only preflight and print the proposed tag target/push without tag, push,
      host-release, or repository-file side effects.
- [ ] Add `deno task release:metadata --tag <tag>` as a side-effect-free CI contract that writes exactly one JSON object
      to stdout with `{ tag, kind, buildVersion, prerelease, makeLatest }` and sends any diagnostics to stderr. Keep
      Prompt Template text passive: do not add `tools:` support to Prompt Template parsing and do not let local, home,
      or package templates expand Agent authority.
- [ ] Extend `scripts/write-version.js` with a validated explicit `WLD_BUILD_VERSION` (or equivalently named release
      build input) at highest precedence. Accept strict Candidate/Stable identities required by WLD release tasks,
      reject unsafe non-empty values, and preserve GitHub tag, exact local tag, short hash, and `dev` fallback behavior
      for ordinary builds.
- [ ] Refactor `scripts/release-check.js` to accept `--build-version`, pass the explicit identity through the compile
      subprocess, capture `wld --version`, and fail when the produced binary reports any other version. Snapshot and
      restore `src/shared/version.js` in `finally` so qualification leaves both the primary checkout and temporary
      promotion worktree clean after success or any failed stage. Preserve bundled-resource and Workspace smoke checks.
- [ ] Update `.github/workflows/release.yml` so a metadata/validation stage rejects unsupported `v*` tags before
      qualification, sets explicit build identity in qualification and all matrix builds, and packages assets from the
      validated identity rather than an unchecked branch/ref value. Add per-tag concurrency and remove
      `workflow_dispatch`; real publication must run only from a pushed, validated tag so checkout SHA and the peeled
      release-tag commit have one authoritative relationship.
- [ ] Make workflow publication channel-safe: Candidate tags create GitHub prereleases with `make_latest: false`; Stable
      tags create non-prereleases and become latest only after all qualification/build jobs succeed. Preserve all five
      platform archives, Zstandard/gzip formats, checksums, `SHA256SUMS`, and `config.schema.json`. `scripts/release.js`
      must never call host release-create/edit commands; CI alone creates the GitHub release, and Operator alone edits
      its notes after CI finishes.
- [ ] Add focused release CLI tests using temporary repositories/bare remotes and injected command responses. Cover
      valid Stable/RC parsing, numeric ordering, Candidate ordinal progression, previous-Stable range selection,
      Candidate qualification/assets, promotion to the Candidate's peeled commit rather than `HEAD`, direct-Stable
      behavior, existing/moved tags, dirty/diverged checkouts, cancellation/dry-run no-side-effects, no persisted source
      SHA beside the Candidate tag, no host release-create/edit command from the CLI, and no tag/push after any failed
      preflight.
- [ ] Add policy/workflow contract tests that read `RELEASING.md`, `release.md`, and the workflow. Assert the exact
      three choices, interview-before-discovery ordering, policy discovery, CI-only release creation, explicit build
      identity, Candidate prerelease/not-latest flags, Stable latest semantics, asset preservation, and post-publication
      notes editing. Add an adversarial local Prompt Template containing `tools:` and prove catalog/invocation handling
      cannot add those tools beyond effective Operator policy. Extend version and release-check tests for precedence,
      identity mismatch, cleanup, and stage order.

## Verification Plan

- Automated:
  `deno fmt --check RELEASING.md README.md deno.json .github/workflows/release.yml src/agent-definitions/operator.md src/prompt-templates/release.md src/shared/session/__tests__/session-tools-policy.test.js src/shared/session/session-catalog.test.js scripts/release.js scripts/release.test.js scripts/release-policy.test.js scripts/write-version.js scripts/write-version.test.js scripts/release-check.js scripts/release-check.test.js`
- Automated:
  `deno test -A --no-check src/shared/session/__tests__/session-tools-policy.test.js src/shared/session/session-catalog.test.js scripts/release.test.js scripts/release-policy.test.js scripts/write-version.test.js scripts/release-check.test.js`
- Automated: `deno task release:check --build-version v0.0.0-rc.1` and verify the standalone binary reports that exact
  identity while `git diff -- src/shared/version.js` remains empty afterward.
- Automated: `deno task ci`.
- Manual, no real publication: run Candidate, promotion, and direct-Stable commands with `--dry-run`; confirm each
  prints the intended source commit, target tag, release kind, qualification steps, and proposed tag push without
  creating local/remote tags, host releases, or repository files.
- Manual, isolated fixture: against a disposable bare Git remote and stubbed `gh`, create a Candidate and promote it;
  confirm Candidate and Stable tags peel to the same commit, qualification receives different build identities, and a
  failed Candidate asset check prevents Stable tag creation.
- Manual/config inspection: confirm `/release` invokes one three-choice `user_interview`, asks again before irreversible
  action, waits for the tag workflow, and treats a failed notes edit as recoverable incomplete publication rather than
  recreating the release.
- Expected: a Candidate workflow succeeds as a prerelease, leaves GitHub latest/default installer/schema URLs on the
  prior Stable, and remains installable by explicit tag.
- Expected: promotion rebuilds the Candidate tag's exact source as `vX.Y.Z`, publishes it as Stable/latest only after
  all gates pass, and completes only after curated notes are verified.
- Expected: direct Stable release remains available only through the explicit interview choice and follows the same
  preflight, qualification, CI ownership, and notes-completion rules.
- Execution policy matrix:
  - FEATURE Plans may omit `executionAgent`; omission defaults to `engineer` for backward compatibility.
  - FEATURE Plans may set `executionAgent: "engineer"` with `collaborationRecommendation: "autonomous"` or omitted.
    `pair` is invalid for Engineer-owned execution.
  - FEATURE Plans may set `executionAgent: "frontend-engineer"` with `collaborationRecommendation: "autonomous"` or
    `"pair"`.
  - Use `frontend-engineer` for browser-rendered UI work whose primary outcome is materially visual or interactive;
    otherwise use `engineer` (including TUI work and incidental frontend-file edits).
  - Recommend `pair` only when live visual judgment is valuable; use `autonomous` otherwise. Include known dev-server
    hints and exact headed-browser checks. Real-browser verification is mandatory for Frontend Engineer unless
    externally blocked.
  - PROJECT Epics are non-executable containers and must not define `executionAgent` or `collaborationRecommendation`;
    execution policy belongs only on child FEATURE Plans.
  - Legacy `frontend: true` on FEATURE Plans is still accepted as Frontend Engineer/autonomous compatibility metadata,
    but new Plans should use canonical `executionAgent` / `collaborationRecommendation` instead. Legacy
    `frontend: false` remains Engineer compatibility metadata and is distinct from an absent canonical owner.

## Edge Cases & Considerations

- The working tree contains unrelated Runtime/TUI changes outside this Plan's affected paths; execution must occur in
  the Plan worktree and must not overwrite or absorb those primary-checkout edits.
- The local/remote submodule-check split and multi-target UX tasks are now committed in the baseline. Preserve the
  existing `submodules:check`, `submodules:check:remote`, UX, and `release:check` tasks when adding release tasks. WLD's
  local Candidate/direct-Stable preflight should invoke the existing remote-fetchability task rather than duplicate its
  implementation; tag CI's recursive submodule checkout remains its remote pin-availability proof.
- GitHub release publication precedes Operator's notes edit by design. The release may briefly exist with default/empty
  notes; completion reporting and recovery must distinguish successful assets from pending notes without deleting or
  recreating the release. Temporary notes must remain untracked and be removed afterward; no changelog/release-note file
  may be staged, committed, or left in the repository, and successful or recoverably incomplete operations must preserve
  repository cleanliness.
- A pushed immutable tag is an irreversible boundary. All local qualification and remote Candidate checks must finish
  first; recovery should rerun workflow/notes operations rather than move or reuse a bad tag.
- Candidate and Stable tags on one commit make local `git describe --exact-match` nondeterministic. Release builds must
  use explicit identity; ordinary development retains current fallback behavior.
- Promotion may happen after `main` advances. It must use the Candidate tag's peeled commit in an isolated checkout,
  never current `HEAD`, while still proving the Candidate's host release and assets are complete.
- Multiple release attempts must serialize per target tag and reject duplicate local/remote tags/releases. RC ordinals
  compare numerically so `rc.10` follows `rc.9`.
- GitHub has first-class prerelease/latest flags; GitLab does not provide identical `glab release create` semantics. The
  generic prompt must follow host/repository policy and avoid promising GitHub-equivalent channel behavior where the
  host cannot enforce it.
- Default `install.sh` and schema URLs depend on GitHub `/releases/latest`; workflow tests must guard Candidate
  `make_latest: false` because no installer-side filtering can repair an incorrectly promoted Candidate.
- No new Prompt Template tool-grant feature is in scope. Unknown `tools:` front matter remains non-authoritative, and
  the committed cleanup that removed it from `release.md` is the baseline rather than a Plan task.
