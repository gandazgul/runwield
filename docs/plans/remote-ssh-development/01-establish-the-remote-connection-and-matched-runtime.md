---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/cli.ts"
    - "src/cmd/registry.js"
    - "src/cmd/remote/"
    - "src/shared/foreground-process.ts"
    - "scripts/compile.js"
    - "docs/domain-language.md"
    - "docs/adr/018-remote-ssh-local-personal-authority.md"
    - "docs/prd/runwield-core-prd.md"
    - "docs/prd/remote-ssh-prd.md"
executionAgent: "engineer"
createdAt: "2026-09-21T02:05:47.752Z"
status: "draft"
origin: "internal"
parentPlan: "remote-ssh-development"
order: 1
dependencies:
    []
targetBranch: "epic/remote-ssh-development"
planId: "c6cd4307-3a82-4f5d-9ddb-fd3f9d57bd19"
---

# Establish the Remote Connection and Matched Runtime

## Context

RunWield needs a safe entry point for projects that exist only on a remote Linux host. The laptop must use normal
OpenSSH configuration and host verification, prepare an exact matching remote runtime, and retain control of every
process and channel it starts. This slice establishes that connection boundary without allowing a user turn or writable
remote Session; later children add personal capabilities and Session persistence.

The change starts delivery of the Remote SSH PRD's **Remote connection and setup** capability and the Core PRD's
installation, project-context, and recovery requirements. Ordinary local TUI, ACP, and Workspace startup must remain
unchanged.

## Objective

Make `wld remote host[:path]` resolve and prepare the intended remote location, start a connection-scoped remote
Core/TUI in a dormant state, and clean up owned resources safely. Establish the remote runtime and authenticated control
contract that later children extend.

## Approach

Use OpenSSH as the connection authority. Treat host and path as structured arguments, resolve path and project identity
on the remote host, and install a versioned user-writable runtime that matches the laptop build and bridge protocol. Run
health monitoring and owned-process termination outside the TUI or Agent execution path.

```text
wld remote target
  OpenSSH resolve and verify
  remote path and platform preflight
  exact runtime prepare
  authenticated control channel
  dormant remote TUI
```

Do not run the ordinary installer remotely; it can change profiles and install personal state.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/cli.ts`, `src/cmd/registry.js`, and a focused remote-command module — parse and dispatch the two remote command
  forms without shell interpolation.
- `src/shared/foreground-process.ts` and new connection-runtime modules — own SSH processes, authenticated channels,
  health checks, and bounded cleanup.
- `scripts/compile.js` and runtime resource handling — produce or locate a matching development runtime without using an
  arbitrary remote `wld`.
- `docs/domain-language.md` — define **Remote SSH connection** and update the stable Core, Session, and Project Runtime
  State relationships made true by this slice.
- `docs/adr/018-remote-ssh-local-personal-authority.md` and the owning PRDs — record the implemented connection boundary
  while later capabilities remain target behavior.

## Reuse Opportunities

- `src/shared/foreground-process.ts` — reuse explicit process-tree ownership and termination rather than process-name
  cleanup.
- `src/cli.ts` and `src/cmd/registry.js` — reuse normal command dispatch and help behavior.
- OpenSSH — reuse user configuration, keys, jump hosts, host verification, terminal allocation, and forwarding.
- Existing compile/version metadata — reuse RunWield build identity instead of inventing a second version source.

## Implementation Steps

- Both documented command forms pass host and optional path as data to OpenSSH-backed resolution; `~`, symlinks,
  permissions, Git relationships, and missing directories are decided on the remote host.
- Runtime preparation selects the remote Linux architecture, requires an exact release/build and bridge-protocol match,
  installs atomically in versioned user-writable storage, and repairs an interrupted preparation without changing shell
  profiles or package-managed installations.
- The launcher and remote runtime exchange an unpredictable connection credential over loopback or private SSH channels;
  credentials do not appear in normal logs, process arguments, or remote personal storage.
- A supervisor independent of the TUI tracks only connection-owned processes and channels, detects loss with the agreed
  timing defaults, and terminates owned work without broad process-name kills or unsafe lock assumptions.
- The remote TUI can open in a dormant state for the canonical remote directory, shows the broad standard-SFTP trust
  notice, and rejects user turns until the required personal and Session capabilities are available.
- Failed setup leaves no active Agent, writable mount, personal resource copy, or modified profile; cached exact-build
  runtime files remain separate from connection-owned resources.
- `docs/domain-language.md` defines the implemented Remote SSH connection and avoided aliases, and records that it
  changes execution location without creating a new Session type.
- ADR-018 and the Remote SSH/Core PRD requirements and acceptance scenarios match the delivered connection behavior,
  while model, persistence, workflow, and review behavior remains explicitly target or deferred.

## Verification Plan

- Automated: add focused command parsing, shell-injection resistance, remote-path result, architecture selection,
  version mismatch, interrupted preparation, credential redaction, and owned-process cleanup tests. Run them with
  `deno run -A scripts/run-tests.js <test paths>`.
- Automated: run `deno task doc-links:check`, `deno task seams:check`, and the relevant CLI/process tests; run
  `deno task ci` after the focused suite passes.
- Manual: against a clean Linux x64 target, run both command forms, confirm normal SSH host verification, confirm the
  exact remote cwd, inspect the dormant TUI, and exit normally.
- Manual: test a missing directory, unsupported architecture, mismatched development build, interrupted install,
  transport loss, and launcher death. Confirm no Agent or writable Session access starts and unrelated remote processes
  survive.
- Expected: the laptop sentinel project tree is never inspected as the remote project, remote profiles are unchanged,
  and the glossary describes only behavior implemented in this slice.

## Edge Cases

- An SSH alias can change without changing host identity; keep the connection recipe distinct from durable host
  evidence.
- Remote macOS, Windows, unsupported libc/kernel combinations, and 32-bit ARM must fail clearly rather than select a
  nearby artifact.
- A blocked remote process can exceed a termination deadline. Stop dependent work, but do not claim an unconfirmed
  process has ended.
- This slice must not expose a partially functional remote user turn before local model and Session authority exist.
