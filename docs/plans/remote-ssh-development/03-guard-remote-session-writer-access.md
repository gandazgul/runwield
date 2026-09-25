---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/session/file-session-store.ts"
    - "src/shared/session/file-session-store-owner.ts"
    - "src/shared/session/file-session-store-types.ts"
    - "src/shared/session/file-session-activation-state.ts"
    - "src/shared/session/segment-rollover.ts"
    - "src/shared/session/managed-operation.ts"
    - "src/shared/foreground-process.ts"
    - "docs/adr/015-file-authoritative-session-bundles.md"
    - "docs/prd/runwield-core-prd.md"
    - "docs/prd/remote-ssh-prd.md"
executionAgent: "engineer"
createdAt: "2026-09-21T02:05:49.075Z"
status: "draft"
origin: "internal"
parentPlan: "remote-ssh-development"
order: 3
dependencies:
    - "01-establish-the-remote-connection-and-matched-runtime"
targetBranch: "epic/remote-ssh-development"
planId: "30b4b5d9-8c70-4e11-a314-6132bf9ee2a0"
---

# Guard Remote Session Writer Access

## Context

The connection-wide mount of laptop `~/.wld` supplies personal file access, not Session writer authority. Separate
operation-scoped mounted Session files preserve Pi's synchronous file API, but mounted locks do not provide
cross-machine exclusion. The laptop's native Session Writer Lock must remain authoritative, and the actual stock
SFTP-serving process must retain ownership while it can write. Current release and rollover paths can explicitly unlock,
so they cannot serve remote operations unchanged.

This slice builds and proves the storage safety boundary before normal remote user turns depend on it. It implements the
writer-ownership and recovery parts of the Remote SSH PRD's **Local memories and saved Sessions** and **Disconnect and
recovery** capabilities while preserving ADR-015 for ordinary local Sessions.

## Objective

Provide an operation-scoped guarded SFTP/SSHFS writer that acquires the laptop lock, permits mounted synchronous writes,
ends all old writable access, commits evidence from local bytes, and only then releases final ownership. A timeout must
never authorize another writer.

## Approach

Extend the Session-store owner with a remote operation transaction rather than treating a mounted filesystem as the lock
authority. Give every operation fresh guarded serving and mount identities, distinct from the connection-wide personal
mount. Separate revocation from final lock release so error, disposal, publication, and rollover paths cannot unlock
while stock SFTP still writes.

```text
acquire local lock
  start lock-retaining stock SFTP
  mount fresh protected path
  admit writes
  flush and detach remote writer
  terminate old writable service
  sync and commit local evidence
release final lock owner
```

Do not ship the prototype custom SFTP server. It proved a property but would create a new protocol implementation and
confinement burden.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/session/file-session-store*.ts` and `file-session-activation-state.ts` — represent retained native
  ownership, remote operation settlement, local evidence publication, and safe final release.
- `src/shared/session/managed-operation.ts` and `segment-rollover.ts` — fence rollover and all cleanup paths against
  still-writable old service access.
- `src/shared/foreground-process.ts` and focused remote storage modules — own stock SFTP, SSHFS, mount protection,
  revocation, wait, and forced termination.
- `docs/adr/015-file-authoritative-session-bundles.md` — align local-path and writer-lifetime wording with the
  implemented remote extension without introducing a lease.
- The owning Core and Remote SSH PRD sections — record delivered writer guarantees and unresolved platform evidence.

## Reuse Opportunities

- Existing file Session bundles, manifests, recovery descriptors, generation proofs, and native lock files — keep these
  as authority.
- `releaseHeldLock`, publication, uncertainty, and rollover code paths — reshape their ownership boundary rather than
  duplicating Session-store logic.
- `src/shared/foreground-process.ts` — reuse owned-process termination and add exact child/service tracking.
- Stock OpenSSH SFTP and SSHFS — reuse standard file transport and sync/rename support, subject to measured release
  gates.

## Implementation Steps

- Only the laptop Session owner acquires authoritative Session and catalog locks; neither the connection-wide personal
  mount nor mounted `tryLockSync` results can admit a remote writer.
- The stock SFTP-serving process inherits and retains native lock ownership for its complete writable lifetime,
  including launcher death, and the coordinator retains ownership through settlement.
- Each managed operation receives a fresh SFTP channel, mount identity, and protected underlying directory; after
  unmount, ordinary fallback writes fail and a successor never reuses the old path.
- Settlement waits for remote pending writes and flush, detaches the writable manager, closes and confirms termination
  of old writable service access, syncs local files and directories, computes evidence from local bytes, commits
  manifests and recovery descriptors, and then releases final ownership.
- Error, store-disposal, uncertainty, publication, and rollover paths cannot explicitly unlock a shared native lock
  while old service access can still write.
- Segment rollover commits predecessor evidence and successor lineage under continuous safe ownership or ends old access
  before a new operation is admitted.
- Lost settlement acknowledgements reconcile from request identity and committed evidence; transport retry cannot repeat
  a mutation, workflow decision, or external effect.
- Storage service stalls are detected separately from SSH health. Dependent work stops, but a deadline never expires a
  real lock or claims an uninterruptible owner is gone.
- ADR-015 and the owning PRDs describe the implemented extension, stock-server release gate, and remaining unverified
  laptop platforms without weakening local Session guarantees.

## Verification Plan

- Automated: use real Session projects and OS locks to test acquisition, mounted writes, settlement order, error
  cleanup, disposal, uncertain state, publication, rollover, lost acknowledgements, and competitor exclusion. Do not add
  a storage injection seam.
- Automated: continuously probe the actual lock file while cleanup and rollover run; fail the tests if a competitor
  enters before all old writable access ends or if a stale handle can alter successor bytes.
- Automated: run focused tests through `deno run -A scripts/run-tests.js <test paths>`, then `deno task seams:check` and
  `deno task ci`.
- Live: combine stock laptop SFTP, SSHFS, and native Deno locks. Test normal close, launcher death, serving-owner death,
  stopped service, delayed service, unmount, stale handles, and a fresh successor operation.
- Live: verify file sync and POSIX rename against laptop bytes. Confirm remote directory fsync alone is not accepted as
  proof of a laptop commit.
- Expected: no competitor writes while any old service can write; no timeout grants takeover; protected mountpoints
  reject fallback writes; ordinary local Sessions retain existing behavior.

## Edge Cases

- Descriptor inheritance differs by stock server and laptop platform. A failed retention check blocks remote mode; there
  is no unlocked fallback.
- Killing a wrapper is insufficient if its child survives. Verify the process that can serve writes is the process
  retaining ownership.
- An uninterruptible OS I/O call may exceed every application deadline. Preserve truthful recovery state and wait for
  actual lock release.
- Broad standard-SFTP account access is accepted product trust, not evidence that the Session mount is a sandbox.
