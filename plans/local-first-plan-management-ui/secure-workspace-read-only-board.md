---
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
updatedAt: "2026-06-24T20:14:08.682Z"
status: "draft"
origin: "internal"
parentPlan: "local-first-plan-management-ui"
dependencies:
    - "plan-resource-identity-and-hierarchy"
---

# Secure Workspace Read-Only Board

## Context

RunWield currently has terminal-first Plan management. Users need a local browser Workspace to compare active work
visually, open stable Plan URLs, and inspect Plans from the current checkout without introducing a database or remote
service.

## Objective

Add `wld plans ui` as a secure local launch path and create the first read-only Workspace board. The board should show
canonical markdown Plans from the launched checkout, grouped by lifecycle visibility, with stable `planId`-based routes
and no state-changing UI yet.

## Approach

Evolve `wld plans` into a small subcommand dispatcher while preserving default list behavior. Add `src/cmd/plans/ui.js`
to parse launch flags, create a random per-server session token, bind to `127.0.0.1` by default, warn on non-loopback
binds, and start the Fresh Workspace. Build the Workspace under `src/ui/workspace/` using Fresh 2, Vite, Preact islands,
UnoCSS, and JavaScript/JSDoc source only. Expose read-only API routes that use Plan-store identity/hierarchy helpers and
never import filesystem helpers into browser code.

## Files to Modify

- `src/cmd/plans/index.js` — add `ui` subcommand dispatch while keeping `wld plans` list behavior as the default.
- `src/cmd/plans/ui.js` — implement CLI launch boundary, flag parsing, default host/port behavior, token generation,
  browser opening/URL printing, warning behavior, and clean shutdown.
- `src/cmd/plans/index.test.js` — cover default listing compatibility, `ui` delegation, help text, flag parsing, and
  non-loopback warning behavior.
- `src/cmd/registry.js` — update command usage/help metadata for `wld plans ui` and flags.
- `src/constants.js` — add shared Plan UI constants for default host, token header name, command labels, and related
  values.
- `src/ui/workspace/` — add Fresh/Vite/Preact/UnoCSS app boundary, server entry, route modules, read-only API routes,
  board page, cards, and layout components.
- `deno.json` — add root tasks/imports only as needed so Workspace checks can run from normal repo verification.
- `deno.lock` — update dependency lock entries required by the Workspace package.
- `README.md` — briefly document launching the Workspace, local plaintext behavior, bind warnings, and current read-only
  milestone.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.js` — reuse Plan identity, list, lookup, and hierarchy helpers from the first child FEATURE.
- `src/cmd/plans/index.js` — preserve current list command behavior and help patterns.
- `prototypes/fresh-plan-ui/` — reuse proven Fresh/Vite/UnoCSS stack shape while avoiding the prototype's BlockSuite
  Kanban as production board architecture.
- Fresh 2 Vite pattern — use Vite for islands/client bundling and ensure the Fresh plugin is first in the Vite plugin
  chain.

## Implementation Steps

- [ ] Step 1: Add `src/cmd/plans/ui.js` with argument parsing for `--host`/`--bind`, `--port`, `--no-open`, and
      `--help`, using loopback defaults and explicit warnings for non-loopback binds.
- [ ] Step 2: Update `runPlansCommand` to dispatch `wld plans ui` while preserving all existing no-subcommand listing
      behavior.
- [ ] Step 3: Add constants and command registry help text for the UI launch path.
- [ ] Step 4: Create `src/ui/workspace/deno.json`, `vite.config.js`, Fresh server/client entries, static assets, layout,
      and base routes using JavaScript/JSDoc only.
- [ ] Step 5: Implement read-only API routes for Workspace metadata, board data, Plan list, and Plan detail lookup by
      `planId`; all filesystem access must stay server-side.
- [ ] Step 6: Implement the read-only board view with active, closed, and on-hold navigation surfaces, Plan cards,
      status columns, and stable links to Plan detail routes.
- [ ] Step 7: Add tests/check tasks for CLI dispatch and Workspace module checks; update README with concise
      launch/security notes.

## Verification Plan

- Automated: run `deno task ci` and `deno task -c src/ui/workspace/deno.json check`.
- Manual: run `wld plans`, verify terminal output remains compatible; run `wld plans ui`, verify it binds to
  `127.0.0.1`, opens or prints a tokenized URL, and shows Plans from the current checkout only.
- Expected results for key scenarios: browser routes resolve Plans by `planId`; no state-changing API exists yet;
  non-loopback bind requires explicit flag and prints a clear warning; browser code cannot read arbitrary files.

## Edge Cases & Considerations

- The Workspace is project-scoped to the checkout where `wld plans ui` was launched, not a global dashboard.
- No permissive CORS should be added for read-only convenience because state-changing APIs will arrive later.
- The launch token can be bootstrapped in the URL, but the architecture should anticipate explicit same-origin token
  headers for future mutations.
- If Fresh routing or islands cannot be implemented with project-approved JavaScript/JSDoc source, stop for a design
  decision rather than adding TypeScript or `.tsx` files.
- Keep browser dependencies contained under `src/ui/workspace/` as much as practical so CLI runtime paths remain
  understandable.
