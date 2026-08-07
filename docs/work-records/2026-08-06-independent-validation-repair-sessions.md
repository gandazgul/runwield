---
kind: "work_record"
recordId: "92b80df9-a161-4378-815f-24ee6cfc77be"
status: "approved"
scope: "planned_change"
workKind: "REFACTOR"
origin: "internal"
completionMode: "user_verified"
createdAt: "2026-08-06T20:48:58.000Z"
provenance:
    sourcePlans:
        - "4b13c3a5-f10f-4e41-8d4d-f673972bd2e0"
---

# Independent Validation Repair Sessions

## Summary

The user approved this result after working with Codex outside RunWield to complete and verify it. RunWield Workflow
Validation did not establish the lifecycle result.

Validation repairs now run in independent Agent sessions instead of extending the original Engineer transcript. CI,
Objective Check, semantic-review, and merge repairs receive a bounded packet with the repair checkout, relevant worktree
and branch context, a link to the saved Plan when one exists, the current feedback, and an explicit instruction to
verify the repair and call `task_completed` again. Semantic repair no longer copies the full Plan into its prompt, and
QUICK_FIX repairs do not claim that a Plan exists.

This change addresses high Engineer token consumption during validation. A representative affected session used 103,273
fresh input tokens and 1,421,312 cache-read tokens across 29 turns. Its displayed total was 1,527,196 tokens. The main
causes were repeated large Plan prompts, accumulated implementation history, and large CI or Objective Check outputs.
Independent repairs remove the implementation transcript from each repair context. Exact savings depend on the Plan,
diff, validation output, model, and number of repair rounds.

## Implementation

- Added a typed shared validation-repair prompt builder. Its packet identifies the repair checkout, original execution
  worktree when different, project root, worktree ID and branch, target branch, Plan file link, and current feedback.
- Added the required instruction: the Agent completed the work, validation found a problem, it must address the
  feedback, verify the repair, and call `task_completed` again.
- Replaced the active root-session repair port with `runIndependentRepairTurn`. The session adapter creates a fresh
  in-memory `SessionManager` for each repair and reads the new session's completion report.
- Routed CI failure repair, Objective-Failing Check repair, and merge repair through the independent repair port.
- Kept semantic-review repair in its focused isolated Reviewer-Feedback Engineer session, but changed it to use the same
  bounded packet and Plan link instead of an inline Plan body.
- Preserved structured `brokenObjectiveChecks` results through the independent completion report.
- Updated workflow and architecture documentation to make independent repair context a durable validation invariant.
- Updated the Golden TUI actor identity logic so an isolated Engineer is identified from its system prompt even while
  the composed TUI still shows the prior Agent.

## Verification Evidence

- The focused validation suite passed: 45 tests, 0 failures. It covers the repair packet, root-session isolation,
  completion gating, mechanical repair, semantic repair, publication pause behavior, and completion-result parsing.
- Mutation checks proved the new assertions were effective: routing a repair through the root session failed the
  isolation test, and removing the Plan link failed the prompt test. The production implementation was then restored.
- The repaired-merge publication Golden scenario passed after the test harness learned to identify the independent
  Engineer session.
- `deno task check` type-checked 572 source files.
- `deno task seams:check` held the zero-injection-seam baseline.
- `git diff --check` passed.
- Full `deno task ci` passed with 251 test files and 0 failures. The Snip usage tracker reported its existing read-only
  database warning, but lint and all CI gates passed.

## Deviations from Plan

The Plan and Work Record were created after implementation to preserve a durable record. The implementation was done
with Codex outside the RunWield-managed execution and validation lifecycle. The user approved the completed result.

## Future Planning Notes

- Measure fresh input and cache-read tokens for repair turns separately from the original implementation session so the
  token reduction can be quantified in normal use.
- Keep future repair packets bounded. Prefer links and exact current feedback over copied Plans, transcripts, or full
  validation histories.
- If another repair type is added, route it through the independent repair port unless it needs a more specialized
  isolated Agent contract.
