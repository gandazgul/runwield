---
planId: "ba47f287-d055-4076-8571-4403109e6477"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Align the Workspace, Core, and ACP PRDs with ADR-011 by replacing central authoritative Session Host assumptions with exclusive Session activation, Durable Workflow Checkpoints, automatic synchronization, and trust-separated owner Workspace boundaries."
affectedPaths:
    - "docs/prd/runwield-workspace-PRD.md"
    - "docs/prd/runwield-core-prd.md"
    - "docs/prd/runwield-acp-session-host-PRD.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-07-21T23:56:51.405-04:00"
updatedAt: "2026-07-22T14:00:14.318Z"
status: "verified"
origin: "internal"
parentPlan: "personal-remote-workspace-v1"
order: 1
dependencies:
    []
implementedAt: "2026-07-22T13:39:39.646Z"
verifiedAt: "2026-07-22T14:00:14.318Z"
executionReport: "- Updated `docs/prd/runwield-workspace-PRD.md` to replace central live-host/Session Control language with stable Session identity, fenced Session Activation Leases, Durable Workflow Checkpoints, automatic read synchronization, owner coordination DB boundaries, TLS/Origin/CSRF trust notes, and ADR-011 references.\n- Updated `docs/prd/runwield-core-prd.md` to mark `SessionHost`/`HostedSession`, `SessionRuntime`, ACP, Work Records, and Shared Plan lifecycle as current foundations, and to define the next ADR-011 coordination requirements below sibling adapters.\n- Updated `docs/prd/runwield-acp-session-host-PRD.md` so ACP durable `sessionId` maps to stable RunWield Sessions, load/mutation paths are activation-aware, checkpoint/recovery behavior is idempotent, and Workspace remains a sibling Runtime consumer rather than an ACP child or parent.\n- Verification passed: `deno fmt docs/prd/runwield-workspace-PRD.md docs/prd/runwield-core-prd.md docs/prd/runwield-acp-session-host-PRD.md`; `deno fmt --check ...`; `git diff --check -- ...`; `deno task ci`.\n- Text audits passed: no remaining `Session Control` references and no remaining central authoritative Session Host claims in the three PRDs."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
---

# Align Personal Remote Workspace PRDs with ADR-011

## Context

Personal Remote Workspace v1 uses the architecture accepted in
[`ADR-011`](../../docs/adr/011-exclusive-session-activation-and-durable-workflow-checkpoints.md): TUI, Workspace, and
ACP remain sibling `SessionRuntime` consumers with independent in-process Runtimes. Cross-surface continuity comes from
exclusive writable Session activation, Durable Workflow Checkpoints, committed Session generations, automatic read
synchronization, and a separate Session-owned Plan Workflow Lease—not a central Workspace-owned Runtime proxy.

The Workspace, Core, and ACP PRDs contain a mixture of the implemented sibling Runtime foundation and superseded
language about one authoritative persistent Session Host. Aligning these durable product documents first gives later
Personal Remote Workspace child FEATURE Plans one coherent specification.

## Objective

Revise all three PRDs to distinguish current behavior, Personal Remote Workspace v1 requirements, and deferred work
while consistently specifying:

- stable RunWield Session identity mapped to one Project and Pi transcript locator;
- fenced Session Activation Leases for exclusive writable Runtime hydration and mutation;
- committed Session generations and non-mutating synchronization for idle, non-owning surfaces;
- typed, compare-and-set Durable Workflow Checkpoints for cross-surface human gates;
- Session-owned Plan Workflow Leases that remain separate from process activation;
- conservative recovery that never blindly replays uncertain model, command, tool, or filesystem effects;
- owner-only Workspace coordination state separated from canonical artifacts, private Session Transcripts, and public
  Shared Space capability storage.

Per the planning decision for this slice, retire **Session Control** from these PRDs. Describe user-visible behavior
through activation, checkpoint resolution, and read synchronization rather than preserving a separate client-control
abstraction.

## Approach

Treat ADR-011 as the controlling architecture decision and the parent Epic as the v1 product-scope source. Update each
PRD in place as a living current-vs-future reference, preserving valid product journeys and compatibility requirements
while replacing only superseded authority and continuation assumptions.

Keep requirements at product and architectural-boundary level rather than prescribing final SQLite schemas, ACP error
codes, or UI implementation. Do not amend ADR-011 unless execution uncovers a concrete contradiction; none is known at
planning time.

## Files to Modify

- `docs/prd/runwield-workspace-PRD.md` — replace authoritative-host and Session Control language across the problem,
  principles, Session experience, technical approach, acceptance criteria, risks, and sequencing; add activation,
  checkpoint, automatic synchronization, owner-store, and trust-separation requirements.
- `docs/prd/runwield-core-prd.md` — correct stale current/future claims and define the next Core coordination boundary
  below sibling Runtime adapters while preserving local TUI and one-checkout Workspace behavior.
- `docs/prd/runwield-acp-session-host-PRD.md` — specify stable Session mapping, activation-aware ACP loading and
  mutation, durable checkpoint participation, and conservative recovery without making ACP or Workspace a parent of the
  other.

## Reuse Opportunities

Existing documents and patterns to reuse:

- `docs/adr/011-exclusive-session-activation-and-durable-workflow-checkpoints.md` — controlling source for Session
  identity, activation, fencing, checkpoint, synchronization, commit-order, and recovery invariants.
- `plans/personal-remote-workspace-v1.md` — source for the v1 owner journey, trust model, compatibility promises,
  deferred work, and cross-surface acceptance scenarios.
- `CONTEXT.md` — canonical Project, Session, Plan Workflow Lease, Attention Dashboard, Code Surface, Shared Space,
  Approve & Run, and Approve for Later language, except for the explicitly retired Session Control term.
- `docs/prd/runwield-core-prd.md` — retain its current-vs-future organization rather than turning the PRDs into
  implementation-history logs.

## Implementation Steps

- [ ] Build a section-level contradiction checklist before editing: Workspace §§2–4, 6.4–6.6, 7.1, 8–10, and 12; Core
      §§1–2 and 10–12; and ACP §§1–4, 6, and 9–10. Include every assertion of a central authoritative live Host,
      simultaneous writable attachment, or Workspace/ACP parent-child Runtime dependency.
- [ ] Update `docs/prd/runwield-workspace-PRD.md` so its product model and Session journey use stable Session identity,
      exclusive Session activation, committed generations, Durable Workflow Checkpoints, and automatic read
      synchronization. Replace §6.5 Session Control with the activation/checkpoint/read model; require non-mutating
      replay of unseen stable entries, draft preservation, visible current activation ownership, and writable Runtime
      hydration only after lease acquisition.
- [ ] Rewrite the Workspace technical boundary around the owner-only coordination database under `~/.wld/`. State that
      canonical transcript or repository effects commit before fenced SQLite checkpoint/generation publication, and that
      reconciliation routes uncertain effects to explicit recovery. Preserve the existing Attention Dashboard, Project
      registration, device pairing, search, Code Surface, private-network/TLS, and responsive owner journeys.
- [ ] Align the Workspace acceptance criteria, success measures, risks, and sequencing with one-writer activation,
      idempotent checkpoint outcomes, automatic idle-client synchronization, and separate Plan Workflow Leases. Remove
      all Session Control references and central-host mitigations without weakening browser-disconnect continuation or
      multi-Project concurrency requirements.
- [ ] Update `docs/prd/runwield-core-prd.md` to identify `SessionHost`/`HostedSession`, adapter-neutral
      `SessionRuntime`, sibling TUI/ACP consumers, Work Records, and the implemented collaboration lifecycle as current
      foundations rather than future work. Preserve the local TUI and current-checkout Plan UI as supported Core
      surfaces.
- [ ] Replace Core's obsolete Session Host roadmap with the next coordination boundary shared below all adapters: stable
      RunWield Session cataloging, activation enforcement before writable Pi Session Manager access, fencing, committed
      generations, a genuinely non-mutating transcript reader, Durable Workflow Checkpoints, separate Plan Workflow
      Leases, and conservative recovery. Reference ADR-011 and the Personal Remote Workspace PRD rather than duplicating
      low-level design.
- [ ] Update `docs/prd/runwield-acp-session-host-PRD.md` so durable ACP `sessionId` values map to stable RunWield
      Session IDs across process restarts while in-process Runtime IDs remain internal. Specify activation-aware load,
      prompt, cancel, compaction, and continuation; safe mutation rejection when another process owns activation; and no
      writable Pi manager construction before acquisition.
- [ ] Extend the ACP interaction and recovery requirements to use Durable Workflow Checkpoints with expected Session,
      Plan, and Plan Workflow Lease generations and idempotent outcome consumption. Clarify that Workspace can resolve a
      pending durable interaction without loading a second writable Runtime, arbitrary interrupted effects are never
      replayed, first-party Workspace traffic need not route through ACP, and OpenAB/Telegram remains the milestone
      after Personal Remote Workspace.
- [ ] Audit all three PRDs for canonical language and scope consistency: use Session rather than Agent Session for the
      durable user-facing thread; distinguish Session Activation Lease from Plan Workflow Lease; preserve repository
      artifacts and Session Transcripts outside the owner database; and keep owner Workspace authorization/storage
      separate from public Shared Space ciphertext and capabilities.
- [ ] Clearly retain deferred seams without promising them in v1: per-Project OS workers, SaaS containers and tenancy,
      Sourcebot/global code intelligence, token-level cross-process mirroring, automatic takeover, and transparent
      replay of interrupted effects. Update each PRD's status/Last Updated text and cross-references after the content
      is coherent.
- [ ] Format the three changed PRDs and inspect the final diff against ADR-011, the parent Epic, and this Plan's
      consistency checks.

## Verification Plan

- Automated: run
  `deno fmt docs/prd/runwield-workspace-PRD.md docs/prd/runwield-core-prd.md docs/prd/runwield-acp-session-host-PRD.md`.
- Automated/text audit: confirm the three PRDs contain no remaining `Session Control` references and no normative claim
  that one persistent Workspace Session Host is the central live authority or mandatory Runtime proxy for TUI/ACP.
- Manual consistency review: verify all three documents describe stable RunWield Session identity separately from Pi and
  in-process Runtime identities; exclusive fenced activation separately from Plan Workflow Lease ownership; and typed,
  idempotent Durable Workflow Checkpoints separately from arbitrary Runtime continuation.
- Manual synchronization review: verify the Workspace/Core requirements say idle non-owners consume only committed
  generations through a non-mutating reader, replay unseen stable entries, preserve drafts, and do not promise every
  transient token or tool-progress event.
- Manual trust review: verify canonical Plans, PRDs, ADRs, Work Records, source, and Session Transcripts remain outside
  the owner coordination database; owner Workspace device authorization remains separate from Shared Space capabilities
  and ciphertext storage.
- Manual compatibility review: verify the revised PRDs continue to support local TUI, ACP, the one-checkout Plan UI,
  Shared Plans, QUICK_FIX, non-Git Projects, Plan Lifecycle, Workflow Validation, and RunWield worktrees wherever they
  do not violate ADR-011 ownership invariants.
- Expected result: the PRDs provide one current-vs-future product contract for all later Epic slices, with deferred work
  clearly labeled and no contradictory central-host or simultaneous-writer model.

## Edge Cases & Considerations

- `CONTEXT.md` still defines Session Control. The user explicitly retired that term for these PRDs; this Plan must not
  modify the domain glossary. Recommend an Ideator/Init follow-up to remove or supersede the glossary entry and affected
  relationships so future Plans do not reintroduce it.
- ADR-011 is read-only for this slice unless a concrete contradiction appears. If one does, stop and surface the
  architecture decision rather than casually rewriting the accepted ADR during PRD cleanup.
- Do not over-specify table layouts, lease timeout values, ACP wire errors, pairing screens, or process supervision;
  later child FEATURE Plans own those implementation decisions.
- “Authoritative” may still describe canonical repository artifacts, transcript content, or fenced coordination state;
  remove only claims that one shared live Runtime/Workspace process is the universal Session authority.
- ACP may observe committed state or reject mutation while another process owns activation; it must not silently create
  a second writable Runtime or imply that loading alone transfers ownership.
- Browser disconnection does not cancel work or resolve a checkpoint. Process failure, lease staleness, and uncertain
  side effects remain distinct recovery cases.
