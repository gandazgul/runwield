# Product Requirements Document: Post-Verification QA Policy

Date: 2026-08-30

## Objective

Give each RunWield Project explicit control over post-verification QA while preserving today’s behavior by default.
RunWield must support no QA, today’s generated human checklist, interactive Agent-executed QA, or a per-run choice.

Automated QA must use the fresh-context Tester to execute all feasible Plan procedures and a bounded set of additional
behavioral and adversarial checks. It must produce reviewable evidence, route observed defects through one controlled
repair, and leave only genuinely human procedures for the user.

## Problem Statement

RunWield currently generates a Manual QA checklist automatically after successful QUICK_FIX Mechanical Validation and
successful standalone Planned Change validation. For Epic children, it writes advisory checklist sections to the Epic’s
`manual-qa.md` artifact. This behavior has no setting.

The current checklist does not execute the procedures. It cannot show which behaviors passed, which failed, or why an
Agent could not perform a check. It also cannot return evidence-backed defects to Engineer without starting an unrelated
workflow.

Teams need different cost and confidence policies:

- some do not want post-verification QA;
- some want today’s short human checklist;
- some want Tester to exercise the delivered product;
- some want to choose per run, especially for QUICK_FIX work where a full Tester turn can cost more than the change.

## Product Principles

- **Independent verification:** Tester reports findings and never repairs its own findings in this workflow.
- **Evidence before claims:** RunWield distinguishes executed proof, remaining human judgment, and untested repairs.
- **Visible collaboration:** automated QA is an interactive Agent phase, not a hidden background model call.
- **Bounded repair:** an automated QA run can cause at most one implementation repair.
- **User control over cost and risk:** destructive or costly procedures require explicit approval. Repeated QA also
  requires an informed user choice.
- **Compatibility by default:** Projects that do not configure this feature continue to receive today’s Manual QA
  behavior.

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
- `manual`: preserve today’s generated human checklist behavior.
- `automated`: activate Tester and execute QA.
- `ask`: explain the likely cost and ask the user to select automated QA, a manual checklist, or no QA for this run.

The default is `manual` for both Planned Changes and QUICK_FIX work. Missing or invalid configuration uses the safe,
compatible default rather than silently enabling Agent execution.

This policy is separate from the existing **QA Intervention Policy**. Post-Verification QA Policy controls whether and
how QA runs. QA Intervention Policy controls whether a manually selected Tester may report, add regression tests, or fix
defects. Workflow-dispatched post-verification Tester always has report-only authority.

### QA scope

For a Planned Change, Tester receives the approved Plan, implementation details, relevant diff and validation evidence,
and applicable Project conventions and memories.

Tester must:

1. execute every feasible procedure declared in the Plan’s Manual verification section;
2. add a bounded set of high-value behavioral, regression, and adversarial procedures based on the implementation,
   Project conventions, and memories;
3. use the public interface that fits the Project, such as a headed browser, browser developer tools, API client, or
   CLI;
4. record actions and observed evidence rather than claim a result from source inspection alone.

For QUICK_FIX work, no Plan exists. Tester derives a small QA scope from the original request, Engineer completion
report, implementation diff, Project conventions, and memories.

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

### Terminal QA report

Tester receives a workflow-only `qa_completed` tool. It calls this tool only when no blockers remain. The tool requires
a structured JSON report that accounts for all QA work.

The report must contain, at the product level:

- each procedure and whether it came from the Plan or Tester’s added QA scope;
- the actions performed;
- pass, failure, or human-required disposition;
- observed evidence;
- expected and actual behavior for each failure;
- reproducible, Engineer-ready defect details;
- destructive or costly approvals and the user’s decisions;
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
5. relevant inspection guidance in the Project’s language, such as browser Console and Network checks, API response
   inspection, or CLI output and exit status.

Tester uses Project conventions and memories to choose suitable terminology and tools.

### Planned Change QA Report

Each automated Planned Change QA run produces a separate durable Markdown **QA Report**. The report links to its source
Plan through Front Matter, and the Plan stores a neutral backlink to the report. This follows the existing Work Record
backlink principle: the backlink is evidence bookkeeping and does not redefine approved Plan intent.

The QA Report preserves:

- the structured terminal result rendered for people;
- executed evidence;
- observed failures;
- repair and focused-review disposition when applicable;
- the user’s rerun or skip decision;
- remaining human procedures.

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

### Manual and none behavior

`manual` preserves the current advisory behavior, including today’s standalone checklist presentation and Epic
`manual-qa.md` handling. It does not create an automated QA Report.

`none` suppresses the post-verification checklist and automated Tester phase. It does not suppress Mechanical
Validation, Semantic Review, optional Human Code Review, Work Record generation, or publication evidence.

## Technical Approach

The implementation should extend the existing settings, Workflow Validation, Agent activation, lifecycle recovery, and
artifact authorities rather than create a second validation path.

Conceptually:

- resolve Post-Verification QA Policy through the established merged global/project setting rules;
- preserve exact execution-worktree setting behavior where validation already requires it;
- place automated QA between Semantic Review approval and Human Code Review/publication;
- activate the existing top-level Tester as a visible workflow owner with report-only tool authority;
- add `qa_completed` as the only terminal QA workflow signal;
- keep blocked-state behavior conversational and resumable rather than add a second completion tool;
- persist QA continuation and one-repair state through the existing validation checkpoint/controller authority;
- generate the human-readable QA Report from the trusted structured `qa_completed` result;
- use the existing Plan backlink pattern for reciprocal report linkage;
- keep QA Report generation and Plan linkage safe across publication, archive, restore, retry, and recovery;
- preserve the existing Manual QA path unchanged when policy resolves to `manual`.

The structured report is the workflow authority. Free-form Tester prose is presentation and blocking context, not a
terminal verdict.

## Success Criteria

- Existing Projects behave as they do today without configuration changes.
- A Project can independently configure Planned Change and QUICK_FIX QA as `none`, `manual`, `automated`, or `ask`.
- `ask` gives a clear per-run choice between automated QA, a manual checklist, and no QA.
- Automated QA is visible and interactive, and it resumes after a blocked Tester turn without losing completed work.
- Tester executes declared procedures plus bounded high-value checks through appropriate public interfaces.
- Destructive or costly actions never execute without explicit informed approval.
- `qa_completed` cannot advance the workflow without a complete structured report and no blockers.
- Every observed failure contains enough detail for the repair Agent to reproduce and address it.
- Automated QA causes at most one repair.
- CI and focused review check that repair before the user decides whether to pay for a targeted QA rerun.
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

### QA Report

The durable Markdown evidence artifact for one Planned Change’s automated QA. It records executed procedures, evidence,
failures, repair disposition, rerun decisions, and remaining human procedures. It links reciprocally with its source
Plan and has no independent Plan Lifecycle.

A QUICK_FIX Session report is not a QA Report artifact because QUICK_FIX has no source Plan.

### Human QA Procedure

An ordered verification procedure that Tester did not execute because it requires human judgment, unavailable access, or
declined destructive or costly action. It includes setup, exact actions, and expected observations.

Avoid: **unchecked item**, **manual QA fragment**.

### QA Intervention Policy

Keep the current definition unchanged. It controls whether a manually directed Tester reports, adds regression tests, or
fixes defects. Workflow-dispatched Automated QA always overrides intervention authority to report-only.

## Out of Scope

- Aggregating child QA Reports into a Plan Package or Epic-level report.
- Replacing Mechanical Validation, Semantic Review, or Human Code Review.
- Letting workflow-dispatched Tester edit implementation code or tests.
- More than one automatic repair for an Automated QA failure.
- A tracked QA Report artifact for QUICK_FIX work.
- Automatic completion of remaining human procedures after publication.
- A general credential vault, paid-service budget manager, production deployment system, or destructive-action policy
  beyond explicit per-action approval.
- A new lifecycle status solely for QA Reports.
- Changing today’s Manual QA behavior beyond making it selectable by policy.
