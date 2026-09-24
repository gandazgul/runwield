---
planId: "5131a0bd-1133-45ac-8c49-fd305a27f3df"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/ui/workspace/components/OwnerDashboard.astro"
    - "src/ui/workspace/server/owner-dashboard.ts"
    - "src/ui/workspace/routes/owner-api.js"
    - "src/ui/workspace/server.js"
    - "src/ui/workspace/static/workspace-styles/owner-pages.css"
    - "src/ui/workspace/personal-remote-workspace-v2.acceptance.test.ts"
    - "docs/prd/runwield-workspace-prd.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:build && deno run -A src/cli.ts workspace serve --bind 127.0.0.1 --port 8789 --no-open"
devServerUrl: "http://127.0.0.1:8789"
devServerHmr: false
createdAt: "2026-09-24"
origin: "internal"
userVerifiedAt: null
status: "in_progress"
targetBranch: "main"
---

# Progressive Dashboard Loading

## Context

The owner reports that the Attention Dashboard takes too long to load. They want the page immediately, with cards that
load independently as data arrives, plus improvements to actual load time. They confirmed that verified partial rows
should appear while other Projects load. Loading, empty, and error states must be clearly different.

`OwnerDashboard.astro` initially renders an empty grid and a global loading message. It waits for one complete
`/api/owner/dashboard` response before rendering four sections. `readOwnerDashboard` processes Projects sequentially;
`projectPayload` waits for Plan, Session, readiness, live-connection, and registry evidence before returning. Concurrent
dashboard/sidebar calls already share an in-progress read, and later reads are fresh.

[Workspace: Attention dashboard](../prd/runwield-workspace-prd.md#attention-dashboard) owns this behavior. Extend
**Bound navigation reads and share concurrent refreshes** and add a named requirement for immediate cards and
progressive results. Preserve **Surface the owner’s next consequential action**, classification rules, five-row
defaults, sort/expansion preferences, current evidence, and independent sidebar navigation. No requirements are removed.
These additions are proposed, not delivered.

## Objective

Render the dashboard shell and all four card headings before data completes. Each card displays verified rows without
waiting for unrelated work, including unrelated checks within one Project. Distinguish pending, successful empty,
partial failure, and refresh failure. Measure and reduce the slow read path without weakening workflow checks or
retaining a stale server cache.

## Approach

Use the existing Astro/React stack: render each section as a small independently updating island with server-rendered
loading markup. Share a browser request coordinator across the four islands. Do not give each card its own full
dashboard scan.

```text
OwnerDashboard.astro: immediate headings and loading states
  four section islands: local sort, expansion, and status
    shared browser coordinator: one finite fetch stream per refresh
      owner dashboard reader: shared preparation and verified updates
        complete JSON result: retained for existing dashboard/sidebar callers
```

Add an authenticated finite stream route, `/api/owner/dashboard/stream`, using newline-delimited JSON. The existing JSON
route remains compatible. Both routes and the sidebar share one in-progress server read. Stream section snapshots with
stable keys and explicit progress, diagnostics, and completion information. Reuse current in-progress sharing rather
than adding a persistent cache or a separate job system. This transport choice is a reviewable implementation
assumption.

Replace the all-results barrier with bounded concurrent Project reads and evidence-driven updates within each Project.
Shared preparation may still be necessary. Publish a row only after the evidence needed for its final classification has
been checked. A known live question can precede unrelated readiness checks; a row must not be labeled Ready using only
Plan front matter. Preserve classification precedence and deduplicate rows by stable identity. Completed sections do not
wait for unrelated section work.

A shared stream is slightly more client code than four requests, but avoids duplicate scans and permits incremental
results. Four wrappers around the current complete-result Promise would not achieve the objective. No worker service,
storage migration, workflow-rule change, or general dashboard redesign is planned.

### Card states

| Condition                          | Required display                                                        |
| ---------------------------------- | ----------------------------------------------------------------------- |
| Initial read pending               | Heading and explicit Loading state; no zero count or empty message      |
| Verified rows, more checks pending | Usable rows, loading indication, and visibly incomplete count           |
| Successful complete read, no rows  | Quiet empty message; no loading or error treatment                      |
| Failed checks, no rows             | Error text and Retry; never “Nothing here”                              |
| Failed checks, some rows           | Keep verified rows; explain that results are incomplete and offer Retry |
| Background refresh                 | Keep current rows with a small Updating indicator; do not blank cards   |
| Failed background refresh          | Keep prior rows, identify them as not updated, and show Retry           |

Errors use text and existing error/warning styling, not color alone. Pending work and failed work remain distinguishable
when both occur. Diagnostic links stay outside the attention queue. A successful retry removes obsolete rows and errors.
Keep layout, section order, row links, timestamps, and Needs You emphasis.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/ui/workspace/components/OwnerDashboard.astro` and new section islands/browser coordinator under
  `src/ui/workspace/` — immediate markup, independent card updates, one refresh lifecycle, and accessible states.
- `src/ui/workspace/server/owner-dashboard.ts` — progressive producer, bounded scheduling, shared evidence,
  complete-result compatibility, and request-scoped cleanup.
- `src/ui/workspace/routes/owner-api.js` and `server.js` — authenticated finite stream route with current owner security
  headers and sanitized payloads.
- `src/ui/workspace/server/plan-adapter.js`, `src/shared/workflow/plan-actions.ts`, `src/shared/worktree-registry.js`,
  and `src/plan-store.js` — bounded optimization candidates only where profiling confirms repeated work. Keep authority
  and integrity checks in their existing owners.
- `src/ui/workspace/static/workspace-styles/owner-pages.css` — state presentation using existing `--rw-*` tokens. Extend
  shared design-system components and `docs/design-system.md` only if an existing pattern cannot express the required
  state.
- Dashboard acceptance tests, new `owner-dashboard-loading.test.tsx`, and a focused stream integration test — prove
  immediate rendering, progressive backend delivery, state distinctions, and refresh safety.
- `docs/prd/runwield-workspace-prd.md#attention-dashboard` — synchronize requirements and acceptance scenarios. This
  file has pre-existing edits; preserve them.

No domain term is introduced. Session storage, sidebar information architecture, and workflow transitions remain
unchanged.

## Reuse Opportunities

- `loadOwnerDashboard`, `classifyPlan`, `dashboardItem`, `operationItem`, and `completionTime` — preserve canonical
  dashboard classification and presentation.
- `withProjectRuntimeReadScope` — verify runtime layout once per checkout per active read, including the full stream
  producer lifetime; verify again on later reads.
- `loadPlanSummaries` — evaluate as a smaller alternative to `loadBoard`; confirm identical required Plan evidence
  before substitution.
- `refreshSidebarForPage` in `static/workspace-shell.ts` — follow its independent loading, generation guards, and
  navigation cleanup without changing its behavior.
- `ownerSessionOperationStreamApi` and `ownerNotificationsStreamApi` — existing response security and subscription
  cleanup patterns.
- Existing dashboard CSS, toolbar controls, thinking dots, and theme bridge — preserve established visual language.

## Implementation Steps

1. A repeatable baseline records initial document time, four-card visibility, first verified row, full completion,
   request count, and server read costs on the current dashboard. Use diagnose-style measurement before optimizing.
   Include a large single Project and multiple Projects, record dataset sizes and cold/warm runs, and distinguish
   measured causes from candidates. Candidate costs include repeated readiness Plan scans, registry reads per Plan,
   unnecessary board construction, sequential Projects, and live socket waits. Do not claim historical memory timings as
   a current baseline.

2. `owner-dashboard.ts` provides incremental verified section updates and the existing complete `loadOwnerDashboard`
   result from one in-progress read. Independent Projects and unrelated evidence checks do not block available rows.
   In-progress joiners receive the latest safe state and subsequent updates. Section completion accounts for all
   evidence that can affect that section; successful empty is impossible while relevant checks are pending or failed.
   The final aggregation preserves current category precedence, sorting, recent-completion filtering, and eligible
   items. Runtime read scope covers the complete producer lifetime; settled evidence is not reused by a later refresh.

3. The stream route returns and flushes updates before complete aggregation. It has owner authentication, no-cache
   response handling, current security headers, and local-path redaction for every frame. Completion is explicit;
   premature EOF is a failed read, not a successful empty result. A disconnected subscriber is removed without canceling
   other dashboard/sidebar consumers. Listener state is released on finish, error, or cancellation. JSON callers retain
   their existing contract and in-progress Promise sharing.

4. `OwnerDashboard.astro` and its section islands implement every state in the table. Initial HTML contains all four
   headings and loading states, without waiting for data or client hydration. Independent section updates preserve other
   cards, focus, scroll, sort, and expansion. A shared coordinator handles stream chunk boundaries, duplicate/stale
   updates, Retry, and Astro navigation teardown. Refresh merges retain prior rows until replacement evidence is
   available, then remove obsolete rows on successful completion. Failed reads cannot silently promote prior rows to
   current evidence. First-load failure affects only dependent content; a request-wide failure marks all unfinished
   cards as failed.

5. Refresh scheduling permits one request at a time, leaves five seconds after settlement before the next automatic
   refresh, pauses scheduling while the document is hidden, and refreshes once when visible again. Retry uses the same
   coordinator. Navigation aborts the browser subscription and rejects old updates. This is a load-reduction assumption
   for review; it preserves automatic freshness while avoiding continuous scans when a read lasts longer than five
   seconds.

6. The measured slow path performs less work or finishes faster, with matched before/after results and a regression
   check for the specific repeated work removed. At least one measured backend bottleneck is addressed, not only hidden
   behind placeholders. Use bounded concurrency and read-local reuse where justified. If batching Plan/registry evidence
   is needed, the owning readers retain duplicate-ID detection, worktree authority, integrity checks, and fresh
   subsequent reads; no status-only shortcut, persistent cache, or test-only injection seam is added. Record remaining
   measured costs without expanding this into a storage redesign.

7. Automated and browser checks below prove the new behavior. The owning Workspace PRD requirements and scenarios
   describe the delivered immediate/progressive states and read bounds in the same change. Preserve other target
   requirements as targets. Existing dirty Session UI and PRD work is not overwritten.

## Approval Confirmation

No Work Record supersession is proposed. The owner confirmed partial verified results and explicitly required distinct
loading, empty, and error states. Stream transport, state copy, and completion-based visible-tab refresh scheduling are
reviewable implementation assumptions.

## Verification Plan

- Run
  `deno run -A scripts/run-tests.js src/ui/workspace/owner-dashboard-loading.test.tsx src/ui/workspace/owner-dashboard-stream.test.ts src/ui/workspace/personal-remote-workspace-v2.acceptance.test.ts src/ui/workspace/workspace-shell-navigation.test.ts src/ui/workspace/owner-workspace.test.js src/ui/workspace/workspace-pwa.test.js src/shared/project-runtime-read-scope.test.ts`.
- **Initial HTML and UI behavior:** before resolving any browser data response, assert four visible headings and loading
  states. Deliver one section update and keep another pending; assert only the available section displays usable rows.
  Complete an empty section, fail another, and check distinct text and accessible state. Test partial error, failed
  refresh with retained rows, Retry recovery, stale response rejection, sort/expansion, keyboard focus, hidden-tab
  scheduling, and navigation cancellation. Execute the actual component/coordinator, not source-text assertions.
- **Real producer progress:** use real registered Project/Plan/Session fixtures and hold an external live-connection
  response open. Through the real authenticated stream route, assert a verified row arrives before release, first across
  two Projects and then within one Project with unrelated work. Put the blocked Project first in the returned Project
  order; the later Project must still produce rows. A delayed response can be controlled at the socket/network boundary;
  do not inject a fake dashboard producer or owned Plan reader. The single-Project test must fail if updates occur only
  after `projectPayload` finishes. The two-Project test must fail if all Project reads remain serial or frames are
  buffered until completion. Use bounded test timeouts so a blocked producer fails rather than hangs.
- **Final correctness and freshness:** compare the final stream state with expected fixture items and the complete JSON
  result. Concurrent stream/JSON/sidebar reads share preparation. Test runtime read-scope reuse while production
  continues after the stream HTTP response is returned; do not rely only on existing scope unit tests. A later refresh
  reflects a changed Plan/Session and reruns runtime verification. Test a late subscriber, disconnect with another
  subscriber active, partial Project failure, zero Projects, and EOF without completion. No partial frame exposes local
  paths; unauthenticated stream access is rejected.
- Preserve coverage for live versus historical attention, active versus stopped Sessions, invalid readiness/worktree
  evidence, retained completion proof, timestamps, all items for expansion, and independent sidebar loading. Only the
  global loading gate and fixed hidden-tab polling cease to exist; replace tests asserting those mechanisms with
  behavioral coverage rather than deleting their intent.
- If action evidence or registry readers change, run their focused tests, including
  `deno run -A scripts/run-tests.js src/shared/workflow/plan-action-evidence.test.ts src/shared/workflow/plan-location.integration.test.ts src/ui/workspace/owner-plan-actions.test.ts`,
  plus tests adjacent to the changed reader. Confirm optimizations preserve refusal and authority rules.
- **Headed browser:** use the worktree-owned server command above and an isolated named
  `agent-browser --headed --session dashboard-loading-<worktree-id>` session at `http://127.0.0.1:8789/`. Pair through
  the normal local flow; use a free port if occupied and record it. Do not restart an unrelated server. Verify the real
  owner dashboard, not only `/dev`. Check desktop 1440×1000 and mobile 390×844. Observe initial cards under delayed
  data, a populated card alongside a pending card, successful empty, partial error, refresh error, and Retry. Open a
  row, navigate back, reverse sort, expand a section, and keep a control focused through updates. Capture screenshots
  and console/network evidence. A fake browser response proves UI states only, not backend progress.
- **Performance evidence:** repeat matched baseline measurements at least five times per dataset after the change.
  Report median and range for first card, first row, and full completion, plus request/read counts and retained item
  counts. Identify the measured backend reduction and show that it does not hide dropped rows or failed checks. Check
  response delivery through the normal Workspace access path to catch proxy buffering. No arbitrary millisecond promise
  is introduced.
- Run `deno task workspace:build` to verify island packaging and inspect synchronized PRD/design-system updates. Full CI
  is handled by the delivery workflow.

## Edge Cases & Considerations

- All Projects failing is an error, not an empty dashboard. A disabled Project is not a failed enabled Project.
- Live interactions outrank readiness and completion where current classification requires it. Do not publish a
  speculative category to make progress appear faster.
- Synchronous filesystem work can still block the event loop. Concurrency alone is not evidence of reduced load time;
  profile actual costs.
- New snapshot application must not duplicate rows, drop unchanged Projects during refresh, or retain removed rows after
  a successful refresh.
- Browser loading state is display state only. It must not change Plan actions, Session ownership, or workflow
  authority.
- No persistent server cache is proposed. Brief in-progress snapshots exist only to share the current read.
