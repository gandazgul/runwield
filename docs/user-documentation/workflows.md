# Plans and Workflows

RunWield sorts each new request by what it needs. Questions get answers, ideas get sharpened, small fixes are made
directly, and larger changes get a Plan you review before any code changes.

## How requests are routed

A new Session starts with the Router Agent. It reads your request, picks one of six routes, and hands the request to the
Agent for that route:

| Route            | When                                                       | Handled by | What happens                                                                               |
| ---------------- | ---------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| `INQUIRY`        | You want an answer, explanation, or guidance.              | Guide      | Guide answers. Ask it to save an answer as a Markdown document if you want to keep it.     |
| `IDEATION`       | You want to explore or sharpen an idea.                    | Ideator    | Ideator interviews you, researches, and can write a PRD.                                   |
| `OPERATION`      | You want a non-code task done, like a commit or a command. | Operator   | Operator does it and checks the result. No Plan.                                           |
| `QUICK_FIX`      | A small, bounded code change.                              | Engineer   | Engineer makes the change, then RunWield runs your checks. No Plan.                        |
| `PLANNED_CHANGE` | A change big enough to need a Plan.                        | Planner    | Planner writes a Plan for you to review. See [Planned changes](#planned-changes).          |
| `PROJECT`        | Large work that needs design and splitting up.             | Architect  | Architect designs an Epic, then splits it into Planned Changes. See [Projects](#projects). |

After the hand-off, that Agent stays active, so follow-up messages keep the same context. To route a new request from
scratch, use `/new` for a fresh Session or `/agent router` to send your next message back through the Router. To skip
routing, talk to an Agent directly: `wld agent engineer "…"` or `/agent engineer`.

When an idea from Ideator is ready to build, send the build request through the Router so it can be planned.

## Quick fixes

Engineer makes the change directly. RunWield then runs your project's verification command (`verification_command` in
[settings](settings.md)). If the checks fail, a fresh Engineer Session fixes them and the checks run again, up to three
times. Quick fixes have no Plan, no AI review, and no separate worktree.

## Planned changes

1. **Planner writes a Plan.** Plans are Markdown files under `docs/plans/`.
2. **You review it** in the browser. Approve it, or send feedback and Planner revises it. During review you can choose
   who builds it (Engineer, or Frontend Engineer for browser UI work) and whether to work in **Pair** mode.
3. **Engineer builds it** in a separate Git worktree, so your checkout stays untouched. In Pair mode (terminal only),
   Engineer stops at checkpoints so you can approve each step, ask for changes, switch to autonomous, or stop.
4. **RunWield validates it:**
   - Your verification command runs. Failures go to a fresh Engineer Session to fix, up to three rounds.
   - An AI reviewer compares the change with the Plan. Its findings are fixed and checked again, for a limited number of
     rounds.
   - If you turned on [`codereview`](settings.md#codereview), you review the code yourself before it's merged.
5. **RunWield merges it** into the target branch and marks the Plan verified.

If you change your mind about a requirement while Engineer is working, say so. Engineer records it as a **Plan
Deviation**, and you confirm it before it's saved to the Plan. The AI reviewer then follows your replacement, and the
Work Record lists it.

Work that stops partway through, from a crash, a failed check, or you stopping it, can be continued. Run
`wld load-plan <name>` and RunWield offers what can be done next. See [Plan recovery](#plan-recovery).

## Projects

Large work becomes an **Epic**: a container Plan that holds the design and a list of smaller Planned Changes.

1. Architect writes the Epic design and you review it.
2. After approval, the Slicer talks through how to split the work with you: boundaries, order, dependencies, and what
   can wait.
3. When you confirm, the Slicer writes draft Plans under `docs/plans/<epic-name>/`.
4. RunWield works through those Plans in order. Each one is planned, reviewed, built, and validated like any other
   Planned Change.

After one is verified, RunWield starts the next in a fresh Session automatically. It stops at the first Plan that's on
hold, needs recovery, or depends on a Plan that isn't done. Each verified Plan adds a Manual QA checklist to
`docs/plans/<epic-name>/manual-qa.md`. The checklist is yours to use; it doesn't affect verification.

You can mark an Epic **done enough for now** from `wld load-plan <epic>` when the remaining Plans aren't worth doing.

## Plan statuses

You see a Plan's status in `wld plans` and on the Plan Board.

| Status                        | Meaning                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| `draft`                       | Written but not reviewed yet.                                          |
| `feedback`                    | You sent feedback; the planning Agent is revising it.                  |
| `approved`                    | You approved it; it isn't ready to run yet.                            |
| `ready_for_decomposition`     | An approved Epic, waiting to be split up.                              |
| `ready_for_work`              | Ready to build. For an Epic: its Plans are ready to pick.              |
| `in_progress`                 | Being built.                                                           |
| `failed`                      | The build stopped before finishing. Load the Plan to continue.         |
| `implemented`                 | Built; validation hasn't passed yet.                                   |
| `validated_ci`                | Your checks passed; AI review is next.                                 |
| `validated_reviewer`          | AI review passed; code review and merging are next.                    |
| `validated`                   | Validation passed and the change is being merged.                      |
| `verified`                    | Done: validated and merged. For an Epic: marked done enough.           |
| `user_verified`               | You marked it done yourself, with a note, without RunWield validation. |
| `closed_without_verification` | You closed it without finishing.                                       |
| `on_hold`                     | Paused. Resume it from `wld load-plan` or the Plan Board.              |

To mark a Plan **User Verified**, load it with `wld load-plan` or open it in Workspace and add a note explaining how you
checked it. User Verified Plans count as done for dependencies and Epic progress.

## Working with Plans

```bash
wld plans                          # list active Plans
wld load-plan <name-or-path>       # review, run, continue, or recover a Plan
wld plans read <name>              # open a Plan read-only in the browser
wld plans ui                       # open the Plan Board for this checkout
wld plans archive <name>           # move a finished Plan to docs/plans/archived/
wld plans archive restore <name>   # bring an archived Plan back
wld plans doctor                   # find and repair problems with Plans and worktrees
```

Plans are Markdown with YAML front matter. RunWield manages the front matter; the body is yours to edit with any tool. A
plain Markdown file you put in `docs/plans/` becomes a Plan the first time you load it.

Finished Plans (`verified`, `user_verified`, `closed_without_verification`) can be archived directly. Other statuses
need `--force`, and a Plan whose worktree still holds unfinished work can't be archived until you resolve it.

To share a Plan with reviewers in the browser, see [Self-hosted collaboration](collaboration.md).

## Plan recovery

If work stops partway through, run `wld load-plan <name>`. RunWield checks the Plan, its worktree, and Git, then offers
the safe next steps, such as retrying validation, inspecting the merge target, or abandoning the attempt.

`wld plans doctor` repairs problems it can fix safely. Use `--check` to only report them. It never deletes branches or
folders on its own; those need your explicit choice.

If the Plan file in your checkout was deleted or damaged while its worktree run was active, load it by name
(`wld load-plan <name>`). RunWield restores it from the worktree and backs up the damaged copy under `.wld/recovery/`.

While a worktree run is active, don't edit or commit in that worktree with other tools. A later retry can include those
changes without running the checks again.

Projects without Git work too. Planned Changes run in your current checkout after you agree to it, and Git steps are
skipped.

## Work Records

When a Plan finishes, RunWield writes a Work Record summarizing what was done. See
[Work Records](usage.md#work-records).
