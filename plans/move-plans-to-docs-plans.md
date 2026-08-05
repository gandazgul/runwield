---
planId: "cef05b40-ce1e-49db-b065-1a2054b3d8e8"
classification: "PLANNED_CHANGE"
workKind: "MAINTENANCE"
complexity: "MEDIUM"
summary: "Move the canonical RunWield Plan store from ./plans/ to ./docs/plans/ as a clean breaking change with no legacy fallback."
affectedPaths:
    - "CONTEXT.md"
    - "AGENTS.md"
    - "src/constants.js"
    - "src/plan-store.js"
    - "src/tools/plan-written.js"
    - "src/tools/plan-safe-file-tools.ts"
    - "src/tools/multi_file_edit.js"
    - "src/shared/session/tool-event-title.js"
    - "src/shared/session/workflow-context-session.js"
    - "src/shared/worktree.js"
    - "src/shared/workflow/*.js"
    - "src/shared/workflow/*.ts"
    - "src/shared/work-records/generation.js"
    - "src/cmd/load-plan/**"
    - "src/cmd/plans/**"
    - "src/cmd/registry.js"
    - "src/ui/**"
    - "src/agent-definitions/**"
    - "src/agent-definitions/document-formats/planner-plan-format.md"
    - "docs/**"
    - "plans/**"
    - "docs/plans/**"
    - "src/**/*.test.*"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-31T11:57:36-04:00"
updatedAt: "2026-08-05T15:54:10.719Z"
status: "validated_reviewer"
origin: "internal"
implementedAt: "2026-08-05T15:03:37.928Z"
userVerifiedAt: null
executionReport: "- Implemented clean-break Plan store move to `docs/plans/` across runtime code, tools, CLI flows, TUI/workflow surfaces, docs, release guidance, scripts, and tracked Plan files; no tracked `plans/**/*.md` remain.\n- Fixed discovered `plans doctor` root/path bug by passing the project root explicitly into recursive Plan issue collection, so active Plans under `docs/plans/` no longer false-report `plan_not_found`.\n- Added regression coverage: `src/plan-store.test.js` verifies legacy `plans/` files are ignored; `src/tools/__tests__/plan-written.test.js` verifies `plan_written` rejects legacy-only `plans/<name>.md` and accepts `docs/plans/<name>.md`.\n- Test changes: +2 automated tests total; no tests removed. Existing path/assertion tests were rewritten to the new `docs/plans/` store shape; legacy behavior coverage remains only where it proves old `plans/` is ignored or treated as implementation diff.\n- Verification passed: targeted `deno run -A scripts/run-tests.js ...` suite passed `293 passed | 0 failed`; `deno task test` passed `247 files passed | 0 failed`; `deno task ci` passed fully.\n- Objective checks passed: `getStoredPlanPath(\"/project\", \"demo\")` returned `/project/docs/plans/demo.md`; `git ls-files 'plans/*.md' 'plans/**/*.md'` returned empty; final grep left only intentional legacy regression text."
humanReviewMode: "always"
humanReviewDecision: "approved"
humanReviewedAt: "2026-08-05T15:54:10.697Z"
executionMode: "worktree"
executionBaselineTree: "bd4b729fffdc2deb74dec8b4124b6ae12d80ee47"
worktreeId: "8aeef850"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-move-plans-to-docs-plans-8aeef850"
worktreeBranch: "worktree/move-plans-to-docs-plans-8aeef850"
worktreeBaseBranch: "main"
worktreeStatus: "completed"
routingIntent: "PLANNED_CHANGE"
sessionName: "docs plans relocation"
validationCiAttempts: 0
validationSemanticRounds: 2
---

# Move Plans to docs/plans

## Context

RunWield currently treats `plans/` as the canonical repository-local Plan store. `src/constants.js` exports
`PLANS_DIR_NAME = "plans"`, `src/plan-store.js` uses that constant for most save/load/list/archive operations, and docs
plus Agent instructions describe Plans as Markdown files under `plans/`.

The requested outcome is a clean breaking change: the canonical Plan store becomes `docs/plans/`, archived Plans move
from `plans/archived/` to `docs/plans/archived/`, and users are told in release notes to move their existing folder
themselves. This Planned Change must not add compatibility scanning, migration commands, fallback reads, aliases,
symlinks, or warnings that continue to treat `plans/` as a supported location.

`CONTEXT.md` currently defines a Plan as living in `plans/`, so the implemented change also redefines canonical domain
language. The glossary must move in the same implementation as the behavior.

## Objective

Make `docs/plans/` the only supported Plan store path across RunWield code, tests, Agent instructions, and current
documentation.

The final repository state must be a clean break:

- Active Plans live at `docs/plans/<plan-name>.md`.
- Child PLANNED_CHANGE Plans live at `docs/plans/<epic-name>/<child-name>.md`.
- Archived Plans live at `docs/plans/archived/<plan-name>.md`.
- `plans/` is not read, listed, archived, restored, protected by Plan compare-and-swap (CAS), used for Workflow
  Validation scope, or described as supported current behavior.
- Existing repository Plan Markdown is physically moved from `plans/` to `docs/plans/`, preserving nested active and
  archived relative paths.

## Approach

Centralize the new store path first, then update every runtime path assumption to use that canonical path. Prefer shared
helpers over scattering the new string where code builds Plan paths, but do not preserve old `plans/` parsing as
compatibility behavior.

Recommended implementation shape:

1. Replace the current Plan store constant with a canonical project-relative store path value of `docs/plans` and update
   helper names/comments if needed so the symbol does not imply a single path segment.
2. Keep Plan names stable and relative to the Plan store. For example, `epic/01-child` remains the Plan name; only its
   project-relative file path changes from `plans/epic/01-child.md` to `docs/plans/epic/01-child.md`.
3. Update `plan-store` archive/restore metadata paths, resource `relativePath` values, parse errors, and user-facing
   messages to report `docs/plans/...`.
4. Update lifecycle, worktree, validation, Work Record provenance, session footer, `plan_written`, Plan-safe edit
   wrappers, and command prompts so they only target `docs/plans/...`.
5. Move existing repository Plan files from `plans/` to `docs/plans/` and delete the old `plans/` tree from tracked
   state.
6. Update current docs, glossary, ADR references that describe implemented behavior, and bundled Agent
   instructions/templates so future Planner/Architect/Slicer output goes to `docs/plans/`.
7. Add tests that prove legacy `plans/` files are ignored rather than migrated or accepted.

Do not implement a startup migration, `plans/` fallback, dual scan, symlink support, deprecation period, or command that
silently moves user files. The release-note guidance is explicit manual action: users must move `plans/` to
`docs/plans/` before using the new release.

## Files to Modify

- `CONTEXT.md` — redefine Plan storage, Slicer child Plan materialization, stable relationships, and avoided aliases so
  canonical language says `docs/plans/`.
- `AGENTS.md` — update contributor-facing references to the Plan location.
- `src/constants.js` — change the canonical Plan store path constant from `plans` to `docs/plans`; update comments/names
  if the existing `PLANS_DIR_NAME` name becomes misleading.
- `src/plan-store.js` — update Plan path resolution, canonicalization messages, relative path formatting,
  archive/restore paths, plan resource docs, onboarding comments, and archive metadata paths to `docs/plans/`.
- `src/tools/plan-written.js` — make `plan_written` validate, display, and prompt for `docs/plans/<name>.md`; remove
  `plans/` input stripping unless replaced by clean canonical normalization for `docs/plans/` only.
- `src/tools/plan-safe-file-tools.ts` and `src/tools/multi_file_edit.js` — make Plan-file CAS protection apply only to
  active Plan Markdown under `docs/plans/`, excluding `docs/plans/archived/`; do not protect legacy `plans/*.md` as Plan
  files.
- `src/shared/session/tool-event-title.js` and `src/shared/session/workflow-context-session.js` — display and normalize
  workflow Plan paths using `docs/plans/` only.
- `src/shared/worktree.js` — update Plan merge preservation, Plan-path guards, and git pathspecs from `plans/*.md` to
  the new canonical store path.
- `src/shared/workflow/plan-lifecycle.js`, `src/shared/workflow/validation.ts`,
  `src/shared/workflow/validation-legacy.ts`, `src/shared/workflow/validation-scope.ts`,
  `src/shared/workflow/workflow.js`, `src/shared/workflow/workflow-prompts.js`,
  `src/shared/workflow/epic-continuation.js`, and `src/shared/workflow/state-transition.ts` — update lifecycle Delivery
  Evidence paths, allowed dirty paths, prompts, validation scope, and recovery descriptions to use `docs/plans/`.
- `src/shared/work-records/generation.js` — record Plan provenance paths as `docs/plans/<name>.md` for active Plan
  sources.
- `src/cmd/load-plan/**` — update user prompts, path-based loading guidance, dirty-path allowances, direct path
  handling, and tests to the new store path.
- `src/cmd/plans/archive.js`, `src/cmd/plans/read.js`, `src/cmd/plans/share.js`, `src/cmd/plans/doctor.ts`, and related
  tests — update archive/read/share/doctor output, repair instructions, grep suggestions, and path assertions to
  `docs/plans/`.
- `src/cmd/registry.js` — update CLI help examples and notes that currently say `plans/<plan>.md` or `plans/archived/`.
- `src/ui/**` tests and fixtures — update Plan file `relativePath` expectations and file fixtures to `docs/plans/...`;
  do not rename browser routes like `/plans/:planId`, which are UI resource routes rather than filesystem paths.
- `src/agent-definitions/planner.md`, `src/agent-definitions/architect.md`, `src/agent-definitions/guide.md`,
  `src/agent-definitions/ideator.md`, `src/agent-definitions/workflow-prompts/slicer-prompt.md`, and
  `src/agent-definitions/document-formats/planner-plan-format.md` — instruct Agents to write Plans under `docs/plans/`.
- `docs/usage.md`, `docs/index.md`, `docs/workflows.md`, `docs/plan-lifecycle.md`, `docs/architecture.md`,
  `docs/entity-model.md`, `docs/product-rules.md`, `docs/troubleshooting.md`, `docs/user-facing-features.md`,
  `docs/contributing.md`, `docs/prd/runwield-core-prd.md`, `docs/adr/007-local-first-workspace-plan-board.md`, and
  `docs/adr/008-plan-archival-and-retrieval.md` — update current behavior documentation to `docs/plans/`, including
  archive examples.
- `RELEASING.md` and/or `src/prompt-templates/release.md` — ensure the release process has explicit copy for this
  breaking change if the repository keeps release-note instructions in source rather than a tracked changelog.
- `plans/**` and `docs/plans/**` — move existing repository Plan Markdown from `plans/` to `docs/plans/`, preserving
  active, child, and archived layout; remove the old tracked `plans/` files.
- `src/**/*.test.*` — update fixtures/assertions and add regression tests proving the clean break.

## Reuse Opportunities

- `src/plan-store.js#getPlansDir`, `getStoredPlanPath`, `projectRelativePath`, and archive helpers — reuse as the
  primary store-location authority rather than rebuilding paths in callers.
- `src/constants.js` — keep one exported source of truth for the project-relative Plan store path.
- `src/shared/workflow/execution-plan-file.js` — already routes canonical execution Plan file paths through
  `getStoredPlanPath`; update tests around it rather than duplicating path logic.
- Existing Plan archive/list/restore tests in `src/plan-store.test.js` and `src/cmd/plans/archive.test.js` — reuse as
  the main coverage for path migration.
- Existing Workflow Validation scope tests in `src/shared/workflow/validation-scope.test.ts` — extend them so Plan-only
  diffs under `docs/plans/` still fail validation while legacy `plans/` is not treated as canonical Plan metadata.

## Implementation Steps

- [ ] `src/constants.js` exports a single canonical Plan store path whose value is `docs/plans`, and runtime code no
      longer defines `plans` as an alternate Plan store root.
- [ ] `src/plan-store.js#getPlansDir("/project")` resolves to `/project/docs/plans`,
      `getStoredPlanPath("/project", "epic/child")` resolves to `/project/docs/plans/epic/child.md`, and Plan names
      remain store-relative names such as `epic/child`.
- [ ] Active Plan list/load/save, child Plan materialization, adoption of plain Markdown, and Plan resource
      `relativePath` values use `docs/plans/...` and ignore Markdown that exists only under legacy `plans/`.
- [ ] Archive and restore behavior uses `docs/plans/archived/...`, writes `archivedFromPath`, `restoredFromPath`, CLI
      messages, malformed-file errors, and doctor guidance with `docs/plans/...`, and does not scan `plans/archived/`.
- [ ] `plan_written` requires the submitted Plan file to exist at `docs/plans/<planName>.md`, prints
      `Plan name: docs/plans/<planName>.md`, and fails when the same file exists only under `plans/<planName>.md`.
- [ ] Plan-safe file wrappers apply Plan CAS protection to active `docs/plans/**/*.md` files only, exclude
      `docs/plans/archived/**`, and treat legacy `plans/**/*.md` as ordinary non-canonical Markdown.
- [ ] Workflow prompts, session footer/tool titles, Plan Workflow Lease context, `/load-plan` recovery/review/execute
      messages, allowed dirty paths, and state-transition recovery instructions display and preserve
      `docs/plans/<planName>.md`.
- [ ] Worktree publication and merge-preservation code accepts only `docs/plans/**/*.md` Plan paths, uses git pathspecs
      for `docs/plans/*.md` or the equivalent recursive pathspec, and preserves finalized Plan files under the new
      location.
- [ ] Workflow Validation classifies diffs that only change `docs/plans/**/*.md` as Plan-only and therefore insufficient
      implementation work, while legacy `plans/**/*.md` no longer receives special Plan-document treatment.
- [ ] Work Record source provenance for newly generated records points to `docs/plans/<planName>.md`.
- [ ] Bundled Planner, Architect, Guide, Ideator, Slicer, and Plan format instructions tell Agents to create and refer
      to Plan files under `docs/plans/`.
- [ ] `CONTEXT.md` describes a Plan as Markdown under `docs/plans/`, Slicer child Plans as materialized under
      `docs/plans/<epic-name>/`, and stable relationships without the old `plans/` location.
- [ ] Current user/contributor/architecture/lifecycle docs describe `docs/plans/` and `docs/plans/archived/`; historical
      Work Records may keep old source paths only when they are explicitly historical evidence, not current guidance.
- [ ] Release guidance includes explicit breaking-change copy: “RunWield now reads Plans only from `docs/plans/`. Before
      upgrading, move your existing `plans/` directory to `docs/plans/`; the release does not migrate or read the old
      location.”
- [ ] All tracked repository Plan Markdown previously under `plans/` is moved to `docs/plans/` with nested layout
      preserved, and no tracked files remain under `plans/`.
- [ ] Tests are updated and extended so at least one regression test fails on today’s code because legacy `plans/` is
      still accepted or `docs/plans/` is not yet canonical.

## Verification Plan

- Automated: run targeted tests through the sandboxed runner, not `deno test` directly:
  - `deno run -A scripts/run-tests.js src/plan-store.test.js src/tools/__tests__/plan-written.test.js src/tools/plan-safe-file-tools.test.js src/cmd/plans/archive.test.js src/cmd/plans/read.test.js src/cmd/plans/doctor.test.js src/cmd/load-plan/load-plan-discovery.test.js src/shared/session/workflow-context-session.test.js src/shared/session/tool-event-title.test.js src/shared/workflow/execution-plan-file.test.js src/shared/workflow/plan-lifecycle.test.js src/shared/workflow/validation-scope.test.ts src/shared/worktree-plan-handoff.test.js src/shared/work-records/work-records.test.js src/ui/workspace/workspace-local-server.test.js`
  - `deno task test`
  - `deno task ci`
- Objective check that fails on today’s code:
  `deno eval 'import { getStoredPlanPath } from "./src/plan-store.js"; const path = getStoredPlanPath("/project", "demo").replaceAll("\\\\", "/"); if (path !== "/project/docs/plans/demo.md") throw new Error(path);'`
- Clean-break filesystem check that fails until the repository Plan files are moved:
  `test -z "$(git ls-files 'plans/*.md' 'plans/**/*.md')"`
- Clean-break behavior check to implement as automated tests in `src/plan-store.test.js` and
  `src/tools/__tests__/plan-written.test.js`:
  - a temp project containing only `plans/legacy.md` is not returned by `listPlans`, cannot be loaded by
    `loadPlan(cwd, "legacy")`, and is not accepted by `plan_written`;
  - the same Plan under `docs/plans/current.md` is listed, loaded, and accepted.
- Validation-scope behavior check to implement in `src/shared/workflow/validation-scope.test.ts`:
  - a diff that only touches `docs/plans/demo.md` is Plan-only and cannot satisfy implementation validation;
  - a diff that only touches `plans/demo.md` is not treated as canonical Plan metadata after the breaking change.
- Manual: from a temporary project, create `docs/plans/manual.md`, run `wld plans`, `wld load-plan manual`,
  `wld load-plan docs/plans/manual.md`, `wld plans archive manual --reason test`, and
  `wld plans archive restore manual --to manual-restored`; expected output uses only `docs/plans/...` paths.
- Manual: in a temporary project containing only `plans/legacy.md`, run `wld plans` and `wld load-plan legacy`; expected
  result is no Plan listing and a not-found error with no migration offer or fallback suggestion.
- Existing behavior that must remain protected: Plan names remain stable and store-relative; active listings hide
  archived Plans; archive/restore preserves nested child Plan layout; Plan CAS protects active Plan files from stale
  overwrite; Worktree publication preserves finalized Plan metadata; Workflow Validation still rejects implementation
  attempts that only modify Plan documents.
- Behavior expected to stop existing: `plans/` and `plans/archived/` are no longer canonical, no longer scanned, no
  longer protected as Plan files, and no longer presented in current docs/help as valid storage locations.
- Glossary check: `CONTEXT.md` and current docs agree that the implemented Plan store is `docs/plans/`; old `plans/`
  references remain only in explicitly historical Work Records or release-note breaking-change instructions.

## Edge Cases & Considerations

- Self-hosting risk: this repository’s current RunWield lifecycle may still be running from code that expects `plans/`
  while implementing the change. The implementation must still leave the final committed repository with no tracked
  `plans/**/*.md`; if the active execution environment recreates an old-path Plan file during validation, treat that as
  a lifecycle/tooling artifact to reconcile before final delivery, not as supported compatibility behavior.
- This is intentionally not backward compatible. Do not add fallback reads, dual listings, migration commands, startup
  repair, symlink support, or “try `plans/` if `docs/plans/` is missing” code.
- Browser Workspace and API routes containing `/plans/` are not filesystem paths. Keep those routes unless a specific
  test proves a filesystem path is being displayed or resolved incorrectly.
- The CLI command group remains `wld plans`; this request changes the repository storage path, not the command name.
- Historical Work Records and old completed Plan text can mention `plans/` as past evidence. Current docs, help, Agent
  instructions, and runtime messages must use `docs/plans/`.
- Users must manually move their existing folders before using the release. The required release-note message is part of
  this Plan’s acceptance criteria because there is no legacy migration path to save them at runtime.
