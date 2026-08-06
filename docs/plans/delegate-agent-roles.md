---
planId: "1f7db23a-c78b-4240-8431-a5451f01e303"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Add a role parameter to delegate_agent backed by the subagent registry, shipping the verification-adversary role that simulates a minimal-green implementation against a draft Plan."
affectedPaths:
    - "src/tools/delegate-agent.js"
    - "src/tools/__tests__/delegate-agent.test.js"
    - "src/agent-definitions/subagent-definitions/roles/"
    - "src/shared/session/subagent-definitions.ts"
    - "src/shared/session/subagent-definitions.test.ts"
    - "src/agent-definitions/planner.md"
    - "docs/domain-language.md"
objectiveChecks:
    - id: "OC1"
      command: "grep -q \"verification-adversary\" src/tools/delegate-agent.js"
      rationale: "The role must be selectable through the executable delegate_agent tool code, not only exist as documentation or an unused prompt file."
    - id: "OC2"
      command: "test -s src/agent-definitions/subagent-definitions/roles/verification-adversary.md && grep -q \"not-discriminating\" src/agent-definitions/subagent-definitions/roles/verification-adversary.md"
      rationale: "The role overlay must exist with the actionable verdict contract; an empty placeholder or generic note cannot satisfy the role objective."
    - id: "OC3"
      command: "grep -q \"delegate_agent applies verification-adversary read-only role ceiling\" src/tools/__tests__/delegate-agent.test.js && deno run -A scripts/run-tests.js -A --no-check src/tools/__tests__/delegate-agent.test.js"
      rationale: "The delegate-agent tool tests must include and pass role-specific read-only ceiling coverage, not merely pass the pre-existing generic delegation suite."
    - id: "OC4"
      command: "grep -q \"loadSubAgentDefinition composes delegated role overlays\" src/shared/session/subagent-definitions.test.ts && deno run -A scripts/run-tests.js -A --no-check src/shared/session/subagent-definitions.test.ts"
      rationale: "The subagent loader tests must include and pass delegated role overlay composition coverage, proving the role uses the registry/loader rather than a parallel mechanism."
    - id: "OC5"
      command: "grep -q \"verification-adversary\" src/agent-definitions/planner.md && grep -q \"verification-adversary\" docs/domain-language.md"
      rationale: "The role must be discoverable by Planner and named in the project glossary; otherwise the capability can ship without caller guidance or canonical language."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-01T00:32:24-04:00"
status: "user_verified"
origin: "internal"
userVerifiedAt: "2026-08-03T18:30:24.985Z"
userVerificationNote: "Worked on it with claude code outside of RunWield"
workRecord:
    status: "generated"
    recordId: "12b7ea26-672e-43f5-9d61-a058e25dbdce"
    path: "docs/work-records/2026-08-03-delegated-verification-adversary-role-added.md"
    lastAttemptAt: "2026-08-03T18:30:25.038Z"
updatedAt: "2026-08-05T14:24:20.816Z"
archivedAt: "2026-08-05T14:24:20.816Z"
archivedFromStatus: "user_verified"
archivedFromPath: "plans/delegate-agent-roles.md"
---

# Delegate Agent Roles

## Context

`delegate_agent` takes a `mode` and a free-text `brief` (`src/tools/delegate-agent.js:40-49`) and always launches the
same generic delegated prompt through `loadSubAgentDefinition(SUBAGENTS.DELEGATED)`
(`src/tools/delegate-agent.js:120-127`). Every specialization has to be re-derived by the calling agent, in prose, every
time.

`planner-process-notes.md` proposes fixing this with a mandatory three-researcher batch launched on every Plan. That is
the wrong trade: the researcher lenses overlap heavily with what Planner already does in-context with `code_trace`,
`code_impact`, and `code_impls`, and paying five agent sessions on every Plan is how a planning pipeline becomes
something users route around.

One of the three profiles does earn its keep, because it is the only one aimed at the failure that actually happened.
The rename-plus-`export {}` split passed every check the Plan listed. What would have caught it before execution is an
independent agent asked the adversarial question: _given this Plan and this repository, what is the cheapest change that
satisfies every listed check while the objective is absent?_ Planner cannot answer that reliably about its own Plan —
the blind spot is the point.

The prerequisite subagent-definition consolidation has landed: the seven hidden workflow-dispatched prompts now live
under `src/agent-definitions/subagent-definitions/`, and `src/shared/session/subagent-definitions.ts` is the typed
registry/loader for them. This Plan should extend that loader instead of introducing a parallel prompt mechanism.

## Objective

`delegate_agent` accepts a `role`, and the first role is `verification-adversary`: a read-only subagent that receives a
draft Plan and returns the cheapest counterfeit implementation it can find, plus which listed check (if any) would catch
it.

Planner is told the role exists and when it is worth using. It is not required to call it — the tool definition and the
prompt guidance carry the recommendation, and the model decides.

## Approach

`role` is an optional `StringEnum` on the existing tool parameters. When omitted, execution resolves to `"general"` and
reproduces today's delegated prompt, child tool set, user request shape, and result details. The new behavior is opt-in
for callers that explicitly pass a role.

Role registration belongs beside `SUBAGENT_DEFINITIONS` in `src/shared/session/subagent-definitions.ts`. Add a delegated
role registry with `general` as the no-overlay default and `verification-adversary` as the first overlay-backed role.
Each non-general role declares its overlay file under `src/agent-definitions/subagent-definitions/roles/` and an
authority ceiling.

`role` is orthogonal to requested `mode`: `mode` says what the caller asked for, while the role ceiling says the most
authority that role may receive. The effective mode is the intersection. For this first role,
`delegate_agent({ role: "verification-adversary", mode: "write", ... })` must run as read-only, acquire a read lease,
receive only read tools, skip write-mode change attribution, and report both the requested and effective authority in
the result so the parent can see the downgrade.

Loading a non-general role composes the base delegated prompt with the role overlay. The base prompt remains the source
of universal delegated-session rules; the overlay adds only the role-specific adversarial task, constraints, and handoff
shape. Unknown roles fail before the child Agent Session starts and include the valid role list.

The role does not get a typed result schema yet. `planner-process-notes.md` proposes a full evidence envelope with
confidence levels and contradiction tracking; that is a lot of design to commit to before knowing which roles survive
contact. The overlay states a required handoff shape in prose, and the parent reads text — the same contract
`delegate_agent` has today.

## Files to Modify

- `src/tools/delegate-agent.js` — the optional `role` parameter, role validation, effective authority resolution,
  role-aware prompt loading, and result metadata for requested vs effective authority.
- `src/tools/__tests__/delegate-agent.test.js` — default-role compatibility, unknown-role rejection, read-only ceiling,
  and no-child-session-start coverage.
- `src/agent-definitions/subagent-definitions/roles/verification-adversary.md` — new role overlay.
- `src/shared/session/subagent-definitions.ts` — delegated role registration and overlay composition.
- `src/shared/session/subagent-definitions.test.ts` — role-overlay loader tests and prompt-file inventory updates.
- `src/agent-definitions/planner.md` — when reaching for the adversary is worth a round-trip.
- `docs/domain-language.md` — concise language for Delegated Agent Roles and the `verification-adversary` role, aligned
  with the implemented behavior.

## Reuse Opportunities

- `src/shared/session/subagent-definitions.ts` — the existing hidden subagent registry, bundled prompt read retry, and
  bare-prompt loading path; roles extend this registry surface instead of opening another prompt-loading path.
- `src/tools/delegate-agent.js` — `resolveDelegatedToolNames` already intersects parent tools with a mode ceiling; the
  role ceiling composes with it rather than replacing it.
- `src/agent-definitions/subagent-definitions/delegated-agent-prompt.md` — the base prompt remains the universal
  delegated-session contract and should not be duplicated in role overlays.
- `src/agent-definitions/document-formats/planner-plan-format.md` — the Objective-Failing Checks contract the adversary
  is arguing against; the overlay references it instead of restating it.

## Implementation Steps

- [ ] `delegate_agent`'s parameters include optional `role`, with valid values supplied from the delegated role
      registry. A call that omits `role` resolves to `general` and produces the same prompt, child tool set, user
      request text, change-attribution behavior, and result shape as today's implementation.
- [ ] `src/shared/session/subagent-definitions.ts` exports a delegated role registry whose `general` entry has no
      overlay and whose `verification-adversary` entry points at `roles/verification-adversary.md` with a read-only
      authority ceiling.
- [ ] `loadSubAgentDefinition(SUBAGENTS.DELEGATED, { delegatedRole: "verification-adversary" })` composes the base
      delegated prompt with the role overlay, and the composed system prompt contains both the base delegated-session
      rules and the overlay's adversarial handoff contract.
- [ ] Unknown roles are rejected before `runIsolatedAgentSession` is called. The tool result is structured like the
      existing delegation failures and names the valid roles.
- [ ] A role authority ceiling intersects with requested `mode`:
      `delegate_agent({ role: "verification-adversary", mode:
      "write" })` acquires a read lease, receives
      read-only tools, does not capture write-mode before/after snapshots, and returns details that include `role`,
      requested authority, effective authority, and the read-only ceiling.
- [ ] `verification-adversary.md` instructs the subagent to read the draft Plan and the repository, construct the
      cheapest change satisfying every listed step and check while omitting the objective, and return: the counterfeit
      implementation, which listed check catches it, and — when none does — the check that would.
- [ ] The overlay requires a verdict of `discriminating` or `not-discriminating` with the specific check IDs implicated,
      so Planner can act on the result without re-reading the whole handoff.
- [ ] `planner.md` describes the adversary as a recommended round for REFACTOR, structural, and migration work before
      `plan_written`, and explicitly not required for small or fully-specified changes.
- [ ] `docs/domain-language.md` defines Delegated Agent Role and `verification-adversary` in terms of implemented
      behavior without turning the role into a mandatory Plan gate.
- [ ] `src/tools/__tests__/delegate-agent.test.js` covers the default role, an unknown role rejected with the valid list
      before a child session starts, and the read-only ceiling holding against `mode: "write"`.

## Verification Plan

- Automated: `deno task ci`.
- Automated:
  `deno run -A scripts/run-tests.js -A --no-check src/tools/__tests__/delegate-agent.test.js
  src/shared/session/subagent-definitions.test.ts`
- Automated: `deno task seams:check` must not report any new injection seams; this change should reuse the existing real
  prompt-loading path and test through real loader behavior.
- Manual: plan a deliberately loose refactor ("split module X"), call the adversary against the draft Plan text, and
  confirm it names the rename-plus-placeholder path. This is the fixture the whole role exists for; if it misses that,
  the overlay is wrong regardless of what the tests say.
- Manual: confirm an ad hoc `delegate_agent` call with no role behaves exactly as before.
- Expected results: `role` omitted behaves as legacy delegation; `role: "verification-adversary"` appends the overlay;
  `role: "verification-adversary", mode: "write"` runs read-only and reports the requested/effective authority split;
  unknown role returns a structured failure without starting a child Agent Session.
- Existing behavior to preserve: generic delegation, the `read`/`write` mode ceilings, the write-mode change snapshot
  and attribution, the delegated-agent lease, and the no-recursive-delegation rule.
- Behavior expected to stop existing: none. This is additive.
- Glossary verification: `docs/domain-language.md` describes Delegated Agent Roles as optional delegated-session
  overlays, not as a required planning gate or a new top-level Agent type.

### Objective-Failing Checks

- `OC1` — `grep -q "verification-adversary" src/tools/delegate-agent.js` — the role reaches the executable tool code,
  not just a markdown file nobody can select.
- `OC2` —
  `test -s src/agent-definitions/subagent-definitions/roles/verification-adversary.md && grep -q
  "not-discriminating" src/agent-definitions/subagent-definitions/roles/verification-adversary.md`
  — the overlay exists with the actionable verdict contract, so an empty placeholder cannot satisfy the step.
- `OC3` —
  `grep -q "delegate_agent applies verification-adversary read-only role ceiling"
  src/tools/__tests__/delegate-agent.test.js && deno run -A scripts/run-tests.js -A --no-check
  src/tools/__tests__/delegate-agent.test.js`
  — the tool test suite contains and passes role-ceiling coverage rather than only preserving pre-existing delegation
  tests.
- `OC4` —
  `grep -q "loadSubAgentDefinition composes delegated role overlays"
  src/shared/session/subagent-definitions.test.ts && deno run -A scripts/run-tests.js -A --no-check
  src/shared/session/subagent-definitions.test.ts`
  — the loader test suite contains and passes role-overlay composition coverage.
- `OC5` —
  `grep -q "verification-adversary" src/agent-definitions/planner.md && grep -q "verification-adversary"
  docs/domain-language.md`
  — Planner is told the role exists and the project glossary names the implemented concept; a capability no caller knows
  about is not delivered.

## Execution Policy

- `executionAgent: "engineer"`; this is runtime/tooling work with prompt and test updates, not browser-rendered UI work.
- `collaborationRecommendation: "autonomous"`; no live visual judgment is required.

## Edge Cases & Considerations

- **A nudge that becomes ceremony is worse than no nudge.** If Planner starts calling the adversary on every trivial
  Plan, the guidance is miscalibrated — tighten `planner.md`, do not add a gate.
- The adversary reads a draft Plan that may not be written to `plans/` yet. The brief must carry the Plan text rather
  than assuming a path, or the role only works after the file exists.
- An adversary that always answers "not discriminating" is useless in the same way a rubber stamp is. Its overlay must
  require naming a concrete counterfeit implementation, so an unsupported verdict is visible.
- Read-only means read-only: the role must not be able to fix the Plan it critiques. Repair belongs to Planner, which
  keeps the finding and the fix in different contexts.
- Roles multiply. Ship one, learn from it, and resist adding the other two research profiles until there is evidence
  they change a Plan that would otherwise have shipped wrong.
