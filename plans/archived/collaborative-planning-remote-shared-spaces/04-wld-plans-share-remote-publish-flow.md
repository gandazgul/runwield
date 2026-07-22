---
planId: "7c0eaef4-948c-4310-8d4e-4c2f0f6794b3"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add the CLI share command that encrypts a local Plan, creates a remote Shared Space, stores secrets safely, writes non-secret lock metadata, and prints reviewer/maintainer URLs. This slice makes sharing demoable from CLI while relying on the prior protocol, lock, and remote API slices."
affectedPaths:
    - "src/cmd/plans/index.js"
    - "src/cmd/plans/share.js"
    - "src/cmd/plans/share.test.js"
    - "src/cmd/registry.js"
    - "src/plan-store.js"
    - "src/shared/collaboration/"
frontend: false
createdAt: "2026-07-04T14:52:22.902Z"
updatedAt: "2026-07-05T15:44:44.035Z"
status: "verified"
origin: "internal"
parentPlan: "collaborative-planning-remote-shared-spaces"
order: 4
dependencies:
    - "01-collaboration-protocol-crypto-and-secret-storage"
    - "02-shared-plan-lock-enforcement"
    - "03-remote-workspace-sqlite-shared-space-api"
verifiedAt: "2026-07-05T15:44:44.035Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
---

# `wld plans share` Remote Publish Flow

## Context

Once protocol helpers, lock enforcement, and the remote Shared Space API exist, users need a first CLI command that
publishes a local Plan for review. This command is the moment a Plan becomes remote-canonical and locally locked.

The command language is `wld plans share`, not singular `wld plan share`, and it must support a configured Plan Server
URL plus per-command `--plan-server=url` override.

## Objective

Implement `wld plans share <plan-name-or-id>` so it encrypts the local Plan, creates a remote Shared Space with initial
revision, stores local collaboration secrets outside front matter/settings, writes non-secret collaboration lock
metadata to the Plan, and prints separate reviewer and maintainer URLs.

## Approach

Add a `share` subcommand under `src/cmd/plans/` using dependency injection patterns from existing plans subcommands.
Resolve the target Plan by name/id, ensure it has a durable `planId`, generate a content key plus reviewer/maintainer
capabilities, encrypt the Plan body/metadata payload, call the remote API client, write local secret records, and then
apply the Shared Plan Lock through the explicit collaboration bypass.

Keep output helpful but secret-aware: the initial URLs are intentionally printed once, but logs/errors should redact
capabilities and keys.

## Files to Modify

- `src/cmd/plans/index.js` — dispatch the `share` subcommand before default list parsing.
- `src/cmd/plans/share.js` — implement argument parsing, Plan resolution, encryption, remote API call, secret storage,
  lock metadata update, and user-facing output.
- `src/cmd/plans/share.test.js` — cover parsing, server URL precedence, duplicate share protection, secret storage, lock
  metadata, output, and failure rollback behavior.
- `src/cmd/registry.js` — update `wld help plans` usage examples to include `share`.
- `src/plan-store.js` — expose any explicit collaboration metadata update helper needed by share.
- `src/shared/collaboration/client.js` — add create Shared Space client method if not already present.
- `src/shared/collaboration/secrets.js` — add helpers for storing/retrieving local secret records by plan id.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/cmd/plans/index.js` — subcommand dispatch pattern used by `ui`, `archive`, and `read`.
- `src/cmd/plans/ui.js` — parse-args style, browser/URL output conventions, and command dependency injection for tests.
- `src/plan-store.js` — `resolvePlan`, `ensurePlanIdentity`, body hash helpers, and controlled front matter updates.
- `src/shared/collaboration/crypto.js` — content-key generation and encryption.
- `src/shared/collaboration/urls.js` — reviewer/maintainer URL construction.
- `src/shared/collaboration/secrets.js` — local secret persistence.

## Implementation Steps

- [ ] Step 1: Add `share` dispatch in `src/cmd/plans/index.js` and help text in `src/cmd/registry.js`.
- [ ] Step 2: Implement `parsePlansShareArgs` with `--plan-server=url`, `--project-secrets` if supported, `--help`, and
      a required Plan name/id argument.
- [ ] Step 3: Resolve the Plan, ensure durable `planId`, compute current body hash, and reject already-shared Plans with
      guidance to `pull`, `push`, or `unshare`.
- [ ] Step 4: Generate content key, reviewer capability, and maintainer capability; encrypt the Plan payload with
      ciphertext-only semantic content.
- [ ] Step 5: Call the remote create Shared Space API using the configured Plan Server URL or `--plan-server` override.
- [ ] Step 6: Store local secrets outside front matter/settings, keyed by durable `planId` and remote Shared Space id.
- [ ] Step 7: Update Plan front matter through the explicit collaboration bypass with non-secret lock metadata: remote
      server URL, remote space id, current revision, last pushed body hash, and shared/locked state.
- [ ] Step 8: Print reviewer and maintainer URLs once, with warnings about maintainer capability power and secret
      handling.
- [ ] Step 9: Add rollback behavior/tests for remote create success but local lock/secret write failure, or clearly
      document and surface recovery if remote cleanup cannot be guaranteed.
- [ ] Step 10: Run focused tests and the full project CI.

## Verification Plan

- Automated:
  `deno test -A src/cmd/plans/share.test.js src/cmd/plans/index.test.js src/shared/collaboration src/plan-store.test.js`
- Automated: `deno task ci`
- Manual: Start a local remote Workspace API server, run `wld plans share <plan> --plan-server=http://localhost:<port>`,
  and verify the command prints reviewer/maintainer URLs.
- Manual: Inspect the Plan front matter and confirm only non-secret metadata was added; inspect the secret store and
  confirm key/capability material is stored outside the Plan.
- Manual: Attempt a normal local Plan edit after share and verify the Shared Plan Lock blocks it.
- Expected: remote SQLite contains ciphertext for Plan content, local Plan is locked, and `wld plans share` refuses to
  share an already-shared Plan.

## Edge Cases & Considerations

- Printing full URLs is intentional only at successful share time. Subsequent output should prefer redacted forms or
  recovery commands.
- If local secret persistence fails after remote creation, the command must avoid leaving the user believing sharing
  succeeded cleanly.
- The command should not launch a browser; browser review is a later slice.
- `--plan-server` should override settings without permanently mutating settings.
- Maintainer URLs are powerful bearer secrets; output should say anyone with that URL can pull, push, close, or unshare.
