---
classification: "FEATURE"
complexity: "HIGH"
summary: "Add a configurable Manual QA gate to Workflow Validation that executes explicit Plan checks in an isolated Engineer-configured Agent Session, returns failures to Engineer, and restarts validation before optional User Code Review."
affectedPaths:
    - "config.schema.json"
    - "docs/settings.md"
    - "docs/plan-lifecycle.md"
    - "src/agent-definitions/workflow-prompts/manual-qa-runner-prompt.md"
    - "src/plan-front-matter.js"
    - "src/plan-store.js"
    - "src/plan-store.test.js"
    - "src/shared/settings.js"
    - "src/shared/settings.test.js"
    - "src/shared/session/workflow-messages.js"
    - "src/shared/workflow/manual-qa.js"
    - "src/shared/workflow/manual-qa.test.js"
    - "src/shared/workflow/plan-lifecycle.js"
    - "src/shared/workflow/plan-lifecycle.test.js"
    - "src/shared/workflow/validation.js"
    - "src/shared/workflow/validation.test.js"
    - "src/shared/workflow/workflow-results.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/tools/manual-qa-complete.js"
    - "src/tools/__tests__/manual-qa-complete.test.js"
    - "src/ui/tui/runtime-adapter.js"
    - "src/ui/tui/runtime-adapter.test.js"
frontend: false
createdAt: "2026-07-17T00:27:51-04:00"
updatedAt: "2026-07-17T04:32:46.524Z"
status: "draft"
origin: "internal"
---

# Automate Manual QA During Workflow Validation

## Context

RunWield currently generates a post-verification Manual QA checklist for successful FEATURE and QUICK_FIX work. It does
not execute the checks or feed observed failures back into Workflow Validation. The existing FEATURE validation order is
CI, Semantic Code Review, optional User Code Review, merge-back, and then checklist generation.

This feature turns explicit Manual QA steps in an executable Plan into an optional validation gate. The agreed order is:

`Engineer Task Completion → CI → Semantic Code Review → Manual QA → User Code Review → merge-back → verified`

Any CI, semantic-review, Manual QA, or User Code Review repair returns to Engineer. After Engineer emits Task
Completion, the next validation cycle restarts at CI. QUICK_FIX retains its current post-CI inferred checklist because
it has no Plan from which to extract explicit Manual QA steps.

## Objective

Add `manualQA: none | ask | always` as a global/project setting and run eligible Plan checks before User Code Review.
Use a fresh isolated Agent Session bound to `AGENTS.ENGINEER` so it inherits Engineer model, thinking, and temperature
configuration, while a workflow-specific Agent Definition supplies a read/execute-only QA prompt and tools. Produce a
structured pass/fail report, defer checks that require unavailable human capabilities, dispatch Engineer for observed
failures, and persist only coarse final Manual QA evidence on verified Plans.

## Approach

1. **Determine eligibility without an LLM call.** Parse only the Plan's `## Verification Plan` section and recognize
   explicit `- Manual:` entries or a `### Manual` subsection. Do not infer Manual QA from Context, Implementation Steps,
   or Edge Cases. Ignore explicit no-op values such as `none`, `not required`, or `N/A`.

2. **Apply one policy vocabulary.** `manualQA` defaults to `none`; invalid values also fall back to `none`.
   - `none`: silently skip the Manual QA Agent even when explicit steps exist.
   - `ask`: when steps exist, ask whether to run them. Acceptance runs the Agent; declining emits the existing unchecked
     checklist and continues to User Code Review/completion.
   - `always`: run the Agent whenever explicit steps exist.
   - No explicit steps: do not prompt, run an Agent, or emit a checklist.

3. **Keep QA isolated and non-editing.** Add a dedicated bare runner prompt and invoke it with
   `runIsolatedAgentSession`, `agentName: AGENTS.ENGINEER`, an Agent Definition override, and the execution worktree as
   `cwd`. Permit bounded inspection/execution tools (`read`, `grep`, `find`, `ls`, `bash`) and a terminal
   `manual_qa_complete` Custom Tool; do not grant edit/write tools or implementation-session history. Include the Skills
   placeholder so browser checks can load and follow `agent-browser-use` when applicable.

4. **Use a QA-specific result contract.** The terminal Custom Tool should return `passed`, a concise evidence/report
   string, and optional `deferredSteps`. An observed behavioral failure is `passed: false` and triggers Engineer repair.
   Missing credentials, unavailable hardware/services, or irreducible human judgment are deferred rather than failed;
   deferred steps are rendered as an unchecked user checklist and validation continues.

5. **Integrate before User Code Review.** Run Manual QA after CI and Semantic Code Review have passed (or after semantic
   review is explicitly skipped for a non-Git in-place Plan), but before `codereview` policy is evaluated. A QA failure
   dispatches Engineer through the existing Task Completion-gated repair seam and continues the outer validation loop,
   re-running CI, semantic review, Manual QA, and any later User Code Review. Reuse the existing three-cycle cap.

6. **Persist coarse final evidence only.** Record `manualQaMode`, `manualQaDecision`, and `manualQaAt` on the final
   verified Plan. Decisions are `not_required`, `skipped`, `passed`, or `deferred`. Reports, reproduction details, and
   checklist text remain in Agent Session output and opt-in workflow metrics, not Front Matter.

## Files to Modify

- `src/shared/settings.js` — preserve `manualQA` and add normalized global/project policy lookup.
- `src/shared/settings.test.js` — cover preservation, precedence, normalization, default, and invalid fallback.
- `config.schema.json` — add the public `manualQA` enum and description.
- `src/shared/workflow/manual-qa.js` — new focused module for explicit-step extraction, checklist formatting, runner
  prompt loading, and isolated Manual QA Agent invocation.
- `src/shared/workflow/manual-qa.test.js` — cover extraction formats/no-op values, checklist formatting, Agent identity,
  model-binding seam, tool restrictions, prompt context, and execution cwd.
- `src/agent-definitions/workflow-prompts/manual-qa-runner-prompt.md` — new execution contract that tests only supplied
  steps, gathers observable evidence, defers unavailable checks, never edits implementation, and terminates through the
  result tool. Keep the existing `manual-qa-prompt.md` as the checklist generator for QUICK_FIX and user-owned handoffs.
- `src/tools/manual-qa-complete.js` — workflow-scoped terminal Custom Tool with structured pass/fail/report/deferred
  output, Manual QA Agent Session messaging, and metrics.
- `src/tools/__tests__/manual-qa-complete.test.js` — verify pass, fail, deferred, terminal behavior, messages, and
  metrics.
- `src/shared/session/workflow-messages.js` — add a Manual QA result message formatter/emitter without introducing a new
  Runtime event type.
- `src/shared/workflow/workflow-results.js` and `src/shared/workflow/workflow.test.js` — parse the latest
  `manual_qa_complete` result and reject missing/malformed/stale outcomes.
- `src/ui/tui/runtime-adapter.js` and `src/ui/tui/runtime-adapter.test.js` — hide the terminal result tool block like
  `task_completed`/`review_complete` while preserving the emitted QA report.
- `src/shared/workflow/validation.js` — place policy/QA handling between semantic approval and User Code Review, route
  failures through Engineer repair, restart the outer cycle, support non-Git in-place Plans, emit deferred checklists,
  record metrics, and pass final Manual QA evidence into Plan validation/merge-back.
- `src/shared/workflow/validation.test.js` — cover ordering, policies, repairs, retries/defer/stop recovery, cycle cap,
  non-Git behavior, no-step behavior, QUICK_FIX compatibility, and final metadata handoff.
- `src/plan-front-matter.js`, `src/plan-store.js`, and `src/plan-store.test.js` — define, order, normalize, read, write,
  and round-trip the three coarse Manual QA evidence fields.
- `src/shared/workflow/plan-lifecycle.js` and `src/shared/workflow/plan-lifecycle.test.js` — apply evidence on
  `validation_passed`, clear it when execution/recovery/review invalidates verification, and preserve it through
  worktree merge reconciliation like human-review evidence.
- `docs/settings.md` — document policy values, scopes, default, and relationship to `codereview`.
- `docs/plan-lifecycle.md` — document the revised Workflow Validation order, repair restart behavior, deferred checks,
  non-Git behavior, and coarse Plan evidence.

## Reuse Opportunities

- `src/shared/workflow/validation.js` — reuse `runCompletionGatedRepair`, validation-cycle limits, interaction handling,
  metrics, and existing checklist presentation.
- `src/shared/session/session.js` — reuse `runIsolatedAgentSession`; an Agent Definition override with
  `agentName: AGENTS.ENGINEER` preserves Engineer model configuration without sharing implementation context.
- `src/tools/review-complete.js` — mirror its terminal Custom Tool lifecycle and structured result pattern, but keep a
  QA-specific tool so schema, messages, and metrics are not mislabeled as Semantic Code Review.
- `src/agent-definitions/workflow-prompts/manual-qa-prompt.md` — retain it for QUICK_FIX checklist generation and for
  formatting explicit/deferred user-owned Plan checks.
- `src/shared/workflow/plan-lifecycle.js` — mirror human-review evidence persistence and clearing rules.

## Implementation Steps

- [ ] Step 1: Add the `manualQA` setting contract.
  - Add it to `RUNWEILD_CUSTOM_SETTING_KEYS` and export `getManualQaMode(projectRoot)` returning only
    `none | ask | always`.
  - Default missing/invalid values to `none`; preserve project-over-global precedence.
  - Add schema, settings documentation, and focused tests.

- [ ] Step 2: Implement deterministic explicit Manual QA extraction.
  - Parse only the level-two Verification Plan section.
  - Support inline/multiline `- Manual:` content and `### Manual` subsections with bullets, checkboxes, numbered steps,
    and continuation text.
  - Stop at the next same/higher-level section and ignore no-op declarations; never infer absent steps.
  - Return normalized step strings suitable for both prompts and unchecked checklist rendering.

- [ ] Step 3: Add the isolated Manual QA runner prompt and invocation helper.
  - Supply exact extracted steps, Plan name/content, classification, and execution cwd context as untrusted source
    material.
  - Bind model configuration through `AGENTS.ENGINEER`, but use `Manual QA` as the display name and a fresh in-memory
    Agent Session.
  - Restrict tools to read/search/list/bash plus `manual_qa_complete`; disallow edit/write tools and implementation
    history.
  - For browser steps, require headed `agent-browser-use` behavior and observable evidence. Defer only when an external
    capability is genuinely unavailable.

- [ ] Step 4: Add and parse the terminal Manual QA result tool.
  - Require a boolean pass/fail and concise report; accept a normalized optional list of deferred steps.
  - Terminate the isolated turn, emit one QA result message, and record payload-free/coarse workflow metrics.
  - Add a latest-result reader and hide the terminal tool's raw TUI block.

- [ ] Step 5: Insert the Manual QA policy gate into Workflow Validation.
  - Compute explicit steps once from `planContent`; skip all QA interaction/output when none exist.
  - `none` silently skips; `ask` prompts Run vs user-owned checklist; `always` runs directly.
  - Run only after successful CI/semantic review and before `codereview` handling. Ensure non-Git in-place Plans still
    reach this gate even though Semantic Code Review is unavailable.
  - On full pass, continue to User Code Review. On pass with deferrals, output only those deferred checks and continue.
  - On observed failure, send the report to Engineer, require fresh Task Completion, and restart at CI in the next outer
    validation cycle.
  - If the QA invocation throws or omits its completion tool, offer retry, defer the explicit checklist to the user, or
    stop validation; never treat missing structured output as a pass.

- [ ] Step 6: Preserve existing behavior outside the Plan gate.
  - Keep QUICK_FIX's inferred checklist after successful Mechanical Validation.
  - Do not run Manual QA after failed/canceled validation.
  - Ensure `codereview: ask | always` remains after Manual QA, and User Code Review feedback still restarts the complete
    validation sequence, including Manual QA.
  - Keep the existing bounded validation-cycle behavior; do not add an unbounded QA repair loop.

- [ ] Step 7: Persist final coarse Manual QA evidence.
  - Add `manualQaMode`, `manualQaDecision`, and nullable `manualQaAt` to Plan Front Matter ordering/types/normalization.
  - Record only the final successful cycle: no steps → `not_required`; policy `none` → `skipped`; all executed checks
    pass → `passed`; user/Agent-deferred checks → `deferred`.
  - Set `manualQaAt` only when the QA Agent completed an execution attempt; leave it null for not-required, silent skip,
    or ask-declined handoff.
  - Clear stale evidence whenever the Plan Lifecycle clears verification/human-review evidence, and preserve it through
    successful worktree merge reconciliation.

- [ ] Step 8: Add end-to-end validation-loop regression coverage and update lifecycle documentation.
  - Assert exact action order and that every repair returns to CI rather than resuming after the failed gate.
  - Assert detailed QA reports/checklists do not enter Plan Front Matter or workflow metrics.
  - Document that this is a Manual QA workflow gate using an isolated Engineer-configured Agent Session, not the
    implementation Engineer conversation.

## Verification Plan

- Automated focused loop:
  - `deno test -A src/shared/settings.test.js src/shared/workflow/manual-qa.test.js src/tools/__tests__/manual-qa-complete.test.js src/shared/workflow/workflow.test.js src/shared/workflow/validation.test.js src/shared/workflow/plan-lifecycle.test.js src/plan-store.test.js src/ui/tui/runtime-adapter.test.js`
- Automated full gate:
  - `deno task ci`
- Manual:
  - Use a FEATURE Plan with no Manual verification entry and confirm every mode skips prompts, Agent invocation, and
    checklist output.
  - With explicit Manual steps and `manualQA: none`, confirm the gate silently skips and later User Code Review policy
    still applies.
  - With `manualQA: ask`, decline and confirm an unchecked explicit checklist appears, no QA Agent runs, and validation
    continues; accept in a second run and confirm the isolated Manual QA Agent executes before User Code Review.
  - With `manualQA: always`, verify a passing browser/CLI check reports evidence; verify an unavailable credential or
    human-only check is deferred as a checklist without Engineer repair.
  - Force an observed QA failure, confirm Engineer receives the QA report, then confirm fresh Task Completion restarts
    CI → Semantic Code Review → Manual QA before User Code Review.
  - Run a QUICK_FIX and confirm its existing inferred post-CI checklist remains unchanged.
- Expected results:
  - No missing/malformed Manual QA result can be interpreted as pass.
  - Only coarse final mode/decision/time evidence reaches verified Plan Front Matter; detailed reports remain in the
    Agent Session.
  - Worktree merge-back and cleanup occur only after all required automated gates and optional User Code Review finish.

## Edge Cases & Considerations

- `validation.js` and `validation.test.js` currently contain uncommitted active-agent/runtime and merge-verification
  edits. Implementation must preserve and build on those changes rather than replacing or reverting them.
- A shell-capable QA Agent can start servers or create ordinary test artifacts, but the prompt must prohibit source
  edits and repository commits. Engineer remains the only repair owner.
- Manual steps may mix executable and human-only checks. The result contract must preserve per-step deferrals while
  failing only observed incorrect behavior.
- Agent invocation failure is not product failure. Recovery must be explicit (retry, user-owned defer, or halt), and a
  cancellation must leave the Plan unverified.
- The root glossary names Tester as the general fresh-context QA owner. This feature intentionally uses an isolated
  Engineer-configured workflow session to satisfy the selected model-binding requirement; a future context update may
  want to name this narrower Manual QA gate explicitly.
- `manualQA: none` intentionally changes FEATURE behavior from today's always-generated post-verification checklist to a
  silent skip. QUICK_FIX checklist behavior is intentionally unchanged.
