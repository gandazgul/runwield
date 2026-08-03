# Splitting `handlePlanRecovery`

`src/cmd/load-plan/plan-recovery-flow.ts` is the one module left above the 1,000-line target, at 1,274. Almost all of it
is a single function: `handlePlanRecovery`, 1,073 lines. This note records what that function does and how to break it
up, because unlike the rest of the load-plan split it is **not** a verbatim move — it needs a real change to how control
flows.

## What it does

It is the "this Plan is in a broken or unfinished state" console. A preamble, then an infinite menu loop:

```
policy gate                    refuse outright if the Plan's execution policy is invalid
refreshRecoveryWorktree()   ─┐ two closures over
recordRecoveryResult()      ─┘ the mutable state below
worktreeContext             ─┐ reassigned by branches
unresolvedRecords           ─┤ replaced by branches
plan.attrs                  ─┘ mutated in place
while (true) {
    recompute menu labels from live worktree + Git probe state
    prompt
    dispatch on the answer
}
```

Every label is recomputed each pass, because an action taken on the previous pass may have changed what is now possible.

## The branches

| Branch           | Lines | Does                                                                                                                              |
| ---------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------- |
| `merge`          |   403 | Manual worktree publication: seal a candidate, stage the Plan into the primary checkout, merge, verify, clean up                  |
| `reset`          |   253 | Three modes — clear stale metadata (non-Git), restore a baseline tree, or delete and recreate the worktree from its recorded base |
| `abandon`        |    73 | Detach the Plan from its generation, optionally deleting the worktree                                                             |
| `settle_records` |    56 | Close lifecycle journal records that can be proven settled                                                                        |
| `continue`       |    49 | Rehydrate the execution workflow and hand back to the engineer                                                                    |
| `validate`       |    35 | Re-run Workflow Validation against the recorded context                                                                           |
| `user_verify`    |    22 | Mark the Plan user-verified                                                                                                       |
| `review`         |    19 | Reopen the Plan for review                                                                                                        |
| `inspect`        |     7 | Print the recovery report                                                                                                         |
| `hold`           |     6 | Put the Plan on hold                                                                                                              |

## Why this one is harder

**Shared mutable state.** Branches reassign `worktreeContext` and `unresolvedRecords` and mutate `plan.attrs`. Closure
variables stop being visible the moment a branch moves to another file.

**Loop control is the return value.** Branches use `continue` to return to the menu and `return "handled"` to exit.
Extracted, both have to become data the caller acts on.

**Not every `continue`/`return` belongs to the branch.** In `merge`, 8 of 12 are branch-level; the `return` at line 974
is inside a rollback callback and the one at 1064 is inside a transaction's `apply`. Converting those would quietly
change what the transaction does. Column depth is the tell — a regex pass over the text gets this wrong.

## The contract

```ts
type RecoveryActionOutcome =
    | { kind: "menu" } // was `continue`
    | { kind: "handled" } // was `return "handled"`
    | { kind: "review" }; // was `return "review"`

interface RecoveryActionContext {
    plan: RecoveryFlowPlan;
    projectRoot: string;
    uiAPI: UiAPI;
    session: PlanSessionSurface;
    worktreeContext: RecoveryWorktreeContext | null; // mutable: branches assign to it
    unresolvedRecords: UnresolvedTransitionRecord[]; // mutable
    refreshRecoveryWorktree(): Promise<RecoveryWorktreeContext | null>;
    recordRecoveryResult(action: string, result: string, details?: Record<string, unknown>): Promise<void>;
    // plus the capabilities each action needs, named individually rather than passed as a bag
}
```

Putting the two mutable variables on the context is the mechanical translation of the closure: assignment stays visible
to the loop, and what each branch actually needs becomes explicit in its signature instead of ambient.

## Target modules

| File                                                     | ~Lines |
| -------------------------------------------------------- | -----: |
| `plan-recovery-flow.ts` — labels, prompt, dispatch, loop |    290 |
| `plan-recovery-merge.ts`                                 |    420 |
| `plan-recovery-reset.ts`                                 |    270 |
| `plan-recovery-actions.ts` — the seven small branches    |    250 |

## Order

Small branches first — `hold`, `inspect`, `user_verify`, `review`. They exercise the context/outcome contract at low
stakes and prove it before anything destructive moves. Then `settle_records`, `continue`, `validate`, `abandon`. Then
`reset`. **`merge` last, on its own**, because it is the most destructive path and carries the nested-closure hazard.

## Guard to add along the way

After each extraction, assert that no bare `continue` survives in the moved code and that every path returns an outcome.
A missed `continue` does not crash — it falls through to the next branch's `if`, so the user picks "hold" and gets a
merge. Nothing in the current tests would catch that.
