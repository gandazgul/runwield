# Manual QA for agy-cli-execution-backend

This checklist is advisory. It does not change RunWield verification status.

<!-- runwield:manual-qa:start child="agy-cli-execution-backend/01-prove-agy-custom-agent-execution-spike" -->

## Prove Agy Custom Agent Execution Spike

Manual verification steps for agy-cli-execution-backend/01-prove-agy-custom-agent-execution-spike

- [ ] Approve and run the live proof with an explicit unique `runwield-spike-*` agent name and the installed,
      authenticated `agy` CLI.
- [ ] Confirm `/agents` lists the exact temporary agent name.
- [ ] Confirm the user argument contains the User marker and does not contain the Agent marker or Agent Definition text.
- [ ] Confirm the raw terminal result and parsed final text equal the Agent marker, differ from the User marker, and the
      command exits successfully.
- [ ] Confirm cleanup removes the temporary agent file and directory after the proof.

<!-- runwield:manual-qa:end child="agy-cli-execution-backend/01-prove-agy-custom-agent-execution-spike" -->

<!-- runwield:manual-qa:start child="agy-cli-execution-backend/02-register-agy-cli-backend-models" -->

## Register Agy CLI Backend Models

Manual verification steps for agy-cli-execution-backend/02-register-agy-cli-backend-models

- [ ] In a disposable project with a working Pi model, enter `/model agy-cli/<installed-model-id>` and confirm the
      current model stays unchanged, the deferred message appears, and the Antigravity reference is saved as the
      default.
- [ ] Open `/login api-key` and `/status` and confirm that Antigravity is not shown as an API provider.
- [ ] Check model completion and picker data and confirm that no built-in `agy-cli` model appears, while a direct
      `agy-cli/<model-id>` reference remains accepted.
- [ ] Confirm that no `agy` process starts during these checks and that Antigravity is not routed through Pi.

<!-- runwield:manual-qa:end child="agy-cli-execution-backend/02-register-agy-cli-backend-models" -->

<!-- runwield:manual-qa:start child="agy-cli-execution-backend/03-add-agy-cli-backend-transcript-tracer-bullet" -->

## Add Agy CLI Backend Transcript Tracer Bullet

Manual verification steps for agy-cli-execution-backend/03-add-agy-cli-backend-transcript-tracer-bullet

- [ ] Select a valid `agy-cli/<model-id>` and run two text turns. Confirm that the second response uses the first
      response as conversation history.
- [ ] Confirm that RunWield shows the normal Agent Display Name, the selected model appears in Agy init data, and no
      approval prompt appears.
- [ ] Replace or close the Agent Session. Confirm that the owned `~/.gemini/config/agents/runwield-*` path is removed.
- [ ] Close and reopen RunWield without starting Agy. Replay the Session and confirm that both assistant responses
      remain visible.
- [ ] Ask the Agy-backed Agent to complete a workflow. Confirm that it reports lifecycle completion is unavailable and
      that workflow state does not change.
- [ ] Check `docs/domain-language.md`. Confirm that it describes the Agy execution path without claiming MCP, image,
      steering, or failure-hardening parity.

<!-- runwield:manual-qa:end child="agy-cli-execution-backend/03-add-agy-cli-backend-transcript-tracer-bullet" -->

<!-- runwield:manual-qa:start child="agy-cli-execution-backend/04-bridge-agy-workflow-signals-through-mcp" -->

## Bridge Agy Workflow Signals Through MCP

Manual verification steps for agy-cli-execution-backend/04-bridge-agy-workflow-signals-through-mcp

- [ ] Approve setup with sandbox global Antigravity files. Confirm `agy mcp list` shows the `runwield` stdio server and
      unrelated entries remain unchanged.
- [ ] Inspect both global files. Confirm they contain no turn URL, bearer token, Session ID, or model data. Confirm the
      workspace-only MCP file is not used as setup proof.
- [ ] Run controlled Agy Planner, execution-owner, and Semantic Reviewer turns. Confirm each calls its eligible
      `runwield_` tool and advances only after the accepted structured result.
- [ ] Submit prose or rejected tool-call lookalikes during a controlled turn. Confirm they do not change workflow state
      or create a completion result.
- [ ] After each turn, confirm global setup is unchanged and no stdio bridge process or loopback listener remains.

<!-- runwield:manual-qa:end child="agy-cli-execution-backend/04-bridge-agy-workflow-signals-through-mcp" -->

<!-- runwield:manual-qa:start child="agy-cli-execution-backend/05-harden-agy-cli-failures-and-continuations" -->

## Harden Agy CLI Failures and Continuations

Manual verification steps for agy-cli-execution-backend/05-harden-agy-cli-failures-and-continuations

- [ ] Run an ordinary Agy Guide turn and confirm the command uses `--print-timeout 24h` and the verified assistant text
      remains after replay.
- [ ] Run an active workflow turn without a lifecycle call and confirm the workflow remains waiting; then accept one
      lifecycle call and confirm it advances exactly once.
- [ ] Press Escape during a live Agy turn and confirm Agy, its descendants, the MCP adapter, and the bridge stop without
      changing workflow state.
- [ ] Run unauthenticated and denied-action cases and confirm the UI shows bounded sign-in or permission guidance
      without raw secrets, paths, URLs, environment data, or temporary Agent selectors.

<!-- runwield:manual-qa:end child="agy-cli-execution-backend/05-harden-agy-cli-failures-and-continuations" -->

<!-- runwield:manual-qa:start child="agy-cli-execution-backend/06-surface-agy-cli-selection-and-caveats" -->

## Surface Agy CLI Selection and Caveats

Manual verification steps for agy-cli-execution-backend/06-surface-agy-cli-selection-and-caveats

- [ ] Start without a RunWield API provider, choose **Use Antigravity CLI**, and verify that only Gemini 3.8 Flash and
      Gemini 3.1 Pro appear; verify that setup does not request a RunWield API key.
- [ ] With authenticated Agy, run Flash and Pro sessions at the thinking-level boundaries and verify the original
      RunWield thinking remains visible while Agy uses the expected low, medium, or high concrete model.
- [ ] On first Agy use, verify that selection alone does not create persistent MCP files; confirm that separate setup
      approval is requested, and that declining it starts no turn.
- [ ] Open the linked Agy Session fixture at desktop and narrow widths, and verify the committed model, thinking level,
      **Execution Backend: Antigravity CLI**, and replay notice; stage a model or thinking change and verify that
      committed sidebar values do not change before application.
- [ ] Verify keyboard access, readable notice wrapping, existing focus styles, and no browser console errors in the
      Workspace Session view.

<!-- runwield:manual-qa:end child="agy-cli-execution-backend/06-surface-agy-cli-selection-and-caveats" -->
