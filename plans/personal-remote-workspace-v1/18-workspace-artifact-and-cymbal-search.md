---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add owner-only Project artifact search, human Transcript search, and explicitly scoped multi-Project Cymbal code search with canonical hydration and privacy boundaries. Code Surface launching is deferred to the next slice."
affectedPaths:
    - "src/shared/work-records/"
    - "src/extensions/cymbal/"
    - "src/ui/workspace/server/"
    - "src/ui/workspace/pages/"
    - "src/ui/workspace/components/"
    - "src/ui/workspace/islands/"
    - "docs/prd/runwield-workspace-PRD.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-07-26T20:48:25.379Z"
updatedAt: "2026-07-26T20:48:25.379Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 18
dependencies:
    - "15-attention-dashboard-and-multi-project-projections"
---

# Workspace Artifact and Cymbal Search

## Context

Personal Workspace should let the owner search eligible durable artifacts across registered Projects and perform
explicitly scoped human Cymbal code search. Search must hydrate visible results from canonical sources and enforce
privacy before subprocess launch where possible. Code Surface supervision and deep links are a separate trust seam
handled in the next slice.

## Objective

Build owner-only search capabilities so that:

- Project and Workspace artifact search use candidate indexes plus canonical hydration/access policy;
- registered Projects contribute durable artifacts by default unless opted out;
- owner-private Transcript search is available for human use only and excluded from Workspace Intelligence, Agent
  retrieval, and collaborators;
- multi-Project Cymbal code search fans out only across explicitly selected registered main checkouts;
- result sets are bounded, Project-labeled, path-sanitized, and degrade to visible partial results when one
  Project/index fails;
- ranking/grouping does not imply one global Cymbal score where none exists.

## Approach

Generalize the existing Work Record search pattern: indexes select candidates, but canonical artifact readers and access
policy determine what can be shown. Add a human-only search coordinator near `src/extensions/cymbal/` or Workspace
server services for bounded Cymbal JSON fan-out. Build browser UI for artifact/code modes, Project selection, partial
failure reporting, and grouped results. Leave code-server lifecycle and deep links for slice 19.

## Files to Modify

- `src/shared/work-records/search.js` and related artifact readers — generalize canonical hydration and access-policy
  patterns for broader Project/Workspace search.
- `src/shared/work-records/index-adapter.js` — reuse or extend index abstraction for additional artifact categories.
- `src/extensions/cymbal/index.js` or a new shared search coordinator beside it — add bounded, explicitly scoped human
  Cymbal federation while preserving current Agent tool behavior.
- `src/ui/workspace/server/` — add search APIs, Project selection enforcement, result hydration, opt-out handling, and
  partial failure reporting.
- `src/ui/workspace/pages/` — add Workspace search routes.
- `src/ui/workspace/components/` and `src/ui/workspace/islands/` — add search forms, result groups, Project filters,
  artifact/code mode distinction, empty states, and partial failure states.
- `docs/prd/runwield-workspace-PRD.md` — document search privacy boundaries and optional future Sourcebot deferral if
  needed.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/work-records/search.js` — reuse candidate-index plus canonical-hydration behavior.
- `src/shared/work-records/index-adapter.js` — reuse index abstraction where applicable.
- `src/extensions/cymbal/index.js` — reuse installed Cymbal CLI and JSON contract.
- Owner Project registry from earlier slices — determine eligible registered main checkouts and opt-outs.
- `src/ui/design-system/` — use existing Workspace form, result, badge, and panel patterns.

## Implementation Steps

- [ ] Define searchable artifact categories, default contribution behavior, Project opt-out flags, and human-only
      Transcript search boundaries.
- [ ] Implement artifact search that hydrates from canonical files and applies access policy before returning results.
- [ ] Implement Transcript search for owner human use only, with explicit exclusion from Agent retrieval and
      collaborator surfaces.
- [ ] Implement federated Cymbal search over explicitly selected registered Projects with concurrency caps, result caps,
      sanitized paths, Project labels, duplicate handling, and partial failure reporting.
- [ ] Add search UI with Project selection, artifact/code mode distinction, grouped results, transparent
      ranking/grouping, and degraded states.
- [ ] Add tests for opt-out, stale/missing index candidates, Transcript privacy, selected-Project enforcement, path
      sanitization, partial failures, duplicate labeling, and Plan worktree exclusion.

## Verification Plan

- Automated: run `deno task ci`.
- Automated: tests should verify artifact hydration, Transcript search exclusion from Agent retrieval, Cymbal fan-out
  selection, result caps, sanitized paths, partial failures, duplicate labeling, and registered-main-checkout
  enforcement.
- Manual headed browser: run `deno task workspace:dev`, search across two registered Projects, verify Project-labeled
  grouped results, inspect partial failure UI by disabling one index, and confirm results never include opted-out
  Projects or Plan worktrees.
- Expected result: owner search is useful across Projects without broadening Agent retrieval or implying a global code
  intelligence graph.

## Edge Cases & Considerations

- Independent Cymbal Project result sets do not expose comparable global scores; group by Project or apply transparent
  exact/prefix rules.
- Search privacy filtering must apply before subprocess launch where possible, not only after results return.
- Sourcebot remains optional and deferred.
- Code result deep links should remain inert or generic until the Code Surface slice adds supervised routes.
