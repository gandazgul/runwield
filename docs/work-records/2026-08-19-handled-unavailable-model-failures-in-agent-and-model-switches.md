---
kind: "work_record"
recordId: "7665829e-ee64-4648-81e9-f500fcdc21ef"
status: "approved"
scope: "planned_change"
workKind: "BUG_FIX"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-19T18:51:12.773Z"
provenance:
    sourcePlans:
        - "5c06ed28-b643-4084-85a5-ca3de6ffb7a9"
---

# Handled unavailable model failures in Agent and model switches

## Summary

Unavailable model or provider selections now fail safely: `/agent` keeps the current Agent and model active while
showing one error-styled recovery message, and `/model` marks malformed or unknown selections as errors without changing
state. Golden TUI coverage now captures system-message severity and proves recovery through valid `/settings` presets
and manual `/model` selection. Targeted tests and seam checks passed.

## Deviations from Plan

`deno task ci` did not complete cleanly because an untouched validation-workflow Golden scenario failed twice with an
unused scripted interaction; rerunning that file alone passed.

## Future Planning Notes

The Golden TUI harness can now opt into system-message capture for severity assertions without changing normal rendering
or adding a product seam.
