---
planId: "a5983252-78d4-466f-879e-17d27b749ade"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "HIGH"
affectedPaths:
    - "src/shared/session/named-invocation.ts"
    - "src/shared/session/session.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/session-transcript-projection.js"
    - "src/shared/session/backends/claude-cli/execution-session.ts"
    - "src/tools/registry.js"
    - "src/ui/tui/slash-dispatch.ts"
    - "src/acp/server.js"
    - "src/prompt-templates/commit.md"
    - "docs/domain-language.md"
    - "docs/customization.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-31"
status: "implemented"
origin: "internal"
userVerifiedAt: null
targetBranch: "main"
---

# Core-Owned Prompt Template Invocation

## Context

Prompt Template and Skill files are discovered and expanded in shared Session code, but the terminal user interface
(TUI) still interprets and dispatches their slash commands. The TUI expands the selected file, attempts to switch the
root Agent to Operator, and submits the expanded text as an ordinary turn. Workspace and Agent Client Protocol (ACP)
submit the same slash text as ordinary model input, Prompt Template `model` metadata is parsed but ignored, and
`/reload` does not refresh the TUI's cached prompt and Skill names.

Users need one Core-owned behavior on every Session surface. A Prompt Template can select an Agent, model, and thinking
level in Front Matter, with Operator as the Agent default. That selection applies to one session-aware auxiliary turn
only. It must not replace the workflow owner or advance a workflow. A named Skill remains different: it adds
instructions to the current Agent and can support that Agent's existing workflow.

## Objective

Make `SessionRuntime` the source of truth for resolving and invoking named Prompt Templates and Skills. TUI, Workspace,
and ACP must produce the same expansion and Session behavior from the same raw slash invocation without duplicating
execution policy. Prompt Template turns must use the active Session context and working directory, apply their declared
Agent/model/thinking profile for one turn, preserve an immutable expansion for resume, show only the compact invocation
to the user, and leave the root Agent, model, thinking level, and workflow state unchanged.

## Approach

Move command recognition to the raw user-turn boundary. Keep TUI-only built-in commands in the TUI, but pass known
Prompt Template and Skill invocations to Core without expansion or Agent switching.

```text
TUI / Workspace / ACP
  -> SessionRuntime.promptUserTurn(raw text)
     -> ordinary text: current root Agent Handler
     -> /skill:name: expand once, current root Agent Handler
     -> /template: resolve once, auxiliary Agent Session
        -> same transcript context + active workflow cwd
        -> Front Matter Agent/model/thinking
        -> no workflow-advancement tools or Agent Handler
        -> root configuration never changes
```

A versioned hidden transcript entry will contain the exact resolved expansion and execution profile. Runtime events,
replay, and HTML export will project that entry as the compact text the user typed. The Pi and Claude CLI conversation
readers will instead present the immutable expansion to the model. Expansion is one-pass: text produced by a Prompt
Template or Skill is never parsed as another slash command.

Use the existing isolated Agent Session machinery rather than switching the root and trying to restore it afterward. Add
a transient configuration mode so the auxiliary session does not borrow a manual `/model` selection, persist model or
thinking markers, change settings, or compact the root context. The main option set aside is a persistent Agent switch;
it would make follow-up conversation natural for that Agent, but it would leave hidden model-cost and workflow-ownership
changes after a command that appears one-shot.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/session/named-invocation.ts` — own the shared slash grammar, catalog-by-name resolution, Front Matter
  types, strict execution-profile validation, and versioned transcript payload type.
- `src/shared/session/session.js` — extend Prompt Template metadata, reuse layered Agent/model/thinking resolution,
  build session-aware auxiliary turns, and keep Skill expansion on the current root path.
- `src/shared/session/session-runtime.js` — classify raw user turns once, preserve managed-operation locking/events,
  dispatch Prompt Templates without the root Agent Handler, and use the active workflow working directory.
- `src/shared/session/session-runtime-events.js` and managed Session types — expose compact invocation events and a
  refreshed Prompt Template/Skill catalog after `/reload` without leaking the hidden expansion to presentation adapters.
- `src/shared/session/session-transcript-projection.js` and `src/shared/session/root-session.js` — replay and export the
  compact invocation while retaining the exact hidden expansion in raw JSONL.
- `src/shared/session/backends/claude-cli/execution-session.ts` — include named-invocation custom entries as expanded
  user context for Claude CLI without persisting the temporary model as the root model.
- `src/tools/registry.js` and Agent-session tool composition — centrally identify and remove workflow-advancement tools
  from auxiliary Prompt Template turns for both Pi tools and bridged Claude CLI tools.
- `src/ui/tui/slash-dispatch.ts`, `src/ui/tui/chat-session.ts`, and related TUI catalog/input modules — retain built-in
  command handling and autocomplete, but remove Prompt Template/Skill expansion, Operator switching, and execution-path
  ownership; refresh catalogs after `/reload`.
- `src/acp/server.js` — submit ACP text through the same raw `promptUserTurn` boundary as other surfaces while
  preserving ACP cancellation, generation fencing, interactions, and event mapping.
- `src/ui/workspace/server/session-continuation.js` — expected to need behavior tests rather than a second dispatch
  path; Workspace already submits through `promptUserTurn`.
- `src/prompt-templates/commit.md` and other bundled Prompt Templates that mention lifecycle tools — finish in ordinary
  assistant prose because auxiliary Prompt Template turns cannot call `task_completed` or another workflow signal.
- `docs/domain-language.md` — redefine Prompt Template as a Core named invocation and record its stable relationship to
  an auxiliary Agent turn, Session Transcript, Skill invocation, and workflow owner.
- `docs/customization.md`, `docs/settings.md`, `docs/architecture.md`, `docs/usage.md`, and bundled RunWield Skill docs
  — document Front Matter, precedence, strict failures, cross-surface execution, transcript display, reload, and the
  Prompt Template versus Skill workflow boundary.
- Focused tests under `src/shared/session/`, `src/ui/tui/`, `src/ui/workspace/`, and `src/acp/` — prove real execution
  and persistence behavior through each repository boundary rather than only checking parser output.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session.js:listPromptTemplates`, `listSkills`, `expandPromptTemplate`, and `expandSkillCommand` —
  retain source precedence and expansion formats, but resolve execution by Session and name instead of trusting a client
  file path.
- `src/shared/session/session.js:runIsolatedAgentSession` — reuse disposable Agent construction, event subscribers,
  steering-target registration, cancellation, and `finally` cleanup for Prompt Template turns.
- `src/shared/session/session.js:resolveModel`, `getConfiguredAgentThinkingLevel`, and `buildAgentSession` — reuse the
  real registry, authentication, preset, and Agent-definition rules with an explicit transient mode and strict
  overrides.
- `src/shared/session/hosted-session.js:getActiveExecutionCwd` — keep auxiliary reads, writes, and shell commands in the
  worktree the active workflow is discussing.
- `src/shared/session/session-runtime.js:#runManagedOperation` — preserve the Session Writer Lock, generation fence,
  busy interval, transcript checkpoint, cancellation capability, and failure recovery.
- Existing hidden `custom_message` and RunWield custom-entry patterns — store an immutable model request while
  projecting a different compact user-facing representation.
- `src/shared/session/agents.js:listAvailableAgents` / `isWorkflowOnlyAgent` — accept layered custom Agents but reject
  workflow-only Agents from Prompt Template Front Matter.

## Implementation Steps

- `src/shared/session/named-invocation.ts` owns a named, typed result for ordinary input,
  `/skill:<name> [instructions]`, and `/<template> [instructions]`. It resolves only the original submitted text, uses
  existing project/home/bundled/ package precedence, reads the winning file once per invocation, and never recursively
  classifies expanded text.
- Prompt Template Front Matter accepts only the existing descriptive fields plus `agent`, `model`, and `thinkingLevel`
  as execution policy. Missing `agent` resolves to Operator; missing model and thinking resolve from the selected
  Agent's preset/settings/default/Agent-definition configuration without borrowing the root Session's manual `/model`
  choice. Explicit declarations win for that invocation. Unknown or workflow-only Agents, malformed or unavailable
  models, and invalid or unsupported thinking levels fail before a model call and do not silently fall back or clamp.
- `SessionRuntime.promptUserTurn` is the sole external raw-turn classification boundary used by TUI, Workspace, and ACP.
  It resolves a named invocation before deferred first-turn display/persistence, sends ordinary input through the
  current behavior, sends Skills through the current root Agent Handler, and sends Prompt Templates through the
  auxiliary path. Internal expanded requests bypass classification, so a body beginning with `/` remains literal model
  input.
- A Prompt Template auxiliary turn receives every committed user, assistant, and tool message from the current Session
  Transcript Segment before the named invocation, but it does not receive sealed predecessor Segments excluded by
  ADR-012. The exact expansion is the next user request. Tools use `HostedSession.getActiveExecutionCwd()`. The turn
  runs through `runIsolatedAgentSession` with the active Segment's real Session Manager rather than its default empty
  in-memory manager, without replacing the root Agent Session or calling the active Agent Handler. Temporary
  Agent/model/thinking information is visible in normal Runtime status events and is removed in `finally`; the root
  Agent, manual model override, thinking level, workflow owner, and workflow checkpoint are byte-for-byte/structurally
  unchanged after success, error, or cancellation.
- Auxiliary tool composition removes a centrally defined complete set of workflow-advancement capabilities, including
  `triage_report`, `plan_written`, `task_completed`, `review_complete`, `qa_checklist_generated`, `pair_checkpoint`, and
  Slicer finalization, from built-in, custom, delegated-child, and Claude MCP tool surfaces. The auxiliary system prompt
  explicitly says that this turn has no workflow authority and must finish in ordinary prose. It can still use the
  selected Agent's ordinary read, write, shell, search, memory, delegation, and interaction tools; repository changes
  made before failure or cancellation remain on disk and are never rolled back.
- The selected model and thinking level are applied directly to the disposable execution session without changing Hosted
  Session settings, appending root model/thinking markers, or triggering root-context compaction. Core validates image
  support and Vision Fallback against the selected model. If the current Session history does not fit that model, the
  invocation fails with guidance to compact, start a fresh Session, or choose a larger model instead of compacting
  automatically.
- A versioned `runwield.named_invocation` transcript entry stores the compact invocation, kind, exact expanded request,
  image references, source layer/name, expansion digest, and resolved Prompt Template Agent/model/thinking profile; it
  does not store an absolute local source path. Live events, aggregate replay, Workspace/ACP projections, and HTML
  export show one normal compact user message. Pi resume/compaction context and Claude CLI conversation reconstruction
  consume the exact expansion once. Raw JSONL retains the hidden payload, and existing transcripts require no migration.
- Skill invocation keeps the current Agent, model, thinking level, Agent Handler, active workflow tools, Session
  context, images, and active workflow working directory. Its compact invocation and immutable expansion use the same
  transcript representation, but it can advance an already-owned workflow exactly as the equivalent expanded user turn
  can today.
- TUI known Prompt Template and Skill commands submit their untouched slash text through `promptUserTurn`; TUI no longer
  reads template paths for execution, expands content, resolves template models, switches to Operator, or submits a
  second synthetic request. TUI built-ins retain precedence and existing unknown-command behavior.
- `SessionRuntime.reloadSession` re-scans every configured Prompt Template and Skill layer, rebuilds the active Agent so
  changed Skill metadata/body is present in model context, invalidates any prior catalog result, and publishes the new
  catalogs only after reload succeeds. The TUI replaces—not merges—its Prompt Template/Skill autocomplete and collision
  data from that event, so added, changed, renamed, and deleted resources take effect without restart. A later
  invocation resolves and reads the winning Prompt Template or Skill again rather than retaining its pre-reload path or
  body.
- ACP `session/prompt` uses `promptUserTurn` and retains its interaction adapter, turn-start receipt, cancellation race,
  Session replacement subscription, and errors. Workspace continues through its existing `promptUserTurn` path. The same
  named invocation fixture produces the same compact user event, expansion digest, selected execution profile, and final
  root configuration through TUI, Workspace, and ACP integration tests.
- Bundled Prompt Templates and transient Agent guidance are consistent with auxiliary completion: `commit.md` no longer
  requires `task_completed`, and no bundled template instructs a lifecycle tool that the auxiliary policy removes.
  Existing `/commit`, `/release`, `/code-review`, and `code-optimizer` operational behavior remains covered.
- `docs/domain-language.md` and user documentation describe the implemented Core-owned Prompt Template contract, Front
  Matter examples and precedence, strict failure behavior, one-turn restoration, compact-versus-immutable transcript
  representation, active-worktree behavior, Skill distinction, and the fact that auxiliary file changes are not
  transactional.

## Approval Confirmation

No Work Record is proposed for `supersedes`. This change builds on earlier Prompt Template, model-selection, Session
Runtime, and ACP work without materially replacing any completed Work Record's planning guidance.

## Verification Plan

- Automated, focused:
  `deno run -A scripts/run-tests.js src/shared/session/session-catalog.test.js src/shared/session/named-invocation.test.ts src/shared/session/named-invocation-active-segment.integration.test.ts src/shared/session/session-prompt.test.js src/shared/session/session-runtime.test.js src/shared/session/session-transcript-projection.test.js src/shared/session/root-session.test.js src/shared/session/claude-cli-execution.test.ts src/ui/tui/slash-dispatch.test.ts src/ui/tui/chat-session.test.ts src/ui/workspace/session-continuation.integration.test.ts src/acp/server.test.js src/acp/managed-session.integration.test.ts`
- Automated, architecture and complete suite: `deno task seams:check`, `deno task test:golden-tui`, then `deno task ci`.
- The named-invocation integration test must use real layered Prompt Template and Skill files, a real file-backed
  Session fixture, and the production Agent/model/tool resolver. It must fail if the implementation only parses Front
  Matter, leaves TUI dispatch in place, passes slash text directly to the model, aliases the selected profile to the
  root Agent, or stubs the auxiliary response.
- `named-invocation-active-segment.integration.test.ts` must first commit a unique user fact, assistant response, and
  tool exchange to the active Segment, plus a different sentinel in a sealed predecessor Segment. It then invokes a
  Prompt Template through `promptUserTurn` and inspects the actual Pi and Claude CLI model requests. Both requests must
  contain the active-Segment fact/exchange before the exact expansion, must omit the sealed-segment sentinel, and must
  produce an answer derived from the active fact. The test must fail if `runIsolatedAgentSession` receives no Session
  Manager, uses its empty in-memory default, copies only the expansion, or exposes the aggregate visible transcript
  instead of the active Segment.
- Profile cases: prove Operator default; independent Agent-only, model-only, thinking-only, and combined declarations;
  selected-Agent fallback for omitted values; explicit values overriding the root manual selection; layered custom Agent
  support; and fail-before-model-call behavior for unknown/workflow-only Agent, unavailable model, invalid thinking, and
  model/backend-unsupported thinking.
- Workflow authority cases: start a real active QUICK_FIX or Planned Change workflow fixture, invoke a Prompt Template
  whose selected Agent and body try every workflow-advancement tool, and prove no Workflow Tool Event, Plan status,
  validation checkpoint, task-completion receipt, or active owner changes. Prove a Skill invocation still reaches the
  current root Agent Handler and can produce the normal existing workflow event.
- Restoration cases: snapshot active Agent, manual model state, thinking level, active workflow, worktree cwd, and
  transcript generation before invocation. Assert equality after success, model failure, tool failure, user interaction,
  Escape cancellation, and a command that writes a file. The file remains after failure/cancellation while Runtime state
  restores and the next root turn succeeds.
- Transcript cases: after a template source is changed or deleted, resume the Session and prove the compact invocation
  remains the only displayed user message while the original expansion—not the new file contents—is present exactly once
  in model context. Cover aggregate replay, HTML export, raw JSONL, compaction input, images, and Claude CLI
  reconstruction.
- Cross-surface cases: submit the same raw slash command through TUI, Workspace continuation, and ACP `session/prompt`.
  Assert matching compact `USER_MESSAGE`, expansion digest, temporary Agent/model/thinking status, assistant result, and
  restored root snapshot. ACP cancellation and Workspace/TUI busy state must remain active until auxiliary cleanup ends.
- Reload cases: after Session startup, add a Prompt Template and Skill, change each name/description/Front Matter/body,
  replace a higher-priority resource, and delete each resource. Run the real `/reload` operation after every change and
  prove Core returns a newly scanned catalog, the active Agent receives the new Skill metadata/body, TUI autocomplete
  and collision data replace their old entries without restart, removed names stop resolving, changed Prompt execution
  uses the new body/profile, and built-in command precedence remains.
- Preserved behavior: ordinary user turns, TUI built-ins, unknown TUI commands, prompt arguments, attached images,
  queued turns/steering, layered resource precedence, Skills' XML expansion, manual `/agent` and `/model` persistence,
  and old transcript replay remain covered. Expected behavior that stops existing: TUI-owned Prompt Template/Skill
  expansion, permanent Operator switching after a Prompt Template, expanded prompt bodies as visible user messages, and
  ignored Prompt Template `model` metadata.
- Manual smoke: in a fixture Project, create a Prompt Template with all three execution fields and a Skill. First tell
  the current Agent a unique nonce and get an acknowledgement, then invoke both from the same non-Operator Session in
  TUI, Workspace, and an ACP client. Confirm the Prompt Template can report the nonce from Session context, the compact
  command is shown, the Prompt Template temporarily reports its selected profile, the Skill reports the current profile,
  active-worktree `pwd` is correct during an active workflow, and the original profile handles the next ordinary
  message. Change the template, resume the Session, and confirm history stays compact and unchanged.
- Documentation: confirm `docs/domain-language.md`, customization/settings/usage docs, and bundled RunWield Skill docs
  all describe behavior that the integration tests prove and no longer call Prompt Templates TUI-only.

## Edge Cases & Considerations

- Existing user or package Prompt Templates may already contain dormant `model` metadata that RunWield parsed but
  ignored. It becomes active and strict in this change. Invalid, unauthenticated, or unsupported values must produce an
  actionable error naming the template and field; do not silently preserve the old ignored behavior.
- Prompt Templates can modify files, Git state, memories, or external systems through ordinary Agent tools. One-turn
  restoration applies only to Agent/model/thinking/workflow state; automatic source or external-side-effect rollback
  would risk data loss and is explicitly excluded.
- The auxiliary system prompt must override selectable Agents whose normal completion instructions require
  `task_completed`, `plan_written`, or `triage_report`. Tool filtering alone is insufficient because it would leave
  those Agents repeatedly attempting an unavailable terminal signal.
- Deferred first turns, pending images, queued TUI commands, steering, cancellation, Session replacement, and reload
  during an idle Session must still emit coherent events. A failed reload keeps the prior usable Agent and command
  catalog; a successful reload replaces both catalog projections atomically. Validation errors must not create a model
  call or a second visible user message.
- Transcript payloads can be large and can include sensitive prompt instructions. They remain local Session Transcript
  content, are hidden from normal presentation, and must not expose absolute home/project paths in HTML or ACP events.
- The hidden expansion must survive Session Transcript Segment rollover and compaction without leaking into aggregate
  display or being dropped from active model context.
- Installed package prompt discovery must resolve from the Hosted Session Project root rather than process cwd.
- This Plan does not add Workspace prompt autocomplete or a new ACP catalog protocol extension. Core already owns the
  catalog APIs and this change gives both surfaces identical execution for raw named invocations; richer
  surface-specific discovery controls can consume those APIs separately.
- The draft `docs/plans/lazy-skill-catalog-retrieval.md` concerns model-side lazy Skill retrieval. Preserve its future
  catalog direction, but do not couple this explicit user-invocation change to that unapproved retrieval design.
