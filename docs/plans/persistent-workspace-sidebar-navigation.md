---
planId: "2a7837a7-c3da-4ba5-b374-8f5afcfbfb50"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
affectedPaths:
    - "src/ui/workspace/layouts/WorkspaceLayout.astro"
    - "src/ui/workspace/static/workspace-shell.ts"
    - "src/ui/workspace/server.js"
    - "src/ui/workspace/islands/SessionSurface.jsx"
    - "src/ui/workspace/react/PlanReviewSurface.tsx"
    - "src/ui/workspace/react/ArtifactReadSurface.tsx"
    - "src/ui/workspace/pages/projects/index.astro"
    - "src/ui/workspace/pages/projects/[projectId]/settings.astro"
    - "src/ui/workspace/workspace-shell-navigation.test.ts"
    - "src/ui/workspace/workspace-session-ux.test.tsx"
    - "src/ui/workspace/workspace-plan-review-ux.test.tsx"
    - "src/ui/workspace/owner-workspace.test.js"
executionAgent: "frontend-engineer"
collaborationRecommendation: "pair"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-09-03T16:51:05-04:00"
status: "validated"
origin: "internal"
userVerifiedAt: null
workRecord:
    status: "generated"
    recordId: "a69e9613-2101-45c6-a899-cd89af4912d4"
    path: "docs/work-records/2026-09-05-persistent-workspace-sidebar-navigation.md"
    lastAttemptAt: "2026-09-05T03:38:41.003Z"
routingIntent: "PLANNED_CHANGE"
targetBranch: "main"
---

# Keep the Workspace Sidebar Mounted During Navigation

## Context

RunWield Workspace uses one shared visual sidebar, but each Astro page currently receives a new sidebar element. Normal
links therefore replace the complete document. `src/ui/workspace/static/workspace-shell.ts` then fetches
`/api/owner/sidebar` and rebuilds every sidebar child with `innerHTML`. Moving between Sessions, Plan Review, Plan
progress, artifacts, and Code Review causes avoidable sidebar flashes and loses transient browser state such as focus,
scroll position, expanded Projects, and expanded Session results.

The requested outcome is an application-shell experience: the left sidebar stays mounted while the right-side header and
main surface change. Sidebar data remains current without polling. A Session created in Workspace or another RunWield
surface appears after the next user-driven in-app navigation, and the selected Session changes in place.

Pairing, authentication failure, and build-unavailable fallback documents remain document boundaries. They may perform a
full page load because they do not represent normal authenticated Workspace navigation.

## Objective

- Preserve the exact Workspace sidebar DOM node across normal authenticated in-app navigation.
- Replace only the right-side header and main surface when the user opens another Session, Plan Board, Plan Review, Plan
  progress view, artifact, Code Review, Project settings page, or device page.
- Refresh sidebar data once after each completed user-driven navigation and reconcile only changed Project and Session
  rows. Do not add a polling timer.
- Preserve expanded Projects, loaded “Show more” rows, sidebar scroll, focus, and unchanged row identity.
- Keep active-Session highlighting correct on the Session page and on its nested Code Review, artifact, Plan Review, and
  Plan progress routes.

## Approach

Use Astro's existing `ClientRouter` and `transition:persist` support in `WorkspaceLayout.astro`. Persist only the owner
Workspace `<aside>`; the `.workspace-main-shell` remains the replaceable page surface.

```text
sidebar link or right-pane link
  Astro ClientRouter fetches the destination
  persisted <aside> moves into the destination document
  new .workspace-main-shell replaces the old right side
  astro:page-load
    update selected Session from the new URL
    fetch /api/owner/sidebar once
    reconcile keyed Project and Session elements in place
```

Refactor `workspace-shell.ts` into a browser module with one installation lifecycle. Use delegated click handling for
sidebar controls so inserted rows do not require complete sidebar reconstruction. On the initial load, create the
sidebar scaffold and rows. On later navigation, compare Project IDs and Session IDs, then insert, move, update, or
remove only affected elements. Preserve expanded “Show more” results unless the owning Project becomes unavailable or is
removed. If a refresh fails after the first successful load, retain the usable sidebar instead of replacing it with an
error paragraph.

Use an abort controller and monotonically increasing refresh generation. Only the response for the current navigation
may update the sidebar. This prevents a slow response for Session A from overwriting the active state after the user has
already opened Session B.

Replace full-document redirects that complete ordinary Workspace actions with Astro `navigate()`. Initialize Project
list and Project settings scripts on `astro:page-load` so they remain functional when their page enters through client
navigation. Preserve Plan Review's delayed draft by flushing it at Astro's before-navigation event as well as
`pagehide`.

The option set aside is a new top-level React single-page application shell. It would duplicate Astro routing and
require migrating every current page and island. Astro already supplies the required persistent-element and
client-navigation behavior, so that rewrite is not justified.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/ui/workspace/layouts/WorkspaceLayout.astro` — enable client navigation for the owner Workspace shell, persist the
  sidebar by a stable transition name, and keep local Plans pages outside this behavior.
- `src/ui/workspace/static/workspace-shell.ts` — own one-time shell installation, route parsing, navigation-triggered
  refresh, request race protection, keyed DOM reconciliation, delegated sidebar controls, and non-destructive refresh
  failure behavior.
- `src/ui/workspace/server.js` — keep the raw Workspace shell script compatible with module loading in owner fallback
  documents; preserve pairing/authentication/build-failure boundaries and security headers.
- `src/ui/workspace/islands/SessionSurface.jsx` — use Astro client navigation after successful Session creation so the
  new Session route does not reload the sidebar.
- `src/ui/workspace/react/PlanReviewSurface.tsx` — navigate to Plan progress without a document reload and persist a
  pending review draft before Astro replaces the review surface.
- `src/ui/workspace/react/ArtifactReadSurface.tsx` — return from an in-Workspace artifact through client navigation.
- `src/ui/workspace/pages/projects/index.astro` and `src/ui/workspace/pages/projects/[projectId]/settings.astro` — make
  page-specific event setup safe after client navigation and replace ordinary post-action reloads with right-pane
  navigation where the resulting page remains in authenticated Workspace.
- `src/ui/workspace/workspace-shell-navigation.test.ts` — add focused route-model, refresh-generation, and sidebar
  reconciliation tests, including newly detected Sessions and unchanged keyed rows.
- `src/ui/workspace/workspace-session-ux.test.tsx`, `workspace-plan-review-ux.test.tsx`, and `owner-workspace.test.js` —
  update navigation and owner-shell contracts while preserving current Session, review, and fallback behavior.

No visual redesign or new reusable visual pattern is planned. `src/ui/workspace/static/workspace.css` and
`docs/design-system.md` should remain unchanged unless implementation discovery shows that Astro's persisted element
needs a small existing-pattern compatibility fix.

## Reuse Opportunities

- Astro `ClientRouter`, `transition:persist`, `astro:before-preparation`, `astro:page-load`, and
  `astro:transitions/client.navigate()` — use the framework's supported navigation lifecycle instead of building a
  router.
- `/api/owner/sidebar` and the Project Session list endpoint — retain the current server-owned safe sidebar projection
  and “Show more” contract. Do not add a second session-data authority.
- `sessionHref()`, `newSessionHref()`, `settingsHref()`, `plansHref()`, the existing local-storage collapse state, and
  current sidebar CSS — preserve existing links and presentation.
- Existing dev owner fixtures and Workspace review fixtures — use them for deterministic headed-browser navigation
  checks without changing canonical Session data.

## Implementation Steps

- Owner pages rendered through `WorkspaceLayout.astro` contain `ClientRouter` and a uniquely named persisted Workspace
  sidebar. The incoming `.workspace-main-shell` replaces the old right side. Local Plans pages do not opt into owner
  Workspace persistence, and pairing/authentication/build-unavailable documents remain explicit reload boundaries.
- `workspace-shell.ts` installs global listeners exactly once, responds to the initial document and each
  `astro:page-load`, and performs no interval, recursive timeout, visibility timer, or other sidebar polling. Each
  completed in-app navigation requests the current sidebar projection once.
- The sidebar scaffold is created only for the initial empty state. Later refreshes reconcile Project and Session
  elements by `projectId` and `runwieldSessionId`; unchanged elements retain object identity, scroll, focus, expanded
  `<details>` state, and already loaded “Show more” rows. New Sessions enter the server-provided order, changed names
  and busy labels update in place, and removed or unavailable Projects settle without rebuilding the `<aside>`.
- Sidebar event delegation supports collapse, Project links, Session links, and newly inserted “Show more” controls
  without duplicate handlers. The current collapse/overlay behavior remains correct on desktop and narrow layouts after
  forward, back, and repeated navigation.
- Route parsing associates `/projects/:projectId/sessions/:runwieldSessionId`, its Code Review and artifact descendants,
  and Plan Review or Plan progress URLs carrying `?session=:runwieldSessionId` with the same Session. Active styling and
  the last-Session memory update immediately for the destination route, even before the sidebar refresh completes.
- Every sidebar refresh is tied to its destination URL and refresh generation. A superseded request is aborted or
  ignored. A late Session A response cannot change Session B's active row, title, or newly reconciled list.
- A first-load sidebar failure shows the existing load failure state. A later refresh failure keeps the last usable
  sidebar and does not remove navigation, expansion, focus, or scroll state.
- Successful new-Session creation in both Session creation paths uses Astro `navigate(..., { history: "replace" })` and
  lands on the stable Session URL. The page-load refresh inserts or updates that Session without remounting the sidebar.
- Plan Review's Approve & Run path and the Workspace artifact Close path use Astro client navigation. Plan Review also
  writes any pending delayed draft during `astro:before-preparation`; `pagehide` remains as the full-document fallback.
- Project registration, Project relink, enable/disable/remove, and rescan controls initialize correctly each time their
  right-side page enters through client navigation. Successful actions that remain inside authenticated Workspace use
  client navigation or an in-place data update rather than `location.reload()` or `location.assign()`.
- Focused tests prove route association, one-refresh-per-navigation scheduling, stale-response rejection, insertion of a
  newly detected Session, in-place name/status updates, stable identity for unchanged keys in the reconciliation model,
  and preservation of expanded rows. Existing review tests expect Astro navigation while retaining all current review
  outcomes.
- Existing Session operation Server-Sent Events and availability refresh behavior remain unchanged. This Plan removes
  only full-document Workspace navigation and prohibits sidebar polling; it does not change Runtime operation updates or
  Session authority.

## Approval Confirmation

No Work Record supersession is proposed. The prior Workspace Session and shared Session Sidebar records describe
capabilities that this change preserves; this Plan improves their browser navigation lifecycle rather than replacing
their outcomes.

## Verification Plan

- Automated focused tests:
  `deno run -A scripts/run-tests.js src/ui/workspace/workspace-shell-navigation.test.ts src/ui/workspace/workspace-session-ux.test.tsx src/ui/workspace/workspace-plan-review-ux.test.tsx src/ui/workspace/owner-workspace.test.js`
- Workspace gates: `deno task workspace:check`, `deno task workspace:test`, and `deno task workspace:build`.
- Repository gate after focused checks pass: `deno task ci`.
- The new automated tests must fail if navigation is changed back to `location.assign`/`location.replace`, if a stale
  sidebar response can win, if route parsing loses the Session on review/artifact routes, or if a new Session payload
  produces no insert operation. Existing Session operation live-update tests must continue to pass; no Runtime polling
  or Server-Sent Events test is expected to stop existing.
- Headed browser setup: run `deno task workspace:dev`, open
  `http://127.0.0.1:5173/projects/dev-project/sessions/choose-terraform-folder-name` with `agent-browser --headed`, and
  use a desktop viewport first.
- Before navigation, retain JavaScript references to `[data-workspace-sidebar]`, one
  `[data-sidebar-project="dev-project"]`, and one unchanged `[data-sidebar-session]`. Also record sidebar scroll,
  expanded Project state, and focused control. Follow visible links through another Session, Plan Review, Plan progress
  or artifact reading, Code Review, Project settings, and browser Back/Forward. The sidebar and unchanged-row references
  must remain strictly equal; only the right-side header/main content changes; expansion, scroll, and focus remain when
  their elements still exist.
- Use browser network inspection or a temporary page-local `fetch` counter to prove `/api/owner/sidebar` is requested
  once after each completed in-app navigation and is not requested again while the page sits idle. Rapidly select two
  Sessions and confirm the final URL, header, and active row all identify the second Session.
- For deterministic new-Session detection, make the next browser-local sidebar response contain one additional Session,
  then perform one in-app navigation. The new keyed row must appear in server order without replacing the `<aside>`, its
  Project, or a pre-existing Session row. No later request occurs until another navigation.
- Repeat the core Session-to-Session and sidebar overlay checks at a 390 x 844 viewport. The overlay opens and closes as
  before, and navigation does not leave duplicate dismiss/collapse handlers.
- Confirm no new browser console errors, failed owner requests, duplicate React-root warnings, lost Plan Review draft,
  or broken Project/settings controls after entering each page through client navigation.

## Edge Cases & Considerations

- Astro executes page scripts differently during client navigation. Page-specific setup must use the documented Astro
  lifecycle and must not add duplicate global listeners on repeated visits.
- The persisted sidebar belongs to the old document until Astro moves it. Do not read destination state during
  `astro:before-swap`; apply URL-dependent active state after the destination becomes current.
- The sidebar API returns a bounded recent Session set. Reconciliation must add new recent Sessions without discarding
  older rows that the user explicitly loaded through “Show more.” If a loaded older row is absent from the bounded
  refresh, absence alone is not proof that the Session was deleted.
- Plan Review currently relies on `pagehide` for a last draft write. Client navigation does not guarantee `pagehide`, so
  the Astro before-navigation write is required before that React island unmounts.
- Links that intentionally leave authenticated Workspace, open a new tab, revoke the current device, or enter pairing
  may still reload. External links and standalone local Plan/Code Review windows are not part of the persistent owner
  shell.
- Browser history must keep normal push behavior for links and replace behavior only after new Session creation or other
  flows that already replaced the current entry.
