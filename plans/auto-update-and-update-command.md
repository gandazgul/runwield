---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add a non-blocking Stable release update notice in the TUI boot header and a CLI-only wld update/upgrade command that installs through the public checksum-verified installer."
affectedPaths:
    - "src/shared/update-check.js"
    - "src/shared/update-check.test.js"
    - "src/cmd/update/index.js"
    - "src/cmd/update/index.test.js"
    - "src/cmd/registry.js"
    - "src/cmd/__tests__/registry.test.js"
    - "src/ui/tui/chat-session.js"
    - "src/ui/tui/chat-session.test.js"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-27T16:15:40-04:00"
updatedAt: "2026-07-27T20:27:22.506Z"
status: "implemented"
origin: "internal"
implementedAt: "2026-07-27T20:27:22.506Z"
userVerifiedAt: null
executionReport: "- Implemented shared Stable update-check module with version comparison, global cache helpers, GitHub latest-release fetch, tag-pinned installer URL, and install-dir detection.\n- Added CLI-only `wld update` command plus `wld upgrade` alias; command fetches latest Stable tag, skips already-current installs, downloads matching `install.sh`, derives/preserves `WLD_INSTALL_DIR`, runs installer, and propagates failures.\n- Integrated TUI boot update notice placeholder directly under the title line with cached immediate rendering and non-awaited background refresh; update/upgrade remain absent from slash commands by registry coverage.\n- Added unit/behavior coverage for shared update checks, update command, registry CLI-only alias behavior, and TUI source-order/rendering.\n- Verification passed: requested `deno fmt --check`, `deno lint`, targeted `deno test -A ...`, and full `deno task ci` (1897 passed, 0 failed).\n- Manual CLI help check passed: `deno task cli help update` shows `wld update`, `wld upgrade`, Stable channel, and `WLD_INSTALL_DIR`; interactive TUI/manual installer checks were covered by automated source-order/registry/fake-installer tests rather than executed against a live installer."
executionMode: "worktree"
executionBaselineTree: "f5d9195302284a7c395d387680d6dee43cdb60a0"
worktreeId: "ffea5ccd"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-runwield-auto-update-and-update-command-ffea5ccd"
worktreeBranch: "runwield/worktree/auto-update-and-update-command-ffea5ccd"
worktreeBaseBranch: "main"
worktreeStatus: "completed"
---

# Auto Update Notice and Update Command

## Context

RunWield currently shows the TUI boot title as `RunWield ─ Plan-by-Default Harness <VERSION>` from
`src/ui/tui/chat-session.js`, but it does not tell users when a newer Stable release exists. RunWield also has an
install path (`install.sh`) that downloads GitHub release assets, verifies `SHA256SUMS`, installs `wld`, installs
missing required runtime helpers, and preserves existing helper binaries. There is no `wld update` command today.

The requested outcome is a lightweight update experience:

- TUI startup must remain interactive immediately; update checking must not block boot, model onboarding, or the editor.
- When a newer Stable release is known, the boot title area shows `New version available: <version>. Run \`wld update\`
  to install it`, with the version rendered in the existing teal-like theme color.
- `wld update` installs the latest Stable RunWield release.
- `wld upgrade` is a CLI alias for the same command.
- Update/upgrade are CLI-only commands; they must not appear or run as TUI slash commands.

User decision: `wld update` should reuse the public installer and set `WLD_INSTALL_DIR` to the current `wld` binary
directory when possible.

## Objective

Build a shared update-check module, integrate it into the TUI boot header without awaiting network work, and add a
CLI-only update command that installs the latest Stable release through the same installer path users already trust.

## Approach

Create `src/shared/update-check.js` as the single home for RunWield Stable release discovery, version comparison, cache
reads/writes, and installer URL construction. It should use the GitHub Stable latest API
(`https://api.github.com/repos/gandazgul/runwield/releases/latest`) so Candidate prereleases do not displace the Stable
channel, matching `RELEASING.md`.

Cache only small update-check metadata under the global RunWield directory, e.g. `~/.wld/update-check.json`, not in
project state and not in the main settings schema. Use a reviewable constant for the cache time-to-live, recommended
`6 hours`, so repeated TUI boots do not hit the network. Cache the latest release tag and `checkedAt`; compute
availability against the current `VERSION` at read time so a successful update does not leave a stale “available” flag
for the new binary.

In the TUI, add an empty `Text` placeholder immediately under the existing title line. Empty `Text` renders zero lines
in Pi TUI, so it will not change layout unless a notice exists. Synchronously read the local cache only; then start the
refresh with `void ...` and catch all errors. If the background refresh discovers a newer version during the current TUI
session, update the placeholder and request a render. Do not append a normal system message for expected update
availability.

For `wld update`, fetch the target tag first, avoid reinstalling when the current version is already current or newer,
then download the `install.sh` from that same tag
(`https://raw.githubusercontent.com/gandazgul/runwield/<tag>/install.sh`) into a temp directory and run
`bash <temp>/install.sh <tag>`. If `Deno.execPath()` appears to be the installed `wld` binary, pass
`WLD_INSTALL_DIR=<dirname of execPath>` unless the user already set `WLD_INSTALL_DIR`. If RunWield is source-run through
`deno`, leave install location to the installer default and print a concise note.

## Files to Modify

- `src/shared/update-check.js` — new shared module for GitHub Stable latest fetch, cache path, cache read/write, version
  comparison, notice availability, installer URL construction, and current install directory detection helpers.
- `src/shared/update-check.test.js` — unit coverage for version comparison, cache TTL behavior, malformed cache/API
  handling, non-release build comparison, and installer URL construction.
- `src/cmd/update/index.js` — new CLI command implementation for `wld update`, using shared update-check utilities and
  dependency injection for tests.
- `src/cmd/update/index.test.js` — command tests for already-current behavior, installer invocation with tag-pinned
  `install.sh`, derived `WLD_INSTALL_DIR`, source-run fallback messaging, and failure exit behavior.
- `src/cmd/registry.js` — import/register the update command with `aliases: ["upgrade"]`, CLI surface only, usage/help
  text, and `COMMAND_NAMES.UPDATE`.
- `src/cmd/__tests__/registry.test.js` — assert `update` is CLI-only, `upgrade` resolves to update, and neither appears
  in slash definitions.
- `src/ui/tui/chat-session.js` — add boot-header update notice placeholder, notice renderer helper, cached notice read,
  and non-awaited background refresh after theme/TUI initialization.
- `src/ui/tui/chat-session.test.js` — add source-order/behavior tests proving the update check is non-awaited and the
  notice placeholder sits directly under the title line; add a focused render helper test for teal version coloring.

## Reuse Opportunities

- `install.sh` — reuse the existing checksum-verified release installation path instead of reimplementing
  archive/platform/helper installation in JavaScript.
- `src/shared/version.js` — use current generated `VERSION` for comparison and TUI title display.
- `src/shared/settings.js#getSettingsDir("global")` — reuse the canonical global `.wld` directory location for the
  update cache file.
- `src/cmd/registry.js` alias pattern — use the existing `aliases` field so `upgrade` resolves like other command
  aliases while staying CLI-only.
- `src/cmd/help/index.js` — global and command help are generated from the registry, so the update command only needs
  complete registry metadata.
- `src/ui/theme/catppuccin-mocha.json` / `theme.fg(...)` — use the existing teal-adjacent routing token
  (`routingQuickFix`) or another existing teal token if supported by the theme implementation; do not introduce a new
  theme color.

## Implementation Steps

- [ ] Step 1: Add `src/shared/update-check.js` with JSDoc typedefs for cache shape and release metadata. Export
      constants for the RunWield repo, latest-release API URL, cache filename, cache TTL, and tag-pinned installer URL
      template.
- [ ] Step 2: Implement `normalizeRunWieldVersion`, `parseRunWieldReleaseVersion`, and
      `isNewerRunWieldVersion(latestVersion, currentVersion)`:
  - Stable tags match `vMAJOR.MINOR.PATCH`.
  - Candidate tags match `vMAJOR.MINOR.PATCH-rc.N` for safe comparison, even though GitHub latest should not return
    them.
  - Stable beats a Candidate with the same base version.
  - A current version greater than or equal to latest must not show an update.
  - A non-release current version such as a git short hash is considered updateable when it differs from the latest tag,
    matching the user’s boot-title example.
- [ ] Step 3: Implement cache helpers:
  - `getUpdateCheckCachePath()` under `getSettingsDir("global")`.
  - `readUpdateCheckCache({ now, ttlMs, cachePath })` returning `null` for missing, stale, malformed, or invalid data.
  - `writeUpdateCheckCache({ latestVersion, checkedAt, cachePath })` creating the parent directory and writing
    normalized JSON.
  - `getCachedUpdateAvailability({ currentVersion, now, ttlMs, cachePath })` that recomputes availability from cached
    latest tag.
- [ ] Step 4: Implement network helpers:
  - `fetchLatestRunWieldRelease({ fetch })` using the GitHub Stable latest API and accepting only a string `tag_name`.
  - `refreshUpdateCheckCache(...)` that fetches latest, writes cache on success, returns availability for the current
    version, and never throws from cache-write failures unless explicitly tested through lower-level helpers.
  - Do not authenticate to GitHub or require `gh`.
- [ ] Step 5: Add `src/cmd/update/index.js`:
  - Export `runUpdateCommand(argv, options = {})`.
  - Reject unexpected positional args with usage and exit code 1.
  - Fetch the latest Stable tag.
  - If current version is already current/newer, print `RunWield is already up to date (<version>).` and exit 0.
  - Download `install.sh` from the target tag, write it to a temp directory, run `bash <script> <tag>` with inherited
    stdio, and propagate non-zero installer exit codes.
  - Set `WLD_INSTALL_DIR` to `dirname(Deno.execPath())` when `Deno.execPath()` basename is `wld` and the user did not
    already set `WLD_INSTALL_DIR`.
  - If source-run/development mode is detected, print that the installer default will be used unless `WLD_INSTALL_DIR`
    is set.
  - Clean up temp files in `finally`.
- [ ] Step 6: Register the command in `src/cmd/registry.js`:
  - Add `UPDATE: "update"` to `COMMAND_NAMES` and the JSDoc shape.
  - Import `runUpdateCommand`.
  - Add a command definition with `aliases: ["upgrade"]`, `surfaces: ["cli"]`, usage for `wld update` and `wld upgrade`,
    and notes explaining Stable-channel install and `WLD_INSTALL_DIR`.
- [ ] Step 7: Integrate the TUI boot notice in `src/ui/tui/chat-session.js`:
  - Add an exported pure helper such as `renderUpdateNoticeLine(latestVersion, themeImpl = theme)`.
  - Add `const updateNoticeText = new Text("", 0, 0)` immediately after the title line and before compact help.
  - On fresh boot only (`!suppressStartupHeader`), synchronously render any fresh cached availability into the
    placeholder.
  - Start a background refresh with `void refreshUpdateCheckCache(...).then(...).catch(() => {})`; do not `await` it.
  - When the refresh returns available, set the placeholder text and call `tui.requestRender()`.
  - If no update is available or the check fails, leave the placeholder empty.
- [ ] Step 8: Add/adjust tests:
  - Unit tests for shared update-check comparison and cache behavior.
  - Command tests using injected fetch, temp file, command runner, env, and exec path dependencies.
  - Registry tests for CLI-only update/upgrade.
  - TUI source-order tests that fail if the background update check is awaited before the editor/model welcome path.
- [ ] Step 9: Run format/lint/check/test verification and fix style issues without introducing TypeScript syntax in new
      `.js` files.

## Verification Plan

- Automated:
  `deno fmt --check src/shared/update-check.js src/shared/update-check.test.js src/cmd/update/index.js src/cmd/update/index.test.js src/cmd/registry.js src/cmd/__tests__/registry.test.js src/ui/tui/chat-session.js src/ui/tui/chat-session.test.js`
- Automated:
  `deno lint src/shared/update-check.js src/shared/update-check.test.js src/cmd/update/index.js src/cmd/update/index.test.js src/cmd/registry.js src/cmd/__tests__/registry.test.js src/ui/tui/chat-session.js src/ui/tui/chat-session.test.js`
- Automated:
  `deno test -A src/shared/update-check.test.js src/cmd/update/index.test.js src/cmd/__tests__/registry.test.js src/ui/tui/chat-session.test.js`
- Automated: `deno task ci`
- Manual: with a temporary `~/.wld/update-check.json` containing a fresh newer `latestVersion`, start `wld` and confirm
  the notice appears directly below `RunWield ─ Plan-by-Default Harness <VERSION>`.
- Manual: with no cache or stale cache, start `wld` and confirm input becomes usable immediately; the update check must
  not visibly block TUI startup.
- Manual: run `wld help update` and confirm usage mentions `wld update`, `wld upgrade`, Stable channel, and
  `WLD_INSTALL_DIR`.
- Manual: run `/update` in the TUI and confirm it is not available as a slash command; it should be treated like an
  unknown slash command, not execute the installer.
- Manual: in a safe test environment with injected/fake installer command or disposable install dir, run
  `WLD_INSTALL_DIR=<tmp-bin> wld update` and confirm the installer path receives the latest Stable tag and installs to
  that directory.
- Expected results:
  - Fresh cache with newer version shows the boot notice immediately.
  - Missing/stale cache never delays interaction.
  - Background refresh updates the notice if it completes while the TUI is open.
  - Network or GitHub failures are silent in TUI startup.
  - `wld upgrade` invokes the same command as `wld update`.
  - Already-current Stable versions do not reinstall and exit successfully.

## Edge Cases & Considerations

- GitHub API failures, malformed JSON, missing `tag_name`, cache write errors, and no network must not break TUI boot.
- Candidate releases should not be offered by default because the release policy keeps Candidates out of GitHub latest.
- A non-release build identity such as a git hash should be considered updateable when Stable latest differs, matching
  the requested boot notice example.
- Do not store an `available: true` flag as durable truth; recompute from cached latest tag and current `VERSION` so the
  cache remains safe across an update.
- Source-run `deno run src/cli.js update` cannot reliably replace the running source checkout. It should use the
  installer default unless `WLD_INSTALL_DIR` is supplied and should explain that briefly.
- The installer script should be fetched from the target release tag, not from `main`, to avoid update behavior drifting
  ahead of the release being installed.
- Replacing the current `wld` executable while it is running is acceptable on supported Unix-like platforms, but the new
  version only affects subsequent `wld` invocations.
- No `CONTEXT.md` update is required; this adds ordinary release/update behavior and does not introduce a new RunWield
  domain term that future agents must distinguish.
