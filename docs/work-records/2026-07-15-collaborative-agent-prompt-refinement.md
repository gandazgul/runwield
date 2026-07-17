---
kind: work_record
recordId: efa7522b-abf7-4b8d-8d46-3fe2c5d3246f
status: approved
scope: feature
origin: external
completionMode: verified
createdAt: 2026-07-14T08:32:00-04:00
provenance:
    evidence:
        - path: src/agent-definitions/planner.md
          note: Defines the collaborative feature-planning loop and its terse cross-model attention safeguards.
        - path: src/agent-definitions/architect.md
          note: Defines self-contained, high-level systems design, technology-horizon analysis, and Mermaid guidance.
        - path: src/agent-definitions/ideator.md
          note: Defines consequential question triage, product-altitude ideation, and crystallized-memory discipline.
        - path: src/shared/session/agents.js
          note: Reinforces the Ideator behavior through the recurring long-session attention nudge.
---

# Collaborative Agent Prompt Refinement

## Summary

Planner, Architect, and Ideator prompts were refined to behave as collaborative thinking partners across both frontier
and smaller open-source models. Terse `Important Rules` remain as intentional attention anchors, while verbose or
mechanical guidance was reorganized around discovery, reflected understanding, consequential decisions, and synthesis.

Planner now explores independently, presents a concrete working model, lets the user make consequential product and
architectural decisions, and writes the final Plan as a synthesis of the resulting conversation. Architect remains
distinctly high-level and self-contained: it reasons about modules, relationships, data flows, APIs, system fit,
technology adoption, sibling-project impact, and six-to-twelve-month consequences; resists premature solutioning; and
uses focused Mermaid diagrams when a visual model materially improves understanding.

Ideator retains the strong instruction to interview relentlessly, but a solo question is now reserved for a
consequential divergent path. It stays at problem and product altitude, surfaces goals, feasibility, risks, and missing
considerations, infers reversible minutiae, batches genuinely necessary preferences, and avoids developing a solution
through field-by-field questions. Memory is stored only after a coherent understanding crystallizes, as a consolidated
durable conclusion or artifact pointer rather than one memory per answer. The runtime attention nudge was aligned so
long sessions continue reinforcing these behaviors instead of restoring the previous mechanical cadence.
