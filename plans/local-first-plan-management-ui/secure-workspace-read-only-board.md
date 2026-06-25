---
planId: "ea676be3-b2ec-4314-8159-a79437675b1b"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Introduce `wld plans ui`, the local Fresh/Vite/Preact Workspace app, secure localhost launch, read-only REST APIs, and a first read-only Plan Board backed by canonical markdown Plans."
affectedPaths:
    - "src/cmd/plans/index.js"
    - "src/cmd/plans/ui.js"
    - "src/cmd/plans/index.test.js"
    - "src/cmd/registry.js"
    - "src/constants.js"
    - "src/ui/workspace/"
    - "deno.json"
    - "deno.lock"
    - "README.md"
createdAt: "2026-06-24T20:14:08.682Z"
updatedAt: "2026-06-25T13:19:53.170Z"
status: "verified"
origin: "internal"
parentPlan: "local-first-plan-management-ui"
dependencies:
    - "plan-resource-identity-and-hierarchy"
verifiedAt: "2026-06-25T13:19:53.170Z"
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-06-25T13:18:31.962Z"
---

# Secure Workspace Read-Only Board

## Context

RunWield currently has terminal-first Plan management. Users need a local browser Workspace to compare active work, open
stable Plan URLs, and inspect Plans from the current checkout without introducing a database or remote service.

The prerequisite `plan-resource-identity-and-hierarchy` slice is verified and provides durable `planId` identity,
Plan-resource lookup, and shared Epic/child/orphan grouping helpers. The prerequisite `lifecycle-board-semantics` slice
is also verified and provides `closed_without_verification` and `on_hold` status parsing/semantics. This slice should
consume those seams to ship the first read-only Workspace shell and board; lifecycle actions, drag/drop, body editing,
and richer Epic detail behavior remain for later child FEATUREs.

## Objective

Add `wld plans ui` as a secure local launch path and create the first read-only Workspace board. The board should show
non-archived canonical markdown Plans from the launched checkout, grouped by lifecycle visibility, with stable
`planId`-based routes and no state-changing UI or state-changing API yet.

The shipped milestone should provide:

- A `wld plans ui` subcommand that starts a project-scoped local server for the current checkout.
- Secure defaults: bind to `127.0.0.1`, explicit `--bind`/`--host` for non-loopback exposure, no permissive CORS, and a
  random per-server token required for Workspace HTML/API access.
- A production Workspace source boundary under `src/ui/workspace/` using Fresh 2, Vite, Preact, UnoCSS,
  JavaScript/JSDoc, and `.jsx` for Fresh/Preact component files where helpful; no TypeScript files or syntax, no nested
  `deno.json`, and no separate app-within-the-app dependency root.
- SSR-first board/detail pages: initial HTML should include all cards and Plan detail content needed for the current
  route, without requiring browser JavaScript to fetch JSON before rendering.
- Minimal read-only REST/JSON endpoints for Workspace metadata, Plan resources, board grouping, and Plan detail lookup
  by `planId`, used by future/small interactive enhancements rather than required for initial rendering.
- A first read-only Plan Board with active, closed, and on-hold views/surfaces, Plan cards, Epic-tagged cards, and
  stable links to read-only Plan detail routes.

## Approach

Evolve `wld plans` into a small subcommand dispatcher while preserving default list behavior. Add `src/cmd/plans/ui.js`
as the CLI launch boundary: parse launch flags, create a random per-server session token, bind to `127.0.0.1` by
default, warn on non-loopback binds, start the Workspace server, and either open or print the tokenized URL.

Build the Workspace under `src/ui/workspace/` with a narrow server adapter layer, but keep the repository on a single
Deno configuration root. Do not add `src/ui/workspace/deno.json`; add Workspace imports, JSX options for `.jsx`, Vite
client types, and tasks to the root `deno.json` so `deno task ci` remains the single normal verification entry point.
Use existing shared code directly where appropriate from server-side Workspace modules instead of creating a separate UI
app dependency universe. Browser/client/island modules must call local REST APIs and must never import
`src/plan-store.js`, `src/shared/workflow/plan-lifecycle.js`, `Deno`, or other filesystem/server-only helpers. Server
routes should reuse `listPlanResources`, `findPlanById`, `groupPlanHierarchy`, `countChildPlanProgress`, and lifecycle
status meanings to serialize UI DTOs. Do not add a database or write any Plan files except for the existing lazy
`planId` backfill performed by `listPlanResources`/`findPlanById`.

Use Fresh the way Fresh is designed to work: a programmatic Fresh `App` with route handlers that render server-generated
Preact component trees, an app wrapper for the shared `<html>/<head>/<body>` shell, layouts for the Workspace chrome,
and islands only where browser interactivity is needed. `src/ui/workspace/server.js` must be a thin
startup/app-composition boundary; it must not contain page markup, encoded JavaScript, or string-built HTML. This slice
should be SSR-first: route handlers load Plan data and render board/detail components; read-only REST APIs still exist
for future consumers and small enhancements, but the board should not be a client-side app shell and initial card/detail
rendering must not depend on fetch-then-render JavaScript. Refreshing by reloading the page is acceptable for this
read-only milestone. Use `.jsx` for Fresh/Preact component files where it keeps the implementation idiomatic. Avoid
TypeScript syntax and avoid adding `.ts`/`.tsx`. Do not build production pages with monolithic functions that
concatenate HTML strings such as `boardHtml(token)`, and do not ship string-encoded client JS. Template strings are
acceptable only for tiny non-HTML values such as URLs or test fixtures. If Fresh cannot render the Workspace cleanly
with JavaScript/JSX source, stop for a design decision rather than inventing a custom HTML templating path.

## Files to Modify

- `src/cmd/plans/index.js` — add `ui` subcommand dispatch while keeping `wld plans` list behavior as the default;
  inject/delegate launch behavior for tests.
- `src/cmd/plans/ui.js` — implement CLI launch boundary, pure flag parsing helpers, host/port defaults, token
  generation, secure URL construction, browser opening/URL printing, warning behavior, Workspace server startup, and
  clean shutdown.
- `src/cmd/plans/ui.test.js` — add focused tests for flag parsing, loopback detection, tokenized URL construction,
  non-loopback warnings, browser-open suppression, and server-launch dependency injection.
- `src/cmd/plans/index.test.js` — cover default listing compatibility, `ui` delegation, and help text behavior.
- `src/cmd/registry.js` — update command usage/help metadata for `wld plans ui` and its flags.
- `src/constants.js` — add shared Plan UI constants for default host, default port behavior, token query/header names,
  command labels, and related values.
- `src/ui/workspace/` — add programmatic Fresh/Vite/Preact/UnoCSS source boundary, server entry, route modules, minimal
  read-only API routes, SSR board/detail pages, Plan cards, app wrapper/layout components, checks/tests, and server-only
  Plan adapter modules; do not add a nested `deno.json`.
- `deno.json` — keep this as the only Deno config/dependency root; add Workspace imports, compiler options, and tasks
  only as needed so Workspace checks run from normal repo verification.
- `deno.lock` — update dependency lock entries required by the Workspace package.
- `README.md` — briefly document launching the Workspace, local plaintext behavior, tokenized localhost access,
  non-loopback bind warnings, and current read-only milestone.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.js` — reuse `listPlanResources`, `findPlanById`, `groupPlanHierarchy`, `countChildPlanProgress`,
  `isEpicPlan`, and `isChildFeaturePlan` as the canonical Plan resource/hierarchy boundary.
- `src/shared/workflow/plan-lifecycle.js` — reuse status meanings and helper names where useful for UI labels; do not
  expose lifecycle mutation controls in this read-only slice.
- `src/cmd/plans/index.js` — preserve current list command behavior and help patterns while adding subcommand dispatch.
- `prototypes/fresh-plan-ui/` — reuse the proven Fresh/Vite/UnoCSS stack shape and Preact component approach while
  avoiding the prototype's BlockSuite Kanban.
- Fresh 2 Vite pattern — use Vite for islands/client bundling and ensure the Fresh plugin is first in the Vite plugin
  chain.

## Implementation Steps

- [ ] Step 1: Add Plan UI constants and CLI launch parser.
  - Add constants such as `PLAN_UI_DEFAULT_HOST = "127.0.0.1"`, `PLAN_UI_DEFAULT_PORT` or explicit random-port behavior,
    `PLAN_UI_TOKEN_QUERY`, and `PLAN_UI_TOKEN_HEADER` in `src/constants.js`.
  - Implement/export pure helpers in `src/cmd/plans/ui.js` for parsing `--bind`/`--host`, `--port`, `--no-open`, and
    `--help`.
  - Treat `--host` as an alias for `--bind`; reject conflicting host/bind values and invalid ports with clear messages.
  - Default to loopback. If binding outside loopback, require the explicit flag and print a clear plaintext/local-file
    exposure warning.
- [ ] Step 2: Implement secure Workspace launch in `src/cmd/plans/ui.js`.
  - Generate a random per-server token using Web Crypto (`crypto.randomUUID()` or stronger random bytes) for every
    launch.
  - Start the Workspace server for `CWD`, host, port, and token via a dynamic import from `src/ui/workspace/server.js`
    or equivalent.
  - Build a tokenized launch URL and print it. Unless `--no-open` is set, best-effort open it with the OS browser helper
    (`open`, `xdg-open`, or `cmd /c start`) without making browser-open failure fatal.
  - Wire Ctrl-C/abort shutdown so the Deno server closes cleanly.
- [ ] Step 3: Dispatch `wld plans ui` without breaking `wld plans`.
  - Update `runPlansCommand` to detect `argv[0] === "ui"` before list parsing and delegate remaining args to
    `runPlansUiCommand`.
  - Preserve `wld plans`, `wld plans --help`, no-plan output, Epic/child/orphan grouping output, and existing tests.
  - Update registry usage/notes to show `wld plans ui`, `--bind`/`--host`, `--port`, `--no-open`, and `--help`.
- [ ] Step 4: Create the Workspace source boundary under `src/ui/workspace/` while keeping one root Deno config.
  - Do not create `src/ui/workspace/deno.json` or any other nested Deno root.
  - Add Fresh 2, Preact, signals, UnoCSS, Vite client types, JSX compiler options for `.jsx`, and Workspace tasks to the
    root `deno.json`.
  - Add `src/ui/workspace/vite.config.js` with the Fresh plugin first and UnoCSS through Vite, relying on the root
    `deno.json` for imports/tasks.
  - Add Fresh server/client entry modules and route modules in JavaScript/JSDoc/JSX source, using real Fresh route
    handlers and Preact components for all markup.
  - Use programmatic Fresh registration: `server.js` creates/configures the `App`, registers routes/API handlers/static
    assets, registers the shared document shell with `app.appWrapper()`, and registers Workspace chrome with
    `app.layout()`.
  - Keep `server.js` free of page HTML and embedded client-side JavaScript strings; page markup belongs in component
    modules and route handlers render those components.
- [ ] Step 5: Add token/security middleware and server-only adapters.
  - Require the launch token for Workspace HTML and API routes, accepting the token from the initial URL query and/or
    the configured header for API fetches.
  - Do not enable permissive CORS. Same-origin fetches from the Workspace should work without exposing APIs to arbitrary
    browser origins.
  - Keep server-only adapters in clearly named modules (for example `server/plan-adapter.js`) that import Plan-store
    helpers and serialize only safe DTOs; browser modules must not import them.
  - Scope all Plan access to the launched `cwd`; responses may include `planName` and `relativePath`, but should avoid
    exposing absolute filesystem paths unless there is a deliberate debugging-only reason.
- [ ] Step 6: Implement SSR data loading plus minimal read-only REST/JSON endpoints.
  - First implement server-side route data loaders/adapters so board/detail routes render complete initial HTML from
    Plan-store data without client-side fetch-then-render.
  - `GET /api/workspace` — return project/workspace metadata, read-only mode, supported statuses/views, and server
    capabilities.
  - `GET /api/plans` — return Plan resource summaries from `listPlanResources(cwd)`, including `planId`, `planName`,
    `relativePath`, key front matter fields, and top-level/Epic/child/orphan classification.
  - `GET /api/board` — return active/closed/on-hold groupings built from shared hierarchy helpers. Active statuses
    include `draft`, `feedback`, `approved`, `ready_for_decomposition`, `ready_for_work`, `in_progress`, `failed`, and
    `implemented`; closed includes `verified` and `closed_without_verification`; on-hold includes `on_hold`.
  - `GET /api/plans/:planId` — return read-only Plan detail from `findPlanById(cwd, planId)`, including front matter,
    body markdown, rendered-safe metadata fields, and no mutation affordances.
  - Convert duplicate/missing `planId` errors into user-readable API errors that explain how to repair Plan front
    matter.
- [ ] Step 7: Implement the first read-only Workspace UI.
  - Add a Workspace document shell via `app.appWrapper()` and navigation/chrome via `app.layout()` components for Board,
    Closed, and On Hold views.
  - Render the read-only board/detail pages SSR-first from Fresh route handlers that load data server-side and pass it
    to Preact components; all cards for the current board view should be present in the initial HTML.
  - Add board markup as small reusable components; do not inline large HTML in JS functions and do not encode client JS
    inside server strings.
  - Keep child FEATURE Plans under their Epic summary by default; standalone FEATUREs and top-level Epics should be the
    main board cards, and orphaned children should remain visible in a repair/discoverability section.
  - Add read-only Plan detail routes linked by `planId` that show rendered markdown or readable markdown body, front
    matter summary, lifecycle/worktree/dependency metadata, and a clear "read-only milestone" note instead of edit/move
    controls.
- [ ] Step 8: Add tests/checks and documentation.
  - Add CLI tests for `ui` dispatch and parser/security helpers.
  - Add Workspace checks/tests for server adapter serialization, board grouping, token rejection/acceptance, app
    wrapper/layout registration, SSR route rendering, and route modules where practical without a full browser harness.
  - Add root `deno.json` task wiring (for example `workspace:check` / `workspace:test`) and include it in `ci` where
    practical so `deno task ci` remains the primary verification entry point.
  - Update `README.md` with concise launch/security/read-only instructions.

## Verification Plan

- Automated: exact command(s) to run
  - `deno task ci`
  - If Workspace-specific tasks are added at the root, run them directly as needed, e.g. `deno task workspace:check` and
    `deno task workspace:test`; do not use a nested Workspace `deno.json`.
- Manual: precise user flows / checks
  - Run `wld plans` in a repo with existing Plans and verify terminal output remains compatible.
  - Run `wld plans ui --no-open`, verify it binds to `127.0.0.1`, prints a tokenized URL, and serves Plans from the
    current checkout only.
  - Open the printed URL and verify the Board, Closed, On Hold, and Plan detail views load with card/detail content in
    the initial HTML before any optional client-side fetch.
  - Try the same URL without the token/header and verify Workspace/API access is rejected.
  - Run `wld plans ui --bind 0.0.0.0 --no-open` and verify a clear warning is printed before serving.
  - Start with Plans that lack `planId`; verify IDs are backfilled once, routes use `planId`, and Plan bodies are not
    changed by the read-only UI.
  - Create or simulate duplicate existing `planId` values; verify the API/UI fails loudly with a repair-oriented error
    instead of silently rewriting user IDs.
- Expected results for key scenarios
  - SSR Fresh routes resolve non-archived Plans by stable `planId` and render without a client-side app shell.
  - No state-changing API or UI control exists in this slice.
  - Active, closed, and on-hold visibility matches central lifecycle statuses.
  - Non-loopback bind requires an explicit flag and prints a clear warning.
  - Browser/client code cannot read arbitrary files and cannot import Plan-store/filesystem helpers.

## Edge Cases & Considerations

- The Workspace is project-scoped to the checkout where `wld plans ui` was launched, not a global dashboard.
- Read-only does not mean public: Plan content can be sensitive, so token-gate Workspace/API access even before mutation
  endpoints exist.
- No permissive CORS should be added for read-only convenience because state-changing APIs will arrive later.
- The launch token can be bootstrapped in the URL, but same-origin API calls should use the explicit token header so
  future mutations can reuse the same security boundary.
- Existing `listPlanResources` may lazily backfill `planId`; that metadata write is allowed, but the board/detail UI
  must not write statuses, body markdown, or arbitrary front matter in this slice.
- If the implementation sees duplicate Plan resource/hierarchy exports or other leftover prerequisite drift in
  `src/plan-store.js`, fix that prerequisite seam before building the Workspace adapter, then rerun `deno task ci`.
- `.jsx` is explicitly allowed for the Workspace component/route files in this slice; TypeScript remains disallowed.
- If Fresh routing or islands cannot be implemented with JavaScript/JSX component source, do not fall back to monolithic
  HTML string templates, checked-in HTML template shims, or string-encoded client scripts. Stop for a design decision
  before adding TypeScript or `.tsx` files.
- Keep browser source modules contained under `src/ui/workspace/` as much as practical, but keep dependency aliases and
  tasks in the root `deno.json` to avoid multiple Deno roots and reuse existing shared modules from server-side
  Workspace adapters instead of creating a separate app dependency graph.
