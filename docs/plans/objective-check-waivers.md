---
planId: "5f04e6ca-3c88-49d5-9d3e-cffa84a6597c"
classification: "PLANNED_CHANGE"
workKind: "MAINTENANCE"
complexity: "MEDIUM"
summary: "Route broken Objective-Failing Checks to user judgement and preserve user-waived check evidence."
affectedPaths:
    - "src/tools/task-completed.ts"
    - "src/shared/session/task-completion-session.ts"
    - "src/shared/session/hosted-session.js"
    - "src/shared/workflow/validation-ports.ts"
    - "src/shared/workflow/validation-types.ts"
    - "src/shared/workflow/validation-mechanical.ts"
    - "src/shared/workflow/objective-checks.ts"
    - "src/shared/workflow/validation-session-adapter.ts"
    - "src/plan-front-matter.js"
    - "src/plan-store.js"
    - "src/shared/work-records/generation.js"
    - "CONTEXT.md"
    - "docs/plan-lifecycle.md"
    - "docs/workflows.md"
    - "src/tools/__tests__/task-completed.test.js"
    - "src/shared/workflow/objective-checks.test.ts"
    - "src/shared/workflow/validation-loop-repair.test.js"
    - "src/plan-store.test.js"
    - "src/shared/work-records/work-records.test.js"
objectiveChecks:
    - id: "OC1"
      command: "bash -lc 'set -euo pipefail; out=$(deno run -A scripts/run-tests.js --filter \"PLANNED_CHANGE broken objective check records accepted waiver and continues\" src/shared/workflow/validation-completion-gating.test.ts 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed \\\\| 0 failed\"; grep -q \"objectiveCheckWaivers\" src/shared/workflow/validation-mechanical.ts; grep -q \"brokenObjectiveChecks\" src/shared/workflow/validation-mechanical.ts'"
      rationale: "The validation loop must prove the user judgement path exists in production, not only in a helper."
    - id: "OC2"
      command: "bash -lc 'set -euo pipefail; out=$(deno run -A scripts/run-tests.js --filter \"task_completed accepts execution-agent broken Objective Check reports\" src/tools/__tests__/task-completed.test.js 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed \\\\| 0 failed\"; grep -q \"brokenObjectiveChecks\" src/tools/task-completed.ts; grep -q \"brokenObjectiveChecks\" src/shared/session/task-completion-session.ts; grep -q \"brokenObjectiveChecks\" src/shared/workflow/validation-session-adapter.ts'"
      rationale: "The completion path must expose, persist, and return structured broken-check reports."
    - id: "OC3"
      command: "bash -lc 'set -euo pipefail; plan_out=$(deno run -A scripts/run-tests.js --filter \"objectiveCheckWaivers normalize accepted broken-check evidence only\" src/plan-store.test.js 2>&1); record_out=$(deno run -A scripts/run-tests.js --filter \"Work Record generation includes accepted Objective Check waivers\" src/shared/work-records/work-records.test.js 2>&1); printf \"%s\\n%s\\n\" \"$plan_out\" \"$record_out\"; printf \"%s\\n\" \"$plan_out\" | grep -Eq \"1 passed \\\\| 0 failed\"; printf \"%s\\n\" \"$record_out\" | grep -Eq \"1 passed \\\\| 0 failed\"; grep -q \"objectiveCheckWaivers\" src/plan-front-matter.js; grep -q \"objectiveCheckWaivers\" src/plan-store.js; grep -q \"objectiveCheckWaivers\\|Objective Check Waiver\" src/shared/work-records/generation.js'"
      rationale: "Durable Plan metadata and Work Record generation must carry waiver evidence."
objectiveChecksBaseline:
    recordedAt: "2026-08-06T14:24:59.435Z"
    head: "42fdade59a92236cbe3c8c36e0ee7bdcd634b4f0"
    results:
        - id: "OC1"
          command: "bash -lc 'set -euo pipefail; out=$(deno run -A scripts/run-tests.js --filter \"^runValidationLoop asks the user to waive Engineer-reported broken Objective-Failing Checks and preserves other passed validation$\" src/shared/workflow/validation-loop-repair.test.js 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed \\\\| 0 failed\"; grep -q \"objectiveCheckWaivers\" src/shared/workflow/validation-mechanical.ts; grep -q \"brokenObjectiveChecks\" src/shared/workflow/validation-mechanical.ts'"
          rationale: "The validation loop must prove the user judgement path exists in production, not only in a helper."
          status: "unmet"
          stdout: "\n\u001b[0m\u001b[32mok\u001b[0m | 0 passed | 0 failed | 8 filtered out \u001b[0m\u001b[38;5;245m(3ms)\u001b[0m\n"
          stderr: ""
          exitCode: 1
          durationMs: 41567
          output: "\n\u001b[0m\u001b[32mok\u001b[0m | 0 passed | 0 failed | 8 filtered out \u001b[0m\u001b[38;5;245m(3ms)\u001b[0m\n\n"
        - id: "OC2"
          command: "bash -lc 'set -euo pipefail; out=$(deno run -A scripts/run-tests.js --filter \"^task_completed captures Objective-Failing Check broken reports from execution agents$\" src/tools/__tests__/task-completed.test.js 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed \\\\| 0 failed\"; grep -q \"brokenObjectiveChecks\" src/tools/task-completed.ts; grep -q \"brokenObjectiveChecks\" src/shared/session/task-completion-session.ts; grep -q \"brokenObjectiveChecks\" src/shared/workflow/validation-session-adapter.ts'"
          rationale: "The completion path must expose, persist, and return structured broken-check reports."
          status: "unmet"
          stdout: "\n\u001b[0m\u001b[32mok\u001b[0m | 0 passed | 0 failed | 13 filtered out \u001b[0m\u001b[38;5;245m(4ms)\u001b[0m\n"
          stderr: ""
          exitCode: 1
          durationMs: 1322
          output: "\n\u001b[0m\u001b[32mok\u001b[0m | 0 passed | 0 failed | 13 filtered out \u001b[0m\u001b[38;5;245m(4ms)\u001b[0m\n\n"
        - id: "OC3"
          command: "bash -lc 'set -euo pipefail; out=$(deno run -A scripts/run-tests.js --filter \"^Plan front matter and Work Records preserve Objective Check Waivers$\" src/plan-store.test.js src/shared/work-records/work-records.test.js 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"2 passed \\\\| 0 failed\"; grep -q \"objectiveCheckWaivers\" src/plan-front-matter.js; grep -q \"objectiveCheckWaivers\" src/plan-store.js; grep -q \"objectiveCheckWaivers\\|Objective Check Waiver\" src/shared/work-records/generation.js'"
          rationale: "Durable Plan metadata and Work Record generation must carry waiver evidence."
          status: "unmet"
          stdout: "\n\u001b[0m\u001b[32mok\u001b[0m | 0 passed | 0 failed | 140 filtered out \u001b[0m\u001b[38;5;245m(377ms)\u001b[0m\n"
          stderr: ""
          exitCode: 1
          durationMs: 2066
          output: "\n\u001b[0m\u001b[32mok\u001b[0m | 0 passed | 0 failed | 140 filtered out \u001b[0m\u001b[38;5;245m(377ms)\u001b[0m\n\n"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-06T00:42:15-04:00"
updatedAt: "2026-08-07T03:49:12.057Z"
status: "user_verified"
origin: "internal"
failureReason: "Objective-Failing Checks unmet.\n\nObjective-Failing Checks: 0 met, 3 unmet, 0 broken (3 total).\n\n- OC1: unmet\n  command: bash -lc 'set -euo pipefail; out=$(deno run -A scripts/run-tests.js --filter \"^runValidationLoop asks the user to waive Engineer-reported broken Objective-Failing Checks and preserves other passed validation$\" src/shared/workflow/validation-loop-repair.test.js 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed \\\\| 0 failed\"; grep -q \"objectiveCheckWaivers\" src/shared/workflow/validation-mechanical.ts; grep -q \"brokenObjectiveChecks\" src/shared/workflow/validation-mechanical.ts'\n  rationale: The validation loop must prove the user judgement path exists in production, not only in a helper.\n  exitCode: 1\n  output:\n    \u001b[0m\u001b[32mok\u001b[0m | 0 passed | 0 failed | 8 filtered out \u001b[0m\u001b[38;5;245m(2ms)\u001b[0m\n\n- OC2: unmet\n  command: bash -lc 'set -euo pipefail; out=$(deno run -A scripts/run-tests.js --filter \"^task_completed captures Objective-Failing Check broken reports from execution agents$\" src/tools/__tests__/task-completed.test.js 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed \\\\| 0 failed\"; grep -q \"brokenObjectiveChecks\" src/tools/task-completed.ts; grep -q \"brokenObjectiveChecks\" src/shared/session/task-completion-session.ts; grep -q \"brokenObjectiveChecks\" src/shared/workflow/validation-session-adapter.ts'\n  rationale: The completion path must expose, persist, and return structured broken-check reports.\n  exitCode: 1\n  output:\n    \u001b[0m\u001b[32mok\u001b[0m | 0 passed | 0 failed | 13 filtered out \u001b[0m\u001b[38;5;245m(3ms)\u001b[0m\n\n- OC3: unmet\n  command: bash -lc 'set -euo pipefail; out=$(deno run -A scripts/run-tests.js --filter \"^Plan front matter and Work Records preserve Objective Check Waivers$\" src/plan-store.test.js src/shared/work-records/work-records.test.js 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"2 passed \\\\| 0 failed\"; grep -q \"objectiveCheckWaivers\" src/plan-front-matter.js; grep -q \"objectiveCheckWaivers\" src/plan-store.js; grep -q \"objectiveCheckWaivers\\|Objective Check Waiver\" src/shared/work-records/generation.js'\n  rationale: Durable Plan metadata and Work Record generation must carry waiver evidence.\n  exitCode: 1\n  output:\n    \u001b[0m\u001b[32mok\u001b[0m | 0 passed | 0 failed | 140 filtered out \u001b[0m\u001b[38;5;245m(330ms)\u001b[0m"
implementedAt: "2026-08-06T14:41:01.155Z"
userVerifiedAt: "2026-08-06T20:35:37.123Z"
userVerificationNote: "Approved by the user after review; the completed implementation is already present on main and the stale execution worktree was removed."
executionReport: "- Blocked: implementation cannot proceed because this session exposes only `task_completed` (and parallel wrapper) tools; there are no file inspection/editing or test execution tools available.\n- Not completed: no Plan implementation steps were modified or verified.\n- Verification not run: unable to execute `deno run -A scripts/run-tests.js ...`, `deno task seams:check`, or `deno task test` without shell access."
workRecord:
    status: "generated"
    recordId: "9774371f-a810-4b43-8f23-fc338a569a18"
    path: "docs/work-records/2026-08-07-objective-check-waivers-added.md"
    lastAttemptAt: "2026-08-07T03:49:04.911Z"
humanReviewMode: null
humanReviewDecision: null
executionMode: "worktree"
executionBaselineTree: "c53913749f640882b82b1b23e74cee148a49f87d"
worktreeId: "b894af27"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-objective-check-waivers-b894af27"
worktreeBranch: "worktree/objective-check-waivers-b894af27"
worktreeBaseBranch: "main"
worktreeStatus: "validation_failed"
validationCiAttempts: 0
validationSemanticRounds: 0
---

# Objective Check Waivers

## Context

RunWield now classifies one known impossible Objective-Failing Check case as `broken`: a case-only path contradiction on
a case-insensitive filesystem. That avoids an impossible Engineer repair loop for that case.

The remaining product problem is wider. An Objective-Failing Check can be logically or environment-impossible in ways
RunWield cannot detect ahead of time. In that case, Engineer is the first agent that can inspect the failure, the code,
and the Plan intent. The user decided that Engineer must be able to report a check as broken with an explanation, and
RunWield must route that claim to user judgement instead of repeatedly asking Engineer to make an impossible assertion
pass.

The user's decisions for this Plan are:

- Preserve the rest of a good validation run. One broken check must not invalidate all work when other checks, review,
  or evidence are good.
- If feasible, re-check Objective-Failing Checks against the baseline commit before execution, but do not make that path
  expensive in normal validation.
- Let Engineer report broken Objective-Failing Checks through `task_completed` with a structured explanation.
- Show Engineer's explanation to the user and ask whether to waive the check after all other Objective-Failing Checks
  have run.
- If all non-waived checks are met and the user confirms the waiver, continue Workflow Validation.
- If the user rejects the waiver, collect feedback and send Engineer back with that feedback.
- Treat mechanically detected broken checks and Engineer-reported broken checks through the same user judgement path
  after execution.
- Store accepted waivers durably in Plan Front Matter, because RunWield does not mutate the approved Plan body during
  execution.
- Include waiver evidence in the Plan metadata and generated Work Record so future readers know the check was
  user-waived, not met.

## Objective

Add a generic Objective Check Waiver path. A waiver is a durable user decision that one Objective-Failing Check is
broken and should not block Workflow Validation for the current implementation attempt.

After this change, RunWield will have these outcomes for Objective-Failing Checks during validation:

- `met`: the command exits 0 and the objective evidence is satisfied.
- `unmet`: the command is a valid red/green assertion that failed; Engineer repairs the implementation.
- `broken`: the command cannot reliably prove the objective in the current environment or workflow; RunWield asks the
  user whether to waive it.
- `waived`: the user accepted a broken-check explanation for the current implementation attempt; RunWield records the
  waiver and ignores only that check while deciding whether the Objective-Failing Check phase can pass.

## Approach

Keep the existing `met` / `unmet` / `broken` result model. Add a separate durable waiver layer instead of changing
`broken` into success. This keeps check execution truthful: the command did not pass, but the user accepted that the
check was defective.

The core flow is:

1. Run all Objective-Failing Checks and classify each result.
2. Apply existing Plan Front Matter waivers that still match the check id and command.
3. If any unwaived check is mechanically `broken`, ask the user whether to waive it.
4. If any check is `unmet`, dispatch Engineer repair as today.
5. During Objective-Failing Check repair, let Engineer call `task_completed` with `brokenObjectiveChecks` entries. The
   validation adapter returns those entries with the repair outcome.
6. Re-run Objective-Failing Checks after repair. If Engineer claimed one or more checks are broken, present the fresh
   check output plus Engineer's explanation to the user.
7. If the user waives the claimed broken checks and all remaining checks are met, record `objectiveCheckWaivers` in
   Front Matter and advance Mechanical Validation.
8. If the user rejects the waiver, collect feedback and dispatch Engineer again with that feedback; do not consume the
   automatic repair budget as if this were a normal unmet implementation defect.

Store only accepted waivers durably. Rejected waiver feedback belongs to the immediate repair turn and to the Session
Transcript, not to canonical Plan metadata.

Do not move broken-check judgement into Semantic Review. The owner of Objective-Failing Check execution is the
mechanical validation phase; Reviewer can still assess whether the implementation matches the Plan after the waiver path
lets validation continue.

## Files to Modify

- `src/tools/task-completed.ts` — extend the execution-agent tool schema with optional `brokenObjectiveChecks` entries
  and document when Engineer should use them.
- `src/shared/session/task-completion-session.ts` — persist and claim structured task completion metadata, not only the
  Markdown report.
- `src/shared/session/hosted-session.js` — extend the volatile pending task completion shape and JSONL replay shape to
  include broken Objective-Failing Check reports.
- `src/shared/workflow/validation-ports.ts` — extend `AgentTurnOutcome` and `ValidationWorkflowState` with broken
  Objective-Failing Check reports and accepted waiver state needed by the session-independent validation engine.
- `src/shared/workflow/validation-types.ts` — add types for `ObjectiveCheckWaiver`, `BrokenObjectiveCheckReport`, and
  waiver decision outcomes.
- `src/shared/workflow/validation-mechanical.ts` — implement the waiver decision flow, preserve non-waived check
  handling, and route user rejection feedback back to Engineer.
- `src/shared/workflow/objective-checks.ts` — add helpers that filter/apply waivers to fresh check results and format
  waiver-aware summaries without treating `broken` as `met`.
- `src/shared/workflow/validation-session-adapter.ts` — return structured broken-check reports from claimed task
  completions to the validation engine.
- `src/plan-front-matter.js` — register `objectiveCheckWaivers` in the canonical Front Matter key order near
  `objectiveChecksBaseline`.
- `src/plan-store.js` — normalize, round-trip, and preserve `objectiveCheckWaivers` with exact check id, command,
  explanation, user note, source, and timestamp.
- `src/shared/work-records/generation.js` — include user-waived Objective-Failing Check evidence in generated Work
  Records.
- `CONTEXT.md` — add the canonical term `Objective Check Waiver` and define it as a user-owned validation judgement, not
  proof that the check passed.
- `docs/plan-lifecycle.md` — document how waivers affect Workflow Validation and how they differ from `user_verified`.
- `docs/workflows.md` — document the user-facing broken-check prompt and retry/reject behavior.
- `src/tools/__tests__/task-completed.test.js` — cover the real `task_completed` schema and pending-completion
  persistence for broken-check reports.
- `src/shared/workflow/objective-checks.test.ts` — cover waiver matching by id and command, stale waiver rejection, and
  summaries that keep waived distinct from met.
- `src/shared/workflow/validation-loop-repair.test.js` — cover the end-to-end validation loop for Engineer-reported and
  mechanically detected broken checks.
- `src/plan-store.test.js` — cover Front Matter normalization and round-trip of `objectiveCheckWaivers`.
- `src/shared/work-records/work-records.test.js` — cover generated Work Record evidence for user-waived
  Objective-Failing Checks.

## Reuse Opportunities

- `src/shared/workflow/objective-checks.ts` — reuse `ObjectiveCheckResult`, `summarizeObjectiveChecks`, and existing
  `broken` classification instead of inventing a second check runner.
- `src/shared/workflow/validation-interactions.ts` — reuse `requestInteraction` for the waiver approval and
  rejection-feedback prompts; use `pauseForUserAction` only for the existing Retry/Stop pauses.
- `src/shared/workflow/state-transition.ts` — use transactional Front Matter writes for `objectiveCheckWaivers`; do not
  hand-edit Plan metadata.
- `src/shared/session/task-completion-session.ts` — extend the existing task completion journal rather than inferring
  from assistant text.
- `src/shared/workflow/validation-session-adapter.ts` — keep session-specific pending completion claim/acknowledge logic
  behind the validation port.
- `src/shared/work-records/generation.js` — reuse existing Work Record completion-mode and evidence sections.

## Implementation Steps

- [ ] `task_completed` accepts an optional `brokenObjectiveChecks` parameter only for execution agents. Each entry has
      `id` and non-empty `explanation`; it may include `command` when known. The tool result and emitted workflow
      message remain backward-compatible for calls that only pass `message`.
- [ ] Pending task completion records in `HostedSession` and `task-completion-session.ts` preserve
      `brokenObjectiveChecks` through volatile storage, JSONL replay, claim, and acknowledge. Existing report-only
      completions still claim and acknowledge exactly once.
- [ ] `ValidationSessionPort.runActiveAgentTurn()` returns `{ completed, report, brokenObjectiveChecks }`.
      `validation-session-adapter.ts` populates this from the claimed task completion and returns an empty array when no
      structured report exists.
- [ ] `ObjectiveCheckWaiver` is a normalized Plan Front Matter record with `id`, `command`, `source`, `explanation`,
      `userNote`, and `waivedAt`. It is stored under `objectiveCheckWaivers` and round-trips in canonical key order
      after `objectiveChecksBaseline`.
- [ ] Waiver matching requires both `id` and exact `command`. A stale waiver for the same id but different command does
      not apply and is either ignored or pruned on the next waiver write.
- [ ] `objective-checks.ts` exports helpers that split fresh results into `met`, `unmet`, `broken`, and `waived` using
      the current Plan Front Matter waivers. Summaries identify waived checks separately and never report a waived check
      as `met`.
- [ ] `runPlanObjectiveChecks()` runs all checks before asking the user about broken checks. One broken check does not
      stop later checks from running.
- [ ] Mechanically detected broken checks after execution call the same user waiver prompt as Engineer-reported broken
      checks. The prompt includes the check id, command, output/reason, existing check summary, and the explanation
      source.
- [ ] Objective-Failing Check repair dispatch tells Engineer to use `task_completed({ brokenObjectiveChecks: [...] })`
      when a check itself is defective. The instruction also says not to edit the Plan unless the user asks for Plan
      repair.
- [ ] After an Objective-Failing Check repair turn, Engineer-reported broken checks are held as claims, not proof.
      Validation re-runs the checks, then asks the user whether to waive only claims that still correspond to currently
      broken or still-failing check results.
- [ ] If the user accepts the waiver and all non-waived checks are met, RunWield persists `objectiveCheckWaivers`,
      records Mechanical Validation as passed, and continues to the next validation phase without deleting prior
      validation or review metadata that is still valid.
- [ ] If the user rejects the waiver, RunWield asks for a short feedback note and dispatches Engineer again with the
      note, the check output, and Engineer's prior explanation. This rejection path does not increment the automatic
      repair-attempt budget for normal unmet implementation defects.
- [ ] If at least one non-waived Objective-Failing Check remains `unmet`, RunWield dispatches Engineer repair for those
      checks even if another check was waived.
- [ ] Pre-execution Objective-Failing Check baselining keeps its current behavior: already-met checks and broken checks
      reject the Plan before execution starts. Existing or stale waivers must not let a Plan pass baseline readiness.
- [ ] Work Record generation includes a concise evidence note for each accepted waiver: check id, command, source
      (`engineer_report` or `mechanical_detection`), Engineer or RunWield explanation, user note, and waiver timestamp.
- [ ] `CONTEXT.md`, `docs/plan-lifecycle.md`, and `docs/workflows.md` define `Objective Check Waiver` as user judgement
      over a defective check. They state that a waiver is not proof that the check passed and is narrower than marking a
      whole Plan `user_verified`.

## Verification Plan

- Automated:
  `deno run -A scripts/run-tests.js src/tools/__tests__/task-completed.test.js src/shared/workflow/objective-checks.test.ts src/shared/workflow/validation-loop-repair.test.js src/plan-store.test.js src/shared/work-records/work-records.test.js`
- Automated: `deno task seams:check`
- Automated: `deno task test`
- Manual: Start a Plan execution with two Objective-Failing Checks where one passes after implementation and one is
  logically broken. Confirm all checks run, RunWield shows the broken-check explanation, and accepting the waiver
  continues validation.
- Manual: Reject the same waiver prompt with feedback. Confirm Engineer receives the feedback and RunWield does not
  present it as a normal implementation failure.
- Manual: Re-run validation after a waiver is stored. Confirm the matching waived check does not block, but changing the
  command makes the waiver stale and ineffective.
- Expected result: a waived Objective-Failing Check is visible in Plan Front Matter and the Work Record, and it is not
  counted as a met check.
- Expected result: pre-execution baselining still rejects broken checks before Engineer starts, even if Front Matter
  contains stale waiver data.

### Objective-Failing Checks

- `OC1` —
  `bash -lc 'set -euo pipefail; out=$(deno run -A scripts/run-tests.js --filter "^runValidationLoop asks the user to waive Engineer-reported broken Objective-Failing Checks and preserves other passed validation$" src/shared/workflow/validation-loop-repair.test.js 2>&1); printf "%s\n" "$out"; printf "%s\n" "$out" | grep -Eq "1 passed \\| 0 failed"; grep -q "objectiveCheckWaivers" src/shared/workflow/validation-mechanical.ts; grep -q "brokenObjectiveChecks" src/shared/workflow/validation-mechanical.ts'`
  — the validation loop must prove the user judgement path exists in production, not only in a helper.
- `OC2` —
  `bash -lc 'set -euo pipefail; out=$(deno run -A scripts/run-tests.js --filter "^task_completed captures Objective-Failing Check broken reports from execution agents$" src/tools/__tests__/task-completed.test.js 2>&1); printf "%s\n" "$out"; printf "%s\n" "$out" | grep -Eq "1 passed \\| 0 failed"; grep -q "brokenObjectiveChecks" src/tools/task-completed.ts; grep -q "brokenObjectiveChecks" src/shared/session/task-completion-session.ts; grep -q "brokenObjectiveChecks" src/shared/workflow/validation-session-adapter.ts'`
  — the completion path must expose, persist, and return structured broken-check reports.
- `OC3` —
  `bash -lc 'set -euo pipefail; out=$(deno run -A scripts/run-tests.js --filter "^Plan front matter and Work Records preserve Objective Check Waivers$" src/plan-store.test.js src/shared/work-records/work-records.test.js 2>&1); printf "%s\n" "$out"; printf "%s\n" "$out" | grep -Eq "2 passed \\| 0 failed"; grep -q "objectiveCheckWaivers" src/plan-front-matter.js; grep -q "objectiveCheckWaivers" src/plan-store.js; grep -q "objectiveCheckWaivers\|Objective Check Waiver" src/shared/work-records/generation.js'`
  — durable Plan metadata and Work Record generation must carry waiver evidence.

## Edge Cases & Considerations

- **Waiver freshness:** A waiver is valid only for the same check id and exact command. This prevents a user decision
  about one defective assertion from silently applying to a revised check.
- **Baseline safety:** Waivers apply only after execution starts. Pre-execution baseline checks must still be red and
  mechanically sound, so a defective Plan check returns to Planner before Engineer starts.
- **Partial success:** If one check is waived and another is unmet, validation must repair the unmet check. A waiver is
  not a blanket pass for the Objective-Failing Check phase.
- **Repair budget:** User rejection of a broken-check claim is not the same as another failed implementation repair. Do
  not consume the automatic unmet-check repair budget for the rejection turn.
- **Evidence language:** Work Records must say `user-waived` or `Objective Check Waiver`, not `met`, `passed`, or
  `verified`, for waived checks.
- **No new test seam:** Do not add dependency bags or production fallback seams for this work. Use the real
  task-completion journal, Plan store, validation adapter, and workflow fixtures.
- **Compatibility:** Existing Plans without `objectiveCheckWaivers` must load unchanged. Existing
  `task_completed({ message })` calls must keep working for all agents.
