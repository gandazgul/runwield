---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Update the Workspace, Core, and ACP product documents so Personal Remote Workspace v1 is specified around exclusive Session activation, durable checkpoints, automatic synchronization, and trust-separated owner Workspace surfaces."
affectedPaths:
    - "docs/prd/runwield-workspace-PRD.md"
    - "docs/prd/runwield-core-prd.md"
    - "docs/prd/runwield-acp-session-host-PRD.md"
    - "docs/adr/011-exclusive-session-activation-and-durable-workflow-checkpoints.md"
frontend: false
createdAt: "2026-07-22T03:56:51.405Z"
updatedAt: "2026-07-22T03:56:51.405Z"
status: "draft"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 1
dependencies:
    []
---

# Align Personal Workspace PRDs with ADR-011

## Context

Personal Remote Workspace v1 depends on an accepted architecture where TUI, Workspace, and ACP remain sibling
`SessionRuntime` consumers. Cross-surface continuity is provided by exclusive Session activation, durable workflow
checkpoints, automatic idle-client synchronization, and Plan Workflow Leases rather than a central Workspace-owned live
Runtime proxy.

The existing PRDs contain partially stale language around future Session Host behavior and Workspace authority. This
slice aligns the durable product specification before executable slices build against it.

## Objective

Revise the Workspace, Core, and ACP PRDs so they consistently describe the v1 product and architecture boundaries:

- owner-local Personal Workspace over a trusted private network with paired browser devices;
- stable RunWield Session identity mapped to Project and Pi transcript locators;
- exclusive writable Session activation with read-only synchronization for idle surfaces;
- durable typed checkpoints for human gates and resumable workflow decisions;
- Session-owned Plan Workflow Leases around Plan lifecycle and worktree effects;
- trust separation between owner Workspace, public Shared Space capabilities, and future SaaS seams.

## Approach

Treat ADR-011 as the controlling decision and update PRDs to be current-vs-future references rather than
implementation-history notes. Keep documents product-facing enough to guide future agents while spelling out the
invariants that later code slices must preserve. Amend ADR-011 only for clarity or if the PRD alignment uncovers a hard
contradiction.

## Files to Modify

- `docs/prd/runwield-workspace-PRD.md` — replace central authoritative live-host assumptions with Personal Workspace
  ownership, activation, checkpoint, pairing, dashboard, search, and Code Surface requirements.
- `docs/prd/runwield-core-prd.md` — align Core roadmap with existing sibling Runtime foundation and the new owner
  coordination requirements.
- `docs/prd/runwield-acp-session-host-PRD.md` — specify ACP load/continuation participation in activation and
  checkpoints without making ACP a Workspace child.
- `docs/adr/011-exclusive-session-activation-and-durable-workflow-checkpoints.md` — amend only if needed to resolve
  discovered inconsistencies.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `plans/personal-remote-workspace-v1.md` — use the Epic as the source for v1 scope, verification, and deferred work.
- `docs/adr/011-exclusive-session-activation-and-durable-workflow-checkpoints.md` — use as the authoritative
  architecture decision.
- `docs/prd/runwield-core-prd.md` — preserve current-vs-future PRD style and avoid transient implementation history.

## Implementation Steps

- [ ] Review all three PRDs for language implying simultaneous writable attachment, Workspace-as-Runtime-proxy, or
      ACP/TUI dependency on Workspace application services.
- [ ] Update the Workspace PRD with the Personal Workspace v1 journey, Project registration, device pairing, Attention
      Dashboard, remote Session continuation, durable Plan review, search, and Code Surface scope.
- [ ] Update the Core PRD to describe stable RunWield Session IDs, owner coordination DB responsibilities, activation
      leases, committed generations, checkpoint seams, and Plan Workflow Leases.
- [ ] Update the ACP PRD to describe stable Session mapping, activation-aware loading, checkpoint continuation, and safe
      rejection when another surface owns mutation.
- [ ] Ensure all documents preserve deferred seams for per-Project workers, SaaS containers, Sourcebot/global code
      intelligence, and Shared Space evolution without promising them in v1.
- [ ] Run formatting for the documentation changes.

## Verification Plan

- Automated: run
  `deno fmt --check docs/prd/runwield-workspace-PRD.md docs/prd/runwield-core-prd.md docs/prd/runwield-acp-session-host-PRD.md docs/adr/011-exclusive-session-activation-and-durable-workflow-checkpoints.md`.
- Manual: read the revised PRDs and confirm they describe one coherent architecture: sibling adapters, exclusive
  activation, durable checkpoints, automatic read synchronization, Session-owned Plan workflow leases, and
  trust-separated Shared Space.
- Manual: confirm the docs still support existing local TUI, ACP, one-checkout Plan UI, Shared Plan, non-Git, and
  QUICK_FIX behavior unless the new ownership invariant explicitly constrains it.

## Edge Cases & Considerations

- Avoid turning PRDs into low-level schema specs; later slices own implementation details.
- Do not remove future SaaS or Session Host context where it remains useful, but label it as future/open rather than v1
  behavior.
- Keep ADR-011 stable unless a real contradiction is found.
