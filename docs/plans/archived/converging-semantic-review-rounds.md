---
planId: "dac96774-6220-4498-a49a-f1d338cbfe72"
classification: "PLANNED_CHANGE"
complexity: "LARGE"
summary: "Stop the semantic review/repair loop from running forever: always-on review_diff, approval-biased discovery rounds, a mutable finding ledger, verification-only rounds after round 2, a focused reviewer-feedback repair agent in fresh context, and a human-review escape hatch instead of a dead end."
affectedPaths:
    - "src/agent-definitions/workflow-prompts/reviewer-prompt.md"
    - "src/agent-definitions/workflow-prompts/reviewer-verify-prompt.md"
    - "src/shared/session/hosted-session.js"
    - "src/agent-definitions/reviewer-feedback-engineer.md"
    - "src/constants.js"
    - "src/tools/review-complete.js"
    - "src/shared/workflow/validation.js"
    - "src/shared/workflow/review-diff-tool.js"
    - "src/shared/workflow/workflow-results.js"
    - "src/shared/workflow/guided-review.js"
    - "src/shared/workflow/validation-loop-review.test.js"
    - "src/shared/workflow/validation-prompts.test.js"
    - "src/shared/workflow/review-diff-tool.test.js"
    - "src/shared/workflow/review-ledger.ts"
    - "src/shared/session/agents.js"
    - "src/shared/session/session.js"
    - "docs/settings.md"
    - "docs/prd/semantic-code-review-convergence-prd.md"
    - "docs/plan-lifecycle.md"
    - "docs/workflows.md"
    - "docs/user-facing-features.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-27T00:00:00-04:00"
updatedAt: "2026-07-29T15:54:35.212Z"
archivedAt: "2026-07-01"
status: "user_verified"
origin: "internal"
userVerifiedAt: "2026-07-29T15:54:24.973Z"
userVerificationNote: "I worked with Claude code on this outside of RunWield and its now merged and a lot more robust, I think now RunWield will be capable of working on itself for this part."
workRecord:
    status: "generated"
    recordId: "4109b106-9df9-4ac7-b79a-65489f5d289b"
    path: "docs/work-records/2026-07-29-converging-semantic-review-rounds.md"
    lastAttemptAt: "2026-07-29T15:54:25.032Z"
---

# Converging Semantic Review Rounds

## Context

Workflow Validation currently runs a semantic review/repair loop that is unbounded in practice and burns tokens without
converging. The causes are structural, not just prompt wording:

- **Every round rediscovers the implementation from scratch.** The Reviewer correctly runs isolated
  (`src/shared/workflow/validation.js:1897-1911` — no shared session manager, with a comment explaining that it must
  judge only the supplied Plan and diff). But the prompt it receives contains only `planContent` plus the full
  working-tree diff (`validation.js:1855`). No prior findings, no repair claims, no round number. Isolation is right;
  starting from zero knowledge every round is not.
- **Code smells are an unbounded finding class.** Plan-adherence findings come from a finite set — the Plan's
  requirements. reviewer-prompt.md step 7 (speculative generality, duplicated logic, repeated conditionals, shotgun
  surgery, data clumps) scales with diff size, which grows with every repair. Repair code is also the code most likely
  to read as duplicated logic, because it patches around existing structure. Repair enlarges the diff, a fresh Reviewer
  finds a fresh crop of smells, repeat.
- **The reviewer prompt argues with itself and the tie breaks toward rejection.** "Do not nitpick. The code does not
  have to be perfect" sits under ~8 lines of mandatory exhaustive coverage. Producing a finding is a concrete action;
  judging "good enough" is not. The prompt never states an approval default.
- **The repair handoff loses focus.** The semantic repair prompt is a hardcoded two-sentence string
  (`validation.js:2293-2300`) dispatched through `runCompletionGatedRepair` (`validation.js:604-633`), which runs
  `runActiveAgentTurn` on the shared root transcript. The repair instruction lands as one short turn at the tail of the
  entire plan-execution transcript, whose gravity is "follow the Implementation Steps, run the Verification Plan."
  engineer.md defines a "Validation Continuation" input mode, but the dispatched prompt never declares that mode, so
  those instructions are unreachable.
- **Nothing bounds the loop, and exhaustion strands the user.** `MAX_VALIDATION_CYCLES = 3` (`validation.js:1650`), but
  on reaching the cap `validation.js:2321-2341` offers another batch of three and `continue`s; the in-batch counter is
  modulo (`validation.js:1669`) so it resets. The only alternative offered is Stop — which leaves the work with nowhere
  to go.

Secondary defect: reviewer-prompt.md frontmatter declares `review_diff` and prompt lines 30-32/38-39 describe using it,
but `reviewerToolNames` (`validation.js:1828`) omits it and the tool is injected only on the large-diff path.

`docs/prd/semantic-code-review-convergence-prd.md` has been rewritten alongside this plan and is the governing spec.

## Objective

Make the semantic review loop converge by changing what each round is asked to do, giving the repair agent focused fresh
context, and guaranteeing a path forward when automatic rounds run out.

The loop is a narrowing funnel. Discovery gets two passes; then it stops.

1. CI passes.
2. **Round 1 — discovery.** Full review against the whole Plan, approval-biased: the Reviewer blocks only when it can
   name the specific Plan requirement and the specific changed code that diverges from it. Code smells become
   non-blocking advisories. Blocking findings open the ledger.
3. If a round approves at any point, continue to the existing human-review/merge path unchanged.
4. **Repair.** The Reviewer-Feedback Engineer runs in a fresh isolated session, seeded with a bounded packet: the Plan,
   the open ledger items, and diff access. It fixes every open item and reports a per-item disposition.
5. CI reruns.
6. **Round 2 — discovery again, plus verification.** A second full sweep of the Plan, so a requirement overlooked in
   round 1 gets an independent second look — _and_ verification that round 1's ledger items were actually fixed.
7. Repair again in a fresh session; CI reruns.
8. **Round 3 — verification only.** No sweep. Verify open ledger items and inspect the repair delta for regressions.
   This is where the funnel narrows and the loop becomes able to terminate.
9. Repair again in a fresh session; CI reruns.
10. **Choice point.** Offer: run another verification round, or open Human Code Review now. Continuing goes to round 4
    under the verification contract — the round counter and ledger do not reset.
11. **Human Code Review loop.** Human approval is authoritative and merges back even without semantic approval. Human
    feedback routes to the same Reviewer-Feedback Engineer in a fresh session, then loops back to human review.

## Approach

### Always offer `review_diff`; delete the inline/large-diff fork

Remove the `isLargeDiff` branch in `buildSemanticReviewAttempt` (`validation.js:1835-1866`) entirely. Every round gets
`review_diff` as a real tool and no inlined diff. One delivery path, no size threshold to tune.

Two consequences to handle:

- The Reviewer now sees no code unless it calls the tool, so `review_complete` with zero `review_diff` calls is not a
  valid review. It consumes one of the existing bounded continuation attempts with an explicit instruction to inspect
  the diff first.
- `semanticUsedLargeDiffPath` feeds `recommendGuidedReview` (`guided-review.js:97`, consumed at `validation.js:2066`).
  Keep computing diff bytes for that signal even though it no longer branches the prompt.

### Two prompts, not three

Round 1 has an empty ledger, so "verify each open item" is vacuously satisfied. That means **one discovery prompt serves
rounds 1 and 2** — sweep the Plan, and additionally verify any open ledger items — and a second **verification prompt**
serves rounds 3 and above. Both receive the round number. No third prompt is needed.

### Diff scopes

`review_diff` gains a `scope` parameter. `"full"` is the workflow diff from the execution baseline; `"repair"` is the
delta since the last repair dispatch, captured with `captureWorktreeTree`/`diffTrees`
(`src/shared/workflow/git-snapshot.js:111,131`). Round 1 has only the full scope. Every later round has both and needs
both: full for "does anything diverge from the Plan," repair for "did it fix my findings."

**Guided review and Human Code Review always use the full workflow diff from the baseline tree.** The repair scope
exists only for the Reviewer's verification and must never narrow what a human sees.

### A mutable ledger

Round 1's structured result creates the ledger. Later rounds mark items resolved, keep items open, and append new items
with new identities — existing identities are never reused or renumbered. Resolved items stay visible with their
resolution round.

This requires structure the current contract lacks: `review_complete` takes only `approved` + a free-text `feedback`
string (`src/tools/review-complete.js:22-31`). Add an optional structured `findings` array while keeping `feedback` as
the human-readable projection, so validation owns a real ledger object it can render into prompts and count for metrics
without parsing prose.

The repair agent's side stays free text: its `task_completed` report must reference item identities, and that report is
passed verbatim into the next round. Validation parses nothing from it.

### Where the ledger lives

Not in a `runValidationLoop` local. Validation **exits** when it pauses: `pauseForExecutionContinuation`
(`validation.js:1612-1642`) returns `{ kind: "paused" }`, and when the agent later calls `task_completed`,
`agent-handler.js:499` re-enters `runValidationLoop` from scratch with only `planName`, `planContent`, and `triageMeta`
recovered from the workflow record. Every loop local dies on every nudge.

So round number, ledger, and repair baseline tree go on the active execution workflow record via
`hostedSession.setActiveExecutionWorkflow` — the same channel that already carries `validationContinuation` across the
pause. That satisfies "a simple continue restarts with everything as-is" without any disk persistence.

### Reviewer-Feedback Engineer

A new workflow-only agent definition with its own focused prompt, duplicating the general engineering guidelines from
engineer.md (accepted duplication — see Decisions). It runs in a fresh isolated session so the focused instruction is
the whole context rather than a tail append.

**All review-driven repair routes here**: semantic rounds, frontend execution included, and Human Code Review feedback.
Human feedback is scoped, concrete, and attached to a diff — it does not need the execution transcript, only the
feedback verbatim plus annotations, images, and full-diff access.

### Stay with the agent so the user can nudge

The Reviewer is already a live steering target: `runIsolatedAgentSession` pushes its session onto the steering stack
(`src/shared/session/session.js:2646`), so a user can nudge it mid-run today. Two gaps remain.

**Continuation attempts throw away the reviewer's own work.** Each of the three attempts builds a fresh in-memory
SessionManager (`validation.js:1907-1911`), so a Reviewer that finished its analysis but forgot to call
`review_complete` gets restarted from zero rather than nudged. That is the common failure for smaller models, and
restarting both costs a full review and can forget again. Continuation must resume the _same_ reviewer session with a
short "call `review_complete` now" nudge.

This does not weaken isolation. The isolation rationale in that comment is about excluding the _workflow's_ conversation
history from the Reviewer, not about discarding the Reviewer's own prior turn. Keeping its own session across attempts
preserves the former while fixing the latter.

**Exhaustion hard-halts.** `validation.js:1929-1943` sets `haltReason` and breaks. It becomes a pause that keeps the
Reviewer session alive and current as the steering target, with round and ledger preserved, so the user can nudge it by
hand exactly as they can mid-run. Repair-agent stalls keep today's `pauseForExecutionContinuation` behavior, which
already leaves the user with the agent.

## Decisions

1. **Accepted duplication over a shared skill file.** Skills load at model discretion (engineer.md step 3: "Review the
   available skill metadata"), which is wrong for guidelines that must be guaranteed present during a repair. Agent
   definitions have no include mechanism — `src/constants.js:184-202` resolves flat `.md` files. Duplicate the
   Zero-Trust Implementation Protocol, the verification-honesty rules, and no-rogue-commits into the new prompt.
2. **Code smells are demoted to non-blocking advisories, not rebalanced.** Making an exhaustive smell mandate coexist
   with an approval default is what produced the current contradiction. Advisories preserve the signal without feeding
   the ratchet.
3. **Two discovery rounds, then narrow.** Rounds 1 and 2 both sweep the whole Plan; round 3+ verifies only. Two sweeps
   buy back most of the "round 1 missed it" gap, and narrowing at round 3 is what lets the loop terminate. A second full
   sweep is far less dangerous than it is today specifically because Decision 2 makes smells advisory — with the
   unbounded finding class removed, round 2 can only append plan-adherence, correctness, regression, or security
   findings, which are a finite set.
4. **The choice point comes after round 3's repair, and offers a human escape hatch.** Continuing goes to round 4 under
   the verification contract with the ledger intact. The alternative opens Human Code Review immediately: the human
   approves (authoritative for merge-back even without semantic approval) or gives feedback (routed to the same repair
   agent, then back to human review). This replaces today's Retry/Stop dead end.
5. **Frontend execution loses pair-programming affordances during semantic repair.** `runWorkflowRepair` exposes
   pair-execution context and `createPairCheckpointTool` for `FRONTEND_ENGINEER` (`validation.js:1589-1599`,
   `validation.js:617-619`). Semantic repair is about correctness and plan completeness, not style and product taste, so
   all semantic repair routes to the Reviewer-Feedback Engineer regardless of execution agent. Pair affordances remain
   on the implementation and human-feedback paths.
6. **The ledger is in-memory but survives a nudge.** It lives on the active execution workflow record, not a loop local,
   so pause-and-continue loses nothing. It does not survive process loss, which is accepted and out of scope.
7. **Human Code Review feedback repair also runs in a fresh session** with the same agent. Known cost: feedback that
   references earlier conversation ("like we discussed") has no referent in a fresh session. Mitigated by putting the
   feedback verbatim plus annotations, images, and full-diff access in the packet; feedback that still cannot be
   understood warrants escalation rather than a guess.
8. **Never leave the user with a dead end when an agent stalls.** Reviewer continuation resumes the same session with a
   nudge instead of restarting a fresh review, and exhaustion pauses with that session still current rather than
   halting. This is aimed squarely at models that finish the analysis but forget the terminal tool call.

## The Trade-off, Restated

Discovery stops after round 2. If a Plan requirement was never examined in round 1 _or_ round 2, no later round will
look at it: it isn't in the ledger, and unless the repair happened to touch that area it isn't in the repair delta
either. The gap survives to approval.

Today's design would keep looking indefinitely — which is exactly why it never terminates. The two-sweep funnel is the
compromise: a requirement missed once gets a second independent look, and something missed twice is handed to the human
rather than pursued forever.

What makes the residual risk acceptable:

- Missing the same requirement in two independent full sweeps is much less likely than missing it in one.
- Discovery rounds now have one job instead of competing with an exhaustive smell mandate for attention, so each sweep
  should be better than today's.
- The metrics in Step 20 separate "round 2 found what round 1 missed" from "a verification round found a new
  regression." The first number justifies keeping round 2 and tells you whether round 1's prompt needs work; the second
  tells you whether repairs are introducing damage. Both turn invisible failures into tunable ones.
- Human Code Review is the backstop, and the choice point makes it reachable deliberately rather than as a dead end.

The cost paid for the second sweep is tokens: round 2 re-reads the whole Plan against a larger diff. That is the
deliberate purchase — one extra expensive round in exchange for closing most of the coverage gap.

## Sequencing Constraint

`plans/focused-semantic-review-after-human-feedback.md` (status `ready_for_work`, currently dirty in git) refactors the
same review-prompt builder (its Step 4) and adds a third review mode for post-human-feedback repair. The two will
collide in `buildSemanticReviewAttempt` and in `validation-loop-review.test.js`.

Land this plan first: it establishes the round-aware builder shape and the always-on `review_diff` delivery that the
human-feedback focused mode should reuse. Decision 4's escape hatch also feeds directly into that plan's repair path, so
the two designs converge rather than duplicate.

## Files to Modify

- `src/agent-definitions/workflow-prompts/reviewer-prompt.md` — rewrite as the discovery review (rounds 1-2).
- `src/agent-definitions/workflow-prompts/reviewer-verify-prompt.md` — new. Verification review (rounds 3+).
- `src/agent-definitions/reviewer-feedback-engineer.md` — new. Focused repair agent.
- `src/constants.js` — add `REVIEWER_FEEDBACK_ENGINEER` to `AGENTS`, documented as workflow-only.
- `src/tools/review-complete.js` — structured `findings` alongside the `feedback` projection.
- `src/shared/workflow/validation.js` — remove the inline fork, round-aware prompt building, ledger state, pre-repair
  tree capture, isolated repair dispatch, report capture, round enforcement and recovery choices, round-tagged metrics.
- `src/shared/workflow/review-diff-tool.js` — scoped diff tool; retire `buildLargeDiffReviewPrompt`.
- `src/shared/workflow/workflow-results.js` — reader returning the `task_completed` report text.
- `src/shared/workflow/guided-review.js` — keep the large-diff signal working from a diff-bytes computation.
- Tests: `validation-loop-review.test.js`, `validation-prompts.test.js`, `review-diff-tool.test.js`, plus new coverage
  for the repair agent dispatch and the recovery choices.
- Docs: `docs/plan-lifecycle.md`, `docs/workflows.md`, `docs/user-facing-features.md`.

## Reuse Opportunities

- `createReviewDiffTool` / `parseDiffFiles` (`review-diff-tool.js`) — bounded list/show with paging already exists.
- `captureWorktreeTree` / `diffTrees` (`git-snapshot.js`) — tree diffs without touching the real index.
- `runIsolatedAgentSession` (`src/shared/session/session.js:2830`) — already used for the Reviewer with
  `includeEditFallback: false`; the repair agent uses the same entry point with edit tools enabled.
- `readLatestReviewOutcome` and `review_complete` — the terminal Reviewer contract stays; only its payload grows.
- The existing `CODE_REVIEW` interaction and human-feedback repair path — reused wholesale for the escape hatch.
- `runWorkflowRepair` / `runCompletionGatedRepair` — retained for CI repair, merge repair, and human-feedback repair.

## Implementation Steps

- [x] Step 1: Add `readLatestTaskCompletedReport(messages, fromIndex)` to `workflow-results.js` returning
      `{ completed: boolean, message: string }` from the `task_completed` toolResult's `details.message`. Leave
      `readLatestTaskCompletedOutcome` intact for existing callers.
- [x] Step 2: Extend `review_complete` with an optional structured `findings` array — per item: a short title, the Plan
      requirement or defect reference, the evidence citation, and (for later rounds) whether it resolves an existing
      identity. Keep `feedback` as the human-readable projection and keep the tool terminal. Fail closed on
      `approved: true` with unresolved findings.
- [x] Step 3: Add a validation-owned ledger structure: create from round 1's findings, assign stable identities, and
      expose apply-round-result, render-open-items-for-prompt, and render-for-repair-packet operations. Never reuse or
      renumber identities; keep resolved items with their resolution round.
- [x] Step 3a: Carry the ledger, the absolute round number, and the current repair baseline tree on the active execution
      workflow record through `hostedSession.setActiveExecutionWorkflow`, alongside the existing
      `validationContinuation` flag, and rehydrate them at the top of `runValidationLoop`. They must not live in loop
      locals: `pauseForExecutionContinuation` (`validation.js:1612-1642`) exits the loop, and `agent-handler.js:499`
      re-enters `runValidationLoop` from scratch afterward, so locals are lost on every nudge. Extend the workflow
      record typedef in `src/shared/session/hosted-session.js` accordingly.
- [x] Step 4: Extend `createReviewDiffTool` to accept `{ full: string, repair?: string }` and add a `scope` parameter
      (default `"full"`) to `list` and `show`. With no repair diff supplied, `scope: "repair"` returns a clear "no
      repair scope in this round" result rather than an error.
- [x] Step 5: In `validation.js`, delete the `isLargeDiff` branch from `buildSemanticReviewAttempt`. Always attach the
      scoped `review_diff` tool, never inline the diff, and add `review_diff` to `reviewerToolNames`.
- [x] Step 6: Reshape the builder into
      `buildSemanticReviewAttempt({ reviewerAgentDef, mode, round, fullDiffText, repairDiffText, ledger, repairReport,
      attempt })`,
      where `mode` is `"discovery"` (rounds 1-2) or `"verify"` (rounds 3+). Load `reviewer-prompt.md` for `"discovery"`
      and `reviewer-verify-prompt.md` for `"verify"`. Preserve the existing continuation-prefix behavior for Reviewer
      execution retries.
- [x] Step 7: Keep computing diff bytes against `REVIEW_INLINE_DIFF_MAX_BYTES` solely to preserve the
      `usedLargeDiffPath` input to `recommendGuidedReview` at `validation.js:2066`. Rename the constant and local to
      reflect that it is now a guided-review size signal, not a delivery threshold.
- [x] Step 8: Treat `review_complete` called with zero `review_diff` calls as an incomplete review: record the reason
      and consume one bounded Reviewer continuation attempt with an explicit instruction to inspect the diff before
      deciding. Never accept the verdict silently.
- [x] Step 9: Rewrite `reviewer-prompt.md` as the discovery review serving rounds 1 and 2:
  - state the approval default explicitly — approve unless you can name the specific Plan requirement and the specific
    changed code that diverges from it;
  - require `review_diff(command: "list")` first, then targeted `show` calls;
  - sweep every material Plan requirement within that approval default;
  - keep plan adherence, correctness, regression, and security as the blocking classes;
  - demote code smells to non-blocking advisories reported alongside an approving decision;
  - keep the existing verification-procedure exclusions (current step 5 and the related Rules) — those are correct;
  - require blocking findings to be emitted as structured items, one concrete defect each, citing the Plan requirement
    and the changed file/hunk;
  - **additionally, when the ledger is non-empty (round 2), independently verify each open item against the code and
    inspect the repair delta.** State that an empty ledger makes this section vacuous, which is what lets one prompt
    serve both discovery rounds;
  - drop the coverage-checklist maximalism that conflicts with the approval default;
  - remove the review-mode selection language now that there is one delivery path.
- [x] Step 10: Write `reviewer-verify-prompt.md` for rounds 3+. It receives the round number, the open and resolved
      ledger items, and the repair report verbatim. It must:
  - independently verify each open item against the code, citing evidence — a repair claim is evidence, never
    resolution;
  - inspect the repair delta (`scope: "repair"`) for new Plan divergences or regressions introduced by the repair;
  - resolve, keep open, or append items, never renumber;
  - not open new code-smell findings and not restart a full Plan-wide sweep;
  - approve only when every ledger item is resolved and the repair introduced no new blocking divergence.
- [x] Step 11: Write `src/agent-definitions/reviewer-feedback-engineer.md`. Its single job is repairing an open ledger.
      It must treat the items as a todo list and address every one; gather its own context via the code tools and
      `review_diff`; respect the Plan as a standing constraint while fixing; verify with the project's CI command; and
      report per-item disposition (fixed with the change described, already satisfied with evidence, or blocked with the
      reason) in `task_completed`. Duplicate from engineer.md: the Zero-Trust Implementation Protocol, the "when errors
      appear, act, not narrate" verification rules, and no-rogue-commits.

      **Deviation from the original step, found in review:** this step also called for `return_to_router` escalation.
      That does not work for a validation-owned isolated session. `resolveEffectiveSessionToolNames`
      (`src/shared/session/session.js:180`) filters the tool out unless `allowReturnToRouter` is set, and the result is
      only ever read from the root conversation (`orchestrator.js`, `agent-handler.js`) — `runValidationLoop` never
      reads it. Wiring it would end the session with no `task_completed`, producing a misleading "stopped without
      task_completed" pause while the handoff is silently dropped. Findings that exceed a focused repair are reported
      as **blocked** instead, which the next Reviewer round verifies and keeps open.
- [x] Step 12: Add `REVIEWER_FEEDBACK_ENGINEER: "reviewer-feedback-engineer"` to `AGENTS` in `src/constants.js` and
      extend the surrounding doc comment to mark it workflow-only, excluded from `/agent` listings and
      `return_to_router` targets.
- [x] Step 13: Add an isolated semantic-repair dispatch that runs the Reviewer-Feedback Engineer via
      `runIsolatedAgentSession` with edit/bash/code tools, seeded with a bounded packet: Plan content, rendered open
      ledger items, round number, execution cwd, and the scoped `review_diff` tool. It must not receive the Engineer
      execution transcript. Read the result with `readLatestTaskCompletedReport` and preserve the existing
      pause-for-continuation behavior when the agent stops without `task_completed`.
- [x] Step 14: Route all semantic repair — `engineer` and `frontend-engineer` alike — through the Step 13 dispatch per
      Decision 5. Leave `runWorkflowRepair` and its pair-execution affordances in place for CI repair and merge repair.
- [x] Step 14a: Route Human Code Review feedback repair through the same Step 13 dispatch per Decision 7, extending the
      packet with the human feedback verbatim, the annotations, and the images that path already collects
      (`validation.js:2206`, `validation.js:2235`). Preserve the existing image-passing behavior.
- [x] Step 15: Capture `captureWorktreeTree(executionCwd)` immediately before every repair dispatch as that round's
      repair baseline, storing it on the workflow record per Step 3a; compute the repair delta with `diffTrees` after CI
      passes on the next pass. If capture fails, halt with a clear reason rather than silently falling back to a
      full-scope round.
- [x] Step 16: Add round state: absolute round number, the ledger, and the last repair report, all carried per Step 3a.
      Rounds 1-2 use `mode: "discovery"`; rounds 3+ use `mode: "verify"`. Replace the modulo counter at
      `validation.js:1669` with absolute round numbering. Reviewer execution continuation attempts stay bounded at 3 and
      are not rounds.
- [x] Step 17: Replace the Retry/Stop prompt at `validation.js:2321-2341` with a choice point reached after round 3's
      repair completes and CI passes:
  - **Run another verification round** — round 4 in `"verify"` mode, ledger and numbering intact;
  - **Open Code Review** — enter the existing `CODE_REVIEW` interaction with the **full** workflow diff. Human approval
    is authoritative and proceeds to merge-back with human review metadata recorded despite no semantic approval; human
    feedback routes to the Step 14a repair dispatch and then reopens human review. The choice point must make clear that
    round 3's repair has not been verified by a Reviewer.
- [x] Step 17a: Ensure guided-review recommendation and the Human Code Review diff both use the full workflow diff from
      the execution baseline, never a repair delta, in every path including the escape hatch.
- [x] Step 18: Make Reviewer continuation attempts resume the same reviewer session instead of building a fresh one.
      Keep the SessionManager across the bounded attempts within a round, and send a short nudge ("you have not called
      `review_complete`; call it now with your decision") rather than the full review prompt again. Keep the Reviewer
      isolated from the workflow's conversation history — that is a separate concern from its own prior turn, and the
      comment at `validation.js:1907-1911` should be updated to say so.
- [x] Step 18a: Convert Reviewer exhaustion (`validation.js:1929-1943`) from `haltReason` to a pause that keeps the
      reviewer session alive and current as the steering target so the user can nudge it by hand, preserves round number
      and ledger on the workflow record, and states which round it is in and what continuing will do.
- [x] Step 19: Tag metrics with `reviewMode` (`"discovery"` / `"verify"`) and absolute `semanticRound` on
      `semantic_review_result`, `repair_dispatched`, and `repair_completed`. Add counts only: open items, items resolved
      this round, items newly appended this round, advisory count, whether approval happened by round 2, how many
      blocking items round 2 appended that round 1 missed, how many a verification round appended, choice-point reached
      count, and which option was chosen. Store no Plan text, finding text, diffs, or report content.
- [x] Step 20: Update `validation-loop-review.test.js`: rounds 1 and 2 use the discovery prompt with `review_diff` and
      no inline diff; round 2 receives the ledger plus the repair report and can resolve one item while appending
      another without renumbering; round 3 uses the verify prompt and does not receive a full-sweep instruction;
      rejection dispatches the Reviewer-Feedback Engineer with the ledger and no execution transcript; approval at any
      round proceeds to the existing human-review path; the choice point appears after round 3's repair and offers both
      options; choosing another round proceeds to round 4 in verify mode; choosing Open Code Review reaches
      `CODE_REVIEW` with the full diff and human approval permits merge-back; a Reviewer that calls `review_complete`
      without inspecting the diff consumes a continuation attempt; a Reviewer that stops without calling
      `review_complete` is nudged in its existing session rather than restarted with the full prompt; Reviewer
      exhaustion pauses with the session current rather than halting.
- [x] Step 21: Add a test proving pause-and-continue preserves state: pause mid-loop at round 2 with a populated ledger,
      re-enter `runValidationLoop` as `agent-handler.js:499` does, and assert the round number, ledger, and repair
      baseline are rehydrated rather than reset to round 1.
- [x] Step 22: Update `validation-prompts.test.js` and `review-diff-tool.test.js` for the scoped tool, the removed
      inline path, and the two prompt files. Update any test asserting the old hardcoded repair string or
      `buildLargeDiffReviewPrompt`. Add coverage for the `review_complete` structured payload including the fail-closed
      case.
- [x] Step 23: Update `docs/plan-lifecycle.md`, `docs/workflows.md`, and `docs/user-facing-features.md` to describe the
      discovery/verification funnel, the Reviewer-Feedback Engineer handling both semantic and human feedback, the
      ledger, and the choice point after round 3.

## Verification Plan

- Automated: `deno test --allow-all src/shared/workflow/validation-loop-review.test.js`
- Automated:
  `deno test --allow-all src/shared/workflow/validation-prompts.test.js src/shared/workflow/review-diff-tool.test.js`
- Automated:
  `deno test --allow-all src/shared/workflow/validation-loop-core.test.js src/shared/workflow/validation-loop-repair.test.js src/shared/workflow/validation-loop-human-review.test.js src/shared/workflow/validation-loop-recovery.test.js src/shared/workflow/validation-loop-delivery.test.js`
- Automated: `deno task ci`
- Manual: run a real PLANNED_CHANGE with a genuine Plan gap.
  - Expected: round 1 rejects with structured findings; the Reviewer-Feedback Engineer reports per-item dispositions;
    round 2 verifies those items and approves.
- Manual: run a PLANNED_CHANGE that is correct on the first attempt.
  - Expected: round 1 approves; code-smell observations appear as advisories, not a rejection.
- Manual: force a rejection in rounds 1 and 2.
  - Expected: round 2 sweeps the Plan again _and_ verifies round 1's items; round 3 verifies only and does not re-derive
    the Plan.
- Manual: force three consecutive rejections, then take each option at the choice point in separate runs.
  - Expected: another verification round proceeds as round 4 with the ledger intact; Open Code Review shows the full
    diff and human approval merges back.
- Manual: at the choice point take Open Code Review and give human feedback rather than approving.
  - Expected: feedback goes to the Reviewer-Feedback Engineer in a fresh session, then human review reopens, without
    re-entering automatic semantic rounds.
- Manual: nudge a stalled Reviewer, and let one exhaust its attempts.
  - Expected: a Reviewer that stops without `review_complete` is nudged in place and completes without redoing the
    review; exhaustion leaves the user in the Reviewer's session with the round and ledger intact.
- Manual: interrupt a repair mid-round so validation pauses, then continue.
  - Expected: validation resumes at the same round with the ledger and repair baseline intact, not at round 1.
- Manual: run a large-diff plan (well over the old 60KB threshold).
  - Expected: the Reviewer inspects via `review_diff` with no inline diff, and guided review is still recommended for
    the large change.

## Edge Cases & Considerations

- The working tree currently has uncommitted changes in `plans/adapt-pi-model-runtime-upgrade.md` and
  `plans/focused-semantic-review-after-human-feedback.md`. Inspect before editing and avoid clobbering in-flight work.
- Approval bias has a real cost: genuine gaps can reach human review. The mitigation is that the plan-adherence bar is
  unchanged — only the unbounded smell class is demoted. Watch escaped defects found by human review, not just approval
  rate.
- A repair producing an empty delta while items remain open should be rejected by the next round as unimplemented, not
  approved for lack of evidence.
- The Reviewer-Feedback Engineer runs in a fresh session and does not know what the original Engineer attempted. The
  bounded packet must be self-sufficient: Plan, ledger, diff access. A finding that genuinely cannot be understood
  without prior context warrants `return_to_router` escalation, not guessing.
- Human approval from the escape hatch merges back without semantic approval. Record the human review decision and the
  fact that semantic review never approved in metrics and human review metadata; do not fabricate a semantic approval.
- Non-Git in-place execution continues to skip semantic review entirely because no diff can be computed.
- Removing the inline path changes what the Reviewer can do when `review_diff` itself fails. Treat a tool failure as a
  Reviewer execution failure inside the existing bounded continuation budget, not as an approval.
- Resuming the same Reviewer session across continuation attempts means a Reviewer that stalled from a full context
  window cannot be fixed by nudging it — the nudge adds tokens to an already-full window. This is rare and the existing
  `/compact`-then-continue path handles it, so no automatic fallback is required; the pause message should just leave
  the user with the session rather than pretending a nudge will work.
- Round 2 costs a second full sweep. If metrics show it rarely finds anything round 1 missed, the cheap follow-up is to
  make round 2 verification-only and drop to a single discovery round.
- Do not write findings, repair claims, or round history into the Plan or Work Records.
