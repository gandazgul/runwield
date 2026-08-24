---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Let users optionally talk to the Semantic Reviewer or accept its findings for the current delivery before RunWield dispatches validation repair."
affectedPaths:
    - "src/shared/settings.js"
    - "src/shared/settings.test.js"
    - "config.schema.json"
    - "src/shared/workflow/validation-semantic.ts"
    - "src/shared/workflow/validation-user-messages.ts"
    - "src/shared/workflow/validation-loop-review.test.js"
    - "src/agent-definitions/subagent-definitions/reviewer-prompt.md"
    - "src/agent-definitions/subagent-definitions/reviewer-verify-prompt.md"
    - "src/ui/tui/golden-scenarios/validation-workflow-tree-semantic.ts"
    - "src/ui/tui/testing/validation-workflow-coverage.ts"
    - "docs/domain-language.md"
    - "docs/settings.md"
    - "docs/workflows.md"
    - "docs/validation-authority.md"
    - "src/skills/runwield/SETTINGS.md"
    - "src/skills/runwield/PLANS.md"
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-08-15T10:38:18-04:00"
status: "draft"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
updatedAt: "2026-08-15T14:39:52.838Z"
planId: "72deac45-7e8d-4ad4-893b-e02be945f001"
---

# Offer Semantic Review Intervention

## Context

Semantic Code Review currently dispatches the Validation Repair Engineer as soon as the Reviewer submits blocking Review
Issues. The user cannot first explain missing context, ask the Reviewer to reconsider, or decide that the current
delivery is acceptable as-is.

RunWield should guide and challenge the user without taking final authority away from them. A one-delivery exception
must also stay distinct from a durable product rule. If a behavior should guide future work, the user can record it
explicitly in Memory, `RUNWIELD.md`, the approved Plan, or another project document. RunWield must not infer that
durable rule from a review conversation.

This Plan is intentionally a loose draft because Workflow Validation repair and Golden terminal user interface (TUI)
coverage are changing in the current working tree. **Execution must wait until that work is committed or otherwise
settled.** The implementer must re-read the resulting semantic-review call path and adapt the named integration points
without restoring an older validation design.

## Objective

Add `semanticReviewIntervention: "never" | "ask"` at global and project scope, with `never` as the default. In `ask`
mode, pause after a valid Reviewer rejection and before any repair dispatch. Let the user talk to the same in-memory
Reviewer context, accept the current delivery as-is, or continue to the normal repair flow.

A user acceptance is a **Review Override** for this Plan delivery only. It permits normal Workflow Validation to
continue toward RunWield Verified. It does not become Memory, project guidance, a Work Record finding, or a reusable
waiver.

## Approach

Keep the intervention inside the Semantic Code Review phase. Do not promote Reviewer to a selectable root Agent and do
not create a new persistent Reviewer transcript. Reuse the in-memory Reviewer session manager that already supports
nudges within one review round.

```text
Reviewer submits feedback
  |
  +-- semanticReviewIntervention = never
  |      -> apply findings -> existing repair handoff
  |
  +-- semanticReviewIntervention = ask
         -> Talk to Reviewer -> send a user turn to the same Reviewer context
         |      +-- Reviewer approves -> semantic review passes
         |      +-- Reviewer still objects or only replies -> ask the user again
         |
         +-- Accept as-is -> semantic review passes by Review Override
         |
         +-- Send for repair -> apply the latest findings -> existing repair handoff
```

Treat Reviewer feedback as provisional until the intervention ends. This lets the Reviewer submit a replacement
`review_complete` result after user context without first committing findings that the user has overridden. When an
older Review Issue Ledger already exists, an explicit Review Override may close the current semantic gate without making
the Reviewer claim that code changed.

Do not add per-finding selection, waiver reasons, Plan Front Matter fields, Work Record fields, Memory writes, or
durable product-policy inference. The existing `semantic_review_passed` lifecycle transition is the commit boundary
after an acceptance. If the process stops before that transition, the safe recovery is to run Semantic Code Review
again; the in-memory conversation does not need recovery.

Set aside a durable issue-waiver ledger and a new verified-with-waivers status. They provide more audit detail but add
policy, recovery, and user-interface scope that the user explicitly deferred.

## Files to Modify

- `src/shared/settings.js` — preserve `semanticReviewIntervention` during settings writes and resolve merged
  global/project values to `never` or `ask`, defaulting invalid or absent values to `never`.
- `src/shared/settings.test.js` — cover preservation, scope precedence, normalization, default behavior, and invalid
  values.
- `config.schema.json` — publish the setting and its two accepted values.
- `src/shared/workflow/validation-semantic.ts` — place the optional intervention after a complete Reviewer feedback
  result and before ledger application, lifecycle rollback, or repair handoff; reuse the same Reviewer session context
  for follow-up turns and retain the existing autonomous path for `never`.
- `src/shared/workflow/validation-user-messages.ts` — provide short prompts and status messages for talking, accepting
  the current delivery, continuing repair, cancellation, and Reviewer reconsideration.
- `src/shared/workflow/validation-loop-review.test.js` — prove the setting branches, same-context Reviewer follow-up,
  direct acceptance, revised approval, continued repair, and safe interruption behavior through the real lifecycle.
- `src/agent-definitions/subagent-definitions/reviewer-prompt.md` — tell a discovery Reviewer how to respond to direct
  user context and submit a replacement result without treating its earlier judgment as authority over the user.
- `src/agent-definitions/subagent-definitions/reviewer-verify-prompt.md` — give verification rounds the same
  user-authority and replacement-result behavior.
- `src/ui/tui/golden-scenarios/validation-workflow-tree-semantic.ts` — after the active Golden validation work settles,
  add or extend composed scenarios for talk, accept-as-is, and send-for-repair outcomes.
- `src/ui/tui/testing/validation-workflow-coverage.ts` — add the intervention choices to the settled semantic branch
  inventory so no user-visible branch is unowned.
- `docs/domain-language.md` — define Review Override and update Review Issue, Semantic Code Review, RunWield Verified,
  and their stable relationships to describe one-delivery user authority without implying durable policy.
- `docs/settings.md` — document scope, default, values, example configuration, and the difference from `codereview`.
- `docs/workflows.md` — document the optional checkpoint and its three outcomes before semantic repair.
- `docs/validation-authority.md` — state that the user can authorize the current semantic gate, while lifecycle
  machinery still owns the transition and no transcript text becomes durable policy.
- `src/skills/runwield/SETTINGS.md` — teach the shipped RunWield skill how the setting behaves.
- `src/skills/runwield/PLANS.md` — teach the shipped RunWield skill how Review Override relates to validation and
  repair.

The active validation repair can rename or consolidate the workflow and Golden files above. Preserve these behavioral
owners rather than forcing obsolete paths back into the settled design.

## Reuse Opportunities

- `src/shared/settings.js` — follow `getCodeReviewMode` and `getGuidedReviewMode` for merged custom-setting resolution.
- `src/shared/workflow/validation-semantic.ts` — reuse the round-owned in-memory session manager and isolated Reviewer
  turn used by the existing nudge loop.
- `src/shared/workflow/validation-interactions.ts` — reuse typed select/text interactions and existing cancel behavior.
- `src/shared/workflow/review-ledger.ts` — keep ledger convergence unchanged for findings that the user sends to repair;
  do not represent a Review Override as a fake code resolution.
- `src/shared/workflow/plan-lifecycle.js` — reuse `semantic_review_passed` as the only advancement boundary; do not add
  an Agent-owned lifecycle write.
- `src/ui/tui/golden-scenarios/validation-workflow-tree-semantic.ts` — extend the settled composed semantic-review
  fixture rather than create a second validation harness.

## Implementation Steps

- [ ] The active Workflow Validation repair is committed or otherwise settled, and this implementation follows its
      resulting validation engine, repair ownership, and Golden coverage boundaries rather than the transient draft
      paths observed during planning.
- [ ] Global and project settings accept `semanticReviewIntervention: "never" | "ask"`; project scope overrides global
      scope, absent or invalid values resolve to `never`, and SettingsManager-shaped writes preserve the key.
- [ ] With mode `never`, a valid Reviewer rejection follows the settled existing path without a new prompt, conversation
      turn, lifecycle event, or delay before Validation Repair Engineer handoff.
- [ ] With mode `ask`, no Validation Repair Engineer turn starts until the user chooses repair; the user sees simple
      choices to talk to the Reviewer, accept the current delivery as-is, or send the findings for repair.
- [ ] “Talk to Reviewer” sends user text to the same in-memory Reviewer context and preserves its review tools. The user
      can continue the bounded conversation until the Reviewer submits a replacement `review_complete` result, the user
      accepts as-is, the user selects repair, or the interaction stops.
- [ ] A replacement Reviewer approval and an explicit user Review Override both commit through `semantic_review_passed`,
      continue from `validated_reviewer`, and never dispatch semantic repair for the overridden feedback.
- [ ] Choosing repair applies the latest complete Reviewer feedback to the Review Issue Ledger and preserves the settled
      feedback event, checkpoint, fresh Validation Repair Engineer session, Mechanical Validation rerun, and later
      Reviewer verification behavior.
- [ ] Cancellation or process loss before `semantic_review_passed` cannot advance Plan Lifecycle or discard committed
      Review Issues. A later validation call safely repeats Semantic Code Review; no disposable conversation is treated
      as authority after restart.
- [ ] Review Override creates no waiver reason, issue-selection record, Plan definition change, Work Record finding,
      Memory, `RUNWIELD.md` edit, or future Reviewer instruction. Only the normal lifecycle advancement needed to
      continue this delivery is durable.
- [ ] Semantic-review prompts preserve the Reviewer's duty to explain concrete defects while making clear that direct
      user instructions are authoritative for the current delivery and can produce a replacement completion result.
- [ ] The settled branch-complete Golden TUI suite proves the visible `ask` choices, a same-context Reviewer follow-up,
      direct accept-as-is with no repair turn, and send-for-repair with the existing durable handoff; the branch
      inventory owns each new interaction value.
- [ ] The schema, settings reference, workflow documentation, shipped RunWield skill docs, validation authority, and
      domain glossary agree on the setting name, default, one-delivery scope, verification result, and explicit route
      for durable product rules.

## Approval Confirmation

This Plan does not declare any superseded Work Records.

## Verification Plan

- Automated: run
  `deno run -A scripts/run-tests.js src/shared/settings.test.js src/shared/workflow/validation-loop-review.test.js`.
- Automated: run the focused Golden validation suite with
  `deno run -A scripts/run-tests.js src/ui/tui/golden-scenarios/validation-workflow-tree.test.ts`; if the active repair
  renames that settled owner before this Plan executes, update this draft during review rather than keeping a dead path.
- Automated: run `deno task seams:check` and confirm no new injection seam was added for Reviewer, lifecycle, ledger, or
  settings behavior.
- Automated: run `deno task ci` after the focused tests pass.
- Manual: with the setting absent, cause a Reviewer rejection and confirm repair starts exactly as before.
- Manual: set project `semanticReviewIntervention` to `ask`, cause a rejection, talk to the Reviewer for at least two
  turns, then have it approve; confirm no repair Agent starts and validation proceeds.
- Manual: repeat in `ask` mode and choose accept-as-is; confirm the Plan proceeds through the remaining human-review and
  publication policy toward RunWield Verified without writing a waiver or durable product rule.
- Manual: repeat in `ask` mode and choose repair; confirm the latest findings reach the Validation Repair Engineer and
  the normal Mechanical Validation plus focused Reviewer loop remains intact.
- Expected preservation: Reviewer omission checks, diff-inspection requirements, Review Issue Ledger convergence,
  independent repair context, semantic repair completion gating, and `never`-mode automation remain protected.
- Expected removal: immediate unconditional repair dispatch after every Reviewer rejection no longer exists in `ask`
  mode only.
- Documentation: confirm `docs/domain-language.md` describes implemented Review Override behavior and does not claim
  that one-time acceptance becomes Memory or project policy.

## Edge Cases & Considerations

- A Reviewer can respond without calling `review_complete`. Keep the conversation open or return to the small choice
  prompt; do not interpret prose as approval.
- A Reviewer can reject again with changed findings. Only the latest complete result is eligible for repair after the
  user chooses repair.
- An explicit accept-as-is is authoritative even when an older Review Issue Ledger has open items. Do not ask the
  Reviewer to falsely mark code-fixed items as resolved.
- If settings change while validation is paused, resolve the mode at the next rejection/intervention boundary; do not
  rewrite an interaction already in progress.
- Headless or non-interactive validation cannot satisfy `ask` by inference. It must pause safely for user input or
  follow the settled runtime convention for unavailable interactions.
- The conversation is intentionally disposable. Process loss can require the user and Reviewer to repeat it, but it
  cannot create a false approval.
- Local Human Code Review remains a separate later gate controlled by `codereview`; Review Override must not skip it.
- The draft assumes the current active validation work retains a session-independent validation engine and an isolated
  Reviewer session boundary. If that architecture changes before execution, preserve the product flow and authority
  rules above, then update this Plan during review rather than adding a parallel path.
