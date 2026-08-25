---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
summary: "Prevent execution Agents and their tools from changing unrelated Plans or Work Records while preserving guarded edits to the active Plan."
affectedPaths:
    - "deno.json"
    - "deno.lock"
    - "src/shared/execution-artifact-write-policy.ts"
    - "src/shared/execution-artifact-write-policy.test.ts"
    - "src/shared/runtime-preflight.ts"
    - "src/shared/runtime-preflight.test.ts"
    - "src/tools/plan-safe-file-tools.ts"
    - "src/tools/plan-safe-file-tools.test.js"
    - "src/tools/multi_file_edit.ts"
    - "src/tools/__tests__/multi-file-edit.test.js"
    - "src/tools/execution-safe-bash.ts"
    - "src/tools/execution-safe-bash.test.ts"
    - "src/shared/session/session.js"
    - "src/shared/session/__tests__/session-tools-policy.test.js"
    - "src/shared/session/backends/claude-cli/artifact-write-hook.ts"
    - "src/shared/session/backends/claude-cli/artifact-write-hook.test.ts"
    - "src/shared/session/backends/claude-cli/command.ts"
    - "src/shared/session/backends/claude-cli/command.test.ts"
    - "src/shared/session/backends/claude-cli/execution-session.ts"
    - "src/shared/session/backends/claude-cli/claude-cli-backend.test.ts"
    - "docs/usage.md"
    - "docs/user-facing-features.md"
objectiveChecks:
    - id: "OC1"
      command: "test -f src/shared/execution-artifact-write-policy.test.ts && grep -Fq 'execution artifact policy allows only active Plan exact edit for every execution authority' src/shared/execution-artifact-write-policy.test.ts && grep -Fq 'effective execution tools deny unrelated Plans and Work Records without partial mutation' src/shared/session/__tests__/session-tools-policy.test.js && deno run -A scripts/run-tests.js src/shared/execution-artifact-write-policy.test.ts src/tools/plan-safe-file-tools.test.js src/tools/__tests__/multi-file-edit.test.js src/shared/session/__tests__/session-tools-policy.test.js"
      rationale: "This is red because the shared policy and vertical effective-tool tests do not exist. It requires production file tools to allow the active Plan exact-edit exception while denying unrelated Plans and Work Records without partial writes."
    - id: "OC2"
      command: "test -f src/tools/execution-safe-bash.test.ts && test -f src/tools/execution-safe-bash.ts && grep -Fq '@anthropic-ai/sandbox-runtime' src/tools/execution-safe-bash.ts && grep -Fq 'execution Bash sandbox denies protected writes across descendants' src/tools/execution-safe-bash.test.ts && deno run -A scripts/run-tests.js src/tools/execution-safe-bash.test.ts src/shared/runtime-preflight.test.ts"
      rationale: "This is red because the execution Bash sandbox is absent. It requires a real Sandbox Runtime-backed command path, descendant-process protected-write denial, and fail-closed platform preflight."
    - id: "OC3"
      command: "test -f src/shared/session/backends/claude-cli/artifact-write-hook.ts && test -f src/shared/session/backends/claude-cli/artifact-write-hook.test.ts && grep -Fq 'PreToolUse' src/shared/session/backends/claude-cli/artifact-write-hook.ts && grep -Fq 'Claude execution denies protected writes across native tools Bash Task and local MCP children' src/shared/session/backends/claude-cli/claude-cli-backend.test.ts && deno run -A scripts/run-tests.js src/shared/session/backends/claude-cli/artifact-write-hook.test.ts src/shared/session/backends/claude-cli/command.test.ts src/shared/session/backends/claude-cli/claude-cli-backend.test.ts"
      rationale: "This is red because Claude has no artifact hook or whole-process protection. It requires the native-tool hook and a vertical backend test across native edits, shell descendants, Task, local MCP children, and the guarded active-Plan bridge."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-24T09:38:17-04:00"
updatedAt: "2026-08-24T18:17:52.855Z"
status: "ready_for_work"
origin: "internal"
userVerifiedAt: null
---

# Protect Plans and Work Records During Execution

## Context

Execution Agents currently receive general file and shell tools. Prompt rules tell a Plan Engineer not to edit its Plan,
but prompts do not protect repository artifacts from a mistaken tool call. More importantly, the existing
`wrapPlanSafeFileTool` only protects against stale whole-Plan replacement. It does not enforce which Plan an execution
Agent may change, it is not registered on every effective Pi file-tool path, and it does not protect Work Records.
`multi_file_edit`, Bash commands, delegated write sessions, Claude-native tools, and locally launched Model Context
Protocol (MCP) servers can bypass the current wrapper. External MCP servers are separate processes that RunWield does
not own; by user decision, their side effects remain available but are explicitly outside this protection guarantee.

The intended execution policy is:

| Target                                                   | Execution Agent result                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Active execution Plan                                    | Guarded exact edit is allowed; existing prompt guidance and user review/restore behavior stay unchanged |
| Any other active or archived Plan                        | Write is rejected                                                                                       |
| Any path under `docs/work-records/`                      | Write is rejected                                                                                       |
| Plan or Work Record when no active execution Plan exists | Write is rejected                                                                                       |
| Ordinary implementation path                             | Existing behavior is preserved                                                                          |

The policy applies to Engineer, Plan Engineer, Frontend Engineer, Reviewer-Feedback Engineer, and a delegated write
session launched by one of them. It does not restrict Planner, lifecycle, review, Recorder, Work Record store, or direct
user/editor writes.

Research changed the sandbox choice:

- Claude `PreToolUse` hooks can reject native file-tool calls before execution, but Bash-hook command parsing does not
  prove the filesystem effects of scripts or child processes. Source:
  <https://docs.anthropic.com/en/docs/claude-code/hooks>
- Claude's Bash sandbox and the open-source Anthropic Sandbox Runtime enforce filesystem policy at the operating-system
  level on macOS and Linux. Source: <https://docs.anthropic.com/en/docs/claude-code/sandboxing> and
  <https://github.com/anthropic-experimental/sandbox-runtime>
- ArcBox is a machine-isolation product whose agent sandbox starts with an empty filesystem and requires clone/copy-back
  integration. Its local sandbox also has narrower current hardware/platform support. It would replace RunWield's local
  worktree model rather than add this focused guard. Source: <https://github.com/arcboxlabs/arcbox>

## Objective

Give every execution Agent one enforced artifact-write policy. Managed file tools may edit only the active Plan and may
never edit Work Records. Arbitrary RunWield-launched execution subprocesses cannot write any Plan or Work Record,
including through nested scripts, Git commands, Claude-native tools, local MCP children, or delegated execution.
RunWield fails before execution when it cannot establish the required sandbox instead of silently running without
protection. Calls to external MCP servers remain available, but RunWield does not claim control over filesystem effects
performed by those already-running external processes.

Normal Pi execution must not require Claude Code, Node.js, or an Anthropic subscription. RunWield will pin and bundle
the Apache-2.0 `@anthropic-ai/sandbox-runtime` library through Deno. Only a user who explicitly selects the existing
Claude CLI execution backend needs Claude Code and its normal authentication.

## Approach

### One live policy owner

Add `src/shared/execution-artifact-write-policy.ts` as the source of truth for:

- the four execution Agent identities;
- inherited authority for delegated write sessions;
- the active Plan path, read live from `HostedSession.getActiveExecutionWorkflow()` at each call rather than captured
  when the Agent Session is built;
- protected Plan and Work Record path classification relative to the authoritative `executionCwd`;
- symlink-safe and traversal-safe canonical path resolution; and
- consistent rejection details that name the protected artifact and active Plan without exposing lifecycle internals.

The decision shape is small and shared by tools and backend adapters:

```text
checkArtifactWrite(requestedPath, executionContext)
  ordinary path                 -> allow
  docs/work-records/**          -> deny
  docs/plans/**, active Plan    -> allowExactEdit
  docs/plans/**, other/no Plan  -> deny
```

`allowExactEdit` is not general shell authority. The active Plan can change only through RunWield's revision-checked
single-file or multi-file exact-edit implementation. Whole-file replacement of an existing Plan remains refused.

### Managed tools use the same policy

`buildAgentSession` will register protected `write` and `edit` definitions in `finalCustomTools`, fixing the current gap
where protected definitions are used to describe the prompt but unwrapped Pi built-ins execute the calls.
`multi_file_edit` will preflight every target against the policy before writing any file. It will classify paths against
the Session checkout, not the caller-selected `root`, and retain Plan locks and revision compare-and-set behavior for an
allowed active-Plan edit.

The delegated Agent receives an explicit inherited execution-write authority from its parent Session. A generic
standalone delegated session does not become an execution Agent merely because an active workflow exists.

### Arbitrary subprocesses run with a stricter filesystem policy

Pin `@anthropic-ai/sandbox-runtime@0.0.73` and add a RunWield-owned sandbox launcher that creates one isolated Sandbox
Runtime instance per command/process. It must preserve the current command's working directory, streams, cancellation,
timeouts, environment, network behavior, and process-tree cleanup while applying:

```text
allowWrite: execution checkout and required temporary paths
denyWrite:  <execution checkout>/docs/plans/
            <execution checkout>/docs/work-records/
```

Sandbox Runtime gives `denyWrite` precedence, so shell commands cannot edit even the active Plan. This is deliberate:
the active-Plan exception crosses only the guarded exact-edit path. Denying the complete directories also prevents a
shell or child process from creating a new unrelated Plan or Work Record.

Pi's effective `bash` definition will use this launcher only for execution authority. User `!` commands, Planner Bash,
and RunWield-owned Mechanical Validation remain on their current paths because they are not execution-Agent tool calls.
On macOS the sandbox uses the operating system's Seatbelt support. On Linux preflight verifies the Sandbox Runtime's
required operating-system support, including Bubblewrap and Socat when required by the pinned release, and returns
copy-ready installation instructions when support is missing. Sandbox initialization failure blocks the execution turn.

### Claude is protected twice, with one outside-sandbox edit route

For the Claude CLI backend:

1. Generate an owner-only temporary settings file containing a RunWield `PreToolUse` hook. The hook rejects native
   `Write`, `Edit`, `MultiEdit`, and `NotebookEdit` calls aimed at any Plan or Work Record and tells Claude to use the
   guarded RunWield edit capability for the active Plan.
2. Wrap the complete `claude` process in Sandbox Runtime, not only Claude's Bash tool. This contains Claude-native Bash,
   child processes, Task subagents, and local stdio MCP servers that Claude launches under the same directory-level
   `denyWrite` policy. External HTTP/SSE MCP servers remain callable but are outside the guarantee because their server
   processes do not descend from RunWield or Claude.
3. Bridge the guarded exact-edit definition through the existing authenticated loopback MCP bridge for execution Agents.
   The bridge executes in RunWield's parent process, outside the Claude sandbox, and applies the same live active-Plan
   decision and revision check as Pi.
4. Configure strict failure and no unsandboxed retry. Remove temporary prompt, MCP, hook/settings, and sandbox files in
   every normal, failed, and canceled exit path.

The operating-system sandbox is the integrity guarantee. The Claude hook supplies an early, clear tool result; it is not
trusted as the only defense.

The option set aside is ArcBox. It provides stronger whole-machine isolation, but it would require a new remote/VM
checkout, credential, execution, result-copy, and publication model and would not support the current macOS/Linux user
base uniformly. That cost is not proportional to protecting two repository artifact classes.

## Files to Modify

- `deno.json` — pin `@anthropic-ai/sandbox-runtime@0.0.73` for Deno-native import without a global npm or Node.js
  requirement.
- `deno.lock` — lock the selected Sandbox Runtime release and its transitive dependencies.
- `src/shared/execution-artifact-write-policy.ts` — own execution authority, live active-Plan resolution, canonical path
  classification, delegated inheritance, and structured allow/deny results.
- `src/shared/execution-artifact-write-policy.test.ts` — cover all execution identities, no-active-Plan behavior,
  active/other/archived/nested Plans, Work Records, traversal, absolute paths, symlinks, checkout mismatch, and
  delegated inheritance.
- `src/shared/runtime-preflight.ts` — verify Sandbox Runtime operating-system support before an execution turn and
  return actionable macOS/Linux failure guidance without requiring Claude or Node.js.
- `src/shared/runtime-preflight.test.ts` — prove supported, missing Linux package, unsupported, and
  initialization-failure outcomes are fail-closed and user-actionable.
- `src/tools/plan-safe-file-tools.ts` — compose current Plan locking/revision safety with the new execution scope
  policy; keep unrestricted Planner creation and editing behavior.
- `src/tools/plan-safe-file-tools.test.js` — prove active-Plan exact edits succeed for execution authority while
  existing active-Plan overwrite, other-Plan, archived-Plan, Work Record, symlink, and no-active-Plan writes fail
  without mutation.
- `src/tools/multi_file_edit.ts` — preflight all paths against the Session-root policy before the first write, remove
  the caller-controlled `root` classification gap, and keep atomic rollback plus Plan locking for allowed edits.
- `src/tools/__tests__/multi-file-edit.test.js` — cover mixed allowed/denied batches, alternate roots, nested child
  Plans, active-Plan revision races, and no partial write when one target is protected.
- `src/tools/execution-safe-bash.ts` — wrap the Pi Bash command in a per-invocation Sandbox Runtime process with strict
  Plan/Work Record deny paths and preserved stream/cancel/timeout behavior.
- `src/tools/execution-safe-bash.test.ts` — run real shell mutations and prove source writes succeed while Plan changes,
  Plan creation, Work Record changes, symlink aliases, nested scripts, and child processes receive filesystem denial.
- `src/shared/session/session.js` — derive execution-write authority, register effective protected `write`, `edit`,
  `multi_file_edit`, and `bash` tools, propagate authority to delegated write sessions, and bridge active-Plan exact
  edit for Claude execution Agents only.
- `src/shared/session/__tests__/session-tools-policy.test.js` — prove all four execution identities receive protected
  effective tools, other Agents do not, delegated read has no mutation tools, delegated write inherits protection, and
  no execution path falls back to an unwrapped built-in.
- `src/shared/session/backends/claude-cli/artifact-write-hook.ts` — serve or materialize the deterministic `PreToolUse`
  decision for Claude-native mutation tools using the shared artifact policy and authenticated per-turn context.
- `src/shared/session/backends/claude-cli/artifact-write-hook.test.ts` — cover native file-tool schemas, active-Plan
  redirection, other Plans, Work Records, ordinary source, malformed input, unknown tools, and authentication/cleanup.
- `src/shared/session/backends/claude-cli/command.ts` — add owner-only temporary hook/settings configuration, strict
  sandbox arguments, and complete cleanup metadata to the prepared Claude command.
- `src/shared/session/backends/claude-cli/command.test.ts` — prove strict settings are additive, protected from user
  override, passed to Claude, and removed on cleanup without removing user settings.
- `src/shared/session/backends/claude-cli/execution-session.ts` — wrap the complete Claude process, expose the guarded
  active-Plan edit bridge, and close hook/settings/sandbox resources on success, failure, or cancellation.
- `src/shared/session/backends/claude-cli/claude-cli-backend.test.ts` — use the fake Claude executable plus real
  hook/MCP calls and child shell processes to prove end-to-end protection and active-Plan editing.
- `docs/usage.md` — document execution artifact protection, the active-Plan guarded-edit exception, fail-closed
  behavior, Linux prerequisites, and the explicit external-MCP exclusion.
- `docs/user-facing-features.md` — list enforced Plan/Work Record protection as an execution safety feature.

No domain-language update is required. This change uses the existing canonical terms Plan, Work Record, execution Agent,
and active execution workflow without introducing or redefining a product term.

## Reuse Opportunities

- `src/tools/plan-safe-file-tools.ts` — retain its Plan create-if-absent, lock, and revision compare-and-set behavior.
- `src/tools/multi_file_edit.ts` — retain exact-match batching, rollback, and Plan lock ordering after policy preflight.
- `src/shared/session/hosted-session.js` — read live active workflow and execution checkout identity.
- `src/tools/delegate-agent.ts` — carry execution-write authority through the existing delegated lease and child-session
  construction instead of inferring it from the child persona.
- `src/shared/foreground-process.ts` — reuse process-tree cancellation semantics where the sandbox launcher needs a
  RunWield-owned subprocess lifecycle.
- `src/shared/session/backends/claude-cli/mcp-bridge.ts` — reuse authenticated loopback transport and serialized tool
  execution for the guarded active-Plan edit and hook decision path.
- `src/shared/session/backends/claude-cli/command.ts` — reuse owner-only temporary-file creation and explicit cleanup.
- `src/shared/git-test-fixture.ts` — build real repositories and worktrees for shell, symlink, and commit-oriented
  tests.

## Implementation Steps

- [ ] `src/shared/execution-artifact-write-policy.ts` returns structured decisions from canonical checkout-relative
      paths: ordinary paths are writable; every Work Record and every non-active Plan is denied; only the exact active
      Plan is eligible for guarded exact edit; no active workflow means no Plan or Work Record is writable.
- [ ] The policy recognizes Engineer, Plan Engineer, Frontend Engineer, and Reviewer-Feedback Engineer and carries the
      same authority into delegated write sessions without granting it to standalone or read-only delegation.
- [ ] Path decisions cannot be bypassed with absolute paths, `..`, caller-selected `multi_file_edit.root`, nested child
      Plan names, archived Plans, missing targets, case/path separator variants supported by the host, or symlinks in
      either the target or an existing ancestor.
- [ ] Effective Pi `write`, `edit`, and `multi_file_edit` calls for execution authority all cross the shared policy
      before mutation. An exact edit to the active Plan retains Plan locking and revision compare-and-set; whole-file
      overwrite remains rejected; a denied multi-file batch writes nothing.
- [ ] Pi execution Bash runs under a real Sandbox Runtime filesystem policy that allows ordinary checkout writes but
      denies all writes under `docs/plans/` and `docs/work-records/` for the command and every descendant process.
- [ ] Sandbox Runtime 0.0.73 is pinned and bundled into the standalone Deno artifact. Pi execution requires neither a
      global npm package, Node.js, Claude Code, an Anthropic account, nor a model-provider subscription.
- [ ] Execution preflight fails before the Agent turn when the sandbox cannot initialize. macOS uses built-in operating
      system support; Linux reports the exact missing package and a copy-ready installation command. No warning path
      silently continues unsandboxed.
- [ ] Claude execution receives an owner-only `PreToolUse` hook/settings configuration that denies native mutation tools
      for all Plans and Work Records with a clear active-Plan redirect, while ordinary source edits keep current
      behavior.
- [ ] The complete Claude process runs inside the same strict Plan/Work Record filesystem deny policy, so Bash, Task
      children, local stdio MCP servers, nested scripts, and Git commands cannot bypass the hook. Unsandboxed retry is
      disabled and sandbox startup failure aborts the turn. External MCP server processes remain callable but are
      explicitly excluded from the guarantee and user documentation.
- [ ] Claude execution Agents can use the existing authenticated MCP bridge to apply a guarded exact edit to the active
      Plan outside the subprocess sandbox. Other Plans and Work Records are denied by the same live policy used by Pi.
- [ ] Hook, settings, sandbox, prompt, and MCP temporary resources are removed after successful, failed, canceled, and
      startup-failed Claude turns; user/project Claude settings remain untouched and additive MCP behavior remains.
- [ ] Non-execution Agents, direct user/editor changes, RunWield lifecycle transitions, Recorder/Work Record store
      writes, Mechanical Validation, and local `!` commands retain their current authority and behavior.
- [ ] `docs/usage.md` and `docs/user-facing-features.md` describe the enforced scope, active-Plan guarded-edit route,
      fail-closed outcome, platform prerequisites, and external-MCP exclusion without claiming that prompts or remote
      server effects are mechanically protected.

## Approval Confirmation

This Plan does not supersede a Work Record.

## Verification Plan

- Automated policy and managed-tool behavior:
  `deno run -A scripts/run-tests.js src/shared/execution-artifact-write-policy.test.ts src/tools/plan-safe-file-tools.test.js src/tools/__tests__/multi-file-edit.test.js src/shared/session/__tests__/session-tools-policy.test.js`.
  This group includes the exact black-box tests
  `execution artifact policy allows only active Plan exact edit for every execution authority` and
  `effective execution tools deny unrelated Plans and Work Records without partial mutation`; each calls production
  definitions against real temporary files rather than asserting source text or a fixture-only policy.
- Automated real subprocess isolation and preflight:
  `deno run -A scripts/run-tests.js src/tools/execution-safe-bash.test.ts src/shared/runtime-preflight.test.ts`. The
  exact test `execution Bash sandbox denies protected writes across descendants` runs the production Bash definition
  against a real checkout fixture and verifies unchanged bytes after direct, nested-child, create, rename, and symlink
  attempts.
- Automated Claude hook, command, and vertical backend behavior:
  `deno run -A scripts/run-tests.js src/shared/session/backends/claude-cli/artifact-write-hook.test.ts src/shared/session/backends/claude-cli/command.test.ts src/shared/session/backends/claude-cli/claude-cli-backend.test.ts`.
  The exact vertical test
  `Claude execution denies protected writes across native tools Bash Task and local MCP children` starts the production
  execution-session adapter with the fake Claude executable, calls the real hook and MCP bridge, and verifies filesystem
  bytes rather than only generated arguments.
- Package and architecture gates: `deno task check`, `deno task seams:check`, and `deno task ci`.
- Standalone packaging smoke test: compile `wld`, run the protected Pi Bash fixture with `PATH` excluding Node/npm and
  Claude, confirm an ordinary source write succeeds, and confirm Plan/Work Record writes fail without changing bytes.
- Manual Pi flow: execute a real Plan, ask Plan Engineer to exact-edit the active Plan through the guarded file tool,
  and confirm it can be reviewed/restored; then attempt another Plan and a Work Record through `edit`,
  `multi_file_edit`, Bash redirection, a nested script, and a symlink and confirm every attempt is denied with unchanged
  bytes.
- Manual Claude flow (only on a machine already configured for the optional Claude backend): repeat the active-Plan edit
  through the bridged RunWield tool; verify native Edit receives the hook explanation; verify Bash and a benign test MCP
  child receive operating-system denial for another Plan and a Work Record while ordinary implementation edits succeed.
- Behavior that must remain protected: Planner Plan creation/revision safety, active Plan locks and compare-and-set,
  Work Record store collision protection, execution worktree authority, file-tool error details, command streaming,
  cancellation, delegated lease rules, Claude additive user MCP configuration, and all ordinary source edits.
- Behavior expected to stop existing: execution Agents using any direct or indirect mutation route to change an
  unrelated or archived Plan, create a new Plan, or change/create a Work Record; execution continuing after sandbox
  preflight fails.

## Edge Cases & Considerations

- **Active workflow changes during a long Session:** file tools read policy live for every call. A completed/replaced
  workflow immediately removes active-Plan edit authority. A subprocess receives an immutable policy snapshot for its
  invocation and cannot outlive normal process-tree cancellation.
- **Repair turns:** Reviewer-Feedback Engineer uses the execution worktree and active Plan identity from the durable
  workflow checkpoint. Missing or conflicting identity fails closed instead of selecting a Plan by filename.
- **Quick fixes:** Engineer has no active Plan. It can modify source but no Plan or Work Record.
- **Plan hierarchy and archives:** child Plan paths and `docs/plans/archived/**` are protected. Only the exact active
  execution Plan path is eligible for guarded edit.
- **Creation and rename:** directory-level sandbox denial prevents `touch`, redirection, rename, delete, hard-link,
  symlink-target, and Git checkout/reset operations under protected directories. Managed tools classify missing targets
  before creation.
- **Git operations:** also deny writes to the execution checkout's Git administrative path. Otherwise `git update-index`
  could stage a protected deletion without first writing the protected file. Read-only Git operations such as status and
  diff remain available; RunWield continues to own execution commits and lifecycle transitions.
- **Hard links:** a hard-link alias can change protected bytes through an ordinary-looking path. Preflight rejects a
  protected artifact with an unsafe link count, and real sandbox tests cover attempts to create or use an alias.
- **External MCP servers:** HTTP/SSE servers that RunWield did not launch remain available by explicit user decision.
  Their out-of-process side effects are outside this guarantee and must not be described as sandboxed. Local stdio MCP
  children inherit the Claude process sandbox and are covered.
- **Loopback bridge:** the sandbox must allow the authenticated per-turn hook/MCP endpoints that RunWield creates while
  preserving existing connectivity to configured external MCP servers. Network allowances must not weaken filesystem
  policy or imply that an external server process is sandboxed.
- **Concurrency:** Sandbox Runtime state must be per process/invocation, not a mutable singleton shared by concurrent
  Hosted Sessions. Policy snapshots must not use module-level cwd or home values.
- **Linux dependency:** Bubblewrap, Socat, or another Sandbox Runtime-required operating-system package can be absent or
  blocked by host policy. This is a specific execution blocker with installation/diagnostic guidance, not permission to
  degrade.
- **Third-party maturity:** Sandbox Runtime is an early package. Pin an exact reviewed version, cover macOS and Linux in
  continuous integration where available, and keep its interface behind the RunWield-owned launcher so upgrades remain
  local.
- **Network and sockets:** configure Sandbox Runtime so this change does not narrow existing command network, local
  bind, or Unix-socket behavior. Only Plan and Work Record writes are in scope. Tests must include a representative
  local socket/network command when the platform supports it.
- **Claude settings precedence:** RunWield's temporary deny policy must be additive and non-overridable for the turn.
  User settings may add capabilities outside protected paths but cannot disable strict sandboxing or protected denies.
- **Prompt policy:** keep the current Plan-execution prompt rule that discourages Plan editing. Mechanical enforcement
  is narrower by user decision: a user-approved guarded exact edit of the active Plan remains possible.
