---
classification: "PROJECT"
complexity: "MEDIUM"
summary: "Deferred Personal Remote Workspace capabilities beyond the v1 core loop: attention dashboard, artifact and Cymbal search, and the subordinate code-server Code Surface."
affectedPaths:
    - "src/ui/workspace/"
    - "src/shared/session/"
    - "src/shared/workflow/"
    - "src/shared/work-records/"
    - "src/extensions/cymbal/"
    - "docs/prd/runwield-workspace-prd.md"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-08-13T00:24:38-04:00"
updatedAt: "2026-08-13T00:24:38-04:00"
status: "draft"
origin: "internal"
---

# Personal Remote Workspace v2

## Context

Personal Remote Workspace v1 was cut down on 2026-08-13 to the smallest usable web surface for the core loop: see a
session, review a Plan, send Feedback, approve, and watch it run. Three draft children were removed from v1 and moved
here unchanged in substance. They are useful capabilities, but none of them is on the critical path of the core loop,
and the owner wants to use the v1 product and steer before investing in them.

Carried recommendation from v1 planning: use SQLite FTS5 as the default durable-artifact index, with canonical Markdown
hydration remaining the source of truth. Keep Typesense behind a replaceable artifact-search provider seam only if
product needs later justify another server process.

The v1 coordination and safety foundations (owner database, device pairing, Session Activation, segment projection,
rollover, Session-activated Plan actions) are complete and verified. This Epic builds on them; it does not change them.

## Objective

After the v1 Epic is complete (including its UX hardening child), deliver:

- an Attention Dashboard that replaces the plain project → session list with grouped attention across registered
  Projects;
- owner-only artifact search, human-only Transcript search, and explicitly scoped multi-Project Cymbal code search; and
- a subordinate code-server Code Surface for registered Project main checkouts, with safe deep links from search.

## Child Decomposition

1. `01-attention-dashboard-and-multi-project-projections` — rebuildable attention projections and dashboard UI.
2. `02-workspace-artifact-and-cymbal-search` — artifact/Transcript/code search with canonical hydration and privacy
   boundaries.
3. `03-subordinate-code-surface-supervision-and-deep-links` — supervised code-server integration and search deep links.

## Verification Plan

- Run `deno task ci` after each child and at Epic integration.
- Each child carries its own detailed verification plan; the children were drafted under v1 and reviewed for content
  when they were deferred.
- Re-review each child against the shipped v1 UI before executing it: the v1 hardening pass and real usage may change
  what the dashboard and navigation should look like.

## Edge Cases & Considerations

- These drafts predate real usage of the v1 UI. Treat their UI specifics as provisional; canonical-authority and privacy
  constraints in them remain binding.
- Display projections never authorize or advance work; canonical Plan Lifecycle, worktree registry, and transcripts stay
  the sources of truth.
- Search privacy and code-server trust boundaries follow the constraints recorded in each child.
