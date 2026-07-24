---
planId: "589dd642-b83f-4f61-ae00-9ac2f570653f"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Install RunWield and its runtime helper binaries through one rootless installer, and make the new-user UX container exercise that installer instead of locally baking binaries."
affectedPaths:
    - "install.sh"
    - "Containerfile.wld-ux"
    - "deno.json"
    - "scripts/install.test.js"
    - "src/shared/runtime-preflight.js"
    - "src/shared/runtime-preflight.test.js"
    - "src/extensions/mnemosyne/index.js"
    - "src/extensions/mnemosyne/index.test.js"
    - "src/shared/session/session.js"
    - "README.md"
    - "docs/quickstart.md"
    - "docs/index.md"
    - "docs/user-facing-features.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-23T14:38:52-04:00"
status: "verified"
origin: "internal"
verifiedAt: "2026-07-23T21:00:24.582Z"
workRecord:
    status: "generated"
    recordId: "8a1e4845-293a-4438-a80c-dc0c04bd11a5"
    path: "docs/work-records/2026-07-23-unified-runtime-helper-installation.md"
    lastAttemptAt: "2026-07-23T21:07:50.427Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
updatedAt: "2026-07-24T15:23:40.602Z"
archivedAt: "2026-07-24T15:23:40.602Z"
archivedFromStatus: "verified"
archivedFromPath: "plans/install-runwield-runtime-helpers.md"
---

# Install RunWield Runtime Helpers

## Context

The release installer currently installs only `wld`, even though interactive RunWield Sessions require Mnemosyne and
Cymbal in `PATH`; Snip is optional but provides the intended command-output compression experience. New users must
therefore discover and install three separate tools after the advertised one-line installation.

The `ux:new-user` container does not exercise that onboarding path. It compiles `wld` from the checkout, builds
Mnemosyne in a Go stage, and manually downloads Cymbal and Snip. This can hide installer defects and differs from what a
new user receives from published releases.

Cymbal and Snip publish macOS/Linux release archives with checksums. Mnemosyne's current release publishes only
checksum-backed macOS archives. Its adjacent upstream workflow now builds and uploads Linux amd64 and arm64 archives
separately, but those uploads are not included in GoReleaser's `checksums.txt`; publishing a release where both Linux
archives participate in the checksum manifest is an external prerequisite for the rootless Linux flow selected for this
feature.

## Objective

Make the existing one-line macOS/Linux installer produce a usable RunWield installation by installing missing Mnemosyne,
Cymbal, and Snip binaries beside `wld` in `WLD_INSTALL_DIR`, while respecting helper binaries users already manage
elsewhere. Make `ux:new-user` build an unprivileged image through that same checked-in installer and then launch the
installed release as a genuine first RunWield Session.

## Approach

Extend `install.sh` around its existing platform detection, release resolution, checksum verification, extraction,
installation, PATH guidance, and Snip-filter prompt:

- Detect an existing helper first in `PATH` and then at the resolved `WLD_INSTALL_DIR`; report and preserve it instead
  of replacing a Homebrew, Go, or prior RunWield-managed installation. This installer fills missing dependencies; it
  does not silently upgrade helper binaries on rerun.
- For each missing helper, resolve its latest upstream GitHub release, map the detected OS/architecture to that
  project's archive naming convention, download its `checksums.txt` and archive, verify the exact archive checksum,
  extract the expected executable, and install it into the same user-writable directory as `wld`.
- Treat Mnemosyne and Cymbal as required: a missing asset, bad checksum, malformed archive, or failed install aborts
  with helper-specific guidance. Attempt Snip by default, but warn and continue if only Snip fails because RunWield's
  Snip integration remains optional and fail-open.
- Do not run `mnemosyne setup`; its roughly 500 MB ONNX/model download remains lazy on the first semantic memory
  operation.
- Keep the existing interactive Snip-filter opt-in, but make it recognize a newly installed Snip by absolute install
  path even before the user's shell has reloaded its PATH.

Simplify `Containerfile.wld-ux` to retain only the clean runtime environment and packages needed by a new user. Copy the
checked-in installer, switch to the unprivileged `deno` user, install into `/home/deno/.local/bin`, expose that
directory through `PATH`, and smoke-check all four commands. Remove the local Deno compilation stage, the Mnemosyne Go
builder, and bespoke helper downloads. Ensure `deno task ux:new-user` re-executes the installer rather than indefinitely
reusing a stale installation layer; document that this surface tests the current installer against the latest published
RunWield release, not uncompiled source changes in the checkout.

## Files to Modify

- `install.sh` — add reusable latest-release/helper archive installation logic, project-specific platform mappings,
  existing-helper preservation, required-versus-optional failure handling, and newly installed Snip filter detection.
- `Containerfile.wld-ux` — replace compiled/copied binaries and manual helper setup with an unprivileged execution of
  the checked-in installer and post-install command smoke checks.
- `deno.json` — adjust `ux:new-user` build arguments/cache behavior so invoking the task exercises installation of the
  latest published releases instead of silently retaining a stale installer layer.
- `scripts/install.test.js` — add isolated installer behavior coverage using temporary homes/install directories and
  deterministic command/download fixtures rather than modifying the developer's real installation.
- `src/shared/runtime-preflight.js` and `src/shared/runtime-preflight.test.js` — direct missing required-helper recovery
  back to the unified RunWield installer and assert that guidance.
- `src/extensions/mnemosyne/index.js`, `src/extensions/mnemosyne/index.test.js`, and `src/shared/session/session.js` —
  replace remaining Mnemosyne-only installation guidance with the same unified recovery path and cover the tool-facing
  missing-binary message.
- `README.md` — describe the unified install, preserved existing helpers, required/optional failure behavior, lazy
  Mnemosyne model setup, and unified troubleshooting/recovery guidance.
- `docs/quickstart.md` — make the one-line installer the complete standalone setup path and retain separate guidance for
  source contributors.
- `docs/index.md` — remove the separate new-user helper-install step and explain which helpers are required versus
  optional at runtime.
- `docs/user-facing-features.md` — record automatic missing-helper installation and the shared custom install directory.

## Reuse Opportunities

- `install.sh` `resolve_install_dir` and `expand_path` — keep one user-writable destination and existing
  `WLD_INSTALL_DIR` behavior for all installed binaries.
- `install.sh` `resolve_asset_suffix` — refactor its single wld suffix into a shared OS/architecture tuple from which
  wld (`x64`), Mnemosyne/Snip (`amd64`), and Cymbal (`x86_64`) asset names can be derived without duplicate `uname`
  logic.
- `install.sh` `resolve_version` and `sha_verify` — generalize the established GitHub latest-release and exact checksum
  validation pattern rather than invoking opaque upstream installers.
- `install.sh` `prompt_add_path_to_profile` and `prompt_install_snip_filters` — preserve the current shell-aware PATH UX
  and RunWield-managed filter ownership.
- `Containerfile.wld-ux` runtime package list, clean `/home/deno` ownership, Project working directory, volumes, and
  `ENTRYPOINT` — preserve the useful first-Session environment while removing build-only binary provisioning.

## Implementation Steps

- [ ] Confirm the external prerequisite before implementation: Mnemosyne's latest release must publish
      `mnemosyne_<version>_linux_amd64.tar.gz` and `mnemosyne_<version>_linux_arm64.tar.gz` (or an upstream-documented
      equivalent) and include both in `checksums.txt`. The adjacent upstream workflow already has native Linux build
      jobs, but its separately uploaded archives must be incorporated into the release checksum contract. Do not add a
      Go/CGO or privileged package-manager fallback if verified assets are absent; report the blocker.
- [ ] Refactor `install.sh` platform handling into canonical `darwin|linux` and `amd64|arm64` values, retaining the
      current clear errors for unsupported operating systems and architectures and deriving each upstream project's
      exact archive name from those values.
- [ ] Add narrowly scoped helpers to resolve latest upstream tags, download archives/checksum manifests, require an
      exact checksum entry, extract into per-tool temporary directories, validate the expected executable, and install
      it with executable permissions. Keep wld's existing zstd-preferred/gzip-fallback release behavior intact.
- [ ] Add idempotent helper orchestration for Mnemosyne, Cymbal, and Snip: preserve commands already found in PATH or
      executable files already present in `WLD_INSTALL_DIR`; install only missing commands; abort on required-helper
      failures; and isolate Snip installation so its failure produces a warning without masking a successful required
      installation.
- [ ] Update final installer UX so one PATH recommendation covers all managed binaries, success output identifies
      installed versus preserved helpers, the Snip-filter prompt can use newly installed binaries before shell reload,
      non-interactive execution never hangs, and rerunning after a partial required-helper failure safely continues from
      binaries already installed.
- [ ] Add `scripts/install.test.js` with real temporary archives/checksum files and mocked platform/network boundaries.
      Cover Darwin/Linux and amd64/arm64 asset mapping, a `WLD_INSTALL_DIR` containing spaces, preservation of the
      positional wld version argument, existing PATH and install-directory helper preservation, successful four-command
      installation, corrupt/missing checksum rejection, missing executable rejection, required-helper failure,
      non-blocking Snip failure, non-interactive behavior, one consolidated PATH recommendation, newly installed Snip
      recognition for filter setup, and idempotent reruns.
- [ ] Rework `Containerfile.wld-ux` to run the checked-in installer as `deno` into `~/.local/bin`, set PATH before and
      after the install step, and verify `wld`, `mnemosyne`, `cymbal`, and `snip` resolve and report versions. Remove
      all local source compilation and bespoke helper build/download stages while retaining runtime OS packages needed
      by Git-backed RunWield Sessions.
- [ ] Update `deno task ux:new-user` and the Containerfile with a changing build argument placed immediately before the
      installer `RUN`, so each intentional new-user exercise refreshes release installation while preserving cached
      base-image and OS-package layers.
- [ ] Replace runtime preflight, Mnemosyne tool, Session extension-warning, and README troubleshooting links that send
      users to separate helper installers with one instruction to rerun the RunWield installer; keep helper-specific
      diagnostics while making the recovery action consistent.
- [ ] Update installation and quickstart documentation to present the one-line command as the complete standalone binary
      install, explain existing-helper preservation and custom-directory behavior, retain Snip's optional status, and
      disclose that Mnemosyne models download lazily on first semantic use.
- [ ] Run focused installer tests, syntax/format validation, full repository CI, a clean Linux image build, and
      host/container smoke flows before completion.

## Verification Plan

- Automated: run `bash -n install.sh`.
- Automated: run `deno test -A scripts/install.test.js` and confirm fixtures never contact GitHub or write outside their
  temporary HOME/install roots.
- Automated: run `deno task ci` and fix all failures.
- Manual Linux/container: build without reusing the installer layer, inspect the build log to confirm the checked-in
  installer performed provisioning as the non-root user, then run
  `podman run --rm --entrypoint sh runwield-wld-ux:local -lc 'command -v wld mnemosyne cymbal snip && wld --version && mnemosyne version && cymbal version && snip --version'`.
- Manual first Session: run `deno task ux:new-user` with a disposable HOME/Project, verify it enters the latest
  published `wld` without missing-Mnemosyne/Cymbal errors, and verify no Mnemosyne model payload was downloaded during
  image installation alone.
- Manual macOS: with a temporary install directory and a PATH that does not expose existing user-managed helpers, run
  the installer, verify all four binaries are executable from that directory, and verify the downloaded archive names
  match the host architecture.
- Manual preservation: run with an existing helper earlier on PATH and confirm its path/version remains unchanged while
  missing helpers are installed beside `wld`.
- Expected: checksum corruption or an unavailable Mnemosyne/Cymbal asset exits nonzero with the failing helper named; an
  unavailable Snip asset prints a warning, leaves required commands usable, and exits successfully.

## Edge Cases & Considerations

- **External prerequisite:** the current Mnemosyne release has no Linux archives. Upstream main now builds native Linux
  amd64 and arm64 archives, but its separate upload jobs do not add them to GoReleaser's `checksums.txt`. This Plan is
  intentionally blocked on publishing a release with checksum-covered Linux assets; it must not solve that gap by
  requesting sudo, installing a Go 1.26 toolchain, or compiling CGO on a new user's machine.
- GitHub release APIs are rate-limited and upstream asset names differ. Keep repository/version resolution and archive
  naming explicit per helper, and produce actionable errors rather than parsing an empty URL into a generic curl error.
- Exact checksum verification is mandatory for every downloaded archive. A checksum manifest that lacks the selected
  asset is a failure, not permission to continue unverified; only the entire Snip attempt may degrade to a warning.
- Preserving helpers is presence-based, not an update or compatibility manager. Externally managed helpers should be
  upgraded through their original installation method. A user who wants the one-line installer to refresh a
  RunWield-managed helper removes that helper executable from `WLD_INSTALL_DIR` and reruns the installer; document this
  explicit behavior rather than implying automatic helper upgrades.
- Installation may be partially complete when a required upstream download fails. Per-tool temporary extraction plus
  idempotent existing-binary detection makes a rerun safe without rolling back working binaries.
- A custom `WLD_INSTALL_DIR` may contain spaces or lie outside HOME. Preserve current quoting/path-profile behavior and
  avoid assuming `~/.local/bin` except in defaults and the dedicated container.
- The UX image intentionally installs the latest published RunWield release. It validates real onboarding and released
  first-Session behavior, but it no longer previews uncompiled `wld` source changes from the current checkout.
- Snip remains optional at runtime even though fresh installs attempt it by default. Its filter prompt should remain
  interactive-only and must not block container builds or other non-TTY installs.
- Mnemosyne's models and ONNX runtime retain their upstream OS-specific data locations and lazy setup behavior; only the
  CLI executable belongs in `WLD_INSTALL_DIR`.
