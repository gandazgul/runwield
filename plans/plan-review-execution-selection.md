---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add structured execution Agent and Pair/autonomous controls to FEATURE Plan Review, delete the committed prototype after absorbing its winner, and enforce one ignored prototype workflow for future experiments."
affectedPaths:
    - ".gitignore"
    - "deno.json"
    - "scripts/run-prototype.js"
    - "scripts/run-prototype.test.js"
    - "src/skills/prototype/SKILL.md"
    - "src/skills/prototype/UI.md"
    - "src/skills/prototype/LOGIC.md"
    - "src/ui/workspace/react/PlanReviewSurface.tsx"
    - "src/ui/workspace/react/ReviewDevSurface.tsx"
    - "src/ui/workspace/react/ExecutionSelectionPrototype.tsx"
    - "src/ui/workspace/react/execution-selection-prototype.css"
    - "src/ui/workspace/react/plannotator.css"
    - "src/ui/workspace/react/review-types.ts"
    - "src/ui/workspace/routes/api/review-handlers.js"
    - "src/ui/workspace/server.js"
    - "src/ui/workspace/workspace.test.js"
    - "src/ui/review/review-launcher.js"
    - "src/ui/review/review-launcher.test.js"
    - "src/ui/review/plan-review.js"
    - "src/ui/review/plan-review.test.js"
    - "src/ui/tui/runtime-interaction-adapter.test.js"
    - "src/tools/plan-written.js"
    - "src/tools/__tests__/plan-written.test.js"
    - "src/cmd/load-plan/index.js"
    - "src/cmd/load-plan/index.test.js"
    - "docs/workflows.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev:plan-review"
devServerUrl: "http://127.0.0.1:5173/dev/plan-review"
devServerHmr: true
createdAt: "2026-07-23T17:51:15-04:00"
updatedAt: "2026-07-24T03:30:57.763Z"
status: "implemented"
origin: "internal"
implementedAt: "2026-07-24T03:30:57.763Z"
worktreeStatus: "completed"
---

# Plan Review Execution Selection

## Context

FEATURE Plans already record two execution-policy fields: `executionAgent` chooses **Engineer** or **Frontend
Engineer**, and `collaborationRecommendation` chooses autonomous work or recommends **Pair Execution**. Runtime
execution reloads those fields through `resolvePlanExecutionPolicy()`; a canonical Frontend Engineer Pair recommendation
activates Pair only when the attached host supports Pair checkpoints, otherwise execution falls back to autonomous
without changing the Plan.

Plan Review currently hides that policy inside Front Matter and exposes only approval actions. Users cannot easily see
who will implement the Plan or change the execution style before approval. The selected browser prototype resolves that
problem with a balanced toolbar: Options at the far left before the RunWield logo, compact execution controls at the top
right, separate secondary Feedback/deferred actions, and one primary immediate action.

The prototype is intentionally throwaway, but it was committed under production source in commits `70030170` and
`24ad56ce`. Its dev-only variant switcher, duplicate action components, `title`-based hints, and prototype CSS must be
deleted from the current tree after the accepted behavior is rewritten for production; preserving Git history does not
mean preserving the prototype files.

The commit happened because repository policy is contradictory. `.gitignore` already ignores root `prototypes/`, but the
folder is absent, `deno.json` has a stale task for a removed ignored prototype, and the bundled Prototype Skill tells
agents to place throwaway files beside production modules. This feature must close that gap with one ignored
`prototypes/<slug>/` layout, one generic launcher, updated Skill instructions, and a CI guard against tracked throwaway
artifacts under production source.

The production change must also carry policy changes through the review transport and lifecycle safely.
`submitPlanForReview()`, `plan_written`, and loaded-Plan re-review currently retain pre-review metadata snapshots; if a
browser policy edit were written without refreshing those snapshots, the next lifecycle event could overwrite it.
Approval therefore needs one canonical post-review metadata handoff.

## Objective

For executable FEATURE Plans, make Plan Review clearly show and directly edit:

- execution Agent: **Frontend Engineer** or **Engineer**;
- execution style: **Pair Execution** or **Autonomous**.

Choosing Engineer must immediately select Autonomous and disable Pair because Pair Execution is frontend-only. Both
**Approve & Run** and **Approve for Later** must atomically persist the selected canonical Front Matter before recording
approval/readiness. Sending Feedback must not persist execution-control changes.

Apply the approved Variant D toolbar treatment:

- place the hamburger-only Options trigger before the RunWield logo and open its menu rightward into the viewport;
- place compact, unlabeled segmented Agent/style controls in the top-right action area with accessible group names and
  concise real tooltips;
- render **Send Feedback** and **Approve for Later** as equal-sized secondary controls;
- render **Approve & Run** as the equal-sized sole primary control with a clearly perceptible hover treatment;
- preserve the existing PROJECT Epic behavior: no execution controls and **Approve & Slice** / **Approve for Later**
  semantics remain classification-aware.

Delete the committed execution-selection prototype after absorbing Variant D, and establish a repository-wide throwaway
prototype convention:

- every prototype lives only under gitignored `prototypes/<kebab-case-slug>/`;
- every prototype has a local `deno.json` with a `dev` task and is launched as `deno task prototype <slug>`;
- UI and logic prototype instructions use the same root layout and never modify `src/`, tracked routes, or production
  task entries to host variants;
- CI fails when a tracked production file contains the required throwaway marker or uses a prototype-only filename.

## Approach

Treat execution selection as a structured Plan edit during the Review Loop, not as a second runtime prompt or a new
persistent `collaborationMode`. The reviewed choice updates `executionAgent` and `collaborationRecommendation`; runtime
style remains derived from the approved recommendation plus current host capability.

Resolve the initial FEATURE policy on the trusted server side with `resolvePlanExecutionPolicy()` and include the
canonical Front Matter/policy in the review payload. The React surface should initialize from that payload rather than
Plannotator's display-oriented Front Matter extractor, which preserves YAML quote characters and is not a workflow
validation boundary.

On approval, submit canonical `executionAgent` and `collaborationRecommendation` values alongside `approvalAction`.
Validate the enum/matrix at the token-protected review API without consuming the one-shot decision on invalid input,
then apply the values to the edited Plan through `injectFrontMatter()`. Clear a legacy `frontend` field when canonical
policy is approved, preserving equivalent behavior while preventing redundant ownership metadata. Re-parse the resulting
Plan, record the review lifecycle event with fresh metadata, and return the resulting canonical Plan attributes through
the PLAN_REVIEW Runtime metadata.

Make both downstream approval consumers use those post-review attributes. `plan_written` must run readiness and return
its orchestration result from the approved metadata, while loaded-Plan re-review must refresh its in-memory Plan before
readiness, affected-path confirmation, Slicer dispatch, or execution. This preserves Approve for Later, immediate
execution, recovery, and host capability fallback without changing Plan Lifecycle states or Pair checkpoint semantics.

For prevention, keep the ignored prototype contents local while committing only the convention and runner. Replace the
stale named task with `deno task prototype <slug>` backed by `scripts/run-prototype.js`; the runner validates a safe
kebab-case slug, resolves `prototypes/<slug>/deno.json`, verifies the path is ignored, requires its `dev` task, and
forwards execution to Deno with inherited I/O. Update the Prototype Skill to require the same ignored
`prototypes/<slug>/` README/config/source shape across projects while using each project's native task runner
(`deno.json` in RunWield). A focused repository test should assert `prototypes/` remains ignored and untracked and
reject tracked production files carrying `THROWAWAY PROTOTYPE` or prototype-only naming. This catches the original
failure even if someone force-adds an ignored file.

## Files to Modify

- `.gitignore` — retain `prototypes/` as the single throwaway root and document that executable prototype contents must
  never be tracked or placed beside production source.
- `deno.json` — replace the stale `prototype:plan-ui` entry with the generic `deno task prototype <slug>` launcher.
- `scripts/run-prototype.js` — validate the slug/ignored config contract and run the prototype-local `dev` task with
  inherited terminal I/O and clear missing/invalid setup errors.
- `scripts/run-prototype.test.js` — cover slug/path/config validation and enforce the repository guard: ignored
  `prototypes/`, no tracked prototype-root files, and no tracked production throwaway marker/prototype-only filename.
- `src/skills/prototype/SKILL.md` — replace beside-production placement with the mandatory ignored root, path-ignore
  preflight, project-native local task config, one-command launch, and cleanup/answer-capture boundary; document the
  RunWield-specific `deno task prototype <slug>` example without imposing Deno on other projects.
- `src/skills/prototype/UI.md` — preserve real-app design context without editing production routes: build the fixture
  host under `prototypes/<slug>/`, import stable source/design-system modules where practical, and keep the `?variant=`
  switcher entirely in ignored files.
- `src/skills/prototype/LOGIC.md` — place the terminal shell and portable logic under the same ignored slug directory
  with a prototype-local `dev` task rather than adding a named root task.
- `src/ui/workspace/react/PlanReviewSurface.tsx` — absorb Variant D as production FEATURE behavior; initialize canonical
  policy state, enforce Engineer/autonomous coupling, submit policy only with approval, move Options before the logo,
  render separate approval actions, and preserve PROJECT behavior and pending/error states.
- `src/ui/workspace/react/ReviewDevSurface.tsx` — keep useful FEATURE/PROJECT fixture switching but remove prototype
  activation; ensure the FEATURE fixture exercises both canonical choices and PROJECT remains selection-free.
- `src/ui/workspace/react/ExecutionSelectionPrototype.tsx` — delete after its accepted interaction details are absorbed.
- `src/ui/workspace/react/execution-selection-prototype.css` — delete after production styles move to the owned review
  stylesheet.
- `src/ui/workspace/react/plannotator.css` — add only Plan Review-specific segmented-control, responsive wrapping,
  left-anchored menu, and strong primary-hover rules using RunWield semantic tokens.
- `src/ui/workspace/react/review-types.ts` — type the trusted initial Plan Front Matter/policy and approved execution
  fields in the review payload/decision.
- `src/ui/workspace/routes/api/review-handlers.js` — validate and forward canonical execution policy on approval only;
  malformed, PROJECT-incompatible, or Engineer+Pair input must return an actionable 4xx response without resolving the
  one-shot review decision.
- `src/ui/workspace/server.js` — expose trusted review payload metadata to the decision handler so classification-aware
  validation cannot rely on browser-submitted classification.
- `src/ui/workspace/workspace.test.js` — cover transport of both valid FEATURE combinations, invalid/tampered policy,
  PROJECT rejection, payload integrity, and retry after a rejected request.
- `src/ui/review/review-launcher.js` and `review-launcher.test.js` — include canonical initial Front Matter/policy in
  the Workspace-hosted Plan Review payload without exposing server-only Plan-store code to the browser bundle.
- `src/ui/review/plan-review.js` — apply approved policy to the edited Plan before lifecycle mutation, preserve the
  shared-plan write guard, canonicalize legacy ownership, pass fresh attributes into `review_approved`, and return the
  post-event Plan attributes to workflow consumers.
- `src/ui/review/plan-review.test.js` — prove approved choices persist before lifecycle/readiness, Feedback does not
  persist them, edited Markdown and unknown Front Matter survive, invalid policy has no write/lifecycle side effects,
  and canonical post-review attributes are returned.
- `src/ui/tui/runtime-interaction-adapter.test.js` — prove canonical post-review attributes survive PLAN_REVIEW Runtime
  metadata unchanged; do not add a second TUI selection.
- `src/tools/plan-written.js` and `src/tools/__tests__/plan-written.test.js` — replace stale pre-review policy with the
  trusted post-review attributes before readiness and orchestration; test Engineer/autonomous and Frontend Engineer/Pair
  for immediate and deferred approval.
- `src/cmd/load-plan/index.js` and `src/cmd/load-plan/index.test.js` — refresh the loaded Plan after re-review so
  readiness, affected-path confirmation, Slicer branching, and execution use the approved policy while preserving
  concurrent automatic Epic-continuation work.
- `docs/workflows.md` — after reconciling concurrent Epic-continuation edits, document that FEATURE Plan Review exposes
  structured owner/recommendation controls, approvals persist them, and unsupported hosts still derive autonomous
  execution without overwriting a Pair recommendation.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `.gitignore`'s existing `prototypes/` rule — preserve the intended local-only root instead of inventing another
  scratch location.
- `Deno.Command` and `Deno.execPath()` — launch the prototype's local `dev` task without shell interpolation or adding a
  package manager.
- `src/skills/prototype/UI.md`'s `?variant=` switcher and fixture guidance — keep the useful comparison behavior while
  relocating every executable artifact out of production source.
- `src/plan-store.js#resolvePlanExecutionPolicy` — canonical defaults, legacy compatibility, PROJECT restrictions, and
  the Engineer+Pair validation matrix.
- `src/plan-store.js#injectFrontMatter` — preserve unknown/user-authored Front Matter and body content while validating
  canonical policy writes and removing obsolete `collaborationMode` metadata.
- `src/ui/workspace/react/PlanReviewSurface.tsx#submit` — existing one-shot request, local error, disabled/loading, and
  completion-overlay behavior.
- `third_party/plannotator/packages/ui/components/ToolbarButtons.tsx` and `ui/button.tsx` — existing compact outline and
  success button geometry so Feedback, deferred approval, and immediate approval remain aligned.
- `third_party/plannotator/packages/ui/components/Tooltip.tsx` — accessible hover/focus explanations for the visually
  unlabeled Agent and style groups.
- `third_party/plannotator/packages/ui/components/ActionMenu.tsx` — outside-click/Escape behavior, with an explicit
  `left-0` panel alignment for the far-left Options anchor.
- `src/shared/workflow/plan-approval.js` — retain classification-aware `run`, `decompose`, and `later` normalization.
- `src/shared/workflow/workflow.js#selectRuntimeCollaborationStyle` — keep current Pair-capability derivation and
  autonomous fallback; this feature changes approved Plan policy, not runtime checkpoint architecture.
- `src/shared/workflow/plan-lifecycle.js#recordPlanEvent` — preserve existing Review Loop/readiness transitions while
  supplying refreshed canonical attributes.

## Implementation Steps

- [ ] Replace the stale `prototype:plan-ui` task with `deno task prototype <slug>`. Implement a pure-JavaScript/JSDoc
      runner that accepts exactly one safe kebab-case slug, confirms `prototypes/<slug>/` is ignored, requires a
      readable local `deno.json` with a `dev` task, then runs `deno task -c <config> dev` without shell interpolation.
- [ ] Update `.gitignore` commentary and the Prototype Skill so every prototype starts under `prototypes/<slug>/` with
      `README.md`, a project-native local task config (`deno.json` in RunWield), and branch-specific source. Require
      `git check-ignore` before writing; forbid prototype imports, routes, switchers, CSS, named root tasks, or markers
      under tracked production directories.
- [ ] Revise UI guidance to create an ignored fixture host that imports stable production components/tokens where useful
      and reproduces the target route's real density without patching that route. Revise logic guidance to keep both the
      state model and terminal shell inside the ignored slug folder; production code receives only a later rewrite of
      the validated conclusion.
- [ ] Add runner/convention tests for safe and unsafe slugs, missing config/dev task, ignored-path enforcement, and
      command construction. Add the CI repository scan for tracked `prototypes/**`, `THROWAWAY PROTOTYPE` in production,
      `*.prototype.*`, and `*Prototype.*` production filenames; exclude the Skill documentation and test fixtures
      deliberately rather than weakening the guard globally.
- [ ] Add focused review payload/decision typedefs for canonical `executionAgent`, `collaborationRecommendation`, and
      post-review Plan attributes; keep Workspace executable code in the existing TSX exception and all non-Workspace
      code pure JavaScript/JSDoc.
- [ ] Resolve the current Plan execution policy before launching Plan Review and pass trusted classification plus
      canonical owner/recommendation through `review-launcher` and the Workspace review payload. Keep PROJECT payloads
      explicitly non-executable.
- [ ] Replace prototype-derived parsing with trusted initialization in `PlanReviewSurface`. Missing canonical FEATURE
      fields must display the existing compatibility result from `resolvePlanExecutionPolicy()`; legacy `frontend: true`
      displays Frontend Engineer/autonomous until approval canonicalizes it.
- [ ] Implement the production segmented controls with real fieldset/legend semantics, visually hidden group names,
      `aria-pressed` selected states, keyboard activation, visible focus, and Plannotator `Tooltip` explanations. The
      Agent tooltip should distinguish materially visual/browser work from general implementation; the style tooltip
      should explain Pair checkpoints, autonomous handoff, and Pair-capable-host fallback briefly.
- [ ] Enforce the selection matrix in React: choosing Engineer changes style to Autonomous and disables Pair; returning
      to Frontend Engineer leaves Autonomous selected until the user explicitly chooses Pair. Selection must remain
      visible in text, not color alone.
- [ ] Move the icon-only Options trigger before the logo for Plan Review, align its panel with `left-0`, and verify the
      panel remains inside the viewport. Do not change read-only artifact or code-review toolbars unless they share this
      exact Plan Review component.
- [ ] For FEATURE Plans, replace the split approval control with direct compact actions ordered as execution controls,
      Send Feedback, Approve for Later, and Approve & Run. Match Feedback's height and radius for both approval buttons;
      keep Approve & Run primary and add the approved strong tonal shift, ring/shadow, and slight lift on hover without
      weakening focus-visible styling.
- [ ] Preserve PROJECT Epic controls and approval normalization: hide execution policy controls, keep Approve & Slice as
      the primary classification-compatible action, and retain safe fallback for invalid actions.
- [ ] Submit policy fields only from approval actions. Send Feedback must continue carrying annotations, attachments,
      and edited Plan content but must not commit temporary execution-control changes.
- [ ] Extend the review API with classification-aware policy validation based on trusted review state. Invalid enum,
      Engineer+Pair, or PROJECT policy submissions must return 400, leave the review promise registered, show the
      existing local error, and allow correction/retry without lifecycle mutation.
- [ ] In `submitPlanForReview`, combine the browser-edited Plan with the approved structured policy through
      `injectFrontMatter`, clear legacy `frontend`, and write only after validation succeeds. Re-parse the canonical
      candidate, pass fresh attributes to `review_approved`, and return the attributes produced by the lifecycle event.
- [ ] Keep cancellation and Feedback behavior unchanged: cancellation writes no selection; Feedback may preserve an
      explicitly edited Markdown document under existing behavior but does not apply the execution-control state.
- [ ] Update PLAN_REVIEW Runtime metadata and both approval consumers to use trusted post-review attributes. Ensure
      `plan_written` cannot overwrite the selection with `effectiveMeta`, and loaded-Plan re-review cannot pass stale
      `plan.attrs` into readiness, affected-path confirmation, Slicer, or `executePlan`.
- [ ] Delete the committed `ExecutionSelectionPrototype.tsx` and `execution-selection-prototype.css` files from the
      current tree and remove every import, dev-only prop, all four variants, URL/keyboard switcher, scalar-unquoting
      helper, prototype class name, and prototype-only payload log. Do not move these obsolete files under the ignored
      root: the answer is the new production implementation, and the old commits remain only as history.
- [ ] Update focused tests and documentation, then run the complete Workspace/browser/CI validation sequence. Re-read
      dirty concurrent files immediately before editing and preserve unrelated automatic Epic-continuation changes.

## Verification Plan

- Automated: run `deno test -A scripts/run-prototype.test.js` and verify launcher validation, ignored-path enforcement,
  command construction, no tracked files under `prototypes/`, and no throwaway marker/prototype-only artifact under
  production source. Confirm the scan fails against a temporary reproduction of the committed-prototype mistake.
- Automated: inspect `git ls-files 'prototypes/**' ':(glob)src/**/*[Pp]rototype*'` and confirm it returns no production
  prototype artifact after the committed execution-selection files are deleted.
- Automated: run
  `deno test -A src/ui/workspace/workspace.test.js src/ui/review/review-launcher.test.js src/ui/review/plan-review.test.js src/ui/tui/runtime-interaction-adapter.test.js`
  and verify trusted initial policy, valid approval transport, invalid-request retry, edited Plan preservation,
  approval-only persistence, lifecycle ordering, and post-review metadata handoff.
- Automated: run `deno test -A src/tools/__tests__/plan-written.test.js src/cmd/load-plan/index.test.js` and verify both
  approval paths use refreshed owner/recommendation values, Approve for Later persists them without execution, Approve &
  Run dispatches the approved Agent, and PROJECT behavior is unchanged.
- Automated: run `deno task workspace:check` and `deno task workspace:build` to verify Astro/React boundaries,
  Plannotator imports, Tailwind class discovery, and production removal of prototype modules.
- Automated: run `deno task ci` after implementation and fix all failures. If unrelated concurrent files are still
  dirty, coordinate rather than formatting, reverting, staging, or overwriting them blindly.
- Manual: create a disposable ignored `prototypes/convention-smoke/` with a minimal local `deno.json` `dev` task, run
  `deno task prototype convention-smoke`, confirm inherited interactive output, then remove the folder. Confirm an
  unknown slug and a non-ignored path fail with actionable messages and never create tracked files.
- Manual: run `deno task workspace:dev:plan-review` and inspect `http://127.0.0.1:5173/dev/plan-review` in a headed
  browser at 1440×1000 and 390×844.
- Manual: in the FEATURE fixture, verify exact toolbar order and geometry, keyboard/focus behavior, both tooltips,
  visible selected states, Engineer forcing/disabling Pair, no horizontal clipping, and the strong Approve & Run hover.
- Manual: open Options and confirm its trigger precedes the logo, its panel opens rightward, Escape/outside-click closes
  it, and its bounding box remains within the viewport.
- Manual: approve each valid FEATURE combination with both Approve & Run and Approve for Later; inspect the resulting
  Plan Front Matter and confirm it contains the selected canonical fields, no legacy `frontend`/`collaborationMode`, and
  unchanged unrelated metadata/body content.
- Manual: select a different policy and send Feedback; confirm the returned annotations/edited Markdown behavior is
  preserved but the temporary control selection is not written as approved policy.
- Manual: exercise the PROJECT fixture and confirm no Agent/style controls appear and existing Approve & Slice/deferred
  semantics remain intact.
- Manual: run a Pair-approved Frontend Engineer Plan in a Pair-capable TUI and confirm Pair activates; use an incapable
  host and confirm it reports autonomous fallback without rewriting the approved Pair recommendation.
- Expected: every immediate/deferred FEATURE approval clearly communicates and durably records who owns execution and
  how a capable host should collaborate, with no post-approval selection prompt and no stale-metadata rollback.
- Execution policy matrix:
  - FEATURE Plans may omit `executionAgent`; omission displays and preserves the compatibility default of Engineer until
    approval writes the explicit selected policy.
  - Engineer is valid only with Autonomous; Pair is disabled in the UI and rejected at every transport/write boundary.
  - Frontend Engineer is valid with Autonomous or Pair.
  - A Pair recommendation activates Pair only in a Pair-capable host; incapable hosts run autonomously without changing
    approved Plan Front Matter.
  - PROJECT Epics remain non-executable and cannot submit or persist execution Agent/style fields.

## Edge Cases & Considerations

- The approved control edits Plan policy, not active execution state. Pair checkpoint count, pause state, and temporary
  capability fallback remain ephemeral `HostedSession.activeExecutionWorkflow` data.
- Persist the approved style in the existing `collaborationRecommendation` field; do not introduce or restore a durable
  `collaborationMode`. The user is overriding Planner guidance during the Review Loop, and runtime still derives the
  executable style against host capability.
- Direct approval is the commit boundary for toolbar selections. Merely toggling controls or returning Feedback must not
  silently change future execution.
- Browser-edited Front Matter is untrusted. Use server-side classification and Plan-store validation; never accept a
  browser-supplied PROJECT-to-FEATURE classification to authorize execution policy or immediate work.
- A validation/write failure must keep the browser review open and the one-shot decision available. Do not record
  `review_approved`, readiness, or execution authorization after a partial/failed write.
- Lifecycle callers spread `triageMeta` into Plan updates. Every post-review lifecycle call must use refreshed canonical
  attributes or it can revert the approved policy.
- Older/injected review adapters may omit the new fields. Preserve their existing policy and fail-safe approval-action
  behavior rather than inventing an override.
- The selected policy must survive Approve for Later, process restart, loaded-Plan review, recovery, and immediate
  execution because the Plan remains the durable source of truth.
- Ignored prototypes are intentionally local and non-reviewable in Git. Preserve only their conclusion in the resulting
  Plan/PRD/ADR or implementation; do not force-add prototype code merely to share it.
- The generic prototype task must remain valid when no `prototypes/` directory exists: listing normal tasks is fine, and
  invoking an absent slug returns a concise setup error rather than a broken hard-coded path.
- A UI fixture host may import production components and semantic CSS, but production modules must never import from
  `prototypes/`. If realistic integration cannot be achieved without editing a tracked route, use a separate ignored
  host or stop and explain the limitation instead of bypassing the convention.
- The CI filename/marker guard is intentionally strict. Keep narrow explicit exclusions for the Prototype Skill and its
  own test fixtures; do not introduce a broad bypass that would allow throwaway artifacts back under `src/`.
- The current checkout has concurrent automatic Epic-continuation changes in `src/cmd/load-plan/index.js`,
  `docs/workflows.md`, SessionRuntime, validation, and orchestration files, plus a dirty Plannotator submodule. Re-read
  and preserve them; this feature should touch only the review-related portions of overlapping files and must not modify
  the submodule.
- The segmented execution selector is Plan Review-specific. Keep it in `plannotator.css`; do not add a shared design
  system primitive unless implementation discovers a second real consumer.
