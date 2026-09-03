---
planId: "7b1479d6-e11e-4965-884c-efec5f892f59"
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/session/session.js"
    - "src/shared/session/claude-cli-execution.test.ts"
    - "src/shared/session/named-invocation-active-segment.integration.test.ts"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-09-03"
status: "ready_for_work"
origin: "internal"
userVerifiedAt: null
routingIntent: "PLANNED_CHANGE"
sessionName: "Diagnose Claude CLI RC"
---

# Fix Claude CLI Thinking-Level Regression

## Context

The latest `v0.9.6` release candidates cannot build a normal Claude CLI Execution Backend when the active Agent has a
configured thinking level such as `medium` or `high`. The terminal user interface (TUI) reports that it could not send
the message and restores the draft. Claude does not start, and RunWield does not append the user message or a Claude
request attempt to the Session Transcript.

The fault first appears in commit `8bd4d493` (`Complete core-owned-prompt-template-invocation`), which is included in
`v0.9.6-rc.1` through `v0.9.6-rc.4`. The same focused backend-build check succeeds at `v0.9.5`, so `v0.9.5` is not
affected. A direct invocation of Claude Code `2.1.257` with RunWield's print-mode arguments also succeeds, which rules
out a current Claude command-line incompatibility.

`buildExecutionSession` now resolves the Agent's ordinary thinking configuration and applies
`assertThinkingLevelBackendSupportedForInvocation` to every non-Pi backend. That assertion was added for one-turn Prompt
Template policy, but it currently also rejects normal root Claude CLI sessions.

## Objective

Restore normal Claude CLI turns for Agents and model presets that contain a thinking-level setting, without weakening
the existing rule that an auxiliary Prompt Template using Claude CLI must reject an unsupported resolved thinking level
before it calls the model.

## Approach

Constrain the Claude CLI thinking-policy assertion to the auxiliary Prompt Template path that has no workflow authority.
Do not remove the assertion and do not require users to set ordinary Agent thinking to `off`.

```text
buildExecutionSession
  resolve model and thinking policy
  if auxiliary Prompt Template and backend is Claude CLI
    reject unsupported non-off thinking before model execution
  otherwise
    build the selected root or workflow-capable Execution Backend
```

Before the fix, a normal root turn and a Prompt Template take the same rejection branch. After the fix, only the Prompt
Template branch uses this assertion. Ordinary Claude CLI construction can continue to resolve and report the configured
thinking level for existing metadata and presentation behavior, but the unsupported Pi-style control does not block
Claude CLI execution.

The rejected alternative is to delete the backend-specific assertion. That would make normal turns work, but it would
silently accept Prompt Template execution policy that RunWield cannot apply.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/session/session.js` — limit Claude CLI thinking-level rejection to one-turn auxiliary Prompt Template
  execution while preserving ordinary root and workflow-capable Claude CLI construction.
- `src/shared/session/claude-cli-execution.test.ts` — reproduce the release regression with a real RunWield settings
  file, the existing fake Claude executable, and the normal root-turn boundary.
- `src/shared/session/named-invocation-active-segment.integration.test.ts` — prove that unsupported Claude CLI thinking
  policy in a Prompt Template still fails before the fake Claude process receives a request.

No TUI production change is expected. Its draft restoration exposed a failure raised below the presentation boundary;
fixing Execution Backend construction removes the failure. No domain-language update is needed because this restores the
existing meanings of Execution Backend, Session, and Prompt Template.

## Reuse Opportunities

- `resolveExecutionThinkingLevel` and `assertThinkingLevelBackendSupportedForInvocation` in
  `src/shared/session/session.js` — keep the existing policy resolution and error rather than introducing a second rule.
- `withClaudeExecutionFixture`, `installClaudeFixture`, and `withProcessGlobalTestLock` in
  `src/shared/session/claude-cli-execution.test.ts` — use the real command preparation, subprocess, stream parser, and
  Session machinery with an isolated `HOME`.
- The Claude CLI Prompt Template fixture in `src/shared/session/named-invocation-active-segment.integration.test.ts` —
  extend the existing cross-backend policy coverage instead of creating a shallow source-text test.

## Implementation Steps

- `buildExecutionSession` permits a normal root or workflow-capable `claude-cli` Execution Backend to build when the
  selected Agent or active model preset resolves a non-`off` thinking level; the configured level no longer triggers the
  Prompt Template-only rejection.
- `buildExecutionSession` still rejects a one-turn auxiliary Prompt Template that resolves Claude CLI with a non-`off`
  thinking level, before command preparation or model execution. Pi behavior and unsupported-thinking validation for
  other model descriptors remain unchanged.
- `src/shared/session/claude-cli-execution.test.ts` contains a regression case that writes an isolated Agent or model
  preset with a non-`off` thinking level, selects Claude CLI for that Agent, builds the normal root, runs a user turn
  through the existing fake Claude process, and proves the request and assistant result complete. This test fails on
  `v0.9.6-rc.1` through the current unfixed code at Execution Backend construction.
- `src/shared/session/named-invocation-active-segment.integration.test.ts` contains a Claude-specific negative case that
  resolves a Prompt Template to Claude CLI plus unsupported non-`off` thinking, proves the turn rejects before a model
  request, and preserves the root Session state. The check must fail if the implementation simply removes the
  backend-specific assertion.
- Existing Claude CLI transcript, request-attempt, model selection, cancellation, Model Context Protocol (MCP) bridge,
  and named-invocation tests remain intact; no test is removed as obsolete for this fix.

## Approval Confirmation

This Plan does not supersede a Work Record. It repairs a regression introduced by the approved
`Core-Owned Named
Invocation` work while preserving that Work Record's intended Prompt Template policy.

## Verification Plan

- Red-before check used during diagnosis:
  `deno eval 'import { buildExecutionSession } from "./src/shared/session/session.js"; try { const built = await buildExecutionSession({ agentName: "engineer", cwd: Deno.cwd(), modelOverride: "claude-cli/opus" }); built.executionSession.session.dispose(); console.log("BACKEND_BUILDS"); } catch (error) { console.log(error instanceof Error ? error.message : String(error)); }'`
  currently reports that Claude CLI does not support the configured `medium` thinking level. After the fix, it must
  report `BACKEND_BUILDS` without starting a model turn.
- Automated behavior:
  `deno run -A scripts/run-tests.js src/shared/session/claude-cli-execution.test.ts src/shared/session/named-invocation-active-segment.integration.test.ts`
  must prove both sides of the boundary: an ordinary configured-thinking Claude CLI turn reaches the fake executable and
  completes, while an unsupported Claude CLI Prompt Template policy does not reach it.
- Automated regression gates: run `deno task check`, `deno task seams:check`, `deno task test`, and `deno task ci`.
- Version evidence: confirm with Git ancestry that `8bd4d493` is absent from `v0.9.5` and present from `v0.9.6-rc.1`
  onward. Do not claim that `v0.9.5` is affected.
- Manual: with an Agent configured to `thinkingLevel: medium` or `high`, switch an RC build to `claude-cli/opus`, submit
  a short ordinary request, and confirm that Claude responds, the user message remains in the Session Transcript, and
  the editor does not restore the submitted draft.
- Manual negative case: invoke a Prompt Template that selects `claude-cli/opus` and resolves non-`off` thinking. Confirm
  that RunWield reports the unsupported policy before Claude starts and restores the previous root Agent, model,
  thinking display, and workflow state.
- The ordinary-turn test would fail if the implementation were a stub or pass-through because it must observe the fake
  Claude subprocess request and completed assistant output. The negative Prompt Template test would fail if the fix only
  deleted the assertion because it must prove zero model requests.

## Edge Cases & Considerations

- A manual `/model claude-cli/*` choice can combine with thinking policy from the active Agent, base settings, or an
  active model preset. The ordinary-turn test must use one of these real settings paths, not pass an artificial internal
  boolean directly to the assertion.
- `thinkingLevel: off` remains valid for Claude CLI Prompt Templates and must continue through the existing successful
  named-invocation path.
- Pi models that support RunWield thinking levels must keep their current execution behavior. Models that do not support
  an explicitly requested Prompt Template thinking level must still fail before a model call.
- No Session Transcript migration is required. Failed RC attempts did not append a Claude user turn; users can retry the
  restored draft after installing the fixed release.
- Keep the zero-seam baseline. The existing fake executable and isolated filesystem settings are sufficient; do not add
  dependency injection for backend construction or Session writes.
