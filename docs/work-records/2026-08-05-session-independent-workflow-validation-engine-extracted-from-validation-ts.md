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
