---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/session/file-session-store.ts"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/session-transcript-projection.js"
    - "src/cmd/load-plan/"
    - "src/ui/tui/"
    - "src/ui/workspace/server/"
    - "src/plan-store.js"
    - "docs/domain-language.md"
executionAgent: "engineer"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-09-03T00:53:52.832Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v2"
order: 1
dependencies:
    []
planId: "98b12e58-4960-4b5d-8f72-835ec7804dbf"
---

# Durable Plan-to-Session Continuity

## Context

The Workspace and `wld load-plan` can load a saved Plan without finding the Session that produced it. The owner can lose
the planning rationale and continue in a new or unrelated Session.

Today the Session records only mutable Plan display context, such as `planName` or fail-open workflow footer context.
That is not enough. A Plan can have zero, one, or several related Sessions, and a Session can relate to more than one
Plan. The relationship must be append-only Session evidence, not one mutable owner Session field in Plan Front Matter.

## Objective

Make Plan-to-Session continuity reliable. A production workflow that plans, reviews, executes, or recovers a Plan
commits association evidence with durable `planId`, stable Session ID, purpose, segment evidence, and committed
generation context. Loading a Plan first resolves this evidence and chooses one safe idle planning Session when there is
exactly one. If there are several choices, an active associated Session, or no safe match, the owner gets an explicit
choice or the current fallback remains.

## Approach

Put the relationship where the history lives: Session evidence. Read the reverse lookup from Sessions inside the
registered Project.

```text
workflow produces Plan context
  Session Runtime commits plan association evidence
  committed generation is published
  load-plan resolves Plan by ID
  reverse lookup finds associated Sessions
  safe idle planning Session is adopted or the owner chooses
```

The option set aside is a Plan Front Matter field that points to one Session. That is smaller at first, but it loses
history, breaks multi-Session workflows, and makes Plan files claim ownership they do not have.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/session/file-session-store.ts` — stores and reads committed Session evidence needed for association
  lookup.
- `src/shared/session/session-runtime.js` and nearby runtime modules — own the commit-confirming Plan association
  operation used by production paths.
- `src/shared/session/session-transcript-projection.js` — projects append-only Plan association purpose, segment, and
  generation evidence beside existing transcript summaries.
- `src/cmd/load-plan/` — resolves the Plan first, then chooses or adopts the associated Session before sending any
  resume request.
- `src/ui/tui/` — keeps TUI Session replacement and load-plan behavior safe when an associated Session exists elsewhere.
- `src/ui/workspace/server/` — exposes browser-safe association reads for navigation and future Dashboard/sidebar use.
- `src/plan-store.js` — provides canonical Plan identity and authority-aware hydration needed by the lookup.
- `docs/domain-language.md` — defines the stable Plan-to-Session relationship language that this change makes true.

When the implementation makes proposed domain language true, include the applicable domain-language file:
`docs/domain-language.md` for a single-context project, or the context-specific `domain-language.md` identified by
`docs/domain-language-map.md` for a multi-context project.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session-transcript-projection.js#summarizeProjectedEntries` — extend the committed transcript
  projection instead of creating a second Session summary format.
- `src/ui/workspace/server/session-continuation.js` — reuse stable Session listing and activation reads.
- `src/shared/session/session-transcript-manifest.ts` — reuse committed generation and segment evidence.
- `src/cmd/load-plan/plan-session-surface.ts` — keep existing Plan action flow after the Session choice is made.
- `src/plan-store.js` — reuse canonical Plan ID and authority selection.

## Implementation Steps

- Session Runtime owns one operation that commits Plan association evidence with durable `planId`, stable Session ID,
  association purpose, segment ID and kind, and committed generation context.
- Production planning, review, execution, and recovery paths use that operation and surface persistence failure instead
  of silently relying on `runwield.workflow_context`.
- Transcript projection reads historical association entries without rewriting old Session files or treating mutable
  `planName` as proof.
- Reverse lookup verifies the `planId` inside the same registered Project and can return zero, one, or several Sessions.
- `wld load-plan` resolves the Plan before Session binding and automatically resumes only one safe idle planning
  Session.
- Multiple associated Sessions, an active associated Session, or loading from a non-empty unrelated Session requires an
  owner choice or keeps the existing fallback without queued synthetic resume work.
- `docs/domain-language.md` describes durable Plan association evidence, avoided aliases, and stable relationships to
  Session, Plan, and Session Writer Lock.

## Verification Plan

- Automated: run `deno run -A scripts/run-tests.js src/cmd/load-plan/plan-session-continuity.integration.test.ts`.
- Automated: add coverage that production planning, review, execution, and recovery paths write association evidence
  through the real Session Runtime operation.
- Automated: restart readers and prove association lookup survives from committed Session evidence, not direct fixture
  appends or mutable `planName`.
- Automated: prove one safe idle planning Session keeps the same `runwieldSessionId` and verified committed model
  context.
- Automated: prove multiple matches, active-elsewhere matches, and no-match cases do not replace unrelated Sessions or
  queue synthetic resume work.
- Manual: from a fresh empty Session and from a non-empty unrelated Session, load a Plan with one known planning Session
  and confirm the original context is used only after the safe choice.
- Manual: attempt the same while the original Session is active elsewhere and confirm Workspace or TUI identifies the
  active surface without takeover.
- Expected result: loading a Plan can return to its original planning context when that is safe, and old Sessions with
  only `planName` never trigger automatic resume.
- When applicable: confirm the glossary describes implemented behavior and does not promote unimplemented proposals.

## Edge Cases & Considerations

- Legacy Sessions can contain only `planName` or no association. They can be shown as uncertain hints but not used for
  automatic resume.
- A Session can produce more than one Plan. The association model must not duplicate one Session as if it had separate
  histories.
- Planning, execution, repair, and follow-up can have different roles. An old planning association can become unsafe for
  automatic planning resume when current workflow evidence changes.
- Viewing an associated active Session must not acquire the Session Writer Lock. The first mutation still acquires the
  existing lock through Session Runtime.
