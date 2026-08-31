---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "docs/prd/forge-change-request-delivery-prd.md"
    - "docs/domain-language.md"
    - "docs/plan-lifecycle.md"
    - "src/shared/workflow/"
    - "src/shared/worktree-registry.js"
    - "src/shared/isolated-publication.ts"
    - "src/shared/work-records/"
    - "src/testing/"
executionAgent: "engineer"
createdAt: "2026-08-31T02:51:47.988Z"
status: "draft"
origin: "internal"
parentPlan: "forge-change-request-delivery"
order: 8
dependencies:
    - "07-prove-gitlab-merge-and-finalize-planned-delivery"
planId: "a4159d9a-f10d-4f10-a44d-3e59dcfdb47e"
targetBranch: "project/forge-change-request-delivery"
---

# Add fork delivery and upstream participation consent

## Context

First-release scope includes shared repositories and forks. Fork delivery separates the contributor source repository
from the upstream target. It also creates a consent risk: the contributor fork cannot grant permission to include
RunWield Plan artifacts in the upstream.

## Objective

Add fork delivery for GitHub and GitLab through the same Forge contract. Use code-only publication by default, and
include any RunWield Plan snapshot only when the authoritative upstream base revision contains a valid Repository
Participation Declaration.

## Approach

Model repository identity as provider stable IDs plus canonical host/path, not remote aliases. Read participation
consent from the upstream target at the actual base revision before deciding the publication projection.

```text
fork delivery
  source repo = contributor fork
  target repo = upstream
  upstream base has declaration?
    yes -> allowed Plan snapshot projection
    no  -> code-only projection
```

The option set aside is to infer consent from `docs/plans/` or prior RunWield commits. That is convenient, but it lets a
fork spoof upstream policy.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `docs/prd/forge-change-request-delivery-prd.md` — reconcile any settled declaration behavior without widening the PRD.
- `docs/domain-language.md` — update Repository Participation Declaration relationships if the implementation changes or
  sharpens them.
- `docs/plan-lifecycle.md` — describe fork delivery, code-only projection, and maintainer finalization ownership.
- Forge coordinator and provider adapters under `src/shared/workflow/` — support shared and cross-repository request
  identities.
- `src/shared/isolated-publication.ts` — support safe source-ref behavior for contributor forks.
- `src/shared/worktree-registry.js` — retain source and target repository identities separately.
- `src/shared/work-records/` — preserve provenance for accepted contributed work when canonical finalization occurs.
- `src/testing/` — add fork and consent fixtures.

## Reuse Opportunities

- Existing Git remote resolution and lease publication code — reuse safe source-ref behavior.
- Forge port repository resolution — reuse normalized repository identity.
- Work Record provenance fields — reuse loose references rather than adding person identity semantics.

## Implementation Steps

- [ ] Forge delivery attempts distinguish source repository, target repository, source branch, target branch, and
      provider-stable identities.
- [ ] GitHub and GitLab fork requests use the contributor fork as source repository and open against the upstream target
      through the same coordinator path.
- [ ] The publication projection is code-only unless the authoritative upstream base revision contains a valid
      Repository Participation Declaration.
- [ ] A declaration present only in the fork, contributor settings, prior RunWield commits, or inferred repository shape
      cannot permit Plan artifact publication.
- [ ] Maintainer finalization in the canonical repository owns terminal Plan and Work Record claims; contributor forks
      do not require post-merge synchronization.
- [ ] Shared-repository delivery still behaves as before after fork support is added.

## Verification Plan

- Automated: run focused fork delivery, participation declaration, projection, and provider parity tests with
  `deno run -A scripts/run-tests.js <test paths>`.
- Automated: prove a fork-only declaration does not permit Plan artifacts in the upstream request.
- Automated: prove absence of declaration creates code-only publication.
- Automated: prove a valid upstream-base declaration permits only the allowed Plan snapshot and never transient metadata
  or premature verified status.
- Expected result: fork delivery works for GitHub and GitLab without weakening upstream consent.
- Confirm the glossary describes implemented consent behavior and does not promote unimplemented feedback folding.

## Edge Cases & Considerations

- Remote aliases are not stable enough for persisted repository identity.
- Upstream target movement may require rereading consent at the correct base revision for a replacement candidate.
- External contributor and maintainer person provenance remains loose body text until Workspace identity exists.
