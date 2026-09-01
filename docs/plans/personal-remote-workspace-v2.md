---
classification: "PROJECT"
complexity: "MEDIUM"
affectedPaths:
    - "src/ui/workspace/"
    - "src/shared/session/"
    - "src/shared/workflow/"
    - "src/shared/work-records/"
    - "src/shared/owner-coordination/"
    - "src/cmd/load-plan/"
    - "src/plan-store.js"
    - "docs/prd/runwield-workspace-prd.md"
    - "docs/design-system.md"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-08-30T21:45:35-04:00"
status: "draft"
origin: "internal"
planId: "a342bf39-b529-49ba-909b-40e5d53d0ee7"
---

# Personal Remote Workspace v2

## Context

Personal Remote Workspace v1 delivered the owner browser loop: registered Projects, paired devices, durable Sessions,
Plan review, Feedback, approval, execution, and progress. Real use now exposes a navigation and continuity problem. The
Workspace reopens the last Session, the sidebar treats Sessions as the main objects, and loading a saved Plan continues
in a new or current Session without finding the conversation that produced it. The owner can lose planning rationale and
must inspect Projects separately to find work that needs a decision.

The v2 outcome is a Plan-centered personal Workspace. Opening Workspace answers “what needs me now?”, open Plans lead
Project navigation, Plan-associated Sessions keep their conversation context, and one in-app search finds the durable
knowledge or Session entry point the owner needs.

This Epic is for one owner. Multi-user privacy, collaborator permissions, and organization search policy are later
Workspace concerns. Full Session Transcript search, source-code search, Cymbal federation, code-server, and another Code
Surface are not part of v2.

## Objective

Deliver four connected capabilities:

1. Make the Attention Dashboard the Workspace home. It groups Plan-centered work into **Needs You**, **Ready to
   Continue**, **In Progress**, and **Recently Finished**. Needs You includes Plan review, Agent questions, human
   review, recovery, failed validation, and damaged enabled Projects. Ready to Continue includes approved Plans ready to
   run and interrupted workflows with a safe continuation. In Progress includes active Agents, execution, tests and CI,
   AI code review, repair, and delivery. Recently Finished includes verified or explicitly closed Plans from the last
   seven days, capped at ten across Workspace and five from any one Project. Deliberately On-Hold Plans and ordinary
   idle Sessions stay in navigation and search instead of appearing on the home.
2. Make Plan-to-Session continuity reliable. Open Plans appear before standalone Sessions in each Project. Loading a
   Plan resumes its one safe, idle planning Session by default when that relationship is known, and otherwise gives the
   owner an explicit choice or preserves the current fallback.
3. Provide one Spotlight-style Workspace search across Plans, PRDs, ADRs, Work Records, the RunWield Design System,
   applicable domain-language documents, Session Names, and the first user message when present. A visible global Search
   action and `Cmd+K` / `Ctrl+K` open a centered quick-search surface. Results use one flat order: exact document or
   Session Name matches first, then title and heading matches, then body and first-message matches; recency only breaks
   otherwise similar matches. Every result names its Project and content type. Focus controls narrow the same result set
   by Project or content type, and a **View all results** path opens the full search page without creating a second
   search system or regrouping the result set. Current Plans remain searchable while they are in the normal Plan store,
   including On-Hold and terminal Plans; Archived Plans are excluded because they are temporary staging and duplicate
   Work Record history. Quick search includes current approved Work Records but excludes Superseded and Archived Work
   Records. All PRDs, ADRs, cataloged Session Names, and available first user messages remain eligible. A later
   full-page historical filter can expose non-current Work Records if use proves it necessary.
4. Let each loaded Session tab notify the owner when its Agent stops and needs attention, matching the purpose of
   terminal notifications when several TUIs are working at once. A visible Session tab uses its in-app state; a
   backgrounded Session tab can show one browser system notification after explicit user permission. Clicking the
   notification focuses that exact Session tab. V2 does not promise delivery for a Session with no loaded browser tab.

Workspace remains able to advance work. Session messages, Plan review decisions, approval, execution, and recovery use
the existing Core-owned operations and current evidence checks. The Dashboard is a springboard: each row opens the Plan,
review, Session interaction, or Project surface that owns the action instead of duplicating action controls on the home
screen. Search summaries likewise open the owning destination. These summaries help the owner find the right action;
they do not become a second copy of Plan, Session, or worktree state.

The main option not taken is separate Dashboard and search Epics. That would isolate delivery but duplicate the
cross-Project discovery, navigation, failure handling, and shell work. With code search and Code Surface scope removed,
one v2 Epic is coherent and remains suitable for later decomposition into a small number of executable Plans. The other
option not taken is code search without an actionable code workflow. It would stop at a file match and add indexing and
interface cost before the owner can inspect, edit, or deliberately send that code into a Session.

## Vertical Slice Findings

The shipped owner Workspace already has most workflow evidence needed by the Dashboard:

```text
GET /api/owner/sidebar
  listOwnerProjects
  WorkspaceSessionContinuationService.listSessions
  FileSessionStore.listProjectSessions
```

Session files and verified transcript prefixes own Session identity, activation, committed generations, and persisted
attention events. The existing server-side Plan workflow summary already joins the authorities needed to explain planned
work:

```text
loadOwnerPlanProgress
  findPlanEvidenceById
  findByPlanId
  load execution-worktree Plan when present
  load controller validation and delivery evidence
```

The new cross-Project view must compose these existing readers instead of copying lifecycle logic. Today the sidebar
uses one all-or-nothing `Promise.all`; one damaged Project can fail the full response. Dashboard and search must instead
return successful Project groups plus a visible failure for each Project that could not be read.

The separate `/projects/:projectId/plans/:planId/progress` page is implementation drift from the v1 design. The approved
v1 flow made the associated Session timeline the progress surface and called for workflow state beside that timeline; it
explicitly did not require a dedicated progress page. V2 removes the standalone page and its links while preserving the
server-side workflow summary used by the Dashboard and existing Session presentation. A richer Session sidebar that
matches the TUI verification card can be designed later; it is not a reason to keep the duplicate page.

Current Plan continuation loses conversation context:

```text
wld load-plan <plan>
  start or use current Session
  read Plan
  send synthetic resume request to Planner or Architect
```

The Session records only a mutable `planName`; the Plan does not point back to a Session. A Plan can legitimately have
more than one Session, so v2 must record durable `planId` association in committed Session evidence and derive the
reverse lookup from Sessions. It must not add one owner Session field to Plan Front Matter.

The target relationship and dependency direction are:

```mermaid
graph TD
    Files[Plans, docs, Session files] --> Readers[Canonical readers]
    Readers --> Index[Rebuildable Workspace projections]
    Index --> Dashboard[Attention Dashboard]
    Index --> Search[Unified search]
    Dashboard --> Surface[Plan or Session surface]
    Search --> Surface
    Surface --> Core[Core workflow operations]
    Core --> Files
```

The index is disposable display and retrieval state. SQLite full-text search (FTS5) fits the existing local stack and
avoids another service, but its tables must be separable from owner coordination authority so index loss or corruption
can be rebuilt without affecting Project registration, paired devices, Sessions, Plans, or workflow state. Workspace
startup never waits for indexing. Existing results remain available while a lightweight background scan detects manual
repository edits, and RunWield-owned Plan, Work Record, documentation, Session Name, and first-message changes request a
prompt incremental refresh. Search candidates are rechecked against canonical files before navigation or action. One
failed Project reports stale or unavailable search while healthy Projects continue, and the owner can request a visible
refresh.

Session Runtime already emits live `attention_requested` events for `agentStopped`, and the TUI turns those events into
terminal notifications. That live event alone is insufficient for Workspace because a TUI-owned Session runs in another
process and a browser can refresh after the event. V2 commits a stable attention identity with the Session generation
and records or derives when the owner responds. Each loaded Session screen observes only its stable Session attention
feed, uses the stable event ID for browser-wide deduplication, and owns notification click behavior that focuses its
existing tab. If the same Session is open twice, one tab notifies and becomes the focus target. Different Session tabs
can notify independently, like separate TUIs. Notification delivery never becomes workflow state.

## Expected Change Surface

- `src/ui/workspace/layouts/WorkspaceLayout.astro` and `src/ui/workspace/static/workspace-shell.ts` — make Dashboard and
  Search stable top navigation actions, remove last-Session home redirection, register the global search shortcut, and
  render Plan-first Project navigation. Each Project initially shows at most five nonterminal Plans ordered by Needs
  You, Ready to Continue, In Progress, then latest update; muted On-Hold Plans follow active work. Each Plan shows at
  most two associated Sessions, standalone Sessions follow by latest activity, and **Show more** expands the lists in
  place. The Project sidebar does not use a Plan Board link as its overflow path.
- `src/ui/workspace/pages/`, `components/`, `islands/`, and `react/` — add the responsive Attention Dashboard and
  unified search experience using the RunWield Design System; adapt the existing read-only artifact surface so PRDs,
  ADRs, design-system documents, and domain-language documents have one consistent Workspace destination; remove the
  standalone Plan Progress page and links without removing the shared workflow-state data used elsewhere.
- `src/ui/workspace/server/`, `routes/owner-api.js`, and owner server composition — compose cross-Project attention,
  Plan-to-Session, and search results; isolate per-Project failures; route selected results to stable Plan, Session, or
  artifact views; and expose authenticated stable-Session attention reads for loaded Session screens.
- `src/shared/session/file-session-store.ts`, `workflow-context-session.js`, runtime event handling, and transcript
  projection modules — record and read durable Plan identity and association purpose; commit stable `agentStopped`
  attention and response evidence; and keep Session files authoritative rather than a Workspace database.
- `src/shared/workflow/` and `src/ui/workspace/server/owner-plan-progress.ts` — retain one server-side Plan workflow
  interpretation for Dashboard categories and Session presentation rather than implementing another lifecycle mapping in
  the browser; this data service does not require a standalone Plan Progress page.
- `src/cmd/load-plan/` and Session resume surfaces — find Plan-associated Sessions by durable Plan ID and support safe
  resume-or-current-Session behavior across TUI and Workspace.
- `src/plan-store.js` — provide canonical Plan identity and authority-aware hydration needed by navigation and search,
  including the execution-worktree Plan when it is authoritative.
- `src/shared/work-records/` and new focused artifact readers beside the owning modules — reuse canonical hydration for
  search candidates without turning the Work Record index adapter into a false general-purpose artifact service.
- `src/shared/owner-coordination/` and a separate rebuildable Workspace search store — expose registered Project scope
  to projections without mixing index state into registration, device, or operation-receipt authority; support
  non-blocking startup, incremental refresh requests, bounded background change scans, per-Project freshness, and manual
  refresh.
- `docs/prd/runwield-workspace-prd.md` — move code search and Code Surface claims out of the personal v2 milestone and
  record the settled Plan-centered navigation and focused search scope.
- `docs/design-system.md` — document only reusable Dashboard, search, or nested Plan/Session navigation patterns that
  are not already covered by existing Workspace and review components.

## Reuse Opportunities

- `src/ui/workspace/server/owner-projects.js` — registered-root eligibility and browser-safe Project projection.
- `src/ui/workspace/server/session-continuation.js` and `src/shared/session/session-transcript-manifest.ts` — stable
  Session listing and verified committed transcript reads.
- `src/shared/session/session-transcript-projection.js#summarizeProjectedEntries` — persisted workflow and attention
  facts; extend the durable Plan identity rather than adding a second Session summary format.
- `src/ui/workspace/server/owner-plan-progress.ts#loadOwnerPlanProgress` — reuse its joined Plan, controller, worktree,
  validation, delivery, and optional Session evidence as a server-side summary; do not preserve the separate page merely
  because this reader already exists.
- `src/ui/workspace/server/plan-adapter.js` and `src/plan-store.js` — canonical Plan listing, identity, and detail
  reads.
- `src/shared/work-records/search.js` — candidate selection followed by canonical Markdown hydration; reuse the rule,
  not the Work Record-specific adapter as a generic abstraction.
- `src/ui/workspace/react/ArtifactReadSurface.tsx` and its current Plan and Work Record routes — extend the existing
  read-only document presentation to the additional searchable documentation types rather than building type-specific
  viewers.
- `src/ui/tui/system-notifications.ts` and `RuntimeEventTypes.ATTENTION_REQUESTED` — reuse the existing `agentStopped`
  meaning and user-facing message while giving the browser its own delivery mechanism and permission behavior.
- `src/ui/design-system/` and the current Session, Plan Review, and Code Review surfaces — shared tokens, compact rows,
  status labels, focus behavior, and responsive shell patterns.

## Verification Plan

- Automated integration: after all outcomes land, run
  `deno run -A scripts/run-tests.js src/ui/workspace/personal-remote-workspace-v2.acceptance.test.ts src/cmd/load-plan/plan-session-continuity.integration.test.ts`.
  The first suite must use real registered Project fixtures, canonical Plan/controller/worktree readers, file-backed
  Sessions, the rebuildable search store, and per-Project failure injection; fixture-only React ordering is
  insufficient. It must mutate committed Plan, controller, worktree, and Session-attention evidence after the first
  Dashboard read and prove the next loaded projection changes category without process restart or manual cache clearing.
  It must also change an eligible documentation file externally and prove the background scan updates search without
  manual refresh.
- Automated browser behavior: run
  `deno run -A scripts/run-tests.js src/ui/workspace/session-tab-notifications.browser.test.ts`. The suite must use two
  different Session tabs plus duplicate tabs for one Session and observe notification claim, exact-tab focus, response
  clearing, refresh, and reconnect behavior; component markup assertions are insufficient.
- Automated regression: run `deno task workspace:check`, `deno task seams:check`, and `deno task ci` at Epic
  integration.
- Manual browser: run `deno task workspace:dev` for visual and responsive fixtures, then verify the real paired owner
  server because the development catalog does not exercise registration, Session locks, or cross-Project filesystem
  reads.
- Manual journey: use at least two registered Projects containing same-named Plans, an active Plan, a Plan needing
  review, an approved Plan, a recently finished Plan, an On-Hold Plan, a standalone idle Session, a standalone Session
  needing attention, a Project read failure, and searchable artifacts of every supported type. While the owner server
  stays running, change workflow evidence after the Dashboard first renders and verify its category updates. Mutate and
  remove indexed files externally, verify eligible edits appear within the default scan interval without manual refresh,
  then restart the server and verify stale candidates still cannot masquerade as current results.
- Manual continuity: leave a planning Session, load its Plan from a fresh empty Session and from a non-empty unrelated
  Session, and attempt the same while the original is active elsewhere. Verify stable Session identity, original
  context, user choice, and Session Writer Lock behavior rather than copied transcript display.
- Expected result: the owner can open Workspace, identify the next required decision, return to its Plan and original
  planning context, advance work through existing Workspace actions, and find known project knowledge without browsing
  each Project separately.

### Outcome Evidence

- **Attention-first home** — `/` renders the Dashboard and no client code replaces it with the last Session route;
  direct Session URLs still open their Session.
- **Plan-centered Dashboard** — each Plan appears once in the highest applicable category, with precedence Needs You,
  Ready to Continue, In Progress, then Recently Finished. Integration fixtures prove expected categories from real Plan
  status, controller checkpoint, worktree/publication evidence, live Workspace interactions, and committed Session
  attention rather than agreement with another derived label. Recently Finished contains no item older than seven days,
  no more than ten items total, and no more than five from one Project. Every Dashboard load validates projection source
  revisions against current evidence; a loaded Dashboard reflects a committed workflow or attention transition within
  five seconds without restart or manual cache clearing. A Session with no proven Plan association appears only when it
  has unresolved attention or is actively running; an ordinary idle Session is absent. Rows are navigation links to the
  owning Plan, review, Session interaction, or Project surface and expose no duplicate approval, run, resume, recovery,
  or message mutation endpoint.
- **Failure isolation** — a real unreadable root, invalid Plan identity, damaged Session projection, or failed Project
  index produces a Project-specific diagnostic tied to that failed reader while healthy Projects still render Dashboard,
  sidebar, and search results. A generic catch-all degraded card with no source evidence does not satisfy this outcome.
- **Plan-first Project navigation** — each enabled Project initially renders at most five nonterminal Plans before
  standalone Sessions, ordered by Needs You, Ready to Continue, In Progress, then latest update, with muted On-Hold
  Plans after active work. At most two associated Sessions nest under each Plan, uncertain associations are not guessed,
  terminal Plans do not fill the sidebar, and standalone Sessions sort by latest committed activity. **Show more**
  expands additional Plans or Sessions in place; no Plan Board link is used as sidebar overflow.
- **Durable Plan-to-Session continuity** — production planning, review, execution, and recovery paths commit Session
  evidence containing durable `planId`, stable Session ID, association purpose, and committed generation context.
  Reverse lookup verifies that Plan ID inside the same registered Project and can return zero, one, or several Sessions.
  Mutable `planName`, copied display metadata, or a Plan Front Matter owner-Session field cannot establish the
  relationship.
- **Safe Plan resume** — loading a Plan with exactly one idle associated planning Session keeps the original
  `runwieldSessionId`, acquires that Session's Writer Lock, and restores its committed model context; it does not create
  a replacement Session or copy transcript text into a new runtime. Multiple matches require selection, an active match
  explains its current surface without takeover, and no match retains the current Plan-only continuation behavior.
  Loading from a non-empty unrelated Session does not replace it without a user choice.
- **Unified focused search** — quick and full search call the same search service with the same query and filter model;
  **View all results** preserves query, order, and filters. Adversarial ranking fixtures prove exact names outrank
  heading matches, headings outrank body or first-message matches, and recency cannot outrank a stronger text match.
  Every result carries canonical Project ID, content type, source identity, and browser-safe destination. Current Plans
  in the normal Plan store are included even when On-Hold or terminal; Archived Plans are absent. Current approved Work
  Records are included; Superseded and Archived Work Records are absent. PRDs come only from the registered Project's
  `docs/prd/`, ADRs only from `docs/adr/`, design-system content only from `docs/design-system.md`, domain language only
  from the applicable canonical glossary, and Sessions only from the file-backed Project catalog. Full Session messages
  after the first user message, arbitrary Markdown, tool output, reasoning, source code, and Plan-worktree code are
  absent.
- **Canonical hydration and freshness** — each index row stores canonical source identity plus a source revision or
  fingerprint. Query hydration rechecks Project eligibility, accepted path, identity, and current source evidence before
  display or navigation; path existence alone is insufficient. Deleting and rebuilding the index preserves result
  identity from canonical sources. Workspace startup and healthy Projects remain usable while an index builds or one
  Project fails. RunWield writes invalidate their source before the write reports completion. A background scan limited
  to eligible artifact paths detects manual edits without user action within one configured interval, whose default is
  at most 30 seconds; manual refresh forces an earlier scan. Freshness labels derive from stored versus observed
  evidence, not timers. PRD, ADR, design-system, and domain-language results open through type-aware canonical readers
  in the shared read-only artifact surface without being parsed as Plans or starting a Session.
- **Session-tab notification** — a production transcript writer commits `runwield.attention` with stable event ID,
  reason, Session identity, and generation before `agentStopped` becomes eligible. A later committed user response or
  interaction result makes that event resolved. A visible Session tab uses only the in-app signal; a loaded but
  backgrounded Session tab with granted permission emits one browser notification whose click focuses that exact tab. A
  headed multi-tab browser check proves different Sessions notify independently and duplicate tabs for one Session use
  one browser-wide claim for the event ID and one focus target. Refresh, reconnect, repeated observation, and server
  restart do not notify again. Permission denial or unsupported APIs leave in-app attention working without repeated
  prompts. With no loaded tab for that Session, no browser notification is promised and the durable Needs You item
  appears on the Dashboard when Workspace is next viewed.
- **No duplicate Plan Progress screen** — the `/projects/:projectId/plans/:planId/progress` route,
  `PlanProgressSurface`, and **Open progress** or **View progress** links no longer exist, and no renamed standalone
  route presents the same execution-stage list. The server-side workflow summary remains available only as data consumed
  by the Dashboard, Plan summary, and Session presentation; the associated Session is the destination for live execution
  and validation progress.
- **Workspace action authority preserved** — Dashboard and search APIs expose reads and destinations only. No Dashboard,
  search, index, notification, or association-projection endpoint can submit messages or lifecycle events. Destination
  flows continue through existing Session Runtime and Plan action paths, with regression coverage for Session Writer
  Lock, Plan revision/status, controller, worktree, review, approval, execution, and recovery checks.

Existing behavior that must remain protected: paired-device owner access, registered Project root checks, Session Writer
Lock enforcement, committed-generation synchronization, Session messaging, Plan review and Feedback, Approve for Later,
Approve & Run, execution and repair segment handoff, Plan Recovery, action-time Plan/worktree checks, local Plan Board
behavior, direct Plan or Session URLs, and Session composer `@` references to Project files.

Behavior expected to stop existing: automatic last-Session redirection from `/`; Session-only Project navigation; Plan
continuation that cannot discover a known original planning Session; Plan association based only on mutable `planName`;
all-or-nothing cross-Project sidebar failure; the standalone Plan Progress page and its links; and the old v2 promise to
add Cymbal search or code-server.

## Edge Cases & Considerations

- A Plan can have zero, one, or several associated Sessions. Association is historical committed evidence, not exclusive
  ownership and not permission to mutate the Plan.
- An associated Session active in another surface is expected to be rare. Workspace explains the active surface and does
  not create a competing writer.
- Planning, execution, repair, and follow-up can have different Session roles. Resuming planning context must not route
  a normal prompt to an execution worktree or execution Agent without current workflow evidence.
- Legacy Sessions contain only `planName` or no association. Name-only matches may be shown as uncertain migration hints
  but must not trigger automatic resume or nesting.
- A Session can produce more than one Plan. The association model must not require one Plan per Session or duplicate the
  same Session as if it had several independent histories.
- Plans can move to execution worktrees after execution starts. Search and Dashboard must use the same authority choice
  as the server-side Plan workflow summary, while Session and documentation search remain rooted in registered Project
  evidence.
- A Session started through Plan loading may have no original user message. Its searchable entry is the Session Name.
- Search indexing is rebuildable and bounded. Startup never waits for it. RunWield writes request incremental refresh. A
  lightweight scan of eligible artifact paths detects manual edits without user action within a configurable interval
  that defaults to at most 30 seconds; the visible refresh action forces an earlier scan. One changed or malformed
  Project produces freshness diagnostics without blocking normal Session and Plan operations or removing healthy Project
  results.
- Recently Finished includes only the latest ten eligible Plans across Workspace and no more than five from one Project,
  all from the prior seven days. Older terminal work remains available through search and Plan Board.
- The sidebar must stay compact on desktop and collapse to the established drawer behavior on narrow screens. Search
  remains discoverable through a visible action when keyboard shortcuts are unavailable. The Attention Dashboard and
  human gates remain phone-usable; dense Plan management and full search results can continue to use focused views.
- Archived Plans are temporary staging and do not enter search. Superseded and Archived Work Records stay out of quick
  search; a later full-page historical filter can expose them without changing the default result set.
- Browser notification permission must follow a user action and remains local to that browser. Notification delivery is
  best effort and cannot authorize, acknowledge, or resolve workflow work.
- V2 notifies only for `agentStopped`. Plan-review and interaction notification policy can follow observed use without
  broadening the first delivery contract.
- No loaded tab for the affected Session means no notification in v2. A Dashboard or unrelated Session tab does not
  impersonate the missing Session tab merely because Workspace is open. Service workers, Web Push subscriptions, native
  host alerts, and other closed-tab delivery mechanisms are later work.
- Multi-user privacy, collaborator search rules, source-code handoff, Cymbal federation, and a confined Code Surface
  need later product and architecture decisions rather than dormant provider seams in v2.
