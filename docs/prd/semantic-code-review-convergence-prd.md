# Product Requirements Document: Semantic Code Review Convergence

Last updated: 2026-07-27

## Objective

Make Semantic Code Review reach a trustworthy decision in a bounded number of rounds, and guarantee that the workflow
always has a way forward when it does not.

RunWield should give discovery two comprehensive passes under an explicit approval default, then narrow: later rounds
verify the repair rather than rediscover the implementation, and unresolved disagreement goes to a human instead of
cycling.

## Problem Statement

Recent Workflow Validation runs commonly pass CI on the first attempt but require three or four Semantic Code Review
cycles, and in the worst case never converge at all. Three mechanisms drive this.

**Serial rediscovery.** Each Reviewer invocation is deliberately isolated and receives only the frozen Plan and the full
working-tree diff. It has no record of what a prior round already raised, what the Engineer claimed to fix, or which
round it is in. Every round is therefore a fresh maximal-effort discovery pass over a diff that has grown since the last
one.

**An unbounded finding class.** Plan-adherence findings are drawn from a finite set — the Plan's requirements. Code
smell findings are not: they scale with the size of the changed code, which grows with every repair. Repair code is also
the code most likely to read as duplicated logic or repeated conditionals, because it patches around existing structure.
The result is a ratchet in which each repair enlarges the surface that the next round can reject.

**A repair handoff that loses focus.** Semantic repair reuses the long-lived Engineer execution context. The repair
instruction arrives as a short turn at the tail of a transcript whose entire gravity is "follow the Implementation
Steps, run the Verification Plan," and by that point the context may already be near exhaustion. The most
correctness-sensitive task in the workflow receives the least attention.

Underneath all three, the Reviewer prompt asks for both exhaustive discovery and restraint without saying which wins.
Producing a finding is a concrete action; judging "good enough" is not, so the tie breaks toward rejection.

The solution is not to weaken plan-adherence review, prefer first-pass approval, or hide ambiguity. RunWield needs an
explicit approval default, a bounded number of discovery passes followed by a narrower job for later rounds, a mutable
Review Issue Ledger that carries findings across rounds, and a human escape hatch when automatic rounds run out.

## Resolved Assumptions

### A Narrowing Funnel of Rounds

- Semantic review proceeds in numbered rounds. Discovery narrows as rounds progress.
- **Rounds one and two are discovery rounds.** Each reviews the implementation against the whole frozen Approved Plan.
  Round two additionally verifies the open ledger from round one.
- **Round three and above are verification rounds.** They verify open ledger items and inspect the repair delta for
  regressions. They do not sweep the Plan again and do not open findings outside that scope.
- Two full sweeps exist so that a requirement overlooked in round one gets a second independent look. Narrowing at round
  three is what makes the loop terminate.
- The plan-adherence approval standard is unchanged: every unambiguous approved Plan requirement must be satisfied, and
  no open blocking Review Issue may remain.
- After round three's repair completes and CI passes, RunWield must not continue automatically. It presents a choice, at
  minimum: run another verification round, or open Human Code Review now.
- Continuing does not reset the round counter or the ledger. Round four follows round three under the verification
  contract.
- Opening Human Code Review is authoritative. Human approval permits merge-back even though semantic review never
  approved; human feedback routes into the human-feedback repair path.
- Human Code Review may receive a repair that no Reviewer round has verified. This is acceptable: human review is a real
  review, and the user chose it.
- Once Human Code Review owns the change, automatic semantic rounds do not resume. Every feedback round reruns CI and
  reopens the review, without limit. The cycle ends only on human approval or on the human exiting the review; the
  automatic round cap counts automatic rounds and never terminates a human-driven one.
- Reviewer execution failures and existing bounded execution retries are not semantic rounds.
- CI repair attempts retain their existing semantics.

### Frozen Requirement Set

- Each attempt evaluates the implementation against the frozen Approved Plan requirements supplied to Workflow
  Validation.
- Generated post-validation content is not part of that requirement set.
- The Reviewer may inspect repository context to evaluate behavior, but must not create requirements from unrelated
  code, preferences, or cleanup opportunities.

### Discovery Rounds Have an Approval Default

- The default posture is approval. The Reviewer may block only when it can name the specific Plan requirement and the
  specific changed code that diverges from it.
- Within that posture, a discovery round must examine every material Plan requirement, including named behavior, edge
  cases, and substantive constraints, and must report all blocking findings it can identify rather than stopping after
  the first defect.
- Findings that cannot be tied to a named Plan requirement, a concrete correctness or regression risk, or a security
  risk are not Review Issues.
- Round two carries the additional obligation to verify each open ledger item from round one against the code. Its sweep
  and its verification are both required; neither substitutes for the other.
- Rounds one and two together own comprehensiveness for the whole attempt. Verification rounds do not re-derive it.

### Review Issues Are Blocking; Code Smells Are Not

- A Review Issue identifies failure to satisfy an unambiguous approved Plan requirement, or a concrete correctness,
  regression, or security defect introduced by the implementation.
- Every Review Issue must identify the relevant Plan requirement or defect, explain the mismatch, and cite
  implementation evidence.
- Code smells — speculative generality, duplicated logic, repeated conditionals, shotgun surgery, data clumps, and
  similar maintainability observations — are reported as non-blocking Review Advisories alongside an otherwise approving
  decision. They are never Review Issues.
- Style preferences, formatter concerns, speculative cleanup, and unrelated improvements are neither.
- Review Issues have stable identities for the duration of the implementation attempt so repair claims and later rounds
  refer to the same finding.

### The Ledger Is Mutable and Carried Across Rounds

- The Review Issue Ledger is created from round one's result and carried forward for the remainder of the attempt.
- Later rounds may resolve open items, keep items open, and append newly discovered items. Appended items receive new
  stable identities; existing identities are never reused or renumbered.
- Resolved items remain visible in the ledger with their resolution round, so the workflow can show what was fixed.
- The ledger, not free-form prose, is what the repair handoff and the next round both consume.

### Fresh Repair Context

- Semantic repair is performed by a dedicated Reviewer-Feedback repair agent in a fresh isolated session, not by
  appending to the Engineer's execution transcript.
- The repair agent receives a bounded packet: its own system prompt, the frozen Approved Plan, the open ledger items,
  the current execution worktree, and bounded diff and repository inspection tools.
- It does not receive the Engineer execution transcript, Planner messages, or Reviewer conversation history.
- It must address every open ledger item and report a per-item disposition — fixed with the change described, already
  satisfied with evidence, or blocked with the reason.
- Repair claims are evidence for the next Reviewer, never resolution. Only a later Reviewer closes a ledger item.
- If the repair agent stops without completing, the existing pause-for-continuation behavior applies.

### Verification Rounds Verify Rather Than Rediscover

- A verification round receives the round number, the open and resolved ledger items, and the repair agent's per-item
  report.
- It must independently verify each open item against the code rather than accepting the repair claim at face value.
- It must inspect the repair delta for new Plan divergences or regressions the repair introduced.
- It must not open new code-smell findings, and must not restart a full Plan-wide sweep.
- It may append new Review Issues when the repair itself introduced a blocking defect.
- Approval requires that every ledger item is resolved and the repair introduced no new blocking divergence.

### Every Repair Runs in Fresh Context

- All repair dispatched from review feedback — semantic rounds and Human Code Review feedback alike — is performed by
  the Reviewer-Feedback repair agent in a fresh isolated session.
- Human Code Review feedback is scoped, concrete, and attached to a diff, so it does not require the execution
  transcript. Its packet must carry the human's feedback verbatim along with any annotations and images, plus full-diff
  access, so nothing the human pointed at is lost.
- The known cost is that feedback referring to earlier conversation ("like we discussed") has no referent in a fresh
  session. Feedback that cannot be understood from the packet warrants escalation rather than a guess.

### Ambiguity Is Advisory, Not Blocking

- A Review Advisory records genuine ambiguity in the Approved Plan or a non-blocking maintainability observation; it is
  not a way to excuse a clear omission or incorrect implementation.
- An ambiguity advisory must reference the ambiguous requirement, explain the plausible interpretations, identify the
  interpretation implemented, and state any useful future clarification.
- A reasonable implementation of one valid interpretation may be approved when all unambiguous requirements pass.
- Review Advisories do not dispatch repair and do not consume a round.

### Ledger Durability Boundary

- The ledger is temporary validation state for one active implementation attempt.
- It lives in memory on the active execution workflow record, not in a validation-loop local, because validation exits
  and is re-entered whenever it pauses. Round number, ledger, and repair baseline must all survive that round trip.
- It therefore survives repair dispatch, every pause-and-nudge, and re-entry into validation. It does not survive
  process loss, which is accepted and out of scope.
- The ledger, resolved findings, and repair history are not appended to the Plan and are not durable Work Record
  content.

### Failures Leave the User With the Agent They Can Nudge

- An agent that stops, errors, or exhausts its bounded attempts must never hard-halt the workflow while recoverable
  state exists. The user must always be left with the stalled agent's own session, able to nudge it.
- A Reviewer that completes its analysis but omits the terminal `review_complete` call must be nudged inside its
  existing session, not restarted with the full review prompt. Restarting discards completed work, costs a second full
  review, and is likely to reproduce the same omission. This failure is common on smaller models and is the primary case
  this requirement exists to serve.
- Reviewer isolation means exclusion of the workflow's conversation history from the Reviewer. It does not mean
  discarding the Reviewer's own prior turn between bounded attempts within a round.
- Reviewer exhaustion pauses with its session alive and current so the user can nudge by hand, with round number and
  ledger preserved.
- Repair-agent stalls keep the existing pause behavior: the session stays with the repair agent, and continuing resumes
  validation with round number and ledger intact.
- Any pause must state which round it is in and what continuing will do.

### Only Advisories Become Durable

- On successful Workflow Validation, advisories from the final approving semantic review are appended to the Verified
  Plan under `## Post-Validation Review Advisories`.
- The generated section must state that it is post-validation context and is not part of the approved Plan requirements.
- Each advisory records the observation or ambiguous requirement, why it was raised, the implementation interpretation
  where applicable, and an optional future clarification.
- If no advisories exist, the section is omitted.
- Writing is idempotent: revalidation replaces or removes the generated section rather than creating duplicates.
- Future Plan evaluation must exclude the generated section from requirement coverage.
- Advisory content becomes canonical only with the same successful merge-back that makes the Plan Verified.

## Product Experience

Most successful implementations should proceed without new user interaction:

1. CI passes.
2. Round one approves, or opens a ledger of Review Issues plus any advisories.
3. The Reviewer-Feedback repair agent fixes every open item in fresh context and reports per-item dispositions.
4. CI reruns.
5. Round two sweeps the Plan again and verifies each open item, then approves.

When round two also rejects, the same repair step runs and round three verifies without sweeping. If round three does
not approve, its repair still runs, and the user then chooses between another verification round and Human Code Review.

RunWield should present concise progress and outcomes rather than raw internal state. A review result should make clear:

- the current round and whether it is a discovery or verification round;
- how many ledger items are open, resolved this round, and newly appended;
- whether the repair agent supplied a disposition for each open item;
- and why approval occurred, or what remains open.

RunWield must never silently approve and must never leave the workflow with no available action.

## Functional Requirements

### Structured Reviewer Result

- Extend the Reviewer completion contract to return an approval decision, structured findings with stable identities and
  status, and Review Advisories, while retaining a concise human-readable feedback projection.
- Reject or fail closed on internally inconsistent results, including approval with open Review Issues.
- Apply the same result contract to round one, later rounds, and Reviewer execution retries.

### Diff Delivery

- The Reviewer never receives an inlined diff. It inspects changes through a bounded read-only diff tool in every round,
  which removes the inline/large-diff fork and its size threshold.
- The diff tool exposes named scopes: the full workflow diff from the execution baseline, and — in later rounds — the
  repair delta since the previous repair dispatch.
- A completion call made without any diff inspection is not a valid review. It consumes a bounded Reviewer continuation
  attempt with an explicit instruction to inspect the diff before deciding.
- Human Code Review and guided-review recommendation always operate on the full workflow diff, never on a repair delta.

### Ledger Coordination

- Create the ledger from round one's structured result.
- Preserve stable identity and status across repair and later rounds; never reuse or renumber identities.
- Provide each later round with open items, resolved items, and the repair agent's report, without leaking unrelated
  Agent Session conversation.
- Distinguish resolved, still-open, and newly appended items in the resulting ledger.
- Clear the ledger at attempt boundaries.

### Reviewer Prompt Contract

- Two prompts, not three. A discovery prompt serves rounds one and two; a verification prompt serves rounds three and
  above. Both receive the round number.
- Discovery prompt: state the approval default explicitly, require examination of every material Plan requirement within
  that default, require all blocking findings in the current pass, require diff inspection before deciding, and — when
  the ledger is non-empty — additionally require independent verification of each open item. An empty ledger makes that
  obligation vacuous, which is what makes one prompt serve both rounds.
- Verification prompt: require independent verification of each open item, require inspection of the repair delta, and
  forbid both new code-smell findings and a full Plan-wide sweep.
- Both: distinguish Review Issues from Review Advisories, and retain the existing exclusions for verification
  procedures, execution evidence, style-only feedback, and out-of-scope suggestions.

### Repair Agent Contract

- Dispatch semantic repair to the Reviewer-Feedback repair agent in a fresh isolated session for every execution agent,
  including frontend execution. Pair-execution affordances are deliberately not carried into semantic repair, which is
  about correctness and plan completeness rather than product taste.
- Dispatch Human Code Review feedback repair to the same agent and the same fresh-session mechanism, with the human's
  feedback, annotations, and images in the packet.
- Send all open ledger items together with their identities and Plan references.
- Require a per-item disposition in the completion report, and capture that report for the next round.
- Tell the repair agent that its claims are evidence for the Reviewer, not self-approval.
- Keep repository and diff evidence inspectable through bounded tools instead of copying an unbounded execution
  transcript or oversized diff into the prompt.
- Preserve escalation: a finding that genuinely requires architectural change returns to the Router rather than being
  guessed at.

### Plan Advisory Appendix

- Generate the advisory appendix from only the final approving semantic result.
- Stage it with `validation_passed` in the execution worktree so it becomes canonical only through successful
  merge-back.
- Use an unambiguous managed boundary so the appendix can be replaced and excluded from later requirement extraction.
- Preserve user-authored Plan content outside that managed boundary exactly.
- Do not write blocking issues, resolved issues, repair claims, or Reviewer deliberation into the Plan.

### Round Enforcement and Recovery

- Run rounds one and two under the discovery contract and round three under the verification contract without asking.
- After round three's repair completes and CI passes, preserve the implementation and ledger and require explicit user
  action, offering at minimum: run another verification round, or open Human Code Review now.
- Human Code Review opened from this point is authoritative for merge-back; its feedback routes into the human-feedback
  repair path.
- Do not weaken existing cancellation, CI, human review, worktree, or Plan Lifecycle behavior. Reviewer invocation
  failure changes from halt to pause per the failure-handling assumption.

### Observability

- Record privacy-safe metrics for round number, review mode, approval outcome, open/resolved/newly-appended item counts,
  advisory count, and whether approval occurred by round two.
- Distinguish Reviewer execution retries from semantic rounds.
- Track how often round two appends a blocking item that round one did not find. This is the primary signal of round one
  under-performing, and the justification for keeping a second discovery round.
- Track how often a verification round appends a new blocking item, which indicates repairs introducing regressions.
- Track how often the round-three choice point is reached and which option the user picks.
- Record the human review cycle count on feedback, approval, and exit results. It is a display and measurement signal
  only; nothing may use it to end the loop.
- Do not add token-budget enforcement or store Plan text, findings, diffs, repair evidence, or other private content in
  metrics.

## Technical Approach

Build the capability around the existing Workflow Validation boundary in `src/shared/workflow/validation.js` and the
terminal `review_complete` contract.

1. Extend `review_complete` with structured findings while retaining a readable feedback projection.
2. Split the Reviewer prompt into a discovery prompt and a verification prompt, both loaded through the existing
   workflow-prompt mechanism and both parameterized by round number.
3. Remove the inline/large-diff fork so every round uses the bounded diff tool, and extend that tool with full and
   repair scopes backed by `captureWorktreeTree`/`diffTrees`.
4. Carry the mutable ledger, round number, and repair baseline on the active execution workflow record so they survive
   validation's pause-and-re-enter lifecycle, and render them into the repair packet and the next round's prompt.
5. Add a dedicated Reviewer-Feedback repair agent definition, dispatched through an isolated session with edit
   capability, and capture its completion report. Route both semantic and human-feedback repair through it.
6. Separate round enforcement from CI retries and Reviewer execution retries, implement the round-three choice point,
   make Reviewer continuation resume its existing session with a nudge, and convert Reviewer exhaustion from halt to
   pause.
7. At final validation staging, write the managed advisory appendix into the Plan copy that receives
   `validation_passed`; strip that appendix whenever deriving future approved requirements.
8. Extend deterministic workflow, prompt-contract, result-tool, diff-tool, Plan-staging, and metrics tests to cover both
   round contracts, the recovery choices, and failure boundaries.

The ledger representation should be internal and replaceable. The durable product contracts are the approval default,
comprehensive round one, stable finding identity within an attempt, independent re-verification in later rounds, bounded
rounds with a human escape hatch, and advisory-only Plan persistence.

## Success Criteria

- No implementation attempt runs more than three automatic rounds without explicit user action.
- The round-three choice point always presents a usable path forward; no workflow is stranded.
- No number of human feedback rounds ends validation on its own; only human approval or exit does.
- No agent stall or bounded-attempt exhaustion hard-halts a workflow whose ledger and round state are recoverable; a
  nudge resumes with nothing lost, in the stalled agent's own session.
- A Reviewer that omits `review_complete` is recovered by a nudge rather than by a repeated full review.
- Discovery rounds report their complete set of blocking findings rather than a representative one.
- A verification round cannot approve while any ledger item remains open.
- Repair completion includes a disposition for every dispatched item, and missing dispositions remain visible to the
  next Reviewer.
- Every semantic repair begins with bounded fresh model context while remaining attached to the same stable user-visible
  Session and Plan workflow.
- The rate of implementations approved by round two materially improves from the current baseline without an increase in
  defects later found by human review.
- The rate of new blocking items first appended in rounds above one declines as the round-one contract is tuned.
- Ambiguous but reasonably implemented Plans can be approved, with advisories appearing exactly once in the Verified
  Plan and never being treated as requirements.
- Code-smell observations reach the user as advisories and never as a rejection.

## Out of Scope

- Weakening the plan-adherence approval standard. Demoting code smells to advisories is a scope change to what is
  blocking, not a reduction of the Plan-adherence bar.
- Optimizing first-pass approval as an independent goal.
- Parallel or multi-Reviewer orchestration.
- Adaptive elevated or extended review tiers described in `docs/vision/adaptive-extended-semantic-review.md`.
- Token-budget automation or Reviewer cost caps.
- Durable checkpointing of the ledger across process loss.
- Incorporating CI findings into the ledger.
- Changing the Approved Plan format or requiring authors to assign requirement identifiers.
- Persisting the full ledger or repair history in Plans, Work Records, or project memory.
- Carrying pair-execution affordances into semantic repair.
- Automatically creating follow-up Plans from Review Advisories.
- Batch approval of Epic children or changes to individual child FEATURE Plan approval.

## Dependencies and Sequencing

This PRD should precede adaptive extended review because future review tiers need a reliable finding ledger to
coordinate multiple Reviewer passes.

`plans/focused-semantic-review-after-human-feedback.md` introduces a third review mode for post-human-feedback repair
and refactors the same review prompt builder. It should be rebased onto the round-aware builder this PRD establishes
rather than introducing a parallel one. The Human Code Review escape hatch defined here feeds directly into that plan's
human-feedback repair path.

Implementation should preserve current `SessionRuntime`, Plan Lifecycle, worktree merge-back, optional human review, and
bounded diff inspection contracts. Behavioral evaluation should compare the new prompts and ledger against
representative Plans that previously required three or more rounds, with attention to the rate of new items appended in
later rounds, repair context utilization, and escaped defects rather than approval rate alone.
