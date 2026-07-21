---
planId: "31fb2d25-893f-4b3e-9a4e-93625cd468b0"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Finish the Epic by making metrics content-safe, migrating active nonterminal Plans off the retired `frontend` flag, aligning frontend/browser skills with the persistent Pair loop, and documenting the settled workflow contract."
affectedPaths:
    - "src/shared/workflow/metrics.js"
    - "src/tools/task-completed.js"
    - "src/skills/front-end-framework-use/"
    - "src/skills/agent-browser-use/"
    - "plans/"
    - "docs/prd/frontend-engineer-pair-execution-prd.md"
    - "docs/workflows.md"
    - "src/shared/workflow/metrics.test.js"
    - "src/tools/__tests__/task-completed.test.js"
frontend: false
createdAt: "2026-07-18T15:02:23.968Z"
updatedAt: "2026-07-18T15:02:23.968Z"
status: "draft"
origin: "internal"
parentPlan: "frontend-engineer-pair-execution"
order: 4
dependencies:
    - "03-tui-pair-host-and-autonomous-host-boundaries"
---

# Metrics, Active Plan Migration, Skills, and Docs

## Context

Once Frontend Engineer autonomous execution, Pair checkpoints, and host boundaries are implemented, the repository still
needs cleanup to make the new contract durable. The legacy `frontend` flag should be retired from active nonterminal
Plans, Pair metrics must remain coarse and content-free, skills need to reflect the persistent Pair loop, and workflow
documentation must describe the implemented behavior rather than the old boolean model.

This slice intentionally avoids verified/archived Plan churn and avoids changing product scope. It finalizes
consistency, migration, and user-facing workflow guidance.

## Objective

Remove legacy `frontend` usage from active nonterminal Plans, record only opt-in privacy-safe Pair metrics, align
frontend/browser skills with Frontend Engineer and persistent Pair evidence loops, and update documentation for Plan
ownership, Pair selection, host support, autonomous fallback, legacy interpretation, and validation boundaries.

## Approach

First add or adjust metric events so only coarse Pair facts are recorded through the existing opt-in workflow metrics
system. Then perform a narrow Plan migration: remove `frontend: true` and `frontend: false` from active nonterminal Plan
front matter, add explicit ownership/recommendation only where an executable browser UI FEATURE genuinely requires it,
and update body text that tells future children to emit the retired flag. Finally, update reusable skills and docs so
agents and users understand the new contract.

Preserve lifecycle metadata, worktree metadata, collaboration metadata, verified/archived history, and user-authored
Plan content outside the narrow migration target.

## Files to Modify

- `src/shared/workflow/metrics.js` — recognize Frontend Engineer and Pair events while sanitizing details to coarse
  content-free fields only.
- `src/tools/task-completed.js` — align completion report guidance with Frontend Engineer browser evidence and
  Pair/non-Pair distinction without treating Pair approval as verification.
- `src/skills/front-end-framework-use/` — update skill guidance for Frontend Engineer ownership, design-system
  discovery, HMR-aware persistent browser loops, and not introducing browser-test frameworks without explicit Plan
  scope.
- `src/skills/agent-browser-use/` — update headed browser evidence, cleanup, named-session, and checkpoint guidance for
  persistent Pair execution.
- `plans/` — migrate active nonterminal Plan front matter/body language away from `frontend`; add explicit
  ownership/recommendation only where an executable browser UI FEATURE requires it; leave verified/archived history
  alone.
- `docs/prd/frontend-engineer-pair-execution-prd.md` — update status/settled implementation notes if needed and ensure
  the PRD matches the final contract.
- `docs/workflows.md` — document execution ownership, Pair/autonomous runtime selection, TUI-only Pair support,
  ACP/headless autonomous fallback, checkpoints versus validation, legacy `frontend` interpretation, and active Plan
  migration rules.
- `src/shared/workflow/metrics.test.js` — cover opt-in metrics for recommendation, selection, checkpoint count/decision,
  completion, elapsed time, and browser preflight outcome while excluding content payloads.
- `src/tools/__tests__/task-completed.test.js` — cover updated completion report expectations for Frontend Engineer
  browser verification evidence.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/workflow/metrics.js#sanitizeMetricDetails` — reuse existing local opt-in metric redaction rather than
  adding a new telemetry channel.
- `src/plan-store.js#updatePlanFrontMatter` — use existing Plan metadata update helpers for narrow active Plan migration
  when practical.
- `src/plan-store.js#listPlans` — identify active nonterminal Plans while avoiding archived/verified historical churn.
- `src/tools/task-completed.js` — keep the existing completion-report schema and update instructions rather than adding
  a second frontend completion tool.
- `src/skills/front-end-framework-use/` — preserve convention-first frontend implementation guidance as a reusable
  technique package.
- `src/skills/agent-browser-use/` — preserve headed browser inspection as the shared visual surface technique.

## Implementation Steps

- [ ] Define the final allowed Pair metric facts: recommendation, runtime selection, checkpoint count, checkpoint
      decision category, switch-to-AFK, stop/completion, elapsed time, and browser preflight outcome.
- [ ] Update metric recording/sanitization so revision text, screenshots, source snippets, browser payloads, URLs with
      secrets, and secret-bearing paths never enter metric details.
- [ ] Add tests proving Pair metrics are opt-in and content-free.
- [ ] Update Task Completion guidance so Frontend Engineer reports browser verification evidence at completion while
      Pair checkpoint approval remains non-validation.
- [ ] Update `front-end-framework-use` skill guidance to reference Frontend Engineer ownership, persistent dev
      server/browser loops, design-system discovery, and existing-test-framework discipline.
- [ ] Update `agent-browser-use` skill guidance for named headed sessions, checkpoint evidence, reconnection/restart
      behavior, and cleanup at terminal workflow completion.
- [ ] Inventory active nonterminal Plans under `plans/` and identify which are executable browser UI FEATURE Plans
      needing explicit `executionAgent: frontend-engineer` and an autonomous or Pair recommendation.
- [ ] Remove both `frontend: true` and `frontend: false` from active nonterminal Plan front matter while preserving
      lifecycle, worktree, collaboration, timestamps where appropriate, user-authored metadata, and body content outside
      targeted wording.
- [ ] Update active Plan body language that instructs future children to emit `frontend`; replace it with
      owner/recommendation guidance.
- [ ] Leave archived, verified, and historical Plans unchanged unless they are active nonterminal files explicitly in
      scope.
- [ ] Update `docs/prd/frontend-engineer-pair-execution-prd.md` and `docs/workflows.md` with the settled Plan front
      matter contract, TUI-first host boundary, legacy interpretation, active migration, ACP/headless autonomous
      behavior, and checkpoint/validation separation.
- [ ] Run `deno fmt` for documentation/config-only changes or `deno task ci` if executable code/tests changed; fix all
      failures.

## Verification Plan

- Automated: run `deno test -A src/shared/workflow/metrics.test.js` and verify Pair metrics include only approved coarse
  fields and exclude revision text, screenshots, source, browser payloads, URLs, and secret-bearing paths.
- Automated: run `deno test -A src/tools/__tests__/task-completed.test.js` and verify Frontend Engineer completion
  guidance includes real-browser verification evidence but not Pair approval as validation evidence.
- Automated: run focused Plan store/list tests if migration touches Plan parsing helpers.
- Automated: run `deno task ci` if executable code or tests changed; if this slice ends up changing only Markdown/front
  matter/config, run `deno fmt` instead.
- Manual: inspect active nonterminal Plans and confirm `frontend` front matter is removed while verified/archived
  history is untouched.
- Manual: open representative migrated Plans and confirm browser UI FEATURE Plans have explicit execution
  ownership/recommendation where appropriate, while TUI/general code Plans remain Engineer-owned or omit owner according
  to the final format.
- Manual: read `docs/workflows.md` and confirm it explains TUI Pair support, ACP/headless autonomous fallback, legacy
  `frontend` behavior, and checkpoints versus Workflow Validation.
- Expected results: repository docs, skills, metrics, and active Plan files consistently express the new
  owner/recommendation model and no longer teach agents to emit the retired `frontend` flag.

## Edge Cases & Considerations

- Active Plans may have user edits or worktree metadata; migration must be narrow and preserve
  lifecycle/worktree/collaboration fields.
- Do not rewrite verified or archived historical Plans just to remove legacy front matter.
- Avoid introducing new browser-test frameworks or visual snapshots in skill/docs guidance.
- Metrics must remain content-safe even when checkpoint evidence includes URLs, screenshots, browser diagnostics, or
  revision text.
- Some active PROJECT Epics may mention frontend scope; they should not receive an execution Agent because Epics are
  non-executable containers.
- If executable code changes are minimal but present, run the full `deno task ci` gate rather than documentation-only
  formatting.
