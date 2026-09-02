---
kind: "work_record"
recordId: "2444044e-afd6-4b15-8879-dc8681200e07"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-02T01:46:43.210Z"
provenance:
    sourcePlans:
        - "a5983252-78d4-466f-879e-17d27b749ade"
---

# Core-Owned Named Invocation

## Summary

Prompt Template and Skill slash invocations now resolve in shared Session runtime for TUI, Workspace, and ACP. Prompt
Templates can declare one-shot agent, model, and thinking policy, run through an auxiliary turn without changing the
root Session state, and preserve exact hidden expansions while displays stay compact. Reload now refreshes active Agent
catalogs, bundled docs/templates were updated, and verification passed including final full CI.

## Deviations from Plan

An initial CI run hit `publication-machine.failure-matrix.test.ts`; a targeted rerun passed and the final full CI rerun
passed.

## Future Planning Notes

Future named-invocation work should keep raw slash classification in Core, keep Prompt Template workflow authority
separate from Skills, and preserve immutable transcript expansions for resume instead of re-reading changed template
files.
