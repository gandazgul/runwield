---
planId: "6134699d-c22f-47c0-8ccc-79543c40df9c"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add non-secret collaboration front matter and enforce the remote-canonical Shared Plan Lock across normal Plan writes, lifecycle changes, local review rewrites, and local Workspace edits. Collaboration command bypasses are explicit and test-covered but not yet wired to real share/pull/push commands."
affectedPaths:
    - "src/plan-store.js"
    - "src/plan-store.test.js"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/shared/workflow/plan-lifecycle.test.js"
    - "src/shared/workflow/submit-plan.js"
    - "src/shared/workflow/submit-plan.test.js"
    - "src/ui/workspace/server/plan-adapter.js"
    - "src/ui/workspace/workspace.test.js"
    - "src/shared/collaboration/"
frontend: false
createdAt: "2026-07-04T14:52:22.901Z"
updatedAt: "2026-07-05T02:25:48.990Z"
status: "verified"
origin: "internal"
parentPlan: "collaborative-planning-remote-shared-spaces"
order: 2
dependencies:
    - "01-collaboration-protocol-crypto-and-secret-storage"
verifiedAt: "2026-07-05T02:25:48.990Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
---

# Shared Plan Lock Enforcement

## Context

The Epic's core invariant, sourced from ADR-008 and the approved collaborative-planning slice decisions, is that a
shared Plan is remote-canonical while shared. RunWield cannot prevent a user from editing markdown in an external
editor, but RunWield must prevent its own normal Plan mutations from silently changing a shared Plan outside controlled
collaboration flows.

Slice 01 is verified and already provides shared collaboration protocol, URL, capability, client, settings, and secret
store primitives. This slice builds on that foundation by adding non-secret Plan front matter and lock enforcement
before any `wld plans share|pull|push|unshare` command is exposed.

Existing write seams are concentrated in `src/plan-store.js`, lifecycle helpers, local Plannotator review submit, and
the Workspace plan adapter/API handlers. The lock should be implemented at the plan-store boundary first so callers get
consistent behavior, then surfaced with clearer workflow/Workspace messages.

## Objective

Add non-secret collaboration metadata to Plan front matter and enforce a hard Shared Plan Lock for normal RunWield
writes. Provide explicit collaboration bypass options for future `share`, `pull`, `push`, and `unshare` flows, and make
blocked errors actionable.

Acceptance criteria:

- Plan front matter can record only non-secret shared-state metadata: normalized fragment-free server URL, remote Shared
  Space id, latest known remote revision, last synced local body hash, sync timestamp, and active remote-canonical
  state.
- Content encryption keys, raw reviewer/maintainer bearer capabilities, capability hashes, and full reviewer/maintainer
  URLs are never written to Plan front matter.
- Normal RunWield write paths reject locked Plans without mutating file bytes.
- Collaboration command paths have a narrow, auditable bypass token for controlled writes, but no real share/pull/push
  command is added in this slice.
- Lifecycle, local review, and Workspace callers surface guidance to pull, push, or unshare instead of generic write
  failures.

## Approach

Create `src/shared/collaboration/lock.js` as the central lock module and import it from `src/plan-store.js` and UI
serialization code. Keep executable code pure `.js` with JSDoc typedefs.

Use flat Plan front matter keys so they work with the existing `formatFrontMatter` scalar/array serializer:

- `collaborationState`: active lock marker; use the string value `remote_canonical`. Treat any other/missing value as
  unlocked for backward compatibility.
- `collaborationServerUrl`: normalized, fragment-free Plan Server base URL.
- `collaborationSpaceId`: remote Shared Space id.
- `collaborationRevision`: latest known positive integer remote revision number.
- `collaborationBodyHash`: SHA-256 hash of the last synced local Plan body.
- `collaborationSyncedAt`: ISO timestamp for the last controlled share/pull/push/unshare metadata write.

Lock detection should require `collaborationState === "remote_canonical"` plus enough remote identity to produce useful
messages (`collaborationServerUrl` and `collaborationSpaceId`). Invalid or partial collaboration metadata should not
silently unlock a Plan if the state says `remote_canonical`; instead, fail closed with a repair-oriented
`SharedPlanLockError`.

Add explicit bypass values, exported as constants, such as:

- `COLLABORATION_LOCK_BYPASS.share`
- `COLLABORATION_LOCK_BYPASS.pull`
- `COLLABORATION_LOCK_BYPASS.push`
- `COLLABORATION_LOCK_BYPASS.unshare`

Plan-store write APIs should accept an optional `options` object with `collaborationLockBypass`; the helper should only
accept one of those exact exported values. Truthy booleans, arbitrary strings, or unrelated options must not bypass the
lock. The bypass is a seam for later trusted commands; this slice only wires and tests the seam.

## Files to Modify

- `src/shared/collaboration/lock.js` — add `SharedPlanLockError`, collaboration front matter key constants, metadata
  normalization, active-lock detection, exact bypass constants, assertion helpers, and actionable message builders.
- `src/shared/collaboration/lock.test.js` — cover active/partial/unlocked metadata, bypass matching, secret redaction in
  messages, and fail-closed behavior for malformed remote-canonical metadata.
- `src/plan-store.js` — extend `PlanFrontMatter`, `PLAN_FRONT_MATTER_KEYS`, `formatFrontMatter`, `parsePlanFrontMatter`,
  and `injectFrontMatter` for the new collaboration fields; enforce the lock in normal write APIs.
- `src/plan-store.test.js` — cover locked `savePlan`, `saveChildFeaturePlans` overwrites, `savePlanBodyById`,
  `updatePlanStatus`, `updatePlanFrontMatter`, metadata formatting/parsing, stale-hash ordering, body hash preservation,
  and explicit bypass behavior.
- `src/shared/workflow/plan-lifecycle.js` — let lifecycle transitions rely on plan-store enforcement and rethrow
  `SharedPlanLockError` with lifecycle-specific recovery guidance when helpful.
- `src/shared/workflow/plan-lifecycle.test.js` — cover blocked lifecycle/status mutations for shared Plans and verify no
  unrelated parent/child Plan file is changed.
- `src/shared/workflow/submit-plan.js` — block local Plannotator review front matter rewrites for locked
  remote-canonical Plans before starting the review server or writing the file.
- `src/shared/workflow/submit-plan.test.js` — cover locked review submit behavior using injected dependencies; verify
  the review server is not started and the Plan file is unchanged.
- `src/ui/workspace/server/plan-adapter.js` — make local Workspace body edits and lifecycle actions return lock-aware
  blocked responses/repair text using `SharedPlanLockError` detection.
- `src/ui/workspace/routes/api/handlers.js` — preserve existing `409` conflict behavior while returning actionable lock
  payloads for body-edit and lifecycle APIs.
- `src/ui/workspace/workspace.test.js` — cover Workspace API `409` responses for locked Plan body edits and lifecycle
  actions, including no local file mutation.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.js` — `parsePlanFrontMatter`, `injectFrontMatter`, `splitPlanMarkdownBody`, `hashPlanBody`,
  `savePlanBodyById`, `updatePlanStatus`, and front matter normalization patterns.
- `src/shared/settings.js` — `normalizePlanServerUrl` already rejects fragments for non-secret Plan Server URLs; reuse
  or mirror its normalization semantics instead of accepting full share URLs.
- `src/shared/collaboration/capabilities.js` — `redactSecrets`/redaction helpers for defensive error messages if remote
  URL strings or payloads include fragments accidentally.
- `src/shared/workflow/plan-lifecycle.js` — current status/event semantics; lock enforcement should not invent parallel
  lifecycle state.
- `src/ui/workspace/server/plan-adapter.js` — existing `serializePlanError` and blocked-action response shape.

## Implementation Steps

- [ ] Step 1: Add `src/shared/collaboration/lock.js` with JSDoc typedefs for collaboration front matter, exported field
      names, `COLLABORATION_STATE_REMOTE_CANONICAL`, `COLLABORATION_LOCK_BYPASS`, `SharedPlanLockError`,
      `isSharedPlanLocked(attrs)`, `assertSharedPlanWriteAllowed(attrs, options)`, and lock message helpers.
- [ ] Step 2: In `src/plan-store.js`, add the collaboration fields to `PlanFrontMatter`, `PLAN_FRONT_MATTER_KEYS`,
      `PLAN_FRONT_MATTER_KEY_ORDER`, `formatFrontMatter`, `parsePlanFrontMatter`, and `injectFrontMatter`; normalize the
      server URL as fragment-free, the revision as a positive integer, and the body hash/synced timestamp as optional
      strings.
- [ ] Step 3: Enforce the lock in `savePlan` when the target file already exists, in `saveChildFeaturePlans` via its
      existing `savePlan` call, and in `ensurePlanIdentity` when adding a missing `planId` to an already locked Plan.
      New files with no existing locked metadata remain creatable.
- [ ] Step 4: Enforce the lock in `updatePlanStatus` and `updatePlanFrontMatter` before writing both normal and
      malformed-front-matter recovery paths. Preserve existing recovery behavior for unshared malformed Plans.
- [ ] Step 5: Enforce the lock in `savePlanBodyById` after locating/parsing the resource but before stale-hash body
      writes. Keep stale-hash behavior for unlocked Plans unchanged; for locked Plans, fail with `SharedPlanLockError`
      without exposing whether the browser body hash is stale.
- [ ] Step 6: Add optional `options = {}` parameters to the write APIs that need collaboration bypasses. Tests should
      prove only exact `COLLABORATION_LOCK_BYPASS.*` values bypass the lock and that generic truthy values do not.
- [ ] Step 7: Add a plan-store helper for future collaboration commands, such as
      `updatePlanCollaborationMetadata(cwd, planName, updates, bypass)`, or document the intended use of
      `updatePlanFrontMatter(..., { collaboration... }, {}, { collaborationLockBypass })`. The helper must update
      `collaborationBodyHash` using `hashPlanBody` when a controlled body write changes the body.
- [ ] Step 8: Update `recordPlanEvent` and lifecycle callers so locked Plans produce messages like "This shared Plan is
      remote-canonical; run `wld plans pull`, `wld plans push`, or `wld plans unshare` first." rather than generic write
      failures.
- [ ] Step 9: Update `submitPlanForReview` so local Plannotator review cannot rewrite front matter or status for a
      locked shared Plan; check the lock immediately after parsing the Plan and before `Deno.writeTextFile` or
      `startPlanReviewServer`.
- [ ] Step 10: Update Workspace body edit and lifecycle APIs to return lock-aware `409` responses with `error`,
      `blockedReason`, and `repair` fields, and no local file mutation.
- [ ] Step 11: Add tests for external-editor divergence inputs: locked front matter should retain
      `collaborationBodyHash`/`collaborationRevision` metadata for future pull/push slices even when the current file
      body hash differs.
- [ ] Step 12: Run focused tests and the full project CI.

## Verification Plan

- Automated:
  `deno test -A src/shared/collaboration/lock.test.js src/plan-store.test.js src/shared/workflow/plan-lifecycle.test.js src/shared/workflow/submit-plan.test.js src/ui/workspace/workspace.test.js`
- Automated: `deno task ci`
- Manual: Create a Plan fixture with `collaborationState: "remote_canonical"`, `collaborationServerUrl`,
  `collaborationSpaceId`, `collaborationRevision`, and `collaborationBodyHash`; then try normal Plan body edit,
  lifecycle status change, local review submit, and Workspace edit/lifecycle paths. Each should fail with a
  collaboration-specific message and preserve file bytes.
- Manual: Use a test-only collaboration bypass path to update body/revision metadata and verify the body hash metadata
  changes intentionally.
- Manual: Inspect locked Plan front matter after tests to confirm no content keys, raw bearer capabilities, capability
  hashes, reviewer URLs, or maintainer URLs are present.
- Expected: locked Plans cannot be mutated by normal RunWield flows, but future collaboration commands have a narrow,
  auditable path for controlled writes.

## Edge Cases & Considerations

- RunWield cannot stop external text-editor edits. This slice should preserve metadata needed for later divergence
  checks rather than pretending filesystem edits are impossible.
- Front matter must never include content keys, bearer capabilities, capability hashes, full reviewer URLs, or full
  maintainer URLs.
- Existing Plans without collaboration metadata must behave exactly as before.
- Partial or malformed remote-canonical metadata should fail closed with repair guidance, not silently unlock the Plan.
- Epic Plans and child FEATURE Plans may both be shareable; lock helpers should not assume only one classification.
- `savePlan` is used by agents to create/update local Plan files. Enforcing the lock there is intentional: once a Plan
  is shared, normal Planner/Architect rewrites must go through pull/push/unshare collaboration flows.
- Error text should be actionable but not leak secret material.
- Do not add real `wld plans share|pull|push|unshare` commands in this slice; later child plans depend on the bypass
  seam and metadata added here.
- Do not introduce TypeScript files or TypeScript syntax; use `.js` and JSDoc typedefs only.

## Product Intent Checkpoint

- Remote-canonical shared Plans and hard local lock: sourced from ADR-008 and the approved Epic decisions.
- Non-secret-only Plan front matter and secrets stored elsewhere: sourced from slice 01 and collaboration memories.
- Actionable blocked behavior (`pull`, `push`, or `unshare` first): proposed execution wording for the already-approved
  lock model; review can adjust copy without changing the architecture.
- No browser UI redesign: this slice changes API/error behavior only, so `frontend` remains `false` and headed browser
  verification is not required.
