---
kind: "work_record"
recordId: "52b2953d-e0c4-4734-8d39-68feee925a28"
status: "approved"
scope: "planned_change"
workKind: "REFACTOR"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-02T15:05:46.726Z"
provenance:
    sourcePlans:
        - "069d2ec8-ab4a-47cd-969b-fb3ee4d811ea"
---

# Formalized subagent definition loading

## Summary

Centralized the seven workflow-dispatched subagent prompts under `src/agent-definitions/subagent-definitions/` and added
a typed `loadSubAgentDefinition` registry/loader. Validation, Delegated Agent, Slicer, and Init now share the loader,
obsolete direct prompt-loading seams were removed, and behavior-preserving tests were updated. Verification passed
objective checks OC1–OC4, targeted tests, seam checks, CI, golden TUI tests after a successful rerun, compile, and a
compiled-binary help check.

## Deferred Work

A live Delegated Agent start from the compiled binary was not manually verified because the environment lacked a
configured noninteractive model/provider session for that flow.

## Future Planning Notes

Centralizing hidden workflow-dispatched prompt loading reduced duplicated cold-cache and front-matter behavior while
preserving runtime agent identifiers and `/agent` invisibility.
