---
kind: "work_record"
recordId: "23132ec9-d776-4762-94c4-971c940f64c4"
status: "approved"
scope: "planned_change"
workKind: "REFACTOR"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-05T04:29:06.200Z"
provenance:
    sourcePlans:
        - "4a63fb51-d786-4e68-8772-2cbb4e928198"
---

# Session-independent Workflow Validation engine extracted from validation.ts

## Summary

Extracted Workflow Validation sequencing, convergence policy, and gate predicates from the 2,482-line
src/shared/workflow/validation.ts monolith into a session-independent engine, the hard prerequisite for Attached Mode
(ADR-014). Thirteen new TypeScript modules were added; validation.ts shrank to a 125-line public composition root that
preserves every prior runtime export and the exact runValidationLoop / runValidationPhase argument shape, so
orchestrator.ts, epic-continuation.ts, and validation-test-helpers.js import unchanged (verified by export diff against
the pre-refactor HEAD). The 11 engine modules (ports, types, engine, context, mechanical, semantic, human-review,
publication, merge-repair, emit, interactions) import neither @earendil-works nor ../session; all Pi/session coupling is
confined to validation-session-adapter.ts, which implements the engine-owned ValidationSessionPort (workflow state,
position/progress, interactions, completion-gated turns, isolated reviewer sessions via opaque handles, display names,
handoffs) over the real HostedSession machinery and translates to the pre-existing IsolatedAgentSessionOptions shape, so
injected semanticReviewPort fixtures behave exactly as before. Stale duplicate diff-scope helpers were deleted from
validation.ts in favor of the canonical validation-scope.ts implementations, and unaccountedOpenItems moved to
review-ledger.ts with the re-export chain preserved. This gives the future AttachedWorkflowCoordinator one shared engine
to drive instead of a second validation implementation. All four Objective Checks pass (entry and every validation*.ts
under 1000 lines, engine modules session-import-free, engine owns the substantive loop body with no phase
implementations left in the entry); deno task check green (563 files), seams:check green at the unchanged 0-seam
baseline, the 20-file verification suite green (140 tests), full deno task ci green (247 files), and no .wld
lock/journal artifacts appeared under the checkout after loop runs. Behavior preservation is covered by the unchanged
suites: CI/Objective-Check repair gating with 3-round limits, semantic discovery/verify rounds with ledger convergence
and changes_requested re-entry, human review modes/pauses/metadata, publication transaction with merge
repair/settlement/handoffs, position memory, status healing, progress seeding/panel, and metrics. No tests were added or
deleted.

## Deviations from Plan

Two additive, behavior-preserving implementation adjustments: validation-lifecycle-source.test.js was rewritten in place
(same 3 tests and assertions) so the dispatcher and publication-transaction tests extract source from
validation-engine.ts / validation-publication.ts — required because OC4 forbids defining async function
runPublicationPhase in the entry, which the old test demanded there; and validation-progress.ts gained one additive
export (setCurrentValidationProgress) so the adapter can honestly implement the port's setCurrentProgress method. The
Plan's no-injection-seam, no-caller-churn, and behavior-preservation guarantees held.

## Deferred Work

The Attached Mode Claude FEATURE Preview Epic (plans/attached-mode-claude-feature-preview.md) can now proceed: its
coordinator must import the engine modules directly and implement ValidationSessionPort from its own record. Durable
session-independent position/progress variants for the Attached coordinator remain Epic scope — the Core Session path
still keys position/progress to HostedSession through the adapter.

## Future Planning Notes

Reusable lessons for large module extractions: (1) the capability-port ownership heuristic held — agent turns and user
interactions became ports while Plan Lifecycle, transitions, registry, and locks stayed direct engine imports, keeping
the seam ratchet at zero; (2) Objective Checks that grep for defined function bodies (not re-export shims) plus a
durable architecture-boundary whitelist rule (only the seven named validation*.ts modules may import Pi/session) block
rename-and-shim counterfeits and are enforced by CI both before and after; (3) typed port outcomes (AgentTurnOutcome,
IsolatedAgentSessionOutcome) keep raw Pi message inspection in the session-coupled adapter, giving the Attached runtime
a clean semantic contract to implement; (4) zero caller churn is achievable by keeping the public entry's argument shape
and re-export chain intact and verifying it with a git export diff; (5) for behavior-preserving structural extractions,
the existing suites can serve as the behavioral verification — no new tests were required, only in-place source-location
updates where Objective Checks moved bodies across modules.

## Execution Report

Session-independent validation engine extraction complete. All 11 Implementation Steps, all 4 Objective Checks, and the
full Verification Plan pass.

**Implementation**

- `validation.ts` shrunk from 2,482 → 125 lines: public composition root only. Every prior runtime export preserved (10
  validation-helpers re-exports, `SYSTEM_SEMANTIC_REVIEW_PORT`, `SemanticReviewPort`, `WorkflowValidationResult`,
  `runMechanicalValidation`, `runValidationLoop`, `runValidationPhase`); `runValidationLoop`/`runValidationPhase` keep
  the old `hostedSession`/`sessionManager?`/`semanticReviewPort`/`git`/`localCI`/`workRecordMnemosynePort` shape,
  verified by `git show HEAD` export diff and unchanged imports in `orchestrator.ts`, `epic-continuation.ts`,
  `agent-handler.ts`, `validation-test-helpers.js`.
- 13 new `.ts` modules: `validation-ports.ts` (287), `validation-types.ts` (152), `validation-engine.ts` (226),
  `validation-context.ts` (239), `validation-mechanical.ts` (402), `validation-semantic.ts` (548),
  `validation-human-review.ts` (242), `validation-publication.ts` (418), `validation-merge-repair.ts` (179),
  `validation-emit.ts` (213), `validation-interactions.ts` (46), `validation-session-adapter.ts`, all under 1000 lines
  (OC1/OC2 green).
- `validation-session-adapter.ts` is the only new session/Pi-coupled module: implements every `ValidationSessionPort`
  method (workflow state, position, progress, interactions, abort registration, completion-gated turns with
  claim/acknowledge, isolated sessions with opaque-handle casts, display names, handoffs) and translates engine requests
  to the pre-existing `IsolatedAgentSessionOptions` shape, converting returned Pi messages with
  `readLatestReviewOutcome`/`readLatestTaskCompletedReport`/`usedReviewDiffTool`/`hasTrustedClaudeMcpReview` — injected
  `semanticReviewPort` fixtures behave exactly as before (review-loop tests pass).
- Stale diff-scope helpers deleted from `validation.ts`; engine imports canonical `validation-scope.ts` versions;
  `unaccountedOpenItems` moved to `review-ledger.ts` with `validation-helpers.ts` re-exporting it; the `validation.ts`
  re-export chain resolves.
- No injection seams added: `deno task seams:check` green against unchanged baseline (0 seams); the port is a plain
  required engine argument; engine's `localCI` port takes only `{ cwd }` with the real HostedSession bound at the
  composition root.
- `architecture-boundary.test.ts` lists the 6 new engine modules in `HIGH_LEVEL_FILES`;
  `session/architecture-boundary.test.js` gains the durable whitelist rule (only `validation.ts`,
  `validation-session-adapter.ts`, `validation-helpers.ts`, `validation-local-ci.ts`, `validation-position.ts`,
  `validation-progress.ts`, `validation-prompts.ts` may import `@earendil-works`/`../session/`) — passes green.
  `CONTEXT.md` glossary names the session-independent engine without claiming Attached behavior.

**Objective Checks** — OC1 (125 < 1000) ✓, OC2 (all `validation*.ts` < 1000) ✓, OC3 (11 engine modules exist, none
import Pi/session) ✓, OC4 (engine owns `export async function runValidationLoop` + `MAX_PHASES_PER_CALL`; adapter real;
entry imports `./validation-engine`; no phase impl defined in `validation.ts`) ✓.

**Verification**

- `deno task check` green (563 files); `deno task language-policy:check` green; `deno task seams:check` green;
  `deno task lint` clean.
- Full verification-suite test list (20 files incl. both architecture boundaries): 140 passed, 0 failed.
- `deno task ci` full run: green — 247 files passed, 0 failed (submodules, type-check, workspace check, lint, language
  policy, seams, doc-links, tests).
- Manual: no `.wld/` lock/journal artifacts under the checkout after validation-loop runs (only the pre-existing tracked
  `settings.json`).
- Behavior preservation covered by the unchanged suites: CI/Objective-Check repair gating and 3-round limits, semantic
  discovery/verify rounds + ledger nudges + round-limit decision + `changes_requested` re-entry, human-review
  modes/pauses/metadata, publication transaction/merge repair/settlement/handoffs, position memory, status healing,
  progress seeding/panel, metrics.

**Test-count delta** — no tests deleted or added. `validation-lifecycle-source.test.js` was rewritten in place (same 3
tests and assertions): the dispatcher and publication-transaction tests now extract source from `validation-engine.ts` /
`validation-publication.ts` — required because OC4 forbids `async function runPublicationPhase` in the entry, which the
old test demanded there. `validation-progress.ts` gained one additive export (`setCurrentValidationProgress`) so the
adapter can honestly implement the port's `setCurrentProgress` method; no behavior change.
