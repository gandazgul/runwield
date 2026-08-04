---
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "MEDIUM"
summary: "Make Escape reliably terminate all active Session work, including full CI and shell process trees."
affectedPaths:
    - "src/shared/foreground-process.ts"
    - "src/shared/foreground-process.test.ts"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/session-runtime.test.js"
    - "src/shared/workflow/validation-local-ci.ts"
    - "src/shared/workflow/validation-local-ci.test.ts"
    - "src/shared/workflow/objective-checks.ts"
    - "src/shared/workflow/objective-checks.test.ts"
    - "src/shared/workflow/validation.ts"
    - "src/shared/workflow/validation-loop-core.test.js"
    - "docs/architecture.md"
objectiveChecks:
    - id: "OC1"
      command: "deno eval 'import{SessionRuntime}from\"./src/shared/session/session-runtime.js\";const r=new SessionRuntime(),{sessionId:s}=await r.createInteractiveSession({cwd:Deno.cwd()}),f=await Deno.makeTempFile(),q=r.runLocalShellCommand(s,{command:\"sleep 30 & echo $! > \"+f+\"; wait\",persist:false});let p=0;while(!p){await new Promise(x=>setTimeout(x,10));p=+(await Deno.readTextFile(f))}r.cancelSession(s);await new Promise(x=>setTimeout(x,150));let a=true;try{Deno.kill(p,\"SIGCONT\")}catch{a=false}if(a)Deno.kill(p,\"SIGKILL\");await q;await Deno.remove(f);if(a)Deno.exit(1)'"
      rationale: "Exercises the public Runtime local-shell path and only passes when Session cancellation kills the wrapper shell's descendant process as well as reporting cancellation."
    - id: "OC2"
      command: "deno eval 'import{HostedSession}from\"./src/shared/session/hosted-session.js\";import{runLocalCI}from\"./src/shared/workflow/validation-local-ci.ts\";import{setCustomSetting}from\"./src/shared/settings.js\";const d=await Deno.makeTempDir(),f=d+\"/p\",s=new HostedSession({id:\"oc2\",cwd:d});await setCustomSetting(\"verification_command\",\"sleep 30 & echo $! > \"+f+\"; wait\",\"project\",d);const q=runLocalCI({hostedSession:s,cwd:d});let p=0;while(!p){await new Promise(x=>setTimeout(x,10));try{p=+(await Deno.readTextFile(f))}catch{}}s.cancelActiveInteractions();await new Promise(x=>setTimeout(x,150));let a=true;try{Deno.kill(p,\"SIGCONT\")}catch{a=false}if(a)Deno.kill(p,\"SIGKILL\");const z=await q;await Deno.remove(d,{recursive:true});if(a||!z.canceled)Deno.exit(1)'"
      rationale: "Exercises configured local CI through HostedSession cancellation and only passes when the full CI process tree terminates and runLocalCI reports a canceled result."
    - id: "OC3"
      command: "grep -q 'Workflow Validation treats canceled Objective-Failing Checks as a resumable pause' src/shared/workflow/validation-loop-core.test.js && deno task test src/shared/workflow/validation-loop-core.test.js --filter 'Workflow Validation treats canceled Objective-Failing Checks as a resumable pause'"
      rationale: "Requires workflow-level behavior proving canceled Objective-Failing Checks pause resumably without validation failure or Engineer repair."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-03T15:07:34-04:00"
updatedAt: "2026-08-03T19:12:53.183Z"
origin: "internal"
userVerifiedAt: null
routingIntent: "PLANNED_CHANGE"
sessionName: "escape cancellation reliability"
status: "validated_reviewer"
---

# Escape Cancels Active Work

## Context

Escape already has one consumer-neutral route: the terminal user interface (TUI) calls `SessionRuntime.cancelSession()`,
which aborts Session-owned active interactions and the active Agent Session. This correctly reaches prompts, compaction,
agent turns, and RunWield-owned shell/validation operations without putting process ownership in the TUI.

The reported failure is below that route. `SessionRuntime.runLocalShellCommand()` (`!` and `!!`) and `runLocalCI()`
start a wrapper shell with `Deno.Command` and cancel it with `child.kill()`. A validation command normally starts one or
more descendants, so killing only `sh -c`/`cmd /c` can leave the real test/build process running and can keep inherited
stdout/stderr pipes open. A deterministic baseline reproduction confirms this: Runtime reports `aborted: true` while a
`sleep` descendant remains alive. Both runners also have a start race in which cancellation can occur after the active
interaction is registered but before `child` is assigned, allowing a process to start after its only abort callback has
already fired.

Plan Objective-Failing Checks are part of Mechanical Validation and use the same direct-child kill pattern for both user
cancellation and timeout. During Workflow Validation they are not currently registered as an active Session interaction,
so Escape cannot cancel that stage uniformly. Agent-issued tool calls follow a different, already-correct path: aborting
the active Pi Agent Session aborts the current tool signal, and Pi's local `bash` tool kills its detached process group.
That behavior must remain protected rather than being replaced by TUI-specific or duplicate tool-call cancellation.

The working tree contains unrelated modifications, including two other Plan files, but no modification overlaps
`plans/escape-cancels-active-work.md`.

## Objective

Make Escape (and Ctrl+C's shared first-press cancellation action) stop all work currently owned by the active Runtime
Session. RunWield-owned foreground shell commands must terminate their complete process trees; Mechanical Validation
must stop cleanly during local CI or Objective-Failing Checks; active agent/tool execution must continue to receive the
Agent Session abort; and cancellation must preserve resumable workflow ownership instead of becoming a validation
failure or repair attempt.

## Approach

Keep `SessionRuntime.cancelSession()` as the sole cancellation authority used by TUI, Agent Client Protocol (ACP), and
other consumers. Do not add process handles or kill logic to `keybindings.js`.

Introduce a typed shared foreground-process module for RunWield-owned shell commands. It will launch each foreground
shell in an independently terminable process group, expose separate stdout/stderr streams and completion status to
existing callers, and bind an `AbortSignal` and optional timeout to whole-tree termination. On Unix-like systems the
shell is a detached process-group leader and cancellation signals the negative process-group ID; on Windows, termination
uses `taskkill /F /T /PID`. Signal registration and post-spawn aborted-state checks close the pre-spawn race, and
completion always detaches listeners and reaps the child. This is RunWield-owned process machinery, not a dependency
injection seam.

Use that module in the two foreground command runners and Objective-Failing Check execution. `!`/`!!` and local CI keep
their existing Session active-interaction registration, event lifecycle, output behavior, exit code `130`, and
`canceled: true` result. Workflow Validation registers the complete Objective-Failing Check phase as an active
interaction, passes its signal through every check, stops scheduling remaining checks after cancellation, and maps the
result to the same retry-or-stop pause used for canceled CI. QUICK_FIX cancellation remains with Engineer; executable
Plan cancellation preserves the active workflow and `implemented` status for later validation continuation.

“Active work” is Session-scoped: Escape cancels all current interactions and agent/sub-agent execution owned by the
focused Session, but does not cancel other Sessions or unrelated operating-system processes. A command deliberately
backgrounded after its foreground shell has already completed is no longer active Session work. Filesystem tools that
have entered an atomic write may finish that atomic operation, but the aborted Agent Session must schedule no subsequent
tool calls.

## Files to Modify

- `src/shared/foreground-process.ts` — add the typed, cross-platform owner for race-safe foreground shell spawning,
  separate output streams, completion, timeout, and full process-tree termination.
- `src/shared/foreground-process.test.ts` — prove cancellation and timeout kill a real parent/descendant tree, including
  an already-aborted signal and cancellation around process startup.
- `src/shared/session/session-runtime.js` — route `runLocalShellCommand()` through the shared foreground-process module
  while preserving Session interaction ownership and Runtime tool/cancellation events; a whole-file TypeScript migration
  is not reasonably bounded for this 2,700+ line runtime, so keep the existing JSDoc module and isolate new typed code.
- `src/shared/session/session-runtime.test.js` — replace the direct `sleep` cancellation test with a descendant-process
  regression and retain cancellation-event, idle-Escape, queued-message, compaction, and agent-abort assertions.
- `src/shared/workflow/validation-local-ci.ts` — run configured CI through the shared foreground-process module and
  preserve bounded output capture, tool lifecycle events, canceled result semantics, and active-interaction cleanup.
- `src/shared/workflow/validation-local-ci.test.ts` — exercise real configured CI cancellation through
  `HostedSession.cancelActiveInteractions()` and prove both shell and descendant terminate.
- `src/shared/workflow/objective-checks.ts` — use whole-tree termination for cancellation and timeout, make abort races
  safe, and stop launching later checks after the shared signal aborts.
- `src/shared/workflow/objective-checks.test.ts` — prove abort and timeout terminate descendants and cancellation
  prevents subsequent Objective-Failing Checks from running.
- `src/shared/workflow/validation.ts` — register the Objective-Failing Check phase as a Session active interaction and
  treat its cancellation as a resumable user pause, not a broken check, failed lifecycle event, or repair attempt.
- `src/shared/workflow/validation-loop-core.test.js` — cover Objective-Failing Check cancellation through Workflow
  Validation, including retry/stop behavior and preserved Plan/Engineer ownership.
- `docs/architecture.md` — record that SessionRuntime owns cancellation while the shared foreground-process service owns
  RunWield subprocess groups; consumers remain process-handle-free.

## Reuse Opportunities

- `src/shared/session/session-runtime.js:cancelSession()` — retain the public, consumer-neutral cancellation boundary
  used by TUI and ACP.
- `src/shared/session/hosted-session.js:addActiveInteraction()` / `cancelActiveInteractions()` — reuse Session-scoped
  `AbortController` ownership; do not introduce a new dependency bag or a TUI-only process registry.
- `src/shared/session/session.js:abortActiveSession()` — preserve root/sub-agent abort propagation for agent-issued tool
  calls. Pi's `createBashToolDefinition()` already honors this signal and kills its full process tree.
- `src/shared/workflow/process-output.ts` — retain bounded tail capture for validation and Objective-Failing Check
  output; adapt process streams rather than reintroducing unbounded CI buffering.
- `src/shared/workflow/validation.ts` canceled-CI branch — reuse its retry-or-stop wording and resumable outcome for a
  canceled Objective-Failing Check phase.
- `src/shared/session/abort-active-session.test.js` and `src/ui/tui/keybindings.test.js` — retain coverage that Escape
  delegates to Runtime and Runtime aborts active agent/sub-agent execution without emitting idle cancellation noise.

## Implementation Steps

- [ ] `src/shared/foreground-process.ts` is the single RunWield-owned process primitive used by local shell commands,
      local CI, and Objective-Failing Checks; it launches an isolated process group, preserves separate stdout/stderr
      streams, reports the actual exit status, and contains no dependency-injection or product-machinery test seam.
- [ ] Aborting the primitive before spawn, during spawn registration, or after spawn terminates the entire descendant
      tree exactly once, settles promptly, and removes signal/timeout listeners; timeout uses the same whole-tree
      guarantee and remains distinguishable from user cancellation.
- [ ] `SessionRuntime.runLocalShellCommand()` preserves `!` persistence and `!!` ephemeral semantics, live
      `TOOL_START`/`TOOL_UPDATE`/`TOOL_END` events, exit code `130`, canceled output, active-interaction cleanup, and
      session isolation while killing descendants rather than only the wrapper shell.
- [ ] `runLocalCI()` preserves bounded tail output and truncation notices, returns `{ exitCode: 130, canceled: true }`,
      emits one canceled tool completion, and unregisters its active interaction only after the CI process tree has
      settled.
- [ ] `runObjectiveChecks()` kills descendant processes on timeout or abort, records the interrupted check as aborted,
      and does not start any remaining checks after its signal is aborted; ordinary met/unmet/broken classification and
      baseline execution without a Session remain unchanged.
- [ ] Workflow Validation owns an active interaction for the Objective-Failing Check phase. Escape aborts it, removes
      the interaction in `finally`, records cancellation metrics, and follows the canceled-CI retry-or-stop pause
      without staging `mechanical_validation_failed`, `validation_failed`, or dispatching Engineer repair.
- [ ] QUICK_FIX cancellation still returns control to Engineer, executable Plan cancellation leaves the active workflow
      resumable at `implemented`, and neither path clears execution/worktree authority or reports successful Mechanical
      Validation.
- [ ] Existing agent/tool-call cancellation remains signal-driven through `abortActiveSession()`: a streaming root and
      all Session-owned sub-agents abort, queued follow-up tool calls are cleared, other Sessions remain untouched, and
      an idle Escape remains silent.
- [ ] `docs/architecture.md` describes SessionRuntime as cancellation authority and the foreground-process module as the
      subprocess-tree owner without assigning process control to TUI or ACP consumers.

## Verification Plan

- Automated: run the two Objective-Failing Checks below before implementation and observe both exit non-zero because a
  descendant survives even though Runtime/HostedSession reports cancellation.
- Automated:
  `deno task test src/shared/foreground-process.test.ts src/shared/session/session-runtime.test.js
  src/shared/session/abort-active-session.test.js src/ui/tui/keybindings.test.js
  src/shared/workflow/validation-local-ci.test.ts src/shared/workflow/objective-checks.test.ts
  src/shared/workflow/validation-loop-core.test.js`.
- Automated: `deno task seams:check` to prove no new injection seam was added for RunWield-owned process or workflow
  machinery.
- Automated: `deno task ci` for type checking, lint, language-policy checks, architecture/seam checks, and the sandboxed
  full suite. Do not run `deno test` directly.
- Manual TUI: run `!!sh -c 'sleep 60 & wait'`, press Escape, and verify the tool ends immediately as canceled and no
  descendant remains; repeat with `!` and verify canceled output is not persisted as a successful exchange.
- Manual TUI: configure CI to a command that starts a long child process, trigger QUICK_FIX Mechanical Validation, press
  Escape, and verify CI stops immediately, the validation panel says canceled/paused, and Engineer remains active.
- Manual TUI: during executable Plan Workflow Validation, press Escape once during local CI and once during an
  Objective-Failing Check; each process tree stops, no repair starts, and Retry can resume validation from the preserved
  Plan/worktree state.
- Manual TUI: press Escape during an agent-issued long-running `bash` tool call and verify Pi reports the tool/turn as
  aborted with no later queued tool call; press Escape while idle and verify no repeated “cleared”/canceled message.
- Preserved behavior: Escape and first Ctrl+C share cancellation; TUI and ACP use the same Runtime method; output
  remains bounded for validation; cancellation remains Session-scoped; interrupted execution and validation remain
  resumable.
- Behavior expected to stop existing: a wrapper shell may no longer exit while its descendants continue running, an
  Objective-Failing Check may no longer ignore Escape, and cancellation may no longer race with spawn and allow new work
  to start afterward.

### Objective-Failing Checks

- `OC1` —
  `deno eval 'import{SessionRuntime}from"./src/shared/session/session-runtime.js";const r=new SessionRuntime(),{sessionId:s}=await r.createInteractiveSession({cwd:Deno.cwd()}),f=await Deno.makeTempFile(),q=r.runLocalShellCommand(s,{command:"sleep 30 & echo $! > "+f+"; wait",persist:false});let p=0;while(!p){await new Promise(x=>setTimeout(x,10));p=+(await Deno.readTextFile(f))}r.cancelSession(s);await new Promise(x=>setTimeout(x,150));let a=true;try{Deno.kill(p,"SIGCONT")}catch{a=false}if(a)Deno.kill(p,"SIGKILL");await q;await Deno.remove(f);if(a)Deno.exit(1)'`
  — exercises the public Runtime `!`/`!!` execution path; it fails today because the descendant is alive after
  cancellation and can pass only when Runtime cancellation kills the whole process tree.
- `OC2` —
  `deno eval 'import{HostedSession}from"./src/shared/session/hosted-session.js";import{runLocalCI}from"./src/shared/workflow/validation-local-ci.ts";import{setCustomSetting}from"./src/shared/settings.js";const d=await Deno.makeTempDir(),f=d+"/p",s=new HostedSession({id:"oc2",cwd:d});await setCustomSetting("verification_command","sleep 30 & echo $! > "+f+"; wait","project",d);const q=runLocalCI({hostedSession:s,cwd:d});let p=0;while(!p){await new Promise(x=>setTimeout(x,10));try{p=+(await Deno.readTextFile(f))}catch{}}s.cancelActiveInteractions();await new Promise(x=>setTimeout(x,150));let a=true;try{Deno.kill(p,"SIGCONT")}catch{a=false}if(a)Deno.kill(p,"SIGKILL");const z=await q;await Deno.remove(d,{recursive:true});if(a||!z.canceled)Deno.exit(1)'`
  — exercises real configured local CI plus HostedSession cancellation; it fails today because CI's descendant survives
  and can pass only when Mechanical Validation terminates the tree and reports cancellation.
- `OC3` —
  `grep -q 'Workflow Validation treats canceled Objective-Failing Checks as a resumable pause' src/shared/workflow/validation-loop-core.test.js && deno task test src/shared/workflow/validation-loop-core.test.js --filter 'Workflow Validation treats canceled Objective-Failing Checks as a resumable pause'`
  — requires a passing workflow-level regression proving Escape-visible Objective-Failing Check cancellation pauses
  without failure or repair; the named behavior is absent today.

## Edge Cases & Considerations

- Whole-tree signaling must target only a process group created for that command. Never send a negative PID for a child
  that was not successfully detached, because that could signal RunWield's own group.
- Cancellation can arrive before spawn, between spawn and listener attachment, while streams are draining, or after
  process exit. Every ordering must settle once, avoid spawning after a pre-abort, and tolerate already-exited children.
- On Windows, `taskkill` startup/failure must not make cancellation hang; direct-child fallback is allowed only as a
  best-effort cleanup after tree termination was attempted, and tests should be platform-aware rather than assuming Unix
  signals.
- Forceful termination is intentional for Escape: a CI process that traps or ignores graceful termination must not keep
  the Session busy. Normal successful/failed exits still receive their real status.
- Killing a process tree may end while buffered output is still draining. Callers must await stream settlement before
  publishing final tool output or removing the active interaction, without accepting new output after cancellation.
- Objective-Failing Check pre-execution baselines have no live Session interaction and remain cancellable only through
  their supplied signal/timeout; Workflow Validation explicitly supplies and registers the Escape-owned signal.
- Do not broaden this change into ACP cancellation response-order conformance, global process shutdown, or cancellation
  of unrelated Sessions. Those are separate lifecycle concerns.
- The implementation must not call `uiAPI.suppressOutput()` on Escape; generation gating and normal Runtime tool-final
  events preserve future output in the same Session.
