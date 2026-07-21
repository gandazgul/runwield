---
planId: "7e2e6038-346c-4397-a09c-a96f8357cbdd"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Generate Work Records automatically at terminal Plan outcomes, run verified FEATURE generation alongside post-verification Manual QA, add the completion setting, and document Work Records V1."
affectedPaths:
    - "src/shared/work-records/auto-generation.js"
    - "src/shared/work-records/generation.js"
    - "src/shared/work-records/index.js"
    - "src/shared/work-records/work-records.test.js"
    - "src/shared/workflow/validation.js"
    - "src/shared/workflow/validation.test.js"
    - "src/cmd/load-plan/index.js"
    - "src/cmd/load-plan/index.test.js"
    - "src/ui/workspace/server/plan-adapter.js"
    - "src/ui/workspace/workspace.test.js"
    - "src/shared/settings.js"
    - "src/shared/settings.test.js"
    - "config.schema.json"
    - "docs/prd/work-records-prd.md"
    - "docs/usage.md"
    - "docs/workflows.md"
    - "docs/settings.md"
frontend: false
createdAt: "2026-07-15T21:05:36.853Z"
updatedAt: "2026-07-21T02:26:56.143Z"
status: "verified"
origin: "internal"
parentPlan: "work-records-v1"
order: 4
dependencies:
    - "02-recorder-generation-and-backfill"
    - "03-index-search-cli-and-agent-retrieval-tools"
implementedAt: "2026-07-21T01:52:28.560Z"
verifiedAt: "2026-07-21T02:26:56.143Z"
executionReport: "- Implemented completion-driven Work Record auto-generation across validation success, TUI Epic done-enough, and Workspace persisted close-without-verification paths.\n- Added default-on `workRecords.autoGenerateOnPlanCompletion` setting, schema support, preservation/merge behavior, targeted generation helpers, Epic child resolution, failure isolation, and concise user-facing result formatting.\n- Updated Work Record generation/backfill helpers and docs for completion-driven hooks, settings, CLI usage, child/Epic behavior, Manual QA parallelism, failure isolation, and backfill guidance.\n- Added/updated tests for settings, targeted generation outcomes, validation concurrency/reporting, TUI hook, and Workspace lifecycle hook.\n- Repaired release quality-gate issues in Workspace build/runtime preparation so release compile succeeds.\n- Verification passed: `deno test -A src/shared/workflow/validation.test.js src/shared/work-records/work-records.test.js src/shared/settings.test.js src/cmd/load-plan/index.test.js src/ui/workspace/workspace.test.js` (264 passed).\n- Verification passed: `deno task release:check`.\n- Verification passed: `deno task ci` (1396 tests passed plus checks/lint/fmt/release check)."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
---

# Post-Completion Auto Generation, Settings, and Docs

## Context

The preceding Work Records slices are verified. RunWield can generate an approved internal Work Record from an eligible
completed top-level FEATURE Plan or PROJECT Epic, reconcile an existing canonical record, write success/failure Plan
backlinks, sync the derived index best-effort, backfill broadly through `wld wr backfill`, and retrieve records through
CLI and Agent tools.

The original version of this child Plan proposed generation on `/new` and `/quit`. During resumed planning, the user
chose a safer completion-driven design instead: verified FEATURE Work Record generation should run in process alongside
the existing post-verification Manual QA checklist, then print its result. Closed Without Verification Plans and
`done_enough` Epics should use targeted post-terminal hooks. This avoids detached workers and unreliable process-exit
work while keeping Work Record failures outside the Plan Lifecycle critical path. This decision supersedes the parent
Epic and PRD's older session-boundary timing for this V1 slice; implementation must update the PRD and user docs to the
agreed behavior.

Automatic generation remains limited to top-level completed planned work. A child FEATURE Plan does not receive its own
Work Record. After child validation, targeted resolution checks its parent Epic: if the Plan Lifecycle has just advanced
the parent to `done_enough` because all children are verified, generate the Epic Work Record; otherwise skip without
creating a child record. Explicit `wld wr backfill` remains the recovery path for disabled automation, interrupted
processes, legacy completed Plans, and repair.

## Objective

Automatically generate or reconcile a Work Record immediately after a supported terminal Plan outcome is durably
recorded:

- after successful FEATURE Workflow Validation and merge-back, in parallel with post-verification Manual QA;
- after a user marks a PROJECT Epic `done_enough` in the TUI Plan-loading flow;
- after a Workspace lifecycle action closes an eligible top-level Plan without Workflow Validation;
- after final child FEATURE validation implicitly advances its parent Epic to `done_enough`.

Add merged global/project setting `workRecords.autoGenerateOnPlanCompletion`, defaulting to `true`. Disabling it must
suppress only automatic generation; canonical listing, search/read, index rebuild, and explicit backfill remain
available. Every automatic attempt must report a concise generated/linked/failed result on the calling surface, while a
Recorder, Markdown, backlink, or index failure must never roll back or invalidate the terminal Plan outcome.

Update the Work Records PRD, settings schema/reference, usage guide, and workflow documentation so V1 behavior and
deferred scope are consistent.

## Approach

Add a focused auto-generation orchestrator under `src/shared/work-records/` rather than coupling generation to
`recordPlanEvent()` or `buildPlanEventUpdates()`. The orchestrator accepts `cwd` and the Plan name whose terminal action
just completed, checks `workRecords.autoGenerateOnPlanCompletion`, resolves a child FEATURE to its parent Epic, loads
only the targeted active source plus Epic children needed for Recorder context, reuses existing
eligibility/reconciliation rules, and calls `generateWorkRecordForSource()`. Return a structured result for `disabled`,
expected `skipped`, `generated`, `linked`, or `failed` outcomes plus a concise human-readable projection.

In `runValidationLoop()`, start two independent promises only after the Plan is verifiably terminal in the project root:
the existing Manual QA checklist and targeted Work Record auto-generation. The Manual QA prompt continues through the
Hosted Session so its checklist streams and persists normally; Recorder generation continues through the generation
service's separate non-interactive Agent Session. This avoids concurrent mutation of the Hosted Session Agent-info
stack. Await both together so they run concurrently, then emit the Work Record result as a RunWield system status. Both
paths are post-verification handoffs: either may fail visibly without changing the successful validation result.

For explicit `epic_done_enough` and Workspace `manual_closed_without_verification` actions, record the Plan Event first,
then invoke the same targeted orchestrator and append its result to the existing TUI or Workspace response. Do not put
LLM calls inside the Plan Lifecycle module. The existing automatic parent-Epic advancement remains unchanged; the
post-validation resolver observes the resulting parent state and generates only when that parent is now eligible.

Use a settings helper such as `shouldAutoGenerateWorkRecordsOnPlanCompletion(projectRoot)` that treats only literal
`false` as disabled and missing configuration as enabled. Preserve the `workRecords` custom key across SettingsManager
writes and describe the nested boolean in `config.schema.json`.

## Files to Modify

- `src/shared/work-records/auto-generation.js` — add targeted active-Plan loading, child-to-parent resolution, setting
  checks, expected skip semantics, invocation of the existing generation service, and concise result formatting.
- `src/shared/work-records/generation.js` — expose/reuse narrowly scoped source construction and Epic-child context
  helpers needed by automatic generation without routing through broad backfill.
- `src/shared/work-records/index.js` — export the auto-generation API from the Work Records subsystem.
- `src/shared/work-records/work-records.test.js` — cover targeted source resolution, parent Epic behavior, disabled
  automation, generated/linked/failed projections, retry of failed backlinks, and broad-backfill isolation.
- `src/shared/workflow/validation.js` — after successful terminal persistence, run FEATURE Manual QA and targeted Work
  Record generation concurrently, then emit a concise Work Record result without changing validation success.
- `src/shared/workflow/validation.test.js` — verify ordering, concurrency, result reporting, setting-disabled behavior,
  child-to-terminal-Epic generation, and failure isolation for in-place and worktree-backed validation.
- `src/cmd/load-plan/index.js` — after `epic_done_enough` is recorded, invoke targeted auto-generation and append the
  generated/linked/failed result to the TUI.
- `src/cmd/load-plan/index.test.js` — verify done-enough generation starts only after the lifecycle event succeeds and
  failures do not undo the Epic's terminal state.
- `src/ui/workspace/server/plan-adapter.js` — after a canonical close-without-verification action succeeds, invoke
  targeted auto-generation and include its result in the response message; leave in-memory preview behavior side-effect
  free.
- `src/ui/workspace/workspace.test.js` — verify the persisted Workspace close path triggers generation after closure,
  preserves closure on failure, and does not generate during in-memory previews.
- `src/shared/settings.js` — preserve the `workRecords` custom key and add the merged default-true completion automation
  getter.
- `src/shared/settings.test.js` — cover global/project resolution, default true, literal-false disablement, and
  custom-key preservation.
- `config.schema.json` — add the `workRecords.autoGenerateOnPlanCompletion` nested boolean schema and default.
- `docs/prd/work-records-prd.md` — replace session-boundary timing with the agreed post-terminal hooks, parallel Manual
  QA behavior, result reporting, setting name, and backfill recovery semantics.
- `docs/usage.md` — document Work Record storage and the shipped `wld wr` list/search/read/index rebuild/backfill
  command surface.
- `docs/workflows.md` — document automatic generation after verified, done-enough, and closed-without-verification
  outcomes; child-to-Epic behavior; Manual QA parallelism; failure isolation; and explicit backfill.
- `docs/settings.md` — document `workRecords.autoGenerateOnPlanCompletion`, default/merge behavior, affected terminal
  outcomes, and what remains available when disabled.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/work-records/generation.js` — reuse `evaluateWorkRecordSource()`, `generateWorkRecordForSource()`,
  existing-record reconciliation, failed-backlink retry, durable failure metadata, Recorder invocation, and best-effort
  index sync.
- `src/plan-store.js` — reuse `loadPlan()`, `findPlansByParent()`, `isChildFeaturePlan()`, and `isEpicPlan()` for
  targeted active source resolution; do not scan archived Plans during automatic generation.
- `src/shared/workflow/validation.js` — reuse `presentManualQaChecklist()` and `emitRunWieldSystemStatus()` as the
  post-verification execution and reporting pattern.
- `src/shared/workflow/plan-lifecycle.js` — observe existing `validation_passed`, `epic_done_enough`, and automatic
  parent-Epic advancement behavior, but keep this module independent of Recorder and Work Record services.
- `src/cmd/load-plan/index.js` — reuse existing `uiAPI.appendSystemMessage()` output immediately following the
  done-enough transition.
- `src/ui/workspace/server/plan-adapter.js` — reuse the canonical lifecycle-action response message while keeping
  `applyWorkspaceLifecycleActionInMemory()` deterministic and free of I/O side effects.
- `src/shared/settings.js` — reuse `getMergedCustomSetting()` and the default-true boolean pattern used by
  `shouldCleanupMergedWorktrees()`.
- Existing Work Record CLI and retrieval docs from slices 2 and 3 — document shipped behavior rather than designing new
  commands or manual creation flows.

## Implementation Steps

- [ ] Step 1: Add `workRecords` to preserved RunWield custom settings and implement
      `shouldAutoGenerateWorkRecordsOnPlanCompletion(projectRoot)`, defaulting to true and disabling only for an
      explicit nested `false`; add focused settings tests and the matching `config.schema.json` shape.
- [ ] Step 2: Refactor/export only the source-building helpers needed for a targeted active Plan lookup. Preserve broad
      active+archived discovery exclusively for explicit backfill.
- [ ] Step 3: Implement the auto-generation orchestrator with structured `disabled`, `skipped`, `generated`, `linked`,
      and `failed` results. Resolve child FEATURE Plans to their parent Epic, attach child context for eligible Epics,
      silently treat a non-terminal parent as an expected skip, retry failed backlinks through the existing generation
      service, and never create a child Work Record.
- [ ] Step 4: Add a concise result formatter for calling surfaces: include the canonical path for generated/linked
      records, include index warnings without changing success, and include durable failure/backfill guidance for failed
      attempts. Disabled and expected non-terminal-child skips should not produce alarming errors.
- [ ] Step 5: Extend `runValidationLoop()` dependencies for testability, and after successful merge-back/in-place
      `validation_passed` persistence start Manual QA and targeted Work Record generation together. Emit a preparation
      status, await both concurrently, print the Work Record result, and preserve successful validation if either
      post-verification handoff fails.
- [ ] Step 6: Verify final-child behavior: because `recordPlanEvent(validation_passed)` may advance the parent Epic to
      `done_enough`, targeted resolution after persistence must generate one Epic Work Record for the newly terminal
      parent; earlier child completions must generate none.
- [ ] Step 7: In the TUI Epic done-enough flow, invoke auto-generation only after `epic_done_enough` succeeds and append
      the result after the existing completion message. A generation failure must leave the Epic verified/done-enough
      with a failed Work Record backlink.
- [ ] Step 8: In the canonical Workspace close-without-verification flow, invoke auto-generation only after
      `manual_closed_without_verification` succeeds and include its result in the response. Keep in-memory preview free
      of generation and preserve the closure reason in generated Work Record content.
- [ ] Step 9: Add regression tests for default/disabled settings, standalone verified FEATURE generation, in-place and
      worktree ordering, actual parallel start before either post-verification task settles, generation failure,
      existing-record linking, failed-backlink retry, child skip, final-child Epic generation, manual closure, and
      done-enough generation.
- [ ] Step 10: Update the Work Records PRD and user documentation to remove `/new`/`/quit` automation claims, describe
      completion-driven generation and visible results, document all shipped CLI/retrieval behavior, and keep
      manual/external creation, Plannotator Work Record approval, Guided Review reuse, and default QUICK_FIX generation
      explicitly deferred.
- [ ] Step 11: Run focused tests and the full RunWield quality gate; review docs, schema, setting name, terminal
      outcomes, and result vocabulary together for consistency.

## Verification Plan

- Automated: `deno test -A src/shared/settings.test.js src/shared/work-records/work-records.test.js`
- Automated: `deno test -A src/shared/workflow/validation.test.js src/cmd/load-plan/index.test.js`
- Automated: `deno test -A src/ui/workspace/workspace.test.js`
- Automated: `deno task ci`
- Manual: Complete an in-place standalone FEATURE Plan and confirm the Plan reaches `verified`, Manual QA and Recorder
  work start without waiting for one another, one approved Work Record is written/linked/indexed, and a concise path is
  printed after both post-verification handoffs settle.
- Manual: Complete a worktree-backed standalone FEATURE Plan and confirm generation starts only after merge-back exposes
  the verified Plan in the project root; the generated backlink remains in the primary checkout.
- Manual: Complete a non-final child FEATURE and confirm no child Work Record is generated. Complete the final child and
  confirm the automatically advanced `done_enough` Epic receives exactly one Epic Work Record.
- Manual: Mark an Epic done enough through `wld load-plan`; confirm the terminal update remains durable and its Work
  Record result is printed.
- Manual: Close an eligible top-level Plan without Workflow Validation through Workspace; confirm the closure reason is
  retained, the response reports Work Record generation, and the Summary clearly discloses skipped verification.
- Manual: Set `workRecords.autoGenerateOnPlanCompletion` to `false`; repeat terminal flows and confirm no automatic
  writes occur while `wld wr backfill`, list, search/read, and index rebuild still work.
- Manual: Simulate Recorder and index failures. Confirm Plan terminal state is unchanged, Recorder failure writes
  `workRecord.status: failed` with a concise error, index failure leaves a generated backlink plus warning, and explicit
  backfill/index rebuild guidance is shown.
- Expected result: every supported top-level terminal outcome generates or reconciles its canonical Work Record at the
  completion boundary, verified FEATURE generation overlaps Manual QA, failures remain non-authoritative, and no
  session-end worker is required.

## Edge Cases & Considerations

- The post-terminal hooks must run after canonical Plan state is visible in the project root. Starting Recorder before
  worktree merge-back or before `recordPlanEvent()` succeeds can misclassify eligibility and must be avoided.
- Manual QA and Recorder generation may run concurrently only because Recorder uses a separate non-interactive Agent
  Session. Do not run two concurrent `runIsolatedAgentSession()` calls against the same Hosted Session Agent-info stack.
- A child FEATURE Plan never receives a Work Record backlink. Resolve to the parent Epic; generate only if the parent is
  terminal, including automatic all-children-verified advancement.
- The targeted orchestrator must not scan archived Plans or unrelated completed Plans. Archived/legacy recovery remains
  explicit `wld wr backfill` behavior.
- Existing `workRecord.status: generated` sources should skip/reconcile without duplicate Markdown. Existing failed
  backlinks are retryable by automatic generation; canonical provenance reconciliation remains authoritative if a record
  exists but the backlink is stale or missing.
- Recorder, canonical write, backlink, and index failures occur after the terminal Plan Event and cannot roll back Plan
  status. Index warnings do not convert successful generation to failure.
- Workspace in-memory lifecycle previews must remain deterministic and side-effect free; only the canonical persisted
  action may invoke Recorder.
- Automatic generation can add model latency after a terminal action, but verified FEATURE latency overlaps the already
  expected Manual QA prompt. The Plan is terminal before either post-completion handoff runs.
- Missing or malformed `workRecords` configuration is treated as enabled unless the nested setting is literal `false`.
  Explicit backfill and all read/search/index commands ignore this automation setting.
- QUICK_FIX remains excluded because it has no source Plan. Manual/external Work Records, Work Record review/approval,
  supersession/archive commands, Guided Review reuse, and automatic session-boundary generation are outside this V1
  slice.
- Keep all core, workflow, CLI, and Workspace server changes in JavaScript with reusable JSDoc `@typedef` shapes; do not
  introduce TypeScript syntax.
