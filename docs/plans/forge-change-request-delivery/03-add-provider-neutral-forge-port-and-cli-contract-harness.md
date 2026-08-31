---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "docs/prd/forge-change-request-delivery-prd.md"
    - "src/shared/workflow/"
    - "src/testing/"
    - "src/shared/git-test-fixture.ts"
executionAgent: "engineer"
createdAt: "2026-08-31T02:51:47.940Z"
status: "draft"
origin: "internal"
parentPlan: "forge-change-request-delivery"
order: 3
dependencies:
    - "02-add-forge-delivery-attempt-state-and-coordinator-skeleton"
planId: "245864a5-0b1c-480e-8712-62f0ae54a6fb"
targetBranch: "project/forge-change-request-delivery"
---

# Add provider-neutral Forge port and CLI contract harness

## Context

The coordinator must not contain GitHub-only or GitLab-only lifecycle logic. It needs one small provider-neutral
interface that returns normalized repository, request, revision, review/check, and merge facts.

## Objective

Add the Forge port interface and a contract harness for official `gh` and `glab` CLI adapters. The harness proves
provider vocabulary stays inside adapters and only independently varying external operations cross the seam.

## Approach

Design a deep port: few operations, normalized results, and explicit error categories. The adapter can shell out to `gh`
or `glab`, but it cannot mutate Plans, controller state, worktree records, or Work Records.

```text
Coordinator
  -> ForgePort.resolveRepository
  -> ForgePort.preflight
  -> ForgePort.publishSourceRef
  -> ForgePort.createOrFindRequest
  -> ForgePort.refreshRequest
  -> ForgePort.proveMerge
```

The option set aside is a broad wrapper over every provider command. That would make tests learn provider details and
would leak lifecycle decisions into adapters.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `docs/prd/forge-change-request-delivery-prd.md` — reconcile settled port terms without widening provider scope.
- New Forge port and adapter modules under `src/shared/workflow/` — define normalized operations and official CLI
  implementations.
- `src/testing/` — add CLI-output fixtures and external-process contract tests.
- `src/shared/git-test-fixture.ts` — reuse real repository fixtures where provider contract tests need Git facts.

## Reuse Opportunities

- Existing subprocess seams — use them for `gh` and `glab` because these are external capabilities.
- `defineGitFixture` — model local Git repository identities and refs without fake RunWield-owned machinery.
- Publication test patterns — reuse failure matrices for timeout, retry, and duplicate external-effect handling.

## Implementation Steps

- [ ] A provider-neutral Forge port type exposes only repository resolution, authentication/permission preflight,
      source-ref publication, create-or-find request, request refresh, selected feedback read, and merge proof
      operations.
- [ ] GitHub and GitLab CLI adapters normalize equivalent observations into the same application shapes.
- [ ] Adapter results distinguish open, merged, closed-unmerged, superseded, inaccessible, temporarily unavailable,
      stale source, and unsupported capability outcomes.
- [ ] Provider names, command output shapes, and optional fields remain inside adapters and tests.
- [ ] Contract tests can run against deterministic command fixtures without adding seams for Plan, lifecycle, registry,
      or Work Record machinery.
- [ ] Provider output and errors are treated as untrusted text and never become shell fragments, file paths, lifecycle
      events, or Agent instructions.

## Verification Plan

- Automated: run focused Forge port and adapter contract tests with `deno run -A scripts/run-tests.js <test paths>`.
- Automated: prove GitHub and GitLab fixtures produce the same normalized shapes for equivalent scenarios.
- Automated: prove malformed or hostile provider output is handled as data, not instructions or shell input.
- Automated: run `deno task seams:check`.
- Expected result: the coordinator can depend on one Forge contract, but real GitHub/GitLab delivery is still gated
  until later children connect scenarios.

## Edge Cases & Considerations

- Provider CLI behavior may drift; child planning must recheck official CLI behavior before implementation.
- Enterprise/self-managed support should not be certified here; it should report capability facts only when known.
- Keep idempotency marker behavior in the contract so retries can find existing requests.
