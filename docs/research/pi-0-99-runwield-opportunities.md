# Pi 0.99 opportunities for RunWield

## Question

Which Pi 0.99 capabilities could improve RunWield, and which need integration work rather than only a dependency
upgrade?

This is research, not an accepted PRD or implementation Plan. It compares the official 0.99.0 and 0.99.1 release notes
with the current dirty checkout and installed Pi 0.99.1. Source inspection does not prove live authentication, cost
savings, or user demand. No implementation changes or live provider requests were made for this research.

## Findings

### The upgrade is a foundation, not automatic feature adoption

[Pi 0.99.0](https://pi.dev/changelog/releases/0.99.0) adds codemode, tool search, built-in MCP integration, virtual
models, classifier integration, ChatGPT login, and richer tool contracts.
[Pi 0.99.1](https://pi.dev/changelog/releases/0.99.1) mainly adds model availability and fixes bundled OpenAI login
loading.

RunWield builds its own Agent tool set and resource loader. It does not wire the new codemode and tool-search built-ins.
Its TUI, Workspace, and ACP surfaces do not automatically inherit Pi's own interface changes. Sources:
[Session construction](../../src/shared/session/session.js), [Core PRD](../prd/runwield-core-prd.md),
[Pi MCP SDK documentation](https://pi.dev/docs/latest/mcp#sdk).

### 1. Complete the new ChatGPT login path

**User outcome:** A developer can use a ChatGPT subscription without finding an API key, while API-key users retain
their existing path.

Pi's new login requires a stable installation UUID through `getDeviceId`. RunWield calls `runtime.login()` without these
options. The installed OAuth implementation throws when the UUID is absent. Separately, RunWield's API-key picker
excludes all OAuth-capable providers; OpenAI now belongs to that set.

Sources: [RunWield login adapter](../../src/shared/models/model-registry.ts), `loginProvider`;
[provider picker](../../src/cmd/auth/index.ts), `getLoginProviderOptions`; installed
`pi-ai/dist/auth/oauth/openai-chatgpt.js`, `loginOpenAIChatGPT`;
[release notes](https://pi.dev/changelog/releases/0.99.0).

**Inference:** This is an immediate compatibility and onboarding opportunity, not a new authentication system. Preserve
existing Codex credentials and explicit model selections. The inspected code does not provide automatic migration to
OpenAI. Live login and packaged-binary checks remain necessary.

### 2. Make steering status more accurate

**User outcome:** A user can distinguish input handled by an extension from input queued for the Agent.

Pi now returns `handled` or `queued` from `steer()` and `followUp()`. RunWield's `steerAgentSessionWithPreparedInput`
discards that result. Its queue owner reconciles queue contents and reports `queued: true` after acceptance.

Sources: [Session steering](../../src/shared/session/session.js),
[queue owner](../../src/shared/session/runtime/queues.ts), installed `pi-coding-agent/dist/core/agent-session.d.ts`,
[release notes](https://pi.dev/changelog/releases/0.99.0).

**Inference:** Use the new signal to improve status truth across surfaces. It is not proof that the model later received
the input. Keep handoff protection and queue reconciliation. Do not expand this into new queue-persistence requirements.

### 3. Reduce unused tool context

**User outcome:** Large integrations do not fill each request with tools the Agent never uses.

RunWield adds every configured root MCP tool to the active tool set. It also generates its own available-tools prompt
and context estimate. Pi provides deferred tools and `tool_search`, which can declare matching tools on a later model
request.

Sources: [tool composition and prompt generation](../../src/shared/session/session.js),
[Pi tool exposure](https://pi.dev/docs/latest/extensions#tool-exposure),
[Pi MCP exposure](https://pi.dev/docs/latest/mcp#exposure).

**Recommendation:** Keep required workflow tools directly available. Defer large, optional integration catalogs first.
Account for both provider tool declarations and RunWield's prompt inventory when measuring savings.

**Trade-off:** Discovery can add a model round trip or miss a needed tool. Deferred tools remain callable while
registered, even when inactive. Exposure is not an Agent permission boundary.

### 4. Make research faster with read-only tool composition

**User outcome:** An Agent can search, inspect matching definitions, filter large results, and return useful evidence
with fewer model round trips.

Pi codemode runs JavaScript in QuickJS and can call tools in parallel. RunWield already has `code_batch`, but it handles
up to five known show/outline reads and excludes search. Codemode could extend that capability rather than replace a
feature that is absent.

Sources: [Cymbal tools](../../src/extensions/cymbal/tools.ts),
[Pi codemode](https://pi.dev/docs/latest/cli#how-codemode-works),
[extension tool contracts](https://pi.dev/docs/latest/extensions#tools).

**Recommendation:** Explore bounded read-only discovery first. For example: search for a symbol, inspect the relevant
definitions, and return only the evidence needed for planning.

**Conditions:**

- Keep lifecycle and interactive tools outside scripts. Pi's `model-only` exposure supports that separation.
- Preserve RunWield's tool and shell restrictions. QuickJS isolates script execution, not the side effects of tools it
  calls.
- Preserve child-call identity, failures, and useful replay. Current event adapters do not retain the full new
  nested-call contract.
- Keep direct-tool behavior for other Execution Backends. The CLI bridge currently rejects nested `executeTool` calls.
- Do not assume script failure undoes prior actions or that a nested workflow-ending call ends the outer Agent turn.

Sources: [runtime result normalization](../../src/shared/session/session-runtime-events.js),
[CLI bridge](../../src/shared/session/bridged-tools/mcp-bridge.ts), installed Pi `extensions/types.d.ts` and
`extensions/codemode/`.

### 5. Improve MCP result fidelity and reach remote services

**User outcome:** Agents can use structured integration results reliably, and users can connect a hosted MCP service
without a local proxy.

RunWield currently supports stdio MCP tools only. Discovery retains input schemas but not output schemas or annotations.
Results place `structuredContent` and `isError` inside `details`, rather than Pi's new top-level result contract.

Pi supports streamable HTTP, OAuth, dynamic tool lists, and structured tool results. These capabilities offer a route to
remote services and less text parsing.

Sources: [current MCP scope and trust rules](../mcp.md), [MCP client](../../src/shared/mcp/pool.ts),
[Pi MCP documentation](https://pi.dev/docs/latest/mcp).

**Recommendation:** Treat result fidelity and remote-service support as separate opportunities. Correct result/error
handling is useful even without codemode. Add HTTP/OAuth when a user names a service they need.

**Trade-off:** Pi's trust and storage conventions differ from RunWield's. Do not replace RunWield's untracked, ignored
project-config rule by accident. Preserve ACP input, stable tool aliases, and delegated Agent restrictions. Tool
annotations are unverified hints, not permission grants. This is MCP client work, not RunWield Connect.

### 6. Offer an opt-in automatic model policy

**User outcome:** A user selects a policy that balances quality, latency, and cost, rather than choosing a model for
every request.

Pi's experimental virtual models select a physical model and thinking level per request. Pi stores the virtual selection
separately from physical response identity. Routing state survives compaction and follows Session branches. RunWield
does not currently register virtual models, and its surfaces expose one active model/thinking pair.

Sources: [Pi virtual models](https://pi.dev/docs/latest/virtual-models),
[model registry](../../src/shared/models/model-registry.ts), [runtime reads](../../src/shared/session/runtime/reads.ts).

**Recommendation:** Keep explicit model selection as the default. Evaluate an opt-in policy against the existing
per-Agent presets. Prefer stable models through a tool cycle instead of switching on every request.

**Trade-offs:**

- Model switches lose prompt-cache reuse. Smaller-model savings are not guaranteed.
- A smaller context window can trigger compaction. Image support can differ.
- Classifier routing adds latency and can send request content to another provider.
- Users need to see both the selected policy and the model that answered.
- Count routing overhead, retries, and repair work when measuring cost.

Pi classifiers could advise model selection. They should not replace Router discovery or gain authority over Routing
Intent and Workflow Tool Events. In Connect, the External Agent Host continues to own every model call.

### 7. Make provider failures easier to diagnose

**User outcome:** Support can explain a malformed stream or tool call without asking a user to collect broad debug logs.

Pi adds `provider_stream_event` before response normalization. RunWield currently handles normalized streams and
provider failures but has no handler for this new event. Pi's event is nonpersistent; handlers are awaited and can delay
the stream.

Sources: [Pi provider stream event](https://pi.dev/docs/latest/extensions#provider_stream_event),
[RunWield provider errors](../../src/shared/session/provider-errors.ts),
[Session stream setup](../../src/shared/session/session.js).

**Recommendation:** Consider opt-in, bounded, redacted diagnostics. Keep ordinary user notices concise. This is not an
automatic retry policy or a reason to retain raw prompts indefinitely.

### Lower-priority possibilities

- **Image generation:** Pi's runtime-level authentication and catalogs can simplify future integration. Image generation
  itself was already investigated with Pi 0.84.2; it is not entirely new. The earlier proof still lacks successful
  credentialed OpenRouter and Google checks. Source: [provider proof](image-generation-provider-proof.md).
- **Terminal appearance and performance:** Pi adds a terminal-palette theme and upstream rendering improvements.
  RunWield has its own design system and rendering surfaces; verify which improvements actually carry over before
  promising them. Sources: [release notes](https://pi.dev/changelog/releases/0.99.0),
  [RunWield design system](../design-system.md).

## Recommendation

Separate compatibility work from product bets:

1. **Address login compatibility and steering truth first.** They affect existing user journeys.
2. **Prioritize tool efficiency next:** structured result fidelity, then deferred catalogs, then bounded read-only
   composition with inspectable child activity.
3. **Evaluate automatic model selection separately.** Compare it with current presets before claiming lower cost.
4. **Let demand select integrations.** A named HTTP MCP service is stronger evidence than transport availability alone.

Pi 0.99 does not itself deliver multiplayer planning or shared review. These opportunities support RunWield's planning
loop; they should not silently replace its product priorities.

## Open Questions

- How much request context is spent on tool inventories in representative RunWield Sessions?
- Does composed discovery reduce total latency and cost without reducing evidence quality?
- Which remote MCP service would a beta user use now?
- Can automatic model selection match current Plan and code-review outcomes at lower total cost?
- Do live ChatGPT login, API-key selection, and packaged startup pass after compatibility work?

The latest Pi documentation is a moving reference. Key tool-exposure, routing, and authentication constraints were
checked against the installed 0.99.1 package. Product benefits remain proposals until measured.
