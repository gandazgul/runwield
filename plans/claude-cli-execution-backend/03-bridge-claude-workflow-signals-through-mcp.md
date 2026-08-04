---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Expose explicit Claude CLI lifecycle completion calls through an authenticated MCP adapter that delegates to RunWield's existing Plan, Task Completion, and Semantic Review authorities without parsing Claude prose."
affectedPaths:
    - "deno.json"
    - "deno.lock"
    - "src/shared/session/session.js"
    - "src/shared/session/backends/claude-cli/command.ts"
    - "src/shared/session/backends/claude-cli/execution-session.ts"
    - "src/shared/session/backends/claude-cli/workflow-mcp-bridge.ts"
    - "src/shared/session/backends/claude-cli/workflow-mcp-bridge.test.ts"
    - "src/shared/session/backends/claude-cli/claude-cli-backend.test.ts"
    - "src/shared/session/claude-cli-execution.test.ts"
    - "src/shared/workflow/validation.ts"
    - "src/shared/workflow/validation-helpers.ts"
    - "src/shared/workflow/validation-loop-review.test.js"
objectiveChecks:
    - id: "OC1"
      command: "bash -lc 'set -euo pipefail; ! grep -q \"Custom Tools are not exposed to Claude CLI\" src/shared/session/backends/claude-cli/execution-session.ts; out=$(deno run -A scripts/run-tests.js --filter \"^Claude CLI MCP lifecycle bridge black-box contract$\" src/shared/session/claude-cli-execution.test.ts 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed \\\\| 0 failed\"'"
      rationale: "The named vertical test must run a fake Claude process through the generated MCP config and real MCP client, exercise rejection then accepted delegation, and expose the canonical result to current workflow readers; the old no-tools prompt must also be removed."
    - id: "OC2"
      command: "bash -lc 'set -euo pipefail; grep -q -- \"--mcp-config\" src/shared/session/backends/claude-cli/command.ts; ! grep -q -- \"--strict-mcp-config\" src/shared/session/backends/claude-cli/command.ts; out=$(deno run -A scripts/run-tests.js --filter \"^Claude CLI MCP config is additive authenticated and ephemeral$\" src/shared/session/backends/claude-cli/claude-cli-backend.test.ts 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed \\\\| 0 failed\"'"
      rationale: "Requires additive command wiring plus a named backend contract proving authenticated loopback access, unauthorized rejection, owner-only config, and listener/config cleanup."
    - id: "OC3"
      command: "bash -lc 'set -euo pipefail; out=$(deno run -A scripts/run-tests.js --filter \"^Claude MCP review completion waives only review_diff inspection$\" src/shared/workflow/validation-loop-review.test.js 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"1 passed \\\\| 0 failed\"'"
      rationale: "The named validation test must contrast bridge-stamped and untrusted/Pi review results, proving only the accepted Claude MCP result skips the inspection nudge while structured review rules remain."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-04T11:29:21-0400"
updatedAt: "2026-08-04T15:38:17.711Z"
status: "ready_for_work"
origin: "internal"
parentPlan: "claude-cli-execution-backend"
order: 3
dependencies:
    - "02-add-claude-cli-backend-transcript-tracer-bullet"
userVerifiedAt: null
planId: "791f0bf9-03b4-4e3d-9aa9-d05eacfde411"
---

# Bridge Claude Workflow Signals Through MCP

## Context

Child 02 is verified: selected `claude-cli/*` root and HostedSession-backed isolated turns now execute through
`ClaudeCliExecutionSession`, stream assistant text, and persist RunWield-owned user/final-assistant entries. That tracer
bullet deliberately installs no RunWield Custom Tools, so Claude can currently write code or Plans but cannot explicitly
complete planning, execution, or Semantic Review.

RunWield lifecycle truth must not come from final prose, sentinel text, or model chatter. The Epic therefore requires a
small Model Context Protocol (MCP) adapter through which Claude invokes explicit completion tools. Existing
`createPlanWrittenTool`, `createTaskCompletedTool`, and `createReviewCompletedTool` definitions already own parameter
schemas, user-visible workflow messages, Plan review, Task Completion ownership checks, and structured review
validation; the adapter must call those definitions rather than reproduce their behavior.

Semantic Review has one backend-specific constraint. Pi-backed Reviewer turns must call RunWield's `review_diff` before
a verdict because RunWield otherwise has no evidence the diff was opened. Claude CLI owns its internal read/Bash tool
loop, and the MVP intentionally does not ingest that internal transcript. Per the user's decision, an accepted
Claude-MCP `review_complete` result therefore waives only the Pi-specific `review_diff` prerequisite. The existing
structured findings ledger and rejection of approval with unresolved findings remain authoritative.

## Objective

Expose exactly three RunWield lifecycle tools to eligible Claude CLI turns—`runwield_plan_written`,
`runwield_task_completed`, and `runwield_review_complete`—through a per-turn authenticated loopback MCP adapter. Each
call must delegate to the corresponding existing Custom Tool definition, return its feedback to Claude, and record a
normal RunWield tool exchange so current Agent Handler and Workflow Validation readers consume the result without a
backend-specific lifecycle path.

Ordinary Claude assistant text, text resembling a tool call, and rejected MCP calls must never advance workflow. Only a
delegated result with `terminate: true` may become the turn's accepted terminal workflow signal; after that result the
adapter refuses later lifecycle calls without invoking RunWield machinery again.

## Approach

Add a deep, per-turn MCP adapter under the Claude backend. Its small interface starts an authenticated loopback server
for a supplied set of existing Tool Definitions and returns the temporary Claude MCP config plus a close operation. Hide
HTTP transport, authorization, JSON-RPC dispatch, tool-result conversion, call serialization, and temporary-file cleanup
inside that module.

Use the official `@modelcontextprotocol/sdk` low-level `Server` request handlers with
`WebStandardStreamableHTTPServerTransport`. Low-level handlers can advertise the existing TypeBox JSON Schemas directly
instead of translating them to a second validation vocabulary. Bind only `127.0.0.1` on an ephemeral port, require a
cryptographically random Bearer token, and place the URL/header config in an owner-only temporary JSON file. Pass that
file through additive `--mcp-config`; deliberately omit `--strict-mcp-config` so user/project Claude MCP integrations
remain available. Never persist or log the token, URL, config path, prompt contents, or other secrets.

At Claude execution-session construction, intersect the Agent Definition's declared tools with the three supported
completion tools and instantiate the same definitions used by Pi. Expose only the matching prefixed aliases for that
Agent (Planner/Architect: Plan Written; execution Agents: Task Completion; Reviewer: Review Complete). Do not expose
`user_interview`, `delegate_agent`, `review_diff`, or arbitrary custom tools. Append a backend-specific prompt note that
names only the eligible aliases; for Claude Reviewer, direct inspection through Claude's native read/Bash tools replaces
the unavailable RunWield `review_diff` call.

Serialize MCP calls. Invoke the underlying definition with its original internal tool name and HostedSession context,
return its content to Claude, and append canonical assistant `toolCall` plus `toolResult` messages to the supplied
SessionManager and execution-session message list. Existing outcome readers must therefore see `plan_written` and
`review_complete`; the Task Completion outbox remains the execution authority for `task_completed`. Decorate bridge
results with non-user-settable `claude-cli-mcp` provenance. Workflow Validation may use that provenance only to select
the Claude opaque-inspection policy; the accepted completion result—not the provenance or transcript projection—remains
the workflow authority.

A delegated `terminate: false` result is feedback or rejection and leaves the bridge open so Claude can repair and call
again. The first delegated `terminate: true` result atomically closes the lifecycle-call gate for that turn. The adapter
never examines assistant text, and production code must contain no prose/sentinel parser such as `RUNWIELD_SIGNAL`.

## Files to Modify

- `deno.json` / `deno.lock` — declare and lock the official MCP SDK as a direct runtime dependency rather than relying
  on Tidewave's transitive installation.
- `src/shared/session/backends/claude-cli/workflow-mcp-bridge.ts` — add the typed loopback MCP adapter, eligible-tool
  alias mapping, Bearer authentication, TypeBox schema advertisement, serialized delegation, terminal-call gate,
  canonical tool-message recording, provenance stamping, and deterministic close contract.
- `src/shared/session/backends/claude-cli/workflow-mcp-bridge.test.ts` — exercise the adapter through a real MCP SDK
  client over loopback HTTP, including authorization, listed tools, schema preservation, rejection/retry, terminal
  serialization, provenance, transcript messages, and cleanup.
- `src/shared/session/backends/claude-cli/command.ts` — create/remove the owner-only additive MCP config and add
  `--mcp-config <path>` without `--strict-mcp-config`; keep prompt and config cleanup explicit.
- `src/shared/session/backends/claude-cli/execution-session.ts` — start one bridge per turn, append the eligible-tool
  prompt note, pass the config to Claude, accept bridge-recorded tool messages into the execution result, and close the
  bridge/config in all normal and error exits without parsing Claude output for workflow meaning.
- `src/shared/session/session.js` — compose eligible existing Plan Written, Task Completion, and Review Complete Tool
  Definitions for Claude from the loaded Agent Definition/HostedSession/triage context; return them in
  `finalCustomTools` so existing root configuration checks remain valid while Pi wiring stays unchanged.
- `src/shared/workflow/validation-helpers.ts` — recognize only bridge-stamped, accepted Claude `review_complete` results
  as the opaque-inspection policy; keep failed/unavailable `review_diff` behavior unchanged for Pi.
- `src/shared/workflow/validation.ts` — waive the pre-verdict `review_diff` requirement only for that trusted Claude MCP
  result while retaining required `review_complete`, diff-inspection enforcement for Pi, findings-ledger accounting, and
  all approval/rejection behavior.
- `src/shared/session/backends/claude-cli/claude-cli-backend.test.ts` and
  `src/shared/session/claude-cli-execution.test.ts` — extend the fake `claude` executable/vertical fixture to consume
  the generated MCP config, invoke lifecycle tools over MCP, and prove RunWield records outcomes without Pi or prose
  parsing.
- `src/shared/workflow/validation-loop-review.test.js` — prove Claude-stamped review completion may decide without a
  RunWield `review_diff` result while untrusted/Pi verdicts still require successful diff inspection.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/tools/plan-written.ts` — instantiate `createPlanWrittenTool` with the same triage, Agent, and HostedSession
  context; retain Objective-Failing Check persistence, Review Loop, readiness, feedback, and approval outcomes
  unchanged.
- `src/tools/task-completed.ts` — instantiate `createTaskCompletedTool` so execution-start, Pair Execution pause, active
  owner, durable Task Completion outbox, display message, and metrics checks remain centralized.
- `src/tools/review-complete.ts` — instantiate `createReviewCompletedTool` so structured findings/advisories and
  rejection of approval with unresolved findings remain centralized.
- `src/shared/session/task-completion-session.ts` — keep its accepted/consumed outbox as Task Completion authority; the
  MCP adapter must not invent a second completion journal.
- `src/shared/workflow/workflow-results.js` and `src/shared/session/agent-handler.ts` — preserve their existing readers
  by recording internal tool names and canonical Agent messages rather than adding backend branches.
- `src/shared/session/workflow-messages.js` — rely on messages emitted by the delegated existing tools; do not create
  Claude-specific lifecycle projections.
- `@modelcontextprotocol/sdk/server` and `server/webStandardStreamableHttp` — reuse protocol validation and
  Deno-compatible Web Standard transport rather than implementing ad hoc JSON-RPC.

## Implementation Steps

- [ ] `workflow-mcp-bridge.ts` exposes a typed start/close interface backed by the official MCP SDK, binds only an
      ephemeral `127.0.0.1` listener, rejects missing/wrong Bearer credentials before protocol dispatch, and publishes
      no resources, prompts, or tools beyond the eligible prefixed lifecycle aliases supplied for the current Agent.
- [ ] Claude tool eligibility is the intersection of the Agent Definition's declared tools and exactly
      `plan_written`/`task_completed`/`review_complete`; external aliases map back to those internal names. Planner and
      Architect cannot call Task/Review completion, execution Agents cannot call Plan/Review completion, Reviewer cannot
      call Plan/Task completion, and no Claude turn receives `user_interview`, `delegate_agent`, or `review_diff` from
      this adapter.
- [ ] Every MCP invocation executes the existing Tool Definition with the real HostedSession and original parameters;
      the adapter contains no Plan Front Matter, Plan Lifecycle, active-workflow, Task Completion outbox, Review Issue
      Ledger, validation-evidence, or Work Record mutation logic.
- [ ] Tool calls are serialized. Results with `terminate: false` return their text/image feedback to Claude and leave
      the gate open; the first result with `terminate: true` atomically becomes the accepted terminal tool result and
      all later lifecycle calls are rejected before the underlying Tool Definition can run again.
- [ ] Each attempted delegated call records a canonical assistant `toolCall` and matching `toolResult` under the
      internal RunWield tool name in the supplied SessionManager and Claude execution-session message list. Existing
      Plan outcome and Semantic Review readers consume those messages, while accepted Task Completion continues through
      the existing durable outbox and Agent Handler continuation.
- [ ] Bridge-created result provenance is non-user-settable and identifies `claude-cli-mcp`. Workflow Validation waives
      only its `review_diff`-before-verdict check for an accepted `review_complete` carrying that provenance.
      Pi/untrusted results still require a successful available `review_diff`; all backends still require structured
      `review_complete`, complete ledger identity accounting, and no open findings for approval.
- [ ] Each Claude turn receives an owner-only MCP config containing only RunWield's temporary server and passes it with
      additive `--mcp-config`. The argv contains no `--strict-mcp-config`; existing Claude user/project MCP servers
      remain available, and the token, URL, config path, prompts, environment, and settings payloads are absent from
      transcript metadata and logs.
- [ ] The Claude prompt appendix names only aliases eligible for that Agent, states that plain-text questions are
      non-terminal, and tells Reviewer to inspect through Claude's native tools before `runwield_review_complete`
      because RunWield `review_diff` is intentionally not bridged.
- [ ] Assistant prose—including `RUNWIELD_SIGNAL`, literal tool names, JSON-looking calls, or “done” claims—never enters
      lifecycle interpretation. A turn with no accepted completion tool remains ordinary assistant output;
      missing-signal reminders, post-terminal output, cancellation hardening, and health failures remain child 04 scope.
- [ ] Pi composition and all three existing Custom Tool definitions retain their current schemas, direct behavior,
      workflow messages, metrics, rejection rules, and outcome readers. New TypeScript defines concrete JSON/protocol
      shapes and contains no `any`, `unknown`, bare `object`, `@ts-ignore`, or `@ts-nocheck`.

## Verification Plan

- Automated MCP adapter and backend:
  `deno run -A scripts/run-tests.js src/shared/session/backends/claude-cli/workflow-mcp-bridge.test.ts src/shared/session/backends/claude-cli/claude-cli-backend.test.ts src/shared/session/claude-cli-execution.test.ts`
- Automated authoritative tool regression:
  `deno run -A scripts/run-tests.js src/tools/__tests__/plan-written.test.js src/tools/__tests__/task-completed.test.js src/tools/__tests__/review-complete.test.js src/shared/session/task-completion-session.test.ts src/shared/session/agent-handler.test.ts`
- Automated Semantic Review policy:
  `deno run -A scripts/run-tests.js src/shared/workflow/validation-loop-review.test.js src/shared/workflow/validation-loop-core.test.js`
- Automated policy/type gate: `deno task check && deno task seams:check`
- Full regression gate: `deno task ci`
- Manual: with Claude Code installed and authenticated, select `claude-cli/sonnet` for Planner, write a small disposable
  Plan, and call `runwield_plan_written`; verify normal browser review opens, feedback returns inside the same Claude
  turn without ending it, and an accepted save/run decision follows the existing Agent Handler path.
- Manual: select Claude CLI for Engineer in a disposable active execution workflow, first make an invalid
  `runwield_task_completed` call and verify it returns rejection without validation, then make a valid call and verify
  normal implementation checkpoint/Workflow Validation begins exactly once. Text saying “task completed” without the MCP
  call must do nothing.
- Manual: select Claude CLI for Reviewer, inspect with Claude's native tools, and call `runwield_review_complete` with
  `approved: true` plus an unresolved finding; verify the call is rejected. Submit a consistent structured verdict and
  verify Workflow Validation accepts it without a RunWield `review_diff` transcript event.
- Manual security/additivity: inspect the spawned argv/config while using a benign existing Claude MCP server; verify
  RunWield passes `--mcp-config` but not `--strict-mcp-config`, the existing server remains usable, the RunWield
  endpoint rejects a request without its Bearer token, and prompt/config temporary files disappear after the turn.
- Expected: only accepted delegated completion tool results move workflow; ordinary final text and rejected calls never
  do. The MCP adapter contains no lifecycle mutations and no production prose parser exists.
- Behavior protected afterwards: Pi-backed agents still use their original Custom Tools and `review_diff` prerequisite;
  Plan Written still validates Plan/policy/Objective-Failing Checks and drives the Review Loop; Task Completion still
  rejects wrong owners, pre-execution completion, and Pair pauses; Review Complete still rejects approval with open
  findings and preserves ledger structure.
- Behavior expected to stop existing: eligible Claude CLI Agents are no longer unable to emit authoritative Plan
  Written, Task Completion, or Semantic Review completion outcomes.

### Objective-Failing Checks

- `OC1` —
  `bash -lc 'set -euo pipefail; ! grep -q "Custom Tools are not exposed to Claude CLI" src/shared/session/backends/claude-cli/execution-session.ts; out=$(deno run -A scripts/run-tests.js --filter "^Claude CLI MCP lifecycle bridge black-box contract$" src/shared/session/claude-cli-execution.test.ts 2>&1); printf "%s\n" "$out"; printf "%s\n" "$out" | grep -Eq "1 passed \\| 0 failed"'`
  — the named vertical test must run a fake Claude process that reads the generated MCP config, uses a real MCP client
  to list only its Agent-eligible aliases, receives a rejected result without advancement, invokes an accepted existing
  Tool Definition, and exposes the canonical internal tool result to current workflow readers; the old no-tools prompt
  must be gone.
- `OC2` —
  `bash -lc 'set -euo pipefail; grep -q -- "--mcp-config" src/shared/session/backends/claude-cli/command.ts; ! grep -q -- "--strict-mcp-config" src/shared/session/backends/claude-cli/command.ts; out=$(deno run -A scripts/run-tests.js --filter "^Claude CLI MCP config is additive authenticated and ephemeral$" src/shared/session/backends/claude-cli/claude-cli-backend.test.ts 2>&1); printf "%s\n" "$out"; printf "%s\n" "$out" | grep -Eq "1 passed \\| 0 failed"'`
  — the named backend test must prove authorized loopback success, unauthorized rejection, additive argv, owner-only
  config, and listener/config cleanup; command markers alone cannot satisfy it.
- `OC3` —
  `bash -lc 'set -euo pipefail; out=$(deno run -A scripts/run-tests.js --filter "^Claude MCP review completion waives only review_diff inspection$" src/shared/workflow/validation-loop-review.test.js 2>&1); printf "%s\n" "$out"; printf "%s\n" "$out" | grep -Eq "1 passed \\| 0 failed"'`
  — the named validation test must contrast accepted bridge-stamped `review_complete` with an otherwise identical
  untrusted/Pi result, proving only the former skips the inspection nudge while open-finding and ledger rules remain.

## Edge Cases & Considerations

- **No prose authority:** MCP request dispatch is the only input to the adapter. Never scan final text, stream events,
  or transcript text for aliases, JSON, “done,” or sentinel markers.
- **Concurrent/duplicate calls:** two simultaneous MCP calls must not both reach lifecycle tools. Serialize before
  delegation, and close the gate only after a result actually returns `terminate: true`; a schema error, thrown error,
  `repair_required`, feedback, or rejection remains non-terminal.
- **Plan feedback loop:** `plan_written` review feedback and annotated images must be representable in the MCP result
  and keep the same Claude invocation eligible to revise and call again. Saved/canceled/approved outcomes retain their
  existing `terminate` semantics.
- **Task Completion authority:** canonical tool messages help replay/readers, but the existing accepted/consumed outbox
  is the Task Completion handoff. Do not let MCP call state or assistant text substitute for it.
- **Opaque Claude review:** the provenance waiver says only that RunWield cannot observe Claude's internal inspection;
  it is not proof of inspection and must not be generalized to Pi, Attached Mode, arbitrary external results, or
  approval with incomplete/open findings.
- **MCP additivity:** user/project MCP servers remain Claude-owned and available. Unique `runwield_*` aliases and the
  temporary server's own allowlist prevent those servers from impersonating RunWield outcomes; only messages recorded by
  this in-process adapter carry trusted provenance.
- **Loopback security:** bind IPv4 loopback rather than all interfaces, require a random token and unpredictable config,
  reject wrong paths/methods/authorization, and never put credentials in transcript/backend metadata. Owner-only temp
  files are removed in `finally` paths.
- **External-boundary seam:** MCP HTTP and the Claude subprocess are genuine external boundaries. Do not add or expand
  `__deps`/`__testDeps` seams in Session, Plan Lifecycle, validation, registry, or transcript authorities; use a real
  MCP client and fake executable fixture.
- **Child boundary:** normal bridge startup/close belongs here. Missing executable/auth, malformed streams, cancellation
  and process-tree cleanup, missing completion reminders, and post-terminal Claude output policy remain child 04.
- **Language policy:** new bridge code is TypeScript. Keep the required `session.js` composition change narrow rather
  than turning this lifecycle slice into a migration of the 3,000-line Session module.
