---
planId: "54c6f794-252f-4210-be53-ca5bf50c5ff1"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/shared/bash-command-policy.ts"
    - "src/tools/bash.ts"
    - "src/tools/delegate-agent.ts"
    - "src/tools/background-task.ts"
    - "src/shared/session/agents.js"
    - "src/agent-definitions/guide.md"
    - "src/agent-definitions/subagent-definitions/"
    - "docs/customization.md"
    - "src/shared/session/session.js"
    - "src/shared/session/subagent-definitions.ts"
    - "src/tools/__tests__/delegate-agent.test.js"
    - "src/shared/session/__tests__/session-tools-policy.test.js"
    - "src/tools/background-delegate.test.ts"
    - "docs/prd/runwield-core-prd.md"
    - "docs/domain-language.md"
    - "docs/adr/002-two-tier-tool-system.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-09-28T17:49:57-04:00"
origin: "internal"
status: "ready_for_work"
userVerifiedAt: null
---

# Configurable Bash Command Allowlists for Guide and Delegates

## Context

Read-only Delegated Agent Sessions cannot run Git inspection commands. `DELEGATED_READ_TOOLS` excludes `bash`, even when
the parent has it. Guide has bash and background shell access, but its read-mostly limit is currently an instruction
rather than a command filter.

The owner extended this request to configurable `bashAllowedCommands` front matter for Agents and subagents. Guide and
read delegates must receive the inspection list. The same policy must filter Guide’s `background_task` shell starts.

The owner approved a best-effort command filter, the command set below, and **single commands only**. They accept that
this is not a security boundary. They also approved limiting this change to RunWield-managed bash. External CLI
Execution Backends keep their current native shell permissions.

The owning configuration requirement is **Respect user customization while retaining workflow capabilities** in
[Core: Agent and skill customization](../prd/runwield-core-prd.md#agent-and-skill-customization). Add the observable
command-policy contract there and link it from [Session continuity](../prd/runwield-core-prd.md#session-continuity).
Extend **Run bounded background work** with command-policy parity. Preserve **Receive task results without another user
message** and Guide’s explicitly requested Markdown preservation. Restricted bash does not grant `background_task` to a
child.

## Objective

A read-only delegate with inherited bash access can run approved inspection commands. An unapproved command does not
start. Its tool error explains the reason, lists allowed commands, and tells the delegate to report a blocker if those
commands are not sufficient.

Guide receives filtered bash and background shell starts. Other Agents without a configured list retain their current
bash behavior. Write delegates retain unrestricted bash unless their definition or parent supplies a limit. Role-limited
delegates, including Verification Adversary, use their effective read authority rather than the requested authority.

## Approach

### Front matter contract

Use the same optional field in Agent and subagent definitions:

```yaml
bashAllowedCommands:
    - git status
    - git diff
    - ls
```

These are literal command selectors, not shell patterns. Match complete tokens: `git status` permits its arguments, not
`git status-other`. `ls` permits ordinary listing arguments. Known Git global inspection options are normalized before
matching. Selectors themselves cannot contain shell operators or expansions.

The owner approved these merge rules:

- **Omitted:** inherit the lower layer. If no layer supplies a list, bash is unrestricted.
- **List:** replace the lower-layer list. Do not union lists.
- **`[]`:** deny all commands.
- **`null`:** clear that definition’s inherited list and restore unrestricted bash, subject to any parent-delegation
  limit.

The field does not grant the bash tool. Invalid types, mixed arrays, empty selectors, and unsupported selector syntax
produce a configuration error naming the field and source; they must not silently become unrestricted access. Bare
subagent loading must validate before its generic metadata normalizer can discard invalid values. Existing bare-prompt
`tools:` rejection stays intact. This adds no new home/project override directories for hidden subagents.

### Policy ownership and execution

`src/shared/bash-command-policy.ts` owns metadata validation, selector matching, the bounded syntax/option checks,
parent-child intersection, and policy descriptions. Front matter owns each definition’s default list. Do not maintain
another default list in TypeScript.

`src/tools/bash.ts` exposes a RunWield bash definition with optional construction-time `allowedCommands`. Reuse Pi for
execution, output, cancellation, timeout, and rendering. Omitted policy means ordinary bash; an empty policy denies all.
Keep the model-facing `command` and `timeout` schema unchanged. Agents cannot change their own policy in a tool call.

```text
load Agent or subagent definition
  resolve bashAllowedCommands and inherited parent limits
  Pi bash -> shared command check -> Pi execution
  background_task start -> same check -> existing task registry
  delegate_agent -> pass effective parent policy to child
```

The effective child policy is the intersection of the parent and child selectors. Neither an absent child list nor
`null` removes a parent limit. Intersect by token specificity: parent `git` plus child `git status` permits
`git status`; disjoint selectors permit nothing. Use one implementation for matching, intersection, and generated
guidance.

`buildAgentSession` installs the custom bash only when bash survives tool narrowing. It passes the same effective policy
to `createBackgroundTaskTool` and `createDelegateAgentTool`. Background start validation occurs before task reservation
or process creation; status and cancel are unchanged. Also pass definition policy to the existing RunWield background
tool in `composeClaudeCliBridgedTools`, which Agy reuses. This filters RunWield-owned starts, not the external host’s
native shell.

Runtime-owned policy-bearing tools must be constructed from current metadata when a root Session is rebuilt.
`getRootSessionRebuildOptions` currently forwards custom tool instances; do not retain stale bash, background, or
delegation policy closures. Preserve genuine caller-supplied custom tools and unrelated rebuild behavior.

### Read and write delegate defaults

Keep one delegated Agent identity and role system, with two definition entries:

- Existing `SUBAGENTS.DELEGATED`: write-capable definition, no default bash list.
- New `SUBAGENTS.DELEGATED_READ`: `delegated-read-agent-prompt.md`, read-tool ceiling, full inspection list.

Move the common delegated prompt body into `shared-practice/delegated-session.md`. Both definitions use existing
`sharedPractice` composition, so scope, repository instructions, memory context, uncommitted changes, and final-handoff
rules stay in one place. Apply role overlays to both definitions.

`createDelegateAgentTool` selects the definition after resolving the role ceiling. A write request reduced to read uses
the read definition. Add bash to the read-tool ceiling; still intersect with the parent’s tools. Carry inherited command
policy on both foreground and background launch paths. The existing background registry already forwards child options.

Guide’s front matter receives the same inspection list. The two lists are explicit per-definition defaults and may
diverge later; tests verify the initial agreed defaults. Agents without a list remain unrestricted. No new settings UI
or nested mode-specific front matter is needed.

### Approved command set

| Family          | Allowed commands or forms                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| Git inspection  | `git status`, `diff`, `log`, `show`, `blame`, `grep`, `ls-files`, `ls-tree`, `rev-parse`, `rev-list`, `show-ref` |
| Git listing     | `git branch --list`, `git remote -v`, `git worktree list`                                                        |
| File inspection | `ls`, `pwd`, `cat`, `head`, `tail`, `wc`, `grep`, `rg`, `find`, `stat`, `file`, `du`, `readlink`                 |

**Single-command syntax:** accept ordinary arguments, quotes, escapes, paths with spaces, and argument globs. Match
exact executable and subcommand tokens, not string prefixes. Permit `git -C <path>` and `git --no-pager` before an
approved subcommand. Reject other Git global configuration or execution overrides.

Reject compound commands, pipes, redirects, background operators, command or process substitution, variable expansion,
shell control syntax, leading environment assignments, and executable paths or wrappers such as `/bin/sh`, `env`, and
`sudo`. Quoted literal punctuation is data, not shell syntax. Reject malformed or unsupported syntax with the same
useful denial response; do not try to support the full shell language. Trim outer whitespace before checking; internal
command-separating newlines are not supported.

**Best-effort option checks:** deny known write or execution forms within approved commands. These include Git
`--output`, `--ext-diff`, `--textconv`, and `git grep` pager execution (`-O`/`--open-files-in-pager`); `find` execution,
deletion, and file-output actions; `rg --pre` and `--hostname-bin`; and `file -C`/`--compile`. Check separate and
attached option values where supported. Git listing forms must not accept branch creation/deletion/rename, remote
changes, or worktree mutation. Use a bounded set of listing options for those forms rather than treating the executable
name as sufficient.

Generate the allowed-command description and rejection list from the same policy data used for matching. Include the
single-command limit and this instruction: “Use an allowed command. If you cannot complete the brief with these
commands, report a blocker in your final handoff. Do not work around the restriction.”

> [!NOTE]
> **This is a convenience filter, not a sandbox**
>
> Repository configuration, shell startup, executable lookup, external tools, and incomplete option coverage can still
> have effects. Do not claim filesystem isolation or protection from hostile input. The owner explicitly accepted this
> limit.

Snip rewrites bash input into shell compounds and temporary-file operations. Omit that optional extension for all
restricted Pi Sessions, including Guide; keep it unchanged elsewhere. Do not permit Snip wrappers through the allowlist.
The accepted cost is uncompressed output for restricted Sessions, with normal Pi output truncation retained.

A sandbox and external-host permission changes are outside this Plan. A full shell parser would add complexity for
syntax the owner did not request.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/bash-command-policy.ts` and focused tests — shared metadata validation, parsing, matching, intersection,
  and denial descriptions.
- `src/tools/bash.ts` — optional filtering around Pi bash, with its execution contract retained.
- `src/shared/session/agents.js` and `types.js` — ordinary Agent metadata validation and layered replace/reset
  semantics.
- `src/constants.js`, `src/shared/session/subagent-definitions.ts`, and `subagent-definitions.test.ts` — read definition
  identity, metadata validation, tool ceiling, and role-overlay coverage.
- `src/agent-definitions/guide.md`, both delegated definitions, and `shared-practice/delegated-session.md` — explicit
  defaults and one shared delegated prompt body.
- `src/tools/delegate-agent.ts` — select the effective-mode definition and inherit command limits on both launch paths.
- `src/tools/background-task.ts` — check the shared policy before shell task creation without changing status/cancel.
- `src/shared/session/session.js` — resolve policy once per construction, wire bash/background/delegation, refresh
  policy on rebuild, and skip Snip for restricted Pi Sessions.
- Existing Session policy, delegation, background task, and Snip tests — protect actual runtime enforcement and
  unaffected lifecycle behavior.
- `docs/customization.md#agents`, `docs/architecture.md#layering-rules`, and `docs/adr/002-two-tier-tool-system.md` —
  configuration examples, composition rules, and best-effort limits.
- `docs/prd/runwield-core-prd.md` — own the customization contract and background/delegation acceptance scenarios
  without duplicating requirements.
- `docs/domain-language.md` — update Agent Definition and Delegated Agent Session meanings; preserve Guide’s docs-only
  writing and Background Task relationships.
- `skills/guide/SKILL.md` and `scripts/skill-sync-baseline.json` — review portable Guide guidance after its source
  changes; update the baseline only after that review. Do not imply native-host enforcement in the portable Skill.

External CLI native command builders and permissions, the background process runner, settings UI, and unrelated Agents’
defaults remain outside this change. Asset packaging already copies the Agent directory recursively; do not expand the
plan-server image to ship subagents.

## Reuse Opportunities

- Pi `createBashToolDefinition` — retain shell execution, streamed updates, truncation/full-output paths, errors,
  cancellation, and timeout behavior. Preserve configured shell path and command prefix as trusted runtime configuration
  when constructing the custom definition.
- `loadAgentDefFromPaths`, `loadBarePromptDefinition`, and `composeSharedPracticePrompt` — reuse existing metadata
  precedence and shared prompt composition.
- `resolveEffectiveDelegationMode` and `resolveDelegatedToolNames` — keep role ceilings and parent intersection
  authoritative.
- `buildAgentSession` custom-tool precedence and `assembleFinalSystemPromptWithContextProjection` — register one runtime
  definition and show that same definition to the Agent.
- `BackgroundTaskRegistry.startDelegate` — already forwards child options into `runIsolatedAgentSession`; retain task
  and lease behavior.
- `defineGitFixture`, `withRuntimeCommandFixture`, and `withProcessGlobalTestLock` — test real repositories and Session
  construction with isolated process state. Existing small tokenizers are references, not complete shell parsers.

## Implementation Steps

1. `src/shared/bash-command-policy.ts` owns and exports typed metadata normalization, effective-policy intersection,
   command validation, and guidance generation. Both loaders accept absent/list/empty/null metadata with the approved
   precedence. Invalid metadata fails with source context before generic normalization can drop it. `AgentDefinition`
   carries the normalized policy. Selectors use complete token prefixes, not regex or string-prefix matching; argument
   and option checks follow Approach.

2. `src/tools/bash.ts` exposes optional `allowedCommands` construction. Restricted calls are checked before Pi
   execution; unrestricted calls retain normal shell syntax and behavior. Denials include the reason, effective allowed
   list, single-command limit, and blocker instruction. The model-facing schemas remain unchanged. The same shared
   checker is used by background shell starts, so a policy change has one implementation owner.

3. Guide and a new read-delegate definition contain the full approved inspection list in front matter.
   `SUBAGENTS.DELEGATED_READ` uses the read ceiling; the existing write definition has no default list. Both compose the
   existing delegated rules from one shared-practice fragment and receive delegated role overlays.
   `DELEGATED_READ_TOOLS` includes bash, without duplicating it in the write list. Loader tests preserve all shared
   instructions and the bare-prompt ban on `tools:` metadata.

4. `createDelegateAgentTool` chooses the definition after role-ceiling resolution and passes the effective parent
   command policy on both launch paths. The child combines its definition policy with that parent limit. No parent bash
   means no child bash. A requested write delegation reduced to read gets the read definition. A write child of an
   unrestricted parent stays unrestricted; no child can remove a restricted parent’s limit. Existing edit, lease, and
   change-reporting behavior survives.

5. `buildAgentSession` constructs policy-aware bash only when the tool survives narrowing, and supplies the same
   resolved policy to background and delegation factories. `createBackgroundTaskTool` rejects denied starts before task
   reservation or spawning and leaves status/cancel intact. `composeClaudeCliBridgedTools` also filters its
   RunWield-owned background starts from definition metadata; external native shells remain unchanged. Runtime
   descriptions and context projection show the effective policy. Snip is omitted for restricted Pi Sessions and
   retained otherwise.

6. Root Session reload/rebuild resolves current definition metadata and refreshes runtime-owned policy-bearing tools. A
   change from one list to another, to `[]`, or to `null` takes effect without retaining prior bash, background, or
   delegated-policy closures. Genuine custom tool injection and unrelated Session reconstruction retain existing
   semantics.

7. Behavioral tests prove the configuration-to-process path for Guide, both delegate modes, role downgrade, parent
   limits, and background starts. Use real temporary files and Git state. Do not add injection seams for RunWield-owned
   policy or Session construction; use existing external model/process fixtures where needed. Preserve existing lease,
   cancellation, change-attribution, and background-result coverage.

8. Customization docs, architecture guidance, Core requirements/scenarios, and glossary definitions describe the
   delivered behavior together. Record `null` as a definition-level reset, not a way for a child to clear its parent’s
   limit. Keep the generic delegated prompt free of duplicated command lists. Review the published Guide Skill for
   portable wording, then update its synchronization baseline with the repository command. Do not claim enforcement in
   external native shells.

## Approval Confirmation

No Work Record supersession is proposed. The owner confirmed the command set, single-command syntax, best-effort limits,
RunWield-managed shell scope, Guide coverage, background-start parity, and absent/list/empty/null front matter
semantics.

## Verification Plan

### Automated

Run focused tests through the repository runner, never with direct `deno test`:

```sh
deno run -A scripts/run-tests.js src/shared/bash-command-policy.test.ts src/tools/__tests__/bash.test.ts src/tools/__tests__/delegate-agent.test.js src/shared/session/subagent-definitions.test.ts src/shared/session/__tests__/session-tools-policy.test.js src/tools/background-task.test.ts src/tools/background-delegate.test.ts src/tools/background-delegate-slots.test.ts src/extensions/snip/index.test.js
deno task skills:sync:check
```

Use the actual new test paths if implementation places them elsewhere. After reviewing the portable Guide Skill, use
`deno task skills:sync:update` to record the reviewed source change, then run `deno task skills:sync:check`. Full CI
remains the normal workflow’s responsibility.

Required evidence:

- **Allowed commands really run:** in a temporary Git repository, inspect a known commit with `git log` and `git show`,
  a staged and unstaged change with `git diff`, and dirty state with `git status`. Assert distinctive fixture content,
  not only exit status. Also execute `ls` and `cat` against a filename with spaces, plus representative approved listing
  and Git `-C` forms. Cover every policy entry with matching tests. These checks fail if the implementation denies
  everything or returns placeholder output.
- **Denied calls do not start:** run restricted `git branch unwanted`, `git add`, `git diff --output=<sentinel>`,
  `find . -delete`, `find . -exec ...`, and `ls > <sentinel>` in disposable fixtures. Confirm no new branch, no index
  change, no deleted fixture, and no sentinel. A compound `git status && touch <sentinel>` must fail before either
  command starts; use an external process fixture when needed to observe zero launches. These checks fail if matching is
  only a prefix test or enforcement exists only in the prompt.
- **Parsing is bounded and useful:** test `|`, `&&`, `;`, newlines, redirects, substitutions, environment assignments,
  executable paths, unsupported Git globals, malformed quotes, command-name lookalikes, and option values in both
  attached and separate forms. Test literal shell punctuation inside single-quoted search patterns as allowed data. Test
  empty policy rejection and omitted policy’s ordinary write-capable execution in a disposable directory.
- **Denials teach the delegate:** results include the failed reason, the policy-generated allowed commands,
  single-command guidance, and the blocker instruction. An allowed command that fails normally, such as Git outside a
  repository, retains a normal command error rather than a policy-denied message.
- **Front matter reaches execution:** test ordinary layered Agent definitions and bare subagent files. Omitted override
  fields inherit; a higher list replaces rather than unions; `[]` denies all; `null` clears the inherited definition
  list. Invalid types, mixed arrays, empty selectors, and unsupported selector syntax fail loading. Use a custom list
  different from the defaults, such as `[pwd]`, to prove the runtime is not hard-coded to the inspection set. Confirm
  that metadata never grants a missing tool.
- **Real Session wiring:** construct Pi Guide, read, role-downgraded read, write, and unrestricted ordinary Sessions
  through repository boundaries. Guide and read runtime tools execute approved Git queries and deny mutations. An
  unrestricted write delegate can create a disposable file. Confirm bash absence when the parent lacks it. Check
  foreground and background delegates, not only forwarded option objects. Use the existing fake external model endpoint
  to script child bash calls if needed; do not fake policy decisions or the bash tool itself.
- **Parent limits survive delegation:** a parent allowing only `git status` cannot delegate `git log` in read or write
  mode. An absent/null child list cannot clear that limit. Check broader/narrower token-prefix intersection, disjoint
  lists, and empty parent policy. Effective denial guidance lists the intersection, not the wider child defaults.
- **Guide background parity:** through Guide’s real constructed background tool, an allowed `git status` start completes
  with fixture output. A denied mutation returns guidance without reserving a task or changing files. Empty policy still
  permits status/cancel on existing owned tasks. Test the RunWield background tool constructed by external CLI bridge
  composition as well; native-host shell permissions stay unchanged.
- **Reload refreshes policy:** build Guide with list A, change its override to list B, and rebuild through the existing
  root reconstruction path. Foreground bash, background starts, generated guidance, and new delegates use B and reject
  commands unique to A. Repeat with `[]` and `null` to prove denial and reset, while preserving caller-supplied
  unrelated tools.
- **Snip compatibility:** with Snip available in the test environment, approved restricted Guide and read-delegate
  commands execute without Snip rewriting. Unrestricted Session rewriting remains covered. Exercise the actual Session
  extension path, not only a conditional or the policy factory.
- **Preserved behavior:** existing delegation tests continue to cover workflow-tool exclusion, write exclusivity, change
  attribution, cancellation, lease release, and background task limits/results. Both delegated definitions retain
  repository and memory placeholders, scope rules, uncommitted-change guidance, and final-handoff instructions after
  shared-practice composition. Replace only old no-bash-for-read assertions and Guide’s unrestricted-shell expectations.
  Preserve Guide docs-only tools, bare-prompt `tools:` rejection, and unrestricted Agents’ normal shell behavior.
  External native command construction remains unchanged.

### Manual and document review

- In a Pi-backed Guide Session, inspect status, recent history, and a diff directly, through a read delegate, and
  through a background read delegate. Start an approved inspection command with Guide’s background tool. Each path
  returns real findings.
- Give a read delegate a brief that requires an unavailable command. Confirm the tool denies it, explains the allowed
  set, and the delegate returns a blocker rather than trying another shell or claiming success. Confirm Guide also
  reports a blocker when its allowed commands are insufficient. Agent compliance is a prompt behavior, not a security
  guarantee.
- In a disposable project, set Guide’s override to `[pwd]`, reload, and confirm Git inspection is denied in foreground
  and background calls. Set it to `null`, reload, and confirm ordinary shell behavior returns. Keep read-delegate
  defaults restricted even under an unrestricted parent.
- Verify Core scenarios cover configuration precedence/reset, allowed inspection, useful rejection, missing parent
  authority, role downgrade, inherited limits, and background parity. Check that customization examples, glossary,
  architecture, and ADR match implemented behavior and do not imply external native-shell enforcement.

## Edge Cases & Considerations

- **No permission escalation:** custom tool registration can add tool names. Apply the policy only to inherited bash and
  preserve tool narrowing.
- **No shell-language expansion:** unsupported syntax can produce false rejections. The response supplies the available
  forms; the delegate uses separate tool calls or reports a blocker.
- **Git and utility side effects:** the option checks are bounded, not exhaustive. Trusted Git configuration, shell
  setup, and installed executables remain outside the filter’s guarantee. Do not add an operating-system sandbox or
  audit framework.
- **Background parity:** child execution uses the same policy as foreground execution. It does not receive
  `background_task` or recursive delegation tools.
- **Normal execution semantics:** keep Pi cancellation, timeout, nonzero-exit handling, output limits, and trusted shell
  settings. The filter must not turn command failures into successful output.
- **Settled scope addition:** `bashAllowedCommands` front matter configures Agents and subagents. Guide’s foreground and
  background shell calls share it. No settings UI, full shell parser, or third-party package fork is required.
- **Definition layering versus delegation:** `null` clears a lower configuration layer, not parent authority. Bad
  metadata is an error, not a reset.
- **Reviewable implementation assumption:** separate read/write definition entries plus the existing shared-practice
  mechanism are preferable to adding mode-specific front matter. They retain one runtime Agent identity and one copy of
  common instructions.
