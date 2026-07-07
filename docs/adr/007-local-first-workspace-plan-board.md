# ADR-007: Local-First Workspace Plan Board

## Status

Accepted

## Context

RunWeild stores Plans as markdown files with YAML front matter under `plans/`. Planner, Architect, Slicer, `wld plans`,
and `wld load-plan` all depend on those files as the canonical workflow state. The new local-first Plan Management UI
needs a browser workspace for reading, editing, and moving Plans through their lifecycle without replacing that markdown
source of truth.

The related collaborative-planning direction expects future hosted/self-hosted sharing, durable links, and client-side
encrypted remote storage. The local Plan UI should therefore introduce stable resource identity and workspace boundaries
now, but must not introduce a local database or a remote collaboration model in v1.

Prototype work under `prototypes/fresh-plan-ui/` proved that Fresh 2, Vite, Preact islands, UnoCSS, and Deno can support
the UI stack. It also showed that BlockSuite is promising for future rich document surfaces but is not safe to put on
the critical Plan save path until canonical markdown extraction is proven.

## Decision

Build the v1 Plan Management UI as a local-first Workspace shell launched by `wld plans ui`.

- Production UI code lives under `src/ui/workspace/`.
- The CLI launch boundary is `src/cmd/plans/ui.js`, invoked as a subcommand from the existing `wld plans` command.
- The UI server is scoped to the current checkout and reads/writes only that checkout's canonical `plans/` tree.
- The top-level Plan Board is custom RunWeild UI backed by Plan store and Plan Lifecycle APIs, not a BlockSuite/AFFiNE
  database board.
- The v1 editor is a conservative body-only markdown editor using a CodeMirror-style editing surface. BlockSuite is
  deferred behind a future replaceable editor adapter.
- Plans gain a stable globally unique `planId` front matter field. Existing Plans are lazily/backfilled so
  project-scoped browser routes can use durable identifiers independent of file name/title changes.
- The local API is REST/JSON. It exposes Plan resources, Epic hierarchy, body save, and lifecycle actions through
  server-side adapters rather than letting the browser mutate markdown files directly.
- State-changing requests require a random per-server session token. The server binds to `127.0.0.1` by default, rejects
  permissive CORS by default, and path-sandboxes all file access beneath the launched checkout.
- Remote encrypted collaboration, real-time editing, and a database-backed hosted service remain future work. The local
  architecture should keep route/resource concepts compatible with that direction without implementing it.

## Consequences

### Positive

- Existing CLI and agent workflows continue to treat markdown Plan files as canonical.
- The browser UI can manage lifecycle state without duplicating or bypassing the central Plan Lifecycle module.
- Durable `planId` values give local links a migration path to future hosted/self-hosted project URLs.
- A CodeMirror-style body editor reduces markdown round-trip risk and lets the first UI ship without betting the
  lifecycle surface on BlockSuite internals.
- Workspace boundaries leave room for future docs, notes, and project knowledge resources without turning v1 into a
  Notion clone.

### Negative

- Adding `planId` front matter mutates existing Plan files during backfill.
- The UI stack introduces a Vite/Fresh browser app inside a CLI-oriented Deno project.
- Lifecycle support must grow to cover manual board actions such as closing without verification and holding/resuming
  Plans.
- CodeMirror gives a safer v1 save path but does not provide the richer document/canvas affordances BlockSuite may later
  unlock.

### Mitigations

- Backfill is explicit, idempotent, collision-checked, and preserves the markdown body.
- The Workspace app has its own clear package boundary and verification commands.
- Board actions call existing/extended Plan Lifecycle helpers; raw front matter editing remains out of the default path.
- Editor integration sits behind an adapter boundary so BlockSuite can be reintroduced later only after fidelity tests
  prove canonical markdown safety.

## 2026-07 Amendment: Plannotator component reuse spike

The original decision selected Fresh 2, Preact islands, UnoCSS, and pure JS/JSDoc for the v1 Workspace because that
stack was the proven local-first path at the time. The next Workspace slice may introduce a scoped exception for React
and TypeScript under `src/ui/workspace/` to prove direct reuse of upstream Plannotator UI modules.

This exception is intentionally narrow:

- canonical Plan markdown and Plan Lifecycle APIs remain the source of truth;
- Workspace server and workflow code outside the browser UI continue to follow RunWield's JS/JSDoc conventions unless a
  separate decision changes them;
- upstream Plannotator source is consumed through a pinned, reviewed checkout under `third_party/plannotator/`, not as
  an unreviewed moving dependency;
- RunWield imports Plannotator UI from the pinned source checkout (`third_party/plannotator/packages/ui` and sibling
  workspace packages such as `packages/shared` and `packages/ai`) rather than from published npm packages for this
  slice. Related published packages such as `@plannotator/webtui`, `@plannotator/markdown-editor`,
  `@plannotator/atomic-editor`, `@plannotator/web-highlighter`, `@plannotator/workspaces-api`, `@plannotator/opencode`,
  and `@plannotator/pi-extension` are ecosystem facts only; they are not the dependency path for the Plan detail proof;
- Deno's npm freshness delay remains a supply-chain safety control. A source checkout can avoid registry freshness
  blocking, but updates must pin exact reviewed commits rather than bypass dependency review.

The first proof should render a Plan detail body through an imported Plannotator component in read-only mode while
preserving existing Workspace lifecycle actions, metadata, and body-edit conflict behavior. Replacing the Plannotator
compiled bridge for `plan_written` and code review is a follow-up slice after direct component reuse is proven.
