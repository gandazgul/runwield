---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
affectedPaths:
    - "src/tools/"
    - "src/agent-definitions/ideator.md"
    - "src/agent-definitions/architect.md"
    - "src/shared/session/"
    - "src/ui/review/"
    - "src/ui/workspace/react/"
    - "src/ui/workspace/routes/"
    - "src/ui/workspace/"
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
order: 2
dependencies:
    - "01-shared-session-sidebar-and-artifact-catalog"
planId: "bc6ca032-417c-49b9-9aae-ef94b2b99882"
archivedAt: "2026-09-05T04:21:38.496Z"
archivedFromStatus: "draft"
archivedFromPath: "docs/plans/session-sidebar-and-artifact-review/02-opt-in-prd-and-adr-review.md"
---

# Opt-In PRD and ADR Review

## Context

After child 01, Ideator PRDs and Architect ADRs can be explicitly registered on the umbrella RunWield Session Manifest
and opened through the shared canonical Markdown reader. Plans already have a mandatory `plan_written` review loop, but
PRDs and ADRs serve a different purpose: they capture product or architectural understanding and should not
automatically interrupt every authoring conversation or acquire Plan approval, readiness, execution, or validation
meaning.

The desired experience is an explicit user choice after successful artifact registration. **Review now** opens a
feedback-capable version of the shared Markdown surface. **Keep without review** preserves the canonical file and
Session Artifact relation and lets the Agent finish normally. Review feedback returns to the same Ideator or Architect
for targeted revision; acceptance closes the review without creating a new document lifecycle.

## Objective

- Extend the registered-artifact declaration flow for PRDs and ADRs with **Review now** and **Keep without review**.
- Reuse the established Markdown viewer, annotation interaction, review conversation, and revision comparison patterns
  where they are document-generic.
- Return consolidated feedback and annotations to the active Ideator or Architect so it can revise the canonical file
  and resubmit the same registered artifact.
- Preserve one Session Artifact identity across revisions and process-safe retries.
- Keep PRD/ADR review entirely separate from Plan Lifecycle, execution policy, Plan Workflow Lease, validation, and Work
  Record authority.

## Approach

Extend the declaration result only after child 01 has durably registered and re-read the artifact. The tool brokers one
structured choice through the active Session interaction adapter. Choosing **Keep without review** returns a terminal
kept result. Choosing **Review now** opens a new authored-artifact review mode over the generalized Markdown surface.

The review mode uses document-generic selection comments, annotations, and a simple outcome contract:

```text
artifact registered
  -> Review now | Keep without review
  -> Keep: return registered/kept
  -> Review: open current canonical revision
       -> Accept: record interaction outcome and finish
       -> Request changes: return feedback + annotations to authoring Agent
            -> Agent edits canonical file
            -> declaration reuses artifact ID and opens a new revision comparison
```

Review conversation state remains interaction evidence associated with the live Session and artifact identity. The
canonical PRD or ADR remains the only document body. The Session Manifest keeps the same small artifact reference and
does not accumulate Markdown versions, annotations, approval flags, or review transcripts.

The option set aside is reusing `plan_written` unchanged. Its approval actions, execution policy, Plan revisions, and
lifecycle events would falsely imply that accepting a PRD or ADR authorizes implementation.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- Child 01's artifact declaration tool and shared Session artifact service — add the post-registration choice and reuse
  stable artifact identity across revision submissions.
- `src/agent-definitions/ideator.md` and `architect.md` plus toolset policy tests — require declaration after canonical
  PRD/ADR writes, explain the optional review outcomes, and continue collaboration only when feedback is returned.
- New focused review coordinator under `src/ui/review/` — own authored-artifact review requests, current/reviewed
  fingerprints, cancellation, feedback, and retry without calling Plan Lifecycle.
- `src/ui/workspace/react/ArtifactReadSurface.tsx` or a sibling shared document component — reuse Markdown presentation
  while adding review-only annotations, feedback composer, current-versus-prior revision comparison, and accept/request
  changes controls.
- Review types, launcher, Workspace routes, and embedded Session navigation — carry typed `prd | adr` artifact identity,
  sanitized content, decisions, and return destinations under existing owner/Project checks.
- TUI and Workspace Pending Structured Interaction adapters — render or launch the same **Review now** / **Keep without
  review** decision without `globalThis.prompt()` and return control to the originating Session.
- `docs/design-system.md` and `docs/domain-language.md` — document Authored Artifact Review only after its distinct
  semantics and reusable UI are real.

## Reuse Opportunities

- Child 01's Session Artifact registration, hydration, sidebar destination, and generalized Markdown reader.
- Plan review's annotation shapes, selected-text interaction, revision diff presentation, review conversation routing,
  browser launcher lifecycle, and return-to-Session behavior where those pieces do not depend on Plan semantics.
- Existing Pending Structured Interaction adapters — present the opt-in choice consistently in TUI and Workspace.
- Existing RunWield buttons, dialogs, feedback composer, semantic tokens, theme bridge, focus management, and responsive
  embedded review shell.

## Implementation Steps

- A successfully registered PRD or ADR declaration offers exactly **Review now** and **Keep without review** through the
  active Session interaction adapter. The choice happens after durable registration, so cancellation, process loss, or
  choosing Keep cannot remove the Session Artifact or canonical file.
- **Keep without review** returns a clear kept outcome, emits no review surface, creates no document revision copy, and
  permits Ideator or Architect to finish. Repeating the declaration still resolves to the existing artifact identity and
  may offer review again without adding a duplicate catalog row.
- **Review now** opens the canonical current PRD/ADR in an authored-artifact review mode with its proper document label,
  Project-relative path, table of contents, images, selectable text, annotations, feedback composer, and accessible
  accept/request-changes controls. No Plan approval action, execution Agent, collaboration recommendation, run button,
  Plan status, or readiness language appears.
- Requesting changes returns structured overall feedback and anchored annotations to the same active authoring Agent.
  Ideator or Architect makes targeted edits to the canonical file, calls the declaration tool again, and the next review
  shows the current Markdown against the exact previously reviewed fingerprint while retaining one artifact ID.
- Accepting records only the completed review interaction and reviewed content fingerprint needed to avoid confusing a
  later changed file with the accepted revision. It does not add approval/status fields to the PRD, ADR, Session
  Manifest artifact entry, Plan store, controller record, Work Record, or Workspace database.
- Stale review submission detects that canonical Markdown changed after the surface opened and requires refresh before
  accepting or returning annotations against the wrong revision. Duplicate decisions are idempotent; wrong Session,
  wrong Project, wrong artifact, expired token, lost process, and canceled interaction fail without changing the file or
  catalog.
- TUI and Workspace return from review to the originating Session and refresh the Artifacts tab from the shared
  projection. TUI uses the Workspace-styled browser review surface; Workspace embeds or navigates to the established
  review shell without opening an unrelated Project or Session.
- Ideator and Architect instructions distinguish artifact completion from review outcome: the artifact is canonical once
  written and registered; feedback requests another collaborative revision; Keep and Accept both allow normal
  completion. Neither Agent describes acceptance as implementation approval.
- Plan review, Code Review, and read-only artifact call sites continue using their existing outcome contracts. Shared UI
  extraction is document-generic, but no conditional branch translates authored-artifact decisions into Plan Events.
- `docs/design-system.md` documents the reusable authored-document feedback patterns, and `docs/domain-language.md`
  defines Authored Artifact Review, its lack of lifecycle authority, and its relationship to Session Artifact and PRD/
  ADR canonical files.

## Approval Confirmation

No Work Record is superseded by this Plan. It adds an optional review interaction for newly registered product and
architecture documents without replacing prior verified planning guidance.

## Verification Plan

- Automated: run focused tool, Agent prompt/toolset, Session interaction, review coordinator/launcher, Workspace route,
  React review-surface, and TUI/Workspace interaction adapter suites through `deno run -A scripts/run-tests.js`.
- Automated: run `deno task workspace:check`, `deno task workspace:test`, `deno task workspace:build`,
  `deno task seams:check`, and `deno task ci`.
- Automated: a real Ideator fixture writes and registers a PRD, chooses Keep, and proves one manifest artifact exists
  with no review server or Plan event. A real Architect fixture registers an ADR, requests review, receives anchored
  feedback, revises the canonical file, resubmits, and accepts; the artifact ID remains unchanged and the accepted
  fingerprint matches the final file.
- Automated: integration fails if registration is deferred until after the choice, if Keep removes the artifact, if
  feedback is flattened into unstructured success text, if a second review creates a second artifact, or if acceptance
  writes Plan status/readiness/execution fields anywhere.
- Automated: stale-file, duplicate-decision, cancellation, closed-tab, wrong-Project, wrong-Session, unsafe path, lost
  live process, and browser-unavailable cases preserve the canonical file and registered relation and return honest
  recovery guidance.
- Automated: existing Plan review tests continue to prove approve-and-run, approve-for-later, execution policy,
  revisions, annotations, and lifecycle transitions. Authored-artifact fixtures prove none of those controls or events
  are reachable from PRD/ADR review.
- Manual headed browser: run `deno task workspace:dev`; from disposable Ideator and Architect Sessions exercise Keep,
  Review, annotations, overall feedback, revision comparison, stale refresh, Accept, cancel/close, return navigation,
  and mobile layout at approximately 390×844. Verify correct PRD/ADR labels and absence of Plan controls.
- Manual TUI: complete an Ideator PRD and Architect ADR, exercise both choices, open the browser review, return
  feedback, revise, accept, and confirm the originating Session and Artifacts tab remain active.
- Expected result: users can inspect and improve authored PRDs and ADRs when useful without turning every document into
  a mandatory gate or weakening the meaning of Plan approval.

## Edge Cases & Considerations

- If the user closes the review browser, the interaction returns a canceled/closed outcome and the Agent asks whether to
  review again or keep the already registered artifact; it must not loop automatically.
- An accepted document may be edited manually later. Acceptance describes only the reviewed fingerprint and is not a
  durable document status; the Artifacts tab shows current canonical content without claiming it remains reviewed.
- Review annotations refer to one Markdown revision. Changed or deleted target text must be presented as stale feedback,
  not silently re-anchored to a different passage.
- Generic reports, Work Records, Epic Artifacts, and Plans remain read-only or use their specialized review flow in this
  child. Extending optional authored review to another kind requires an explicit later product decision.
- No new public dependency is needed. Reuse Plannotator and existing Workspace review infrastructure to avoid a second
  Markdown parser or annotation model.
- Existing dirty source files in this planning checkout are unrelated user work. Execution must use its Plan worktree
  and must not overwrite or attribute those edits to this child.
