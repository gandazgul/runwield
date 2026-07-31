# Agent prompt architecture — open items

Working notes, not a Plan. Captures the design thread about separating **process** from **shared engineering practice**,
plus the concrete duplication found while tracing it.

```
process 1   process 2   process 3   process 4
     \          \           /           /
      \          \         /           /
        shared engineering practice
```

## 1. Checkpoints for Engineer

Engineer is the only execution persona that cannot check in mid-work. Frontend Engineer already does checkpoint /
stop-and-report / ask-for-review, and nothing about that is visual — it landed there first only because visual work
demanded it soonest.

`collaborationRecommendation: pair | autonomous` already exists in Plan Front Matter, and the Planner is currently told
`pair` is **invalid** for Engineer-owned execution. So the Plan can already express "check in with me" and Engineer is
the one owner that cannot honour it. That is a layering gap, not a missing feature: checkpointing belongs in shared
practice, with the process selecting the default.

## 2. Split process from shared practice

Three engineer-shaped prompts exist today, each standalone, with **no include or composition mechanism**:

| file                                             | lines | Zero-Trust | Rules | Process |
| ------------------------------------------------ | ----- | ---------- | ----- | ------- |
| `engineer.md`                                    | 160   | yes        | yes   | yes     |
| `frontend-engineer.md`                           | 128   | yes        | yes   | yes     |
| `workflow-prompts/reviewer-feedback-engineer.md` | 118   | yes        | yes   | yes     |

The bottom layer is already rotting without anyone having forked it deliberately: while editing the scope language,
**two of three edits did not apply to `frontend-engineer.md`** because its copy had already diverged from `engineer.md`.

`engineer.md` is also a driver with mode branches — the same shape `runValidationLoop` had. Four sections branch on task
type: _Your Inputs_, _Understand the Boundary_, _Confirm Completion_, _Complete_. Two of those branches now carry
**opposite** rules (architecture is authorized under a Plan, escalates under `QUICK_FIX`), which is how the out-of-scope
misfire happened.

Where the line falls:

- **Shared** — true of RunWield engineering regardless of task type: Zero-Trust protocol, verification honesty (no
  "pre-existing" without baseline proof), naming rules, no rogue commits, memory usage, questions as plain text,
  checkpoint/report capability.
- **Process** — changes when task type changes: what defines scope (Plan / checklist / findings list), completion
  criteria and report shape, escalation triggers, whether lifecycle state advances, default collaboration mode.

Test for any rule: _does it change when the task type changes?_

**Build composition before splitting.** Four processes over a copy-pasted core is worse than two.
`ensureBundledAgentDefFile` is the natural seam to assemble `shared-practice.md` + `process-*.md` at bundle time.
Independently verifiable: the prompts should shrink by roughly the size of the duplicated core with no behavior change.

Candidate processes: Planned Change execution · QUICK_FIX · validation/review continuation (already split as
Reviewer-Feedback Engineer) · frontend variants of the above.

## 3. Fold builder-injected instructions back into the Markdown

`buildEngineerRequest` (`src/shared/workflow/workflow-prompts.js:183`) injects instruction text that already exists in
`engineer.md`, so tweaking the Markdown silently leaves a second copy behind:

- `"Execute the following plan step by step."` — duplicates _Understand the Boundary_.
- `"Complete all Implementation Steps and the Verification Plan, then call task_completed with a concise bullet-point
  success or failure report."`
  — duplicates the _Direct Planned Change Plan_ input bullet **and** step 8.
- The `## Runtime Collaboration Style` blocks are runtime-varying, so they are legitimate context — but the `pair` text
  says _"inspect the headed browser before each checkpoint"_, which is frontend-specific and reaches Engineer too.
  Ceremony wording belongs in the process prompt; the builder should pass only which mode is active.

Target: the builder reads the Markdown as-is and adds **only** context that cannot be known at authoring time — plan
text, router handoff, review annotations, active collaboration mode. Same audit needed for the Planner builder.

## 4. Trim what the Plan contributes to the prompt

The body is already clean — `workflow.js:723` passes `planBody: plan.body`, so Front Matter never reaches Engineer
directly. The leak is `buildTriageReport`, which re-injects seven Front Matter fields as prose: routing intent,
classification, work kind, session name, complexity, summary, affected paths.

Decide which of those Engineer actually needs. `summary` and `affectedPaths` plausibly earn their place; `sessionName`
and `routingIntent` look like distraction. Tokens are the smaller win — the larger one is fewer competing statements of
what the task is.

## 5. Checkbox progress — resolved shape

Two problems surfaced with "Engineer ticks Implementation Step boxes":

1. It contradicts the new rule that Engineer never edits the Plan.
2. Implementation Steps live in the Plan **body**, which is the user's half under the ownership split. Engineer writing
   there violates it.

Resolution: progress does not go in the body. It goes in Front Matter (RunWield-owned) — e.g. a completed-step list —
written by RunWield through a tool call, not by Engineer editing the file. Engineer still never edits the Plan, the
user's prose is untouched, and progress becomes durable state that survives compaction and restart.

That is the same fix as making Plan Status drive validation, one layer up: **the agent's progress currently lives in a
volatile context window instead of durable state.**

Guardrail: a ticked box records _"I did this"_, never _"this is proven"_. Completion stays gated on step 7 (Confirm
Completion) and the Verification Plan. Note the first failed split Plan reached `implemented` with **0 of 20** boxes
ticked, so today the box carries no information at all.

## 6. Post-compaction re-anchor

Long refactors drift from the Plan. All three blocking findings in the validation second pass were things the Plan
states explicitly and the engineer lost while deep in code.

The post-compaction message should re-read the Plan **and its Verification Plan** — the seam check that failed was in
the Verification Plan and never ran. Forcing compaction _early_ is the weaker half of the idea: compaction is lossy, and
the value is the re-anchor, not the compaction. Prefer re-anchoring at step boundaries, which is cheap and pairs with
the durable progress record above.

## 7. Completion-report honesty

The first split Plan reported _"responsibility module placeholders"_ — technically true, but it buried the lead: the
split the Plan existed to perform had not happened. Process prompts need an explicit rule that a partial result is
reported as a **failure to complete the step**, not as a qualified success. The scope rewrite added a version of this
for blocked steps; it should also cover steps that were _completed differently_ than specified.

## Testing as the completion signal

Tests are the strongest completion signal available, but only while coverage is real. Two failures this week were
invisible to a green suite: seven `export {}` modules passed five checks, and a validation refactor took the
validation-loop suites from **4,678 lines / 61 tests to 343 lines / 7** while the run stayed green.

Technique stays in `src/skills/write-tests/SKILL.md` — it already covers behavior-over-implementation, not mocking
internal collaborators, not asserting on mock call counts or order, and faking the environment rather than your own
machinery. The prompts add only what is not test-writing technique:

- **Engineer** — loading the test-writing skill is mandatory when a change touches tests; a passing suite is not
  evidence when the tests themselves changed, so report the test-count delta; and every removed or replaced test gets a
  stated disposition (rewritten against the new shape, or deleted because the behavior it protected no longer exists).
- **Planner / plan format** — when the change reshapes code that existing tests cover, the Plan says which behavior must
  still be protected and which is expected to stop existing. Only the Plan knows that difference; left unsaid, a test
  that no longer compiles gets deleted and the suite still passes.

The reviewing lesson is the same in reverse: `git diff --stat main..HEAD -- '*test*'` is the one number a green run
cannot fake. Insertions against deletions, per file.

## Already done (this thread)

- Removed the escalate-on-architecture language from `engineer.md` and `frontend-engineer.md`; the Plan now defines
  scope, and only editing the Plan or doing unrequested work is out of scope.
- Fenced the `QUICK_FIX` architecture escalation so it cannot bleed into Planned Change work.
- Reworded _Follow the Plan_ so implementing Plan-specified architecture is required rather than "improvisation".
- Added the falsifiable-verification requirement to `planner.md` and the plan format, plus steps-as-outcomes.
- Added the testing rules above to `engineer.md`, `planner.md`, and the plan format.

**`frontend-engineer.md` did not receive the testing rules.** It has no _Check Skills_ or _Verify_ process step to hang
them on — its structure is an _Execution Contract_ instead. Forcing them in would mean restructuring it. This is the
drift in item 2 happening again, in real time, and is further reason to build composition before writing more shared
rules by hand.

## Still missing?

Candidates not yet decided:

- A drift check for the shared layer once composition exists — without one, the split rots the same way the copies did.
  Fits the house ratchet pattern.
- Whether Planner needs the same process/practice split (it has the same builder-duplication problem).
- Whether the Verification Plan should be authored by Planner with a required falsifiable check — the missing piece
  behind both failed passes.
