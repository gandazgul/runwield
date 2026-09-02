---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
summary: "Add manifest-backed Session Artifact registration and one consumer-neutral Session Sidebar projection rendered as Workflow, Session, and Artifacts tabs in TUI and Workspace, reusing a generalized read-only Markdown viewer."
affectedPaths:
    - "src/shared/session/file-session-store-types.ts"
    - "src/shared/session/file-session-store.ts"
    - "src/shared/session/file-session-storage.ts"
    - "src/shared/session/session-transcript-manifest.ts"
    - "src/shared/workflow/"
    - "src/tools/"
    - "src/agent-definitions/"
    - "src/ui/tui/"
    - "src/ui/workspace/"
    - "src/ui/review/"
    - "docs/prd/workflow-rail-prd.md"
    - "docs/prd/runwield-workspace-session-screen.md"
    - "docs/design-system.md"
    - "docs/domain-language.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "pair"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-09-02T10:21:37-04:00"
status: "draft"
origin: "internal"
parentPlan: "session-sidebar-and-artifact-review"
order: 1
dependencies: []
planId: "ec3d5b1f-ebd6-4380-8392-df9f30cc9070"
---

# Shared Session Sidebar and Artifact Catalog

## Context

The Workflow Rail PRD describes a conditional active-workflow rail, but the desired product is a persistent secondary
surface for every persisted RunWield Session. Workspace currently renders a coarse Plan-only sidebar inside
`SessionSurface.jsx`; the TUI instead renders validation progress in a full-width panel above the composer. Neither
surface can list the meaningful Markdown produced by the Session because the umbrella Session Manifest has no artifact
catalog.

This child provides the foundation for the parent Epic and for the later optional PRD/ADR review child. It covers
manifest-backed artifact registration, the consumer-neutral Session Sidebar projection, TUI and Workspace presentation,
and read-only viewing. It does not add feedback, annotations, or revision review for non-Plan documents.

## Objective

- Extend the file-authoritative RunWield Session Manifest with small typed references to explicitly registered canonical
  Markdown without copying document bodies or relying on Workspace SQLite.
- Add an idempotent declaration tool for eligible Agents to register meaningful Markdown after the file exists.
- Join Session, workflow, and artifact facts into one consumer-neutral Session Sidebar projection.
- Render persistent **Workflow**, **Session**, and **Artifacts** tabs in TUI and Workspace, with active Workflow and
  idle Session defaults and responsive collapse/drawer behavior.
- Replace the TUI's ambient validation panel with Workflow presentation while preserving blocking interactions beside
  the composer.
- Generalize the existing read-only Plan/Work Record surface for PRDs, ADRs, Epic Artifacts, and registered Markdown
  reports, with TUI selections opening the Workspace-styled reader.

## Approach

Add `SessionArtifactReference` to the Session Manifest and expose locked registration plus read methods from the File
Session Store. Registration validates the live canonical file against the registered Project root, normalizes a
Project-relative `.md` path, enforces the artifact kind's allowed location where one exists, and performs an atomic
idempotent manifest update. Existing manifests read as an empty catalog until their next safe write.

Create an `artifact_written`-style declaration tool rather than inferring outputs from `write_docs`, transcript prose,
or tool arguments. Initially support `prd`, `adr`, `plan`, `work-record`, `epic-artifact`, and `report`, but keep
specialized authorities intact: `plan_written` still owns Plan review/lifecycle behavior, Work Record machinery still
owns record generation/status, and the new declaration operation only establishes Session membership. Existing
specialized flows may call the same registration service after their canonical write succeeds.

Build the Session Sidebar projection above both UIs. It joins Runtime snapshot and usage, canonical active-workflow
evidence, and hydrated Session Artifact references. Missing facts remain explicitly unknown or unavailable. The UI may
offer navigation to existing guarded actions, but the projection cannot approve, retry, recover, or mutate workflow
state itself.

```text
canonical Markdown write succeeds
  -> declaration validates Project + path + kind
  -> File Session Store verifies active Session Writer Lock
  -> atomic manifest registration (duplicate-safe)
  -> Session Sidebar projection hydrates current canonical file
  -> TUI / Workspace render the same artifact row
  -> Workspace reader loads current Markdown on selection
```

The option set aside is storing artifact records in Workspace SQLite. That would make Core and the TUI depend on a
rebuildable browser projection and would lose the catalog if Workspace state were deleted.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/session/file-session-store-types.ts` — define `SessionArtifactKind`, `SessionArtifactReference`, manifest
  compatibility, and locked store operations without `any`, `unknown`, or complex inline types.
- `src/shared/session/file-session-store.ts`, `file-session-storage.ts`, and `file-session-control.ts` — perform atomic,
  recovery-safe, idempotent registration under Session mutation authority and expose non-mutating catalog reads.
- New focused modules under `src/shared/session/` — validate artifact paths/kinds, hydrate canonical availability, and
  compose the shared Session Sidebar projection.
- Aggregate Session projection and Workspace continuation/owner routes — expose sanitized Session, workflow, and
  artifact facts without local absolute paths, lock internals, copied Markdown, or credentials.
- `src/shared/workflow/` and `src/ui/workspace/server/owner-plan-progress.ts` — provide canonical stage, owner, subject,
  explanation, next-action, attention, and evidence facts required by the shared projection.
- `src/tools/`, tool registry/toolsets, `src/agent-definitions/ideator.md`, `architect.md`, `planner.md`, and Recorder
  or workflow completion paths where appropriate — declare or automatically attach canonical outputs through the one
  registration service after successful writes.
- `src/ui/tui/chat-view.ts`, `api.js`, runtime adapter, footer, new sidebar components, and Golden scenarios — render
  and control the TUI tabs, remove ambient validation-card ownership, collapse cleanly, and open artifact destinations.
- `src/ui/workspace/islands/SessionSurface.jsx`, new focused `.tsx` components, owner API, and CSS — replace the current
  conditional Plan panel with a persistent accessible sidebar/drawer driven by the shared projection.
- `src/ui/workspace/react/ArtifactReadSurface.tsx`, `review-types.ts`, `src/ui/review/review-launcher.ts`, and routes —
  accept typed trusted Markdown kinds and preserve type-specific labels/notices without parsing them as Plans.
- `docs/prd/workflow-rail-prd.md`, `docs/prd/runwield-workspace-session-screen.md`, `docs/design-system.md`, and
  `docs/domain-language.md` — align documented product behavior and canonical terms with what this child implements.

## Reuse Opportunities

- `writeManifest()` and Session recovery descriptor updates — preserve atomic file-backed authority.
- Session Writer Lock proof and active managed operation — authorize catalog mutation without a conditional testing
  seam.
- `projectAggregateSessionTranscript()` and Runtime snapshot data — supply durable segment and Session facts.
- `owner-plan-progress.ts` — reuse canonical Plan/controller/worktree/validation hydration.
- `ArtifactReadSurface`, Plannotator `Viewer`, and `SidebarContainer` — reuse document parsing, table of contents,
  notices, image base, and read-only rendering.
- Workspace Session shell, RunWield primitives, semantic tokens, theme bridge, and existing mobile progress treatment —
  preserve the established visual system.
- TUI footer workflow summary — retain the collapsed state and obvious sidebar re-open affordance.

## Implementation Steps

- `FileSessionManifest` supports an optional-on-read, present-on-new-write artifact catalog whose entries contain only a
  stable artifact ID, canonical kind, normalized Project-relative path, title, registered timestamp, registering Agent,
  and source segment ID when available. Existing manifests and recovery descriptors remain readable and retain exactly
  the same Session identity, activation, generation, and segment lineage.
- File Session Store registration requires the matching active Session mutation authority, rejects unsafe/missing/
  non-Markdown/mismatched-kind paths before writing, and atomically adds or returns one entry by normalized kind and
  canonical path. Duplicate calls, process restart, and recovery-descriptor reconstruction cannot create duplicates or
  copied Markdown.
- A non-mutating artifact catalog reader rechecks the registered Project boundary and current canonical file on every
  hydration. Missing, archived, superseded, or unreadable artifacts return an honest typed state and never fall back to
  cached content or transcript text.
- One artifact declaration tool validates a file already written by the active Agent and registers it on the current
  RunWield Session. Ideator PRDs and Architect ADRs use it; Plan, Work Record, Epic Artifact, and other specialized
  producers attach outputs through the same registration service without replacing their existing completion semantics.
  Tool and integration tests fail if the tool merely emits a transcript event or returns success without changing the
  manifest.
- A shared Session Sidebar projection exposes selected/default tab, Session name/state, Agent, model, thinking, context
  usage, Session Control summary, workflow kind/stage/owner/subject/reason/next/attention/evidence/actions, and hydrated
  artifact summaries. It contains no presentation markup, absolute paths, credentials, lock owner IDs, Plan mutation
  methods, or copied document bodies.
- Workflow projection covers QUICK_FIX, PLANNED_CHANGE, PROJECT, loaded/resumed Plan, validation, repair, review,
  publication, recovery, and terminal transition states from canonical evidence. Ordinary Guide, Ideator, Operator, and
  idle Sessions show no invented workflow; their persistent sidebar defaults to Session.
- Workspace uses a focused TypeScript Session Sidebar component with keyboard-operable tabs, visible focus, semantic
  status language, and an Artifacts list grouped by kind and recency. Active workflows default to Workflow, idle
  Sessions default to Session, and an explicit user tab choice remains stable while that Session stays open instead of
  being stolen by polling updates.
- At narrow browser widths the Session Sidebar opens as a labeled panel/drawer without permanently reducing timeline or
  composer width. Closing returns focus to the opener; Escape closes only the panel before it can cancel active work;
  reduced motion, touch targets, overflow, and long artifact titles follow the RunWield Design System.
- The TUI renders the same three tabs in a collapsible right rail when width permits and a focused overlay/stacked panel
  at narrow widths. Keyboard navigation, focus return, scrolling, collapse, and footer re-open behavior work without
  intercepting editor input or the established first/second Ctrl+C and Escape cancellation rules.
- Ambient validation progress and reports render inside Workflow, and the old persistent `validationPanelContainer` and
  `ValidationHandoffBlock` path no longer occupy the full width above the composer. Blocking approval, retry, recovery,
  Pair checkpoint, and destructive choices retain their established interaction cards and Runtime outcomes.
- The generalized canonical Markdown reader supports Plan, PRD, ADR, Work Record, Epic Artifact, and report labels while
  retaining current Plan/Work Record behavior, notices, outline navigation, images, print behavior, and safe close. It
  does not expose arbitrary filesystem reads. Workspace opens it in the established artifact route; TUI launches that
  Workspace-styled reader locally when no persistent Workspace destination is available.
- `docs/prd/workflow-rail-prd.md` and `docs/prd/runwield-workspace-session-screen.md` describe the persistent Session
  Sidebar and explicit artifact catalog. `docs/design-system.md` documents only implemented reusable patterns.
  `docs/domain-language.md` defines Session Artifact, Session Artifact Catalog, and Session Sidebar, their owners and
  relationships, and retires Workflow Rail as the umbrella surface name.

## Approval Confirmation

No Work Record is superseded by this Plan. It implements previously deferred Workflow Rail intent and extends it with
new Session artifact membership rather than replacing a verified implementation record.

## Verification Plan

- Automated: run focused suites through `deno run -A scripts/run-tests.js` for File Session Store/storage/control and
  recovery, Session Runtime/projection, artifact declaration, Workspace Session API/components, artifact reader, TUI
  API/runtime adapter/sidebar, and Golden workflow scenarios discovered during implementation.
- Automated: run `deno task workspace:check`, `deno task workspace:test`, `deno task workspace:build`,
  `deno task test:golden-tui`, `deno task seams:check`, and `deno task ci`.
- Automated: a real file-backed Session fixture declares a PRD, repeats the declaration, rolls from planning to an
  execution transcript segment, closes/reopens the store, and rebuilds from recovery evidence. Exactly one artifact
  remains attached to the same RunWield Session and hydrates the current file. This fails if registration is only a
  transient event, tied to one Pi segment, or stored in Workspace SQLite.
- Automated: adversarial path fixtures cover absolute paths, traversal, symlink escape, wrong Project, directories,
  missing files, non-Markdown, PRD outside `docs/prd/`, ADR outside `docs/adr/`, kind mismatch, duplicate ID/path, and
  stale artifact deletion without partially changing the manifest.
- Automated: one shared projection fixture supplies active planned work, QUICK_FIX validation, recovery-needed,
  artifact-rich idle, and degraded canonical evidence to both TUI and Workspace adapters. Assertions compare semantic
  facts and fail if either UI independently invents workflow stages or discovers artifacts from transcript text.
- Automated: artifact reader fixtures render Plan, PRD, ADR, Work Record with notices, Epic Artifact, and report through
  the generalized reader; Project-bound routes reject wrong-Project and unsafe references and never return local
  absolute paths in list payloads.
- Manual headed browser: run `deno task workspace:dev`, use `/dev` fixtures plus a real disposable Session at
  `http://127.0.0.1:5173`, and inspect active, idle, artifact-empty, artifact-rich, busy-other-surface, missing-file,
  and degraded states at wide desktop and approximately 390×844. Verify tab keyboard behavior, focus return, drawer
  layout, reader navigation, long content, and that the timeline/composer remain primary.
- Manual TUI: inspect the same semantic states in wide and narrow terminals; verify tab navigation, rail collapse/footer
  restore, artifact browser opening, validation progress during streaming, blocking interactions, and unchanged Escape/
  Ctrl+C behavior.
- Existing behavior protected after reshaping: Session locking/generation/rollover/recovery, Workspace authorization,
  Session draft and control behavior, Plan and code review, Work Record notices, validation outcomes, and all current
  artifact-read call sites. Expected removals are tests asserting the conditional Plan-only Workspace sidebar or
  persistent full-width TUI ambient validation panel; replace them with sidebar behavior coverage rather than deleting
  coverage.
- Expected result: every persisted Session has a trustworthy cross-surface sidebar, canonical artifacts survive Pi
  segment rollover and process restart, and presentation never becomes workflow or document authority.

## Edge Cases & Considerations

- A new Session has no manifest before its first User Request, so the UI stays clean and does not create storage merely
  to remember a sidebar preference.
- Local tab/collapse preference is presentation state and must not enter the Session Manifest or change Session Control.
- A Session can contain an artifact written in an execution worktree whose canonical authority later moves to primary
  during publication. Registration should use stable Project-relative identity and established Plan/Work Record readers;
  it must not persist an execution worktree absolute path.
- Plan archival and Work Record supersession preserve the relation but update hydrated state and notices. A generic
  report has no invented lifecycle.
- Artifact registration failure after a file write leaves the canonical file intact and reports that it is not yet in
  the Session catalog. Retrying the declaration is safe.
- Existing dirty source files in this planning checkout are unrelated user work. Execution must use its Plan worktree
  and must not overwrite or attribute those edits to this child.
