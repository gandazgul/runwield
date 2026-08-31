---
classification: "PLANNED_CHANGE"
workKind: "MAINTENANCE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/session/session-runtime.js"
    - "src/acp/server.js"
    - "src/cmd/init/index.ts"
    - "src/cmd/plans/index.ts"
    - "src/cmd/plans/share.ts"
    - "src/cmd/plans/pull.ts"
    - "src/shared/project-runtime-layout.ts"
    - "src/shared/session/session-runtime.test.js"
    - "src/acp/server.test.js"
    - "src/cmd/init/index.test.ts"
    - "src/cmd/plans/index.test.ts"
    - "src/ui/tui/golden-scenarios/initial-scenarios.test.js"
    - "docs/domain-language.md"
executionAgent: "engineer"
createdAt: "2026-08-29T03:04:59.625Z"
status: "draft"
origin: "internal"
parentPlan: "consolidate-project-runtime-state"
order: 6
dependencies:
    - "05-move-project-collaboration-secrets"
planId: "aa0212e8-4f12-4168-a6b8-348a3524acfa"
targetBranch: "epic/consolidate-project-runtime-state"
---

# Wire Project Entry Guards

## Context

The migration engine is only safe if every project surface reaches it before normal runtime-store access. Session
Runtime, ACP, Init, direct Plan commands, and collaboration commands enter through different code paths today.

This child Plan wires those surfaces to one project-runtime entry operation while preserving the no-write startup rule
for a new empty TUI.

## Objective

Make project-runtime entry a shared gate for project-local runtime access. A lower-level registry, controller, lock,
journal, publication, or project secret operation must not bypass a migration refusal and perform filesystem
input/output anyway.

## Approach

Add or use a single entry operation from `src/shared/project-runtime-layout.ts`, then call it at each surface boundary
before first normal runtime-store access.

Representative surface flow:

```text
user surface starts project work
  enterProjectRuntime(cwd)
    migrate or verify layout
    return layout context or refusal
  normal command/session/runtime access
```

The main option set aside is relying only on command-level calls. That is easy to miss, so low-level stores should also
require or perform the same guard before filesystem input/output.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/project-runtime-layout.ts` — expose the project entry API and refusal behavior that stores and surfaces
  share.
- `src/shared/session/session-runtime.js` — enter layout before project runtime access, but not for a brand-new empty
  TUI before first submitted message.
- `src/acp/server.js` — enter layout for new/load project sessions before runtime access.
- `src/cmd/init/index.ts` — enter layout only when initializing project state, not for help/version behavior.
- `src/cmd/plans/index.ts`, `src/cmd/plans/share.ts`, and `src/cmd/plans/pull.ts` — enter layout before Plan runtime and
  collaboration secret access.
- Session, ACP, Init, Plan command, and TUI golden tests — prove coverage and no-write startup behavior.
- `docs/domain-language.md` — define Project Runtime Entry if this child introduces it as durable project language.

## Reuse Opportunities

- `src/shared/session/session-runtime.js` — preserve existing active workflow and first-message behavior.
- `src/acp/server.js` — reuse existing session new/load boundaries.
- `src/cmd/plans/*` — reuse command parsing and current error presentation.
- `src/shared/project-runtime-layout.ts` — reuse the migration result and layout context from the migration child Plan.

## Implementation Steps

- [ ] Session Runtime enters the project layout before first project runtime-store access after a submitted message.
- [ ] A brand-new empty TUI session does not create `.wld/internal/`, marker files, migration files, or session files
      before the first submitted message.
- [ ] ACP new/load paths enter the project layout before registry, controller, lock, journal, publication, or secret
      access.
- [ ] Init enters the project layout only for project-state work and does not migrate for help or version behavior.
- [ ] Direct Plan commands enter the project layout before normal Plan runtime access.
- [ ] Collaboration share and pull commands enter the project layout before project secret access.
- [ ] Low-level runtime stores cannot perform filesystem input/output after migration refusal, even if a caller misses
      the surface entry call.
- [ ] `docs/domain-language.md` defines the project-runtime entry term, avoided aliases, and relationship to migration
      only if the implementation makes that term true.
- [ ] CI remains green with all wired surfaces using the same migration implementation.

## Verification Plan

- Automated:
  `deno run -A scripts/run-tests.js src/shared/session/session-runtime.test.js src/acp/server.test.js src/cmd/init/index.test.ts src/cmd/plans/index.test.ts src/cmd/plans/collaboration-commands.integration.test.ts src/ui/tui/golden-scenarios/initial-scenarios.test.js`.
- Automated: `deno task seams:check`.
- Automated: `deno task ci` must pass before the next child Plan starts.
- Expected result: blocked migration prevents normal runtime-store filesystem input/output through every covered
  surface.
- Expected result: help, version, and an unsubmitted empty TUI do not create `.wld/internal/` or migration files.
- Glossary check: confirm Project Runtime Entry, if added, describes implemented behavior and does not claim
  release-readiness beyond this slice.

## Edge Cases & Considerations

- Avoid eager migration during shell startup, help output, and version checks.
- Surface entry errors must be actionable and must not redact non-secret paths needed for cleanup.
- This slice must not change Session transcript authority or active workflow ownership.
