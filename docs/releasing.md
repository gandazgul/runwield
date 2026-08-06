# Releasing wld

This document is wld's release policy. It is intentionally repository-specific: the bundled `/release` prompt must read
this file when releasing this repository, but wld users releasing other repositories must follow their own repository's
release policy and automation. In particular, wld's permission to release a tagged `HEAD` from a dirty working tree and
rely on GitHub Actions for qualification is not a general RunWield default; another repository may require a clean tree,
a protected branch, local qualification, or different release infrastructure.

## Release operations

wld supports three release operations:

- **Create Candidate** — publish a prerelease build for dogfooding and validation.
- **Promote Candidate** — rebuild the exact Candidate source commit with Stable identity and publish it as Stable.
- **Create Stable Directly** — exceptional path for a Stable release without a Candidate.

The `/release` prompt asks which operation to run before inspecting this policy in detail. All release commands are
non-interactive so the prompt can own user choices and final confirmation.

## Breaking change in the current release

The next release moves the canonical Plan store from `plans/` to `docs/plans/`. Release notes for the release that
contains this change MUST include the following breaking-change copy verbatim in the **Breaking Changes** section:

> RunWield now reads Plans only from `docs/plans/`. Before upgrading, move your existing `plans/` directory to
> `docs/plans/`; the release does not migrate or read the old location.

There is no migration command, fallback read, symlink support, or deprecation period for the old location.

## Tags and channels

- Stable tags use `vMAJOR.MINOR.PATCH`, for example `v0.8.12`.
- Candidate tags use `vMAJOR.MINOR.PATCH-rc.N`, for example `v0.8.12-rc.1`.
- Candidate ordinals start at `1` and compare numerically.
- The Candidate tag is the canonical source reference. Do not store a duplicate source commit hash in release metadata.
- A Candidate release must be a GitHub prerelease and must not become GitHub latest.
- Stable releases are non-prereleases and become GitHub latest only after qualification and artifact publication
  succeed.

## Immutability boundary

A tag is a release attempt, not a release. Pushing a tag does not by itself make that tag immutable. The immutable
boundary is creation of the GitHub Release for that tag. As soon as a GitHub Release exists—even if asset upload or the
later notes edit is incomplete—the tag must continue to identify the same commit forever. Do not delete the GitHub
Release to make the tag reusable.

Before a GitHub Release exists, a failed tag attempt may be deleted and retried at a corrected commit when all of these
conditions hold:

- The tag-triggered workflow failed before creating the GitHub Release.
- The corrected commit is the immediate child of the failed tag's commit and is the current `HEAD`; in other words, the
  fix is exactly the next commit after the failed attempt.
- The corrected commit is still a valid source for the selected release operation. In particular, Candidate promotion
  must still use the selected Candidate's peeled commit.
- Immediately before deleting the remote tag, the operator verifies again that no GitHub Release exists for it.

Delete both remote and local copies of the failed tag, then rerun the repository-owned release command so it creates the
same tag at the new `HEAD`. If any condition is false, keep the tag and use the recovery workflow when appropriate, or
choose a new release tag. Never move a tag after its GitHub Release has been created.

The default installer and schema URLs use GitHub `/releases/latest`; therefore a Candidate must never displace the
current Stable channel. To dogfood a Candidate explicitly, install by tag:

```bash
bash install.sh vX.Y.Z-rc.N
```

## Required tools and authentication

Release operators need:

- `git` with push access to this repository.
- `deno` matching the repository toolchain.
- `gh` authenticated to GitHub with permission to read releases before tagging, verify Candidate releases during
  promotion, and edit release notes after CI publishes assets (`gh auth status` should pass for the target account).

## Release source

Create Candidate and direct Stable operations release the commit resolved by `HEAD` when the operation begins. The
current branch does not need to be `main`, `HEAD` does not need to match an upstream branch, and the working tree does
not need to be clean. Staged, unstaged, and untracked changes are not part of the release because they are not part of
the tagged commit.

Before confirmation, show the resolved `HEAD` commit and target tag so the operator can verify the source. Create the
annotated tag at that explicit commit, push it, and monitor the tag-triggered GitHub Actions workflow. GitHub Actions is
the authoritative release qualification environment and runs the remote submodule pin proof, release checks, builds, and
publication from the tagged commit.

Promotion resolves the Candidate tag from `origin` and creates the Stable tag at that tag's peeled commit. It must never
promote current `HEAD` by accident. GitHub Actions qualifies the promoted Stable identity from that commit.

## Commands

Use these repository-owned commands instead of hand-writing tag or build commands:

```bash
deno task release:candidate --tag vX.Y.Z-rc.N [--dry-run]
deno task release:promote --candidate vX.Y.Z-rc.N [--dry-run]
deno task release:stable --tag vX.Y.Z [--dry-run]
deno task release:metadata --tag vX.Y.Z[-rc.N]
deno task release:check --build-version vX.Y.Z[-rc.N]
```

Dry runs perform read-only tag, version, and source preflight and print the proposed tag target and tag push. They must
not require a clean working tree, run local release qualification, create local tags, push remote tags, create host
releases, or leave repository files behind.

## Candidate creation

1. Choose the next Candidate tag.
2. Generate cumulative release notes from the previous Stable tag to the current source commit. Later Candidates should
   keep the cumulative upgrade notes and add validation-relevant changes since the previous Candidate when useful.
3. Run `deno task release:candidate --tag <candidate-tag> --dry-run` and inspect the resolved `HEAD` commit and proposed
   tag.
4. Confirm the tag push. The tag remains a retryable release attempt until its GitHub Release is created.
5. Run `deno task release:candidate --tag <candidate-tag>`.
6. Wait for the tag-triggered GitHub workflow to publish the prerelease assets.
7. Edit the published Candidate release with the curated temporary notes and verify they landed.

## Candidate promotion

1. Select the Candidate tag to promote.
2. Verify the Candidate GitHub release is published as a prerelease and includes every expected wld asset.
3. Generate Stable release notes cumulative from the previous Stable. Remove Candidate-specific warnings, but do not
   treat promotion as an empty release merely because the source commit is unchanged from the Candidate.
4. Run `deno task release:promote --candidate <candidate-tag> --dry-run` and inspect the Candidate source commit and
   target Stable tag.
5. Confirm the tag push. The tag becomes immutable when its GitHub Release is created.
6. Run `deno task release:promote --candidate <candidate-tag>`.
7. Wait for the Stable tag-triggered GitHub workflow to publish Stable assets.
8. Edit the published Stable release with the curated temporary notes and verify they landed.

Promotion creates a Stable tag at the Candidate tag's peeled commit. The Stable tag annotation may include
`Promoted-From: <candidate-tag>` and must not persist a separate source commit field.

## Direct Stable creation

Direct Stable is an exceptional path. Use it only when explicitly chosen and appropriate for the risk of the change. It
follows the same source selection, tag workflow, GitHub Actions qualification, and post-publication notes-editing rules
as Candidate creation, but the target tag is a Stable tag.

## GitHub workflow ownership

The tag-triggered workflow owns release qualification, builds, GitHub release creation, and asset upload. Local release
commands validate release metadata, create and push tags, and monitor that workflow. They must not require local
qualification and must not call `gh release create`, `gh release edit`, `glab release create`, or `glab release edit`.

The workflow also exposes a required-tag manual dispatch solely for recovery when a tag cannot or should not be
moved—for example, after its GitHub Release has made it immutable, or when a workflow-only fix on the default branch can
safely retry the existing tagged source. In that mode, the source-quality job runs from the default-branch workflow
revision containing the recovery fix, while metadata validation, release qualification, builds, and publication
explicitly check out the existing tag. Never use manual recovery to bypass a genuine failure in tagged product source.
Once a GitHub Release exists, never move its tag to include a later fix.

After CI publishes a release, Operator edits the release notes from the curated temporary notes file. A release is not
complete until this notes edit is verified. If assets are published but notes editing fails, report the release as
recoverably incomplete and retry with:

```bash
gh release edit <tag> --notes-file <notes-file>
```

## Recovery

- **Local tag created but not pushed**: delete the local tag after confirming no remote tag exists, repair the issue,
  and rerun the command.
- **Remote tag pushed, workflow failed, and no GitHub Release exists**: if the fix is the immediate next commit and all
  conditions in **Immutability boundary** hold, verify the absence of a GitHub Release, delete the remote and local tag,
  and rerun the release command at the corrected `HEAD`. Otherwise keep the tag and use a new release tag or the manual
  recovery workflow when safe.
- **GitHub Release exists**: the tag is immutable, including when qualification, asset upload, or notes editing later
  fails. Keep the tag at its original commit and recover the existing release. If a workflow fix is required, dispatch
  `release-wld` manually with that tag after the recovery commit reaches the default branch.
- **Candidate published but should not be promoted**: leave it as a prerelease and publish a later Candidate tag.
- **Assets published but notes pending**: do not recreate the release. Retry the notes edit and verify the published
  notes.

## Verification expectations

- Candidate binaries report the Candidate identity, for example `runwield v0.8.12-rc.1 (...)`.
- Promoted Stable binaries report the Stable identity, for example `runwield v0.8.12 (...)`.
- Candidate and promoted Stable tags peel to the same source commit.
- Candidate publication leaves GitHub latest on the prior Stable.
- Local working-tree changes remain untouched throughout the release operation.
