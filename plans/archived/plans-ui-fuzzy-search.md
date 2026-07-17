---
planId: "15e9ec2e-3341-460b-90cf-16a1f161c97f"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add a search input to the Plans UI to filter plans by title and summary using fuzzy search (suggested fuse.js). This involves updating the board route/component to handle the search state and filtering the plans displayed in the columns."
affectedPaths:
    - "src/ui/workspace/routes/board.jsx"
    - "src/ui/workspace/components/Board.jsx"
    - "src/ui/workspace/components/BoardColumn.jsx"
    - "src/ui/workspace/components/PlanCard.jsx"
frontend: true
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://localhost:5173"
devServerHmr: true
createdAt: "2026-06-30T22:42:43-04:00"
updatedAt: "2026-07-17T04:49:38.333Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-07-01T13:37:36.731Z"
workRecord:
    status: "generated"
    recordId: "d4c56015-375f-4e21-aaa6-0f750a80849f"
    path: "docs/work-records/2026-07-17-added-fuzzy-search-to-the-plans-ui.md"
    lastAttemptAt: "2026-07-17T04:49:30.339Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
routingIntent: "FEATURE"
sessionName: "plans UI fuzzy search filter"
---

# Add Fuzzy Search to Plans UI

## Context

The Plans Workspace currently renders Active, Closed, and On Hold board screens with status columns and plan cards.
Users can scan cards by status, but there is no quick way to narrow the board when a checkout has several plans. The
requested feature is a simple search input that filters plans by title and summary with fuzzy matching. The product
intent is lightweight local filtering; the user explicitly does not want a heavy search system unless plan volume later
makes it necessary.

Existing relevant behavior to preserve:

- `wld plans ui` serves a local Fresh/Vite Workspace from `src/ui/workspace/`.
- The board is server-rendered, with small Preact islands layered onto it for browser-only behavior such as drag/drop.
- Plan cards expose `planName`, `title`, and `summary` from `serializePlanSummary`.
- The Plan Board PRD says filtered board state should be represented in stable URLs where practical.

Confirmed product choices from user interview:

- Search filters the currently selected board tab/view, not a separate all-plans result page.
- The query is stored as `q` in the URL and preserved when switching tabs or opening/returning from details.
- Use Fuse.js as the fuzzy matcher because it is familiar, keeps fuzzy scoring out of homegrown code, and plan counts
  are expected to stay small. Configure it narrowly for `title`, `planName`, and `summary`; do not introduce server-side
  indexing or a database.

## Objective

Add a visible, accessible search input to each Plan Board screen that:

- Filters the current board view's visible top-level/Epic cards and repair/orphan cards by fuzzy match against plan
  title/name and summary.
- Updates column counts and empty states so the board remains understandable after filtering.
- Preserves tokenized local Workspace URLs and stores the search query in a `q` URL parameter for
  refresh/share/back-forward behavior.
- Keeps the implementation small, client-side, and consistent with existing Fresh + Preact island patterns.

## Approach

Implement search as a browser island attached to the existing server-rendered board rather than converting the whole
board to a client-rendered component. `Board.jsx` should continue rendering all cards for SSR/no-JS behavior, then pass
a compact search index and board identifiers to a new `PlanBoardSearch` island. The island should instantiate Fuse.js
when the input has a non-empty query, compute matching plan IDs, hide non-matching card articles, update visible column
counts, and show a filtered empty message when nothing in the current view matches.

Use conservative Fuse options such as weighted `title`/`planName` and `summary` keys, `ignoreLocation: true`, and a
moderate threshold that catches small typos without turning every short query into a match. Keep the exact options in
one exported helper so tests can pin expected behavior and later tuning is localized.

Use URL state rather than hidden application state: initialize the input from `url.searchParams.get("q")`, update `q`
via `history.replaceState` as the user types, and make Workspace tab/detail/back links preserve `q` alongside the
existing token.

## Files to Modify

- `deno.json` — add a `fuse.js` npm import alias.
- `deno.lock` — update after adding the dependency.
- `src/ui/workspace/components/Board.jsx` — build/pass the search index, render the search island, add board-level
  filtered empty/status elements, and include repair/orphan cards in searchable content.
- `src/ui/workspace/components/BoardColumn.jsx` — add data attributes/hooks needed for search-driven count and
  empty-state updates; keep SSR counts unchanged when no query is active.
- `src/ui/workspace/components/PlanCard.jsx` — preserve relevant board query params in links and expose stable card data
  attributes if needed by the search island.
- `src/ui/workspace/components/EpicCard.jsx` — apply the same searchable card hooks to Epic cards as normal Plan cards.
- `src/ui/workspace/components/Layout.jsx` — preserve `q` when moving between Plan Board, Closed, and On Hold tabs.
- `src/ui/workspace/components/PlanDetail.jsx` — preserve `q` in back/close/edit links so returning from detail keeps
  the filtered board context.
- `src/ui/workspace/islands/PlanBoardSearch.jsx` — new Preact island containing the search input, Fuse matching helpers,
  URL synchronization, DOM filtering, count/empty-state updates, and exported pure helpers for tests.
- `src/ui/workspace/static/styles.css` — style the search control and filtered empty/status states using existing
  surface/border/text tokens and responsive patterns.
- `src/ui/workspace/workspace.test.js` — add unit/SSR coverage for search index creation, fuzzy matches, query URL
  preservation, and rendered search controls.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/ui/workspace/components/PlanCard.jsx` — reuse/extend `workspaceHref` instead of introducing a competing URL
  helper.
- `src/ui/workspace/islands/PlanBoardDragDrop.jsx` — mirror the pattern of a small browser island that attaches behavior
  to server-rendered board DOM by `boardId`.
- `src/ui/workspace/server/plan-adapter.js` — reuse existing serialized `title`, `planName`, and `summary` fields; avoid
  changing plan-store loading semantics.
- `src/ui/workspace/static/styles.css` — reuse existing color tokens, `.empty`, `.compact-empty`, form/action visual
  language, and responsive layout rules.

## Implementation Steps

- [ ] Step 1: Add `"fuse.js": "npm:fuse.js@^7"` to `deno.json` imports and refresh `deno.lock` through the normal Deno
      commands.
- [ ] Step 2: Create `src/ui/workspace/islands/PlanBoardSearch.jsx` with JSDoc typedefs and pure helpers, for example
      `normalizePlanSearchQuery`, `planMatchesSearch`, or `matchingPlanIds`, plus the Preact `PlanBoardSearch`
      component.
- [ ] Step 3: Implement the `PlanBoardSearch` UI as a labeled search input with helper/result text and an optional clear
      button. Initialize from the `initialQuery` prop and keep `q` in `history.replaceState` without dropping the
      Workspace token.
- [ ] Step 4: In the search island, attach to `[data-plan-board]`/`[data-plan-search-card]` elements, hide non-matches
      with the `hidden` attribute, update each column's displayed count from the visible card count, toggle per-column
      filtered-empty copy, and toggle a board-level "No plans match" message.
- [ ] Step 5: Update `Board.jsx` to compute a compact index from `screen.columns[*].cards`,
      `screen.columns[*].orphanChildren`, and `screen.orphanChildren` without duplicating the same plan ID. Include
      `planId`, `title`, `planName`, and `summary` only.
- [ ] Step 6: Update `BoardColumn.jsx`, `PlanCard.jsx`, and `EpicCard.jsx` as needed so both normal and Epic cards have
      the same searchable data hook and the original column count is available for reset.
- [ ] Step 7: Extend `workspaceHref`/related link helpers to preserve `q` in addition to `token`, and use that helper
      from `Layout.jsx` and `PlanDetail.jsx` links.
- [ ] Step 8: Add CSS for `.plan-search`, input focus/clear/result text, filtered-empty messaging, and hidden cards in a
      way that matches existing dark Workspace surfaces and works on narrow widths.
- [ ] Step 9: Add tests in `src/ui/workspace/workspace.test.js` for fuzzy helper behavior, SSR rendering of the search
      input/index, and `q` preservation in tab/detail links. Keep tests in pure JavaScript/JSDoc.

## Verification Plan

- Automated: run `deno task ci` and fix all reported issues.
- Automated focused loop while developing: run `deno task workspace:test` after adding the component/tests.
- Manual headed browser verification is mandatory because `frontend: true`:
  - Start the app with `deno task workspace:dev`.
  - Open `http://localhost:5173/?token=<dev-token-if-required>` or launch the real local server with
    `deno task cli -- plans ui --no-open` and open the printed tokenized URL.
  - Confirm the search input is visible and labeled on Active, Closed, and On Hold board screens.
  - Search for an exact title/name term and confirm only matching cards remain visible, column counts update, and empty
    columns show filtered-empty copy.
  - Search for a fuzzy/misspelled term that should match a known title/summary and confirm Fuse returns the expected
    card(s).
  - Search for a term with no matches and confirm a board-level no-results state appears without breaking the status
    columns.
  - Clear the query and confirm all cards/counts return.
  - Confirm the `q` URL parameter updates while typing, survives refresh, and is preserved when switching board tabs and
    returning from a plan detail page.
  - Confirm browser diagnostics show no console errors, no failed network requests, and keyboard focus remains usable
    for input, clear button, cards, and tab links.

## Edge Cases & Considerations

- Empty/whitespace query should behave exactly like today's unfiltered board.
- Plans with missing summaries should still match by `title`/`planName` and should not show `undefined` in the search
  index.
- Treat the existing serialized `title` field as the searchable title, falling back to `planName`; do not expand scope
  to parsing markdown body headings in this feature.
- Epic cards and orphan repair cards must be searchable; resolved child FEATURE cards should remain hidden from the
  top-level board exactly as they are today.
- Drag/drop should not submit hidden cards and should continue working for visible cards. If query is active, dropping a
  card may cause the server-rendered board to reload; after reload the `q` parameter should reapply the filter.
- Because plan counts are small, client-side Fuse search over the current view is acceptable. Do not add server
  indexing, background workers, or API search endpoints.
- New code must be pure JavaScript with JSDoc typedefs; do not add TypeScript syntax.
