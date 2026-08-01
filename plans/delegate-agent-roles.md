---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Add a role parameter to delegate_agent backed by the subagent registry, shipping the verification-adversary role that simulates a minimal-green implementation against a draft Plan."
affectedPaths:
    - "src/tools/delegate-agent.js"
    - "src/agent-definitions/subagent-definitions/roles/"
    - "src/shared/session/subagent-definitions.ts"
    - "src/agent-definitions/planner.md"
dependencies:
    - "formalize-subagent-definitions"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
devServerCommand: null
devServerUrl: null
devServerHmr: null
createdAt: "2026-08-01T00:32:24-04:00"
status: "draft"
---

# Delegate Agent Roles

## Context

`delegate_agent` takes a `mode` and a free-text `brief` (`src/tools/delegate-agent.js:44-55`) and always launches the
same generic prompt. Every specialization has to be re-derived by the calling agent, in prose, every time.

`planner-process-notes.md` proposes fixing this with a mandatory three-researcher batch launched on every Plan. That is
the wrong trade: the researcher lenses overlap heavily with what Planner already does in-context with `code_trace`,
`code_impact`, and `code_impls`, and paying five agent sessions on every Plan is how a planning pipeline becomes
something users route around.

One of the three profiles does earn its keep, because it is the only one aimed at the failure that actually happened.
The rename-plus-`export {}` split passed every check the Plan listed. What would have caught it before execution is an
independent agent asked the adversarial question: _given this Plan and this repository, what is the cheapest change that
satisfies every listed check while the objective is absent?_ Planner cannot answer that reliably about its own Plan —
the blind spot is the point.

## Objective

`delegate_agent` accepts a `role`, and the first role is `verification-adversary`: a read-only subagent that receives a
draft Plan and returns the cheapest counterfeit implementation it can find, plus which listed check (if any) would catch
it.

Planner is told the role exists and when it is worth using. It is not required to call it — the tool definition and the
prompt guidance carry the recommendation, and the model decides.

## Approach

`role` is a `StringEnum` on the existing tool parameters, defaulting to `"general"`, which reproduces today's behavior
byte for byte. It is orthogonal to `mode`: a role declares the maximum authority it may run with, and
`verification-adversary` is read-only regardless of what the caller passes.

Each role is a markdown overlay under `src/agent-definitions/subagent-definitions/roles/`, registered in the subagent
registry from the dependency Plan. Loading a role composes the base delegated prompt with the role overlay — the same
seam the shared-practice composition work will later use for the engineer prompts, which is why that machinery lands
first.

The role does not get a typed result schema yet. `planner-process-notes.md` proposes a full evidence envelope with
confidence levels and contradiction tracking; that is a lot of design to commit to before knowing which roles survive
contact. The overlay states a required handoff shape in prose, and the parent reads text — the same contract
`delegate_agent` has today.

## Files to Modify

- `src/tools/delegate-agent.js` — the `role` parameter, its authority ceiling, and role-aware prompt loading.
- `src/agent-definitions/subagent-definitions/roles/verification-adversary.md` — new role overlay.
- `src/shared/session/subagent-definitions.ts` — role registration and overlay composition.
- `src/agent-definitions/planner.md` — when reaching for the adversary is worth a round-trip.

## Reuse Opportunities

- `src/shared/session/subagent-definitions.ts` — the registry and loader from `formalize-subagent-definitions`; roles
  are registry entries, not a parallel mechanism.
- `src/tools/delegate-agent.js` — `resolveDelegatedToolNames` already intersects parent tools with a mode ceiling; the
  role ceiling composes with it rather than replacing it.
- `src/agent-definitions/document-formats/planner-plan-format.md` — the Objective-Failing Checks contract the adversary
  is arguing against; the overlay references it instead of restating it.

## Implementation Steps

- [ ] `delegate_agent`'s parameters include `role`, defaulting to `"general"`. A call that omits `role` produces the
      same prompt, tool set, and result shape as today, proven by the existing `delegate-agent.test.js` suite passing
      unchanged.
- [ ] `loadSubAgentDefinition` composes the base delegated prompt with a role overlay when a role is supplied, and the
      composed system prompt contains both the base rules and the overlay text.
- [ ] A role declares an authority ceiling that intersects with `mode`:
      `delegate_agent({ role:
      "verification-adversary", mode: "write" })` runs with read-only tools and says so in
      its result, rather than failing or silently honoring `write`.
- [ ] `verification-adversary.md` instructs the subagent to read the draft Plan and the repository, construct the
      cheapest change satisfying every listed step and check while omitting the objective, and return: the counterfeit
      implementation, which listed check catches it, and — when none does — the check that would.
- [ ] The overlay requires a verdict of `discriminating` or `not-discriminating` with the specific check IDs implicated,
      so Planner can act on the result without re-reading the whole handoff.
- [ ] `planner.md` describes the adversary as a recommended round for REFACTOR, structural, and migration work before
      `plan_written`, and explicitly not required for small or fully-specified changes.
- [ ] `src/tools/__tests__/delegate-agent.test.js` covers the default role, an unknown role rejected with the valid
      list, and the read-only ceiling holding against `mode: "write"`.

## Verification Plan

- Automated: `deno task ci`.
- Automated:
  `deno run -A scripts/run-tests.js -A --no-check src/tools/__tests__/delegate-agent.test.js
  src/shared/session/subagent-definitions.test.ts`
- Manual: plan a deliberately loose refactor ("split module X"), call the adversary against the draft, and confirm it
  names the rename-plus-placeholder path. This is the fixture the whole role exists for; if it misses that, the overlay
  is wrong regardless of what the tests say.
- Manual: confirm an ad hoc `delegate_agent` call with no role behaves exactly as before.
- Existing behavior to preserve: generic delegation, the `read`/`write` mode ceilings, the write-mode change snapshot
  and attribution, the delegated-agent lease, and the no-recursive-delegation rule.
- Behavior expected to stop existing: none. This is additive.

### Objective-Failing Checks

- `OC1` — `grep -q "verification-adversary" src/tools/delegate-agent.js` — the role reaches the tool schema, not just a
  markdown file nobody can select.
- `OC2` — `test -s src/agent-definitions/subagent-definitions/roles/verification-adversary.md` — the overlay exists with
  content, so an empty placeholder cannot satisfy the step.
- `OC3` — `deno run -A scripts/run-tests.js -A --no-check src/tools/__tests__/delegate-agent.test.js` — the role ceiling
  and unknown-role rejection are exercised.
- `OC4` — `grep -q "verification-adversary" src/agent-definitions/planner.md` — Planner is actually told the role
  exists; a capability no caller knows about is not delivered.

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
