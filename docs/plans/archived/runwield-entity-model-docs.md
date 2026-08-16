---
planId: "6c43c06a-1c9b-4f11-8d92-61679b424caf"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Add source-grounded RunWield entity model documentation and link/update the Core architecture document."
affectedPaths:
    - "architecture.md"
    - "docs/entity-model.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-29T09:32:03-04:00"
updatedAt: "2026-07-29T15:30:00.412Z"
archivedAt: "2026-07-01"
status: "verified"
origin: "internal"
implementedAt: "2026-07-29T15:01:46.171Z"
verifiedAt: "2026-07-29T15:29:48.862Z"
userVerifiedAt: null
executionReport: "- Created `docs/entity-model.md` with four small Mermaid ER diagrams plus identity/ownership/lifecycle/source-of-truth notes and a persistence/authority table.\n- Updated `architecture.md` with prominent and targeted links to the entity model, and replaced current-workflow `FEATURE` wording with `PLANNED_CHANGE` while preserving only explicit legacy/Work Kind references.\n- Verified formatting with `deno fmt --check architecture.md docs/entity-model.md` (passed).\n- Manually checked Mermaid fence completeness, link target presence, canonical terminology, legacy `FEATURE` usage, and source-of-truth caveats; `deno task check` was not run because only Markdown docs were changed."
workRecord:
    status: "generated"
    recordId: "d5e515b2-6f8c-4a8d-8b4f-08a7d27c0bd9"
    path: "docs/work-records/2026-07-29-runwield-entity-model-documentation-added.md"
    lastAttemptAt: "2026-07-29T15:29:54.561Z"
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-07-29T15:29:48.315Z"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "5c9406a00fa47e5ef362531b6737bfee193efb2f"
    targetBranch: "main"
    targetHeadBeforeMerge: "5f6c58ad99dae73fc9d1b0d27e456aa87df38420"
routingIntent: "PLANNED_CHANGE"
sessionName: "entity model docs"
---

# RunWield Entity Model Documentation

## Context

The user wants one or more entity models for RunWield, linked from `architecture.md`, with the architecture document
updated where needed. The existing `architecture.md` is an implementation-facing Core architecture map with many flow
and boundary diagrams, but it does not provide a consolidated entity-relationship view of RunWield's durable concepts,
transient workflow objects, ownership boundaries, and storage authorities.

Repository evidence:

- `docs/domain-language.md` already defines the canonical domain language and relationships for Sessions, Plans, Plan
  Lifecycle, Work Records, Workspace, Projects, Agents, Tools, Memories, Ticket References, and Forge Delivery.
- `architecture.md` currently covers Core boundaries, Session runtime, Workflow orchestration, Plan domain,
  execution/validation/worktrees, persistence, adapters, seams, verification, and source guides.
- `docs/prd/runwield-core-prd.md`, `docs/plan-lifecycle.md`, and `docs/sessions.md` provide current product and
  lifecycle truth that should ground the entity model.
- `architecture.md` still uses some legacy `FEATURE` workflow wording in diagrams/text where current canonical language
  is `PLANNED_CHANGE`; update those references when touching the document, preserving legacy `FEATURE` only when
  explicitly describing compatibility or historical normalization.

## Objective

Create a concise but implementation-useful entity model companion document that helps engineers, agents, and
architecture reviewers answer:

- what the primary RunWield entities are;
- which identities are durable vs adapter/protocol-scoped;
- which entities are sources of truth vs projections or caches;
- how Sessions, Agent Sessions, Plans, Plan Lifecycle, Work Records, worktrees, Tickets, Forge Change Requests,
  Workspace Projects, and Memories relate;
- where each entity is persisted or owned.

Then link it from `architecture.md` and update `architecture.md` so the existing flow/boundary architecture and the new
entity model point to each other without duplicating large sections.

## Approach

Add a new Markdown document at `docs/entity-model.md` as the entity-model companion to the root architecture document.
Use multiple small Mermaid `erDiagram` diagrams instead of one large diagram, because RunWield has several bounded
relationship clusters and one all-in graph would be hard to read.

Recommended diagram set:

1. **Project and artifact model** — `Workspace`, `Project`, `Session`, `Plan`, `Epic`, `Child PLANNED_CHANGE Plan`,
   `PRD`, `ADR`, `Work Record`, `Memory`, `Team Memory`, `Ticket Reference`.
2. **Session and Agent model** — `Session`, `Session Transcript`, `Session Transcript Segment`, `Agent Session`,
   `Agent`, `Agent Definition`, `Skill`, `Toolset`, `Custom Tool`, `Delegated Agent Session`, `Session Control`.
3. **Plan workflow model** — `User Request`, `Triage Report`, `Routing Intent`, `Plan`, `Plan Status`, `Plan Event`,
   `Plan Workflow Lease`, `Review Loop`, `Feedback`, `Revision`, `Readiness Gate`, `Workflow Decision`.
4. **Execution, validation, and delivery model** — `Plan`, `Execution Worktree`, `Worktree Registry`,
   `Publication Candidate`, `Mechanical Validation`, `Workflow Validation`, `Review Issue Ledger`, `Review Issue`,
   `Review Advisory`, `Direct Delivery`, `Change Request Delivery`, `Forge Change Request`, `Work Record`.
5. **Persistence and authority table** — a non-diagram table listing entity, stable identity, source of truth/storage,
   lifecycle authority, and notes about projections/caches.

Use canonical terms from `docs/domain-language.md`, and avoid introducing new domain vocabulary unless it is clearly an
explanatory grouping rather than a new product concept. Keep diagrams source-grounded and do not model future-only PRD
proposals as implemented truth unless the document labels them as future/open.

Update `architecture.md` with a short link near the top, for example after **Architectural intent** or before **System
at a glance**, explaining that control-flow and dependency diagrams remain in `architecture.md` while entity
relationships live in `docs/entity-model.md`. Also add cross-references from relevant sections such as **Session
runtime**, **Plan domain**, and **Persistence map** where a reader would naturally look for entity relationships. Keep
these references short.

## Files to Modify

- `docs/entity-model.md` — new source-grounded entity model companion document with multiple Mermaid ER diagrams and an
  authority/storage table.
- `architecture.md` — add a prominent link to the entity model companion, add targeted cross-links from relevant
  architecture sections, and update stale `FEATURE` terminology to canonical `PLANNED_CHANGE` where appropriate.

## Reuse Opportunities

Existing documents and source guides to reuse as evidence:

- `docs/domain-language.md` — canonical domain language and stable relationships; use this as the primary vocabulary
  source.
- `architecture.md` — current Core architecture map and source guide; avoid duplicating flow diagrams already covered
  here.
- `docs/prd/runwield-core-prd.md` — implementation-facing current Core requirements, especially routing intents, Plan
  Lifecycle, session continuity, validation, and artifacts.
- `docs/plan-lifecycle.md` — authoritative Plan Status, Plan Event, worktree status, and transition inventory language.
- `docs/sessions.md` — Session storage, Session Name, resume, and root-agent behavior.
- `src/shared/workflow/plan-lifecycle.js` and `src/plan-store.js` — source-backed Plan Lifecycle and Plan persistence
  semantics when entity relationships need code confirmation.
- `src/shared/session/session-runtime.js`, `src/shared/session/hosted-session.js`, and
  `src/shared/session/session-host.js` — source-backed Session runtime ownership and identity semantics.
- `src/shared/worktree.js` and `src/shared/worktree-registry.js` — worktree identity, registry, and recovery authority.

## Implementation Steps

- [ ] Review `docs/domain-language.md`, `architecture.md`, `docs/prd/runwield-core-prd.md`, `docs/plan-lifecycle.md`,
      and `docs/sessions.md` immediately before editing so entity names and relationship cardinality match current
      documented truth.
- [ ] Create `docs/entity-model.md` with:
  - [ ] a title and short purpose statement identifying it as the entity-model companion to `architecture.md`;
  - [ ] a brief “how to read this” note explaining that diagrams are conceptual entity relationships, not database
        schemas;
  - [ ] multiple small Mermaid `erDiagram` blocks for the recommended clusters above;
  - [ ] prose bullets after each diagram covering identity, ownership, lifecycle, and source-of-truth caveats;
  - [ ] a persistence/authority table mapping major entities to storage/authority locations.
- [ ] Ensure the entity model distinguishes durable domain entities from transient workflow objects and adapter
      projections. In particular:
  - [ ] `Session`, `Plan`, `Work Record`, `Project`, and `Ticket Reference` are durable/project or user-facing entities.
  - [ ] `Agent Session`, `Workflow Decision`, `Review Issue Ledger`, and runtime events are execution/context-scoped and
        should not be described as long-lived project knowledge.
  - [ ] Workspace/adapter labels and projections are not sources of truth.
  - [ ] `Ticket Reference` and `Forge Change Request` relationships are provenance/navigation or delivery relationships
        only; RunWield does not own external lifecycle state.
- [ ] Update `architecture.md` to link to `docs/entity-model.md` near the beginning and add short cross-links in the
      sections where readers would expect entity relationship detail.
- [ ] While updating `architecture.md`, replace legacy `FEATURE` wording with canonical `PLANNED_CHANGE` where the
      document is describing current workflow classification. Keep `FEATURE` only where explicitly noting legacy
      compatibility/normalization.
- [ ] Keep all Mermaid fences complete and use conservative Mermaid syntax. Prefer several small diagrams over dense
      diagrams with many crossing relationships.
- [ ] Run formatting/checks and fix Markdown wrapping or Mermaid syntax issues.

## Verification Plan

- Automated:
  - `deno fmt --check architecture.md docs/entity-model.md`
  - If code references or generated indexes are touched unexpectedly, run `deno task check`; otherwise this is a
    documentation-only change and full test execution is not required.
- Manual:
  - Read `docs/entity-model.md` end-to-end and confirm every entity name follows `docs/domain-language.md` canonical
    language.
  - Confirm every new diagram is a complete fenced Mermaid block and renders conceptually as a small, readable model.
  - Confirm `architecture.md` contains a prominent link to `docs/entity-model.md` and that the link target is correct.
  - Confirm `architecture.md` no longer describes current planned work as `FEATURE` except in an explicit
    legacy-compatibility context.
  - Confirm the entity model does not promote future-only PRD proposals or adapter projections to source-of-truth
    entities.

## Edge Cases & Considerations

- **Over-modeling risk:** A single comprehensive ER diagram would be too dense and easy to misread as a database schema.
  Mitigate with multiple bounded diagrams plus caveat prose.
- **Terminology drift risk:** `docs/domain-language.md` is the current language source. Do not invent aliases such as
  “Task,” “Work Item,” “PR mode,” or “host session.”
- **Future-state confusion:** PRDs may contain future/open requirements. Label future-only relationships explicitly or
  omit them from the implemented entity model.
- **External ownership:** Tickets and Forge Change Requests are related to RunWield artifacts, but their content, state,
  and lifecycle remain owned by external systems.
- **Source-of-truth clarity:** Emphasize that Plan Markdown/front matter, Session transcript storage, worktree registry,
  Git, and Workspace projections have different authority levels; displays and caches must not be modeled as
  authoritative state.
