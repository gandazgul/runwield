# Product Requirements Document: Post-Verification QA Policy

Date: 2026-08-30 (revised 2026-09-02)

## Objective

Give each RunWield Project explicit control over post-verification QA while preserving today's behavior by default.
RunWield must support no QA, today's generated human checklist, interactive Agent-executed QA, or a per-run choice.

Automated QA must use the fresh-context Tester to execute all feasible Plan procedures and a bounded set of additional
behavioral and adversarial checks. It must produce reviewable evidence, route observed defects through one controlled
repair, and leave only genuinely human procedures for the user.

To do this, Tester must be able to reach and exercise the real product. RunWield records how to do that in a durable,
tracked **QA Environment Profile** so each Project pays the discovery cost once.

## Problem Statement

RunWield currently generates a Manual QA checklist automatically after successful QUICK_FIX Mechanical Validation and
successful standalone Planned Change validation. For Epic children, it writes advisory checklist sections to the Epic's
`manual-qa.md` artifact. This behavior has no setting.

The current checklist does not execute the procedures. It cannot show which behaviors passed, which failed, or why an
Agent could not perform a check. It also cannot return evidence-backed defects to Engineer without starting an unrelated
workflow.

Teams need different cost and confidence policies:

- some do not want post-verification QA;
- some want today's short human checklist;
- some want Tester to exercise the delivered product;
- some want to choose per run, especially for QUICK_FIX work where a full Tester turn can cost more than the change.

## Product Principles

- **Independent verification:** Tester reports findings and never repairs its own findings in this workflow.
- **Evidence before claims:** RunWield distinguishes executed proof, remaining human judgment, and untested repairs.
- **Visible collaboration:** automated QA is an interactive Agent phase, not a hidden background model call.
- **Bounded repair:** an automated QA run can cause at most one implementation repair.
- **User control over cost and risk:** destructive or costly procedures require explicit approval. Repeated QA also
  requires an informed user choice.
- **Compatibility by default:** Projects that do not configure this feature continue to receive today's Manual QA
  behavior.
- **Record only what worked:** the QA Environment Profile holds setup steps Tester used successfully, never steps it
  guessed from source.

## Resolved Assumptions

### Post-Verification QA Policy

Add one global-and-project policy object. Project values take precedence over global values by the established settings
rules.

```jsonc
{
    "postVerificationQa": {
        "plannedChanges": "automated",
        "quickFixes": "ask"
    }
}
```

Both scopes support these values:

- `none`: do not generate or execute post-verification QA.
- `manual`: preserve today's generated human checklist behavior.
- `automated`: activate Tester and execute QA.
- `ask`: explain the likely cost and ask the user to select automated QA, a manual checklist, or no QA for this run.

The default is `manual` for both Planned Changes and QUICK_FIX work. Missing or invalid configuration uses the safe,
compatible default rather than silently enabling Agent execution.

This policy is separate from the existing **QA Intervention Policy**. Post-Verification QA Policy controls whether and
how QA runs. QA Intervention Policy controls whether a manually selected Tester may report, add regression tests, or fix
defects. Workflow-dispatched post-verification Tester always has report-only authority.

Note that QA Intervention Policy exists today only as prose in the Tester Agent definition. No setting reads it. This
PRD does not make it configurable.

### `manual` and `automated` are different positions in the flow

These two values are not the same step with a different actor. They run at different places, and the implementation must
keep both positions.

```text
today
  mechanical validation   (status: implemented)
  semantic review         (status: validated_ci)
  delivery                (status: validated_reviewer)
      human code review
      publication attempt
          artifact_preparation   <- `manual` checklist and Work Record generated here,
                                    inside the execution worktree, after human review
          candidate_sealing      <- commits them
          merge / push

with `automated`
  mechanical validation
  semantic review
  delivery
      automated Tester QA        <- new, before human code review
      human code review
      publication attempt
          artifact_preparation
          candidate_sealing
          merge / push
```

`manual` keeps its current position at `artifact_preparation`. `automated` runs earlier, before optional Human Code
Review, so a QA repair cannot invalidate a human approval that already happened.

### QA scope

For a Planned Change, Tester receives the approved Plan, implementation details, relevant diff and validation evidence,
the QA Environment Profile when one exists, and applicable Project conventions and memories.

Tester must:

1. execute every feasible procedure declared in the Plan's Manual verification section;
2. add a bounded set of high-value behavioral, regression, and adversarial procedures based on the implementation,
   Project conventions, and memories;
3. use the public interface that fits the Project, such as a headed browser, browser developer tools, API client, or
   CLI;
4. record actions and observed evidence rather than claim a result from source inspection alone.

For QUICK_FIX work, no Plan exists. Tester derives a small QA scope from the original request, Engineer completion
report, implementation diff, Project conventions, and memories.

**On cost:** "bounded" is Tester's judgment, not an enforced limit. A hard budget would have to know which actions are
expensive in this Project, and that answer differs for every Project. The QA Environment Profile is where a Project
records its own answer, through fakes, staging accounts, and sandbox keys. Until a Project records that, cost control
comes from the approval rule below and from `ask` for QUICK_FIX work.

### QA Environment Profile

Tester runs QA in the execution worktree. A fresh worktree has tracked files and nothing else: no installed
dependencies, no local environment file, no database, no built assets. Tester cannot exercise the product without
knowing how to reach it.

RunWield records this in one tracked Markdown document at `docs/qa-environment.md`. It follows the same discipline as
`docs/domain-language.md`: it states what is currently true, never what somebody hopes is true.

The profile holds:

| Section                  | Content                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------ |
| How to reach the product | the local start command, or a staging/dev URL for a web app or API                   |
| Preconditions            | seeded data, migrations, required services                                           |
| Identity                 | which test account, and the environment variable holding the secret, never the value |
| What is destructive here | the Project's own answer: fakes, staging, sandbox keys                               |
| Standing approvals       | actions the user approved as safe, each scoped to the stated environment             |
| Out of bounds            | never touch production, never send real mail, and similar hard limits                |

**The recording rule is the load-bearing part.** Tester writes a step only after it used that step successfully. It does
not write a start command it inferred from a package manifest. This rule is what stops the document from decaying into
the usual stale "how to run this locally" file.

The profile is created lazily on the first automated QA run that needs it. `wld init` does not ask for it. A Project
that never turns on automated QA never sees this document.

Tester's loop is:

```text
read profile
  usable?   -> use it; if a step was wrong, report the drift
  missing?  -> ask the user how to reach the product, try it,
               and propose writing down what actually worked
  cannot?   -> convert the procedures to human procedures and say so in the report
```

Tester proposes profile content. The user approves it. RunWield writes the file, the same way RunWield writes the Work
Record. Tester never writes into the repository itself.

#### Where the profile write lands

| Situation                                                                                  | Write target                              | Why                                                          |
| ------------------------------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------ |
| Profile is missing, or missing a step Tester had to discover                               | primary checkout, on approval             | the discovery is true whether or not this Plan lands         |
| This Plan changed how to run the app, such as a renamed dev task or a new required service | execution worktree, ships with the change | it only becomes true when the Plan lands                     |
| Profile is wrong for reasons unrelated to this Plan                                        | nowhere; reported as drift                | a branch that may not land must not rewrite shared knowledge |

The first row writes during QA, immediately after approval, not at `artifact_preparation`. The whole point of the
profile is that discovery is expensive and should be paid once. Deferring the write to publication would make it
conditional on an outcome that has nothing to do with whether the discovery was correct.

Accepted limits:

- A primary-checkout write lands as an untracked file. The user commits it as usual. If it is lost, the next run
  rediscovers and re-proposes. That is annoying, not lossy.
- QUICK_FIX work has no worktree, so both write cases collapse to the primary checkout.
- If the user declines the write, Tester rediscovers the setup next run, and the report states that the profile was
  declined.

### Risk and cost approval

Tester can execute local, reversible, Project-scoped QA without an additional approval.

Before a destructive or materially costly procedure, RunWield must explain:

- the exact action;
- the environment or resource it affects;
- the destructive effect or likely cost;
- the expected observation.

RunWield then asks for explicit confirmation:

- **Yes:** Tester executes the procedure and records the result.
- **No:** Tester does not execute it and converts it into precise human verification instructions.

Related actions with the same disclosed risk can share one approval. Distinct side effects must not be hidden inside one
broad approval.

Examples that require approval include modifying hosted data, sending notifications, publishing, deployment, paid API
use, shared-account changes, and exposure of credentials or authenticated browser evidence.

#### Standing approvals

When the user approves a destructive or costly action, RunWield can offer to record it in the QA Environment Profile as
a **standing approval**. A recorded approval is always scoped to the environment the profile states, not to the action
alone. It reads "safe against the staging mail sandbox", never "safe".

On a later run, Tester uses a standing approval only when it can confirm it is in that stated environment. When it
cannot confirm, it asks again.

This keeps QA cheap on repeat runs without letting a line written months ago authorize a real charge after somebody
swapped the sandbox key for a live one.

#### Approval with nobody present

Approval is a blocking question. RunWield does not guess an answer.

In an unattended context, such as an Epic child running without a person at the keyboard, an unanswerable approval makes
that procedure **blocked**. Tester converts it into a human procedure and continues with the rest of QA. No new concept
is needed for this.

Attached Mode, ACP, and remote Workspace sessions inherit the same blocking behavior. Unattended approval handling is a
general RunWield question that this PRD does not solve.

### Interactive Tester ownership

Automated QA activates Tester as the visible workflow Agent. Tester retains conversational control until one of these
conditions occurs:

- Tester calls `qa_completed`;
- the user skips QA through an offered workflow action;
- the user stops the workflow.

The user can answer questions, supply missing context, and help Tester continue. Tester remains manually selectable for
one-off QA outside post-verification workflows.

If Tester is blocked, it must not call `qa_completed`. It ends its turn with a plain-language state report, consistent
with blocked Engineer behavior:

- work done and its result;
- work still to do;
- the exact blocker;
- what would unblock it;
- any procedures already moved to human verification.

The active QA workflow and Agent Session preserve this state for continuation. A blocker is not a product failure and
does not consume the one allowed repair.

### Tester authority and workspace hygiene

Tester needs to write files. It builds harnesses, seed scripts, and driver scripts, and it needs `bash`, which writes
files as a matter of course. So the boundary cannot be drawn by removing tools. It is drawn by **location**.

```text
per-run scratch directory, outside the repository
    harnesses, seed scripts, driver scripts, captured output
    Tester writes freely here
    removed after the run, never committed

execution worktree
    Tester must leave it exactly as it found it
```

The worktree rule needs a check, not a request. `checkpointExecutionWorktree` commits all dirty state, including
untracked files, and QA runs before it. Without a gate, a scratch file Tester left behind would enter the published
commit with nobody looking at it. So RunWield captures worktree status before QA, compares it after, and treats any new
or changed file as a blocker in the report instead of letting sealing absorb it.

Workflow-dispatched Tester therefore:

- keeps `bash`, `write`, and the read and code-intelligence tools;
- loses `edit` and `multi_file_edit`, which exist for sweeping existing files and are the repair authority being
  withheld;
- loses `task_completed` and receives `qa_completed` instead, so the only terminal signal carries a structured report.

A harness that deserves to become a permanent regression test is not scratch. Tester proposes it in the QA Report with
the script attached, and the repair Engineer or a follow-up Plan lands it through normal review. Tester never lands its
own tests past its own verdict.

Accepted cost: a test framework that only discovers tests under a fixed in-repo directory cannot be driven from a
scratch directory. Tester converts those procedures to human procedures and says so. This is rare, and the alternative
is letting Tester write into the shipped diff.

### Cleanup

Tester must shut down what it started: dev servers, bound ports, seeded data, and browser sessions. RunWield already
namespaces `agent-browser` and closes browsers when the invocation ends, so browsers are covered. Everything else is
Tester's responsibility through prompt instruction.

This is an instruction, not a guarantee. The QA Report must state anything Tester knows it left running, so the user can
finish the cleanup by hand.

### Crash resume

Validation's durable position is the Plan status, and QA lives entirely inside `validated_reviewer`. A crash after
twelve executed procedures and one approved destructive action would otherwise re-enter delivery from the top and run
everything again, including the expensive parts.

Three durable fields in the file-backed controller record, next to the existing validation checkpoints and counters, fix
this:

```text
qaPhase        entered | reported
qaRepairsUsed  0 | 1
qaSessionId    -> the Tester Session to re-activate
```

On restart, RunWield re-activates that Session instead of dispatching a fresh Tester. Sessions are file-backed and
written as work happens, so the Tester transcript survives the crash. `qaRepairsUsed` must survive the same way, so a
restart cannot buy a second repair.

**Stated limit:** procedure results are not individually durable. Resume fidelity is whatever the transcript retained,
and Tester may repeat a cheap procedure it already ran. That is acceptable. What must not repeat is a destructive or
costly procedure the user already approved and paid for, so Tester's prompt requires it to review its own prior
transcript first and re-report those results rather than re-execute them.

Per-procedure durability was considered and set aside. It would need a schema, a writer, and a migration, and it buys
protection only against a crash that also destroys the transcript.

### Terminal QA report

Tester receives a workflow-only `qa_completed` tool. It calls this tool only when no blockers remain. The tool requires
a structured JSON report that accounts for all QA work.

The report must contain, at the product level:

- each procedure and whether it came from the Plan or Tester's added QA scope;
- the actions performed;
- pass, failure, or human-required disposition;
- observed evidence;
- expected and actual behavior for each failure;
- reproducible, Engineer-ready defect details;
- destructive or costly approvals and the user's decisions;
- proposed QA Environment Profile content or corrections, when any;
- proposed permanent regression tests, when any;
- anything Tester left running;
- remaining human procedures as ordered, exact instructions;
- the overall QA outcome.

The terminal outcomes are:

- `passed`: all QA procedures were executed and passed;
- `passed_with_human_steps`: every executed procedure passed, but one or more listed human procedures remain;
- `failed`: Tester observed one or more product failures.

A declined, unavailable, or genuinely human-only procedure is not a failure. It belongs in the human procedure list.
`passed_with_human_steps` can continue toward publication, but the product must state clearly that human verification
remains. It must not present this outcome as complete behavioral proof.

### Human procedure quality

Human procedures are not checklist fragments. Each procedure must give the user:

1. required setup and starting state;
2. the exact URL, command, endpoint, screen, or resource when known;
3. ordered actions;
4. the exact expected observation;
5. relevant inspection guidance in the Project's language, such as browser Console and Network checks, API response
   inspection, or CLI output and exit status.

Tester uses Project conventions, the QA Environment Profile, and memories to choose suitable terminology and tools.

### Planned Change QA Report

Each automated Planned Change QA run produces a separate durable Markdown **QA Report**. The report links to its source
Plan through Front Matter, and the Plan stores a neutral backlink to the report. This follows the existing Work Record
backlink principle: the backlink is evidence bookkeeping and does not redefine approved Plan intent.

The QA Report preserves:

- the structured terminal result rendered for people;
- executed evidence;
- observed failures;
- repair and focused-review disposition when applicable;
- the user's rerun or skip decision;
- remaining human procedures;
- anything left running after QA.

A future Plan Package feature can group child QA Reports by Epic. The first version keeps one report per Planned Change.
The report must move or remain discoverable with its source Plan through archive and restore behavior.

QUICK_FIX work has no Plan and therefore cannot meet the reciprocal-link contract. Its QA report remains in the durable
Session record. RunWield does not add a tracked QA Report file during QUICK_FIX work. Work that requires a shared,
Plan-linked QA artifact should use a Planned Change.

### Failure and repair flow

Automated QA runs after the broad Semantic Reviewer has approved the implementation and before optional Human Code
Review and publication. This order prevents a QA repair from invalidating later human approval.

```text
Mechanical Validation
  -> Semantic Review
  -> automated Tester QA
       passed or passed_with_human_steps
         -> optional Human Code Review
         -> publication
       failed
         -> one repair
         -> CI
         -> focused Reviewer
         -> user rerun decision
```

Repair ownership is:

- Planned Change: Reviewer-Feedback Engineer repairs the Tester findings.
- QUICK_FIX: the active Engineer repairs the Tester findings.

Tester is report-only. It does not edit implementation code or tests. The repair Agent receives the Tester findings and
must report a disposition for each finding.

After the one repair:

1. RunWield runs CI.
2. A focused Reviewer receives the Tester findings, repair report, and repair diff.
3. The focused Reviewer verifies each claimed fix and inspects the repair delta for regressions. It does not sweep the
   full Plan again.
4. RunWield asks the user whether to rerun affected QA.

The rerun choice must explain that another Tester turn can restart servers, use browser sessions, call APIs, modify test
data, or incur provider costs. The choices are:

- **Rerun affected QA:** Tester repeats failed procedures and procedures the repair could affect. Unrelated successful
  procedures are not repeated. Publication waits for the result.
- **Continue without rerunning QA:** continue after CI and focused review. The QA Report states that the repair was code
  reviewed but not behaviorally retested.
- **Stop:** preserve the repair, findings, QA state, and validation position for later continuation.

If the focused Reviewer rejects the repair, CI fails after the repair, or a requested targeted Tester rerun fails,
RunWield stops with preserved evidence. It does not dispatch a second automatic repair. The user can return later and
start new work deliberately.

### Epic children

Today a validated Epic child triggers the next child's planning and execution without a person present. Automated QA
must not turn that chain into a wait at every child.

An Epic child continues the chain unless one of these is true:

- QA outcome is `failed` after the one allowed repair;
- Tester is blocked and cannot finish QA, such as when it cannot reach the product at all.

In every other case, including `passed_with_human_steps`, RunWield writes the QA result into the Epic's artifacts
alongside the existing `manual-qa.md` handling and continues to the next child.

An unanswerable destructive approval inside an unattended child is not by itself a stop. It converts that procedure to a
human procedure, which lands the run at `passed_with_human_steps`, and the chain continues. Remaining human procedures
accumulate in the Epic artifacts for the user to work through.

### `manual` and `none` behavior

`manual` preserves the current advisory behavior, including today's standalone checklist presentation, its position at
`artifact_preparation`, and Epic `manual-qa.md` handling. It does not create an automated QA Report and does not create
a QA Environment Profile.

`none` suppresses the post-verification checklist and automated Tester phase. It does not suppress Mechanical
Validation, Semantic Review, optional Human Code Review, Work Record generation, or publication evidence.

## Technical Approach

The implementation should extend the existing settings, Workflow Validation, Agent activation, lifecycle recovery, and
artifact authorities rather than create a second validation path.

Conceptually:

- resolve Post-Verification QA Policy through the established merged global/project setting rules;
- preserve exact execution-worktree setting behavior where validation already requires it;
- place automated QA between Semantic Review approval and Human Code Review/publication, and leave the `manual`
  checklist at its current `artifact_preparation` position;
- activate the existing top-level Tester as a visible workflow owner with report-only authority: no `edit`, no
  `multi_file_edit`, no `task_completed`, and `write` aimed at a per-run scratch directory outside the repository;
- add `qa_completed` as the only terminal QA workflow signal;
- gate the worktree: capture status before QA, compare after, and report any residue as a blocker before
  `candidate_sealing` can commit it;
- keep blocked-state behavior conversational and resumable rather than add a second completion tool;
- persist `qaPhase`, `qaRepairsUsed`, and `qaSessionId` in the existing file-backed controller record, and re-activate
  the recorded Tester Session on resume instead of dispatching a fresh one;
- read the QA Environment Profile from `docs/qa-environment.md` when present, and let Tester propose content that
  RunWield writes after user approval — to the primary checkout for discovered setup, to the execution worktree when
  this Plan changed how the product runs, and nowhere when the profile is merely stale;
- treat standing approvals as profile content scoped to the profile's stated environment, and re-ask when Tester cannot
  confirm that environment;
- generate the human-readable QA Report from the trusted structured `qa_completed` result;
- use the existing Plan backlink pattern for reciprocal report linkage;
- keep QA Report generation and Plan linkage safe across publication, archive, restore, retry, and recovery;
- continue the Epic child chain except on post-repair `failed` or an unfinishable blocker;
- preserve the existing Manual QA path unchanged when policy resolves to `manual`.

The structured report is the workflow authority. Free-form Tester prose is presentation and blocking context, not a
terminal verdict.

## Success Criteria

- Existing Projects behave as they do today without configuration changes.
- A Project can independently configure Planned Change and QUICK_FIX QA as `none`, `manual`, `automated`, or `ask`.
- `ask` gives a clear per-run choice between automated QA, a manual checklist, and no QA.
- Automated QA is visible and interactive, and it resumes after a blocked Tester turn without losing completed work.
- A crash during QA resumes the same Tester Session and cannot grant a second repair or repeat an approved destructive
  procedure.
- Tester executes declared procedures plus bounded high-value checks through appropriate public interfaces.
- Tester can start or reach the product using the QA Environment Profile, and a Project pays that discovery cost once.
- The QA Environment Profile contains only steps Tester used successfully.
- A standing approval never authorizes an action outside the environment it was scoped to.
- Destructive or costly actions never execute without explicit informed approval.
- `qa_completed` cannot advance the workflow without a complete structured report and no blockers.
- Automated QA never adds a file to the published commit; worktree residue is reported as a blocker.
- Every observed failure contains enough detail for the repair Agent to reproduce and address it.
- Automated QA causes at most one repair.
- CI and focused review check that repair before the user decides whether to pay for a targeted QA rerun.
- An Epic chain continues through `passed_with_human_steps` and stops only on post-repair failure or an unfinishable
  blocker.
- Planned Changes retain a durable reciprocal-linked QA Report; QUICK_FIX work retains its report in the Session.
- Remaining human work is shown as exact procedures, not vague checklist items.
- RunWield distinguishes full pass, pass with human work remaining, failure, blocked work, and an untested repaired
  result.

## Proposed Domain Language

### Post-Verification QA Policy

A global-and-project preference that controls whether Planned Change and QUICK_FIX post-verification QA is skipped,
presented as a manual checklist, executed by Tester, or selected per run.

Avoid: **QA setting**, **Tester mode**. These aliases conflict with the existing QA Intervention Policy.

### Automated QA

The interactive workflow phase in which Tester executes declared and bounded inferred behavioral procedures after broad
Semantic Review and before Human Code Review or publication.

Automated QA is not Mechanical Validation, Semantic Review, or QA Intervention Policy.

### QA Environment Profile

The tracked Markdown document at `docs/qa-environment.md` that records how to reach and exercise this Project's product:
start command or environment URL, preconditions, test identity, what counts as destructive here, standing approvals, and
hard limits. It records only steps that Tester used successfully. It is created lazily on first need, proposed by
Tester, approved by the user, and written by RunWield.

Avoid: **QA config**, **test setup file**. It is not a settings file and holds no secrets.

### Standing QA Approval

A destructive or costly action the user approved once and RunWield recorded in the QA Environment Profile, scoped to the
environment that profile states. It applies only when Tester can confirm it is in that environment.

Avoid: **blanket approval**, **allowlist**. Both drop the environment scope that makes it safe.

### QA Report

The durable Markdown evidence artifact for one Planned Change's automated QA. It records executed procedures, evidence,
failures, repair disposition, rerun decisions, remaining human procedures, and anything left running. It links
reciprocally with its source Plan and has no independent Plan Lifecycle.

A QUICK_FIX Session report is not a QA Report artifact because QUICK_FIX has no source Plan.

### Human QA Procedure

An ordered verification procedure that Tester did not execute because it requires human judgment, unavailable access, or
declined or unanswerable destructive or costly action. It includes setup, exact actions, and expected observations.

Avoid: **unchecked item**, **manual QA fragment**.

### QA Intervention Policy

Keep the current definition unchanged. It controls whether a manually directed Tester reports, adds regression tests, or
fixes defects. Workflow-dispatched Automated QA always overrides intervention authority to report-only.

## Out of Scope

- Aggregating child QA Reports into a Plan Package or Epic-level report.
- Replacing Mechanical Validation, Semantic Review, or Human Code Review.
- Letting workflow-dispatched Tester edit implementation code or tests, or land its own regression tests.
- More than one automatic repair for an Automated QA failure.
- A tracked QA Report artifact for QUICK_FIX work.
- A hard cost or token budget for a Tester QA turn. Cost control comes from Tester judgment, the approval rule, the
  Project's own fakes and sandboxes recorded in the profile, and `ask`.
- Per-procedure durable state. Crash resume re-activates the Tester Session and accepts that cheap procedures may
  repeat.
- Unattended handling of blocking approvals in Attached Mode, ACP, or remote Workspace sessions. Approval stays
  blocking.
- Guaranteed cleanup of processes Tester started. Cleanup is a Tester instruction plus a report of what remains.
- Asking for QA environment setup during `wld init`.
- Automatic repair of a stale QA Environment Profile from a branch that may not land.
- A general credential vault, paid-service budget manager, production deployment system, or destructive-action policy
  beyond explicit per-action approval and environment-scoped standing approvals.
- A new lifecycle status solely for QA Reports.
- Changing today's Manual QA behavior beyond making it selectable by policy.
