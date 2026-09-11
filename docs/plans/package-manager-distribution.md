---
planId: "363954ee-cdaa-4014-b749-b1fcc9bd90d7"
classification: "PROJECT"
type: "sequence"
complexity: "HIGH"
affectedPaths:
    - "packaging/"
    - "scripts/"
    - ".github/workflows/release.yml"
    - "src/cmd/update/"
    - "src/shared/runtime-preflight.ts"
    - "docs/releasing.md"
createdAt: "2026-09-11"
status: "ready_for_work"
origin: "internal"
userVerifiedAt: null
userVerificationNote: null
---

# Prepare Homebrew and WinGet Distribution

## Context

The owner wants RunWield ready for package-manager distribution: Homebrew first in `gandazgul/homebrew-tap`, then native
Windows through WinGet. The owner also controls `gandazgul/mnemoteca` and requested a Mnemoteca formula in the same tap.

Current releases contain compiled binaries, but the shell installer supplies required helpers separately. Windows is
cross-compiled on Ubuntu, without native release qualification. `wld update` currently runs the shell installer even for
a package-managed installation.

## Objective

Prepare complete, tested packages and release tooling. Homebrew uses dependencies; Windows bundles the required helpers
and includes native runtime fixes and tests. Public repository creation, release publication, and WinGet submission
remain explicit owner operations, not effects of executing these Plans.

The tap will provide `wld` and `mnemoteca`. Reuse existing `1broseidon/tap/cymbal`, `1broseidon/tap/ketch`, and
Homebrew's `agent-browser` package. Windows targets x64, the architecture already built by this repository. Homebrew
initially targets Apple Silicon and Intel macOS, as discussed; Linux Homebrew qualification and Windows arm64 are
outside this sequence. The existing Linux shell installation remains supported.

A disposable WinGet first-publication guide must let the owner finish publication without reconstructing the packaging
work. Lasting update instructions belong in `docs/releasing.md`.

## Ordered Children

1. [Homebrew tap and safe package updates](package-manager-distribution/01-homebrew-tap.md): tested tap source for both
   formulas, dependency setup, Stable release preparation, and package-owned update protection. Final ready-to-push
   output is generated and checked after the owner publishes the matching Stable release.
2. [Native Windows package and WinGet release handoff](package-manager-distribution/02-windows-winget-readiness.md):
   complete Windows ZIP, real native verification, WinGet manifest generation, and disposable publication guide. Reuses
   the first child's package identity and release checks.

Each child owns its tests and completion evidence. The container adds no separate execution or release gate. Preparation
is not proof of public catalog availability. A missing native test host or failed helper operation must remain an
explicit release blocker, not a claim of readiness.
