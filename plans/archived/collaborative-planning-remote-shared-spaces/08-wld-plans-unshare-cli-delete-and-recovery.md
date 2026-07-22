---
planId: "74f315ce-700b-4f34-98d5-a10953a327cd"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Implement CLI-only destructive unshare with maintainer authorization, --force-capable confirmation, remote delete, local secret cleanup, intentional local lock metadata clearing, and safe deleted-remote recovery. Browser-side unshare/delete is explicitly deferred."
affectedPaths:
    - "src/cmd/plans/index.js"
    - "src/cmd/plans/index.test.js"
    - "src/cmd/plans/unshare.js"
    - "src/cmd/plans/unshare.test.js"
    - "src/cmd/registry.js"
    - "src/plan-store.js"
    - "src/plan-store.test.js"
    - "src/shared/collaboration/client.js"
    - "src/shared/collaboration/client.test.js"
    - "src/shared/collaboration/secrets.js"
    - "src/shared/collaboration/secrets.test.js"
    - "src/ui/workspace/workspace.test.js"
frontend: false
createdAt: "2026-07-16T12:15:51-04:00"
updatedAt: "2026-07-16T20:33:20.447Z"
status: "verified"
origin: "internal"
parentPlan: "collaborative-planning-remote-shared-spaces"
order: 8
dependencies:
    - "01-collaboration-protocol-crypto-and-secret-storage"
    - "02-shared-plan-lock-enforcement"
    - "03-remote-workspace-sqlite-shared-space-api"
    - "04-wld-plans-share-remote-publish-flow"
    - "07-wld-plans-push-remote-revision-publish-flow"
implementedAt: "2026-07-16T20:04:10.083Z"
verifiedAt: "2026-07-16T20:33:20.447Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
---

# `wld plans unshare` CLI Delete and Recovery

## Context

Collaborative Planning now has verified Shared Space protocol helpers, local secret storage, Shared Plan Lock
enforcement, a SQLite-backed remote Workspace API, `wld plans share`, browser review, `wld plans pull`, and
`wld plans push`. The remaining basic collaboration command is destructive unshare: a maintainer must be able to delete
the remote Shared Space and intentionally return their local markdown Plan to normal local ownership.

Unshare is destructive because it removes the remote Shared Space for every reviewer URL, maintainer URL, browser
session, and other checkout. For v1, destructive unshare remains **CLI-only**. The browser review UI may continue to
call normal review APIs, but it must not expose an unshare/delete control.

Local Plans must not be silently edited when a remote is deleted elsewhere or temporarily unavailable. The command
should clean local collaboration state only after a successful remote delete or after the remote is explicitly known to
be already deleted/not found and the maintainer confirms local cleanup.

## Objective

Implement `wld plans unshare <plan-name-or-id>` so it:

- resolves a local remote-canonical shared Plan;
- requires complete stored maintainer secrets, not reviewer-only secrets;
- confirms the destructive remote delete unless `--force` is supplied;
- deletes the remote Shared Space through the existing maintainer lifecycle API;
- removes matching local collaboration secret records from both global and project-local stores;
- clears only the non-secret collaboration lock Front Matter from the local Plan through the explicit unshare bypass;
- reports already-deleted remotes as a recoverable local cleanup path; and
- never clears local lock metadata after ambiguous network/server failures.

## Approach

Add a dedicated `src/cmd/plans/unshare.js` command following the dependency-injection, parsing, and redaction style of
`share.js`, `pull.js`, and `push.js`. The selected command shape is:

```text
wld plans unshare <plan-name-or-id> [--plan-server <url>] [--project-secrets] [--force]
```

`--force` skips interactive confirmation for non-interactive use, but it does not bypass authorization, Plan identity,
remote/local consistency, redaction, or safety checks.

The safe flow should be:

1. Resolve the active local Plan by name or `planId` and require complete `remote_canonical` collaboration metadata:
   `planId`, `collaborationServerUrl`, `collaborationSpaceId`, and `collaborationRevision`.
2. Reject a `--plan-server` override that does not normalize to the Plan's stored `collaborationServerUrl`, matching the
   push safety model so unshare cannot accidentally target a different Plan Server.
3. Resolve compatible local secret records using the same global/project precedence as pull and push. Require
   `contentKey` and `maintainerCapability`; reject missing or reviewer-only records with guidance to pull/import a
   maintainer URL first.
4. Build a maintainer `CollaborationClient` and fetch the remote Shared Space before confirmation. If it returns
   401/403, abort without local cleanup. If it returns 404/not-found/deleted, switch to the already-deleted recovery
   path. If it returns a network failure, 5xx, malformed response, mismatched `planId`, or mismatched `spaceId`, abort
   without local cleanup.
5. For an existing remote Shared Space, ask an explicit destructive confirmation unless `--force` is set. The prompt
   must mention the Plan name, Shared Space id, Plan Server, current remote revision/status, that reviewer/maintainer
   links will stop working, and that other checkouts will need recovery.
6. Delete the remote Shared Space with the existing lifecycle endpoint
   (`updateSharedSpaceLifecycle(spaceId,
   { action: "delete" })`). Treat a 404 during delete as a race into the
   already-deleted recovery path; treat network and 5xx failures as ambiguous and leave local state locked.
7. After confirmed remote delete or confirmed already-deleted recovery, delete local secret records for both
   `secretRecordKey(planId, spaceId)` and compatible legacy `planId` records from both the global and project-local
   secret stores. Do not delete unrelated records bound to a different `spaceId`.
8. Clear local collaboration Front Matter via a new narrow Plan-store helper such as
   `clearPlanCollaborationMetadata(cwd, planName, COLLABORATION_LOCK_BYPASS.unshare, { updatedAt })`. This helper should
   remove `collaborationState`, `collaborationServerUrl`, `collaborationSpaceId`, `collaborationRevision`,
   `collaborationBodyHash`, and `collaborationSyncedAt`, preserve the Plan body and normal Plan metadata, update
   `updatedAt`, and still enforce the exact collaboration bypass.
9. Print concise success/recovery output with no content keys, bearer capabilities, Authorization headers, maintainer
   URLs, or ciphertext.

Do not add browser-side unshare/delete UI in this slice. The remote API lifecycle delete endpoint already exists for CLI
use; adjust client/test ergonomics only if a clearer `deleteSharedSpace` wrapper is useful.

## Files to Modify

- `src/cmd/plans/index.js` — import and dispatch `unshare` before default list parsing.
- `src/cmd/plans/index.test.js` — add delegation coverage proving `plans unshare` does not fall through to list parsing.
- `src/cmd/plans/unshare.js` — implement argument parsing, Plan/secret resolution, confirmation, maintainer remote
  delete, already-deleted recovery, local secret cleanup, collaboration metadata clearing, output, and redacted errors.
- `src/cmd/plans/unshare.test.js` — cover parsing, confirmation/`--force`, wrong capability, missing/reviewer-only
  secrets, successful remote delete, already-deleted cleanup confirmation, network/5xx no-cleanup behavior, local secret
  cleanup, metadata clearing, partial local cleanup failures, and redaction.
- `src/cmd/registry.js` — update `wld help plans` usage and notes for `unshare`, including destructive warning text and
  `--force` semantics.
- `src/plan-store.js` — add an exported narrow helper to clear collaboration Front Matter through
  `COLLABORATION_LOCK_BYPASS.unshare`; reuse existing Front Matter merge/removal internals where practical.
- `src/plan-store.test.js` — prove the unshare helper removes collaboration keys, preserves body/normal metadata,
  updates `updatedAt`, and rejects missing/wrong bypasses.
- `src/shared/collaboration/client.js` — reuse `updateSharedSpaceLifecycle`; optionally add a tiny `deleteSharedSpace`
  convenience wrapper if it simplifies command/test code.
- `src/shared/collaboration/client.test.js` — cover delete lifecycle client behavior if a wrapper is added; otherwise
  keep existing lifecycle-path coverage.
- `src/shared/collaboration/secrets.js` — add a helper for deleting all compatible local records for a Plan/Shared Space
  pair across selected secret store paths.
- `src/shared/collaboration/secrets.test.js` — cover pair-key deletion, compatible legacy `planId` deletion, unrelated
  space preservation, missing-file tolerance, and redaction on failures.
- `src/ui/workspace/workspace.test.js` — add/keep regression coverage that reviewer capability cannot delete remotely
  and that the remote browser review shell exposes no unshare/delete control in v1.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/cmd/plans/push.js` — Plan resolution, complete remote-canonical metadata checks, Plan Server override rejection,
  compatible secret lookup, remote metadata fetch, deleted/unauthorized error redaction, and output style.
- `src/cmd/plans/pull.js` — `secretPaths`, compatible secret record resolution, remote response normalization, and
  maintainer-secret guidance.
- `src/cmd/plans/share.js` — remote lifecycle delete use during cleanup and maintainer/reviewer secret warnings.
- `src/cmd/plans/archive.js` — `--force` precedent for destructive command confirmation bypass, while keeping unshare's
  own explicit remote-delete wording.
- `src/shared/collaboration/client.js` — existing `updateSharedSpaceLifecycle(spaceId, { action: "delete" })`
  bearer-auth API call.
- `src/shared/collaboration/secrets.js` — `secretRecordKey`, global/project store paths, normalized store reads/writes,
  and `deleteSecretRecord` behavior.
- `src/shared/collaboration/capabilities.js` and `urls.js` — redaction helpers for capabilities, Authorization headers,
  and fragment-bearing URLs.
- `src/shared/collaboration/lock.js` — `COLLABORATION_LOCK_BYPASS.unshare` and `COLLABORATION_FRONT_MATTER_KEYS`.
- `src/plan-store.js` — `listPlanResources`, Front Matter parsing/formatting, `mergeFrontMatterText` key-removal
  semantics, Shared Plan Lock checks, and body-preserving metadata rewrites.
- `src/ui/workspace/routes/remote-api.js` and `src/ui/workspace/server/remote-adapter.js` — existing maintainer-only
  lifecycle delete API and 404-after-delete behavior.

## Implementation Steps

- [ ] Step 1: Add `runPlansUnshareCommand` dispatch in `src/cmd/plans/index.js` and an `index.test.js` delegation test
      mirroring `share`/`pull`/`push`.
- [ ] Step 2: Add `src/cmd/plans/unshare.js` with `parsePlansUnshareArgs` supporting `--plan-server <url>`,
      `--project-secrets`, `--force`, `--help`, and exactly one local Plan target.
- [ ] Step 3: Resolve the active local Plan by name/id with `listPlanResources(cwd, { backfillMissing: false })`;
      require `planId`, `remote_canonical` state, stored server URL, Shared Space id, and local Revision.
- [ ] Step 4: Normalize any `--plan-server` override and reject it unless it equals the Plan's stored
      `collaborationServerUrl`.
- [ ] Step 5: Resolve local secrets from global/project secret stores using pull/push precedence; require `contentKey`
      and `maintainerCapability`, and reject reviewer-only or missing records before contacting the server.
- [ ] Step 6: Fetch remote Shared Space metadata with maintainer authorization; normalize it and validate matching
      `planId`/`spaceId`. Map 401/403, 404/deleted, malformed, network, and 5xx failures to distinct redacted command
      outcomes.
- [ ] Step 7: Implement a test-injectable destructive confirmation helper. Unless `--force` is set, require confirmation
      before remote deletion and require separate confirmation before local cleanup when the remote was already deleted.
- [ ] Step 8: Call remote lifecycle delete. On success, continue to local cleanup. On delete-time 404, continue through
      the already-deleted cleanup confirmation. On network/5xx/unknown failure, abort without local secret or metadata
      cleanup.
- [ ] Step 9: Add a shared secret-store cleanup helper that deletes compatible records for both `planId:spaceId` and
      legacy `planId` keys from both global and project-local stores, preserving records whose stored `spaceId` points
      to a different Shared Space.
- [ ] Step 10: Add `clearPlanCollaborationMetadata` (or equivalent) in `src/plan-store.js` and tests proving it removes
      only collaboration Front Matter through `COLLABORATION_LOCK_BYPASS.unshare` while preserving body, `planId`,
      status, classification, summary, and other normal Plan metadata.
- [ ] Step 11: Wire local cleanup so remote delete success followed by secret cleanup or metadata cleanup failure
      reports partial cleanup accurately, including whether the remote is already gone and which local recovery step
      remains.
- [ ] Step 12: Print success output showing Plan name, Shared Space id, and cleanup result; never print maintainer URLs,
      content keys, bearer capabilities, Authorization headers, or ciphertext.
- [ ] Step 13: Update `src/cmd/registry.js` help text to include
      `plans unshare <plan-name-or-id> [--plan-server <url>]
      [--project-secrets] [--force]`, explain that it
      deletes the remote Shared Space, and warn that other links/checkouts will need recovery.
- [ ] Step 14: Add regression tests proving pull/push-style deleted remote failures do not mutate local Plans; adjust
      messages only if current behavior is too generic to guide users to unshare recovery.
- [ ] Step 15: Add/keep remote Workspace tests proving reviewer capability cannot delete and the browser review shell
      has no unshare/delete control in v1.
- [ ] Step 16: Run focused tests and the full project CI.

## Verification Plan

- Automated:
  `deno test -A src/cmd/plans/unshare.test.js src/cmd/plans/index.test.js src/shared/collaboration/client.test.js src/shared/collaboration/secrets.test.js src/plan-store.test.js src/ui/workspace/workspace.test.js`
- Automated: `deno task ci`
- Manual: Start a local remote Workspace API server, share a Plan, then run `wld plans unshare <plan>` and accept the
  destructive prompt. Verify the remote Shared Space returns not found/deleted, local collaboration secrets are removed,
  and local collaboration Front Matter is cleared while the Plan body remains.
- Manual: Repeat with `--force` and verify no prompt appears but all authorization and consistency checks still run.
- Manual: Try old reviewer and maintainer URLs after unshare and verify the browser reports “Shared Space not found or
  deleted.”
- Manual: Delete the remote Shared Space first, then run `wld plans unshare <plan>` and verify the command asks before
  clearing local metadata/secrets.
- Manual: Simulate a network failure or Plan Server 5xx during fetch/delete and verify the command leaves local secrets
  and collaboration metadata intact with retry guidance.
- Expected: unshare is CLI-only, destructive, maintainer-authorized, secret-redacted, and never silently unlocks local
  Plans after ambiguous remote failures.

## Edge Cases & Considerations

- A network failure after sending the delete request may be ambiguous. V1 should leave the local Plan locked and tell
  the maintainer to retry/verify rather than clearing local state.
- Already-deleted/not-found remote state is the only automatic recovery class eligible for local cleanup confirmation;
  ambiguous unavailable remotes are intentionally not unlocked by default.
- Other checkouts may remain locked with stale metadata after unshare. Their pull/push attempts should report deleted or
  unavailable remote state and guide maintainers toward intentional local cleanup.
- Secret cleanup must consider both global and project-local stores because users may have imported or shared with
  different `--project-secrets` choices over time.
- Local cleanup must not remove the Plan file, Plan body, `planId`, or normal Plan lifecycle/status metadata.
- Browser delete/unshare controls are intentionally deferred to reduce v1 capability-risk. The maintainer-only remote
  API delete endpoint remains available for CLI use.
- Confirmation and error output must not print full maintainer secrets, content keys, bearer capabilities, Authorization
  headers, maintainer URLs, or ciphertext.
- Use pure JavaScript with JSDoc typedefs; do not add TypeScript syntax outside the existing Workspace exception.
