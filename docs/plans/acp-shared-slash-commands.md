---
planId: "2d8c7972-ac2c-4cb6-b073-b326c9cbae7e"
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "HIGH"
affectedPaths:
    - "src/cmd/registry.js"
    - "src/shared/session/session-runtime.js"
    - "src/shared/session/named-invocation.ts"
    - "src/cmd/load-plan/"
    - "src/acp/"
    - "src/ui/tui/slash-dispatch.ts"
    - "src/ui/workspace/browser/session-commands.ts"
    - "src/ui/workspace/server/session-continuation.js"
    - "src/ui/workspace/components/SessionTimeline.jsx"
    - "src/ui/review/"
    - "src/ui/workspace/server.js"
    - "docs/prd/runwield-acp-protocol-prd.md"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173/dev/session-question"
devServerHmr: true
createdAt: "2026-09-11"
status: "feedback"
origin: "internal"
executionAgent: "engineer"
collaborationRecommendation: "pair"
---

# Shared Slash Commands for ACP

## Context

In a new WebStorm chat, the user sent `/agent`. RunWield started Router, produced a Triage Report about
`guided-validation-repair`, and handed off to Planner. A command intended to select an Agent became a User Request.

Source confirms that ACP passes converted prompt text to `SessionRuntime.promptUserTurn()`. Core resolves prompt
templates and Skills, but does not dispatch built-in commands. TUI dispatches built-ins separately; Workspace has its
own smaller command list and browser actions. ACP also sends no `available_commands_update` catalog.

The source of the Plan reference in the screenshot is not proven. ACP currently joins text and resource-link blocks. An
IDE attachment could explain it, but there is no captured WebStorm request. Do not claim that an old Session was loaded
or that a prompt template caused the report without evidence.

The owner requested all existing slash commands in ACP, with these agreed exceptions:

| Surface   | Commands hidden and unavailable                                            |
| --------- | -------------------------------------------------------------------------- |
| ACP       | `/copy`, `/theme`, `/quit`, `/exit`, `/new`, `/resume`, `/login`           |
| Workspace | `/theme`, `/quit`, `/exit`; retain its existing command coverage otherwise |
| TUI       | No new exclusions                                                          |

ACP chat creation/loading stays with the client. Existing ACP authentication stays unchanged. No browser login is added.
Workspace navigation commands keep their browser behavior. This change does not expand every TUI command into Workspace;
it makes availability authoritative and removes duplicate shared command decisions.

For clients without form support, the owner approved browser questions: a local RunWield page shows the pending
selection, text question, or approval; its answer continues the same waiting command. This is not a new Session or Plan.

Owning requirements and proposed changes:

- [ACP Session access](../prd/runwield-acp-protocol-prd.md#acp-session-access): add named requirements for advertised,
  executable slash commands, the agreed exclusions, and the bare `/agent` regression scenario.
- [Protocol negotiation and interactions](../prd/runwield-acp-protocol-prd.md#protocol-negotiation-and-interactions):
  add browser fallback for supported questions when client forms are absent. Local workflow reviews wait for a real
  browser decision instead of automatically sharing a Plan and returning. Preserve explicit cancellation, real approval,
  and truthful failure. A local browser fallback does not prove remote browser reachability.
- [Core TUI conversation](../prd/runwield-core-prd.md#tui-conversation) and
  [Agent and skill customization](../prd/runwield-core-prd.md#agent-and-skill-customization): preserve command meanings,
  specialist follow-ups, named invocation expansion, and configured Agent defaults. Add the shared distinction between a
  command and a User Request, with surface-specific availability linked to the surface owners.
- [Workspace Browser Sessions](../prd/runwield-workspace-prd.md#browser-sessions): keep existing browser navigation and
  Agent/model behavior; record the agreed exclusions and shared command catalog.
- [Core Session continuity](../prd/runwield-core-prd.md#session-continuity),
  [Plan review](../prd/runwield-core-prd.md#plan-review), and
  [execution, validation, and recovery](../prd/runwield-core-prd.md#execution-validation-and-recovery): preserve saved
  conversation identity and actual workflow decisions when `/load-plan` reaches these paths.

## Objective

ACP advertises and executes every existing TUI slash command except the seven agreed exclusions. Built-in command
behavior is shared Core behavior, not an ACP copy of TUI handlers. A bare `/agent` opens Agent selection and does not
call a model, load a Plan, or start Router triage. Selecting an Agent affects the next ordinary User Request.

## Approach

### One catalog, shared operations, surface-specific presentation

```text
TUI command input             ACP session/prompt             Workspace command controls
        |                            |                                  |
        +-------- src/cmd/registry.js catalog and resolution ------------+
                                     |
                   built-in command -> shared Core operation
                   template / Skill -> existing named invocation path
                   unavailable / unknown -> visible command error
                   ordinary text -> existing User Request path
```

Keep `src/cmd/registry.js` as the single command registry. Extend its existing definitions and lookup helpers with
slash-surface availability. Names, aliases, descriptions, hints, registration and command resolution stay in this file;
do not move them to another catalog or turn this file into a re-export wrapper. Preserve CLI versus slash availability;
aliases inherit their canonical command's rules. Do not add separate ACP or Workspace exclusion arrays.

Keep ordinary imports. Importing the registry or a command module must not start the TUI. Commands that need a TUI must
call its startup function explicitly; the CLI executable entry point remains responsible for initial dispatch. Do not
hide imports behind conditions to work around startup side effects.

Inspection found no import-time TUI startup: the registry stores function references, and
`SYSTEM_INTERACTIVE_SESSION_PORT` stores a callback. `initTUI()` is called inside `startInteractiveSession()` and
`runTerminalAuthSetup()`, not by importing them. No separate startup refactor is needed. Add an import regression check
in this Plan and preserve explicit startup while adapting command execution for ACP.

Move the actual shared command decisions from `src/cmd/*` into Core as needed. Reuse `SessionRuntime` operations and
semantic select/text/approval interactions. Do not pass a fake `UiAPI`, terminal editor, or public injectable command
engine into Core. TUI keeps terminal focus, title, clipboard and process behavior. Workspace keeps native navigation,
including its existing `/plans` action; that does not expose the CLI `plans` command family in ACP.

Shared command results must be visible through each surface's normal status/history path, without sending control
commands to a model or inventing tool calls. Read-only commands need not materialize a new Session solely to show help.
Commands which intentionally use an Agent, such as `/init`, `/sleep`, and `/compact`, still use their real Core path.

### ACP input and request lifetime

Recognize commands before resource-link flattening and named-template expansion. Keep the user command separate from
attached context. In particular, `/agent` plus a Plan attachment must still mean Agent selection; attachment text is not
an Agent name or a request to load the Plan. Retain ordinary prompt and template/Skill attachment behavior. Use the
actual WebStorm frame, if obtainable, to confirm text-block selection. Reject ambiguous command input visibly rather
than guessing a workflow from attachment contents.

Command dispatch must install event subscriptions and interaction handling before it starts work. Today these are
installed only from `promptUserTurn().onTurnStarted`. Reserve the ACP request through command completion, cancellation,
and final notification delivery as for model turns. Do not release the request while a browser question is pending. Use
Runtime authority for each operation; do not wrap nested Runtime mutations in a second writer lock.

Send standard `available_commands_update` notifications after new/load setup and when the command catalog changes,
including `/reload`. Include descriptions and argument hints for enabled built-ins, templates and Skills. Keep built-in
and alias precedence over conflicting templates, including disabled built-ins. Unknown or disabled commands return a
clear message and never fall through to Router.

### Browser questions

Reuse the local review-server composition, Astro/React build, and RunWield design system. Extract the applicable form
controls from `SessionTimeline.jsx`; both Workspace and the standalone question page use them. Add only the explicit
Cancel action and response options needed by a standalone question. Preserve Workspace's existing custom-answer
behavior, but do not allow arbitrary values in command selectors such as Agent or model selection.

```text
/agent -> pending select -> native client form, when supported
                       -> local browser question, otherwise
answer -> validate -> switch Agent -> show result -> finish ACP request
cancel -> no selection applied -> settle request and close pending form
```

The question page identifies the Session and question, shows choices or a text field, and provides submission and
cancellation. Always send the clickable URL in ACP text, even if browser opening fails. Bind the server to loopback with
an unguessable per-question capability; require that capability for reads and answers, validate same-origin submission,
and accept at most one valid answer. No Workspace account, registration, or owner database is required. Do not expose
the review server's unrelated file, upload, or Agent APIs through this small question surface.

Use the existing Runtime response validation and approval meaning. Native forms and browser forms must produce identical
semantic answers. Cancellation, Session close, and process cleanup cancel pending questions; an invalid or late answer
cannot mutate the Session. A closed browser tab alone does not approve or cancel a question: the link remains usable
until an explicit answer or ACP cancellation.

`/load-plan` must call the existing Plan workflows, not send the command text to Planner. Remove TUI startup and editor
requirements from the attached command path. Where those workflows need local Plan, Code, or Artifact review, reuse
`src/ui/review/` launchers and wait for the real decision; a generic question cannot replace review. Preserve explicit
Shared Plan operations rather than silently publishing a Plan as a substitute for local command completion. Keep Pair
capability reporting truthful; this Plan does not add Pair Execution support to ACP.

Prefer this shared route over an ACP-only command switch: the latter would fix `/agent` but leave three command lists
and different command meanings to drift again.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/cmd/registry.js` and its tests — keep the existing registry as the owner; add surface availability, extend its
  lookup/dispatch helpers, and verify that importing it does not start the TUI. No replacement registry or
  conditional-import workaround.
- `src/cmd/agents/`, `models/`, `auth/`, `settings/`, reporting/export commands, `init/`, `sleep/`, and `load-plan/` —
  separate shared operations from TUI presentation. Authentication setup itself is not redesigned.
- `src/shared/session/session-runtime.js`, interactions and named invocation support — command operation integration,
  cancellation, output, catalog changes, and built-in precedence without bypassing Session authority.
- `src/acp/server.js`, `event-mapper.js`, `interaction-mapper.js`, `session-map.js`, and their tests — standard command
  advertising, dispatch before prompt conversion, request lifetime, browser fallback, and truthful Session mapping.
- `src/ui/tui/slash-dispatch.ts`, `chat-session.ts`, runtime interaction adapter and Golden scenarios — consume shared
  definitions/operations while preserving TUI-only behavior and command timing.
- Workspace command catalog, `SessionSurface.jsx`, and `server/session-continuation.js` — consume registry availability
  instead of a second command list; retain browser-native actions and current coverage.
- `src/ui/workspace/components/SessionTimeline.jsx`, shared browser controls and `src/ui/design-system/` — reuse
  question controls without changing ordinary Workspace interaction behavior.
- `src/ui/review/`, `src/review-workspace-server.js`, `src/ui/workspace/server.js`, routes/pages and development
  fixtures — a protected standalone question page, and reuse of real review decisions where `/load-plan` needs them.
- `scripts/build-workspace-runtime.js`, `assert-workspace-review-runtime.js`, compile/release checks — ensure the new
  page and assets work in compiled `wld`, not only Astro development.
- The owning PRDs above, `docs/acp-implementation-details.md`, `docs/usage.md`, `docs/design-system.md`, and
  `docs/adr/010-session-runtime-sibling-adapters-and-acp.md` — synchronize behavior, limitations, shared ownership and
  the browser fallback. No new domain term is needed; do not change the glossary merely to name implementation helpers.

## Reuse Opportunities

- `src/cmd/registry.js` — extend `commandRegistry`, `getCommandDefinition`, `getSlashCommandDefinitions`,
  `getSlashCommandDefinition`, and alias helpers rather than creating another registry or resolver.
- `SessionRuntime.switchAgent`, `reconfigureSessionModel`, `renameSession`, reports, `compactSession`, `reloadSession`,
  `exportSession`, `requestInteraction`, and Plan workflow operations — existing authoritative operations.
- `src/shared/session/named-invocation.ts` — existing template/Skill expansion, profile application, and replay
  evidence.
- `src/cmd/load-plan/` — existing discovery, lifecycle menus, recovery actions and Plan Association checks; move their
  attached behavior, do not implement a second Plan lifecycle.
- `src/ui/review/plan-review.ts`, `code-review.ts`, `review-launcher.ts` — existing real browser review and
  cancellation.
- `src/ui/workspace/components/SessionTimeline.jsx` and `RunWieldPrimitives.jsx` — established question controls,
  semantic tokens and theme bridge; no new visual language.
- `src/shared/browser-port.ts` — real external browser launch boundary, with a visible URL fallback.
- `src/acp/server.test.js` — real protocol server and Runtime fixtures with only the model boundary replaced.
- `defineGitFixture`, `makeValidationProjectRoot`, and isolated test HOME — real filesystem, Git, Plan and Session
  evidence. Do not add injection seams for RunWield-owned command dispatch or persistence.

## Implementation Steps

1. **`src/cmd/registry.js` remains the sole command registry.** Its definitions and helpers own names, aliases,
   descriptions, hints, CLI eligibility, slash-surface eligibility and command resolution. It is not a wrapper around a
   new registry. Importing it and dispatching non-TUI commands do not start terminal UI. TUI execution starts it only
   through an explicit function call, not module evaluation. ACP excludes exactly the seven agreed commands; Workspace
   excludes the agreed three and preserves its current supported set. Disabled built-ins and aliases cannot reappear as
   templates. Catalog and resolution tests prove these rules.

2. **Shared commands perform the existing operations through Core.** TUI and ACP use the same implementations for every
   enabled built-in. Workspace uses the shared catalog and existing Core operations, not duplicate Agent/model policy.
   These are required outcomes, not just successful dispatch:

   | Commands                        | Required result                                                                                                                                |
   | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
   | `/agent`, `/agents`             | Real Agent picker or named switch; configured model/thinking reset as in TUI; failure preserves prior Agent. No model turn just to select.     |
   | `/model`, `/models`             | Select an available Session model; do not change global defaults by accidentally using the CLI path.                                           |
   | `/status`, `/logout`            | Report real provider status; remove only the selected stored credentials through existing auth services.                                       |
   | `/name`, `/session`, `/context` | Persist the requested name; report real Session totals and active context respectively.                                                        |
   | `/help`, `/version`             | Surface-correct catalog/help and real version; no model call.                                                                                  |
   | `/reload`                       | Refresh Session resources and advertised commands, including changed templates/Skills.                                                         |
   | `/compact`                      | Run actual compaction and retain usable follow-up context.                                                                                     |
   | `/export`, `/share`             | Produce a real current-Session export; share uses the existing authenticated `gh` operation and reports its actual result.                     |
   | `/settings`                     | Existing validated settings menus apply real changes with current global/project/Session precedence.                                           |
   | `/init`, `/initialize`          | Real Init operation uses the Session project root, including checks and state writes; already-initialized projects retain the current refusal. |
   | `/sleep`                        | Verified Memory backup precedes consolidation; Engineer remains active for follow-ups.                                                         |
   | `/load-plan`                    | Real selector/name lookup, current lifecycle actions, review decisions and continuation; missing/cancelled selection starts no work.           |

   TUI presentation-only commands retain their existing implementations. No enabled command is satisfied by a stub,
   echo, help-only response, or forwarding its raw command text to a model.

3. **Browser questions complete real Runtime interactions.** A shared form component serves Workspace and the new
   standalone page. Native forms remain preferred. Without form support, real select/text/approval requests expose a
   usable local URL and wait for a valid answer. Required-field, option and approval validation runs on the server.
   Cancel, duplicate submissions, wrong tokens, cross-question tokens, and late replies cannot apply a choice twice or
   affect a different Session. The page supports keyboard use, pending/error states, and explicit cancellation. The
   `/dev/session-question` fixture covers these views using the existing Surface Lab.

4. **ACP dispatch and catalog updates reach the shared behavior.** New/load sends the standard catalog; reload and
   resource changes replace it. Built-ins are recognized before ordinary prompt flattening. A fresh `/agent` with
   attached Plan context opens only the Agent selector. Unknown/disabled commands return explicit errors without model
   activity. Non-command prompts, named templates and Skills preserve their existing paths and attachments. Event
   subscriptions, interactions, active-request reservation, and cancellation also cover commands that never call
   `promptUserTurn`.

5. **Workflow commands preserve real decisions and conversation identity.** `/load-plan` no longer depends on terminal
   startup or editor state. Local review branches use the existing review engines and resume from actual decisions.
   Reading or cancelling a Plan selector does not rename the Session, change Plan status, or start an Agent. Execution
   transitions use existing same-Session segment handoffs. Inspect the existing execution-follow-up replacement path: it
   must not silently map an ACP ID to a different durable Session and then reload the old one after restart. Apply the
   needed shared continuity correction, using existing segment/continuation machinery rather than a new ACP alias store.
   Preserve worktree, MCP tools, Plan Associations and saved history. Do not add the separate proposed Guided Repair
   workflow as part of this command fix.

6. **Shipped builds and documentation match the result.** Compiled `wld` contains hydrated question assets. The owning
   PRD requirements, scenarios, ACP audit, command documentation, design-system description and ADR-010 references
   describe actual support and exclusions in the same change. Retain unmet remote-browser and broader ACP conformance
   targets explicitly. Existing ACP Terminal Auth and `session/new` authentication checks remain unchanged. No
   credentials form, extra authentication method, or full Workspace command expansion is added.

## Approval Confirmation

No Work Record supersession is proposed.

## Verification Plan

### Behavior tests that distinguish a real fix

Use the real ACP server and `SessionRuntime` fixtures, actual temporary Projects/Sessions/Plans and browser HTTP routes.
Replace only external model, browser-launch, provider-network or subprocess boundaries where necessary.

- **Import safety:** in a fresh isolated child process, import the real `src/cmd/registry.js` without calling a command.
  Use sandboxed HOME/database/project paths and captured output. Assert the child completes, emits no terminal control
  output, does not activate stdin/raw mode, and `getTUI()` still reports not initialized. Do not replace the registry or
  startup functions, and do not test an already-cached import. Existing TUI startup/Golden tests must still prove that
  explicit startup works. If the guard finds an actual import side effect, move that action into its explicit startup
  function in this same change; do not mask it with a conditional import.
- **Original regression:** through ACP `session/new` then `session/prompt`, send `/agent` alone, then with a Plan
  resource link and the WebStorm text-context shape if captured. Assert zero model requests, zero `triage_report` and
  `plan_written` calls, no Plan Association, and a pending selector. Choose a configured Agent; assert actual active
  Agent/model/thinking state. Submit a normal follow-up and assert it reaches that Agent. A raw-prompt pass-through
  implementation must fail this test before the fix.
- **Discovery:** assert the wire catalog equals enabled built-ins plus invokable templates/Skills, with hints and no
  duplicates or excluded aliases. Repeat on load and after adding/removing a template followed by `/reload`. Assert no
  CLI-only commands leak into ACP. A catalog-only fix must fail invocation tests.
- **Every enabled command:** maintain a table-driven coverage inventory against registry metadata, plus behavioral cases
  for every row in Step 2. Assert persisted changes, actual output files/content, external command arguments, or real
  Runtime outcomes—not just handler invocation. Use real Plan fixtures for draft, approved and worktree recovery cases;
  inspect the selected action and state. Keep failure and cancellation cases for destructive actions.
- **Fallback path:** with `clientCapabilities: {}`, send `/agent`, GET the emitted question URL, submit a choice to its
  real endpoint, and assert the same ACP request completes with the changed Agent. Repeat for `/settings` text input and
  approval decline. With native forms advertised, assert no browser surface starts. A URL or form with no working answer
  path must fail.
- **Safety and settlement:** invalid/foreign/missing/used tokens and invalid choices cause no mutation. Cancel while a
  browser form is pending; assert no default answer, final updates before the cancelled response, then a successful next
  command. Run two Sessions concurrently; answering A cannot settle B. Same-Session overlapping commands remain
  excluded. No diagnostic text corrupts ACP stdout.
- **Preservation:** all excluded commands, aliases and name collisions return unavailable without model calls or side
  effects. TUI commands keep their prior behavior, including command timing while streaming, `/init` refusal, template
  profiles, Skill expansion, Agent defaults, and override lifetime. Workspace keeps navigation, new-Session default
  selection, manual overrides, and existing custom-answer interactions.
- **Durability and project scope:** `/name` and Agent selection survive restart/load. Exercise `/load-plan` execution
  and worktree follow-up, restart ACP, and load the original ACP ID: saved history, active workflow and next request
  remain in the same durable Session. Use two Projects in one server to prove `/init`, exports, catalogs and Plan
  actions resolve from the Session root, not process cwd.
- **Workflow decisions:** drive real local review routes for feedback, approval and cancellation. Assert feedback
  reaches the waiting workflow, approval is not inferred from opening a page, and cancellation starts no execution. Keep
  existing review and publication requirements; do not replace their tests with command-output snapshots.

Tests expecting unsupported select/text/approval solely because ACP form support is absent must be replaced by the
browser-fallback cases. For local review, replace the immediate automatic-share response expectation with a real pending
browser decision; keep explicit Shared Plan operations covered. Tests for truly unsupported capabilities, invalid native
answers, cancellation, authentication, resource links, templates, MCP tools, Session replay and cumulative cost must
remain. No other coverage is retired.

### Semantic review of shared ownership

Confirm command definitions and resolution remain in `src/cmd/registry.js`, not a new registry hidden behind imports or
re-exports. Trace each enabled built-in from TUI and ACP through this registry to the code that decides and applies its
behavior. They must reach one Core implementation, not two equivalent copies. In particular, trace Agent availability,
selection validation, model/thinking defaults, and failed-switch preservation from TUI, ACP and Workspace. Inspect the
former `runAgentsCommandTUI` and Workspace selection helpers: only presentation and data projection may remain there;
independent policy branches must be removed. Check the same boundary for model configuration and load-plan lifecycle
choices. Shared exports, equal test results, and forbidden-import checks alone do not prove this objective.

### Commands

Run through the isolated test runner only:

```sh
deno run -A scripts/run-tests.js src/acp src/cmd src/shared/session src/ui/named-invocation-cross-surface.integration.test.ts
deno run -A scripts/run-tests.js src/ui/review src/ui/workspace/browser/session-commands.test.ts src/ui/workspace/session-continuation.integration.test.ts src/ui/workspace/workspace-review.test.js
deno task test:golden-tui
deno task check
deno task seams:check
deno task workspace:check
deno task workspace:build
deno run -A scripts/build-workspace-runtime.js
deno run -A scripts/assert-workspace-review-runtime.js
deno task compile
deno task release:check
deno task doc-links:check
deno task ci
```

Include the new standalone question server/component tests in the targeted runner commands. Confirm compile/release
checks actually load and submit the new page; merely generating an asset is insufficient. Never run `deno test`
directly. Use `getHomeDir()`/`getCwd()` and `withProcessGlobalTestLock` for process-global mutations.

### Manual checks

- Start `deno task workspace:dev`; open `/dev/session-question` with headed `agent-browser` in an isolated Session.
  Check select, text, approval, invalid answer, cancellation, pending submission and completed states. Check keyboard
  navigation and narrow-screen layout. Inspect browser errors and failed network requests. Use current `--rw-*` tokens
  and shared controls, not a custom dialog design.
- Against the compiled binary, open the real question URL from an ACP request and complete it. Confirm bundled assets
  load without the development server or Workspace registration. Inspect the real changed Runtime state afterward.
- In WebStorm with that binary, start a new chat, inspect `/` suggestions, type bare `/agent` with a Plan open in the
  editor, choose an Agent, and send a follow-up. There must be no triage or Plan loading from the command. Repeat
  `/model`, `/settings`, `/load-plan`, an unknown command, and a hidden command. Cancel a pending question and retry.
  Record the tested WebStorm/build versions and advertised form capabilities; do not claim WebStorm proof from a
  protocol fixture alone.
- Check Workspace command suggestions and its existing Agent/model/navigation behavior. Confirm theme/quit/exit do not
  appear. Check TUI `/copy`, `/theme`, `/quit`, `/new`, `/resume`, and `/login` retain their behavior in a disposable
  Session; do not change the developer's real credentials for verification.

## Edge Cases & Considerations

- Browser fallback is for a reachable local browser surface, matching the reported local WebStorm use. Do not claim a
  loopback URL works from a remote client or add a tunnel/account service. Native forms remain usable for remote
  clients. Document reachability limits without automatically selecting an answer or abandoning the workflow.
- Command advertising does not install client code and cannot force WebStorm to render suggestions. Actual typed command
  execution is required even if a client ignores catalog notifications. Use the standard protocol rather than
  client-name checks: https://agentclientprotocol.com/protocol/slash-commands.
- `/share` still means an intentional Session export to a secret Gist, not public privacy guarantees. `/logout` retains
  current credential scope. Only explicit command invocation authorizes these effects; attached resources do not.
- Missing browser assets or failure to start a local server must produce an actionable error, not a fake usable URL. A
  failed browser launcher alone leaves the printed URL available.
- No new replaceable seam for command dispatch, Plan writes, locks or Session storage. ADR-010's dependency direction
  remains enforced. Extend that ADR for shared command ownership and local question presentation rather than adding
  competing architectural guidance.
- The planning tree had unrelated edits, including another recovery Plan. Do not overwrite those changes. Recheck the
  current load-plan and review implementation before execution; preserve concurrent completed fixes.
