---
kind: "work_record"
recordId: "bf81ff83-73b6-47a8-a3ae-4cf05bc3ca5d"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-23T02:47:51.669Z"
provenance:
    sourcePlans:
        - "d26b8dd4-b04c-4130-849a-cacd1b93db84"
---

# Automatic Epic Child Session Continuation

## Summary

Implemented verified Epic auto-continuation so successful child FEATURE validation can advance to the next ordered child
in a fresh Runtime Session. The work added typed Workflow Validation results, strict continuation resolution, Session
replacement events, TUI rebinding, ACP stable-ID remapping, documentation updates, and focused test coverage. Automated
verification passed, including focused tests, checks, and `deno task ci`.

## Deviations from Plan

Manual TUI/ACP end-to-end scenarios from the plan were not run in an interactive client; automated CI passed.

## Future Planning Notes

Future Epic workflow changes should build on the typed validation result and core-owned `session_replaced` event rather
than inferring continuation from low-level Plan Events or adapter-specific behavior.

## Execution Report

- Implemented typed Workflow Validation results and propagated verified/paused/failed outcomes through validation,
  orchestrator, agent handler, Runtime, `/load-plan`, TUI, and ACP paths.
- Added strict Epic child continuation resolver/runner with canonical ordering, terminal-sibling skipping, dependency
  blocking, readiness execution, fresh Session replacement event, TUI rebinding, and ACP stable-ID remapping.
- Updated `docs/workflows.md` and `docs/usage.md` for default Epic auto-continuation and fresh Session boundary.
- Added focused tests for Epic continuation resolution, `session_replaced` event validation, and ACP runtime-session
  remapping.
- Verification passed:
  `deno test -A src/shared/workflow/epic-continuation.test.js src/shared/session/session-runtime-events.test.js src/acp/session-map.test.js`;
  `deno check ...`; `deno task ci`.
- Manual TUI/ACP end-to-end scenarios from the plan were not run in an interactive client; automated CI passed.
