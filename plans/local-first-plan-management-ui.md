---
classification: "PROJECT"
complexity: "HIGH"
summary: "Build a local-first browser Workspace for managing canonical markdown Plans, with durable Plan IDs, REST APIs, lifecycle-safe board actions, Epic detail views, and a body-only markdown editor."
affectedPaths:
    - "docs/adr/007-local-first-workspace-plan-board.md"
    - "docs/plan-lifecycle.md"
    - "docs/prd/local-first-plan-management-ui-PRD.md"
    - "src/cmd/plans/index.js"
    - "src/cmd/plans/ui.js"
    - "src/cmd/plans/index.test.js"
    - "src/cmd/registry.js"
    - "src/constants.js"
    - "src/plan-store.js"
    - "src/plan-store.test.js"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/shared/workflow/plan-lifecycle.test.js"
    - "src/ui/workspace/"
    - "deno.json"
createdAt: "2026-06-24T13:10:29-04:00"
updatedAt: "2026-06-24T20:40:03.402Z"
status: "ready_for_work"
origin: "internal"
type: "epic"
worktreeStatus: "validation_failed"
---

# Local-First Plan Management UI

## Context

RunWield Plans are canonical markdown files under `plans/` with YAML front matter. The current management surface is
terminal-first: `wld plans` lists saved Plans and `wld load-plan` resumes one Plan, but there is no persistent visual
workspace for comparing active work, reading Plan bodies, editing safely, inspecting Epic progress, or manually moving
Plans through lifecycle states.

The primary product source is `docs/prd/local-first-plan-management-ui-PRD.md`. The architectural decision has already
been recorded in `docs/adr/007-local-first-workspace-plan-board.md`: v1 is a local-first Workspace Plan Board over
canonical markdown, launched by `wld plans ui`, with durable `planId` identity, REST/JSON APIs, lifecycle-mediated board
actions, and a conservative markdown body editor. Future hosted/self-hosted collaboration and encrypted remote storage
remain intentionally out of scope for this Epic.

User decisions captured before this finalization:

- The v1 editor is CodeMirror-style/body-only markdown editing. BlockSuite is deferred from the first production editor
  path.
- Durable Plan URLs use a new globally unique `planId` front matter field, lazily/backfilled for existing Plans.
- Board-required statuses and events (`closed_without_verification`, manual board movement, `on_hold`) extend the
  central Plan Lifecycle module rather than creating a second lifecycle system.
- The Workspace is project-scoped: one local server instance shows the checkout from which `wld plans ui` was launched,
  not a global multi-project dashboard.

## Objective

Build `wld plans ui`: a local-first browser Plan Workspace launched from the current checkout. The implementation must
preserve markdown Plan files as the source of truth while adding:

- A Workspace app boundary under `src/ui/workspace/` backed by Fresh 2, Vite, Preact islands, UnoCSS, and
  JavaScript/JSDoc-only source. Do not add TypeScript files or TypeScript syntax.
- A local REST/JSON API over the existing Plan store and Plan Lifecycle seams.
- Stable `planId` resource identity for durable project-scoped URLs that survive Plan title/path changes.
- A custom RunWield Plan Board grouped by lifecycle visibility: active work, closed work, and on-hold work.
- Epic cards and Epic detail views that summarize child FEATURE progress without flattening children onto the main board
  by default.
- Read-first Plan detail pages with rendered markdown and front matter summaries.
- A save-only body editor that cannot directly mutate workflow-critical front matter.
- Structured lifecycle/manual actions for status moves, including `closed_without_verification` and `on_hold` support
  through `src/shared/workflow/plan-lifecycle.js`.
- Localhost security controls: default bind to `127.0.0.1`, explicit opt-in bind override, random per-server session
  token for state-changing requests, no permissive CORS, and filesystem sandboxing beneath the launched checkout.

Out of scope for this Epic: remote hosted/self-hosted collaboration, end-to-end encryption, real-time editing,
comments/annotations, notifications, global multi-project dashboards, AFFiNE-the-app, BlockSuite as the board,
BlockSuite as the v1 Plan editor, and any local database that would replace markdown as canonical Plan state.

## Vertical Slice Findings

- `src/cmd/plans/index.js` is currently a list-only CLI command. Its private grouping semantics are important product
  behavior: Epics are `classification: PROJECT` plus `type: epic`, child FEATURE Plans point to `parentPlan`, and
  orphaned children are separated. The Workspace API should extract/reuse these semantics so terminal and browser views
  do not drift.
- `src/plan-store.js` owns canonical Plan persistence. It currently treats the filename/path as identity and has no
  `planId` field. It already parses and rewrites front matter, preserves unknown keys through parse/inject paths, lists
  nested Plans recursively, hides top-level `plans/archived`, and exposes `loadPlan`, `listPlans`,
  `updatePlanFrontMatter`, and `findPlansByParent` seams that can support local API adapters.
- `src/shared/workflow/plan-lifecycle.js` is the accepted central lifecycle state machine per the lifecycle docs. It
  currently supports statuses through `verified` and does not implement `closed_without_verification`, `on_hold`,
  `manual_status_change`, `plan_held`, `hold_resumed`, or `hold_reset_to_draft`. Board movement must extend this module
  instead of directly writing `status` in YAML.
- `docs/plan-lifecycle.md` documents the current invariant that workflow code records Plan Events instead of directly
  mutating Plan Status. New board/manual transitions must update this document only when code support lands.
- `docs/prd/on-hold-plan-status.md` defines `on_hold`, `heldFromStatus`, `heldAt`, `holdReason`,
  `holdStalenessBaseline`, and Resume Check semantics. The UI should expose on-hold behavior only through those central
  lifecycle semantics, not a UI-only flag.
- The Fresh prototype under `prototypes/fresh-plan-ui/` proved the Deno/Fresh/Vite/Preact/UnoCSS stack shape and showed
  that hydrated islands require the Fresh Vite pipeline rather than a direct `App.listen()` shortcut. It also proved
  that BlockSuite's database/Kanban is not the right owner for RunWield Plan Board semantics.
- Current Fresh docs confirm Fresh 2 uses Vite and the Fresh Vite plugin handles JSX configuration, HMR, island
  discovery, client/server code splitting, and React-to-Preact aliasing. The Fresh plugin should be first in the Vite
  plugin chain.
- Current CodeMirror 6 docs confirm the v1 editor can be built from `EditorView`, `basicSetup`, and
  `@codemirror/lang-markdown`, matching the selected body-only markdown-source editing strategy.
- The repository policy is JavaScript-only. If the implementation spike proves Fresh routing or islands cannot be made
  to work with project-acceptable JavaScript source files, stop and return for a design decision rather than quietly
  introducing `.ts`/`.tsx` or TypeScript syntax.

## Files to Modify

- `README.md` — document how to launch the Plan Workspace, what `--bind`/`--host` exposure means, and that v1 is local
  plaintext over the current checkout. Keep the docs concise and link to lifecycle/PRD details rather than duplicating
  all semantics.
- `docs/adr/007-local-first-workspace-plan-board.md` — existing accepted ADR. Treat it as the architectural contract;
  modify only if implementation discovers that an accepted decision must change.
- `docs/plan-lifecycle.md` — after lifecycle code support lands, document `closed_without_verification`, manual board
  movement, `on_hold`, hold metadata, Resume Check behavior, and the distinction between Workflow Validation `verified`
  and manual closure.
- `docs/prd/local-first-plan-management-ui-PRD.md` — update status/notes after implementation if needed, especially to
  reflect that v1 shipped with CodeMirror-style body editing and deferred BlockSuite from the first production editor
  path.
- `src/cmd/plans/index.js` — evolve `wld plans` into a small subcommand dispatcher while preserving current list
  behavior as the default. Delegate `wld plans ui` to `src/cmd/plans/ui.js`. Extract Plan hierarchy/grouping helpers
  from private CLI functions into a shared location so the CLI and Workspace API share Epic/child/orphan semantics.
- `src/cmd/plans/ui.js` — new CLI launch boundary. Parse `--host`/`--bind`, `--port`, `--no-open`, and `--help`; bind to
  `127.0.0.1` by default; create a random per-server session token; start the Workspace server for the current checkout;
  print/open the browser URL; warn when binding outside loopback; and handle shutdown cleanly.
- `src/cmd/plans/index.test.js` — cover default listing compatibility plus `ui` subcommand delegation, help text, flag
  parsing, and non-loopback warning behavior.
- `src/cmd/registry.js` — update command usage/help metadata so `wld plans ui` and its flags are discoverable without
  changing `plans` into an interactive slash command.
- `src/constants.js` — add shared constants for Plan UI defaults and token/header names where useful, such as default
  host, default port behavior, command labels, or environment variable names. Do not hard-code absolute paths.
- `src/plan-store.js` — add Plan resource identity and body-save seams:
  - `planId` front matter parsing/formatting/JSDoc, generated with a globally unique random ID such as
    `crypto.randomUUID()`.
  - Idempotent `ensurePlanIdentity` / backfill helpers that preserve existing IDs and fail loudly on duplicate IDs.
  - Lookup by `planId` while still returning canonical `planName`, project-relative path, absolute path, front matter,
    and body metadata for existing CLI workflows.
  - Body-only save helper that preserves front matter fields and rejects stale saves when a caller provides an old body
    hash or revision token.
  - Shared Plan hierarchy/grouping helpers for Epics, children, standalone Plans, orphaned children, and progress
    counts.
  - Optional project/workspace metadata needed by the UI that does not require introducing a database.
- `src/plan-store.test.js` — cover `planId` creation, preservation, duplicate/collision behavior, lookup by `planId`,
  body-save front matter preservation, stale body-save rejection, archived-plan hiding, and shared hierarchy grouping.
- `src/shared/workflow/plan-lifecycle.js` — extend the central lifecycle with board-safe events/statuses. Required
  constraints:
  - Add `closed_without_verification` as a terminal manual status distinct from `verified`.
  - Keep `verified` reserved for Workflow Validation, except the existing Epic `done_enough` exception.
  - Add manual board movement through a lifecycle-owned event/helper; it may move among safe non-terminal statuses but
    must not casually enter/leave `failed`, enter `verified`, bypass recovery, or imply validation.
  - Add `on_hold` and hold metadata using `docs/prd/on-hold-plan-status.md` semantics: `heldFromStatus`, `heldAt`,
    optional `holdReason`, `holdStalenessBaseline`, `plan_held`, `hold_resumed`, and `hold_reset_to_draft`.
  - Holding/resuming mutates only the selected Plan. Epic/child visibility and blocking rules are listing/UI behavior,
    not child-status mutation.
  - Recovery-specific states remain recovery-specific; board drag-and-drop cannot paper over failed execution,
    validation failures, or merge conflicts.
- `src/shared/workflow/plan-lifecycle.test.js` — add transition tests for manual movement, manual closure,
  hold/resume/reset, blocked direct verification, blocked casual failed transitions, Epic hold behavior, child hold
  behavior, metadata creation/clearing, and existing transition compatibility.
- `src/ui/workspace/` — new Workspace app boundary. Expected internal shape:
  - Local `deno.json` with JS/JSDoc checking, Vite client types, Fresh 2, Preact, signals, UnoCSS, CodeMirror 6 markdown
    dependencies, and local UI tasks.
  - `vite.config.js` with the Fresh plugin first and UnoCSS through Vite.
  - Fresh server/client entry modules and route modules written with project-approved JavaScript/JSDoc only; no `.ts`,
    `.tsx`, interfaces, type aliases, or TypeScript syntax.
  - Routes for the board, closed screen, on-hold screen, Plan detail, Epic detail, and REST API endpoints.
  - Islands/components for the board, drag/drop or equivalent move controls, editor, filters, and browser-local unsaved
    draft recovery.
  - Server-side adapters that import `src/plan-store.js` and `src/shared/workflow/plan-lifecycle.js`; browser code calls
    APIs and never imports filesystem helpers.
  - Shared UI modules/components for Plan cards, status columns, Epic progress, markdown rendering, front matter
    summaries, worktree/dependency summaries, and lifecycle action controls.
- `deno.json` — add root imports/tasks only as needed to make the Workspace app verifiable from normal repo CI. Keep the
  CLI core understandable and avoid pulling browser-only dependencies into unrelated runtime paths.
- `deno.lock` — update only as required by dependency resolution for the Workspace package/root tasks.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/plan-store.js` — reuse `loadPlan`, `listPlans`, `findPlansByParent`, `updatePlanFrontMatter`, front matter
  parsing, nested plan canonicalization, archived-plan hiding, child FEATURE persistence rules, and body/front matter
  injection behavior.
- `src/cmd/plans/index.js` — extract/reuse current Epic/child/standalone/orphan grouping and child progress concepts so
  CLI and UI stay semantically aligned.
- `src/shared/workflow/plan-lifecycle.js` — extend lifecycle event/update helpers rather than introducing direct status
  writes from the board.
- `docs/plan-lifecycle.md` and `docs/prd/on-hold-plan-status.md` — use existing lifecycle language and hold/resume terms
  as the contract for UI copy and action gating.
- `prototypes/fresh-plan-ui/` — reuse proven stack decisions and Vite/UnoCSS/Fresh shape, but do not copy the BlockSuite
  Kanban proof as production board architecture.
- Fresh 2 Vite pattern — use Fresh for file routing/API routes/server rendering, Preact islands for hydrated
  interactions, and Vite for island/client bundling.
- CodeMirror 6 markdown pattern — use `codemirror` plus `@codemirror/lang-markdown` for source-preserving markdown
  editing.
- Existing worktree front matter fields — surface `worktreeStatus`, `worktreeBranch`, `worktreePath`, `failureReason`,
  and related recovery metadata read-only in Plan detail/cards.

## Verification Plan

- Automated: exact command(s) to run
  - `deno task ci`
  - `deno task -c src/ui/workspace/deno.json check`
  - `deno task -c src/ui/workspace/deno.json test`
  - If browser automation is added in the Workspace package, `deno task -c src/ui/workspace/deno.json e2e`
- Manual: precise user flows / checks
  - Run `wld plans` in a repo with existing Plans and verify current terminal output semantics remain intact.
  - Run `wld plans ui`; verify it starts on `127.0.0.1` by default, opens/prints a URL that bootstraps the session
    token, and shows Plans from the current checkout only.
  - Run `wld plans ui --bind 0.0.0.0` or equivalent explicitly and verify the command warns/documents that this exposes
    the local UI beyond loopback.
  - Start with Plans that lack `planId`; verify IDs are backfilled once, links remain stable after browser
    refresh/restart, and Plan bodies are unchanged.
  - Create or simulate duplicate existing `planId` values; verify the API fails loudly with a repair-oriented error
    instead of silently rewriting user data.
  - Open the active board and verify draft, feedback, approved, ready-for-decomposition, ready-for-work, in-progress,
    failed, and implemented columns/cards appear as supported.
  - Verify terminal statuses appear outside the active board: `verified` and `closed_without_verification` in the closed
    screen; `on_hold` in the on-hold screen.
  - Open a standalone FEATURE Plan card; verify read-first markdown rendering, front matter summary, worktree/dependency
    metadata, Edit action, and body-only save.
  - Edit a body, refresh before saving, and verify browser-local draft recovery; save explicitly and verify front matter
    remains valid and workflow-critical fields are unchanged.
  - Simulate an external disk edit between open and save; verify stale save protection prevents silent overwrite.
  - Move a Plan through allowed manual statuses and verify the API records lifecycle/manual updates through the central
    lifecycle module rather than direct YAML mutation.
  - Attempt blocked moves: FEATURE directly to `verified`, casual entry/exit of `failed`, Resume from hold without the
    designed Resume Check path, and any state-changing request without the token.
  - Open an Epic card; verify child progress, child list, dependencies, held children, failed children, and orphan-child
    behavior match `wld plans` concepts.
  - Put an Epic on hold and verify child FEATURE statuses do not change; held-Epic visibility/blocking comes from the UI
    hierarchy rules.
- Expected results for key scenarios
  - Markdown files remain canonical and readable by existing agents/CLI after UI edits.
  - `verified` is never produced by board movement for FEATURE Plans.
  - `closed_without_verification` gives users a terminal manual outcome without pretending Workflow Validation passed.
  - Plan URLs use stable `planId` values and continue resolving after title/name changes as long as the front matter ID
    remains.
  - Browser code cannot read arbitrary files; all Plan access is mediated by server-side adapters scoped to the
    checkout.

## Edge Cases & Considerations

- Existing Plans without `planId` — backfill must be idempotent and body-preserving. Build an index first, preserve
  existing IDs, and treat duplicates as a repair error rather than silently changing user data.
- File rename vs. durable URL — API responses should carry both `planId` and canonical `planName`; routes resolve by
  `planId`, while existing CLI workflows may continue using names/paths.
- Route shape — prefer stable project-scoped routes such as `/plans/:planId`, `/plans/closed`, `/plans/on-hold`, and
  query parameters for shareable filters. Optional readable slugs must not be required for lookup.
- Token handling — the launch URL may bootstrap the random token, but state-changing requests should send it in an
  explicit same-origin header. Do not enable permissive CORS, and do not expose arbitrary path read/write endpoints.
- Body save races — use a body hash/revision comparison to reject stale saves rather than overwriting external edits
  made by another RunWield process or editor.
- Front matter corruption — the default editor edits only body markdown. Structured controls and lifecycle APIs own
  status, dependencies, parent pointers, classification, complexity, worktree fields, and hold metadata.
- Lifecycle ambiguity — `manual_status_change` must be narrow. Anything that implies validation, recovery, failed-state
  repair, merge-back, or worktree cleanup remains outside drag-and-drop.
- On-hold dependency — the board can expose on-hold screens only after `on_hold` is implemented in the central lifecycle
  module. Do not fake held state as a UI-only category.
- Epic semantics — holding an Epic affects visibility/blocking of children but does not mutate child statuses; holding a
  child mutates only that child.
- Local server security — token, loopback binding, path sandboxing, no permissive CORS, and no raw arbitrary-path API
  are required even though this is localhost/plaintext.
- Fresh/Vite packaging — hydrated islands require the Fresh Vite pipeline. Avoid the direct `App.listen()` shortcut that
  the prototype found insufficient.
- JavaScript strictness — all executable code must be JavaScript/JSDoc. Do not add `.ts`, `.tsx`, interfaces, type
  aliases, or TypeScript syntax. If `.jsx` becomes unavoidable for Fresh ergonomics, return for an explicit design
  decision before proceeding.
- Dependency containment — keep UI dependencies under `src/ui/workspace/` as much as practical so the CLI core remains
  understandable and CI can check both the core and Workspace surfaces.
- Future collaboration — do not add a local database now, but keep REST resource shapes and URLs compatible with future
  project-scoped hosted/self-hosted routes and encrypted remote storage.
