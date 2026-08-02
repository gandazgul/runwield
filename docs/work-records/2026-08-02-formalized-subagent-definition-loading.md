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

## Execution Report

- Implemented: moved all seven workflow-dispatched prompt files to `src/agent-definitions/subagent-definitions/` with
  100% rename content preservation, removed the old directory, added `SUBAGENTS` plus the typed `loadSubAgentDefinition`
  registry/loader.
- Implemented: validation, delegate-agent, slicer, and init call sites now delegate through the shared loader; obsolete
  direct prompt-file/loading seams were removed and the injection-seam baseline was tightened.
- Tests updated/added: added `src/shared/session/subagent-definitions.test.ts` (+6 tests); no test cases were removed.
  Updated existing validation/delegation/slicer/init/session-catalog/compile/runtime/image tests for the new path and
  preserved prior behavior assertions.
- Verification passed: objective checks OC1–OC4; targeted suite (`143 passed`); `deno task seams:check`; `deno task ci`
  (`233 files passed`); `deno task test:golden-tui` (`56 passed`, after rerunning one initial timeout successfully);
  `deno task compile`.
- Manual compiled-binary check: cleared a temp `HOME` bundled-agent-definitions cache and ran `./bin/wld --help`
  successfully; a live Delegated Agent start remains unverified because this environment has no configured
  noninteractive model/provider session for that manual flow.
