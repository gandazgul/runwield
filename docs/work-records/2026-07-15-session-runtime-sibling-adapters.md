---
kind: work_record
recordId: 42f8710d-3230-44ed-ae69-7daf4bbcfd3d
status: approved
scope: feature
origin: external
completionMode: verified
createdAt: 2026-07-14T08:32:00-04:00
provenance:
    evidence:
        - path: src/shared/session/session-runtime.js
          note: Owns UI-independent session lifecycle, prompting, turn exclusion, cancellation settlement, snapshots, and reusable session actions.
        - path: src/shared/session/session-runtime-events.js
          note: Defines the semantic event contract shared by TUI, ACP, and future sibling adapters.
        - path: src/ui/tui/runtime-adapter.js
          note: Projects core runtime events and interactions into TUI rendering and terminal-specific behavior.
        - path: src/acp/server.js
          note: Exposes ACP lifecycle, prompts, cancellation, events, and interactions directly over SessionRuntime.
        - path: src/shared/session/session-state-imports.test.js
          note: Enforces that shared core and tools, including tests, do not depend on TUI or ACP adapters.
        - path: plans/archived/session-runtime-sibling-adapter-boundary.md
          note: Preserves the verified implementation scope, ordering, acceptance criteria, and validation record.
---

# SessionRuntime Sibling Adapter Boundary

## Summary

RunWield now provides a project-isolated, UI-independent session engine through `SessionRuntime`, with the TUI and ACP
implemented as sibling adapters over the same lifecycle, event, interaction, snapshot, and action contracts. Core owns
same-session turn exclusion, cancellation settlement, session identity, and project-root-aware workflows, while
adapter-specific rendering, terminal integration, and protocol framing remain outside `src/shared`. The refactor also
removed obsolete or misplaced TUI code, established import and transcript-parity regression coverage, and leaves a
stable boundary for adding future in-process UIs or ACP clients without recreating session behavior. The completed work
was verified by the full repository type, lint, formatting, and test gates.
