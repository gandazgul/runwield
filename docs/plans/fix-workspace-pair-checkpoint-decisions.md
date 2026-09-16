---
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "MEDIUM"
affectedPaths:
    - "src/ui/workspace/server/session-continuation.js"
    - "src/ui/workspace/components/SessionTimeline.jsx"
    - "src/ui/workspace/islands/SessionSurface.jsx"
    - "src/ui/tui/runtime-interaction-adapter.js"
    - "src/tools/pair-checkpoint.ts"
    - "src/tools/task-completed.ts"
    - "src/ui/workspace/session-continuation.integration.test.ts"
    - "src/ui/workspace/workspace-session-ux.test.tsx"
    - "docs/prd/runwield-core-prd.md"
    - "docs/prd/runwield-workspace-prd.md"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173/dev"
devServerHmr: true
createdAt: "2026-09-12T18:33:00-04:00"
status: "draft"
planId: "130f1c3a-18ac-493f-98ac-ec66a768cb04"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
---

# Respect Workspace Pair Checkpoint Decisions

## Context

The [Core gap audit](../reports/core-prd-gap-audit.md#2-browser-pair-decisions) found that Workspace claims Pair support
but renders checkpoints as generic text input. Core expects selected decisions. Typing revision feedback or “stop” can
therefore become an unrecognized answer and switch work to autonomous execution. Both `pair_checkpoint` and the final
checkpoint inside `task_completed` use this path. This is source-confirmed; no browser reproduction was run in planning.

`registerInteraction` also drops checkpoint `_meta`, including final-completion identity and evidence. Adding ordinary
choice buttons alone would not fix final-checkpoint labels or revision feedback.

Owning requirements:

- Core [Frontend engineering and pair execution](../prd/runwield-core-prd.md#frontend-engineering-and-pair-execution):
  **Let the user steer visible increments without bypassing validation.** Implement the existing choices correctly.
- Workspace [Browser Sessions](../prd/runwield-workspace-prd.md#browser-sessions): **Preserve conversation, drafts, and
  controls in the browser.** Add browser checkpoint scenarios; link Core for decision meanings.

No requirements are removed. Preserve TUI decisions, unsupported-host autonomous fallback, explicit validation, and
work-preserving Stop/cancellation. Pair revision remains text-only, matching the existing TUI contract. This is not the
separate [Record Pair Plan Deviations](record-pair-plan-deviations.md) feature; do not add Plan-write authority.

## Objective

Workspace presents and submits the same Pair decisions as the TUI, for both increments and final completion. Revision
feedback reaches the active execution Agent exactly. Stop and cancellation pause without accepting completion or
starting validation. While Pair remains selected, only explicit final approval advances to validation.

## Approach

Keep Core's decision contract and existing interaction answer route. Add Pair-specific presentation inside the current
Workspace interaction surface. Share the existing choice labels and bounded display formatting with the TUI where
useful; do not add another interaction protocol or infer intent from text.

```text
pair_checkpoint OR task_completed(finalCompletion)
  -> registerInteraction: retain explicitly selected Pair display fields
  -> Workspace: four choices; Revise collects nonblank feedback
  -> existing authenticated answer route
  -> existing Core decision branch
```

| User action         | Existing response contract        | Result                                                             |
| ------------------- | --------------------------------- | ------------------------------------------------------------------ |
| Continue            | selected / continue               | Next increment; final checkpoint instead approves validation       |
| Revise              | selected / revise, _meta.feedback | Same execution context receives text feedback                      |
| Finish autonomously | selected / autonomous             | Explicit style change; final completion still needs task_completed |
| Stop                | selected / stop                   | Pause and keep the Plan in progress                                |
| Cancel              | canceled                          | Pause without approval or style change                             |

Use current TUI labels from `runtime-interaction-adapter.js`, including “Approve and start validation” and “Revise the
final result” for the final checkpoint. Revise collects feedback locally before one atomic response. Canceling its input
returns cancellation, not Continue. Do not offer generic “Other” text submission for Pair.

Expose only bounded, serializable Pair fields already used by the TUI: checkpoint number, final-completion flag, route,
state, viewport, evidence, diagnostics, and next increment. Never forward arbitrary `_meta`, functions, or server paths
as browser file-access authority. Display existing evidence safely; this change does not create an attachment server.

Reuse RunWield buttons, inputs, notices, focus styles, and `--rw-*` tokens. Existing design-system guidance is the
visual basis, not a redesign. Keep feedback on answer failure; disable duplicate sends while pending. Keep all actions
reachable on phone widths. A generic text classifier was set aside because it can misread a user's decision.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/ui/workspace/server/session-continuation.js` — project safe Pair metadata through the existing live interaction.
- `src/ui/workspace/components/SessionTimeline.jsx` and `src/ui/workspace/islands/SessionSurface.jsx` — Pair choices,
  revision form, final labels, and existing answer/error handling.
- `src/ui/tui/runtime-interaction-adapter.js` and a nearby shared presentation helper if needed — reuse labels and
  bounded context without changing the TUI interaction or Core response contract.
- `src/tools/pair-checkpoint.ts`, `task-completed.ts`, and their tests — prove both producers receive correct responses;
  change decision logic only if required to fix this journey, not to redefine unsupported-host behavior.
- Workspace service/route, UX, and execution integration tests — connect browser responses to actual workflow outcomes.
- `src/ui/workspace/server/dev-owner-fixtures.ts`, `pages/dev/index.astro`, and existing development API fixtures — add
  increment/final examples to Surface Lab. These demonstrate UI only, not real Core acceptance.
- `docs/prd/runwield-core-prd.md`, `runwield-workspace-prd.md` — synchronized acceptance scenarios. Update
  `docs/design-system.md` only if a genuinely reusable new visual pattern is necessary.

## Reuse Opportunities

- `src/ui/tui/runtime-interaction-adapter.js:108–184` — canonical choices, feedback requirement, and metadata limits.
- `src/ui/design-system/components/react/RunWieldPrimitives.jsx` — existing controls; `components.css` and theme bridge.
- `WorkspaceSessionContinuationService.answerInteraction` and `routes/owner-session-api.js` — current authenticated
  answer flow, duplicate/late-answer handling, and cross-process forwarding.
- `src/ui/workspace/session-continuation.integration.test.ts` — real Session service and remote TUI interaction
  fixtures.
- `src/shared/git-test-fixture.ts` and existing Agent-turn fixtures — real worktree and Plan outcomes without injecting
  replacements for owned persistence or workflow machinery.

## Implementation Steps

- [ ] Production Workspace interaction projection retains the bounded Pair context for increment and final requests and
      does not expose arbitrary metadata. Both requests remain answerable through the current route.
- [ ] The browser renders the four TUI choices with correct final labels. Revise requires nonblank text and returns
      `selected/revise` with exact feedback; Stop, Continue, Autonomous, and Cancel return their canonical values. No
      generic text answer can stand in for a Pair decision.
- [ ] Browser-produced answers reach both real checkpoint producers. Stop/cancel preserve files and the in-progress
      workflow with zero accepted completion or validation start. Revision retains Pair and supplies feedback to the
      next execution turn. Explicit final approval permits validation; ordinary Continue does not complete work.
- [ ] Pending, failed-answer, keyboard, and narrow-screen states preserve feedback and usable controls. Surface Lab has
      increment and final examples reachable from `/dev`.
- [ ] Regression tests and real-browser evidence cover both checkpoint types. Existing TUI/ACP and unsupported-host
      tests retain their behavior. The owning PRD scenarios and affected references describe the delivered correction
      without claiming unrelated Pair deviations or image-feedback support.

## Approval Confirmation

No Work Record supersession is proposed. This is a draft for later approval, not permission to execute from this
request. Execution owner: Frontend Engineer; autonomous is sufficient because the TUI already defines the behavior and
labels.

## Verification Plan

Start with a failing reproduction through the Workspace response path, not a manually constructed correct tool response.

- **Core integration:** Use the existing scripted Agent-turn boundary with real Plan/Git fixtures. Answer through the
  owner HTTP route into `pair_checkpoint`, then repeat for final `task_completed`. Assert actual tool outcome, next
  Agent input, work files, Plan state, and absence/presence of validation dispatch. A UI-only patch or canned successful
  response must fail these assertions.
- **Cases:** increment Continue; final approval; exact multiline revision; rejected blank revision; Stop; cancellation
  while choosing and while entering feedback; explicit autonomous; duplicate click; late answer; answer failure followed
  by retry. Preserve live interaction forwarding for a checkpoint started in an idle-observed TUI Session.
- **Surviving coverage:** TUI decision contract, ACP refusal of Pair, unsupported-host fallback, final-completion
  gating, retained execution context, and content-free metrics. The browser's generic-text Pair path is expected to stop
  existing.

```sh
deno run -A scripts/run-tests.js src/ui/workspace/workspace-session-ux.test.tsx src/ui/workspace/session-continuation.integration.test.ts src/ui/workspace/owner-workspace.test.js
deno run -A scripts/run-tests.js src/tools/__tests__/pair-checkpoint.test.js src/tools/__tests__/task-completed.test.js src/ui/tui/runtime-interaction-adapter.test.js src/shared/workflow/pair-execution.test.js src/shared/workflow/agent-runners.integration.test.ts src/acp/interaction-mapper.test.js
deno task workspace:test
deno task ci
```

**Headed browser:** Start `deno task workspace:dev`, use an assignment-specific `agent-browser` session, and open
`/dev`. At 1440×1000 and 390×844, exercise increment/final fixtures with keyboard and pointer. Check final labels,
visible context, feedback errors, focus, and no clipping. Then exercise the real owner Session answer route with a
scripted Agent turn and a disposable Plan, not the development API's catch-all accepted response. Verify Stop leaves
actual work paused and final approval starts validation. Record the actual URL, browser/console evidence, and outcomes.
No new browser-test framework or dependency is authorized.

## Edge Cases & Considerations

- The live unanswered checkpoint is not committed transcript history. Preserve current interruption behavior; no new
  durable interaction recovery system is needed.
- Evidence may be absent or long. Match existing TUI bounds and safe rendering; do not interpret a path as permission to
  read arbitrary files.
- Browser refresh and remote answers must not create a second checkpoint or approval. Existing Session control and
  writer rules remain authoritative.
- Do not add Pair to semantic/human-review repair or broaden tool availability. Only correct existing Pair requests.
- `record-pair-plan-deviations.md` may later touch shared presentation. Preserve its independent scope and reconcile
  current source before implementation.
