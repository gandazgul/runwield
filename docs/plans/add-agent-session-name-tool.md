---
planId: "5b35b3ec-6b0b-4f06-a7c4-3715706e21bc"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/tools/set-session-name.ts"
    - "src/tools/registry.js"
    - "src/shared/session/agents.js"
    - "src/shared/session/session.js"
    - "src/shared/session/SYSTEM_PROMPT_TEMPLATE.md"
    - "src/shared/session/__tests__/session-tools-policy.test.js"
    - "src/shared/session/session-prompt.test.js"
    - "src/shared/session/claude-cli-execution.test.ts"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-28T12:56:14-0400"
status: "validated"
origin: "internal"
userVerifiedAt: null
workRecord:
    status: "generated"
    recordId: "f5406f11-f10b-4653-89a3-b68dce63053f"
    path: "docs/work-records/2026-08-28-agent-sessions-can-name-themselves.md"
    lastAttemptAt: "2026-08-28T21:06:17.548Z"
routingIntent: "PLANNED_CHANGE"
sessionName: "agent session naming"
targetBranch: "main"
---

# Add an Agent Session Name Tool

## Context

Router Triage gives a fresh Session a short Session Name, and `/name` lets the user set or replace it. A Session that
starts directly with another Agent can remain unnamed because no Agent tool exposes the existing naming behavior.

All user-facing Agents need a `set_session_name` tool. This includes bundled and project-defined Agents, but not
isolated Subagents such as Reviewer, delegated helpers, Init, Slicer, or validation repair. A background helper must not
rename the parent conversation.

The shared system prompt must contain one short reminder to call the tool early when the Session has no name. If Router
Triage, `/name`, `/new <name>`, Plan loading, or another prior action already supplied a Session Name, the reminder must
not appear. The tool remains available so an Agent can perform an intentional later rename when the user requests it.

The working tree has unrelated changes in `TODO.md`, `deno.lock`, existing Plan files, and archived Plan moves. They do
not overlap the expected source surface or this new Plan file and must not be changed or reverted during execution.

## Objective

Let every user-facing Agent assign the current Session a sanitized, persisted Session Name through the same authority
used by Router Triage and `/name`.

An unnamed Agent prompt encourages one early naming call. A named Agent prompt omits that reminder, so the Agent does
not compete with Router or overwrite an existing user-visible label.

## Approach

Add one universal Agent capability at Agent-definition loading time instead of adding the tool to every bundled
frontmatter file. This also covers project-defined Agents and prevents local Agent overlays from accidentally removing
the capability. Keep Subagent loading unchanged.

```text
load Agent definition
  -> include universal set_session_name capability
  -> build execution session for Pi or Claude CLI
  -> register tool against HostedSession root Session manager
  -> render prompt reminder only when getSessionName() is empty

set_session_name({ name })
  -> sanitizeSessionName(name)
  -> append Session Name to root Session manager
  -> emit session_renamed
  -> adapters refresh Session display; TUI updates Terminal Title
```

The tool must use the current root Session manager and the existing `session_renamed` event. It must not create a second
name store or call a TUI API. This keeps persistence and adapter updates consistent across the terminal user interface
(TUI), Agent Client Protocol (ACP), Headless Mode, Pi, and Claude CLI execution.

The prompt template will contain one placeholder line for the reminder. Prompt assembly will replace it with one
instruction when the effective root Session Name is empty and with an empty string when a sanitized name already exists.
Checking the effective name, rather than trying to record Router provenance, also protects names supplied by the user or
Plan loading.

The option set aside is listing the tool in every Agent frontmatter file. That would miss project-defined Agents and
make universal behavior depend on each overlay's tool list.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/tools/set-session-name.ts` and a focused test under `src/tools/__tests__/` — define the schema and execute a real
  root Session Name mutation with sanitization, persistence, a useful result, and `session_renamed` emission.
- `src/tools/registry.js` and `src/shared/session/agents.js` — define and apply the universal user-facing Agent tool set
  so bundled, layered, and project-defined Agents receive `set_session_name` while Subagent definitions do not.
- `src/shared/session/session.js` — auto-wire the tool for Pi and Claude CLI execution and give prompt assembly the
  effective root Session Name without adding a dependency-injection seam.
- `src/shared/session/SYSTEM_PROMPT_TEMPLATE.md` — add the single conditional reminder placeholder in the common Agent
  prompt.
- `src/shared/session/__tests__/session-tools-policy.test.js` — prove universal Agent availability, overlay resistance,
  project-defined Agent coverage, and Subagent exclusion.
- `src/shared/session/session-prompt.test.js` — prove the actual composed prompt includes the reminder for an unnamed
  Session and omits it for a named Session.
- `src/shared/session/claude-cli-execution.test.ts` and existing backend bridge tests if needed — prove the tool is
  exposed and executable through the Claude CLI Model Context Protocol (MCP) bridge, not only through Pi.
- Existing Session Runtime, Router orchestrator, `/name`, and TUI runtime-adapter tests — extend only where needed to
  protect persistence and Terminal Title behavior through the real `session_renamed` path.

No domain-language update is required. **Session Name**, **Terminal Title**, **Agent**, and **Subagent** are already
canonical terms, and `set_session_name` is an implementation-level tool name that does not redefine them.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `sanitizeSessionName` in `src/shared/session/session-name.js` — keep the existing whitespace, control-character, and
  length rules shared with Router and `/name`.
- `HostedSession.getRootSessionManager()` and `SessionManager.appendSessionInfo()` — mutate the canonical persisted
  Session Name during an Agent turn.
- `emitHostedSessionRuntimeEvent(..., { type: RuntimeEventTypes.SESSION_RENAMED, ... })` — notify all adapters without a
  TUI dependency.
- `applyAutoSessionName` in `src/shared/workflow/orchestrator.ts` — preserve its rule that Router Triage does not
  replace an existing Session Name; consolidate a small shared mutation helper only if that removes real duplication
  without weakening ownership.
- `createTriageReportTool` and the auto-wiring branches in `buildAgentSession` / `composeClaudeCliBridgedTools` — follow
  the established HostedSession-backed tool factory and cross-backend composition patterns.
- `runNameCommand` in `src/cmd/name/index.ts` — preserve its visible behavior as a user command; do not route the Agent
  tool through TUI command code.

## Implementation Steps

- [ ] A `set_session_name` Tool Definition accepts one required string `name`, sanitizes it with `sanitizeSessionName`,
      rejects an empty sanitized result, and reports the effective persisted name. A valid call writes the root Session
      Name and emits exactly one `session_renamed` event with that name.
- [ ] The tool fails clearly when no HostedSession or writable root Session manager is available. It does not claim
      success, create local fallback state, or depend on a TUI surface.
- [ ] The explicit tool call can replace an existing Session Name, consistent with `/name`. Router's automatic naming
      rule still cannot replace an existing name.
- [ ] Every user-facing Agent definition returned by `loadAgentDef` includes `set_session_name`, including bundled
      Agents, layered home/project overrides, and new project-defined Agents whose own frontmatter has no tools. The
      universal capability cannot be removed by an Agent overlay or narrowed runtime tool list.
- [ ] `loadSubAgentDefinition` results do not gain `set_session_name`; Reviewer, delegated, Init, Slicer, manual quality
      assurance, and validation-repair sessions cannot rename their parent Session.
- [ ] Pi and Claude CLI execution sessions both register the same `set_session_name` Tool Definition when a
      HostedSession is present. A call through either backend reaches the same root Session manager and emits the same
      runtime event.
- [ ] `SYSTEM_PROMPT_TEMPLATE.md` contains one reminder line, represented by one conditional placeholder, that tells an
      Agent to call `set_session_name` early with a short descriptive name when the Session is unnamed.
- [ ] Prompt assembly resolves that placeholder from the sanitized effective root Session Name. The reminder is present
      for an unnamed Session and absent, with no unresolved placeholder or extra blank section, after Router Triage or
      any other prior naming path supplied a name.
- [ ] Existing Router Triage, `/name`, Session resume, `/new <name>`, Plan-load naming, Session display, and Terminal
      Title behavior remain compatible. No persisted Session schema or migration is added.

## Approval Confirmation

No Work Record is proposed for supersession. The approved **Automatic session names and terminal titles** Work Record
(`22273507-4d84-465a-8893-7e04fe48f1a6`) remains valid and is an implementation dependency; this Plan extends that
behavior to direct Agent naming rather than replacing its guidance.

## Verification Plan

- Automated: run
  `deno run -A scripts/run-tests.js src/tools/__tests__/set-session-name.test.ts src/shared/session/__tests__/session-tools-policy.test.js src/shared/session/session-prompt.test.js src/shared/session/claude-cli-execution.test.ts src/shared/workflow/orchestrator.test.ts src/cmd/name/index.test.ts src/ui/tui/runtime-adapter.test.js`.
- Automated: the tool test must use a real in-memory or fixture `SessionManager` attached to a `HostedSession`; it must
  assert the persisted name and emitted `session_renamed` event. A stub tool that only returns its input must fail.
- Automated: Agent policy tests must load a bundled Agent and a project-defined Agent with `tools: []`, then verify both
  effective execution tool sets contain `set_session_name`. They must load representative isolated Subagents and verify
  the tool is absent.
- Automated: prompt tests must build through the real common template and prompt-assembly boundary for both an unnamed
  root Session and a root Session named before downstream Agent construction. They must assert the complete reminder
  meaning in the first prompt and its complete absence in the second; a permanently present line or source-only
  placeholder check must fail.
- Automated: Claude CLI coverage must exercise the MCP-exposed tool and assert the root Session manager changes. Tool
  advertisement alone is not sufficient.
- Automated: run `deno task ci`, including `deno task seams:check`; the change must not add or re-baseline an injection
  seam.
- Manual TUI: start a fresh Session directly with a non-Router Agent, ask a normal question, and confirm the Agent can
  set a short Session Name early. Confirm the Session display and terminal tab use the sanitized name.
- Manual Router path: start a normal Router-led User Request, let Triage name it, and inspect the downstream Agent's
  composed prompt or debug evidence. Confirm the naming reminder is absent and the Router-provided Session Name remains
  unchanged.
- Expected: direct Agent sessions become named through one persisted authority; Router-led and manually named Sessions
  do not prompt the next Agent to name them again; isolated Subagents cannot rename the parent Session.
- Existing behavior that must remain protected: Router only auto-names an unnamed Session, `/name` can intentionally
  rename it, resume retains it, and `session_renamed` updates the TUI Terminal Title.
- Behavior expected to stop existing: a user-facing Agent session can be constructed without access to any Session Name
  capability.

## Edge Cases & Considerations

- **Blank or hostile input:** apply the existing sanitizer before persistence. Reject a name that becomes empty; never
  write control characters or an over-length title.
- **Existing names:** prompt suppression uses any valid effective Session Name, not unprovable Router provenance. This
  prevents accidental renaming of manual, resumed, `/new`, and Plan-derived names as well.
- **Agent call after naming:** the tool remains available because the user can ask for a rename. Its description and
  reminder must distinguish early default naming from an intentional replacement.
- **Prompt lifetime:** a prompt built while unnamed can retain its conditional instruction for that Agent Session after
  the first successful call. The line must be worded as a condition on the Session still being unnamed, and the tool
  result must state that naming succeeded. A later Agent construction will omit the line.
- **Deferred first-message persistence:** naming during the first active turn must use the materialized root Session
  manager and must not violate the rule that an empty TUI Session creates no files before the first user message.
- **Backend parity:** Claude CLI uses MCP aliases for bridged tools. The internal transcript tool name and behavior must
  remain `set_session_name`, even if the external MCP spelling is prefixed by the backend.
- **No schema migration:** Session Name already persists in Session transcript metadata. This change adds another
  caller, not another field or source of truth.
