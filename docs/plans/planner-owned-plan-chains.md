---
planId: "d5f5e7cb-fcef-4407-b4a4-8b715924f5a9"
classification: "PLANNED_CHANGE"
complexity: "MEDIUM"
summary: "Let Planner split large linear work into an ordered chain of small Plans without requiring a full PROJECT Epic."
affectedPaths: []
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-08T00:51:28-04:00"
updatedAt: "2026-08-08T00:51:28-04:00"
status: "draft"
origin: "internal"
---

# Planner-Owned Plan Chains

## Context

Large linear changes currently push Planner toward one oversized Plan or require the full PROJECT Epic path. A Plan
Chain should let Planner create a small ordered set of normal Plans when fresh execution context between stages is more
useful than Epic-level architecture and slicing.

## Direction

- Planner can split work during planning and state why a chain is useful.
- Each child remains a normal independently reviewable and executable Plan.
- The chain records order and dependencies without copying requirements between Plans.
- A completed child can continue into the next child through a fresh Session and the existing lifecycle authorities.
- Router and Architect keep ownership of true PROJECT work; Plan Chains are for bounded, mostly linear work.

## Questions for Planner

- Is the chain a small manifest, shared front matter, or predecessor/successor links?
- Does the user approve the whole chain once or approve each child?
- When should continuation be automatic, offered, or stopped?
- How are feedback, holds, changed dependencies, and partial completion represented?
- Does the chain produce one aggregate Work Record or one record per completed Plan?
- What clear threshold separates a Plan Chain from a PROJECT Epic?

## Later Planning Work

Use the longer Planner discussion to choose the lifecycle and storage model, define the approval and continuation UX,
identify migration or compatibility needs, and then replace this section with bounded implementation and verification
steps.
