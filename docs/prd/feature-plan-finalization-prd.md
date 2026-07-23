# Product Requirements Document: Feature Plan Finalization

Last updated: 2026-07-23 08:40 EDT

## Objective

Improve FEATURE Plan reliability by separating collaborative design from executable Plan materialization without adding
a second routine user approval.

Planner should remain the user's single planning partner and own product, design, and architectural decisions. A hidden,
clean-context Plan Finalizer should turn Planner's settled design into concrete implementation steps and verification
before the complete Plan enters the existing Review Loop.

## Problem Statement

Planner currently discovers repository constraints, collaborates with the user, resolves consequential decisions, and
then materializes the entire executable Plan. Long planning conversations can consume enough context that final
synthesis happens with degraded attention, omits an earlier decision, or crosses an automatic compaction boundary.
Compaction helps the Agent Session continue, but it is necessarily lossy and does not provide an independent check that
the resulting steps faithfully implement the agreed design.

The same concentration of responsibility exists when Slicer creates complete child FEATURE Plans. An Epic with several
children can force Slicer to derive detailed implementation steps for every child even though each child subsequently
returns to Planner for normal FEATURE planning and review.

Adding two mandatory reviews would expose the internal separation to users as workflow ceremony. It would also require
users to approve a design and then approve its derived task list, while material design revisions would repeatedly
invalidate the second checkpoint. RunWield instead needs stronger internal reliability while preserving one coherent
FEATURE planning experience.

## Resolved Assumptions

### One User Review

- A normal FEATURE retains one Plannotator Review Loop after the complete Plan is materialized.
- The Planner-to-Finalizer transition is an internal workflow phase, not a user approval checkpoint.
- An earlier design review may be introduced only for exceptional, hard-to-reverse work or explicit user requests; work
  large enough to require routine architecture approval should normally be classified as PROJECT.
- The existing approval, Readiness Gate, execution, and Workflow Validation semantics remain unchanged.

### One Canonical Plan Artifact

- The Plan remains the sole canonical planning artifact; RunWield should not create a competing task-list document.
- Planner records the evolving design in the draft Plan rather than retaining the only authoritative version in the
  Session Transcript.
- The draft Plan may be incomplete while planning is active. Only the integrated, finalized Plan is presented for
  approval.
- Planner-owned design content and Finalizer-derived execution content must remain distinguishable so regeneration does
  not silently rewrite settled decisions.

### Planner Owns FEATURE Design

- Planner remains the sole conversational planning Agent for every FEATURE, including child FEATURE Plans created by
  Slicer.
- Planner owns the intended outcome, user-visible behavior, architectural seam, constraints, consequential decisions,
  acceptance boundaries, compatibility expectations, and material risks.
- Planner decides when the design is coherent enough for executable materialization.
- Review feedback returns to Planner as the visible planning owner. Material design changes invalidate affected derived
  execution content and cause Finalizer to run again before the revised Plan returns to review.

### Plan Finalizer Has Narrow Authority

- **Plan Finalizer** is the canonical name for the hidden workflow Agent that materializes executable FEATURE Plan
  details. It is not Slicer and should not be described as a task Slicer.
- Plan Finalizer starts with clean model context for every FEATURE Plan.
- It may inspect current repository facts and derive affected files, reuse opportunities, ordered implementation steps,
  testing work, and verification.
- It must preserve Planner-owned decisions and may not invent consequential product or architectural choices.
- It does not interview the user. If the design is incomplete, contradictory, or not executable without a consequential
  assumption, it returns a focused insufficiency report to Planner.
- A failed or insufficient finalization does not open Plannotator and does not change Plan Status beyond the existing
  draft planning semantics.

### Standalone and Epic-Child FEATUREs Share One Flow

Standalone FEATUREs follow:

```text
User Request → Planner → Plan Finalizer → Plannotator
```

Epic-child FEATUREs follow:

```text
Epic → Slicer child draft → Planner → Plan Finalizer → Plannotator
```

- Slicer continues to own Epic decomposition, child boundaries, sequencing, dependencies, and deferred scope.
- Slicer-created child drafts should seed Planner with decomposition and design context rather than pretending to be
  final executable Plans.
- Selecting a child FEATURE enters the ordinary Planner workflow. There is no separate eager finalization or "prepare
  all children" experience.
- Plan Finalizer runs only after Planner has completed the normal collaborative design work for the selected child.

### Compaction Is a Complementary Safeguard

- Planner should persist meaningful design progress at coherent milestones, not only when a token percentage is crossed.
- Before compaction, RunWield should preserve the latest coherent draft when safely possible; after compaction, Planner
  should reread the draft before continuing.
- Context pressure may trigger an additional checkpoint, but threshold-based drafting is a fallback rather than the
  primary workflow design.
- Plan Finalizer does not replace the Session Context Resilience capability, and compaction does not replace the
  Planner-to-Finalizer separation.

## Product Experience

For ordinary users, FEATURE planning should continue to feel like one conversation followed by one review:

1. Planner explores the repository and collaborates with the user until the design is coherent.
2. RunWield briefly materializes the executable Plan through Plan Finalizer.
3. The user reviews the complete integrated Plan in Plannotator.
4. Feedback resumes Planner. Planner updates the design, and RunWield regenerates affected execution content before the
   next review.
5. Approval continues through the existing Readiness Gate and execution workflow.

Users should not need to know which context threshold was crossed, manually request task regeneration, or decide whether
feedback belongs to Planner or Finalizer. RunWield should surface Finalizer only when it cannot safely materialize the
Plan or when finalization itself fails.

## Functional Requirements

- Run Plan Finalizer for every FEATURE after Planner declares its design coherent and before `plan_written` presents the
  Plan for review.
- Start Finalizer with clean context containing the current draft Plan and the minimum authoritative workflow and
  repository context needed to perform its role.
- Prevent Finalizer from changing Planner-owned design decisions while allowing it to complete the executable portions
  of the canonical Plan format.
- Require Finalizer to return either a complete executable Plan or a structured insufficiency outcome; blank,
  contradictory, or partially materialized output must not enter review.
- Return insufficiency outcomes to Planner without starting a second user-facing planning conversation.
- Re-run Finalizer after Planner incorporates review feedback that materially affects execution content.
- Preserve one Review Loop and the existing FEATURE Plan Lifecycle transitions.
- Change Slicer's child-draft instructions and format so it supplies decomposition and design context for subsequent
  Planner work rather than owning final implementation steps.
- Preserve Slicer's existing child selection experience; do not introduce batch preparation or an additional child
  review checkpoint.
- Make Planner recovery reread the current draft after compaction or Agent Session continuation before it resumes design
  work.
- Provide behavioral evaluation covering long Planner conversations, compaction before finalization, incomplete design
  handoffs, design-preservation failures, review revisions, standalone FEATUREs, and Epic-child FEATUREs.

## Technical Approach

Introduce Plan Finalizer as a hidden workflow Agent at the seam between collaborative FEATURE design and the existing
Review Loop. Planner should hand off through the canonical draft Plan rather than through an ad hoc transcript summary.
Finalizer should receive a bounded context, independently verify relevant current repository facts, and materialize the
execution-oriented portions of the existing Plan.

The handoff contract should make ownership explicit: Planner-owned content is authoritative design input;
Finalizer-owned content is a derived execution projection. Finalizer must either produce an internally consistent Plan
or return insufficiency without silently repairing the design. Exact section ownership, tool contracts, and regeneration
mechanics belong in the implementation Plan rather than this PRD.

The same phase should be used after Planner for standalone and child FEATURE Plans. Slicer should continue materializing
child drafts through the existing Epic decomposition lifecycle, but those drafts should no longer be required to contain
fully elaborated implementation steps before Planner has collaborated on the child.

Planner draft persistence should integrate with Pi's existing compaction and RunWield's Session Context Resilience work.
The draft is the exact project artifact Planner can reread; the compaction summary remains continuity context. Neither
should become a second planning-memory system.

## Success Criteria

- Users still encounter one routine FEATURE Plan review rather than separate design and task reviews.
- Every reviewed FEATURE Plan has passed through a clean-context Finalizer.
- Finalizer output preserves all settled Planner decisions and produces implementation steps and verification actionable
  by the recorded execution Agent.
- Missing or contradictory design returns to Planner instead of becoming an unsourced Finalizer assumption.
- A Planner session compacted before finalization can recover from the draft without restarting discovery or losing
  settled decisions.
- Standalone and Epic-child FEATURE Plans follow the same Planner-to-Finalizer contract.
- Slicer no longer bears responsibility for fully elaborating executable steps for every child during decomposition.
- Review feedback that changes design cannot leave stale derived implementation steps in the next reviewed revision.
- Behavioral evaluations show fewer omitted or contradictory requirements at final Plan materialization without a
  material increase in user interventions.

## Risks and Mitigations

- **Handoff loops:** An underspecified design could bounce repeatedly between Finalizer and Planner. Return one focused,
  actionable insufficiency report and evaluate recurring causes so Planner guidance improves.
- **Authority leakage:** Finalizer may quietly make architectural choices while deriving steps. Constrain its role,
  preserve Planner-owned content, and test designs with intentional gaps.
- **Latency and cost:** Every FEATURE gains another model pass. Keep Finalizer context and tools narrow and measure
  planning latency against reduction in review revisions and failed execution.
- **False separation:** Some apparently mechanical choices expose real architecture decisions. Finalizer should escalate
  these to Planner rather than forcing a step.
- **Draft confusion:** Partially materialized Plans may appear on the Plan Board. Preserve `draft` semantics and ensure
  only finalized Plans are offered for approval or execution.
- **Regeneration drift:** Re-running Finalizer may rewrite unaffected details. Treat Planner design as immutable input
  and preserve unaffected derived content where safe.

## Out of Scope

- Requiring two approval checkpoints for every FEATURE.
- Creating a standalone task-list artifact or a second Plan Lifecycle.
- Replacing Pi's compaction summary algorithm or the Session Context Resilience capability.
- Changing PROJECT Epic approval, decomposition, child selection, or readiness semantics.
- Adding a "prepare all child Plans" action.
- Allowing Plan Finalizer to interview users, approve Plans, execute code, or make consequential design decisions.
- Defining concrete prompt text, tool schemas, section markers, lifecycle events, or file-write mechanics.
- Changing Engineer, Frontend Engineer, Semantic Code Review, or Workflow Validation responsibilities.

## Related Artifacts

- [`docs/prd/session-context-resilience-prd.md`](session-context-resilience-prd.md)
- [`docs/prd/done/project-decomposition-PRD.md`](done/project-decomposition-PRD.md)
- [`docs/plan-lifecycle.md`](../plan-lifecycle.md)
- [Pi Compaction](https://pi.dev/docs/latest/compaction)
- [Anthropic: Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
