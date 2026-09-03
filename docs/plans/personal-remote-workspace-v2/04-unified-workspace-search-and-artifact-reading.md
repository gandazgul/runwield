---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/ui/workspace/server/"
    - "src/ui/workspace/routes/owner-api.js"
    - "src/ui/workspace/pages/"
    - "src/ui/workspace/components/"
    - "src/ui/workspace/islands/"
    - "src/ui/workspace/react/ArtifactReadSurface.tsx"
    - "src/shared/work-records/"
    - "src/shared/owner-coordination/"
    - "src/shared/session/"
    - "src/plan-store.js"
    - "docs/prd/runwield-workspace-prd.md"
    - "docs/design-system.md"
    - "docs/domain-language.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "pair"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-09-03T00:54:21.444Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v2"
order: 4
dependencies:
    - "03-plan-centered-workspace-home-and-navigation"
planId: "8923c678-c0ac-477b-8129-a2473a51c3b9"
---

# Unified Workspace Search and Artifact Reading

## Context

V2 needs one owner search path across durable Project knowledge and Session entry points. The old child draft still
promised Cymbal search and code-server, but the Epic now removes source-code search, Cymbal federation, code-server, and
another Code Surface from v2.

Search must be useful without becoming a second authority. The index can be rebuilt. Plans, Work Records, docs, and
Sessions remain canonical in their owning files and stores.

## Objective

Provide one Spotlight-style quick search and one full search page that call the same service with the same query,
filters, order, and result model. Search covers Plans, PRDs, ADRs, current approved Work Records, each registered
Project's `docs/design-system.md` when present, applicable domain-language documents, Session Names, and the first user
message when present.

Every result names its Project and content type, rechecks canonical source evidence before display or navigation, and
opens the owning Plan, Session, Work Record, or read-only artifact destination.

## Approach

Use a rebuildable Workspace search database with canonical hydration at query time. Keep the search database separate
from owner coordination data.

```text
registered Project scope
  eligible source readers
  rebuildable FTS index
  query with filters
  canonical hydration and freshness check
  browser-safe destination
```

The option set aside is Cymbal/code-server search. It would add code indexing and browser IDE trust cost before v2 has
an actionable code workflow.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/ui/workspace/server/` and `src/ui/workspace/routes/owner-api.js` — add the shared search service, quick-search
  API, full-search API, manual refresh, per-Project freshness, and canonical destination routing.
- `src/ui/workspace/pages/`, `components/`, and `islands/` — add the centered quick-search surface, `Cmd+K` / `Ctrl+K`,
  visible Search action, filters, and full search page.
- `src/ui/workspace/react/ArtifactReadSurface.tsx` — adapt the shared read-only surface so PRDs, ADRs, design-system
  documents, and domain-language documents have consistent Workspace destinations.
- `src/shared/work-records/` — reuse canonical Work Record hydration and include only current approved Work Records by
  default.
- `src/shared/owner-coordination/` and a separate rebuildable Workspace search database — get registered Project scope
  without mixing index schema or state into registration, device, or operation receipt authority.
- `src/shared/session/` — read cataloged Session Names and available first user messages without full Session Transcript
  search.
- `src/plan-store.js` — provide canonical Plan identity and authority-aware hydration for searchable current Plans.
- `docs/prd/runwield-workspace-prd.md` — remove v2 code search and Code Surface claims and record the settled search
  scope.
- `docs/design-system.md` — document reusable quick-search or result-list patterns only if they are new.
- `docs/domain-language.md` — define implemented Workspace search language and its relationship to Project Knowledge
  Search and Session Transcript search.

When the implementation makes proposed domain language true, include the applicable domain-language file:
`docs/domain-language.md` for a single-context project, or the context-specific `domain-language.md` identified by
`docs/domain-language-map.md` for a multi-context project.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/work-records/search.js` — reuse the candidate plus canonical hydration rule, not the Work Record adapter
  as a false generic artifact service.
- `src/ui/workspace/react/ArtifactReadSurface.tsx` — extend the read-only document presentation instead of building
  separate viewers for each document type.
- `src/ui/workspace/server/owner-projects.js` — registered Project scope and health.
- `src/ui/workspace/server/plan-adapter.js` and `src/plan-store.js` — canonical Plan listing, identity, and detail
  reads.
- `src/shared/session/session-transcript-manifest.ts` and catalog readers — Session Names and available first user
  message evidence.
- `src/ui/design-system/` — existing dialog, command, list, badge, and empty-state patterns.

## Implementation Steps

- Quick search and full search call one search service with the same query, filters, ranking model, pagination model,
  and result identity model.
- A visible global Search action and `Cmd+K` / `Ctrl+K` open a centered quick-search surface.
- View all results preserves query, order, filters, and result model on the full search page.
- Search indexes only the scoped sources named in the Epic: current Plans in the normal Plan store, PRDs from
  `docs/prd/`, ADRs from `docs/adr/`, current approved Work Records, `docs/design-system.md`, applicable domain-language
  documents, Session Names, and available first user messages.
- Archived Plans, Markdown files without durable Plan IDs, Superseded Work Records, Archived Work Records, full Session
  messages after the first user message, arbitrary Markdown, tool output, reasoning, source code, and Plan-worktree code
  are absent.
- Ranking uses one flat order: exact document or Session Name matches first, then title and heading matches, then body
  and first-message matches; recency only breaks otherwise similar matches.
- Project and content-type filters apply before ranking and pagination.
- One canonical source contributes at most one result, ranked by its strongest matching field.
- Each result carries canonical Project ID, content type, source identity, source revision or fingerprint, freshness
  state, and browser-safe destination.
- Query hydration rechecks Project eligibility, accepted path, identity, and current source evidence before display or
  navigation.
- The search database uses its own schema version and file separate from owner coordination; corrupt or newer-schema
  index state is quarantined and rebuilt asynchronously.
- Workspace startup and healthy Projects remain usable while indexing builds or one Project fails.
- RunWield-owned writes commit canonical state first and request best-effort incremental refresh after.
- A bounded background scan detects eligible manual edits within a default interval of at most 30 seconds, and manual
  refresh forces an earlier scan.
- PRD, ADR, design-system, and domain-language results open through type-aware canonical readers in the shared read-only
  artifact surface.
- `docs/prd/runwield-workspace-prd.md` records the v2 search scope and removes code search and Code Surface promises.
- `docs/design-system.md` records any reusable new quick-search or result-list pattern.
- `docs/domain-language.md` describes implemented Workspace search language, avoided aliases, and stable relationships
  to Project Knowledge Search, Work Records, Plans, and Session Transcript search.

## Verification Plan

- Automated: run `deno run -A scripts/run-tests.js src/ui/workspace/personal-remote-workspace-v2.acceptance.test.ts` for
  integrated search coverage.
- Automated: add adversarial ranking fixtures that prove exact names outrank heading matches, headings outrank body or
  first-message matches, and recency cannot outrank a stronger text match.
- Automated: prove filters apply before ranking and pagination, results deduplicate by canonical source identity, and
  View all results preserves query, order, and filters.
- Automated: prove current Plans, On-Hold Plans, terminal Plans, current approved Work Records, PRDs, ADRs,
  design-system docs, domain-language docs, Session Names, and first user messages are eligible.
- Automated: prove Archived Plans, Superseded and Archived Work Records, Markdown without durable Plan IDs, full Session
  Transcript bodies, arbitrary Markdown, source code, and Plan worktree code are excluded.
- Automated: corrupt the search database and use a newer schema version; prove quarantine and async rebuild do not block
  Project registration, Session reads, Plan reads, Dashboard, or healthy Project results.
- Automated: change an eligible documentation file externally and prove the background scan updates search without
  manual refresh.
- Manual headed browser: run `deno task workspace:dev`, open quick search with the visible action and keyboard shortcut,
  apply Project and type filters, then use View all results.
- Manual real-server check: use two registered Projects with same-named Plans and artifacts of every supported type;
  mutate and remove indexed files externally and verify stale candidates cannot masquerade as current results.
- Expected result: the owner can find known project knowledge or a Session entry point from one search surface without
  browsing each Project and without adding code search or a Code Surface.
- When applicable: confirm the glossary describes implemented behavior and does not promote unimplemented proposals.

## Edge Cases & Considerations

- A Plan without a durable Plan ID is not onboarded by a read. Search reports a repair diagnostic and leaves onboarding
  to deliberate repair.
- Search candidates are disposable. Path existence alone is never enough to display or navigate a result.
- One failed Project reports stale or unavailable search while healthy Projects continue.
- Design-system search means each registered Project's canonical `docs/design-system.md` when present.
- This slice must not add Cymbal search, code-server, Web Push, closed-tab notification delivery, collaborator policy,
  or source-code handoff.
