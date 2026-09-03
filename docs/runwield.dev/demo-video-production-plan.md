# RunWield Demo Video Production Plan

## Captured story

The replacement source is a single real account-lockout workflow in the disposable `wld_demo` repository:

```text
request
  -> Router
  -> Planner questions
  -> Plannotator Plan Review
  -> review feedback
  -> revised Plan + approval
  -> isolated execution
  -> failed Mechanical Validation
  -> repair
  -> semantic review finding
  -> second repair
  -> Plannotator Guided Code Review
  -> human approval
  -> Work Record + merge
  -> same Session in Workspace
  -> validated Plan Board
```

The source master is intentionally long. Do not shorten it at capture time. The thinking and command activity can be
cut, time-remapped, or sped up later without losing any lifecycle transition.

## Source files

- `demo-media/runwield-complete-demo-source.mp4` — canonical 53:58 source master.
- `demo-media/runwield-full-workflow-source.mp4` — synchronized TUI + both Plannotator reviews.
- `demo-media/source/runwield-tui-full-flow.mp4` — uninterrupted terminal safety master.
- `demo-media/source/runwield-tui-full-flow.cast` — editable terminal event source.
- `demo-media/source/plan-review-feedback-loop-full.mp4` — clean Plan Review select.
- `demo-media/source/code-review-guided-full.mp4` — clean Code Review select.
- `demo-media/source/workspace-same-session-full.mp4` — clean Workspace select.

The old 3:39 overview and its loops are superseded.

## Story-edit priorities

1. Make Plannotator the star. Spend real time on affected-file inspection, the concurrency annotation, Planner's
   revision, the Changes view, and approval.
2. Keep both validation loops. The first proves failed checks trigger repair; the second proves semantic review checks
   the implementation against the Plan instead of merely rerunning tests.
3. Keep Guided Code Review. Show at least the login sequence, state machine, concurrency ordering, direct diff, reviewer
   note, and approval.
4. Make the surface switch unmistakable. Use the `Add Account Lockout Policy` title in both TUI and Workspace, then show
   the same repair result and completed Plan.
5. Use Guide, Ideator, and Operator as a short overview. The Workspace controls are captured; dedicated role sessions
   can be added later only if the edit needs more than a spoken explanation.

## Suggested edit shape

Do not lock duration until the first story edit exists. A useful initial pass is roughly five to seven minutes:

| Section             | Editorial treatment                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Opening and request | Real time; establish the policy change clearly.                                                 |
| Router              | Keep classification and handoff; trim repository inspection.                                    |
| Planner             | Keep the policy questions and answers; accelerate the rest.                                     |
| Plan Review         | Mostly real time. This is the main product proof.                                               |
| Execution           | Montage or 4–8× speed with a few readable implementation milestones.                            |
| Validation          | Real time around each failure, finding, repair handoff, and passing result.                     |
| Code Review         | Keep Guided Review and approval readable; trim generation wait if needed.                       |
| Finalization        | Show Work Record, merge, cleanup, and `on main`.                                                |
| Workspace           | Show the same title, same validation record, role controls, artifact, and validated board card. |

Use hard cuts or short dissolves. The product already provides enough motion; decorative transitions would weaken the
evidence.

## Website cuts

### Plan Review loop

Use the dedicated Plan Review clip. Start with affected files, add the atomic fifth-failure annotation, cut to Planner's
accepted revision, show the Changes view, and end on `Approved & Run`.

Suggested copy: “Review intent before the Agent touches your code.”

### Validation and Code Review loop

Start on the failed validation state, cut to the focused repair, then show the Guided Review concurrency diagram and
human approval.

Suggested copy: “A failed check starts a repair loop. Completion has evidence.”

### Same Session loop

Start on the TUI `on main` state, cut to `Add Account Lockout Policy` in Workspace, reveal the validation repair report,
then end on the validated Plan Board card.

Suggested copy: “Start in the terminal. Continue in Workspace. Keep one durable Session.”

Export WebM and MP4 as the normal website assets. Export one or two GIF fallbacks only after the final crops and loop
points are approved.

## Voice-over and finishing

Record narration after the first story edit. Use `demo-voiceover-script.md` as practice copy, then rewrite it against
the actual cut so every sentence lands on visible evidence. Preserve two seconds of stillness around review annotations,
approval, validation findings, and the final board card.

Add captions from the final narration. Keep the untouched source files until the upload, website loops, posters, and
captions are all published.
