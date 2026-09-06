---
planId: "c3de7406-8856-4908-b131-4e387be39aac"
classification: "PROJECT"
complexity: "HIGH"
affectedPaths:
    - "docs/plans/"
    - "src/plan-store.js"
    - "src/plan-front-matter.js"
    - "src/shared/workflow/"
    - "src/shared/epic-artifacts.ts"
    - "src/shared/session/"
    - "src/agent-definitions/"
    - "src/tools/"
    - "src/cmd/load-plan/"
    - "src/cmd/plans/"
    - "src/ui/tui/"
    - "src/ui/workspace/"
    - "docs/plan-lifecycle.md"
    - "docs/domain-language.md"
    - "docs/prd/runwield-core-prd.md"
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-08-14T00:11:43-04:00"
status: "draft"
---

# Plan Packages and Independent Validation

## Context

RunWield currently stores each executable Plan as one Markdown file. Planner combines product context, architecture,
implementation steps, validation procedures, and manual QA expectations in that file. Engineer then implements the Plan
and is instructed to run its full Verification Plan before the same workflow moves through Mechanical Validation and
semantic review.

This shape has produced strong technical machinery but weak separation of responsibility. The Plan can omit a basic user
outcome while still satisfying all written checks, and the implementation Agent can mistake partial evidence for proof
that the whole Plan is complete. Semantic Reviewer is correctly limited to the approved Plan and therefore cannot repair
missing intent. Manual QA is generated late and does not act as an independent acceptance gate.

A second gap sits one level up. Today each child Planned Change publishes to its recorded target branch as it finishes.
Without an explicit Epic target branch, this treats each child as a release. Remote publication uses an isolated clone;
it does not modify the primary checkout. That is often wrong. An Epic frequently builds one capability that has no user
until every child lands. The per-child release model has three costs: partial work reaches the main branch; the
implementation Agent narrates the gap inside the product itself, with controls labeled as unavailable until a later
slice; and nothing ever proves the assembled Epic works. Validation is per-child, so integration defects between
children are exactly what it cannot see. The Epic aggregate that exists today, `docs/plans/<epic>/manual-qa.md`, states
in its own header that it is advisory and does not change verification status, and both routes to a verified Epic
(`epic_done_enough` and user attestation) are declarations rather than proof.

RunWield needs a planning and delivery model in which implementation, validation, semantic review, and owner judgment
have explicit artifacts and owners. Stronger frontend experience planning is a separate dependent PROJECT,
`plan-package-frontend-experience-planning`; it should build on this foundation rather than expand its storage and
lifecycle migration. The original prerequisites were validation authority and recovery, simpler workflow messages, and
Pair Execution for both Plan execution owners. The September 5 source audit found these capabilities in the current
code. They are reuse foundations, not three pending Plans. The authority-consolidation Work Record records user-attested
verification, not proof from RunWield Workflow Validation.

## Objective

Replace single-file executable Plans with atomic, revisioned **Plan Packages** and separate implementation from proof:

- a Plan Package directory contains canonical `plan.md`, required `validation.md`, and generated `manual-qa.md` when
  genuinely human-only checks remain;
- PROJECT Epics become package folders containing child Plan Package folders;
- Slicer materializes lightweight draft child `plan.md` files, while Planner authors `validation.md` and makes a
  selected child execution-ready;
- the existing Verification Adversary challenges whether the proposed validation contract can distinguish a real
  implementation from a counterfeit one before package approval;
- Engineer implements the approved package, adds required tests and fixtures, uses targeted checks while developing, and
  never claims independent validation;
- a first-class Validator executes every machine-executable and agent-executable step in `validation.md` for FEATURE
  Plans, Epic children, and Epics themselves, remains read-only with respect to the candidate and approved package, and
  submits implementation findings to orchestration;
- orchestration sends Validator findings to a bounded Validation Repair Engineer;
- a separate read-only Semantic Reviewer runs only after Validator passes and submits findings that orchestration sends
  to a bounded Review Repair Engineer;
- on the independent validation path, every code repair returns through complete validation before semantic re-review;
- the user can always accept an individual Plan or Epic through code review or a direct `user_validated` action,
  including after failed, skipped, or interrupted checks; acceptance does not claim those checks passed;
- an Engineer, Validator, or Reviewer may propose a Plan defect, but only the user can approve the rare transition that
  returns the package to Planner under a durable `defective` state with structured evidence and preserved work;
- implementation, validation, review, and repair use role-specific completion boundaries instead of overloading
  `task_completed`;
- `implemented`, `validating`, `reviewing`, optional `awaiting_owner_review`, `verified`, and `defective` become clear
  lifecycle milestones, with detailed validation stages recorded separately from board status;
- a PROJECT Epic gets its own target branch by default, named by Architect; children take execution worktrees from that
  branch and publish into it, and the user can override this to per-child publication into the primary checkout;
- an Epic reaches `implemented` when every child is settled or the user marks it done enough, and Validator then runs
  the Epic's own `validation.md` against the assembled Epic branch before the Epic can reach `verified`;
- integrated validation separates "built and broken" from "never built", so a done-enough Epic records accepted gaps and
  still fails on a settled child whose claimed outcome does not work;
- an integrated-validation failure returns to Planner with the complete report and becomes a child Plan focused on those
  failures, carrying the failed outcome identifiers in its own validation contract; and
- `verified` on an Epic means the Epic branch is proven and ready to merge. RunWield does not merge it. Merging the Epic
  branch into the primary branch is a separate dependent PROJECT, `epic-branch-publication-workflow`.

No-plan QUICK_FIX workflow behavior is unchanged in this PROJECT. QUICK_FIX continues through its existing Engineer and
Mechanical Validation path.

The option set aside is adding more instructions to the existing single Plan and Engineer prompt. That would leave the
same agent responsible for implementation and proof, keep the validation contract mixed into implementation prose, and
provide no independent authority for deciding whether the approved proof actually passed.

### Settled decision: user acceptance — 2026-09-05

The user can always accept the current result of a Planned Change or an Epic. There are two routes: accept through Local
Human Code Review, or directly choose `user_validated` without code review. Neither route requires a successful
Validator run, AI review, integrated Epic validation, or exhausted repair attempts. A failed or interrupted workflow
must expose these actions, not force the user to continue repairs or reopen planning.

When all independent gates passed, ordinary human review can retain that proof-backed outcome. When the user accepts
without those gates passing, the outcome is `user_validated`. Record the acceptance route, time, available candidate
revision, approved package revision, and existing failed or unrun checks. Keep validation reports intact. Never turn
acceptance into a passing Validator or Reviewer report or invent delivery evidence. If the candidate is unavailable,
record that fact rather than requiring fabricated revision evidence to accept the work.

Acceptance applies to the current result. Later Agent completions cannot overwrite it or resume automatic repairs. If
work is running, orchestration stops further automatic work and records the decision at a safe checkpoint. Acceptance
does not itself discard worktrees or publish an Epic. Publication still uses the relevant delivery workflow and real Git
facts. The dependent Epic publication design must support an owner-accepted branch as well as an independently proven
branch, without describing the former as independently proven.

On the independent path, any code repair invalidates proof for the older candidate. This includes validation repair, AI
review repair, Code Review chat repair, and publication conflict repair. Fresh validation and applicable AI review are
required before RunWield claims independent success. The user can instead accept the repaired result at any point. For
Epics, integrated validation remains the independent gate; there is no new Epic-level AI diff review.

`user_validated` is proposed target language requested by the user. Current code uses `user_verified`. The child Plan
that implements this acceptance contract must update `docs/domain-language.md` in the same change and preserve legacy
acceptance history and read compatibility. Package terminology must likewise enter the glossary with the implementation
that makes Plan Packages real. No glossary is changed during this architecture session.

The rejected option is mandatory independent approval with no owner override. It could trap users in failed or repeated
Agent checks. The chosen design gives the user final control while keeping the difference between proof and acceptance
visible.

### Settled decision: repeatable binary migration — 2026-09-05

Migration lives in the RunWield binary, not in the installer. On project entry the binary discovers and converts legacy
Plans in the current checkout and RunWield-managed worktrees, including unfinished execution and validation attempts.
The user does not have to finish every Plan before upgrading. `src/cmd/update/index.ts::runUpdateCommand` continues to
install the binary; it is not the owner of repository conversion.

Release and runtime notices state that branches and worktrees not controlled by RunWield are not upgraded automatically.
The binary does not check out or rewrite arbitrary branches. If the user later opens such a checkout with `wld`, or
merges old-format Plans into an already converted checkout, the next project entry detects and converts those files. A
project migration marker cannot suppress this discovery. Repeating a completed conversion has no further effect.

Migration support remains for one whole version, with deprecation considered later. Removing it is a later release
decision with an advisory; this Epic does not add a silent time-based removal. During this compatibility period, mixed
legacy and package storage can exist on disk while conversion is incomplete. Ordinary Plan operations use the package
interface after resolving the relevant conversion; there is not a second long-term legacy execution workflow.

The package store owns migration and its journal. Progress is per package and authoritative checkout, not one
all-or-nothing project rename. A completed conversion stays completed if a different Plan is blocked. A reader must
never observe half of one package or treat its companion files as separate Plans. Conversion records input identity and
content, intended paths, and committed output so retry can finish or restore that package without duplication or data
loss. Coordinate migration with Plan, catalog, controller, and worktree locks; a running old process must stop or
release its ownership before its files change. An unfinished attempt is supported, but concurrent uncoordinated writers
are not.

Each managed checkout converts its own documents. `resolveWorkflowPlanLocation` remains the authority rule: after
execution starts, the execution-worktree Plan is authoritative. The primary copy must never overwrite it. Include
retained managed worktrees that own reopened Plans. Preserve `planId`, canonical names, relationships, archive
membership, collaboration references, lifecycle history, controller generations, repair receipts, and worktree identity.
Do not reset an attempt merely because its files moved.

Legacy Plans reintroduced by a merge require identity and content checks, not an unconditional overwrite. A legacy copy
already represented by an equivalent package can be reconciled without creating a second Plan. Different content with
the same identity, an occupied destination with another identity, or unresolved Git conflicts produces a local migration
conflict. Keep both inputs and explain the paths; unrelated packages can still migrate. Never choose the legacy file or
the package as winner based only on layout or modification time.

Approval and publication evidence need special handling. Current approval revisions hash full Markdown bytes, and
publication receipts name sealed commits and Plan paths. A format-only move cannot simply reuse a new hash as historical
approval, expand allowed publication paths, or rewrite old Git proof. Preserve old evidence and record an explicit
old-to-new content relationship. Pending publication must reconcile its existing seal and real Git effects before a
converted candidate can advance. A process interruption at any point must retain one recoverable next action. The exact
legacy-validation-content rule remains a stakeholder decision below.

The options set aside are installer-time global migration and requiring all work to finish before upgrading. Neither
handles old-format Plans arriving through a later merge. The chosen design costs temporary migration and recovery
support, but permits upgrades during unfinished work and handles delayed branch integration.

## Vertical Slice Findings

### Resumed source audit — 2026-09-05

The saved product decisions remain the target: Plan Packages, independent validation, default Epic branches, integrated
Epic validation, and separate owner-triggered Epic publication in the dependent PROJECT. The following current facts
replace older baseline claims elsewhere in this draft. Unresolved target contracts remain below for discussion.

- `plan-store.js` owns file discovery and durable `planId`. It has separate body, whole-document, and front-matter
  revisions. Package approval must extend those protections, not replace them with filename identity or one body hash.
- `plan-executor.ts::validateApprovedPlanSnapshotForHandoff` rejects changed approval-time identity, revision, status,
  or worktree evidence. A package needs equivalent checks across all approved documents.
- `plan-location.ts::resolveWorkflowPlanLocation` selects the execution-worktree Plan after activation. Package storage
  must preserve this authority. A stale primary copy must never replace an active package.
- Plan Markdown owns definition and lifecycle history. `.wld/controller/plans/<planId>.json` owns validation
  checkpoints, review decisions, and repair receipts. `.wld/worktrees.json` and Git own worktree and publication facts.
  Package folders must not absorb controller state. See `docs/validation-authority.md`.
- `validation-supervisor.ts` and `validation-engine.ts` already own validation sequencing and recovery independently of
  Agent prose. Mechanical repairs resume by rerunning checks. Completion events are owner-scoped and consume-once;
  role-specific tools must retain those guarantees.
- Plan Engineer and Frontend Engineer now implement approved Planned Changes. Selectable Engineer owns QUICK_FIX.
  `plan-engineer.md` still requires full Plan verification and full CI during implementation; removing that duplicate
  responsibility is still part of this proposal.
- `workflow-slicer.ts` inherits `targetBranch`; the old `worktreeBaseBranch` front-matter name is only a read fallback.
  Remote publication uses `isolated-publication.ts` and the durable publication machine, not the primary checkout.
- `plan-lifecycle.js` currently maps `epic_done_enough` to `validated`. Some glossary and lifecycle prose still use
  `verified`. Automatic parent completion is another route, in addition to done-enough and user attestation. Every route
  must be covered by the integrated-validation contract. Final target status names still need a decision.
- Objective-Failing Checks have been removed. Keep the Verification Adversary and checks that distinguish real delivery
  from false completion; do not restore the removed Objective Check mechanism.
- Current human-review feedback can skip another AI review after fresh CI. Non-Git work skips semantic diff review. Code
  Review chat repair and publication conflict repair also need explicit treatment under the new proof contract.

These findings came from source and existing tests, not a new test run. The two dirty validation phase files were read
as current working-tree code and were not changed.

### Storage and delivery shape

The current storage and workflow path is file-shaped from end to end:

```text
docs/plans/<name>.md
  -> plan-store filename identity + single body hash
  -> Planner projection
  -> Engineer executes body + Verification Plan
  -> Mechanical Validation
  -> Semantic Reviewer
  -> publication of one Plan file
```

Plan storage resolves every canonical name directly to `<name>.md`; locks, archive/restore, collaboration hashes,
Plannotator editing, Plan Board resources, execution-worktree copies, lifecycle metadata, and publication all assume one
file. Epic children are files one directory below the Epic name. The migration is therefore a storage, revision,
collaboration, lifecycle, prompt, and UI project rather than a documentation reorganization.

The target boundary is package-shaped:

```text
docs/plans/<name>/
  plan.md             canonical identity, lifecycle, context, implementation specification
  validation.md       approved independent validation contract
  manual-qa.md        generated human-only delivery checklist

approved package revision
  -> Engineer implementation
  -> Validator
  -> Semantic Reviewer
  -> owner gate when required
  -> publication
```

For Epics:

```text
docs/plans/<epic>/plan.md           Epic identity, lifecycle, architecture
docs/plans/<epic>/validation.md     integrated validation contract
docs/plans/<epic>/manual-qa.md      advisory aggregate, generated as today
docs/plans/<epic>/<child>/plan.md
docs/plans/<epic>/<child>/validation.md
```

Only directories containing `plan.md` are Plans. Companion Markdown and generated artifacts never appear as independent
Plans.

The Epic release path changes shape too. Children stop publishing into the primary checkout one at a time:

```text
child 3 ──┐
child 4 ──┼──▶ Epic branch ──▶ Epic implemented ──▶ integrated validation ──▶ verified
child 5 ──┘    no Epic worktree                     Validator, read-only      branch is proven
                                                                              and ready to merge
```

`implemented` already means what this needs: implementation finished, Workflow Validation still to run. The Epic has no
way to reach it, because the only transition into `implemented` starts from `in_progress` and an Epic never enters
`in_progress`. So this is one new transition, not a new status. `epic_done_enough` changes target from `verified` to
`implemented` and records the accepted gaps, which also removes the current exception in `docs/plan-lifecycle.md` that
lets an Epic reach `verified` without Workflow Validation.

The Epic stays non-executable. No Engineer ever works at Epic level and the Epic never owns an execution worktree.
Validator is read-only by design, so it can run against the Epic branch without giving the Epic write authority. An
integrated failure becomes an ordinary child Plan through Planner, so every fix stays a planned, validated, reviewed
change.

## Expected Change Surface

- `src/plan-store.js` and `src/plan-front-matter.js` — introduce package discovery, canonical identity, aggregate
  revision/hash, locks, archive/restore, migration, child hierarchy, and generated-artifact boundaries.
- `src/shared/workflow/` — split implementation, validation, review, repair, defective-Plan return, owner acceptance,
  and publication into explicit owners and transitions.
- `src/shared/session/` — preserve stable Session and segmented continuation across implementation, validation, repair,
  review, planning return, and revised-package execution.
- `src/agent-definitions/` — revise Planner, Architect, Slicer, Engineer, Validator, Reviewer, and bounded repair
  contracts. The proposed Architect behavior names a default Epic branch instead of setting `targetBranch` only on
  request; `workflow-slicer.ts` already passes the parent target branch to children.
- `src/shared/epic-artifacts.ts` — keep the advisory aggregate checklist and add the Epic's executed validation contract
  beside it.
- `src/tools/` — add typed implementation completion, validation result, Plan defect, and package finalization
  boundaries; give repair roles their own completion signal rather than reusing implementation completion.
- `src/cmd/load-plan/` and `src/cmd/plans/` — load, review, share, archive, recover, and migrate packages atomically.
- Binary project-entry paths and release documentation — invoke repeatable package migration for the current checkout
  and managed worktrees, and explain that unmanaged branches and worktrees are not automatically upgraded. The installer
  does not own repository conversion.
- `src/ui/tui/` and `src/ui/workspace/` — review package artifacts and candidates, show new lifecycle milestones, and
  collect required owner decisions.
- `docs/plan-lifecycle.md`, `docs/domain-language.md`, and `docs/prd/runwield-core-prd.md` — define the Plan Package,
  roles, statuses, validation contract, and owner-facing behavior.

## Reuse Opportunities

- Existing Plan frontmatter revision checks, Plan locks, catalog lock, transition journal, archive/restore, and
  collaboration body hashing as inputs to package-level equivalents.
- Existing Planner, Architect, and Slicer workflow, including draft child materialization and ordinary Planner pickup.
- Existing session-independent validation engine, Mechanical Validation commands, Semantic Reviewer, Review Issue
  ledger, and bounded semantic repair segments.
- Existing Manual QA subagent and Epic Manual QA artifact, which stay advisory and keep their current aggregation
  behavior, as migration inputs for package-local generated checklists.
- Existing `targetBranch` front matter, Slicer branch inheritance, and per-child worktree creation, which already
  support children executing from and publishing into an Epic branch.
- Existing Workspace Plan review, Plannotator, and browser design-system primitives.

## Verification Plan

- Each child Planned Change must provide a `validation.md` whose steps are classified as machine-executable,
  agent-executable, or genuinely human-only. The Epic must provide its own `validation.md` for integrated validation.
  The Epic is still never executed — no Engineer works at Epic level and the Epic owns no execution worktree — but it is
  validated.
- Epic branch children must prove Architect names a default Epic branch, Slicer passes it to every child, children take
  worktrees from it and publish into it, and an explicit user override restores per-child publication into the primary
  checkout.
- Epic validation children must prove an Epic reaches `implemented` only when every child is settled or the user marked
  it done enough, that Validator executes the Epic `validation.md` read-only against the Epic branch, and that
  `verified` requires a passing integrated run rather than an attestation.
- Done-enough verification must prove the independent path still runs integrated validation, records outcomes that were
  never built as accepted gaps, and fails when a settled child's claimed outcome does not work. The user can instead
  accept the Epic as `user_validated`; this must not convert gaps or failures into passing check results.
- Integrated-failure children must prove a failing Epic validation produces a Planner-owned child Plan that carries the
  complete report and the failed outcome identifiers inside its own validation contract, and that the Epic cannot reach
  `verified` until that child lands and integrated validation runs again.
- Planner-authored validation must demonstrate the requested outcome. The Verification Adversary must challenge whether
  the package contract distinguishes real completion from counterfeit evidence before approval. This does not restore
  the removed Objective-Failing Checks feature.
- Package storage verification must prove legacy single-file and Epic layouts migrate without identity loss, duplicate
  Plans, collaboration corruption, archive ambiguity, or unsafe worktree publication. Cover active and archived Plans,
  per-package interruption and retry, local collisions with unrelated migration progress, and concurrent writers.
- Binary migration verification must cover unfinished implementation, paused repair, pending human review and
  publication, and a stale primary copy beside an authoritative managed-worktree Plan. Attempt identity, controller
  receipts, approved intent, and genuine publication evidence survive without being replaced by fabricated new proof.
- Repeated entry must make no further changes after successful conversion. After an actual Git merge introduces an
  additional old-format Plan, the next entry must convert it despite earlier migration markers. Unmanaged worktrees and
  unchecked-out branches remain untouched. Conflicting old and new copies must not silently overwrite either version.
- Workflow verification must prove Engineer cannot mark validation complete, Validator and Reviewer remain read-only,
  repair agents receive bounded context, and every code repair invalidates prior proof on the independent path.
- Owner-acceptance verification must cover individual Plans and Epics with passing, failing, unrun, and interrupted
  checks. Both code-review acceptance and direct `user_validated` must work without another Agent gate. Reports remain
  unchanged, delayed completion events cannot resume repairs, and acceptance does not synthesize delivery evidence.
- Lifecycle children must prove a proposed Plan defect cannot change lifecycle state without user approval, and that an
  approved defect returns to Planner without being misclassified as an implementation failure while preserving the
  candidate/worktree for an approved revision repair.
- Integration children must exercise the complete flow from Router through Planner, package approval, autonomous
  implementation, validation, semantic review, repair, optional owner QA, and publication.
- Migration and integration must run through `scripts/run-tests.js`, `deno task seams:check`, and `deno task ci`;
  children that change browser surfaces must also run the project's approved browser acceptance framework.

### Outcome Evidence

- **Plan Packages replace executable single files** — every active executable Plan resolves through a directory
  containing `plan.md` and `validation.md`; companion files are not cataloged as Plans; legacy Plans preserve `planId`,
  canonical name, lifecycle history, collaboration relations, and archive state after migration.
- **Migration is repeatable and supports unfinished work** — binary entry converts the current checkout and managed
  worktrees, preserves authoritative worktree content and attempt state, and resumes partial progress per package. A
  second run changes nothing; a later merge of old-format Plans triggers fresh conversion. One conflict does not roll
  back unrelated conversions, and unmanaged branches and worktrees remain untouched.
- **Package approval is atomic** — changing `plan.md` or `validation.md` changes one package revision and invalidates
  prior approval; generated `manual-qa.md` never mutates that approved specification revision.
- **Slicer drafts stay lightweight** — materialized child drafts require only `plan.md`; Planner adds `validation.md`
  before `ready_for_work`.
- **Engineer no longer validates itself** — Engineer completion produces `implemented` plus bounded implementation
  evidence; only Validator can advance to semantic review.
- **Validator owns execution of the approved validation contract** — every `validation.md` step has a recorded result;
  Validator may create ephemeral probes and evidence outside the candidate but cannot modify production code or the
  approved package.
- **Semantic review remains independent** — Reviewer receives the approved package, validated implementation revision,
  diff, and Validator report. Tests or Pair checkpoints cannot stand in for its approval. Explicit user acceptance can
  end the workflow without that approval, but records `user_validated`, not independent success.
- **Repairs invalidate earlier proof** — any code repair requires a new complete Validator pass and applicable Semantic
  Reviewer pass before independent success. This includes Code Review chat and publication conflict repair.
- **The user can always accept** — both Plans and Epics offer code-review acceptance and direct `user_validated` from
  failed, unrun, interrupted, and successful workflows. No Agent approval is required. Recorded check results stay
  intact; pending Agent results cannot replace the user's decision or restart repairs.
- **Plan defects require owner judgment** — Validator, Reviewer, or implementation discovery can propose structured
  `planDefect` evidence, but only user approval makes the status `defective`; Planner then revises the package under a
  new revision and preserves the candidate for a bounded Plan-revision repair when safe.
- **Lifecycle is understandable and resumable** — `implemented`, `validating`, `reviewing`, optional
  `awaiting_owner_review`, `verified`, and `defective` have one documented meaning; detailed validation/review stages
  and repair state resume after process loss without adding board-status noise.
- **Completion signals cannot cross authority boundaries** — implementation completion, validation completion, review
  completion, and repair completion are role-scoped; one role's completion cannot advance another role's state.
- **Manual QA contains only human work** — generated `manual-qa.md` excludes automated checks already performed and
  gives the owner concrete observable actions for remaining judgment. The Epic aggregate keeps its current advisory
  meaning and gains an executed sibling rather than being replaced.
- **The Epic is the default release unit** — a PROJECT Epic carries a named target branch, children execute from it and
  publish into it, no child reaches the primary branch on its own, and an explicit user override restores per-child
  publication.
- **The Epic is validated without becoming executable** — the Epic owns a `validation.md`, reaches `implemented` when
  its children are settled, and reaches `verified` only after Validator executes that contract read-only against the
  assembled branch. No Engineer runs at Epic level and the Epic never owns an execution worktree.
- **Done enough stays honest** — on the independent path an Epic marked done enough still runs integrated validation.
  Outcomes no child claimed are accepted gaps; a claimed outcome that fails is a failure, not a gap. Owner acceptance
  can end this path as `user_validated`, with those distinctions preserved.
- **Integrated failures reopen planning, not execution** — a failing Epic validation returns the full report to Planner
  and produces a focused child Plan whose validation contract names the failed outcomes.
- **A verified Epic branch is proven, not shipped** — `verified` means the branch is ready to merge and the merge stays
  the user's decision in this PROJECT.
- **QUICK_FIX remains stable** — no-plan QUICK_FIX behavior and its existing Mechanical Validation path do not change.
- **Existing behavior remains protected** — Plan sharing/collaboration, Plannotator review, Plan Board, Epic dependency
  selection, worktree execution, non-Git execution, Pair Execution, semantic repair, recovery, archive/restore, and
  publication continue through package authorities.
- **Behavior expected to stop existing** — no executable Plan is identified solely by a `.md` filename; Engineer is not
  instructed to run or claim the full validation contract; Manual QA is not a substitute for independent validation;
  semantic review does not repair omitted Plan intent; `task_completed` is not reused as a universal repair or
  validation transition; Epic children do not publish into the primary branch by default; and an Epic does not reach
  `verified` on attestation alone.

## Edge Cases & Considerations

- Package migration includes unfinished attempts and permits partial progress. Serialize each conversion with current
  writers and preserve worktree authority, approval history, and sealed publication evidence. The release advisory must
  name the unmanaged branches and worktrees outside automatic migration scope.
- Package hashes need explicit inclusion rules. Approved specification artifacts belong to the revision; generated QA,
  execution reports, and mutable owner checkboxes do not.
- Validator may execute tests, browser checks, and temporary probes but remains read-only with respect to production
  code and approved package artifacts. Ephemeral evidence must live outside the candidate and cannot affect its diff.
- Validation Repair Engineer, Review Repair Engineer, and Plan-Revision Repair Engineer share the candidate worktree but
  receive different bounded evidence and may not edit lifecycle metadata.
- A Plan defect is not an ordinary test failure. It means the approved specification can pass while the objective fails,
  is contradictory, lacks required authority/information, or cannot define success. Because this should be rare, an
  Agent only proposes the defect with evidence and the user decides whether planning reopens.
- `validating`, `reviewing`, and optional `awaiting_owner_review` should be durable milestone statuses; detailed stages
  belong in a separate resumable field so the board remains legible.
- Direct user edits remain supported. Package-level compare-and-set must preserve user-owned Markdown without allowing
  partial approval of mismatched artifact revisions.
- "Every child is settled" needs one definition. Verified, user-verified, closed without verification, and explicitly
  excluded children all settle; a child still in `failed`, `implemented`, or `in_progress` does not. An Epic must not
  reach `implemented` while a child is mid-flight.
- Moving `epic_done_enough` from `verified` to `implemented` changes a documented board rule. `docs/plan-lifecycle.md`
  currently names it as the one exception that reaches `verified` without Workflow Validation; that exception goes away
  and existing done-enough Epics need a defined read after migration.
- An Epic branch can live for weeks while the primary branch moves. This PROJECT proves the Epic branch in isolation and
  deliberately stops there. Proving the Epic against current primary-branch content belongs to
  `epic-branch-publication-workflow`, and the gap between the two is a known and accepted risk until that PROJECT lands.
- The Epic branch default must not break single-child Epics, non-Git projects, or Epics the user explicitly wants to
  publish per child. The override has to be reachable through ordinary Plan feedback, not only at Architect time.
- Integrated validation runs against work that is already merged into the Epic branch, so it has no candidate diff of
  its own. Semantic review at Epic level is out of scope: each child has its own review or explicit user acceptance.
  Integrated success does not retroactively claim that an owner-accepted child passed AI review.
- The prerequisite capabilities are present and the validation authority model has been re-audited. Decomposition must
  wait for the unresolved contracts below, not for obsolete prerequisite filenames.

### Decisions still needed after the resumed audit

- **Status language:** Resolve current `validated` code versus `verified` glossary and draft language. Preserve the
  difference between proof of an Epic branch and delivery of that branch; the dependent publication Epic uses that
  distinction.
- **Package approval:** Define approved content separately from mutable lifecycle fields, child packages, generated
  artifacts, and controller records. Specify durable approval evidence and recovery from interrupted multi-file writes.
- **Legacy approval:** Define how existing approved and unfinished Plans acquire `validation.md` without pretending
  newly authored acceptance criteria were approved before migration. Format-only conversion may preserve approval only
  with evidence that the approved content is unchanged. Missing or ambiguous validation content needs an explicit rule.
- **Epic proof:** Bind a validation result to one assembled commit and one approved Epic contract. Define the temporary
  checkout owner, stale-result handling, and child settlement based on delivered content rather than status alone.
- **Branch policy changes:** Define the branch creation base and how owner feedback affects draft children versus active
  worktrees. Do not silently retarget an active execution attempt.
- **Validation environment:** Define which test outputs are allowed, how the candidate is protected from test side
  effects, and when changed commands or configuration require renewed package approval.
