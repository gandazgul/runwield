---
kind: "work_record"
recordId: "f5406f11-f10b-4653-89a3-b68dce63053f"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-28T21:06:17.548Z"
provenance:
    sourcePlans:
        - "5b35b3ec-6b0b-4f06-a7c4-3715706e21bc"
---

# Agent sessions can name themselves

## Summary

Added a universal `set_session_name` tool for user-facing Agents. It uses the root Session manager, persists sanitized
names, emits `session_renamed`, and works through both Pi and Claude CLI MCP sessions. Prompt assembly now reminds
unnamed Agent sessions to set a short name, while named sessions suppress the reminder. Targeted tests and
`deno task ci` passed.

## Deviations from Plan

A small unrelated Dialog JSX type-check mismatch was fixed so full CI could pass. `deno.lock` also changed from the CI
dependency resolution.

## Deferred Work

Manual TUI checks were not run because this was a non-interactive API session.

## Future Planning Notes

Universal Agent tools should be applied at Agent-definition loading and runtime tool resolution so bundled, overlaid,
and project-defined Agents keep required capabilities while isolated Subagents remain excluded.
