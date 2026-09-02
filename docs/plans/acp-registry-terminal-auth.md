---
planId: "4977717f-6eee-4732-ac1b-c44bef919fa8"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/cli.ts"
    - "src/cmd/auth/"
    - "src/cmd/registry.js"
    - "src/ui/tui/model-welcome.ts"
    - "src/ui/tui/"
    - "src/acp/server.js"
    - "src/acp/server.test.js"
    - "docs/quickstart.md"
    - "docs/usage.md"
    - "docs/acp-implementation-details.md"
    - "docs/research/acp-registry-gap-report.md"
    - "docs/domain-language.md"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-09-02T13:47:43-04:00"
status: "implemented"
origin: "internal"
userVerifiedAt: null
targetBranch: "main"
---

# ACP Registry Terminal Authentication

## Context

The Agent Client Protocol (ACP) Registry starts each submitted Agent, sends `initialize`, and requires at least one
usable `agent` or `terminal` authentication method. RunWield returns `authMethods: []`, so it fails this required check.
A user who has not configured a model must also leave the ACP Client, start the RunWield TUI, run `/login`, choose a
model, and then retry the ACP Session.

RunWield already owns provider subscription login, API-key storage, Claude CLI selection, model selection, and first-run
setup. This change must expose that behavior as a login-only terminal process. It must not create a second credential
store or an ACP-only login implementation.

The user decided that Terminal Auth succeeds only when RunWield is ready to create an ACP Session: credentials or an
already-authenticated Execution Backend are available and a usable default model is selected. Saving credentials alone
is not success.

This Plan changes RunWield only. The versioned `agent.json`, 16×16 icon, and pull request in the external ACP Registry
remain a later publication operation.

The working tree contained unrelated Session queue work in `src/acp/server.js` when this Plan was written. Execution
must preserve that final behavior and integrate with it instead of restoring the older prompt path.

## Objective

An ACP Client that supports Terminal Auth can launch RunWield setup, let the user configure a provider and default
model, receive a reliable process success or failure result, reconnect, and create a prompt-ready RunWield Session. The
exact ACP Registry initialize probe returns a valid Terminal Auth descriptor, while Clients without Terminal Auth
support do not receive one.

## Approach

Use a setup-only TUI path over the existing authentication and model-selection owners:

```text
ACP Client -> wld acp -> initialize
                          |
                          +-> authMethods: terminal + ["login"]

ACP Client -> configured wld invocation + login
           -> existing Login command selection
           -> setup-only TUI opens the /login screen
           -> existing provider login or Claude CLI path
           -> existing default-model selection
           -> exit 0 only when ACP-ready

ACP Client -> reconnect -> wld acp -> session/new
           -> prompt-ready RunWield Session
```

The Terminal Auth descriptor uses `args: ["login"]`. ACP appends this argument to the configured Agent invocation. The
CLI must therefore route both `wld login` and an appended invocation such as `wld acp login` to the same setup-only TUI
instead of starting the protocol server. That TUI opens directly on the existing Login screen and dispatches the same
Login command handler used by `/login`; it does not introduce a new flag or a second authentication command.

`createInitializeResponse()` advertises the descriptor only when the Client declares current
`clientCapabilities.auth.terminal` support. It also accepts the ACP Registry validator's temporary
`clientCapabilities._meta["terminal-auth"]` marker so the published binary passes the actual registry check. The
unrelated `clientCapabilities.terminal` field means ACP terminal methods and must not enable Terminal Auth.

ACP readiness is derived from the existing credential/model registry and selected default model. Do not add a persisted
"authenticated" flag. When `session/new` cannot create a Session because no usable configured model exists, the ACP
adapter returns standard authentication-required error code `-32000` instead of an internal error. `session/load` keeps
using a valid model saved in the persisted Session and maps only genuine missing-model or missing-credential failures to
`-32000`; missing Sessions remain not-found errors.

Extract or reuse one product-owned model-setup coordinator so first-run setup and login-only setup cannot disagree about
provider choices, model availability, or completion. The login-only composition can render existing TUI prompts and the
model selector, but it must not create or persist a RunWield Session, transcript, manifest, catalog record, or Project
state. Existing `/login` behavior inside a live Session remains unchanged.

Terminal Auth is out of band for ACP v1. Keep `authenticate` unadvertised and unimplemented. Agent Auth and ACP logout
are out of scope.

The main option set aside is advertising a descriptor that opens the full TUI. It is smaller and can pass the registry's
shallow initialize probe, but it gives the ACP Client no dependable setup-completion signal and leaves the user inside
an unrelated chat surface.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/cli.ts` — recognize the existing Login command both directly and after the ACP positional command so appended
  Terminal Auth arguments cannot start the protocol server by mistake.
- `src/cmd/auth/index.ts` and focused files under `src/cmd/auth/` — return a typed authentication outcome, reject empty
  trimmed API keys, and route `wld login` to setup-only composition while preserving slash-command behavior.
- `src/cmd/registry.js` and `src/cmd/__tests__/registry.test.js` — expose Login on CLI and slash surfaces with accurate
  help and no optional fallback dependency bag.
- `src/ui/tui/model-welcome.ts` and a focused setup-only composition under `src/ui/tui/` — share provider/default-model
  setup rules and render a terminal flow without starting a normal Session.
- `src/ui/tui/model-welcome.test.ts`, `src/cmd/auth/index.test.ts`, and a focused terminal-login integration test —
  prove successful setup, cancellation, storage, cleanup, and unchanged first-run behavior through real TUI components
  and isolated process state.
- `src/acp/server.js` — advertise capability-gated Terminal Auth and translate missing ACP readiness into the standard
  authentication-required error without changing normal Session mapping.
- `src/acp/server.test.js` and `src/acp/protocol-smoke.test.js` — cover the current capability, registry compatibility
  request, descriptor, auth-required response, and protocol-pure output.
- `docs/quickstart.md`, `docs/usage.md`, `src/skills/runwield/COMMANDS.md`, and `src/skills/runwield/SETTINGS.md` —
  document direct login, ACP Client login, completion, cancellation, and credential storage.
- `docs/acp-implementation-details.md` and `docs/research/acp-registry-gap-report.md` — remove the empty-auth-method
  registry blocker only after the behavioral proof passes; retain all other ACP gaps.
- `docs/domain-language.md` — define Terminal Auth as an ACP Client-launched setup process and distinguish it from Agent
  Auth, normal TUI Sessions, and model-provider credentials.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/cmd/auth/index.ts` — reuse `runLoginCommand()`, provider discovery, OAuth prompts, API-key storage, and existing
  post-login behavior rather than adding ACP-owned auth.
- `src/shared/models/model-registry.ts` — keep the RunWield credential store and provider availability as sources of
  truth.
- `src/shared/session/model-selection.ts` — persist the default model through the existing settings owner.
- `src/ui/tui/model-welcome.ts` and `src/ui/tui/model-selector.ts` — reuse the first-run choices and model selector
  while separating setup from Session creation.
- `src/ui/tui/tui.ts`, `src/ui/tui/tui-manager.ts`, and `src/ui/tui/testing/virtual-terminal.js` — reuse terminal
  startup, cleanup, signal behavior, and a real test terminal.
- `src/cmd/testing/runtime-command-fixture.ts` — use real temporary credentials/settings and scripted OAuth provider
  behavior.
- `src/testing/process-global-lock.js` — protect tests that change `HOME`, cwd, or other process globals.

## Implementation Steps

- `runLoginCommand()` returns a named outcome that distinguishes authenticated, canceled, and failed provider setup.
  Existing slash Login still shows the same provider prompts, stores credentials through the same owner, opens its
  post-login model selection, and switches the live Session as it does now.
- API-key Login cannot return authenticated or write a credential when the trimmed value is empty. OAuth cancellation
  and provider failures cannot return authenticated.
- One shared setup coordinator combines existing provider or Claude CLI readiness with default-model selection. Its
  successful outcome means `getSelectedDefaultModelAvailability()` confirms a usable default model for the current
  Project; model-selector cancellation and provider cancellation produce a non-success result.
- The setup-only TUI invoked by `wld login` and `wld acp login` opens directly on the same Login screen as `/login`,
  dispatches the same handler, persists credentials and default model through existing owners, exits after the result,
  and always releases terminal resources. Its entry path does not call `createInteractiveSession()`, import the normal
  chat-session composition, create or persist a Session, or contact a model.
- `src/cli.ts` routes direct `wld login` and appended `wld acp login` invocations to the same setup-only Login flow
  before ordinary ACP server dispatch. Success exits `0`; user cancellation and setup failure exit nonzero with a
  concise visible explanation.
- `wld login` is a supported CLI command that enters the same setup-only flow. `/login` remains a supported slash
  command with its current live-Session behavior.
- `createInitializeResponse()` returns one stable Terminal Auth descriptor with an ID, user-facing name and description,
  `type: "terminal"`, and `args: ["login"]` when the Client advertises `clientCapabilities.auth.terminal === true` or
  the registry validator's legacy `_meta["terminal-auth"] === true`. It returns no Terminal Auth method for
  omitted/false capability or for `clientCapabilities.terminal` alone.
- A protocol-level `session/new` request made without an ACP-ready model receives error `-32000`. After the setup-only
  flow succeeds under the same `HOME`, the same request creates a prompt-ready Session. `session/load` preserves valid
  persisted-model behavior and its existing not-found distinction.
- The implementation adds no substitute for credential writes, settings writes, Session creation, or command routing.
  Tests use real temporary state, the existing scripted OAuth boundary, and `VirtualTerminal`; `deno task seams:check`
  remains at the current baseline.
- User documentation describes the editor-to-terminal-to-editor journey, the fact that credentials stay in
  `~/.wld/auth.json`, the selected default model is required for success, and Terminal Auth does not move the coding
  Session into the terminal.
- `docs/domain-language.md` defines Terminal Auth and its stable relationship to ACP Client capability negotiation,
  provider credentials, default model selection, and the RunWield Session.

## Approval Confirmation

No Work Record is proposed for supersession. The ACP audit and registry gap report remain useful; this Plan updates
their Terminal Auth finding instead of replacing those records.

## Verification Plan

- Automated focused tests:
  `deno run -A scripts/run-tests.js src/cmd/auth/index.test.ts src/cmd/__tests__/registry.test.js src/ui/tui/model-welcome.test.ts src/ui/tui/terminal-auth-setup.test.ts src/acp/protocol-smoke.test.js src/acp/server.test.js`.
  Use the final focused terminal-auth test path if discovery chooses a different focused filename.
- Automated registry proof: send the exact current ACP Registry initialize request through the real NDJSON server. The
  response must contain exactly one usable Terminal Auth descriptor and no non-JSON stdout. This test must fail if the
  implementation returns `authMethods: []`, advertises only a custom `_meta` value, or launches a normal TUI instead of
  ACP.
- Automated capability proof: current `clientCapabilities.auth.terminal`, the registry legacy marker, omitted
  capability, explicit false, and unrelated ACP terminal support produce the expected descriptor or empty list.
- Automated user-flow proof: under an isolated `HOME`, drive the real setup-only TUI through one API-key path and one
  scripted OAuth path, select a default model, observe exit `0`, then create a real ACP Session. The proof must fail if
  credentials are written but no model is selected or if `session/new` is replaced by a stub.
- Automated failure proof: cancel at authentication type, provider, OAuth, API-key, and model-selection prompts; test a
  provider failure and a whitespace-only API key. Each case exits nonzero, never reports ACP-ready, and does not persist
  partial invalid state.
- Automated no-Session proof: before and after login-only success and cancellation, assert that no RunWield Session
  transcript, manifest, catalog record, or Project registration was created. Add an import-boundary assertion that the
  setup-only entry path does not import normal chat composition or SessionRuntime. Also run a mutation proof in an
  isolated temporary source copy where `SessionRuntime.createInteractiveSession()` throws: terminal setup must still
  complete successfully. This mutation changes only the temporary copy and adds no production injection seam. A test
  that checks only the filesystem or absence of a model call is insufficient.
- Automated regression: preserve first-run setup order, `/login` post-login model selection, live-Session Router switch,
  normal `wld acp`, `wld --mode acp`, protocol-pure stdout, stable Session IDs, and current queued-prompt behavior.
- Automated architecture and full gates: run `deno task seams:check`, `deno task check`, `deno task ci`, and
  `deno task compile`.
- Manual ACP Client: with no usable model configured in an isolated user profile, configure the Client to run `wld acp`,
  start a Session, select RunWield login, complete provider and model setup in the launched terminal, and confirm the
  terminal closes and the Client creates the Session after reconnect. Repeat with cancellation and confirm the Client
  reports unsuccessful setup without starting a Session.
- Manual direct CLI: run `wld login`, complete setup, and confirm the command exits without opening chat. Run it again,
  cancel model selection, and confirm it exits nonzero with existing credentials left intact.
- Documentation: confirm the glossary, bundled RunWield skill, Quickstart, usage guide, ACP audit, and registry report
  all describe the same shipped behavior and do not claim that RunWield is already listed.

## Edge Cases & Considerations

- **Appended arguments:** ACP Terminal Auth appends `login` to the configured Agent invocation. Command routing must
  support both `wld login` and `wld acp login` without treating the latter as an ACP server process.
- **Capability skew:** the registry validator uses a legacy marker while current ACP uses `auth.terminal`. Support both
  narrowly and keep ordinary ACP terminal capability separate.
- **Existing credentials:** an explicit login-only invocation may reconfigure the provider or model. It must never erase
  a previously valid credential or default merely because the user cancels a later prompt.
- **Persisted Session models:** a loadable Session can carry a usable model even when the current global default
  differs. Do not turn every `session/load` failure into authentication required.
- **Environment-provider keys:** readiness checks must honor provider environment variables and configured Claude CLI
  aliases through the existing model registry; do not require an `auth.json` entry when another supported credential
  source is valid.
- **No Session side effects:** the repository invariant for an empty TUI Session is stronger here: setup-only mode must
  not create a Session at all, even after successful authentication.
- **Signal exit:** Ctrl+C or terminal close must release the TUI and return a nonzero status. It must not leave an ACP
  server or login promise running.
- **Scope boundary:** Registry metadata, icon creation, release publication, and the upstream pull request are not part
  of this Plan. Agent Auth, `authenticate`, ACP logout, and provider-token refresh during an active prompt remain out of
  scope.
