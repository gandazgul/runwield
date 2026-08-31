---
classification: "PLANNED_CHANGE"
workKind: "MAINTENANCE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/collaboration/secrets.js"
    - "src/cmd/plans/share.ts"
    - "src/cmd/plans/pull.ts"
    - "src/cmd/plans/collaboration-commands.integration.test.ts"
    - "src/shared/collaboration/secrets.test.js"
    - "docs/domain-language.md"
executionAgent: "engineer"
createdAt: "2026-08-29T03:04:59.168Z"
status: "draft"
origin: "internal"
parentPlan: "consolidate-project-runtime-state"
order: 5
dependencies:
    - "04-move-selected-checkout-runtime-stores"
planId: "008e8278-adbc-4d9e-8edc-ef4ff0c0bebb"
targetBranch: "epic/consolidate-project-runtime-state"
---

# Move Project Collaboration Secrets

## Context

RunWield has a global collaboration secret store under `~/.wld/` and a project-local secret store under
`.wld/collaboration-secrets.json`. The Epic keeps the global store unchanged and moves only the project-local store
below the primary checkout internal root.

The migration engine handles adoption and conflict refusal. This child Plan moves the active project secret path and
preserves security behavior.

## Objective

Make project-local collaboration secrets primary-owned runtime state under `.wld/internal/`, while keeping global
secrets under `~/.wld/`. The project code must not read and write two project secret stores as authorities.

## Approach

Route `getProjectSecretStorePath()` through the layout module. Keep the existing secret document format, atomic write
behavior, redaction, and restrictive file modes.

Before and after:

```text
before: <project>/.wld/collaboration-secrets.json
after:  <primary>/.wld/internal/collaboration-secrets.json
```

The main option set aside is keeping project collaboration secrets beside `.wld/settings.json`. That would avoid
migration, but it would keep secrets in the user-trackable configuration area.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/collaboration/secrets.js` — move project-local secret path resolution to the primary internal root.
- `src/cmd/plans/share.ts` and `src/cmd/plans/pull.ts` — use the moved project secret path without adding a second
  authority.
- `src/shared/collaboration/secrets.test.js` — update path and permission expectations.
- `src/cmd/plans/collaboration-commands.integration.test.ts` — prove share and pull use the new project-local secret
  store.
- `docs/domain-language.md` — update glossary text only if implementation introduces or changes durable
  collaboration-secret terms.

## Reuse Opportunities

- `src/shared/collaboration/secrets.js` — reuse secret normalization, atomic writes, redaction, and mode-setting
  behavior.
- `src/shared/project-runtime-layout.ts` — reuse the primary internal root path helper.
- `src/shared/settings.js` — keep project settings primary-checkout behavior separate from project runtime secrets.

## Implementation Steps

- [ ] `getGlobalSecretStorePath()` remains unchanged and still resolves under `~/.wld/`.
- [ ] `getProjectSecretStorePath()` resolves under the primary checkout internal root.
- [ ] Project share and pull flows use one writable project secret store, not old and new project stores.
- [ ] Project secret writes retain restrictive permissions where the platform supports them.
- [ ] Tracked legacy project secrets remain a migration or Doctor concern and are not silently cleaned by this slice.
- [ ] Tests prove a linked execution worktree uses the primary checkout project secret store.
- [ ] Tests prove redaction, compatibility checks, and secret writes still work with the new path.

## Verification Plan

- Automated:
  `deno run -A scripts/run-tests.js src/shared/collaboration/secrets.test.js src/cmd/plans/collaboration-commands.integration.test.ts src/shared/settings.test.js`.
- Automated: `deno task seams:check`.
- Automated: `deno task ci` must pass before the next child Plan starts.
- Expected result: project-local secrets are created only below primary `.wld/internal/`; global
  `~/.wld/collaboration-secrets.json` is unchanged.
- Expected result: no temporary skipped tests should be needed. If a skip is unavoidable, mark it for this Epic and the
  final cleanup slice.
- Glossary check: confirm any glossary change describes implemented behavior and does not duplicate documentation-only
  wording.

## Edge Cases & Considerations

- Moving a tracked secret does not remove it from Git history; later diagnostics must warn about rotation and history
  cleanup.
- The path helper must not accidentally move user settings, local Agents, local Skills, or prompts.
- Permissions can be best-effort on some platforms, but tests should preserve the current expectation shape.
