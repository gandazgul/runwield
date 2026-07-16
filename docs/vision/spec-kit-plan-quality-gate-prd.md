# Product Requirements Document: Plan Quality Gate

Last updated: 2026-07-16 16:16 EDT

Working draft. This PRD describes a future RunWield capability inspired by Spec Kit's clarify/analyze workflows, adapted
for RunWield's Plan lifecycle rather than Spec Kit's `spec.md -> plan.md -> tasks.md` artifact model.

## Objective

Add a **Plan Quality Gate** that evaluates a draft or approved Plan before execution risk accumulates. The gate should
catch ambiguity, missing validation evidence, terminology drift, stale assumptions, and contradictions with project
context early enough that Planner, Architect, Slicer, or the user can correct the Plan before Engineer starts work.

## Problem Statement

RunWield already routes material work through Plans and review, but Plan approval can still miss issues that are easy
for humans and Agents to overlook:

- vague requirements that sound reasonable but cannot be validated
- success criteria with no observable completion signal
- terminology that conflicts with `CONTEXT.md`
- assumptions that contradict current code or Work Records
- acceptance expectations that are not reflected in the Plan's validation strategy
- Epic or child Plan boundaries that leave a critical user journey unowned

When these issues surface during implementation or semantic review, the cost is higher: Engineer may repair the wrong
thing, Reviewer may reject a large diff for a planning defect, or the Plan may need to be reopened after work has
already started.

## Target Users

- **Human users** approving Plans who want clearer confidence before execution.
- **Planner and Architect** when preparing Plans for review.
- **Slicer** when checking that child FEATURE Plans are independently executable.
- **Reviewer and Engineer** indirectly, by receiving better Plans with fewer late-stage ambiguities.

## Product Principles

- **Improve Plan quality without replacing human approval.** The gate should make review sharper, not silently approve
  work.
- **Stay Plan-native.** Do not introduce Spec Kit's separate `spec.md`, `plan.md`, and `tasks.md` structure as a new
  canonical workflow.
- **Prefer actionable findings.** A finding should explain what ambiguity or gap creates execution or validation risk.
- **Use project language.** The gate should challenge against `CONTEXT.md`, ADRs, Work Records, and current code when
  relevant.
- **Avoid ceremony for small work.** QUICK_FIX and OPERATION should not inherit a heavyweight Plan gate.

## Proposed Experience

The gate can run at several points, but should start as an explicit or automatic pre-execution check for saved Plans:

1. A Plan reaches review or is about to move to Ready For Work.
2. RunWield reads the Plan, project glossary, relevant PRDs/ADRs, Work Records, and code evidence already discovered by
   Planner or Architect.
3. RunWield produces a compact quality report grouped by severity.
4. The user can approve anyway, return the Plan for revision, or ask the planning Agent to repair the Plan.

Example report categories:

- **Ambiguity:** vague terms, unresolved alternatives, untestable acceptance statements.
- **Coverage:** requirements or user journeys without validation evidence.
- **Terminology:** Plan language that conflicts with canonical project terms.
- **Context contradiction:** Plan claims that disagree with source code, ADRs, Work Records, or lifecycle rules.
- **Boundary risk:** work too large, not independently executable, or wrongly placed in an Epic/child Plan split.
- **Operational risk:** missing migration, rollback, data safety, performance, accessibility, or security consideration
  when the Plan implies one.

## Functional Requirements

- RunWield should be able to evaluate a Plan for ambiguity, coverage, terminology consistency, and contradiction with
  known project context.
- Findings should be severity-ranked so low-risk wording issues do not block execution by default.
- Findings should cite the Plan section and the evidence source when possible.
- The gate should distinguish Plan defects from implementation details that belong to Engineer.
- The gate should offer an obvious path to revise the Plan through the existing Review Loop.
- For Epic Plans, the gate should evaluate whether child FEATURE boundaries can be independently executed and verified.
- For FEATURE Plans, the gate should evaluate whether the Plan has a credible validation path.

## Technical Approach

This is primarily an orchestration and Agent-prompt capability, not a new artifact model.

Likely components:

- a read-only Plan quality Agent or workflow prompt
- a bounded context bundle containing the Plan, relevant glossary entries, known Work Records, and code evidence
- a structured quality report format suitable for TUI and Workspace display
- Plan Lifecycle integration that can surface findings before Ready For Work without inventing a new Plan Status unless
  later product work proves one is needed
- optional Plannotator presentation for reviewing quality findings alongside the Plan

## Out of Scope

- Replacing Plan review with automated approval.
- Adding Spec Kit's `specs/<feature>/` artifact tree as RunWield's canonical structure.
- Generating implementation task lists as a separate required artifact.
- Blocking every low-severity issue before execution.
- Applying this gate to no-plan QUICK_FIX work by default.

## Success Criteria

- Fewer Plans reach Engineer with unresolved product or validation ambiguity.
- Reviewer rejections caused by Plan ambiguity decrease.
- Users can understand and act on gate findings without reading raw prompts.
- Planner and Architect can revise Plans from findings without losing Plan Lifecycle state.
- The gate remains lightweight enough that users do not avoid Plan-by-Default workflow.

## Open Questions

- Should high-severity findings block Ready For Work, or should they only require explicit user override?
- Should the gate run automatically before every Plan approval, only before execution, or only on request in v1?
- Should Workspace show Plan quality as a persistent badge or only as a transient review report?
- How much code exploration should the gate perform before it becomes too slow or too implementation-oriented?
