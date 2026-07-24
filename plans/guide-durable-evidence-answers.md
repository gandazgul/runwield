---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Make Guide answer project rationale, blockers, changes, and current-state questions from cited durable artifacts, and migrate ADR status from prose to required machine-readable front matter."
affectedPaths:
    - "src/agent-definitions/guide.md"
    - "src/agent-definitions/document-formats/ADR-FORMAT.md"
    - "src/shared/session/agents.js"
    - "src/shared/session/__tests__/session-tools-policy.test.js"
    - "src/shared/session/session-prompt.test.js"
    - "src/adr-artifacts.test.js"
    - "docs/adr/000-initial-tech-stack.md"
    - "docs/adr/001-codebase-optimization-types-and-handlers.md"
    - "docs/adr/002-two-tier-tool-system.md"
    - "docs/adr/003-plan-recovery-baseline-tree.md"
    - "docs/adr/004-plan-lifecycle-event-module.md"
    - "docs/adr/005-concurrent-worktree-isolation.md"
    - "docs/adr/006-uniform-agent-handler-workflow-tools.md"
    - "docs/adr/007-local-first-workspace-plan-board.md"
    - "docs/adr/008-plan-archival-and-retrieval.md"
    - "docs/adr/008-remote-canonical-collaborative-shared-spaces.md"
    - "docs/adr/009-session-host-as-external-integration-boundary.md"
    - "docs/adr/010-session-runtime-sibling-adapters-and-acp.md"
    - "docs/adr/011-exclusive-session-activation-and-durable-workflow-checkpoints.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-24T14:15:08-04:00"
updatedAt: "2026-07-24T18:35:53.301Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-24T18:26:54.168Z"
verifiedAt: "2026-07-24T18:35:53.301Z"
executionReport: "- Implemented Guide evidence-first project inquiry instructions with artifact locations, authority hierarchy, citation/status rules, and exclusions for raw Session Transcripts/local metrics.\n- Migrated all `docs/adr/*.md` files to machine-readable `status: accepted` front matter and updated `ADR-FORMAT.md` to require the ADR status enum.\n- Added `src/adr-artifacts.test.js` plus Guide prompt/nudge assertions covering the durable-evidence contract.\n- Verified: `deno fmt --check ...` passed for all changed files.\n- Verified: focused `deno test -A src/adr-artifacts.test.js src/shared/session/__tests__/session-tools-policy.test.js src/shared/session/session-prompt.test.js` passed.\n- Verified: `deno task workspace:build` resolved missing local Workspace build needed by existing Workspace tests; affected Workspace tests passed afterward.\n- Verified: final `deno task ci` passed.\n- Manual live Guide smoke test was not run because no model API credentials are available in this environment."
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-07-24T18:35:53.263Z"
---

# Guide Durable Evidence Answers

## Context

Guide currently answers repository questions directly and can inspect code, documentation, Memory, Git, Plans, and all
Work Record states. Its bundled prompt only asks it to cite paths "when useful," however, and does not tell it where
RunWield's durable project artifacts live, how their authority differs, or how to answer questions such as "Why did we
build this?", "What is blocked?", and "What changed?" without treating prospective documents or raw conversation as
project truth.

Phase 1 should improve Guide's behavior with explicit instructions and existing tools only. It should not implement the
future Project Evidence Graph, a unified Project Knowledge Search tool, validation-attempt telemetry, Session
provenance, or cross-Project retrieval. Raw Session Transcripts remain private and non-citable. Local workflow metrics
remain noncanonical operational telemetry.

The ADR corpus also represents status as prose, and one adopted ADR has no status marker. Migrating every current ADR to
required status front matter gives Guide a mechanically readable authority signal now and establishes the format needed
by later evidence indexing.

## Objective

Make Guide produce concise, citation-backed answers about project intent, decisions, workflow state, delivered changes,
and current implementation by deliberately retrieving the relevant durable artifacts, preserving each artifact's status
and authority, and clearly identifying missing or conflicting evidence.

At the same time, migrate all existing RunWield ADRs to `status: accepted` front matter, make a four-value ADR status
enum mandatory for future ADRs, and enforce the repository contract with an automated test.

## Approach

Expand `guide.md` with a focused evidence-first project inquiry workflow and an explicit artifact map. The map must give
Guide the conventional paths while still requiring discovery when another Project uses `CONTEXT-MAP.md` or different
locations:

| Evidence                   | Canonical location                                                                                            | Authority in Guide answers                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Domain language            | root `CONTEXT.md`, or root `CONTEXT-MAP.md` pointing to context-specific `CONTEXT.md` files and ADR locations | Canonical terminology and context boundaries                                                                                            |
| Product intent             | root `PRD.md`; `docs/prd/**/*.md`, including `docs/prd/done/**`                                               | Intent and direction only; never proof of implementation, scheduling, or roadmap commitment                                             |
| Architectural decisions    | context-mapped ADR directory or `docs/adr/**/*.md`                                                            | `status: accepted` is an authoritative current rule; other or missing statuses require qualification                                    |
| Active Plans               | `plans/**/*.md`, excluding `plans/archived/**`; Epic children may be nested under `plans/<epic-name>/`        | Prospective intent plus canonical Plan Lifecycle state                                                                                  |
| Archived Plans             | `plans/archived/**/*.md`                                                                                      | Historical Plan evidence; archival is separate from lifecycle status                                                                    |
| Work Records               | `docs/work-records/*.md`, retrieved through `work_record_search`/`work_record_read` when possible             | Approved/current records are authoritative retrospective outcomes; preserve all notices and completion modes                            |
| Current implementation     | Project source, configuration, tests, and relevant ordinary documentation                                     | Source/config/tests establish current behavior; ordinary docs support claims but receive no authority solely from location              |
| Changes                    | repository Git history via safe `git log`/`git show`; current `git diff` only when relevant                   | Commits are durable change evidence; working/index diffs are provisional and must be labeled uncommitted                                |
| Validation and blockers    | Plan front matter and linked Work Record state                                                                | Preserve status, failure/worktree/hold/dependency fields, timestamps, review metadata, Epic done-enough state, and verification notices |
| External demand provenance | `tickets: [{ url }]` in Plan or Work Record front matter                                                      | Navigation/provenance only; never external lifecycle truth                                                                              |

Teach Guide to first identify the claim type, retrieve the smallest relevant evidence set, distinguish intent from
outcome/current behavior, and answer with compact inline citations. Citations should use project-relative paths plus a
heading/status, source paths plus symbols, Work Record IDs/paths plus notices, or Git commit hashes. Line numbers are
not required. Guide must not invent lineage among artifacts merely because their wording is similar.

Codify the agreed authority hierarchy:

1. Accepted/current ADRs are authoritative architectural rules.
2. Approved/current Work Records are authoritative retrospective outcomes.
3. Current source, configuration, tests, and committed Git history are implementation evidence.
4. Plan front matter is canonical workflow-state evidence in Phase 1; `implemented` is not `verified`,
   `closed_without_verification` is not validation, and Epic `done_enough` may leave deferred scope.
5. PRDs are authoritative product intent/direction but do not prove delivery or roadmap commitment.
6. Proposed, deprecated, superseded, missing-status, draft, pending, archived, done-enough, and
   closed-without-verification artifacts are citable only with prominent state-specific qualification.
7. Other project documentation is supporting evidence whose current/proposed/historical standing must be disclosed when
   material.
8. Memory may guide discovery but is not preferred citation evidence and cannot override current durable artifacts.
9. Session Transcripts and local workflow metrics are excluded from project evidence citations.

Keep existing Guide scope, Markdown preservation limits, tools, and direct-answer style intact. Update Guide's scheduled
attention nudge so a long Agent Session continues to prioritize durable evidence and citations without duplicating the
full artifact map.

For ADRs, replace prose `## Status` sections with YAML front matter and add missing status metadata. Require exactly one
of `proposed`, `accepted`, `deprecated`, or `superseded`; do not encode a superseding ADR reference inside the status
string. Relationship metadata can be designed separately when a concrete need arises.

## Files to Modify

- `src/agent-definitions/guide.md` — add the durable-evidence role contract, artifact-location map, inquiry workflow,
  authority hierarchy, citation format, status handling, conflict/uncertainty behavior, and transcript/metrics
  exclusions while preserving Guide's existing read-mostly and Markdown boundaries.
- `src/agent-definitions/document-formats/ADR-FORMAT.md` — make ADR YAML front matter mandatory, define the four allowed
  status values, show `status: proposed` in the creation template, and remove the optional prose/status-string guidance.
- `src/shared/session/agents.js` — revise Guide's periodic attention nudge to reinforce evidence-first answers and
  compact citations while retaining its direct-answer and scope-boundary reminders.
- `src/shared/session/__tests__/session-tools-policy.test.js` — extend bundled Guide prompt assertions to lock in the
  artifact map, PRD intent-only rule, ADR/Work Record authority distinctions, citation requirement, and Session
  Transcript exclusion without testing prose exhaustively.
- `src/shared/session/session-prompt.test.js` — update the exact expected Guide attention nudge.
- `src/adr-artifacts.test.js` — add a small repository contract test that recursively reads `docs/adr/**/*.md`, parses
  YAML front matter with `@std/front-matter`, requires exactly one allowed `status`, and rejects legacy `## Status`
  sections.
- `docs/adr/000-initial-tech-stack.md` — add `status: accepted` front matter and remove the prose Status section.
- `docs/adr/001-codebase-optimization-types-and-handlers.md` — add `status: accepted` front matter and remove the prose
  Status section.
- `docs/adr/002-two-tier-tool-system.md` — add `status: accepted` front matter and remove the prose Status section.
- `docs/adr/003-plan-recovery-baseline-tree.md` — add `status: accepted` front matter and remove the prose Status
  section.
- `docs/adr/004-plan-lifecycle-event-module.md` — add `status: accepted` front matter and remove the prose Status
  section.
- `docs/adr/005-concurrent-worktree-isolation.md` — add `status: accepted` front matter and remove the prose Status
  section.
- `docs/adr/006-uniform-agent-handler-workflow-tools.md` — add `status: accepted` front matter and remove the prose
  Status section.
- `docs/adr/007-local-first-workspace-plan-board.md` — add `status: accepted` front matter and remove the prose Status
  section.
- `docs/adr/008-plan-archival-and-retrieval.md` — add `status: accepted` front matter and remove the prose Status
  section.
- `docs/adr/008-remote-canonical-collaborative-shared-spaces.md` — add the user-confirmed `status: accepted` front
  matter; this is the only current ADR without a prose status to remove.
- `docs/adr/009-session-host-as-external-integration-boundary.md` — add `status: accepted` front matter and remove the
  prose Status section.
- `docs/adr/010-session-runtime-sibling-adapters-and-acp.md` — add `status: accepted` front matter and remove the prose
  Status section.
- `docs/adr/011-exclusive-session-activation-and-durable-workflow-checkpoints.md` — add `status: accepted` front matter
  and remove the prose Status section.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session.js` — retain Guide's existing all-status `work_record_search`/`work_record_read` wiring;
  this phase changes instructions, not retrieval infrastructure.
- `src/shared/session/__tests__/session-tools-policy.test.js` — reuse `loadAgentDef("guide")` to test the effective
  bundled prompt and ensure existing Guide tool/write boundaries remain unchanged.
- `src/shared/session/agents.js` and `src/shared/session/session-prompt.test.js` — reuse the established scheduled
  attention-nudge mechanism rather than adding Guide-specific runtime behavior.
- `@std/front-matter` — reuse the repository's existing YAML front-matter parser for the ADR corpus contract test.
- `src/agent-definitions/document-formats/ADR-FORMAT.md` — keep the existing concise ADR philosophy and decision
  criteria; only status representation becomes mandatory and structured.

## Implementation Steps

- [ ] Update `ADR-FORMAT.md` so every new ADR starts with YAML `status` front matter using only `proposed`, `accepted`,
      `deprecated`, or `superseded`; keep ADR bodies concise and leave supersession relationship fields out of this
      phase.
- [ ] Migrate every current file under `docs/adr/` to `status: accepted` front matter, remove each legacy `## Status`
      section, and preserve all decision content byte-for-byte aside from necessary surrounding whitespace/front matter.
- [ ] Add `src/adr-artifacts.test.js` to recursively validate all repository ADR Markdown, including the
      nested-directory convention supported by `CONTEXT-MAP.md`; assert allowed status values and reject prose Status
      sections.
- [ ] Refactor `guide.md` around an evidence-first project inquiry section that lists every canonical/default artifact
      location, the authority of each source, and how to find context-mapped alternatives.
- [ ] Add explicit Guide workflows for rationale, blocker/state, delivered-change, and current-behavior questions.
      Require intent/outcome separation, targeted corroboration, citation-ready paths/hashes/statuses, and clear
      statements when evidence is absent or conflicting.
- [ ] Encode Plan, Work Record, and ADR state semantics in Guide's prompt so noncurrent/provisional artifacts remain
      usable without being presented as settled rules, successful validation, or completed delivery.
- [ ] Add negative evidence rules: never cite raw Session Transcripts or local workflow metrics as project truth; never
      treat PRDs as delivery/roadmap evidence; never use Memory to override current artifacts; never present uncommitted
      Git diffs as delivered changes.
- [ ] Update Guide's long-session attention nudge in `agents.js` and its exact expectation in `session-prompt.test.js`
      so evidence-first behavior survives extended conversations.
- [ ] Extend `session-tools-policy.test.js` with bounded assertions covering the new Guide contract while preserving all
      existing tool, write, and routing-boundary assertions.
- [ ] Format all changed Markdown/JavaScript, run focused tests, then run full repository CI and repair every failure.

## Verification Plan

- Automated:
  `deno fmt --check src/agent-definitions/guide.md src/agent-definitions/document-formats/ADR-FORMAT.md src/shared/session/agents.js src/shared/session/__tests__/session-tools-policy.test.js src/shared/session/session-prompt.test.js src/adr-artifacts.test.js docs/adr/*.md`
- Automated:
  `deno test -A src/adr-artifacts.test.js src/shared/session/__tests__/session-tools-policy.test.js src/shared/session/session-prompt.test.js`
- Automated: `deno task ci`
- Manual behavioral smoke test when model credentials are available:
  - Ask Guide "Why did we build Work Records?" and confirm it cites PRD material as intent, accepted ADRs if relevant,
    and approved Work Records/current implementation separately rather than claiming the PRD proves delivery.
  - Ask Guide "What is blocked?" and confirm it inspects active Plan lifecycle/dependency/failure/hold evidence, cites
    exact Plan paths and statuses, and does not infer blockers from old Session text.
  - Ask Guide "What changed in Plan review execution selection?" and confirm it prioritizes the approved Work Record,
    verified Plan/current Git history, and current source/tests, with compact citations and any material caveats.
  - Ask about a proposed or superseded fixture ADR/Work Record and confirm Guide surfaces the status rather than stating
    it as a current rule or outcome.
- Expected: Guide answers from the smallest relevant durable evidence set, distinguishes product intent from current
  reality and delivered outcomes, preserves artifact status/notices, and says when no durable evidence supports a claim.
- Expected: every current ADR parses with `status: accepted`; future missing, unknown, duplicate, or prose-only statuses
  fail the repository test.
- Execution policy matrix:
  - FEATURE Plans may omit `executionAgent`; omission defaults to `engineer` for backward compatibility.
  - FEATURE Plans may set `executionAgent: "engineer"` with `collaborationRecommendation: "autonomous"` or omitted.
    `pair` is invalid for Engineer-owned execution.
  - FEATURE Plans may set `executionAgent: "frontend-engineer"` with `collaborationRecommendation: "autonomous"` or
    `"pair"`.
  - Use `frontend-engineer` for browser-rendered UI work whose primary outcome is materially visual or interactive;
    otherwise use `engineer` (including TUI work and incidental frontend-file edits).
  - Recommend `pair` only when live visual judgment is valuable; use `autonomous` otherwise. Include known dev-server
    hints and exact headed-browser checks. Real-browser verification is mandatory for Frontend Engineer unless
    externally blocked.
  - PROJECT Epics are non-executable containers and must not define `executionAgent` or `collaborationRecommendation`;
    execution policy belongs only on child FEATURE Plans.
  - Legacy `frontend: true` on FEATURE Plans is still accepted as Frontend Engineer/autonomous compatibility metadata,
    but new Plans should use canonical `executionAgent` / `collaborationRecommendation` instead. Legacy
    `frontend: false` remains Engineer compatibility metadata and is distinct from an absent canonical owner.

## Edge Cases & Considerations

- The bundled Guide runs in Projects that may not use RunWield's default directories. Treat the artifact map as
  canonical RunWield conventions, but inspect `CONTEXT-MAP.md` and repository-local structure before claiming an
  artifact is absent.
- A missing or unknown ADR status in another Project is not automatically accepted. Guide may cite it as an unclassified
  decision document but must not present it as a current authoritative rule.
- `docs/prd/done/**` remains product intent and historical organization; directory placement does not prove that the
  described behavior shipped or remains current.
- Plan archival is a physical location independent of Plan Status. An archived draft is not completed, and an archived
  `closed_without_verification` Plan is not verified.
- `status: verified` is canonical Plan-declared state in Phase 1. Distinguishing workflow-attested verification from a
  manually edited Plan belongs to the future Project Evidence Graph/verification receipt work.
- Work Record completion modes and notices constrain claims: `done_enough` may leave deferred scope, and
  `closed_without_verification` proves the recorded closure outcome rather than a validation pass.
- Git may be unavailable. Guide should report that commit evidence cannot be checked rather than failing the whole
  answer or treating filesystem timestamps as equivalent.
- Current working-tree/index diffs are useful for "what is changing?" but are not durable delivered-change evidence.
- Conflicting sources should be presented explicitly. Current implementation can diverge from product intent; a newer
  accepted ADR can override an older rule; a superseded Work Record remains historical rather than current guidance.
- Do not expand this phase into a Project Evidence Graph, project-wide artifact parser/index, Team Memory location,
  Session identity/provenance, validation-attempt history, workflow metrics ingestion, or cross-Project search.
- The working tree contains unrelated existing changes, including `CONTEXT.md` and other Plans/UI files. Execution must
  preserve them and limit edits to this Plan's affected paths.
