---
planId: "7d46dba7-f029-4907-a8bf-293e1d75e1ce"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add the maintainer push command that encrypts the current controlled local revision, appends a new remote revision, updates local revision/body-hash metadata, and handles stale or divergent local/remote states safely. This completes the basic pull-revise-push collaboration loop."
affectedPaths:
    - "src/cmd/plans/index.js"
    - "src/cmd/plans/push.js"
    - "src/cmd/plans/push.test.js"
    - "src/plan-store.js"
    - "src/shared/collaboration/"
frontend: false
createdAt: "2026-07-04T14:52:22.904Z"
updatedAt: "2026-07-16T02:06:27.824Z"
status: "verified"
origin: "internal"
parentPlan: "collaborative-planning-remote-shared-spaces"
order: 7
dependencies:
    - "01-collaboration-protocol-crypto-and-secret-storage"
    - "02-shared-plan-lock-enforcement"
    - "03-remote-workspace-sqlite-shared-space-api"
    - "04-wld-plans-share-remote-publish-flow"
    - "06-wld-plans-pull-maintainer-revision-flow"
implementedAt: "2026-07-16T01:59:05.539Z"
verifiedAt: "2026-07-16T02:06:27.824Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
---

# `wld plans push` Remote Revision Publish Flow

## Context

Collaborative Planning now has verified protocol/crypto helpers, Shared Plan Lock enforcement, the SQLite-backed remote
Shared Space API, `wld plans share`, browser review, and `wld plans pull`. After a maintainer pulls reviewer comments,
Planner or Architect revises the local remote-canonical Plan, and the local revision is accepted by the maintainer, the
team needs to publish a new remote Revision at the same stable Shared Space link.

This is the last command needed for the basic share → review → pull → revise → push loop. Push must preserve the
remote-canonical safety model: it may publish an explicit local revision, but it must not overwrite newer remote state,
create duplicate no-op Revisions, leak maintainer secrets, or hide partial-success recovery cases.

Product behavior is sourced from the approved Epic and verified prior slices: Shared Spaces are remote-canonical while
shared; comments are scoped to their original Revision; reviewer links remain stable across Revisions; maintainer
capabilities authorize Revision append; and raw content keys/bearer capabilities never belong in Plan Front Matter,
normal settings, logs, or routine output.

## Objective

Implement `wld plans push <plan-name-or-id>` so it:

- resolves a local shared Plan and its stored maintainer secrets;
- validates that local collaboration metadata and remote Shared Space metadata still agree;
- blocks stale remote state, closed/deleted Shared Spaces, missing secrets, reviewer-only secrets, and no-op pushes;
- encrypts the current local Plan payload with the existing content key;
- appends exactly one new remote Revision using maintainer authorization and expected-Revision conflict protection;
- updates local non-secret collaboration Front Matter with the new Revision number/body hash through the push bypass;
  and
- prints concise reviewer-facing next steps without printing maintainer URLs or bearer capability material.

## Approach

Add a dedicated `src/cmd/plans/push.js` command using the same dependency-injection and redaction style as `share.js`
and `pull.js`. The command accepts only a local Plan name or Plan ID in v1; maintainer URL import remains a `pull`
responsibility.

The safe publish sequence should be:

1. Resolve the active local Plan by name or `planId` and require complete `remote_canonical` collaboration Front Matter:
   `collaborationServerUrl`, `collaborationSpaceId`, `collaborationRevision`, and `collaborationBodyHash`.
2. Resolve a compatible local secret record for `planId:spaceId` (falling back to legacy `planId`) from the selected
   global/project stores using existing pull secret helpers. Require `contentKey` and `maintainerCapability`; use
   `reviewerCapability` only to reconstruct a reviewer URL when available.
3. Fetch remote Shared Space metadata with the maintainer capability before encrypting or appending. Reject 401/403,
   deleted/not-found, malformed metadata, and `status: "closed"` with actionable redacted messages.
4. Compare `space.planId` and `space.latestRevision` to local metadata. If remote latest is greater than local, block
   and tell the maintainer to run `wld plans pull` first. If remote latest is less than local, block as local/remote
   metadata divergence. Push only when remote latest equals local `collaborationRevision`.
5. Compute the current local body hash. If it equals `collaborationBodyHash`, block as a no-op rather than creating an
   empty duplicate Revision. If it differs, treat the explicit `push` command as the maintainer's intent to publish the
   current local revision, subject to the remote staleness checks above. Be honest in errors/tests that RunWield cannot
   distinguish a Planner-written revision from an out-of-band text-editor edit beyond body-hash metadata.
6. Import the content key, encrypt `{ planId, title, metadata, body }` using `encryptJsonPayload`, and call
   `CollaborationClient.appendRevision(spaceId, { payloadCiphertext, expectedRevision: localRevision + 1 })`. The
   current remote adapter interprets `expectedRevision` as the next Revision number being appended.
7. Normalize the append response, require that the returned Revision is exactly `localRevision + 1`, then update local
   collaboration metadata via `updatePlanCollaborationMetadata(..., COLLABORATION_LOCK_BYPASS.push, { body })` so the
   rewritten Front Matter records the new `collaborationRevision`, refreshed `collaborationBodyHash`, and
   `collaborationSyncedAt`.
8. On remote append success but local metadata update failure, report the partial success prominently: the remote
   Revision exists, local metadata is stale, and the maintainer should run `wld plans pull <plan>` before retrying or
   editing further.

Do not add a `--force` or no-op-duplicate option in this slice. If users later need duplicate Revisions or manual
conflict override, that should be a separate product decision.

## Files to Modify

- `src/cmd/plans/index.js` — import and dispatch `push` before default list parsing; pass test/runtime options the same
  way `share` and `pull` do.
- `src/cmd/plans/index.test.js` — add delegation coverage proving `plans push` does not fall through to list parsing.
- `src/cmd/plans/push.js` — implement argument parsing, Plan/secret resolution, remote validation, body-hash checks,
  encryption, append Revision call, metadata update, output, and redacted errors.
- `src/cmd/plans/push.test.js` — add focused unit tests for parsing, safe publish, stale/closed/deleted/unauthorized
  remote states, missing or reviewer-only secrets, no-op local body, metadata divergence, partial success recovery,
  reviewer URL output, and redaction.
- `src/cmd/registry.js` — update `wld help plans` description, usage, and notes for `push`, Plan Server overrides, and
  secret handling.
- `src/plan-store.js` — reuse `updatePlanCollaborationMetadata`; only add a small helper if push needs a missing active
  Plan resolution or controlled metadata-write seam.
- `src/plan-store.test.js` — add coverage only if a new Plan-store helper or push-specific metadata behavior is added;
  otherwise existing collaboration metadata tests are enough.
- `src/shared/collaboration/client.js` — `appendRevision` already exists; adjust only if response normalization or
  redaction gaps are found.
- `src/shared/collaboration/protocol.js` — `AppendRevisionPayload` already supports `expectedRevision`; adjust only if
  push exposes a missing normalizer.
- `src/shared/collaboration/secrets.js` — reuse existing global/project compatible secret lookup; adjust only if push
  needs a small shared helper to avoid duplicating lookup order.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/cmd/plans/share.js` — parse-args style, Plan Server URL precedence, encrypted Plan payload shape, success output,
  and redaction conventions.
- `src/cmd/plans/pull.js` — active shared Plan lookup, `secretPaths`, compatible secret record resolution, remote
  metadata/revision normalization style, body-hash divergence messaging, and redacted error wrapping.
- `src/shared/collaboration/client.js` — `getSharedSpace` and `appendRevision` bearer-auth API calls.
- `src/shared/collaboration/crypto.js` — `importContentKey` and `encryptJsonPayload`.
- `src/shared/collaboration/protocol.js` — `normalizeSharedSpaceMetadata`, `normalizeRevisionMetadata`,
  `normalizeEncryptedPlanPayload`, and append payload validation.
- `src/shared/collaboration/secrets.js` — `secretRecordKey`, `resolvePullSecretRecord`, global/project secret store
  paths, project-secret ignore handling, and compatible record checks.
- `src/shared/collaboration/urls.js` — `buildCollaborationUrl` for optional reviewer URL reconstruction and URL
  redaction helpers.
- `src/shared/collaboration/lock.js` — `COLLABORATION_STATE_REMOTE_CANONICAL` and `COLLABORATION_LOCK_BYPASS.push`.
- `src/plan-store.js` — `listPlanResources` or `resolvePlan`, `hashPlanBody`, `updatePlanCollaborationMetadata`, and
  Front Matter parsing/formatting.

## Implementation Steps

- [ ] Step 1: Add `push` dispatch in `src/cmd/plans/index.js` plus an `index.test.js` delegation test mirroring the
      existing `share`/`pull` tests.
- [ ] Step 2: Add `parsePlansPushArgs` in `src/cmd/plans/push.js` with `--plan-server <url>`, `--project-secrets`,
      `--help`, and exactly one required local Plan target.
- [ ] Step 3: Resolve the active local Plan by name/id and require `remote_canonical` collaboration metadata including
      server URL, Shared Space ID, local Revision number, and last synced body hash.
- [ ] Step 4: Resolve compatible local secrets from global/project stores using the same precedence as pull; reject
      missing records, missing `contentKey`, and records without `maintainerCapability` with guidance to pull/import a
      maintainer URL.
- [ ] Step 5: Build a maintainer `CollaborationClient`, fetch remote Shared Space metadata, normalize it, and map
      401/403, 404/deleted, closed, malformed JSON, network failure, and Plan Server errors to actionable redacted
      command errors.
- [ ] Step 6: Validate remote/local identity and staleness: matching `planId`, matching `spaceId`, remote latest equals
      local `collaborationRevision`, and remote status is open.
- [ ] Step 7: Compute the current local body hash. Block when unchanged from `collaborationBodyHash`; otherwise proceed
      as an explicit local revision publish after the remote staleness checks have passed.
- [ ] Step 8: Encrypt the current Plan payload with the stored content key. Include current non-secret Front Matter in
      `metadata`, the durable `planId`, a display title from summary/name, and the current markdown body; do not include
      bearer capabilities, content keys, Authorization headers, or full secret URLs.
- [ ] Step 9: Append the new remote Revision with `expectedRevision: localRevision + 1`; normalize the response and
      require the returned Revision number to equal `localRevision + 1` before mutating local metadata.
- [ ] Step 10: Update local collaboration metadata through `COLLABORATION_LOCK_BYPASS.push` with the new Revision,
      refreshed body hash, and `collaborationSyncedAt`, passing `{ body }` so `updatePlanCollaborationMetadata` records
      the correct hash.
- [ ] Step 11: Print success output with Plan name, Shared Space ID, new Revision number, and next reviewer action. If a
      reviewer capability is stored locally, print the reviewer URL; otherwise say the existing reviewer link remains
      valid but cannot be reconstructed from this checkout. Never print the maintainer URL by default.
- [ ] Step 12: Add partial-success handling for append succeeded / local metadata update failed: include the new remote
      Revision number and recovery instruction to pull before retrying.
- [ ] Step 13: Add tests proving comments remain scoped by Revision: after push, old Revision comments are still listed
      on the old Revision and the new Revision starts with an empty comment list.
- [ ] Step 14: Add redaction tests ensuring command output and thrown errors do not contain content keys, bearer
      capabilities, Authorization headers, full maintainer URLs, or ciphertext payloads.
- [ ] Step 15: Run focused tests and the full project CI.

## Verification Plan

- Automated:
  `deno test -A src/cmd/plans/push.test.js src/cmd/plans/index.test.js src/shared/collaboration src/plan-store.test.js`
- Automated: `deno task ci`
- Manual: Start a local remote Workspace API server, share a Plan, add reviewer comments in the browser review UI, pull
  as maintainer, revise the local Plan, then run `wld plans push <plan>` and verify the remote Shared Space shows a new
  Revision at the same reviewer link.
- Manual: Verify old comments remain visible only on their original Revision and the newly pushed Revision starts with
  no inherited comments.
- Manual: Simulate another maintainer appending a remote Revision before push and verify `wld plans push <plan>` blocks
  as stale with instructions to pull first.
- Manual: Run push against an unchanged local body and verify it refuses to create a duplicate no-op Revision.
- Manual: Close or delete the remote Shared Space, then verify push reports the closed/deleted state without changing
  local metadata.
- Expected: push succeeds only from a safe maintainer state; appends one encrypted remote Revision; refreshes local
  non-secret collaboration Front Matter after append; preserves stable reviewer links; and never exposes maintainer
  bearer capability material in routine output.

## Edge Cases & Considerations

- A no-op push is blocked in v1. There is no `--force` override in this slice.
- If remote append succeeds but local metadata update fails, remote state has advanced. The command must clearly report
  partial success and tell the maintainer to pull before retrying.
- Local external edits are detectable only as a body-hash change from the last synced Revision. Because `push` is an
  explicit maintainer command, v1 treats a changed body plus non-stale remote state as publish intent, while messaging
  should acknowledge the detection limit.
- Closed Shared Spaces are readable but should reject new Revisions. Push should block closed state before append when
  metadata exposes it, and still handle a 409 from append defensively.
- Deleted/unavailable Shared Spaces should not clear local collaboration metadata automatically; recovery/cleanup
  belongs to `pull`/`unshare` guidance.
- Maintainer capability leakage is high risk. Do not print maintainer URLs by default, and use `redactSecrets` around
  errors, server URLs, and test fixtures.
- Reviewer links remain stable across Revisions. Reconstruct and print the reviewer URL only when the local secret
  record includes `reviewerCapability`; URL-imported maintainer-only checkouts may not have enough information to do so.
- Keep implementation in pure JavaScript with JSDoc typedefs; do not add TypeScript files or TypeScript syntax outside
  the existing Workspace exception.
