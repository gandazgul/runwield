---
planId: "3d5753f1-239c-425d-9e19-d65d77a79076"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
affectedPaths:
    - "src/tools/delegate-agent.ts"
    - "src/tools/background-task.ts"
    - "src/shared/session/hosted-session.js"
    - "src/shared/session/session.js"
    - "src/shared/session/session-runtime.ts"
    - "src/shared/session/runtime/"
    - "src/shared/foreground-process.ts"
    - "src/ui/tui/chat-input-controller.ts"
    - "src/ui/workspace/server/session-continuation.js"
    - "src/acp/server.js"
    - "src/agent-definitions/"
    - "docs/prd/runwield-core-prd.md"
    - "docs/domain-language.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-09-22"
origin: "internal"
status: "ready_for_work"
userVerifiedAt: null
---

# Session Background Tasks

## Context

An Agent currently waits for `bash` and `delegate_agent` to return. Shell `&` can detach a command, but it does not
deliver its result to the model. The owner wants a separate `background_task` tool, and an optional background mode for
read-only delegation, using the same small Session-owned registry.

Approved decisions:

- `background_task` supports `start`, `status`, and `cancel`, using `task_id`.
- At most five background tasks are active per Session within its owning host process. Limits, status, and cancellation
  are local to that owner, not shared across Sessions or processes. Existing delegation permits at most three readers
  and one exclusive synchronous writer; preserve those limits.
- `delegate_agent` accepts `background: true` only with requested `mode: "read"`.
- Completed results go to the parent as steering while it works. If steering is unsupported or remains unconsumed,
  deliver the result in a new turn after settlement, without waiting for user input.
- Results at most 8 KiB are inline. Larger results use a readable log path, byte count, and line count.
- Tasks survive normal parent turn completion. Explicit Stop and host shutdown cancel them and suppress late automatic
  turns. Closing a browser tab does not stop server-owned tasks. No recovery or replay of tasks after process exit.
- TUI, Workspace, and ACP support automatic result turns. No new task dashboard.

Owning requirements and proposed changes:

- [Core Session continuity](../prd/runwield-core-prd.md#session-continuity): add named requirements **Run bounded
  background work** and **Receive task results without another user message**, with scenarios below. Preserve **Continue
  the same saved work across clients** and **Route attention to the latest user-input surface**. Generated completion
  input must not change the notification destination.
- [Core TUI conversation](../prd/runwield-core-prd.md#tui-conversation): preserve **Keep follow-ups with their active
  specialist**, user drafts, and command meanings. Automatic results are not user commands.
- [Workspace Browser Sessions](../prd/runwield-workspace-prd.md#browser-sessions): extend **Preserve conversation,
  drafts, and controls in the browser** to automatic result turns and tab closure, linking Core for task rules.
- [ACP Session access](../prd/runwield-acp-protocol-prd.md#acp-session-access) and
  [Protocol negotiation and interactions](../prd/runwield-acp-protocol-prd.md#protocol-negotiation-and-interactions):
  add result-driven activity after an earlier prompt response, preserving truthful cancellation, event delivery, and
  interactions.

Current code awaits `runIsolatedAgentSession()` and disposes registered children in
`HostedSession.dehydrateManagedSession()`. Existing automatic follow-up draining removes input before turn acceptance
and uses user-message semantics. These paths need bounded changes; returning a task ID alone does not implement this
feature.

## Objective

The Agent can start independent shell work or a read-only delegate, continue its own work immediately, and receive the
final result automatically in the same Session, even after its turn ends. Both kinds of task share limits, status,
cancellation, result formatting, and delivery.

## Approach

### Tool interface

```js
background_task({ action: "start", command: "deno task test", timeout: 600 });
// -> { task_id, state: "running", log_path }
background_task({ action: "status", task_id });
background_task({ action: "cancel", task_id });

delegate_agent({ mode: "read", brief: "Inspect the parser", background: true });
// -> { task_id, state: "running", log_path }
```

`timeout` is optional, in seconds, matching `bash`; omission means no timeout. `start` captures the caller's actual
execution directory and effective permissions. `status` requires a task ID and returns kind, state, output byte/line
counts and log path, plus exit code or delegate error when settled. Completed status uses the same inline/file result
rule. `cancel` targets only that Session's task and settles its work; repeated cancellation or cancellation after
completion returns current status. Unknown or foreign IDs fail without changing another task. There is no list action in
this change.

Reserve capacity before starting asynchronous work. Starting and cancelling tasks count as active until their
process/Agent and output streams settle. Completed records remain available for status during the owning host Session
lifetime but do not use a slot. A sixth active start fails promptly; there is no hidden pending job queue. Normal
synchronous delegates still count against the three-reader/exclusive-writer rule, but not the five-background-task
limit.

Keep ordinary `bash` and default `delegate_agent` behavior unchanged. Reject requested write mode plus
`background: true` before role reduction, including `verification-adversary`. Preserve current backend availability:
Claude CLI and Antigravity CLI still do not receive `delegate_agent`; they may receive the shell background tool under
their existing shell authority.

### Ownership and delivery

```text
Tool start
  -> Session task registry reserves capacity
  -> shell process or isolated read delegate starts
  -> tool returns task_id before work finishes

Task settles and log closes
  -> record final result
  -> parent root is running: queue root-targeted steering
  -> otherwise, or steering not consumed: start a managed result turn
  -> acknowledge delivery when input is consumed/accepted, not merely queued
```

Use a Session-lifetime registry attached to `HostedSession`, separate from disposable root and foreground child
sessions. It owns task controllers, settlement promises, records, and pending completion delivery. Runtime owns
scheduling; hosts own transport and presentation. No database, daemon, heartbeat, persistent delivery ledger, or new
writer lock.

The background delegate must use an isolated child execution path without becoming the foreground steering target,
changing the parent's Agent/thinking display, or retaining its managed-operation write capability. Capture
model/thinking settings and the bounded brief at start. The child may outlive root dehydrate/rehydrate; existing
synchronous child behavior stays intact. Do not reset reader accounting while background readers exist.

Deliver to the Session's parent root, never `getActiveSteeringTargetSession()` which can select another child.
Re-resolve the root after Agent changes or hydration rather than retaining a disposed root object. The current selected
specialist handles later result turns; background completion does not switch back to a historical Agent.

Introduce a typed runtime-generated completion origin and task ID. Reuse managed prompting and existing queue
observation, but do not send output through named-invocation expansion, user draft recall, user-input notification
routing, Pair checkpoint resolution, or user approval handling. Command output and delegate output are data, not new
user authority. A task result is not `task_completed` or publication evidence.

Retain a pending result through busy-to-idle transitions, unsupported steering, and rejected managed-turn acquisition.
Reconcile steering consumption before disposing its source. Only one runtime result drain may start a turn for a
Session; serialize with user input and workflow activity. A result pending while a question/review is open waits rather
than dismissing the interaction. Do not duplicate a result that steering already consumed. Stop suppresses pending and
late completion delivery for the cancelled tasks; later user work may start new tasks normally.

Workspace currently closes its runtime Session after each operation; retain it while tasks or result delivery remain and
restore event/interaction handling for generated turns. Later operations for the same saved Session must reuse that
retained owner rather than call `adoptManagedSession()` to create another one: `SessionHost` rejects duplicate live
owners. Release the retained owner through normal cleanup when background work and delivery are drained, without racing
a new user submission. ACP currently attaches these handlers per prompt request; keep the necessary Session-level
handling for automatic turns after that request returns, using supported `session/update` and interaction messages. Do
not keep the original prompt artificially pending, forge a client prompt request, or emit a second response to it. TUI
must treat runtime-started turns as busy even without a local user submission.

Tasks and their controls remain in their starting host process. Do not search other Sessions or processes for a task ID,
route task controls or results to another process, or transfer/reconstruct tasks on a surface switch. Separate processes
attached to the same saved Session have independent task limits and registries. Do not hold the Session's file writer
lock while a task runs. If another process currently owns a turn, the starting host retains completion until its own
managed result turn can be accepted through existing Session locking. Delivered results and responses are saved as
normal Session history.

### Output

Write shell stdout/stderr incrementally to a Session-scoped local task log; do not buffer an entire large result in
memory. Preserve order within each stream without claiming exact ordering between stdout and stderr. Read-only delegate
final output must reach the log before the existing 20,000-character synchronous truncation, so background results are
not silently cut off.

The completed message contains `task_id`, kind, final state, exit code/error when applicable, and either the complete
text for output at most 8,192 UTF-8 bytes or `log_path`, `byte_count`, and `line_count`. Count a final nonempty
unterminated line. Sanitize terminal control bytes in presented text without destroying the stored log. An empty result
explicitly says there was no output. Status counts while running are a snapshot.

Place logs under ~/.wld/sessions/project-id/sessionid/taskid.err.log and taskid.out.log, not the worktree. Keep paths
readable after normal turn settlement and host closure; no automatic log retention service is added. Disk/log write
failure fails the task visibly, terminates its work, and reports partial output if available. Log files do not imply
restartable tasks.

The option set aside is extending `bash` with a flag: the owner chose a separate tool so background execution and its
controls are explicit. Persistent jobs and async writers are excluded; both would require materially more ownership and
recovery behavior.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/tools/background-task.ts` (new), `src/tools/delegate-agent.ts`, and tool tests — action validation, immediate
  start results, permissions, shared result format, and optional background reads.
- `src/shared/session/background-tasks.ts` (proposed focused owner), `hosted-session.js`, `session.js` — registry, child
  ownership, output storage, limits, and foreground separation.
- `src/shared/session/session-runtime.ts`, `session-runtime-method-policy.ts`, and private `runtime/` queue, turn,
  event, lifecycle, and managed-operation owners — generated completion delivery, safe settlement, and Stop. Keep the
  existing public runtime boundary.
- `src/shared/foreground-process.ts` and existing output/read helpers — reuse process-tree termination and safe text
  handling; change only if needed for reuse.
- `src/shared/session/agents.js`, `subagent-definitions.ts`, tool composition/policy tests, and bundled Agent
  definitions — expose the tool under effective authority and explain intended use. No new authority for read-only
  children or workflow-only agents.
- `src/ui/tui/chat-input-controller.ts`, runtime adapter tests, `src/ui/workspace/server/session-continuation.js`,
  continuation integration tests, `src/acp/server.js`, and ACP session tracking/tests — automatic turn lifecycle and
  observable output in existing conversation surfaces. Incidental event rendering may change; no new visual pattern or
  dashboard.
- `docs/domain-language.md` — define Background Task and its relationship to shell work, Delegated Agent Session, and
  Session. Distinguish generated task completion input from user Steering Message and workflow Task Completion.
- Core, Workspace, and ACP PRD capabilities linked above; `docs/adr/010-session-runtime-sibling-adapters-and-acp.md` and
  `015-file-authoritative-session-bundles.md` — record Session-lifetime task ownership versus operation-scoped
  transcript authority, generated turns, and no restart recovery. Update existing guidance rather than add a competing
  architecture. Update relevant tool/customization/ACP references.

## Reuse Opportunities

- `spawnForegroundShell()` in `src/shared/foreground-process.ts` — owned process tree, timeout, cancellation, and
  pre-abort protection; its name does not require foreground ownership.
- `src/shared/session/runtime/local-shell.ts` and `src/shared/workflow/validation-local-ci.ts` — await both process and
  stream settlement, but do not reuse unbounded foreground output accumulation.
- `createDelegateAgentTool()`, `resolveDelegatedToolNames()`, role ceilings, and `acquireDelegatedAgentLease()` —
  preserve inherited context, permissions, existing reader limit, and writer exclusion.
- `steerRootSessionWithTarget()` in `session.js` — root-specific routing, unlike ordinary user steering which prefers
  the foreground child.
- `RuntimeQueues` queue observation and `RuntimeTurns`/`RuntimeManagedOperations` — controlled input delivery,
  synchronization, hydration, generation publication, and lock release. Fix acceptance handling only where required for
  task delivery; do not rewrite unrelated user queues.
- Existing semantic events and host interaction adapters — show generated work through current conversations, not a
  second notification UI.

## Implementation Steps

1. **One registry executes both task kinds.** Five active slots are enforced atomically per owning Session within its
   host process, including pending starts. Task control never looks up another Session or process; no cross-process
   limit is enforced. IDs, output logs, status, final outcomes, and idempotent cancellation are shared by shell and
   delegate tasks. Actual process/Agent settlement releases slots. Failed starts cannot leak capacity or reader leases.
2. **`background_task` runs real shell work without blocking the parent.** `start` returns before command exit; `status`
   observes live and final state; `cancel` terminates descendants and drains streams. The tool uses the caller's
   execution directory, respects effective shell authority, and does not appear in read-only child tool ceilings.
   Hosts/backends that lack shell authority cannot obtain it through this tool. Status/cancel can serve an allowed
   background delegate without granting shell start authority.
3. **`delegate_agent` supports background reads without foreground side effects.** Omitted/false `background` retains
   synchronous behavior. Requested background writes fail before launch. Background children survive normal parent
   settlement, use independent cancellation, preserve the three-reader and exclusive-writer rules, and do not acquire
   parent transcript authority or become its steering target. Their final logs retain output beyond the synchronous
   truncation limit.
4. **Results reach the model without user polling or another message.** Short/large output obeys the byte threshold.
   Busy root delivery uses steering where supported; unconsumed/unsupported steering becomes a managed result turn after
   settlement. The result is neither lost on a returned acquisition failure nor duplicated on a consumption race. Output
   is recorded with generated origin; it cannot execute slash commands, change notification destination, resolve a Pair
   checkpoint, or supply user approval.
5. **Task lifetime matches Stop and shutdown.** Normal turn cleanup leaves tasks and reader accounting intact and
   releases the file writer lock. Explicit Stop cancels active tasks even when the parent is idle, suppresses
   pending/late result turns, and permits later new tasks. Host shutdown cancels and awaits owned work. Browser
   disconnect alone has no such effect. Session closure caused solely by normal Workspace operation cleanup is not
   treated as explicit shutdown.
6. **All three hosts handle result-driven turns through Core.** TUI busy/input behavior, Workspace
   operation/events/interactions, and ACP Session notifications/interactions remain active for generated work. User
   submissions and results cannot create overlapping root turns. The original ACP response ends normally; later result
   output is sent once on the same Session without another client prompt. Existing backend delegation exclusions remain.
7. **Product language and guidance match the delivered scope.** The glossary contains the implemented Background Task
   definition, avoided aliases, and relationships. Linked PRDs contain the new requirements and acceptance scenarios,
   preserve existing behavior, and leave no implication of durable jobs or newly supported CLI delegation. ADR-010/015
   and affected tool/Agent/ACP documentation reflect Session-owned tasks and generated input, without contradicting
   operation-scoped locks or user-only approval rules.

## Approval Confirmation

No Work Records are proposed for replacement. Reviewable implementation defaults: optional timeout with no default; logs
remain readable in local Session storage without an added retention service; no list action; a later automatic turn uses
the Session's current specialist. The numerical limits, lifetime, host coverage, delivery fallback, and process-local
scope were confirmed in planning. The owner explicitly excluded cross-Session control, cross-process task coordination,
and restart recovery. No product decisions remain open.

## Verification Plan

Use the sandboxed runner, never `deno test` directly. Add focused tests beside the owners, then run:

```sh
deno run -A scripts/run-tests.js src/tools/background-task.test.ts src/tools/__tests__/delegate-agent.test.js
deno run -A scripts/run-tests.js src/shared/session/background-tasks.test.ts src/shared/session/background-task-delivery.test.ts
deno run -A scripts/run-tests.js src/shared/session/managed-queue-lifecycle.test.ts src/shared/session/close-awaits-operation.test.ts src/shared/session/managed-operation-boundary.test.ts
deno run -A scripts/run-tests.js src/shared/session/__tests__/session-tools-policy.test.js src/shared/foreground-process.test.ts
deno run -A scripts/run-tests.js src/ui/tui/chat-input-controller.test.ts src/ui/workspace/session-continuation.integration.test.ts src/acp/server.test.js
deno task seams:check
```

New test filenames are proposed; adjust commands to the actual focused files. Fake only external model turns/process
timing where needed. Use real HostedSession, tools, registry, managed Session storage, and process fixtures. Tests that
change home/cwd use the project lock and safe fixture helpers.

Required behavioral evidence:

- **Nonblocking start:** a real gated shell command writes a marker only after release. Start returns while it remains
  blocked; the parent performs another tool action before release. Check final output/exit after release. A foreground
  wrapper fails this test. Repeat through an actual isolated delegate path with a controlled external model boundary,
  not a fake registry.
- **Shared limits:** mix shell and read-delegate tasks to reach five; sixth launch is refused before spawning. A fourth
  reader fails even with total capacity free. Synchronous readers share reader accounting. Failed starts/cancelled work
  release capacity only after settlement. Two Sessions do not share counts or task access. Independent host processes do
  not share registries or limits even for the same saved Session. A foreign task ID fails locally without an
  inter-process lookup or control request.
- **Task control:** observe growing log counts during execution; status and cancellation work on both task kinds.
  Repeated cancel is harmless. Cancelling a command with a spawned descendant stops that descendant too. Log/setup
  error, timeout, nonzero exit, and delegate failure all yield truthful final state and release resources.
- **Output boundaries:** empty output; 8,192-byte and 8,193-byte UTF-8 output; multibyte characters; mixed streams; no
  trailing newline; delegate output over 20,000 characters. Read the returned large log through the normal read tool and
  verify its complete final content. A truncated-prefix log or character-count threshold fails.
- **Busy delivery:** root and foreground child coexist; completion reaches only the root once at a safe boundary and
  does not replace its model/thinking/Agent identity. Assert the next actual model request contains the result, not
  merely that a UI event exists.
- **Idle delivery:** parent ends, its managed operation publishes and releases its lock, and no user input follows.
  Completing the task starts a second real runtime-managed model turn with the task ID/result; history reload contains
  the generated input and response. This test fails if implementation only queues a notification or waits for another
  prompt.
- **Delivery races:** steering queued immediately before root settlement, unsupported steering, returned `{ok:false}` on
  turn acquisition, simultaneous user input, and two task completions. After acceptance there is one copy per task, no
  overlapping root turns, and no dropped input. Unconsumed backend steering is not mistaken for delivered input.
- **Lifetime:** parent dehydrate/rehydrate does not dispose a background delegate or reset active reader counts.
  Explicit Stop while root-idle, Stop during setup, Stop while delivery waits, and host shutdown terminate tasks and
  prevent late model calls. A later user turn can start fresh tasks. Another managed reader/turn can access the Session
  after parent settlement while tasks run; background work does not retain the writer lock.
- **Authority:** rejected requested-write background delegation including role-reduced writes; tools absent under denied
  policies; shell start denied for delegate-only authority; recursive background launch unavailable to children. Task
  output containing `/agent`, `plan_written`, or approval-like text stays generated data and cannot resolve a checkpoint
  or change notification destination.
- **Host boundaries:** TUI automatic turns preserve drafts and accept steering. Workspace completes a task after
  original operation settlement and browser disconnect, then serves the saved result and new response on reconnect.
  While the task is still active, submit a second Workspace message through the real continuation entrypoint: it must
  reuse the retained owner, execute `status`/`cancel` on that task, and finish without duplicate-owner rejection. Also
  test owner cleanup racing a subsequent user submission. ACP returns the original `end_turn`, later sends result-driven
  output on the same Session without a new client prompt, can handle an interaction from that turn, and supports Stop.
  Validate actual ACP wire messages and response cardinality, not just Runtime events. Exercise fallback for CLI
  backends without claiming new delegate availability.

Preserve existing tests for synchronous delegation output, role ceilings, inherited model/thinking/context, writer
change attribution, failure edits, cancellation, reader limits, user foreground steering, managed locks, user follow-up
queues, host cancellation settlement, and CLI tool exclusions. Only the assumption that all children must die at every
parent turn end changes, and only for explicitly background read delegates. Do not delete synchronous coverage to make
new tests pass.

Manual: In each host, ask an allowed Agent to start a short delayed command, do a separate inspection, and end its turn.
Verify a result-driven response appears without typing. Repeat with large output and a read delegate where available;
ask for status and cancel by task ID. Stop while only a background task remains and verify no late response. In
Workspace reload/close the tab while server-owned work runs and reopen the same Session. In ACP use a real compatible
client to verify updates after `end_turn`; record client/version and any protocol limitation rather than claiming
unsupported behavior. Use existing surface controls and styles; no visual redesign acceptance is added.

Semantic Review: confirm one shared task owner and delivery path, real child independence from foreground cleanup, no
retained transcript capability, output logs from the actual task, and no user-authority escalation. Verify PRD
scenarios, glossary, and ADRs describe only behavior proven by the tests and host checks.

## Edge Cases & Considerations

- **Concurrent files:** shell tasks have ordinary shell authority and can write. No new worktree or file isolation is
  promised. Tool/Agent guidance should reserve background use for independent work and require result inspection before
  relying on it; callers must not treat a started test as a passed test.
- **Workflow transitions:** completion input must not bypass pending approval, prematurely complete a workflow, or
  restore a disposed execution worktree. Resolve current valid Session context through the existing managed prompt path.
- **Stop race:** suppress completion delivery before aborting tasks; await settlement before releasing resources. Stop
  of one foreground turn is not deliberate Plan abandonment.
- **Host lifetime:** routine Workspace operation cleanup differs from explicit Session close or process shutdown. Keep
  only the task-owning runtime state needed between turns; do not keep an operation lock open.
- **Process loss:** registry state is lost, logs may remain, and no command is automatically replayed. Graceful shutdown
  cancels owned descendants; do not claim a guarantee for forced OS termination that the process helper cannot provide.
- **Process-local scope:** task execution, limits, status, and cancellation belong only to the starting host process and
  owning Session. A competing managed operation can delay that host's result turn through existing file locking; it must
  not cause duplicate execution, retain an expired capability, or block ordinary Session continuity. Cross-Session task
  control, cross-process task routing/transfer, a global task registry, and restart recovery are excluded by the owner.
- **Protocol limitations:** ACP host-level output and interactions must be verified after the original prompt ends. If a
  required client cannot accept this supported message flow, report the concrete blocker before narrowing approved
  all-host scope.
- **No new testing seams:** use existing external process/model boundaries and real Session fixtures. Do not add
  injection points for owned registry, locks, Plan state, or delivery decisions.
