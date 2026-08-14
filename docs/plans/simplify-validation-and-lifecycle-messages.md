---
planId: "4695664f-ee36-4be9-860b-f8f58b6e66ab"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Replace validation and Plan-lifecycle jargon with one plain, actionable presentation layer that tells the owner what happened, whether work is safe, who owns the next step, and what actions are available."
affectedPaths:
    - "src/shared/workflow/"
    - "src/shared/session/"
    - "src/ui/tui/"
    - "src/ui/workspace/"
    - "src/cmd/load-plan/"
    - "src/cmd/plans/"
    - "docs/domain-language.md"
    - "docs/plan-lifecycle.md"
    - "docs/design-system.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-08-14T00:11:43-04:00"
status: "draft"
---

# Simplify Validation and Lifecycle Messages

## Context

RunWield currently exposes internal lifecycle vocabulary in owner-facing messages: Plan Status identifiers, validation
phase names, semantic rounds, generation and activation terminology, worktree identifiers, transition events, and repair
machinery. Messages are emitted from workflow branches, Session adapters, TUI panels, Workspace surfaces, and commands,
so the same state can appear under inconsistent labels or provide no useful next action.

Correct state is not enough if the owner cannot tell what happened, whether work is safe, who is acting, or what to do
next. This Plan follows the validation-authority repair so messages are derived from canonical facts rather than
papering over ambiguous state.

## Objective

Give every validation, repair, review, interruption, recovery, and publication state one plain owner presentation that
answers:

1. What happened?
2. Is the work safe?
3. Who owns the next step?
4. What can the owner do now?

Internal identifiers and proofs remain available under optional technical details, logs, and diagnostic commands, but
they do not dominate ordinary status copy. TUI and Workspace consume the same semantic presentation so they cannot
invent competing explanations.

## Approach

Introduce a pure presentation model derived from typed canonical workflow state:

```text
canonical lifecycle + validation + worktree + recovery facts
  -> owner status presenter
  -> heading, explanation, safety, owner, actions, optional details
  -> TUI / Workspace / command renderers
```

Define a small scenario catalog before rewriting strings. Each scenario has canonical input facts, one expected
plain-language model, allowed actions, and an explicit list of internal terms that must stay out of the primary copy.
Renderers control layout only.

The option set aside is editing messages where they appear. That is faster initially but guarantees future drift and
lets UI text become another source of workflow policy.

## Files to Modify

- `src/shared/workflow/` — expose typed owner presentation inputs and one shared status/action presenter.
- `src/shared/session/` — emit semantic workflow status without encoding adapter-specific prose as authority.
- `src/ui/tui/` — render the shared presentation in panels, notifications, and checkpoints.
- `src/ui/workspace/` — render the same headings, explanations, actions, and optional details in browser surfaces.
- `src/cmd/load-plan/` and `src/cmd/plans/` — use shared recovery and lifecycle presentation in command output.
- `docs/domain-language.md` and `docs/plan-lifecycle.md` — distinguish canonical internal terms from preferred owner
  language.
- `docs/design-system.md` — document reusable status, safety, action, and technical-details presentation patterns.

## Reuse Opportunities

- Typed lifecycle and recovery results from `src/shared/workflow/plan-lifecycle.js`, `validation-context.ts`, and
  `state-transition.ts`.
- Existing TUI validation panel and Workspace status/notice primitives.
- Existing domain-language avoided-alias guidance.
- Golden TUI scenarios and Workspace server-rendered component tests for stable owner-visible copy.

## Implementation Steps

- [ ] A finite owner-status model represents heading, concise explanation, safety statement, current owner, primary and
      secondary actions, severity, and optional technical details without embedding renderer markup.
- [ ] A scenario catalog covers implementation completion, validation running, validation repair, semantic review,
      review repair, process interruption, safe resume, blocked recovery, merge conflict, publication, completion, and
      user action required.
- [ ] Every primary message states what happened and the next useful action; states that preserve a worktree or
      candidate say plainly that the work is safe.
- [ ] Primary owner copy contains no raw Plan Status values, lifecycle event identifiers, validation phase identifiers,
      generation, fence, attempt, worktree ID, semantic round, or transition-journal terminology.
- [ ] Technical details remain inspectable without being required to understand or operate the workflow.
- [ ] TUI, Workspace, and commands render the same scenario model and cannot independently decide which recovery action
      is legal.
- [ ] Actions are concrete verbs such as **Retry checks**, **Review problems**, **Continue repair**, **Open candidate**,
      and **Return to planning**, not generic **Recover** or **Continue** labels without an object.
- [ ] Error messages distinguish user-correctable input, implementation failure, Plan defect, environmental blockage,
      uncertain external effect, and RunWield internal failure.
- [ ] Accessibility and responsive treatment preserve the heading, explanation, safety, and primary action hierarchy in
      TUI, desktop, and narrow Workspace layouts.
- [ ] Domain and design-system documentation name the shared presentation boundary and keep internal lifecycle language
      available for diagnostics.

## Approval Confirmation

No Work Record is proposed for supersession.

## Verification Plan

- Automated: pure presenter tests cover every scenario and action set from canonical typed inputs.
- Automated: Golden TUI and Workspace rendering tests assert the same semantic content at key lifecycle states.
- Automated: a forbidden-term check prevents raw internal identifiers from returning to primary owner copy while
  allowing them in marked technical details and developer logs.
- Automated: run focused workflow/UI suites through `scripts/run-tests.js`, then `deno task ci`.
- Manual: walk one successful Plan and one validation-repair Plan in TUI and Workspace; at every pause, state what
  happened, whether work is safe, and the next action using only the visible copy.
- Expected result: an owner can operate the workflow without learning RunWield's internal lifecycle vocabulary.

## Edge Cases & Considerations

- Copy cannot promise safety or completion unless canonical evidence proves it.
- Some internal terms such as Plan, Session, Validator, and Reviewer are product language; the forbidden-term policy
  should target implementation mechanics, not erase useful concepts.
- Localization is not in scope, but structured messages should avoid concatenated grammar that makes it harder later.
- Message stability matters to Golden tests, but tests should assert meaning and actions rather than incidental
  punctuation.
- The later lifecycle redesign will add `validating`, `reviewing`, `validated`, and `defective`; the presenter should be
  extensible without pre-implementing those statuses here.
