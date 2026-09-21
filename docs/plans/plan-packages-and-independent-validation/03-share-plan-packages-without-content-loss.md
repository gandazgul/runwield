---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/collaboration/"
    - "src/cmd/plans/share.ts"
    - "src/cmd/plans/push.ts"
    - "src/cmd/plans/pull.ts"
    - "src/plan-store.js"
    - "docs/prd/runwield-workspace-prd.md"
executionAgent: "engineer"
createdAt: "2026-09-21T17:13:57.222Z"
status: "draft"
origin: "internal"
parentPlan: "plan-packages-and-independent-validation"
order: 3
dependencies:
    - "01-establish-plan-package-storage"
    - "02-author-and-approve-complete-plan-packages"
targetBranch: "epic/plan-packages-and-independent-validation"
planId: "a3ab5ce4-21be-466c-868d-e355060e82e8"
---

# Share Plan Packages Without Content Loss

## Context

Current collaboration encrypts and transfers one Plan body. A package-aware local store would still lose `validation.md`
if push, pull, sharing, and revision conflicts kept using the old payload. Remote-canonical ownership also means
migration or package writes cannot treat a shared package as ordinary local content.

This child provides one complete package collaboration journey. It does not change access ownership, encryption,
capability handling, or add a new remote service.

## Objective

Transfer the same authored manifest used for approval through encrypted collaboration, detect conflicts across every
authored document, and refuse compatibility paths that would silently omit package content.

## Approach

Version the encrypted collaboration payload around the authored package manifest. Hash and compare canonical authored
content as a unit, but retain per-document information needed to explain conflicts and save safely. Negotiate or
validate peer format support before a remote revision is accepted.

The option set aside is embedding `validation.md` into the old Plan body for transport; that would destroy document
identity and make local approval differ from shared approval.

## Expected Change Surface

The boundaries below are guidance, not an allowlist: verify the real footprint during implementation and change whatever
the Implementation Steps need, including files not named here. Stop and report only when discovery changes approved
intent — the change reaches another subsystem, public behavior or architecture shifts, migration or compatibility risk
grows, or the Verification Plan no longer proves the objective.

- `src/shared/collaboration/` — versioned encrypted package payloads, compatibility, and conflict representation.
- `src/cmd/plans/share.ts`, `src/cmd/plans/push.ts`, and `src/cmd/plans/pull.ts` — package-wide command behavior and
  recovery messages.
- `src/plan-store.js` — package transactions and remote-canonical write restrictions used by collaboration.
- `src/cmd/plans/collaboration-commands.integration.test.ts` — real package sharing and conflict coverage.
- `docs/prd/runwield-workspace-prd.md` — update Shared Plan collaboration requirements and scenarios.

## Reuse Opportunities

- Existing collaboration encryption, content keys, maintainer and reviewer capabilities, and redaction.
- Existing collaboration revision checks and remote-canonical metadata.
- The authored manifest and package transaction from the preceding children.
- Current command integration fixtures and local Plan Server test support.

## Implementation Steps

- Shared revisions contain a versioned ordered authored package manifest and encrypted content for every authored
  document covered by approval.
- Share, push, and pull compare package revisions rather than only the `plan.md` body, so a validation-only change
  creates and transfers a real revision.
- Pull applies the complete remote package through one package transaction and does not expose a mixed local revision if
  interrupted.
- Conflict reporting identifies changed package members and preserves local and remote content without selecting a
  winner from timestamps or file shape.
- A peer or payload format that supports only one body produces a clear compatibility error before success is reported;
  no path silently drops `validation.md`.
- Remote-canonical ownership, capabilities, encryption, secret redaction, and reviewer versus maintainer permissions
  retain their existing meaning.
- Generated QA, reports, lifecycle records, and child package content are not added to the authored collaboration
  payload.
- Workspace Shared Plan collaboration requirements and acceptance scenarios match delivered package publish, pull,
  conflict, and compatibility behavior.

## Verification Plan

- Automated: run `deno run -A scripts/run-tests.js src/cmd/plans/collaboration-commands.integration.test.ts` plus
  focused collaboration module tests discovered during planning.
- Automated: prove a `validation.md`-only edit pushes, pulls, and conflicts correctly while unchanged generated QA
  creates no authored revision.
- Automated: prove a single-body peer receives a compatibility failure and the remote and local revisions remain
  unchanged.
- Automated: interrupt package pull at each transaction boundary and prove readers see one committed revision and local
  unexpected edits survive.
- Automated: preserve capability, encryption, redaction, revision-order, and remote-canonical write restrictions from
  existing tests.
- Automated: run `deno task seams:check` and `deno task ci`.
- Manual: share a package, change each authored document on different peers, and confirm the conflict explains both
  changes without exposing secrets.
- Documentation: confirm the Workspace PRD describes package-wide sharing and does not claim generated reports are
  synchronized authored intent.

## Edge Cases

- Unknown future authored companion paths need a forward-compatible manifest or an explicit compatibility failure.
- A successful remote append followed by failed local metadata update must retain the current recovery command and avoid
  duplicate revision creation.
- Local migration cannot publish a remote-canonical package or bypass maintainer ownership.
- Malformed, duplicate, or path-traversing manifest entries must fail before decryption output is written.
