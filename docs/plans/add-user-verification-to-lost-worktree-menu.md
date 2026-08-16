---
planId: "bc990d08-29bc-41c9-8548-7c51bbc4d5e0"
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "LOW"
summary: "Offer the existing User Verified attestation from the lost-worktree recovery menu when the Plan is eligible."
affectedPaths:
    - "src/cmd/load-plan/plan-recovery-flow.ts"
    - "src/cmd/load-plan/plan-recovery-flow.test.ts"
objectiveChecks:
    - id: "OC1"
      command: "deno eval 'const s=await Deno.readTextFile(\"src/cmd/load-plan/plan-recovery-flow.ts\"); const b=s.slice(s.indexOf(\"if (physicallyLost)\"), s.indexOf(\"const resetLabel\")); if (!(b.includes(\"isUserVerifiableStatus\") && b.includes(\"value: \\\"user_verify\\\"\") && b.includes(\"Mark as User Verified\"))) Deno.exit(1);'"
      rationale: "This fails on the current source because the physically-lost recovery branch has no eligible User Verified option; it passes only after that branch contains the established eligibility check and action."
objectiveChecksBaseline:
    recordedAt: "2026-08-16T02:42:12.459Z"
    head: "5464ee3f997f7a8152ce1ff537174db315ed01b0"
    results:
        - id: "OC1"
          command: "deno eval 'const s=await Deno.readTextFile(\"src/cmd/load-plan/plan-recovery-flow.ts\"); const b=s.slice(s.indexOf(\"if (physicallyLost)\"), s.indexOf(\"const resetLabel\")); if (!(b.includes(\"isUserVerifiableStatus\") && b.includes(\"value: \\\"user_verify\\\"\") && b.includes(\"Mark as User Verified\"))) Deno.exit(1);'"
          rationale: "This fails on the current source because the physically-lost recovery branch has no eligible User Verified option; it passes only after that branch contains the established eligibility check and action."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 40
          output: "\n"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-15T22:39:39-04:00"
updatedAt: "2026-08-16T04:52:39.927Z"
status: "validated_reviewer"
origin: "internal"
implementedAt: "2026-08-16T03:06:33.700Z"
userVerifiedAt: null
executionReport: "- Implemented: the lost-worktree recovery menu now offers `user_verify` for eligible statuses such as `implemented`, and the normal recovery menu hides `user_verify` for ineligible statuses such as `failed`.\n- Preserved: selecting `user_verify` still uses `userVerifyRecoveryPlan()` and `markPlanUserVerified()`, with the required note and no new validation claim.\n- Tests: added 1 recovery test for implemented lost-worktree User Verification; rewrote the existing lost-worktree test to keep the failed-plan stop flow while asserting `user_verify` is omitted; no tests were deleted.\n- Verification passed: `deno run -A scripts/run-tests.js src/cmd/load-plan/plan-recovery-flow.test.ts`; objective check command; `git diff --check` for changed files.\n- Mutation checks passed: removing the lost-worktree User Verification option and forcing normal-menu User Verification for failed plans each made the recovery test file fail, then both mutations were reverted.\n- Full CI did not pass: `deno task ci` failed twice in `src/ui/tui/golden-scenarios/project-workflow.test.js` under the full suite; rerunning `deno run -A scripts/run-tests.js src/ui/tui/golden-scenarios/project-workflow.test.js` passed standalone."
humanReviewMode: null
humanReviewDecision: null
validationCheckpoint: null
executionMode: "worktree"
executionBaselineTree: "a71a1df1060f4e8b93d68c4577290e9aa64baff0"
worktreeId: "a40ec8c2"
worktreePath: "/Users/gandazgul/.wld/worktrees/--Users-gandazgul-Documents-web-runwield--/runwield-add-user-verification-to-lost-worktree-menu-a40ec8c2"
worktreeBranch: "worktree/add-user-verification-to-lost-worktree-menu-a40ec8c2"
worktreeBaseBranch: "main"
worktreeStatus: "validation_failed"
validationCiAttempts: 0
validationObjectiveCheckAttempts: 0
validationSemanticRounds: 0
---

# Add User Verification to the Lost-Worktree Recovery Menu

## Context

When `wld load-plan` finds that a Plan's recorded execution worktree and branch are both gone, it shows a special
recovery menu. That menu currently offers another implementation attempt, review by Planner, or stopping recovery. It
omits the User Verified outcome that the normal recovery menu already offers.

For an implemented Plan, this omission prevents the user from recording that they accept the result when RunWield can no
longer complete Workflow Validation from the lost execution attempt. The existing User Verification flow already
collects a required attestation note, records terminal Plan Status `user_verified`, and does not claim RunWield Workflow
Validation, `verifiedAt`, or Delivery Evidence.

## Objective

Eligible Plans with a physically lost execution attempt can be marked User Verified directly from the special recovery
menu. Plans that are not eligible for User Verification do not show an action that the lifecycle will reject.

## Approach

Reuse the existing `isUserVerifiableStatus()` eligibility rule and `userVerifyRecoveryPlan()` action. Add the same
conditional User Verified option to the physically-lost branch that the normal recovery menu uses, then apply the
eligibility rule to the normal menu as well.

For the implemented Plan shown in the reported flow, the menu becomes:

```text
Try the implementation again
Mark as User Verified (user attestation; no Workflow Validation claim)
Send the Plan back to Planner
Stop here
```

Selecting User Verified continues through the established path:

```text
lost-worktree menu
  -> userVerifyRecoveryPlan
  -> markPlanUserVerified
  -> required attestation note
  -> manual_user_verified Plan Event
  -> status: user_verified
```

The alternative was to add a new “User Approved” status or recovery action. That would duplicate the existing terminal
attestation outcome and could confuse it with pre-execution Plan Status `approved`.

## Files to Modify

- `src/cmd/load-plan/plan-recovery-flow.ts` — include the existing User Verified action in the physically-lost menu when
  `isUserVerifiableStatus()` permits it, and use the same eligibility condition in the normal recovery menu.
- `src/cmd/load-plan/plan-recovery-flow.test.ts` — cover physically lost attempts for both an eligible implemented Plan
  and an ineligible failed Plan.

## Reuse Opportunities

- `src/cmd/load-plan/plan-hold.ts` — reuse `isUserVerifiableStatus()` and the existing `markPlanUserVerified()` flow; do
  not add another lifecycle rule or attestation implementation.
- `src/cmd/load-plan/plan-recovery-actions.ts` — keep using `userVerifyRecoveryPlan()` and the existing `user_verify`
  dispatch branch.
- `src/shared/workflow/plan-lifecycle.js` — retain `manual_user_verified` as the lifecycle owner for the terminal
  status, note, timestamp, and validation-evidence rules.

## Implementation Steps

- [ ] The physically-lost recovery menu includes `user_verify` with the established “Mark as User Verified” label when
      `isUserVerifiableStatus(context.plan.attrs.status)` is true, including for Plan Status `implemented`.
- [ ] Both physically-lost and normal recovery menus omit `user_verify` when the current Plan Status is not eligible,
      including Plan Status `failed`; no displayed recovery choice can immediately fail only because its status is
      unsupported.
- [ ] Selecting the new option continues to dispatch through `userVerifyRecoveryPlan()` and `markPlanUserVerified()`; it
      does not add a new status, bypass the required note, set `verifiedAt`, or claim Workflow Validation.
- [ ] Recovery tests prove that an implemented Plan with a missing worktree and missing branch is offered User
      Verification, while the existing failed-Plan lost-attempt case remains limited to valid recovery actions.

## Approval Confirmation

No Work Records are superseded by this Plan.

## Verification Plan

- Automated: run `deno run -A scripts/run-tests.js src/cmd/load-plan/plan-recovery-flow.test.ts`.
- Automated regression: the physically-lost implemented-Plan test must fail if `user_verify` is removed from that menu;
  the failed-Plan test must fail if the unavailable action is shown.
- Manual: load an `implemented` Plan whose recorded worktree path and branch are both gone. Confirm the menu shows
  **Mark as User Verified**, select it, enter a non-empty attestation note, and confirm the Plan becomes `user_verified`
  with `userVerificationNote` and `userVerifiedAt` but without a new `verifiedAt` or Delivery Evidence claim.
- Existing behavior that remains protected: retry implementation, return to Planner, and stop-recovery actions remain
  available in the lost-attempt menu. The only behavior expected to stop is showing User Verification in recovery states
  that the lifecycle does not permit, such as `failed`.

## Edge Cases & Considerations

- A missing worktree is not proof that implementation succeeded. The user must explicitly select User Verified and
  provide the existing required attestation note.
- User Verification is terminal but is not RunWield verification. Keep the current explicit label and confirmation
  messages so the distinction remains visible.
- Preserve lost worktree and failure facts according to the existing `manual_user_verified` lifecycle transition; this
  change must not invent cleanup or merge-back evidence.
- No domain-language or lifecycle documentation change is needed because this exposes an already documented status and
  event on one additional recovery menu.
