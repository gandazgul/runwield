diffstat only, patch not produced. Full patch: git show -p <rev>
---
planId: "f75c427a-9dd9-4a40-95ef-6bca9453194b"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
affectedPaths:
    - "src/shared/session/file-session-store-types.ts"
    - "src/shared/session/file-session-store.ts"
    - "src/shared/session/session-resume-list.ts"
    - "src/shared/session/plan-session-lookup.ts"
    - "src/acp/server.js"
    - "src/ui/workspace/server/session-continuation.js"
    - "src/ui/workspace/routes/owner-session-api.js"
    - "src/ui/workspace/components/SessionList.jsx"
    - "src/ui/workspace/islands/SessionSurface.jsx"
    - "src/ui/workspace/pages/projects/[projectId]/settings.astro"
    - "docs/prd/runwield-core-prd.md"
    - "docs/prd/runwield-acp-protocol-prd.md"
    - "docs/prd/runwield-workspace-prd.md"
    - "docs/adr/015-file-authoritative-session-bundles.md"
    - "docs/domain-language.md"
    - "docs/acp-implementation-details.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
createdAt: "2026-10-02"
origin: "internal"
userVerifiedAt: null
targetBranch: "main"
status: "validated"
validatedCommit: "f3219e8fe10a2659ee48dd162bbc0f3fb048a372"
workRecord:
    status: "generated"
    recordId: "68c201f7-83de-479c-8a2a-bc8e5f259acb"
    path: "docs/work-records/2026-10-02-reversible-session-archive-across-acp-and-workspace.md"
    lastAttemptAt: "2026-10-02T23:07:17.255Z"
---
# Archive Sessions Through ACP and Workspace
## Context
JetBrains calls ACP `session/delete` when a user archives a chat. RunWield currently rejects that method. Workspace
lists saved Sessions but has no archive action or archived view.
The durable Session bundle is authoritative. `docs/adr/015-file-authoritative-session-bundles.md` says Workspace SQLite
is only a projection and registration store. Therefore archive state must live with the file-backed Session manifest,
not only in Workspace.
... more lines (truncated by snip)
