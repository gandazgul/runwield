# Releasing wld

This document is wld's release policy. It is intentionally repository-specific: the bundled `/release` prompt must read
this file when releasing this repository, but wld users releasing other repositories must follow their own repository's
release policy and automation.

## Release operations

wld supports three release operations:

- **Create Candidate** — publish a prerelease build for dogfooding and validation.
- **Promote Candidate** — rebuild the exact Candidate source commit with Stable identity and publish it as Stable.
- **Create Stable Directly** — exceptional path for a Stable release without a Candidate.

The `/release` prompt asks which operation to run before inspecting this policy in detail. All release commands are
non-interactive so the prompt can own user choices and final confirmation.

## Tags and channels

- Stable tags use `vMAJOR.MINOR.PATCH`, for example `v0.8.12`.
- Candidate tags use `vMAJOR.MINOR.PATCH-rc.N`, for example `v0.8.12-rc.1`.
- Candidate ordinals start at `1` and compare numerically.
- The Candidate tag is the canonical source reference. Do not store a duplicate source commit hash in release metadata.
- A Candidate release must be a GitHub prerelease and must not become GitHub latest.
- Stable releases are non-prereleases and become GitHub latest only after qualification and artifact publication
  succeed.

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
- Standard build/archive tools used by the release workflow and local checks, including `tar`, `zstd`, and `sha256sum`.

## Required local state

Create Candidate and direct Stable operations run from a clean `main` checkout whose `HEAD` matches its upstream and the
current `origin/main` tip. Before tagging, the release command must also run the remote submodule pin proof:

```bash
deno task submodules:check:remote
```

Promotion can run after `main` has advanced, but it must resolve the Candidate tag and use that tag's peeled commit in a
clean detached release worktree. It must never promote current `HEAD` by accident.

## Commands

Use these repository-owned commands instead of hand-writing tag or build commands:

```bash
deno task release:candidate --tag vX.Y.Z-rc.N [--dry-run]
deno task release:promote --candidate vX.Y.Z-rc.N [--dry-run]
deno task release:stable --tag vX.Y.Z [--dry-run]
deno task release:metadata --tag vX.Y.Z[-rc.N]
deno task release:check --build-version vX.Y.Z[-rc.N]
```

Dry runs perform read-only preflight and print the proposed tag target and tag push. They must not create local tags,
push remote tags, create host releases, or leave repository files behind.

## Candidate creation

1. Choose the next Candidate tag.
2. Generate cumulative release notes from the previous Stable tag to the current source commit. Later Candidates should
   keep the cumulative upgrade notes and add validation-relevant changes since the previous Candidate when useful.
3. Run `deno task release:candidate --tag <candidate-tag> --dry-run` and inspect the source commit and proposed tag.
4. Confirm the irreversible operation.
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
5. Confirm the irreversible operation.
6. Run `deno task release:promote --candidate <candidate-tag>`.
7. Wait for the Stable tag-triggered GitHub workflow to publish Stable assets.
8. Edit the published Stable release with the curated temporary notes and verify they landed.

Promotion creates a Stable tag at the Candidate tag's peeled commit. The Stable tag annotation may include
`Promoted-From: <candidate-tag>` and must not persist a separate source commit field.

## Direct Stable creation

Direct Stable is an exceptional path. Use it only when explicitly chosen and appropriate for the risk of the change. It
follows the same local preflight, qualification, tag workflow, and post-publication notes-editing rules as Candidate
creation, but the target tag is a Stable tag.

## GitHub workflow ownership

The tag-triggered workflow owns GitHub release creation and asset upload. Local release commands create and push tags;
they must not call `gh release create`, `gh release edit`, `glab release create`, or `glab release edit`.

After CI publishes a release, Operator edits the release notes from the curated temporary notes file. A release is not
complete until this notes edit is verified. If assets are published but notes editing fails, report the release as
recoverably incomplete and retry with:

```bash
gh release edit <tag> --notes-file <notes-file>
```

## Recovery

- **Local tag created but not pushed**: delete the local tag after confirming no remote tag exists, repair the issue,
  and rerun the command.
- **Remote tag pushed and workflow failed**: do not move or reuse the tag. Fix the workflow/source issue according to
  the failure and rerun the workflow for the same immutable tag when safe.
- **Candidate published but should not be promoted**: leave it as a prerelease and publish a later Candidate tag.
- **Assets published but notes pending**: do not recreate the release. Retry the notes edit and verify the published
  notes.

## Verification expectations

- Candidate binaries report the Candidate identity, for example `runwield v0.8.12-rc.1 (...)`.
- Promoted Stable binaries report the Stable identity, for example `runwield v0.8.12 (...)`.
- Candidate and promoted Stable tags peel to the same source commit.
- Candidate publication leaves GitHub latest on the prior Stable.
- Successful or recoverably incomplete local release commands leave the repository clean.
