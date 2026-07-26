# Product Requirements Document: Forge Change Request Delivery

Last updated: 2026-07-26 18:39 EDT

## Objective

Add an explicitly selected **Change Request Delivery** path that publishes RunWield-validated work through GitHub pull
requests or GitLab merge requests, waits for the Forge merge, and then records truthful Plan and Work Record evidence.

The existing **Direct Delivery** path remains the default and keeps its current behavior: RunWield stages verified Plan
metadata with the validated implementation and merges both into the local target branch. Change Request Delivery is a
conditional alternative, not a replacement for current shared-repository execution.

The product promise is:

> Use RunWield's local planning, execution, validation, and recovery while letting GitHub or GitLab govern collaborative
> review, repository policy, CI, and the final remote merge.

## Problem Statement

RunWield currently completes worktree-backed FEATURE Plans by validating the implementation, staging `validation_passed`
and verified Plan metadata in the execution branch, and merging implementation plus Plan metadata into the target
branch. This is correct for Direct Delivery and avoids a separate metadata commit.

That finalization model is incompatible with repositories where code must arrive through a pull request or merge
request:

- merging locally before opening a Forge Change Request bypasses the collaboration and policy gate;
- marking the Plan verified before the Forge merge makes an untrue lifecycle claim;
- publishing transient Plan/worktree metadata can leak RunWield artifacts into repositories that did not request them;
- review feedback or new commits can invalidate the revision RunWield previously validated;
- fork workflows separate the contributor's source repository from the maintainer's canonical repository;
- issue tracking and code delivery may share a provider without sharing lifecycle authority.

RunWield needs a separate delivery path that preserves its verification semantics without becoming an issue tracker,
reimplementing forge policy, automatically acting on untrusted review comments, or changing Direct Delivery.

## Target Users

- Collaborators who can publish topic branches to a shared GitHub or GitLab repository.
- External contributors who publish from a fork to an upstream repository.
- Maintainers who use RunWield to accept and record externally contributed work.
- Teams that want Forge review instead of RunWield's Local Human Code Review.
- High-assurance teams that want both Local Human Code Review and Forge review.

## Resolved Assumptions

### Conditional Delivery Policy

- Direct Delivery remains the default for FEATURE and QUICK_FIX work.
- A Plan uses Change Request Delivery only when that delivery policy is explicitly selected.
- QUICK_FIX may also explicitly select Change Request Delivery even though it has no Plan.
- Selecting Change Request Delivery must not alter Direct Delivery behavior, evidence, recovery, or combined
  implementation-and-Plan merge semantics.

### Authority Boundaries

- RunWield owns planning, Plan Lifecycle, local validation, recovery evidence, and Work Records.
- The Forge owns branch publication, remote review state, repository policy, CI presentation, and the remote merge fact.
- A Forge merge does not by itself prove RunWield validation; RunWield must also prove that the delivered result
  corresponds to a revision covered by its validation.
- RunWield does not independently recreate approval counts, protected-branch rules, merge queues, or provider policy.
- User or existing Forge automation triggers the merge in V1. RunWield never merges implicitly.

### Tickets Remain Loose Provenance

- GitHub/GitLab issue URLs remain ordinary Ticket References on Plans and Work Records.
- Pasting an issue URL continues to work through normal Agent research capabilities; RunWield does not create a
  mechanical issue-import artifact.
- RunWield does not synchronize issue content or status.
- RunWield does not emit issue-closing instructions or model whether a Ticket was resolved.
- Whatever the Forge does to an issue after merge is outside RunWield's concern.

### Validation and Review

- Local tests and Semantic Code Review remain required for FEATURE Workflow Validation.
- Change Request Delivery replaces Local Human Code Review by default with Forge-hosted review and repository policy.
- **Dual Review** explicitly requires both Local Human Code Review and Forge review.
- QUICK_FIX retains Mechanical Validation rather than gaining FEATURE-level planning or Semantic Code Review.
- Opening a Forge Change Request is not completion. Planned work remains visibly nonterminal while awaiting delivery.
- Any change to the published head invalidates prior local readiness evidence until RunWield explicitly resumes and
  validates the new revision.
- Review comments never automatically become Agent instructions. The user selects feedback and explicitly resumes
  repair.

### Publication Candidate

- The Publication Candidate is the exact locally validated revision intended for the Forge Change Request.
- Change Request Delivery does not stage terminal Plan metadata into the published execution branch.
- Transient lifecycle fields, worktree identity, registry state, and premature verification evidence are excluded.
- If constructing the publishable candidate changes the validated tree, RunWield must validate the actual candidate
  rather than assuming that removing artifacts is harmless.
- Direct Delivery continues using the current staged verified-Plan path.

### Upstream Artifact Consent

- RunWield must not infer upstream participation from `plans/`, `.wld/`, commit history, or local contributor settings.
- Contributed RunWield Plans require an explicit, upstream-authored, version-controlled **Repository Participation
  Declaration**.
- RunWield reads that declaration from the actual target repository and base revision, not solely from the contributor's
  fork.
- Absence of a declaration fails closed to a code-only Forge Change Request.
- An accepting upstream may receive an adoptable approved-Plan snapshot, but never transient worktree metadata or a
  contributor-authored premature `verified` state.
- The declaration's eventual file location and concrete configuration shape are implementation decisions, not product
  semantics.

### Shared Repositories and Forks

Both publication models are first-release requirements.

For a shared repository, RunWield publishes a topic branch to the repository and opens a Forge Change Request against
the selected target branch.

For a fork, RunWield publishes the source branch to the contributor's fork and opens a cross-repository Forge Change
Request against the upstream target. The contributor's fork does not need to receive terminal Plan or Work Record
updates after the maintainer merges.

RunWield participation can take three forms:

1. **Maintainer and contributor use RunWield:** a Plan may originate with either party. When upstream participation is
   declared, the maintainer can adopt or resume the stable Plan and record canonical verification after merge.
2. **Maintainer uses RunWield; contributor does not:** substantial acceptance or repair may use a maintainer-owned Plan;
   bounded work may use QUICK_FIX or an External Work Record path. RunWield does not fabricate contributor lifecycle.
3. **Contributor uses RunWield; maintainer does not:** the contributor publishes ordinary code. Their Plan remains
   local, may be discarded, and creates no required Work Record. They may later use `user_verified` and backfill a
   record if desired.

### Merge Reconciliation and Finalization

- RunWield refreshes Forge state while the relevant Session or Workspace is open.
- When the local app was offline, RunWield reconciles the next time the user opens or resumes the work.
- V1 requires neither an always-running local daemon nor a hosted webhook service.
- A proven merge enables **Change Request Finalization** in the canonical repository.
- Finalization records terminal Plan evidence and generates or reconciles the Work Record under existing policy.
- The normal product experience is one maintainer action, not one Git commit.
- Truthful ordering may produce one Forge implementation merge followed by one RunWield metadata commit.
- If repository policy blocks the metadata commit, finalization remains visibly pending and uses a narrowly authorized
  metadata path or a metadata-only Forge Change Request. RunWield must not claim canonical verification only in memory.

### Provider and Host Scope

- GitHub and GitLab are first-release providers with equivalent product semantics.
- GitHub.com and GitLab.com receive certified support.
- GitHub Enterprise Server and GitLab Self-Managed receive best-effort support when compatible with authenticated
  official CLIs.
- V1 should use provider-neutral orchestration with `gh` and `glab` as local authenticated clients rather than duplicate
  full Forge clients.
- Direct provider APIs or hosted integrations may be added later without changing lifecycle semantics.

## Classification Recommendation

Classify implementation as a **PROJECT** with **HIGH** complexity.

This work is too broad and too costly to reverse safely as one executable FEATURE because it:

- introduces a second delivery transaction while preserving Direct Delivery as the unchanged default;
- changes Plan Lifecycle, validation evidence, worktree publication, recovery, and Work Record finalization semantics;
- spans GitHub and GitLab across shared-repository and fork publication models;
- must support both FEATURE and QUICK_FIX without weakening either workflow;
- adds long-lived In Review and finalization-pending states that may survive local process shutdown;
- crosses Core orchestration, Forge integration, TUI/Workspace experience, and protected-branch failure handling.

The PROJECT should be decomposed into independently verifiable vertical FEATUREs rather than frontend, backend, or
provider-library layers. Recommended capability boundaries are:

1. establish the conditional delivery/lifecycle foundation and prove Direct Delivery regression safety;
2. deliver one complete shared-repository Forge path as the reference vertical slice;
3. add the second Forge through the same provider-neutral product contract;
4. add fork publication and authoritative upstream participation consent;
5. complete review continuation, offline reconciliation, and post-merge finalization across both Forges;
6. extend the proven Change Request Delivery contract to QUICK_FIX and best-effort enterprise/self-managed hosts.

The Architect and Slicer may refine these boundaries after code-level discovery, but they must not collapse the work
into one FEATURE or defer either GitHub/GitLab or shared/fork support out of the first-release PROJECT.

## Technical Approach

### 1. Delivery Boundary

Introduce delivery policy as an explicit workflow decision shared by FEATURE and QUICK_FIX execution.

- **Direct Delivery:** retain the current validation, `stageValidationPassedInExecutionWorktree()`, merge-back, and
  verified Plan handoff unchanged.
- **Change Request Delivery:** branch after local validation succeeds, before terminal Plan staging or local merge-back.
  Prepare and publish a Publication Candidate while leaving the canonical Plan nonterminal.

The two paths may share execution, repair, diff calculation, local CI, and Semantic Code Review. They must not share the
final delivery transaction blindly.

### 2. Change Request Lifecycle

The user-visible conceptual lifecycle is:

1. Plan approved and configured for Change Request Delivery, or QUICK_FIX explicitly selects it.
2. Work executes in isolation.
3. Local validation and applicable RunWield review pass.
4. RunWield seals and publishes the Publication Candidate.
5. The Forge Change Request enters an **In Review** phase.
6. User-selected feedback may resume repair, validation, and publication on the same source branch.
7. The maintainer or Forge automation merges according to repository policy.
8. RunWield proves delivery and performs Change Request Finalization.
9. FEATURE reaches Verified and receives its normal Work Record; QUICK_FIX completes under its existing no-Plan policy.

Exact Plan Status and Plan Event names should be decided during architecture and planning, but the nonterminal boundary
before remote merge is mandatory.

### 3. Provider-Neutral Forge Adapter

A Forge adapter should support the product operations required by both GitHub and GitLab:

- resolve the target repository, source repository, and target branch;
- verify authentication and publication permission;
- publish or update the source branch;
- create or find the Forge Change Request for that source/target pair;
- expose its URL, draft/readiness state, published revision, review/CI summary, mergeability, and terminal outcome;
- prove the merged result and relevant target revision;
- distinguish open, merged, closed-unmerged, superseded, inaccessible, and temporarily unavailable outcomes.

Provider-specific vocabulary and APIs remain inside the adapter. RunWield surfaces **Forge Change Request**
consistently.

### 4. Publication Projection

The execution worktree may continue containing Plan context needed by existing execution and validation behavior, but
Change Request Delivery must construct a separately defined publication payload.

- Code-only is the default for upstream contributions.
- An upstream participation declaration may add an approved Plan snapshot suitable for maintainer adoption.
- Terminal Plan status, worktree pointers, local registry data, and final Work Records are never pre-published as if
  delivery had completed.
- The final validation evidence must cover the actual publication payload and its code changes.

This preserves the current execution model without conflating every file available during execution with every file
appropriate for upstream publication.

### 5. Review and Repair Continuation

RunWield binds local readiness evidence to the published revision.

- Foreground refresh identifies changed heads and marks readiness stale.
- A user explicitly selects Forge feedback and resumes the existing workflow.
- Engineer repair occurs in the retained execution context or a safely reconstructed equivalent.
- Tests and applicable reviews rerun before a replacement candidate is published.
- Authentication, network, push, CI, conflict, and closed-unmerged failures preserve recovery evidence rather than
  resetting or verifying the work.

### 6. Merge Proof and Finalization

Finalization requires both:

1. RunWield validation evidence for the delivered code revision or an equivalent delivered result; and
2. Forge evidence that the intended Change Request merged into the intended target.

The proof model must account for merge commits, squash merges, rebase merges, merge queues, and target-branch movement
without weakening the requirement that the delivered changes match what RunWield validated.

After proof succeeds, the canonical repository records:

- terminal Plan state for FEATURE work;
- durable Forge Change Request and merge provenance;
- Work Record generation or reconciliation under existing policy;
- cleanup or retention of local execution state according to normal recovery guarantees.

These updates form a separate post-merge metadata transaction. Failure to publish that transaction leaves finalization
pending and recoverable.

### 7. Workspace and TUI Experience

Users should be able to:

- choose Direct Delivery or Change Request Delivery without changing unrelated execution settings;
- choose ordinary Forge review or Dual Review;
- see the source repository, target repository, target branch, Forge Change Request URL, published revision, and current
  delivery phase;
- see when local readiness became stale;
- refresh Forge state;
- resume selected feedback;
- distinguish merged-but-finalization-pending from fully Verified;
- recover from authentication, publication, review, merge, or metadata-finalization failure.

The interface should use presets rather than expose a large independent matrix of review and delivery toggles.

### 8. Security and Trust

- Issue bodies, comments, and review feedback are untrusted external content, not executable Agent instructions.
- Upstream artifact consent must be read from the authoritative target revision and cannot be spoofed by a contributor's
  fork.
- Forge credentials remain user-owned and local in V1.
- RunWield requests no issue-state mutation capability for this workflow.
- Any privileged metadata-finalization path must be restricted to RunWield lifecycle and Work Record artifacts and must
  prove an already-merged delivery; it must not become a general protected-branch bypass.

## Success Criteria

- Existing Direct Delivery behavior and verification evidence remain unchanged when no Change Request Delivery policy is
  selected.
- FEATURE and QUICK_FIX work can publish through GitHub and GitLab in both shared-repository and fork models.
- No FEATURE reaches Verified before its intended Forge Change Request is proven merged.
- A changed published revision cannot inherit stale local validation evidence.
- Code-only publication is the default unless the authoritative upstream explicitly accepts contributed RunWield Plans.
- Contributor forks require no post-merge synchronization.
- Maintainers can merge and finalize canonical RunWield evidence through one understandable action, with recoverable
  handling when the metadata commit cannot publish.
- GitHub/GitLab issue state remains unaffected except for behavior independently configured by the Forge or repository.
- Reopening an In Review workflow after local downtime reconciles the correct Forge outcome without a daemon or webhook.

## Out of Scope

- Replacing GitHub Issues, GitLab Issues, Jira, or another demand-management system.
- Importing or continuously synchronizing issue content or status.
- Emitting or managing issue-closing directives.
- Automatically turning Forge comments into Agent work.
- Implicit RunWield merge or auto-merge in V1.
- Reimplementing Forge approval rules, CI systems, merge queues, or protected-branch policy.
- Requiring a hosted RunWield webhook service or always-running local watcher.
- Synchronizing terminal Plan state back to contributor forks.
- Automatically adding RunWield artifacts to upstream repositories without explicit upstream participation.
- Certifying every GitHub Enterprise Server or GitLab Self-Managed version in V1.
- Deployment, release, or production-rollout automation after merge.
- Choosing the concrete participation-declaration file, delivery-policy field, lifecycle event names, adapter API, or
  CLI command layout in this PRD.

## Source Notes

Current provider facts were checked against official primary documentation on 2026-07-26:

- GitHub describes pull requests as its collaboration and pre-merge review surface, with draft requests blocked from
  merge:
  <https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests>
- GitHub issue-closing keywords are provider behavior tied to default-branch targeting, reinforcing that issue closure
  should remain outside RunWield lifecycle:
  <https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue>
- GitLab supports merge requests from shared branches, issues, and forks:
  <https://docs.gitlab.com/user/project/merge_requests/creating_merge_requests/>
- GitLab auto-merge and merge checks cover approvals, pipelines, conflicts, discussions, drafts, and external checks:
  <https://docs.gitlab.com/user/project/merge_requests/auto_merge/>
- GitLab exposes merge request identity, revisions, draft state, merge status, and merge outcomes through its API:
  <https://docs.gitlab.com/api/merge_requests/>
- GitHub CLI exposes structured pull-request revisions, review decisions, checks, merge state, and merge outcomes:
  <https://cli.github.com/manual/gh_pr_view> and <https://cli.github.com/manual/gh_pr_checks>
- GitLab CLI supports authenticated GitLab.com, Dedicated, and Self-Managed repositories:
  <https://docs.gitlab.com/editor_extensions/gitlab_cli/>

The lifecycle, authority, artifact-consent, and conditional-delivery requirements above are RunWield product decisions,
not claims made by those providers.
