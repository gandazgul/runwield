# Adaptive Extended Semantic Review

Working draft. This note preserves a deferred direction for improving Semantic Code Review breadth without making every
Workflow Validation attempt consume several additional model calls.

## Opportunity

Large, cross-cutting FEATURE Plans can require several Semantic Code Review cycles even when CI passes immediately. A
single Reviewer may find valid but different omissions in successive cycles, forcing repeated full-Plan and full-diff
review. For these Plans, spending an additional focused Reviewer call in the first cycle could reduce total tokens,
latency, and repair churn by producing more complete initial feedback.

The same strategy is wasteful for small or cohesive Plans that would pass one Reviewer call. Extended review should
therefore be earned by expected convergence value, not triggered by diff size alone.

## Possible Direction

Use an escalation ladder:

1. **Standard review:** one Reviewer performs requirement-by-requirement review and records findings in the Review Issue
   Ledger.
2. **Elevated review:** one Reviewer uses higher effort and a more systematic coverage pass; no additional model call.
3. **Extended review:** one complementary Reviewer examines a distinct risk dimension, and both results are consolidated
   into one ledger and one semantic-review decision.

Start with at most one additional Reviewer. Multiple calls should partition responsibility rather than duplicate the
same complete prompt. Potential partitions include Plan-requirement coverage, tests and edge cases, and architectural or
regression risk.

## Recommendation Signals

Signals should represent semantic risk and historical value, including:

- many independent Plan requirements;
- global negative requirements such as removing all legacy behavior;
- migrations or compatibility guarantees;
- concurrency, security, persistence, or lifecycle changes;
- several architectural areas changing together;
- weak or indirect verification evidence;
- similar completed Plans having required several review cycles.

Changed lines and files can contribute context but should not independently justify another model call.

## Token and Cost Principle

Optimize total Reviewer consumption per Verified Plan, not first-cycle thoroughness in isolation. An extended review is
valuable only when its expected savings from avoided later reviews and repairs exceed its additional initial cost.

Evaluation should compare:

- Reviewer tokens and model calls per Verified Plan;
- first-cycle findings and cycle-two newly discovered issues;
- total review cycles and time to verification;
- human-review overturns and escaped defects;
- small-Plan cases where escalation added cost without changing the outcome.

RunWield should disclose when an extra review is recommended, why, and how many additional calls it will make. An early
rollout could ask before strongly recommended extended reviews; automatic budget-aware policy should wait for evidence
that the recommendation reliably reduces total consumption.

## Relationship to the Review Issue Ledger

The Review Issue Ledger is the smaller prerequisite. It makes findings, repairs, and re-verification observable and
provides the data needed to determine whether additional first-cycle review breadth would have prevented later cycles.
Extended review should reuse the same ledger rather than create a competing review artifact.

## Out of Scope for the Initial Ledger Work

- parallel or multi-Reviewer orchestration;
- automatic token-budget policy;
- changing the Semantic Reviewer approval bar;
- majority-vote approval or retry-until-approved behavior;
- counting a hidden pre-review as a pass-rate improvement.

## Open Questions

- Which signals predict cycle-two new findings strongly enough to justify another call?
- Should the initial policy be explicit opt-in, recommendation-and-confirmation, or automatic under a user budget?
- How should requirement partitions retain enough shared context without duplicating the full Plan and diff?
- What minimum reduction in total review consumption should justify automatic escalation?
