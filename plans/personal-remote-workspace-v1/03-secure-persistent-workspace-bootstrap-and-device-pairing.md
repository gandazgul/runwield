---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Create the persistent owner Workspace entry point with registered Project awareness and paired-device authorization so a phone can safely reach later Session continuation surfaces."
affectedPaths:
    - "src/ui/workspace/"
    - "src/ui/workspace/server/"
    - "src/ui/workspace/pages/"
    - "src/ui/workspace/components/"
    - "src/cmd/"
    - "docs/design-system.md"
frontend: true
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-07-22T03:56:51.460Z"
updatedAt: "2026-07-22T03:56:51.460Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 3
dependencies:
    - "02-owner-coordination-database-and-session-catalog"
---

# Secure Persistent Workspace Bootstrap and Device Pairing

## Context

The current `wld plans ui` path is a one-checkout token-protected Plan surface. Personal Workspace v1 needs a persistent
owner application that can operate across registered Projects and paired browser devices on a trusted private network.
Pairing is authorization, not transport encryption, and owner Workspace credentials must remain separate from public
Shared Plan capabilities.

This slice is intentionally narrow: it creates the secure browser entry point needed for early remote ideation, not the
full Attention Dashboard or Plan continuation workflows.

## Objective

Build a persistent owner Workspace bootstrap that supports:

- launching Workspace in owner mode against the owner coordination database;
- listing registered Projects and basic health;
- short-lived local pairing approval for a browser device;
- hashed revocable device credentials for HTTP and WebSocket requests;
- CSRF and Origin enforcement for owner routes;
- clear separation from Shared Space capability routes;
- private-network/TLS deployment guidance and safe loopback defaults.

## Approach

Extend the existing Workspace server and routes rather than creating a second UI stack. Add owner auth
middleware/services under `src/ui/workspace/server/`, backed by the owner DB from slice 2. Provide a minimal,
design-system-aligned Project landing page plus pairing and device management flows. Keep plaintext non-loopback
exposure unsafe by default or explicitly warned, and document trusted TLS terminator assumptions for
Tailscale/WireGuard-style deployments.

## Files to Modify

- `src/ui/workspace/server.js` — compose owner Workspace mode with existing Workspace server startup.
- `src/ui/workspace/remote-server.js` — keep Shared Space/remote behavior trust-separated from owner Workspace routes.
- `src/ui/workspace/server/` — add owner auth, pairing, device credential, CSRF, Origin, and Project service modules.
- `src/ui/workspace/pages/` — add owner landing, Project list, pairing, and device management pages.
- `src/ui/workspace/components/` and `src/ui/workspace/islands/` — add interactive pairing/revocation components using
  RunWield design system patterns.
- `src/cmd/` — add persistent Workspace launch and local pairing approval commands where appropriate.
- `docs/design-system.md` — document any genuinely new reusable owner Workspace pattern.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/workspace/server/remote-adapter.js` — reuse route/auth separation patterns, not Shared Space capabilities for
  owner auth.
- `src/ui/workspace/server/plan-adapter.js` — reuse canonical Project/Plan data access patterns where relevant.
- `src/ui/design-system/` — use RunWield semantic tokens, theme bridge, and components.
- `docs/design-system.md` — follow current Workspace UX guidance.

## Implementation Steps

- [ ] Add owner Workspace server configuration that requires an owner DB path and distinguishes owner routes from Shared
      Space routes.
- [ ] Implement short-lived pairing bootstrap records and local approval flow with expiry.
- [ ] Store only hashed device credentials and expose device list/revocation operations.
- [ ] Add auth middleware for owner HTTP/WebSocket routes, including CSRF protection and strict Origin/host policy.
- [ ] Build responsive Project list, pairing, and device-management UI using existing Workspace visual patterns.
- [ ] Add safe startup warnings or refusal for plaintext non-loopback exposure unless explicitly configured behind
      trusted private-network/TLS setup.
- [ ] Add tests for pairing expiry, credential hashing, revocation, CSRF, Origin checks, route separation from Shared
      Space, and Project root containment display.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: targeted Workspace tests should cover paired/unpaired access, expired pairing, revoked devices, CSRF
  failures, Origin failures, and Shared Space capability isolation.
- Manual headed browser: run `deno task workspace:dev`, open `http://127.0.0.1:5173`, complete a pairing flow, view
  registered Projects, revoke the device, and verify the browser loses owner Workspace access.
- Manual headed browser: emulate a phone-sized viewport and verify Project list, pairing, and revocation controls remain
  readable and keyboard/focus accessible.

## Edge Cases & Considerations

- Pairing does not replace TLS; document this clearly.
- Revoking a device must invalidate active browser control without canceling unrelated running workflows.
- Do not allow Shared Plan capability links to imply owner Workspace authorization.
- Keep new owner UI visually aligned with current Workspace surfaces and `--rw-*` tokens.
