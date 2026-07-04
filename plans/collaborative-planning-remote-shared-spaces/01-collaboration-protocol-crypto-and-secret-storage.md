---
planId: "78ec879b-5ea5-4f32-95ce-df5d690eed3f"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Create the shared collaboration foundation: protocol payload shapes, AES-GCM encryption helpers, URL fragment handling, capability hashing, API client primitives, Plan Server setting support, and secret-store adapters. This slice is independently verifiable with crypto/protocol/secret-store tests and does not expose any share/pull/push commands yet."
affectedPaths:
    - ".gitignore"
    - "deno.json"
    - "src/shared/settings.js"
    - "src/shared/settings.test.js"
    - "src/shared/collaboration/"
frontend: false
createdAt: "2026-07-04T14:52:22.894Z"
updatedAt: "2026-07-04T22:19:50.407Z"
status: "verified"
origin: "internal"
parentPlan: "collaborative-planning-remote-shared-spaces"
order: 1
dependencies:
    []
verifiedAt: "2026-07-04T22:19:50.407Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
---

# Collaboration Protocol, Crypto, and Secret Storage

## Context

Collaborative Planning needs a safe foundation before any remote server or CLI command can share Plans. The remote
server must store ciphertext, authorization bearer capabilities must be separate from encryption keys, and local secret
material must never be written to Plan front matter or normal settings.

The behavior is sourced from the Collaborative Planning PRD, ADR-008, and the approved Epic decisions: v1 is
self-hosted-first, Shared Spaces are remote-canonical while shared, access is accountless capability-based, reviewer and
maintainer capabilities have different powers, and encrypted semantic content must remain client-side only. This slice
only creates reusable shared primitives; it does not add server routes, Workspace UI, local Plan locks, or `wld plans`
commands.

## Objective

Add shared collaboration modules for encrypted payload handling, URL fragments, reviewer/maintainer capabilities,
capability hashing, API client request shapes, non-secret Plan Server URL settings, and local secret storage. The result
should be testable without a running remote server and should make secret leakage hard by default.

Acceptance criteria:

- Content encryption keys and bearer capabilities are generated, parsed, redacted, and stored as distinct values.
- URL helpers keep secret URL material in the fragment and expose a fragment-free API/server URL for network calls.
- AES-GCM helpers round-trip valid payloads and fail closed for tampered ciphertext, invalid key material, or wrong
  keys.
- Capability hashes are deterministic server-safe values, while raw bearer capabilities are never logged in errors.
- The Plan Server default setting stores only a non-secret URL using existing custom settings merge behavior.
- Secret stores default to a global user file and support an explicitly requested ignored project-local file.

## Approach

Create a new `src/shared/collaboration/` area with small focused modules and JSDoc typedefs for protocol types.
Port/adapt the AES-GCM/content-key and URL-fragment concepts from Plannotator into pure `.js` files, keeping
authorization bearer capabilities outside encrypted content keys. Use `crypto.subtle`, base64url strings, and JSON
payloads so the same contracts can later be reused by CLI, server route tests, and browser islands.

Use a conservative URL shape: reviewer/maintainer links should route to the remote Shared Space path, with `key`, `cap`,
and `role` represented as distinct fragment parameters rather than query/path values. Parsing should return the clean
base URL/space id plus secrets, while serialization/redaction should avoid leaking either the content key or bearer
capability.

Add a global-first secret store at `~/.wld/collaboration-secrets.json` and an optional project-local store at
`.wld/collaboration-secrets.json`. Project-local storage is useful for explicit workflows but must be ignored by git.
This slice should provide an `ensureProjectSecretStoreIgnored(projectRoot)`-style helper that creates `.wld/` as needed
and adds the secret-store ignore entry to the user's project `.gitignore` idempotently. Later `wld plans share` should
call that helper when it first creates an opt-in project-local store, so users do not have to manually protect the file.
Secret writes should be JSON, atomic via temp-file-plus-rename where practical, and best-effort private-permissioned.

Keep the Plan Server URL as a non-secret custom setting in `src/shared/settings.js`. Use a flat camelCase setting key
such as `planServerUrl`, consistent with existing RunWield custom settings. Do not store content keys, reviewer
capabilities, maintainer capabilities, capability hashes, or full collaboration URLs in normal settings or Plan front
matter.

## Files to Modify

- `.gitignore` — ignore this repository's project-local collaboration secret file path such as
  `.wld/collaboration-secrets.json` without globally ignoring all `.wld/` settings behavior; the shared secret-store
  helper must also be able to add the same targeted ignore entry to a user's project `.gitignore` when project-local
  storage is first created.
- `deno.json` — add imports only if required by implementation/tests; do not add TypeScript tooling or a database
  dependency in this slice.
- `src/shared/settings.js` — add helpers for reading/writing the non-secret default Plan Server URL custom setting and
  preserve that custom key across `SettingsManager` writes.
- `src/shared/settings.test.js` — cover Plan Server URL custom setting merge behavior, URL validation/normalization, and
  ensure it remains non-secret.
- `src/shared/collaboration/base64url.js` — encode/decode helpers for binary payloads and compact URL-safe strings.
- `src/shared/collaboration/crypto.js` — AES-GCM key generation/import/export, encrypt/decrypt, tamper failure, invalid
  input, and wrong-key failure helpers.
- `src/shared/collaboration/capabilities.js` — random reviewer/maintainer bearer token generation, scope constants,
  `sha256:<base64url>` capability hashing, capability comparison helpers if useful, and redaction helpers.
- `src/shared/collaboration/urls.js` — build, parse, normalize, and redact reviewer/maintainer URLs with distinct
  fragment `key`, `cap`, and `role` fields.
- `src/shared/collaboration/protocol.js` — JSDoc typedefs and lightweight validation helpers for Shared Space, revision,
  encrypted comment, resolve/reopen, close/delete, and error payloads.
- `src/shared/collaboration/client.js` — fetch-based API client primitives with injectable `fetch`, bearer capability
  headers, clean base URL handling, JSON error handling, and redacted errors.
- `src/shared/collaboration/secrets.js` — global and optional project-local secret store adapters with atomic read/write
  behavior, schema validation, missing/corrupt-store handling, redaction, and an idempotent helper to ensure the
  project-local store path is gitignored before/when it is created.
- `src/shared/collaboration/*.test.js` — unit tests for crypto, URL, capability, client, protocol, settings, and
  secret-store behavior.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `../plannotator/packages/shared/crypto.ts` — design reference for AES-GCM/content-key flow; port concepts only into
  `.js` with JSDoc and no TypeScript syntax.
- `../plannotator/packages/ui/utils/sharing.ts` — design reference for URL-fragment key handling and compact sharing
  URLs.
- `src/shared/settings.js` — existing RunWield custom setting storage, JSONC parsing, lock behavior, and global/project
  merge behavior for non-secret Plan Server URL support.
- `src/plan-store.js` — existing durable `planId` terminology for protocol payload fields, without writing secrets to
  front matter.
- `src/cmd/plans/ui.js` — URL construction conventions and testable dependency-injection style for later CLI commands.

## Implementation Steps

- [ ] Step 1: Add `src/shared/collaboration/protocol.js` with JSDoc `@typedef` definitions for Shared Space metadata,
      revision metadata, encrypted plan payloads, encrypted comment records, reviewer/maintainer capability scopes, API
      errors, and local secret records; include small `assert*`/`normalize*` validation helpers used by tests.
- [ ] Step 2: Implement `base64url.js` and tests covering UTF-8 strings, binary round trips, missing padding, invalid
      input, empty values, and URL-safe output.
- [ ] Step 3: Implement `crypto.js` with AES-256-GCM content-key generation, raw key import/export as base64url,
      encrypt/decrypt helpers that prepend a 12-byte IV, and tests proving wrong keys, tampered ciphertext, malformed
      keys, and truncated ciphertext fail closed.
- [ ] Step 4: Implement `capabilities.js` with reviewer/maintainer scope constants, 256-bit random bearer capability
      generation, deterministic `sha256:<base64url>` hashing, safe equality helpers if needed, and redaction for raw
      capabilities, hashes, fragments, and authorization headers.
- [ ] Step 5: Implement `urls.js` that builds/parses reviewer and maintainer URLs in the form
      `/p/<space-id>#key=<content-key>&cap=<bearer-capability>&role=<reviewer|maintainer>`; ensure parsed API/server
      URLs never include fragments and redaction removes both key and capability values.
- [ ] Step 6: Implement `secrets.js` with default global storage under `~/.wld/`, optional project-local storage under
      `.wld/`, schema-versioned JSON records keyed by local `planId` and/or remote space id, atomic writes, and
      corruption/missing-file behavior that fails with redacted actionable errors.
- [ ] Step 7: Add an idempotent `ensureProjectSecretStoreIgnored(projectRoot)`-style helper that creates/updates the
      user's project `.gitignore` with a targeted `.wld/collaboration-secrets.json` entry before an opt-in project-local
      secret store is written; cover missing `.gitignore`, existing matching entry, and preservation of existing
      contents.
- [ ] Step 8: Add this repository's `.gitignore` entry for project-local collaboration secrets while leaving
      `.wld/settings.json` and existing `.wld/` runtime behavior unchanged.
- [ ] Step 9: Add `PLAN_SERVER_URL_SETTING_KEY`, `getDefaultPlanServerUrl`, and `setDefaultPlanServerUrl` (or similarly
      named helpers) in `src/shared/settings.js`; store only a normalized non-secret URL and add the key to
      `RUNWEILD_CUSTOM_SETTING_KEYS` preservation.
- [ ] Step 10: Add settings tests for global/project precedence, project override, invalid URL rejection, fragment
      rejection, preservation across `SettingsManager` writes, and proof that full share URLs/secrets are not accepted
      as the Plan Server URL.
- [ ] Step 11: Implement `client.js` request primitives for later slices: base URL normalization, endpoint URL building,
      injected `fetch`, JSON request/response handling, bearer `Authorization` headers, structured errors, and redaction
      of capabilities/fragments from messages.
- [ ] Step 12: Add focused client tests using a fake fetch for successful calls, non-JSON errors, JSON API errors,
      network failures, bearer header placement, and redacted thrown messages.
- [ ] Step 13: Run focused tests and the full project CI.

## Verification Plan

- Automated: `deno test -A src/shared/collaboration src/shared/settings.test.js`
- Automated: `deno task ci`
- Manual: Inspect generated test fixtures and temporary settings files to verify no content keys, reviewer capabilities,
  maintainer capabilities, capability hashes, or full share URLs are stored in Plan front matter or normal settings.
- Manual: Parse a reviewer URL and a maintainer URL and verify the content key and bearer capability are distinct
  fragment fields, the fragment is not present in API request URLs, and `Authorization: Bearer ...` is the only place
  the raw capability is used for network calls.
- Expected: encrypted content round trips with the correct key; wrong-key/tamper cases fail; capability hashes are
  deterministic but do not reveal bearer values; project-local secret storage is ignored by git; settings only contain a
  clean non-secret Plan Server URL.

## Edge Cases & Considerations

- Browser and Deno crypto APIs differ at the edges; keep helpers based on `crypto.subtle` and test in Deno, then let the
  browser slice reuse the same public contract.
- Do not introduce TypeScript files or TypeScript syntax; use `.js` and JSDoc typedefs only.
- Secret stores must be conservative: redaction should apply to errors, logs, snapshots, and test assertion messages.
- The API client should not decide CLI UX. It should expose structured errors that later commands can translate into
  actionable messages.
- URL fragments are intentionally used for link-carried secrets, but browsers do not send fragments to the server;
  browser code must explicitly read the fragment and attach the bearer capability only to JSON API requests.
- Project-local secret storage is opt-in and ignored; global user storage remains the default so normal repositories do
  not gain new project-local secret files. When a future share flow does create the project-local store, it should call
  this slice's ignore helper before writing secrets, creating or updating the user's `.gitignore` idempotently.
- Cloudflare/D1-specific protocol behavior is intentionally out of scope for this self-hosted-first Epic.
