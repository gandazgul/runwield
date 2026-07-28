---
kind: "work_record"
recordId: "58f46331-e694-49c9-b00d-fbc19bd1d6b8"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-27T22:09:39.780Z"
provenance:
    sourcePlans:
        - "64f0a075-fa48-4ea8-a5f9-88062541a25f"
---

# Stable update notice and CLI update command

## Summary

Added a shared Stable release update-check module, non-blocking TUI boot update notice, and CLI-only `wld update`
command with `wld upgrade` alias that installs through the tag-pinned public installer while preserving
install-directory behavior. Registry, command, shared update-check, and TUI behavior are covered by tests, and
verification passed with format, lint, targeted tests, and full `deno task ci`.

## Deviations from Plan

Live interactive TUI and installer checks were not run against a real installer; automated source-order, registry, and
fake-installer tests covered those behaviors instead.

## Future Planning Notes

Keep update availability as cached release metadata recomputed against the current binary version, not as durable
availability truth, and continue keeping installer execution CLI-only rather than exposing it as a slash command.

## Execution Report

- Implemented shared Stable update-check module with version comparison, global cache helpers, GitHub latest-release
  fetch, tag-pinned installer URL, and install-dir detection.
- Added CLI-only `wld update` command plus `wld upgrade` alias; command fetches latest Stable tag, skips already-current
  installs, downloads matching `install.sh`, derives/preserves `WLD_INSTALL_DIR`, runs installer, and propagates
  failures.
- Integrated TUI boot update notice placeholder directly under the title line with cached immediate rendering and
  non-awaited background refresh; update/upgrade remain absent from slash commands by registry coverage.
- Added unit/behavior coverage for shared update checks, update command, registry CLI-only alias behavior, and TUI
  source-order/rendering.
- Verification passed: requested `deno fmt --check`, `deno lint`, targeted `deno test -A ...`, and full `deno task ci`
  (1897 passed, 0 failed).
- Manual CLI help check passed: `deno task cli help update` shows `wld update`, `wld upgrade`, Stable channel, and
  `WLD_INSTALL_DIR`; interactive TUI/manual installer checks were covered by automated
  source-order/registry/fake-installer tests rather than executed against a live installer.
