---
planId: "6cd5249e-32ca-4288-b5fe-ed94c38aefbd"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Implement maintainer pull by URL or known plan id, including secret import, remote revision/comment decrypt, local divergence checks, controlled local update, and Planner/Architect launch with decrypted review context."
affectedPaths:
    - "src/cmd/plans/index.js"
    - "src/cmd/plans/pull.js"
    - "src/cmd/plans/pull.test.js"
    - "src/cmd/registry.js"
    - "src/shared/workflow/collaboration-pull.js"
    - "src/shared/workflow/collaboration-pull.test.js"
    - "src/plan-store.js"
    - "src/plan-store.test.js"
    - "src/shared/collaboration/protocol.js"
    - "src/shared/collaboration/protocol.test.js"
    - "src/shared/collaboration/secrets.js"
    - "src/shared/collaboration/secrets.test.js"
frontend: false
createdAt: "2026-07-04T10:52:22-04:00"
updatedAt: "2026-07-15T21:36:55.122Z"
status: "verified"
origin: "internal"
parentPlan: "collaborative-planning-remote-shared-spaces"
order: 6
dependencies:
    - "01-collaboration-protocol-crypto-and-secret-storage"
    - "02-shared-plan-lock-enforcement"
    - "03-remote-workspace-sqlite-shared-space-api"
    - "04-wld-plans-share-remote-publish-flow"
    - "05-remote-browser-review-mvp"
verifiedAt: "2026-07-15T21:36:55.122Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
---

# `wld plans pull` Maintainer Revision Flow

## Context

Collaborative Planning now has the verified foundations needed for maintainer pull: encrypted Shared Space protocol
helpers, reviewer/maintainer URL parsing, secret stores, a bearer-auth Plan Server client, Shared Plan Lock metadata,
`wld plans share`, and the remote browser review MVP. The remaining loop is to bring remote review Feedback back into a
local checkout so Planner or Architect can revise the Plan before a later `wld plans push` publishes the next remote
Revision.

This slice implements the maintainer side of that handoff. A maintainer can pull by full maintainer URL in a fresh
checkout or by local Plan name/id after secrets have already been imported. Remote semantic content remains encrypted on
the server and is decrypted only in the local command wrapper. Content keys and bearer capabilities must stay in the
secret store and must not be written to Plan Front Matter, normal settings, logs, or Agent prompts.

The user decision for fresh-checkout bootstrap is: `wld plans pull <maintainer-url>` should auto-create a local locked
Plan from the decrypted remote payload by default, while `--to <plan-name>` lets the maintainer choose the local
filename when no matching local Plan exists.

## Objective

Implement `wld plans pull <maintainer-url-or-plan-name-or-id>` so it:

- imports maintainer URL secrets accountlessly when a URL is provided;
- resolves stored secrets for already-shared local Plans;
- fetches and decrypts the latest remote Revision and latest-revision comments;
- creates or safely updates the local remote-canonical Plan through the collaboration pull bypass;
- detects local/remote divergence instead of silently overwriting markdown;
- launches Planner for FEATURE Plans or Architect for PROJECT/Epic Plans with structured decrypted review context; and
- leaves the user in the collaboration pull/push workflow rather than starting implementation from the pull command.

## Approach

Add a `pull` subcommand under `src/cmd/plans/` with two entry modes.

1. **Maintainer URL bootstrap** parses `/p/<space-id>#key=...&cap=...&role=maintainer`, rejects reviewer URLs for this
   command, fetches remote metadata with the maintainer capability, decrypts the latest Revision, stores the content key
   and maintainer capability in the selected secret store, and creates or updates a local locked Plan. If no local Plan
   with the remote `planId` exists, create one using `--to` when supplied, otherwise a slug derived from decrypted
   remote title/summary with collision suffixes.
2. **Known local Plan lookup** resolves an active Plan by name/id, reads its non-secret collaboration Front Matter,
   loads the matching secret record from global then project-local stores (respecting `--project-secrets` as the first
   lookup/write target), and performs the same fetch/decrypt/update path.

Keep command parsing, remote pull/decrypt logic, and Agent prompt construction separated. Put reusable pull-result and
review-context builders in a small `src/shared/workflow/collaboration-pull.js` helper so tests can verify Agent
selection and prompt redaction without starting a full TUI. Use `CollaborationClient.getSharedSpace`, `getRevision`, and
`listComments`; add only small response/comment-payload normalizers where the browser-review slice left gaps.

Divergence policy is conservative:

- If a matching local Plan exists and its current body hash differs from `collaborationBodyHash`, stop with recovery
  guidance because the local file was externally edited while remote-canonical.
- If local metadata points at a different Shared Space for the same `planId`, stop rather than rebinding silently.
- If the remote latest Revision is older than local metadata, stop as remote/local metadata divergence.
- If the remote latest Revision matches local metadata but decrypted remote body hash differs from the local body hash,
  stop because the remote state changed without a Revision advance.
- If the remote latest Revision is newer, replace the local body with the decrypted remote body and refresh
  collaboration metadata through `COLLABORATION_LOCK_BYPASS.pull`.
- If no local Plan exists, create the locked local Plan from decrypted remote metadata/body and record current remote
  revision/body hash immediately.

After a safe local create/update, start or reuse an interactive session the same way `load-plan` does, switch to Planner
or Architect, and call the runtime planning-agent path with a collaboration-specific request. The request should include
Plan name/path, remote status, revision number, decrypted Plan metadata, and structured comments. It must not include
the content key, bearer capability, full maintainer URL, Authorization header, or ciphertext. The pull command should
not execute Plans or run Slicer directly even if the normal Review Loop returns an approved outcome; it should print the
next step to run `wld plans push <plan>` after the revision is accepted locally.

## Files to Modify

- `src/cmd/plans/index.js` — dispatch the `pull` subcommand before default list parsing and pass through test/runtime
  options consistently with existing subcommands.
- `src/cmd/plans/pull.js` — implement argument parsing, `--plan-server`, `--project-secrets`, `--to`, maintainer URL
  import, secret lookup/write, remote fetch/decrypt, safe local create/update, output, and planning-agent launch.
- `src/cmd/plans/pull.test.js` — cover parsing, URL bootstrap, default auto-create, `--to` create, known Plan lookup,
  global/project secret precedence, missing secrets, reviewer URL rejection, wrong capability, wrong key, closed remote,
  deleted remote, divergence, prompt redaction, and no execution dispatch.
- `src/cmd/registry.js` — update `wld help plans` usage and notes for `pull`, `--to`, Plan Server override, and secret
  handling.
- `src/shared/workflow/collaboration-pull.js` — add pure helpers for selecting Planner/Architect, building the redacted
  collaboration review request, summarizing decrypted comments, and interpreting pull planning outcomes without
  executing implementation work.
- `src/shared/workflow/collaboration-pull.test.js` — unit-test Agent selection, structured comment formatting,
  resolved/inline/global comment rendering, redaction, and approved-outcome handling.
- `src/plan-store.js` — expose any missing helper for creating a Plan with explicit remote `planId` and collaboration
  metadata, and reuse `updatePlanCollaborationMetadata` for controlled body/revision writes.
- `src/plan-store.test.js` — cover fresh locked Plan creation from remote payload, filename collision suffixes, `--to`
  collision behavior, and body-hash metadata after pull.
- `src/shared/collaboration/protocol.js` — add small JSDoc typedefs/normalizers for decrypted browser-review comment
  payloads if not already present, including global vs inline comment fields and anchor context.
- `src/shared/collaboration/protocol.test.js` — cover valid global/inline decrypted comment payloads, missing optional
  anchor data, malformed payloads, and no plaintext leakage in API payload normalizers.
- `src/shared/collaboration/secrets.js` — add helper(s) for resolving/storing secret records by `planId:spaceId`, with
  global/project lookup order and conflict detection suitable for pull.
- `src/shared/collaboration/secrets.test.js` — cover URL-import writes, existing-compatible records, conflicting key or
  capability records, project-local ignored-store behavior, and redaction.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/cmd/plans/share.js` — parse-args style, Plan Server URL precedence, `secretRecordKey` behavior, secret-store
  selection, rollback/redaction style, and success output conventions.
- `src/cmd/load-plan/index.js` — interactive-session startup and runtime planning-agent invocation pattern; reuse the
  pattern without duplicating load-plan's full recovery/execution menu.
- `src/shared/collaboration/urls.js` — `parseCollaborationUrl` and URL redaction helpers.
- `src/shared/collaboration/client.js` — `getSharedSpace`, `getRevision`, and `listComments` bearer-auth methods.
- `src/shared/collaboration/crypto.js` — `importContentKey`/`decryptJsonPayload` for Revision and comment payloads.
- `src/shared/collaboration/capabilities.js` — scope constants and `redactSecrets` for errors/output/tests.
- `src/shared/collaboration/secrets.js` — global and project-local secret store adapters.
- `src/shared/collaboration/lock.js` — `COLLABORATION_STATE_REMOTE_CANONICAL` and `COLLABORATION_LOCK_BYPASS.pull`.
- `src/plan-store.js` — `resolvePlan`, `findPlanById`, `savePlan`, `updatePlanCollaborationMetadata`, `hashPlanBody`,
  Front Matter parsing/formatting, and Shared Plan Lock enforcement.
- `src/shared/workflow/workflow.js` / `SessionRuntime.runPlanningAgent` — existing Agent launch path that switches to
  Planner/Architect and runs a planning turn.

## Implementation Steps

- [ ] Step 1: Add `pull` dispatch in `src/cmd/plans/index.js` and update `src/cmd/registry.js` help for
      `wld plans pull <maintainer-url-or-plan-name-or-id> [--plan-server <url>] [--project-secrets] [--to <plan-name>]`.
- [ ] Step 2: Implement `parsePlansPullArgs` in `src/cmd/plans/pull.js`, including help, one required target,
      `--plan-server`, `--project-secrets`, and `--to`; reject `--to` for known local Plan targets unless it is needed
      for URL bootstrap creation.
- [ ] Step 3: Implement target resolution: detect collaboration URLs, require `role=maintainer`, strip fragment material
      from network URLs, and otherwise resolve an active local Plan by name/id with collaboration Front Matter.
- [ ] Step 4: Add pull secret resolution/import helpers. For URL mode, store
      `{ planId, spaceId, contentKey,
      maintainerCapability, updatedAt }` after the remote payload is decrypted
      enough to know `planId`; for local mode, resolve `planId:spaceId` first and legacy/fallback `planId` second across
      the selected and fallback secret stores.
- [ ] Step 5: Fetch remote Shared Space metadata, latest Revision, and latest-revision comments. Translate 401/403,
      404/deleted, closed, malformed payload, network, and non-JSON failures into actionable redacted errors.
- [ ] Step 6: Import the content key, decrypt the latest Revision payload, validate `planId` against remote metadata,
      normalize decrypted Plan metadata/body, decrypt each comment independently, and keep unreadable/tampered comments
      as redacted placeholders instead of failing the whole pull.
- [ ] Step 7: Normalize decrypted comment context for Planner/Architect: preserve `displayName`, `body`, resolved state,
      created time, global vs inline type, selected/original text, block id, offsets, and anchor fallback notes; never
      include ciphertext or secret URL material.
- [ ] Step 8: Implement local Plan matching/creation. If no matching local `planId` exists, create a locked Plan using
      `--to` or an auto-generated slug from remote title/summary with collision suffixes; reject overwriting an
      unrelated existing file.
- [ ] Step 9: Implement local divergence checks for matching Plans using current body hash, `collaborationBodyHash`,
      remote space/server metadata, local revision number, and decrypted remote body hash before any write occurs.
- [ ] Step 10: When safe, update local Plan body and collaboration metadata through `COLLABORATION_LOCK_BYPASS.pull`,
      setting `collaborationState`, `collaborationServerUrl`, `collaborationSpaceId`, `collaborationRevision`, refreshed
      `collaborationBodyHash`, and `collaborationSyncedAt`.
- [ ] Step 11: Add `src/shared/workflow/collaboration-pull.js` helpers to select Architect for PROJECT/Epic Plans and
      Planner otherwise, build the redacted pull-revision request, and summarize the outcome as "revise locally, then
      push" rather than execute/decompose immediately.
- [ ] Step 12: Start or reuse an interactive session from `runPlansPullCommand`, switch to the selected planning Agent,
      call the runtime planning-agent path with the collaboration request, and avoid dispatching Engineer/Slicer from
      this command even if the Review Loop returns an approved outcome.
- [ ] Step 13: Print concise success/blocked messages: imported secrets, local Plan created/updated/up-to-date, number
      of decrypted/unreadable comments, selected Agent, closed remote warning when relevant, and next step
      `wld plans push <plan>`; ensure all error paths redact key/capability/ciphertext material.
- [ ] Step 14: Add focused tests for command parsing/dispatch, URL secret import, fresh auto-create, `--to`, local
      lookup, divergence states, remote error states, wrong key/capability, comment payload normalization, Agent prompt
      content, and redaction.
- [ ] Step 15: Run focused tests and the full project CI.

## Verification Plan

- Automated:
  `deno test -A src/cmd/plans/pull.test.js src/cmd/plans/index.test.js src/shared/workflow/collaboration-pull.test.js src/shared/collaboration src/plan-store.test.js`
- Automated: `deno task ci`
- Manual: In checkout A, share a Plan and copy the maintainer URL. In checkout B with no local Plan, run
  `wld plans pull <maintainer-url>` and verify a locked local Plan is auto-created, secrets are imported outside Front
  Matter/settings, and Planner/Architect launches with decrypted review context.
- Manual: Repeat fresh checkout pull with `--to copied/review-plan` and verify that exact local Plan path is used
  without overwriting unrelated files.
- Manual: Add global and inline reviewer comments in the remote browser UI, then pull again and verify the planning
  request includes display names, comment bodies, resolved state, selected/original text, and anchor context while
  excluding bearer capabilities, content keys, full maintainer URLs, Authorization headers, and ciphertext.
- Manual: Modify the local locked Plan file externally after share, then run pull and verify the command reports local
  divergence and does not overwrite the file.
- Manual: Close the remote Shared Space, pull again, and verify it remains readable/pullable but the command warns that
  the remote is closed and future push behavior may be blocked by the push flow.
- Expected: maintainer handoff works accountlessly; safe pulls create/update local remote-canonical Plans through the
  collaboration bypass; unsafe pulls stop with recovery guidance; pull launches planning for revision incorporation but
  never starts implementation work directly.

## Edge Cases & Considerations

- URL-mode fresh bootstrap depends on decrypted remote title/summary for auto-generated filenames because the current
  encrypted Plan payload does not carry the original local filename. `--to` is the deterministic override.
- Comment decryption should be per-comment fault-tolerant: one tampered comment should be visible as unreadable without
  hiding other valid comments or the Plan body.
- Closed Shared Spaces are still readable. Pull should not delete local metadata or assume push will succeed; push owns
  stale/closed publish semantics in the next slice.
- Deleted or unavailable Shared Spaces should guide users toward intentional unshare/metadata cleanup rather than
  mutating local Plans automatically.
- Secret records can exist in global or project-local stores. Pull should avoid silently replacing conflicting key or
  maintainer capability material because that can bind a Plan to the wrong Shared Space.
- Local external edits are only detectable through body hashes and revision metadata. Error messages should be explicit
  that RunWield cannot prevent out-of-band text-editor changes.
- PROJECT Epics should route to Architect for revision incorporation; this command should not run Slicer or dispatch
  child FEATURE execution directly.
- The planning prompt may include decrypted Plan/comment semantic content by design, but must not include bearer
  capabilities, content keys, full secret URLs, Authorization headers, or ciphertext.
- Keep all non-Workspace implementation in pure JavaScript with JSDoc typedefs; do not add TypeScript files or syntax.
