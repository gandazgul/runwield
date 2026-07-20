# Product Requirements Document: Semantic Code Review Convergence

Last updated: 2026-07-19 12:57 EDT

## Objective

Make Semantic Code Review converge on a trustworthy decision within at most two automatic review-and-repair cycles for
an implementation attempt, without lowering the Reviewer approval bar.

RunWield should make the first review comprehensive, make the second review cumulative and independently verified, and
prevent serial discovery in which each cycle forgets prior findings or examines only the latest repair.

## Problem Statement

Recent Workflow Validation runs commonly pass CI on the first attempt but require three or four Semantic Code Review
cycles. Successive Reviewer invocations often discover different Plan-adherence issues instead of identifying the full
set during the first review. Engineer repair handoffs are unstructured, and each isolated Reviewer starts without the
prior requirement coverage, findings, or repair claims.

This behavior creates semantic coverage debt: an implementation may improve after every repair while the workflow still
cannot show that every approved Plan requirement was examined or that previously reported issues were independently
re-verified. More retries increase latency and cost without guaranteeing a more trustworthy result.

The solution is not to weaken the Reviewer, prefer first-pass approval, or hide ambiguity. RunWield needs a temporary,
structured Review Issue Ledger that makes requirement coverage and repair state explicit across two bounded cycles.

## Resolved Assumptions

### Trustworthy Two-Cycle Convergence

- The target is approval within two automatic Semantic Code Review cycles, not approval on the first cycle at any cost.
- The approval standard remains unchanged: every unambiguous approved Plan requirement must be satisfied, and no
  blocking Review Issue may remain open.
- RunWield must not start a third consecutive semantic review-and-repair cycle without explicit user recovery action.
- Reviewer execution failures and existing bounded execution retries are not semantic rejection cycles.
- CI repair attempts and optional human code review retain their existing semantics and are not incorporated into the
  initial ledger.
- If human code review causes implementation changes after semantic approval, the next semantic review starts a new
  bounded semantic attempt because the previously approved implementation is no longer the current implementation.

### Frozen Requirement Set

- Each attempt evaluates the implementation against the frozen Approved Plan requirements supplied to Workflow
  Validation.
- Generated post-validation content is not part of that requirement set.
- The Reviewer may inspect repository context to evaluate behavior, but must not create requirements from unrelated
  code, preferences, or cleanup opportunities.

### Cycle One Is Comprehensive Discovery

- The first Reviewer must build explicit coverage for every material Plan requirement, including named behavior, edge
  cases, verification expectations, and substantive constraints.
- Each requirement must be classified as satisfied, blocked by one or more Review Issues, or ambiguous through one or
  more Review Advisories.
- The Reviewer must report all blocking findings it can identify in the current pass rather than stopping after the
  first defect.
- Inline and large-diff review modes must enforce the same coverage contract.

### Review Issues Are Blocking and Verifiable

- A Review Issue identifies failure to satisfy an unambiguous approved Plan requirement or a substantive correctness,
  maintenance, regression, or plan-completion risk introduced by the implementation.
- Every Review Issue must identify the relevant Plan requirement, explain the mismatch or risk, and cite implementation
  evidence when available.
- Style preferences, formatter concerns, speculative cleanup, and unrelated improvements are not Review Issues.
- Review Issues have stable identities for the duration of the implementation attempt so repair claims and subsequent
  Reviewer decisions can refer to the same finding.

### Engineer Repair Claims Are Evidence, Not Resolution

- The Engineer receives the complete set of open Review Issues in one bounded repair handoff.
- The Engineer must address every issue or explicitly report why an issue remains unresolved.
- The repair completion report must reference each issue and provide concise evidence of the change or verification
  performed.
- Engineer claims do not close Review Issues. Only a later Reviewer can resolve them.

### Cycle Two Re-Verifies and Sweeps Again

- The second Reviewer receives the frozen requirements, current implementation evidence, prior ledger, and Engineer
  repair claims.
- It must independently verify every prior Review Issue rather than accepting the Engineer's claims at face value.
- It must also perform a fresh full requirement sweep so repairs and previously overlooked areas cannot escape review.
- Resolved findings remain visible in the active ledger, while unresolved findings stay open.
- Newly discovered Review Issues are appended rather than replacing prior history.
- Approval is permitted only when all unambiguous requirements are satisfied and every Review Issue is resolved.

### Ambiguity Is Advisory, Not Blocking

- A Review Advisory records genuine ambiguity in the Approved Plan; it is not a way to excuse a clear omission or
  incorrect implementation.
- Each advisory must quote or precisely reference the ambiguous requirement, explain the plausible interpretations,
  identify the interpretation implemented, and state any useful future clarification.
- A reasonable implementation of one valid interpretation may be approved when all unambiguous requirements pass.
- Review Advisories do not dispatch Engineer repair and do not consume another review cycle by themselves.

### Ledger Durability Boundary

- The Review Issue Ledger is temporary validation state for one active implementation attempt.
- It must survive an Engineer repair turn, validation continuation, and recoverable interruption so resumed validation
  does not lose coverage or issue history.
- It remains available when the two-cycle limit stops automatic validation and the user is choosing recovery.
- It is discarded after successful verification or when the attempt is reset, abandoned, or reopened for Plan revision.
- The ledger, resolved findings, and repair history are not appended to the Plan and are not durable Work Record
  content.

### Only Advisories Become Durable

- On successful Workflow Validation, advisories from the final approving semantic review are appended to the Verified
  Plan under `## Post-Validation Review Advisories`.
- The generated section must state that it is post-validation context and is not part of the approved Plan requirements.
- Each advisory records the ambiguous requirement, why it was ambiguous, the implementation interpretation, and an
  optional future clarification.
- If no advisories exist, the section is omitted.
- Writing is idempotent: revalidation replaces or removes the generated section rather than creating duplicates.
- Future Plan evaluation must exclude the generated section from requirement coverage.
- Advisory content becomes canonical only with the same successful merge-back that makes the Plan Verified.

## Product Experience

Most successful implementations should proceed without new user interaction:

1. CI passes.
2. Semantic Review cycle one approves, or reports a comprehensive set of Review Issues.
3. The Engineer repairs all reported issues with evidence.
4. Semantic Review cycle two independently verifies the repairs, repeats full coverage, and approves when the Plan is
   satisfied.

RunWield should present concise progress and outcomes rather than exposing raw internal state by default. A review
result should make clear:

- the current semantic cycle;
- how many requirements were satisfied, blocked, or ambiguous;
- which Review Issues are open, resolved, or newly discovered;
- whether the Engineer supplied evidence for each requested repair;
- and why approval occurred or why explicit recovery is required.

If cycle two still rejects the implementation, RunWield stops automatic semantic cycling, preserves the active ledger,
and asks the user to choose a recovery path. It must not silently grant approval or begin another batch.

## Functional Requirements

### Structured Reviewer Result

- Extend the Reviewer completion contract to return an approval decision, complete requirement coverage, Review Issues,
  and Review Advisories as structured data.
- Reject or fail closed on internally inconsistent results, including approval with open Review Issues or unclassified
  material requirements.
- Preserve a concise text projection for Runtime events, user-facing status, and diagnostics.
- Apply the same result contract to initial invocations and Reviewer execution retries.

### Ledger Coordination

- Create the ledger from the first completed semantic review result.
- Preserve stable Review Issue identity and status across repair and re-review.
- Record Engineer repair claims against the issue identities supplied in the repair handoff.
- Provide cycle two with the complete prior ledger without leaking unrelated Agent Session conversation.
- Distinguish resolved, unresolved, and newly discovered issues in the resulting ledger.
- Preserve active ledger state across supported validation continuation and recovery paths.
- Clear the ledger at the defined attempt boundaries.

### Reviewer Prompt Contract

- Require exhaustive Plan requirement inventory before approval.
- Require evidence-backed classification for every material requirement.
- Require all blocking findings in the current pass, not a single representative finding.
- On cycle two, require independent repair verification plus a fresh full sweep.
- Explicitly distinguish Review Issues from Review Advisories and retain the existing prohibition on style-only or
  out-of-scope feedback.

### Engineer Repair Contract

- Send all open Review Issues together with stable identities and Plan references.
- Require a per-issue repair claim or explicit unresolved explanation in the completion report.
- Tell the Engineer that repair claims are evidence for the Reviewer, not self-approval.
- Keep semantic repair instructions validation-specific; do not weaken the Engineer's broader Plan and verification
  responsibilities.

### Plan Advisory Appendix

- Generate the advisory appendix from only the final approving semantic result.
- Stage it with `validation_passed` in the execution worktree so it becomes canonical only through successful
  merge-back.
- Use an unambiguous managed boundary so the appendix can be replaced and excluded from later requirement extraction.
- Preserve user-authored Plan content outside that managed boundary exactly.
- Do not write blocking issues, resolved issues, repair claims, or Reviewer deliberation into the Plan.

### Cycle Enforcement and Recovery

- Limit consecutive automatic semantic rejection-and-repair cycles to two per semantic attempt.
- After the second rejection, preserve recoverable implementation and ledger state and require explicit user action.
- Do not weaken existing cancellation, failed Reviewer invocation, CI, human review, worktree, or Plan Lifecycle
  behavior.
- A resumed active attempt must continue from its ledger rather than silently restarting cycle one.

### Observability

- Record privacy-safe metrics for semantic cycle number, approval outcome, requirement-state counts, open/resolved/new
  issue counts, advisory count, and whether approval occurred by cycle two.
- Distinguish Reviewer execution retries from semantic rejection cycles.
- Track how often cycle two finds new blocking issues; this is the primary signal of remaining serial-discovery debt.
- Do not add token-budget enforcement or store Plan text, findings, diffs, repair evidence, or other private content in
  metrics.

## Technical Approach

Build the capability around the existing Workflow Validation boundary in `src/shared/workflow/validation.js` and the
terminal `review_complete` contract.

1. Replace free-form Reviewer feedback as the orchestration contract with a structured semantic result while retaining a
   readable feedback projection.
2. Update `src/agent-definitions/workflow-prompts/reviewer-prompt.md` so both inline and exploratory review produce full
   requirement coverage and distinguish Review Issues from Review Advisories.
3. Maintain one validation-owned Review Issue Ledger for the active semantic attempt. Pass only the frozen Plan,
   implementation evidence, ledger, and repair claims into isolated Reviewer invocations.
4. Make the semantic repair handoff carry all open issue identities and retain the Engineer's completion evidence for
   the next Reviewer.
5. Separate the two-cycle semantic limit from CI retries, Reviewer execution retries, and human code-review behavior.
6. At final validation staging, write the managed advisory appendix into the Plan copy that receives
   `validation_passed`; strip that appendix whenever deriving future approved requirements.
7. Extend deterministic workflow, prompt-contract, result-tool, Plan-staging, interruption/resume, and metrics tests to
   cover both review cycles and failure boundaries.

The ledger representation should be internal and replaceable. The durable product contracts are exhaustive coverage,
stable issue identity within an attempt, independent re-verification, bounded automatic cycles, and advisory-only Plan
persistence.

## Success Criteria

- No implementation attempt runs more than two consecutive semantic rejection-and-repair cycles without explicit user
  action.
- Every completed Reviewer result classifies every material frozen Plan requirement.
- Cycle two cannot approve while a prior or newly discovered Review Issue remains open.
- Engineer repair completion includes a claim for every dispatched Review Issue, and missing claims remain visible to
  the Reviewer.
- The rate of eligible implementations approved by cycle two materially improves from the current baseline without an
  increase in defects later found by human review or subsequent validation.
- The rate of new blocking issues first discovered during cycle two declines as the comprehensive cycle-one contract is
  evaluated and refined.
- Ambiguous but reasonably implemented Plans can be approved, with advisories appearing exactly once in the Verified
  Plan and never being treated as requirements.
- Validation interruption and resume preserve the active ledger; successful verification and reset paths clear it.
- Inline and large-diff modes satisfy the same behavioral evaluation scenarios.

## Out of Scope

- Lowering the Semantic Reviewer approval standard.
- Optimizing first-pass approval as an independent goal.
- Parallel or multi-Reviewer orchestration.
- Adaptive elevated or extended review tiers described in `docs/vision/adaptive-extended-semantic-review.md`.
- Token-budget automation or Reviewer cost caps.
- Incorporating CI findings or human code-review findings into the Review Issue Ledger.
- Changing the Approved Plan format or requiring authors to assign requirement identifiers.
- Persisting the full ledger or repair history in Plans, Work Records, or project memory.
- Automatically creating follow-up Plans from Review Advisories.
- Batch approval of Epic children or changes to individual child FEATURE Plan approval.
- Epic child navigation and automatic loading of the next actionable child.

## Dependencies and Sequencing

This PRD should precede adaptive extended review because future review tiers need a reliable coverage and finding ledger
to coordinate multiple Reviewer passes.

Implementation should preserve current `SessionRuntime`, Plan Lifecycle, worktree merge-back, optional human review, and
large-diff inspection contracts. Behavioral evaluation should compare the new prompt and ledger against representative
Plans that previously required three or more semantic cycles, with special attention to cycle-two new-finding rate and
escaped defects rather than approval rate alone.
