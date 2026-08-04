---
planId: "6d74b4e4-e52a-42ad-90ca-cde3b2430d34"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Route `claude-cli/*` root and HostedSession-backed isolated turns through a typed `claude -p` backend, stream assistant text, and persist/replay RunWield-owned transcript entries without constructing Pi AgentSession."
affectedPaths:
    - "CONTEXT.md"
    - "src/shared/models/model-execution.ts"
    - "src/shared/session/session.js"
    - "src/shared/session/agent-handler.ts"
    - "src/shared/session/execution-backend.ts"
    - "src/shared/session/backends/claude-cli/"
    - "src/shared/session/claude-cli-execution.test.ts"
    - "src/shared/session/session-prompt.test.js"
    - "src/shared/session/session-runtime.test.js"
    - "src/shared/session/session-transcript-projection.test.js"
    - "src/shared/session/root-session.test.js"
objectiveChecks:
    - id: "OC1"
      command: "bash -lc 'set -euo pipefail; base=src/shared/session/backends/claude-cli; test -s \"$base/command.ts\"; test -s \"$base/process.ts\"; test -s \"$base/stream-parser.ts\"; test -s \"$base/execution-session.ts\"; grep -q -- \"--output-format\" \"$base/command.ts\"; grep -q \"Deno.Command\" \"$base/process.ts\"; grep -q \"runwield.execution_backend\" \"$base/execution-session.ts\"; ! grep -q -- \"--resume\" \"$base/command.ts\"; out=$(deno run -A scripts/run-tests.js \"$base/claude-cli-backend.test.ts\" 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"([8-9]|[1-9][0-9]+) passed \\\\| 0 failed\"'"
      rationale: "Requires four non-empty production modules, direct Deno command and stream/persistence markers, no --resume, and at least eight passing backend behavior tests; empty test files or a placeholder module cannot satisfy it."
    - id: "OC2"
      command: "bash -lc 'set -euo pipefail; test -s src/shared/session/execution-backend.ts; grep -q \"buildExecutionSession\" src/shared/session/session.js; grep -q \"getRootExecutionMessages\" src/shared/session/agent-handler.ts; ! grep -q \"Claude CLI execution backend is not installed yet\" src/shared/models/model-execution.ts; grep -q \"Execution Backend\" CONTEXT.md; out=$(deno run -A scripts/run-tests.js src/shared/session/claude-cli-execution.test.ts 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"([5-9]|[1-9][0-9]+) passed \\\\| 0 failed\"; deno task seams:check'"
      rationale: "Requires typed production dispatch and Agent Handler integration, retirement of the temporary rejection, glossary alignment, at least five passing vertical tests, and no new Session machinery seam."
objectiveChecksBaseline:
    recordedAt: "2026-08-04T02:29:07.735Z"
    head: "8bf414d9e168f3ebd6fecc2569c337d38bd9c9ea"
    results:
        - id: "OC1"
          command: "bash -lc 'set -euo pipefail; base=src/shared/session/backends/claude-cli; test -s \"$base/command.ts\"; test -s \"$base/process.ts\"; test -s \"$base/stream-parser.ts\"; test -s \"$base/execution-session.ts\"; grep -q -- \"--output-format\" \"$base/command.ts\"; grep -q \"Deno.Command\" \"$base/process.ts\"; grep -q \"runwield.execution_backend\" \"$base/execution-session.ts\"; ! grep -q -- \"--resume\" \"$base/command.ts\"; out=$(deno run -A scripts/run-tests.js \"$base/claude-cli-backend.test.ts\" 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"([8-9]|[1-9][0-9]+) passed \\\\| 0 failed\"'"
          rationale: "Requires four non-empty production modules, direct Deno command and stream/persistence markers, no --resume, and at least eight passing backend behavior tests; empty test files or a placeholder module cannot satisfy it."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 12
          output: "\n"
        - id: "OC2"
          command: "bash -lc 'set -euo pipefail; test -s src/shared/session/execution-backend.ts; grep -q \"buildExecutionSession\" src/shared/session/session.js; grep -q \"getRootExecutionMessages\" src/shared/session/agent-handler.ts; ! grep -q \"Claude CLI execution backend is not installed yet\" src/shared/models/model-execution.ts; grep -q \"Execution Backend\" CONTEXT.md; out=$(deno run -A scripts/run-tests.js src/shared/session/claude-cli-execution.test.ts 2>&1); printf \"%s\\n\" \"$out\"; printf \"%s\\n\" \"$out\" | grep -Eq \"([5-9]|[1-9][0-9]+) passed \\\\| 0 failed\"; deno task seams:check'"
          rationale: "Requires typed production dispatch and Agent Handler integration, retirement of the temporary rejection, glossary alignment, at least five passing vertical tests, and no new Session machinery seam."
          status: "unmet"
          stdout: ""
          stderr: ""
          exitCode: 1
          durationMs: 10
          output: "\n"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-03T22:07:46-04:00"
updatedAt: "2026-08-04T03:56:33.506Z"
status: "verified"
origin: "internal"
parentPlan: "claude-cli-execution-backend"
order: 2
dependencies:
    - "01-register-claude-cli-backend-models"
implementedAt: "2026-08-04T02:59:06.790Z"
verifiedAt: "2026-08-04T03:56:33.506Z"
userVerifiedAt: null
executionReport: "- Implemented the Claude CLI execution backend tracer bullet: added backend-neutral execution sessions, Claude CLI command/process/stream parsing/execution modules, model dispatch, root/isolated turn routing, transcript replay/persistence, live deltas, usage, and sanitized `runwield.execution_backend` metadata.\n- Preserved Pi behavior while routing only `claude-cli/*` models through the new subprocess backend; Pi root sessions remain plain `AgentSession` objects for existing runtime/test compatibility, and no new internal dependency seams were added.\n- Updated docs/tests for Execution Backend terminology, Claude CLI model selection, backend command/parser/session behavior, root/isolated vertical execution, transcript projection, runtime/prompt/session compatibility, and shared-practice assertion brittleness; tests were added/rewritten for the new backend behavior, none were removed.\n- Verification passed: `deno task ci` completed successfully (`242 files passed | 0 failed`), including `deno task seams:check` (`73 seam(s) across 28 module(s), baseline holds`)."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "96cb004fa899d4dcb25f2e9c0f197e208e51cbdd"
    targetBranch: "main"
    targetHeadBeforeMerge: "30ecd590170a3ce12891cefb3ec2742b15678cb4"
validationCiAttempts: 0
validationSemanticRounds: 0
---

# Add Claude CLI Backend Transcript Tracer Bullet

## Context

Child 01 is verified and now resolves every non-empty `claude-cli/<selector>` to explicit
`executionBackend: "claude-cli"` metadata. It deliberately rejects that backend before Pi `AgentSession` construction,
keeps Claude references selectable but not API-auth/runnable, and leaves explicit selections deferred. This child
replaces that temporary rejection with the first real execution path.

The current root path is tightly Pi-shaped: `buildAgentSession()` resolves the Agent/model and constructs Pi,
`ensureRootAgentSession()` installs that object, `runRootTurn()` calls Pi-specific `runPrompt()`, and `agent-handler.ts`
reads `agent.state.messages` for workflow outcomes. HostedSession-backed isolated runs use the same builder but normally
receive an in-memory SessionManager. In contrast, `SessionRuntime` already treats the active root as opaque and routes
all turns through the active Agent Handler, so backend dispatch belongs in Session composition—not in TUI, Workspace, or
workflow lifecycle code.

This child is the runtime tracer bullet, not the lifecycle integration. It covers durable root turns and
HostedSession-backed isolated turns needed by later workflow/Reviewer work. Standalone non-interactive Recorder prompts,
MCP terminal signals, robust health/cancellation/continuation policy, image delivery, and Claude internal tool-history
projection remain outside this slice. Per the user's planning decision, valid Claude output streams live assistant text,
while RunWield persists exactly one final assistant message for replay.

## Objective

Make selected `claude-cli/*` root and HostedSession-backed isolated Agent turns execute through a typed Claude CLI
Execution Backend instead of Pi. The backend must invoke `claude -p` without a shell, preserve Claude Code's default
coding-agent instructions while appending RunWield's assembled Agent instructions, stream only assistant text into the
existing SessionRuntime event vocabulary, and return ordinary Agent messages to existing workflow callers.

For durable root turns, RunWield must remain the Session Transcript authority: rebuild invocation context from the
current RunWield SessionManager branch, append RunWield-owned user/final-assistant/model/backend entries under the
normal Session directory, and replay the same final user-visible text without reading or resuming Claude Code session
files. Existing Pi-backed turns must retain their current construction, tools, event subscription, persistence,
compaction, image, thinking, temperature, steering, and workflow behavior.

## Approach

Add a typed discriminated execution result around the existing Session composition point. `"pi"` continues to wrap the
real Pi `AgentSession`; `"claude-cli"` owns a small execution-session object with the capabilities callers actually
need: run one turn, expose accumulated RunWield messages, report streaming state, and dispose. Keep the HostedSession
root slot opaque. Update the few Pi-specific readers (`runRootTurn`, isolated execution, and Agent Handler pre-turn
message count) to branch on the discriminator or use backend-neutral accessors rather than manufacturing a fake Pi
provider/session.

Keep `buildAgentSession()` as the Pi constructor and factor only the shared preparation needed before dispatch: load the
Agent Definition, resolve the selected model/backend, resolve thinking metadata, and assemble RunWield Agent
instructions/context projection. The Claude path must not preflight Pi-only binaries, register Pi Custom Tools, invoke
image fallback, apply Pi temperature/compaction, or call `createAgentSession()`. For this pre-MCP child, its appended
prompt exposes no RunWield Custom Tools and states that responses are non-terminal; child 03 will add workflow signal
tools.

Under `src/shared/session/backends/claude-cli/`, define a real subprocess capability port and a production Deno
implementation. Invoke `claude` directly with `-p`, `--model <selector>`, `--output-format stream-json`, `--verbose`,
`--include-partial-messages`, `--no-session-persistence`, and `--append-system-prompt-file <0600-temp-file>`; send the
serialized RunWield conversation/current request through stdin and always remove the prompt file. No shell command
string is constructed. Parse only official assistant text deltas plus the terminal result, ignore Claude thinking and
internal tool/subagent events, and emit all live deltas under one stable message id. The successful terminal result is
the single persisted assistant message; its text must equal the accumulated visible stream.

Use the supplied SessionManager as authority. Before spawning, derive context only from the current branch's ordinary
user/assistant text messages, append the current user message, and append an allowlisted `runwield.execution_backend`
custom entry. On success append one normal assistant message and normalized model/usage metadata. Root managers
therefore persist under the existing Session directory; isolated runs preserve today's in-memory isolation. Claude's
session id may be retained only in the allowlisted backend entry and is never passed to `--resume`. Existing transcript
projection already understands the normal message/model entries, so strengthen replay coverage rather than introducing a
Claude-specific display format.

## Files to Modify

- `CONTEXT.md` — define **Execution Backend** as the Agent-turn runtime selected by model metadata, distinguish it from
  a model provider and Agent Session, and record that RunWield still owns Session Transcript/workflow truth.
- `src/shared/models/model-execution.ts` — replace the temporary Claude-only rejection boundary with typed backend
  discrimination while preserving rejection for genuinely unknown backend metadata.
- `src/shared/session/execution-backend.ts` — add concrete TypeScript discriminated types/accessors for Pi versus Claude
  execution sessions and ordinary Agent-message results; do not use `any`, `unknown`, or bare `object`.
- `src/shared/session/session.js` — share Agent/model/prompt preparation, dispatch root and HostedSession-backed
  isolated turns by resolved backend metadata, keep `buildAgentSession()` Pi-only, stream Claude events, expose
  backend-neutral root messages to workflow readers, and preserve the existing Pi path unchanged.
- `src/shared/session/agent-handler.ts` — obtain pre-turn/root messages through the backend-neutral accessor so ordinary
  Claude messages can participate in the same downstream workflow inspection without requiring `agent.state`.
- `src/shared/session/backends/claude-cli/` — add typed `command.ts`, `process.ts`, `stream-parser.ts`, and
  `execution-session.ts` production modules for direct command construction, the Deno subprocess port, assistant-only
  stream parsing, RunWield-history/persistence, sanitized metadata, and focused tests.
- `src/shared/session/claude-cli-execution.test.ts` — add the vertical fixture test: a fake `claude` executable on
  `PATH` receives the expected argv/stdin, a Claude-selected root and isolated turn succeed without Pi, live assistant
  text is emitted, and root JSONL persists the final result.
- `src/shared/session/session-prompt.test.js` — protect Pi construction/root reuse/subscriber/isolated behavior while
  covering the backend-neutral message accessor and text-only Claude rejection for images.
- `src/shared/session/session-runtime.test.js` — prove a direct Claude model reconfiguration now commits only after a
  successful Claude root build, while failed construction still rolls back the prior root/handler/model projection.
- `src/shared/session/root-session.test.js` — reopen the real root SessionManager after a Claude fixture turn and prove
  normal message/model/backend entries live in the existing RunWield session JSONL.
- `src/shared/session/session-transcript-projection.test.js` — prove persisted Claude user/final-assistant entries
  replay as ordinary events, backend metadata remains display-only, and replay text equals the completed live stream.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/models/model-registry.ts` — consume the verified `RunWieldModel.executionBackend` metadata and
  pass-through Claude selector; do not parse provider strings in workflow/session callers.
- `src/shared/session/session.js` — reuse `loadAgentDef`, `resolveModel`, configured thinking resolution,
  `assembleFinalSystemPromptWithContextProjection`, debug conventions, root metadata, and existing Pi constructors.
- `@earendil-works/pi-coding-agent` `SessionManager` — reuse `appendMessage`, `appendCustomEntry`, model-change entries,
  current-branch reads, and the existing root Session directory; do not create a second transcript store.
- `src/shared/session/session-runtime-events.js` — emit existing `ASSISTANT_TEXT_DELTA`, `USAGE`, and status/error
  shapes so TUI, ACP, and Workspace need no backend-specific adapter behavior.
- `src/shared/session/session-transcript-projection.js` — reuse ordinary user/assistant/model replay and ignore unknown
  backend custom entries as display-only metadata.
- `src/testing/process-global-lock.js` — protect tests that alter `PATH`/`HOME`; use a real executable fixture at the
  process boundary instead of adding a dependency bag to Session machinery.

## Implementation Steps

- [ ] `CONTEXT.md` defines **Execution Backend** as the model-selected runtime that executes an Agent turn, explicitly
      distinguishes it from provider/Agent Session, and states that changing backend does not transfer Session
      Transcript, workflow, or lifecycle authority away from RunWield.
- [ ] `src/shared/session/execution-backend.ts` provides a concrete discriminated Pi/Claude execution-session contract;
      Claude callers no longer depend on Pi's `agent.state`, while Pi still carries the real Pi `AgentSession`. New
      TypeScript contains no `any`, `unknown`, bare `object`, `@ts-ignore`, or `@ts-nocheck`.
- [ ] `buildExecutionSession()` selects from the resolved `RunWieldModel.executionBackend`, never Agent name or
      provider-string parsing: `claude-cli/*` root and HostedSession-backed isolated turns reach Claude, Pi models reach
      `createAgentSession()`, and unsupported future backend values fail before either runtime starts.
- [ ] `buildAgentSession()` remains the Pi-only constructor with its current tool wiring, extensions, SessionManager,
      image/Vision Fallback, temperature, thinking, compaction, subscriber, steering, and persistence behavior; Claude
      composition does not instantiate Pi, run Pi-only preflights, or install fake Pi models/providers/sessions.
- [ ] The Claude command is executed without a shell as
      `claude -p --model <exact-selector> --output-format stream-json
      --verbose --include-partial-messages --no-session-persistence --append-system-prompt-file <temp>`;
      prompt/history travel over stdin, the appended-system-prompt file has owner-only permissions and is removed on
      success/error, and command metadata never records prompt text, temp paths, environment values, tokens, or settings
      payloads.
- [ ] The stream parser emits only assistant text deltas under one stable runtime message id, ignores Claude
      thinking/file/Bash/edit/subagent events, normalizes allowlisted usage/final metadata, and requires the successful
      terminal result text to equal the accumulated visible assistant text. Exactly one final assistant message is
      appended; partial chunks are never persisted as duplicate messages.
- [ ] Each invocation derives bounded-to-the-current-branch conversation context only from RunWield-owned ordinary
      user/assistant text entries, appends the current user entry before spawn, and never reads Claude transcript files
      or passes `--resume`. Root turns persist through the existing root SessionManager; isolated turns use their
      supplied manager or a fresh in-memory manager and do not leak into the root Session Transcript.
- [ ] Claude transcript metadata uses one versioned `runwield.execution_backend` custom-entry schema containing only
      backend/provider/model/output format and optional external session id; ordinary model/user/assistant/usage data
      use existing SessionManager message forms, and no custom entry becomes workflow or lifecycle authority.
- [ ] `runRootTurn`, Agent Handler pre-turn counting, root switching/reuse, and HostedSession-backed isolated execution
      consume backend-neutral message/run/dispose behavior. A valid Claude turn returns ordinary Agent messages to
      current callers; no lifecycle outcome is synthesized from prose, and absent MCP signals remain non-terminal in
      this child.
- [ ] Claude image attachments fail with an explicit unsupported-in-this-slice error before subprocess start or
      transcript append. Existing Pi direct-image and Vision Fallback behavior remains unchanged.
- [ ] `claude-cli-backend.test.ts` contains at least eight behavior tests across argv/stdin/temp-file cleanup, stream
      filtering/final equality, metadata sanitization, and real SessionManager appends; `claude-cli-execution.test.ts`
      contains at least five vertical tests covering root/isolated dispatch, live events, no-Pi execution, root-only
      persistence/replay, and transactional model reconfiguration. Existing Pi regression suites pass, and
      `deno task seams:check` confirms no new seam in RunWield-owned Session/workflow machinery.

## Verification Plan

- Automated backend/vertical objective:
  `deno run -A scripts/run-tests.js src/shared/session/backends/claude-cli/claude-cli-backend.test.ts src/shared/session/claude-cli-execution.test.ts`
- Automated transcript/replay:
  `deno run -A scripts/run-tests.js src/shared/session/session-transcript-projection.test.js src/shared/session/root-session.test.js`
- Automated Pi/session regression:
  `deno run -A scripts/run-tests.js src/shared/session/session-prompt.test.js src/shared/session/session-runtime.test.js src/shared/session/session-subscribers.test.js src/shared/session/image-attachments.test.js src/shared/session/session-temperature.test.js src/shared/session/agent-handler.test.ts`
- Automated policy/type gate: `deno task check && deno task seams:check`
- Full regression gate: `deno task ci`
- Manual: with Claude Code installed and authenticated, explicitly select `claude-cli/sonnet` for a non-terminal Guide
  turn, confirm assistant text arrives incrementally, reload the Session, and confirm exactly the same complete user and
  assistant messages replay. Confirm no Claude thinking/internal tool events appear and Claude's own session history can
  be disabled/removed without affecting RunWield reload.
- Expected: direct Claude selection now builds and runs the Claude backend; advertised Claude entries may remain outside
  normal runnable/API-auth listings until child 04 health and child 05 selection UX land.
- Behavior protected afterwards: Pi-backed root/isolated turns still construct real Pi `AgentSession`, use Custom Tools,
  preserve compaction/image fallback/subscribers/temperature/thinking/steering, and persist through the same
  SessionManager behavior.
- Behavior expected to stop existing: a selected `claude-cli/*` HostedSession turn no longer throws the child-01
  “backend is not installed yet” error or falls through toward Pi construction; valid Claude stream text no longer waits
  until process exit to become visible.
- Glossary: `CONTEXT.md` must describe only the now-implemented Execution Backend ownership boundary; MCP workflow
  signals, health guarantees, and UI availability remain proposed and must not be promoted as current truth.

### Objective-Failing Checks

- `OC1` —
  `bash -lc 'set -euo pipefail; base=src/shared/session/backends/claude-cli; test -s "$base/command.ts"; test -s "$base/process.ts"; test -s "$base/stream-parser.ts"; test -s "$base/execution-session.ts"; grep -q -- "--output-format" "$base/command.ts"; grep -q "Deno.Command" "$base/process.ts"; grep -q "runwield.execution_backend" "$base/execution-session.ts"; ! grep -q -- "--resume" "$base/command.ts"; out=$(deno run -A scripts/run-tests.js "$base/claude-cli-backend.test.ts" 2>&1); printf "%s\n" "$out"; printf "%s\n" "$out" | grep -Eq "([8-9]|[1-9][0-9]+) passed \\| 0 failed"'`
  — fails before the four production modules exist and prevents empty/zero-test counterfeits while exercising the direct
  no-shell command, prompt file/stdin, assistant-only stream parser, final equality, sanitized metadata, and real
  SessionManager append contract.
- `OC2` —
  `bash -lc 'set -euo pipefail; test -s src/shared/session/execution-backend.ts; grep -q "buildExecutionSession" src/shared/session/session.js; grep -q "getRootExecutionMessages" src/shared/session/agent-handler.ts; ! grep -q "Claude CLI execution backend is not installed yet" src/shared/models/model-execution.ts; grep -q "Execution Backend" CONTEXT.md; out=$(deno run -A scripts/run-tests.js src/shared/session/claude-cli-execution.test.ts 2>&1); printf "%s\n" "$out"; printf "%s\n" "$out" | grep -Eq "([5-9]|[1-9][0-9]+) passed \\| 0 failed"; deno task seams:check'`
  — fails on the current Pi-only wiring and prevents empty/zero-test counterfeits; passing requires typed backend
  dispatch through root and isolated HostedSession paths, live text, no-Pi execution, root-only persistence/replay,
  model reconfiguration, glossary integration, and no added Session machinery seam.

## Edge Cases & Considerations

- **Child boundary:** MCP `plan_written`/`task_completed`/`review_complete` signals belong to child 03. Missing terminal
  signals remain ordinary non-terminal assistant text here. Health/auth/version diagnosis, malformed/truncated stream
  policy, cancellation/process-tree cleanup, post-terminal output, effort mapping, and bounded continuation/reminder
  behavior belong to child 04.
- **Streaming consistency:** live deltas are projections; the final successful result is persistence authority. A valid
  fixture requires equality. Mismatch/malformed/non-zero-exit recovery must fail visibly rather than persisting a
  different answer, with the complete policy hardened by child 04.
- **Conversation authority:** history comes from the current SessionManager branch, not the full raw JSONL or Claude
  files. Include ordinary user/assistant text only; never feed backend metadata, workflow projections, hidden Claude
  events, or unrelated branches back as conversation authority.
- **Prompt/tool mismatch:** this child appends the merged Agent role/context but advertises no RunWield Custom Tools.
  Use a non-terminal Guide flow for manual proof. Do not parse text that resembles tool calls or lifecycle signals.
- **Images:** reject Claude image turns explicitly for now rather than silently dropping attachments or invoking Pi
  Vision Fallback. Pi image behavior must not change.
- **Isolation:** a supplied isolated SessionManager may intentionally retain context across repeated isolated prompts,
  but its entries must never be copied into the root Session Transcript merely to make tests or replay convenient.
- **Security:** invoke without a shell; preserve the exact selector as one argv value; keep system/user prompts out of
  persisted command metadata; never persist environment variables, API keys, auth tokens, prompt-temp paths, full argv,
  or raw Claude settings/output payloads.
- **External session id:** if retained, it is diagnostic metadata only. It must never drive resume, lifecycle,
  deduplication, replay, or workflow ownership.
- **Seams:** the subprocess port is a genuine external-boundary port. Do not add/expand `_buildAgentSession`,
  `_runPrompt`, `__deps`, or `__testDeps` seams in Session, lifecycle, registry, or transcript authorities;
  executable/PATH fixtures exercise production composition.
