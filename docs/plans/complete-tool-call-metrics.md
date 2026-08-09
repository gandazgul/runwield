---
planId: "8faf46c2-95d7-4e2d-8458-194172ff0e9a"
classification: "PLANNED_CHANGE"
complexity: "MEDIUM"
summary: "Audit and complete tool exposure and call metrics across Pi, Claude CLI, root, isolated, and delegated execution paths."
affectedPaths:
    - "src/shared/workflow/metrics.js"
    - "src/shared/session/session.js"
    - "src/shared/session/session-context-report.js"
    - "src/shared/session/backends/claude-cli/"
    - "docs/settings.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-08T01:08:52-04:00"
updatedAt: "2026-08-08T01:08:52-04:00"
status: "draft"
origin: "internal"
---

# Complete Tool-Call Metrics

## Context

RunWield already records sanitized tool-call start and finish events for Pi session subscribers. Coverage is not yet
proven across Claude CLI/MCP, isolated repairs, delegated agents, cancellation, and failure paths. Call counts also lack
the advertised-tool and estimated-schema-token denominator needed for context-reduction decisions.

## Direction

- Audit every execution backend and session shape for paired start/finish coverage.
- Correlate calls with Agent, backend, dispatch kind, stable request ID, attempt ID, and safe session/segment identity.
- Record which tools were advertised and their estimated resident schema tokens when a session is configured.
- Keep arguments, commands, queries, file content, results, and user text out of metrics.
- Handle errors, cancellation, bridge rejection, missing finish events, and process loss explicitly.
- Provide an aggregate view that can compare advertisement cost, call frequency, failure rate, and latency.

## Questions for Planner

- Which existing workflow-metrics setting and storage should own the new exposure events?
- Can Claude native tool calls be observed reliably, or only RunWield MCP calls?
- What retention and minimum-sample rules are required before changing tool bundles?
- Is reporting a small CLI/context view, an offline script, or a later Workspace surface?

## Later Planning Work

Produce a coverage matrix, define sanitized event schemas and correlation rules, specify aggregation and privacy tests,
and identify the minimum report needed to make evidence-based tool-context decisions.
