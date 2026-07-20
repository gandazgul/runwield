# PRD: RunWield Session Host and ACP Integration

**Status:** Living roadmap — Session Host and ACP stdio MVP implemented; OpenAB/Telegram validation next\
**Author:** Gandazgul + RunWield Ideator\
**Last Updated:** 2026-07-19

---

## 1. Objective

Make RunWield usable from external clients without coupling those clients to the TUI. The strategic integration contract
is **Agent Client Protocol (ACP)** in RunWield core, backed by a multi-session **Session Host** and an adapter-neutral
**SessionRuntime**.

The implemented foundation consists of:

- **Session Host:** live session state is owned by `SessionHost`/`HostedSession`, not process-wide TUI globals.
- **ACP stdio MVP:** `SessionRuntime` exposes the adapter-neutral session surface, and ACP is a sibling adapter to the
  TUI.

The next phase has two ordered stages:

1. **OpenAB/Telegram compatibility:** prove that one trusted operator can complete and recover a full RunWield workflow
   through Telegram, with OpenAB as a replaceable reference ACP client.
2. **Full ACP v1 compliance:** close the remaining protocol gaps independently of Telegram, including required stdio MCP
   server support and schema-based conformance testing.

OpenAB is a practical validation host, not a permanent RunWield infrastructure commitment. A future SaaS deployment may
fork OpenAB or build a purpose-optimized integration layer if tenancy, throughput, operations, or channel UX require it.

## 2. Problem Statement

RunWield originally behaved like a single interactive TUI session. Runtime concepts such as the root Agent Session,
active Agent, model state, and active execution workflow were stored in process-wide state. That blocked external
clients and concurrent Hosted Sessions. The Session Host and `SessionRuntime` refactors resolved that ownership problem,
and RunWield now ships a useful ACP stdio MVP.

Two product gaps remain:

1. **No external chat client has proven the complete workflow.** A standard client must be able to create or reload an
   Agent Session, stream progress, answer structured interactions, receive a shared Plan review URL, approve the Plan in
   the browser, continue through execution and Workflow Validation, cancel live work, and recover safely after a process
   failure.
2. **The ACP adapter is not yet fully conformant with ACP v1.** The audit in `docs/acp-implementation-details.md`
   identifies required wire, identity, cancellation, and MCP support gaps. Some must be fixed for OpenAB
   interoperability; others are protocol-wide work that should not block the first Telegram proof.

Building a RunWield-owned Telegram/Slack/Discord gateway now would duplicate channel credentials, authorization,
session/thread mapping, retries, rate limits, message splitting, interactions, cancellation, and daemon operations.
Takopi offers a mature Telegram experience, but its Runner boundary is narrower than RunWield's ACP interaction and
workflow semantics. OpenAB more closely matches the desired boundary:

```text
Chat platform -> thin ACP client -> RunWield ACP -> SessionRuntime -> RunWield workflow
```

## 3. Resolved Assumptions

| Decision                                                            | Rationale                                                                                                                                                                                        | State                                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| **ACP is the canonical external protocol**                          | IDEs, chat hosts, Workspace, and other clients should not require separate RunWield protocols.                                                                                                   | Implemented as an ACP stdio MVP; remains the strategic direction.                        |
| **SessionRuntime is the public live-session boundary**              | TUI and external adapters need the same semantic operations, events, and interactions without accessing Hosted Session internals.                                                                | Implemented; TUI and ACP are sibling adapters.                                           |
| **OpenAB is the first reference ACP chat host**                     | It already connects Telegram, Slack, Discord, and other platforms to ACP Agents over stdio without imposing another Plan Lifecycle or worktree system.                                           | Selected for Stage 1 validation.                                                         |
| **OpenAB remains replaceable**                                      | RunWield must stay host-agnostic, and SaaS-scale requirements may eventually justify a fork or a RunWield-owned gateway.                                                                         | Permanent fork and custom gateway are deferred.                                          |
| **Upstream contribution is preferred**                              | Generic ACP improvements benefit other Agents and avoid permanent RunWield-specific host maintenance.                                                                                            | An open upstream PR plus a passing pinned contribution branch is sufficient for Stage 1. |
| **Telegram is the only Stage 1 channel**                            | One complete vertical slice is more valuable than shallow Telegram, Slack, and Discord demonstrations.                                                                                           | Slack and Discord validation are deferred.                                               |
| **Stage 1 serves one trusted operator**                             | The concept proof should validate RunWield's ACP boundary, not prematurely design SaaS tenancy and identity.                                                                                     | One bot and an explicit Telegram user allowlist are required.                            |
| **Use generic ACP elicitation first**                               | RunWield already maps select, text, and approval interactions to the experimental `elicitation/create` form capability. Generic OpenAB support is more upstreamable than a RunWield-only method. | A namespaced RunWield interaction method is fallback-only.                               |
| **Plan review remains browser-based**                               | Plannotator and the shared Plan server already own rich Feedback and approval. Rebuilding artifact review in Telegram would create a second review product.                                      | Telegram delivers the public review URL and reports the result.                          |
| **Telegram authorization and Plan-link authorization are separate** | BotFather credentials and Telegram allowlists control bot access; the public Plan server uses its existing capability-link model.                                                                | No Telegram account linking or Plan-server identity system is required.                  |
| **RunWield owns execution worktrees**                               | External hosts must not impose branch or worktree lifecycle semantics over RunWield's Plan Lifecycle and recovery safeguards.                                                                    | OpenAB supplies cwd/workspace selection only.                                            |
| **Stage 1 proves the full lifecycle**                               | Planning-only validation would leave execution progress, approval resumption, worktree ownership, cancellation, validation, and recovery untested.                                               | One bounded end-to-end FEATURE workflow is required.                                     |
| **Plan Recovery is operator-confirmed**                             | A crash can leave uncertain filesystem, command, commit, validation, or merge side effects. Blind replay is unsafe.                                                                              | RunWield detects durable state and asks the operator how to proceed.                     |
| **ACP compliance is split into a second stage**                     | OpenAB does not require every ACP capability, while full v1 compliance includes materially broader work such as stdio MCP servers.                                                               | Stage 1 fixes compatibility blockers; Stage 2 closes the complete audit.                 |

## 4. Current Architecture

`SessionRuntime` is the public live-session boundary. Consumers use opaque runtime session IDs, runtime methods,
semantic events, and runtime interactions. They do not import `SessionHost`, `HostedSession`, root-session internals, or
TUI modules.

Current layers:

- **`SessionHost`** owns the in-process registry and lifecycle for one or more Hosted Sessions.
- **`HostedSession`** owns per-session state: project root, persisted root session manager, active Agent state, model
  and thinking state, interaction adapter, workflow context, active execution workflow, event sink, and active turn
  state.
- **`SessionRuntime`** owns adapter-neutral create, load, prompt, cancel, close, replay, snapshots, workflow actions,
  events, and interactions.
- **TUI adapter** renders runtime events and translates terminal input into runtime actions.
- **ACP adapter** maps ACP JSON-RPC requests to `SessionRuntime` and maps runtime events and interactions back to ACP.

The Stage 1 reference deployment adds replaceable infrastructure outside RunWield core:

```text
Private Telegram chat
    -> OpenAB Telegram adapter and user allowlist
    -> OpenAB ACP client
    -> wld acp over stdio
    -> ACP adapter
    -> SessionRuntime
    -> RunWield Agent Session and Plan Lifecycle

Plan review message
    -> public Shared Plan URL
    -> Plannotator in the operator's browser
    -> Feedback or approval
    -> waiting RunWield Agent Session resumes
```

The Telegram webhook and public Shared Plan server may share a reverse proxy, but they remain independent services with
separate credentials and authorization boundaries.

This architecture follows `docs/adr/010-session-runtime-sibling-adapters-and-acp.md`.

## 5. Implemented Foundation

### 5.1 Session Host and SessionRuntime

Implemented outcomes include:

- multiple isolated Hosted Sessions in one process;
- project-root isolation and persisted root Agent Session ownership;
- per-session Agent, model, thinking, interaction, event, and workflow state;
- adapter-neutral prompting, cancellation, replay, snapshots, and workflow actions;
- TUI and ACP as sibling consumers of the same runtime contract;
- boundary tests preventing adapters from reaching into runtime internals.

Sources of record:

- `src/shared/session/session-host.js`
- `src/shared/session/hosted-session.js`
- `src/shared/session/session-runtime.js`
- `docs/work-records/2026-07-17-session-host-multi-session-refactor.md`
- `docs/work-records/2026-07-17-unified-tui-and-acp-behind-sessionruntime.md`

### 5.2 ACP stdio MVP

RunWield currently exposes `wld acp` and `wld --mode acp` as ACP JSON-RPC over stdio. The implemented core path
includes:

- `initialize`;
- `session/new`;
- `session/load` with persisted-session replay;
- `session/prompt` for text and resource links;
- `session/cancel`;
- `session/close`;
- mapped assistant, thinking, tool, usage, status, replay, and Plan-link updates;
- form elicitation when the client advertises the experimental capability;
- protocol-pure stdout with diagnostics on stderr.

This is an **ACP v1 MVP**, not yet a fully conformant ACP v1 Agent. The precise audit and gaps are documented in
`docs/acp-implementation-details.md`.

## 6. Stage 1 — OpenAB/Telegram End-to-End Compatibility

### 6.1 Target user and environment

Stage 1 targets one trusted operator using:

- one Telegram bot created through BotFather;
- one private Telegram conversation;
- an explicit Telegram user allowlist;
- one configured RunWield project repository;
- OpenAB's unified service with public HTTPS webhook ingress;
- an independently reachable Shared Plan server;
- a pinned OpenAB release or contribution commit.

A development tunnel is acceptable for concept validation. Production tenancy, account linking, billing, and
availability guarantees are not required.

### 6.2 Required user journey

Stage 1 is complete only when the operator can:

1. Submit a bounded FEATURE User Request in Telegram.
2. Start a new RunWield Agent Session or reload the durable Agent Session associated with the chat.
3. Receive streamed Agent messages, tool progress, relevant status, and actionable failure information.
4. Answer select, text, and approval interactions through generic ACP form elicitation rendered by OpenAB.
5. Receive the public Shared Plan URL in Telegram.
6. Submit Feedback or approve the Plan in Plannotator.
7. Resume the same Agent Session after approval and execute the Plan in a RunWield-owned worktree.
8. Receive execution and Workflow Validation progress and the terminal outcome in Telegram.
9. Cancel a live turn and receive its settled final updates before the turn is considered available again.
10. Restart OpenAB or `wld acp`, reload the same durable session, and continue without losing settled conversation
    history.
11. Recover safely when the process fails during Plan execution.

### 6.3 ACP compatibility requirements

Stage 1 fixes the ACP gaps that affect the reference journey:

- The standard `sessionId` returned by `session/new` remains loadable after the `wld acp` process exits. Runtime session
  identity may remain separate internally.
- `initialize` negotiates the supported protocol version instead of echoing unsupported versions.
- `usage_update.cost` uses the ACP cost object shape, and context capacity is not knowingly misreported.
- Cancellation waits for Runtime settlement and final mapped updates before `session/prompt` returns `cancelled`.
- OpenAB advertises and handles generic ACP form elicitation for RunWield select, text, and approval interactions.
- Unsupported interaction capabilities fail visibly and safely rather than selecting a default.
- Plan review links remain useful as normal text even when a client ignores `_meta.runwield` enhancements.
- Black-box compatibility coverage exercises the actual ACP wire behavior OpenAB depends on.

`session/resume` is not required for this stage. Correct durable `session/load` behavior is the interoperability
requirement.

### 6.4 Plan Recovery requirement

Reloading an Agent Session is not sufficient when a process failed during execution. `activeExecutionWorkflow` is live
Hosted Session state, while Plan status, execution baseline, and worktree identity provide the durable recovery
evidence. Stage 1 must bridge that gap through **Plan Recovery**.

After reloading a session associated with an In-Progress Plan, RunWield must:

- detect the interrupted Plan and any recorded worktree state;
- reconstruct enough durable context to inspect the current state safely;
- notify the Telegram operator that execution was interrupted;
- offer applicable recovery choices through elicitation, including inspect, continue, reset, reopen for review, put on
  hold, abandon, or cancel;
- require an explicit operator decision before new execution proceeds;
- start a new Engineer turn from the preserved Plan and worktree when continuation is selected;
- avoid repeating completed lifecycle transitions, validation, merge-back, or cleanup;
- preserve uncertain work for inspection rather than silently deleting or replaying it.

Stage 1 does **not** promise transparent continuation at the exact interrupted token, model request, command, or tool
call. Exactly-once replay of arbitrary side effects is neither safe nor implied by ACP session loading.

### 6.5 OpenAB contribution policy

Required OpenAB changes should be proposed upstream and designed generically where possible. Stage 1 does not depend on
maintainer merge timing. Completion requires:

- an upstream PR for the required generic compatibility work;
- a passing integration pinned to a reviewed OpenAB contribution branch or commit;
- no permanent RunWield-maintained fork;
- a documented tested OpenAB version or commit.

OpenAB's current permission-request behavior is a broader security concern because it can automatically select
permissive responses. RunWield currently emits no ACP `session/request_permission` requests; its workflow interactions
use elicitation instead. Stage 1 must verify that the reference flow never enters the automatic permission path and must
not claim safe general permission brokerage. Interactive, deny-by-default permission handling should be offered upstream
separately and becomes a blocker if RunWield begins emitting standard ACP permission requests.

### 6.6 Stage 1 acceptance criteria

- An unauthorized Telegram user cannot start or control the configured RunWield Agent Session.
- One authorized operator completes the required FEATURE journey from Telegram through a Verified Plan.
- At least one structured interaction is completed through OpenAB's generic elicitation support.
- Plannotator Feedback or approval resumes the waiting Agent Session without Telegram account linking.
- Restarting OpenAB and `wld acp` between settled turns preserves the Telegram-to-session mapping and conversation.
- A forced interruption during execution produces operator-confirmed Plan Recovery and can continue to a safe terminal
  outcome without abandoning the preserved worktree.
- Live cancellation settles the Runtime turn and delivers final mapped updates before a new turn starts.
- RunWield remains usable by other conforming ACP clients without requiring OpenAB-specific behavior.
- The integration passes against a pinned OpenAB commit associated with an open upstream PR.

## 7. Stage 2 — Full ACP v1 Compliance

After the Telegram proof, close all remaining required ACP v1 gaps against the pinned protocol and SDK baseline. Stage 2
includes:

- required stdio MCP server support in session lifecycle requests;
- schema-valid messages for all advertised stable capabilities;
- a black-box conformance suite against the official ACP v1 schema;
- complete resolution of remaining required findings in `docs/acp-implementation-details.md`;
- accurate public capability and conformance claims;
- interoperability checks with more than one ACP client.

Optional capabilities such as session listing, deletion, configuration options, additional roots, rich media, embedded
resources, client filesystem/terminal delegation, and richer standard updates should be evaluated independently. Full v1
compliance does not require advertising optional capabilities RunWield does not support.

## 8. Out of Scope for Stage 1

- Slack or Discord validation.
- Multiple Telegram users, groups, topics, or concurrent project routing.
- SaaS tenancy, account linking, billing, quotas, audit administration, or availability guarantees.
- A RunWield-owned multi-platform chat gateway.
- A permanent private OpenAB fork.
- Native Telegram transport in RunWield core.
- OpenAB-owned branches or worktrees for RunWield execution.
- Telegram-native Plan editing, Feedback, or approval that replaces Plannotator.
- Full RunWield slash/CLI command parity in Telegram.
- Media and attachment parity beyond what the validated ACP prompt path supports.
- Transparent replay of an interrupted model request, command, or tool side effect.
- Full ACP v1 compliance or stdio MCP server support before Stage 2.
- Workspace UI session-adapter work.

## 9. Risks and Guardrails

| Risk                                                               | Guardrail                                                                                                                                                                                        |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **OpenAB is pre-1.0 and may change quickly.**                      | Pin the passing version or commit and maintain black-box compatibility coverage.                                                                                                                 |
| **Experimental ACP elicitation may evolve.**                       | Negotiate the capability, pin the tested ACP/SDK baseline, and isolate changes in the interaction adapters. Use a namespaced RunWield extension only if generic elicitation proves insufficient. |
| **Public Telegram webhook ingress expands attack surface.**        | Validate webhook authenticity, use explicit Telegram allowlists, and expose only the required route through HTTPS.                                                                               |
| **Shared Plan URLs can be forwarded.**                             | Treat them as capability links under the Shared Plan server's existing authorization and expiry policy; do not conflate them with Telegram identity.                                             |
| **Automatic ACP permission approval could authorize unsafe work.** | Confirm RunWield emits no permission requests in Stage 1, document the limitation, and pursue deny-by-default upstream handling before relying on the method.                                    |
| **A crash leaves ambiguous partial side effects.**                 | Use operator-confirmed Plan Recovery from durable Plan/worktree state; never auto-replay uncertain operations.                                                                                   |
| **OpenAB's process-per-thread model may not scale efficiently.**   | Accept it for the single-operator proof; measure before adopting it for a hosted service. Preserve RunWield's multi-session Session Host for other clients.                                      |
| **Reference-client accommodations could leak into core.**          | Keep OpenAB-specific transport behavior outside RunWield; core changes must improve standard ACP or adapter-neutral Runtime semantics.                                                           |

## 10. Future Work Unlocked

- Validate Slack and Discord through the same OpenAB ACP core.
- Add richer IDE integrations through conforming ACP clients.
- Let Workspace start, resume, or monitor Agent Sessions through `SessionRuntime`.
- Evaluate a forked OpenAB deployment or RunWield-owned gateway for SaaS tenancy and scale.
- Add richer ACP session discovery, configuration, and workflow-specific presentation without weakening standard
  fallbacks.
- Run multiple chat-backed Hosted Sessions in one RunWield process when the chosen host can exploit that architecture.

## 11. References

- ACP implementation audit: `docs/acp-implementation-details.md`
- SessionRuntime architecture decision: `docs/adr/010-session-runtime-sibling-adapters-and-acp.md`
- SessionRuntime and ACP MVP Work Record: `docs/work-records/2026-07-17-sessionruntime-and-acp-v1-stdio-mvp.md`
- OpenAB: <https://github.com/openabdev/openab>
- ACP v1 extensibility: <https://agentclientprotocol.com/protocol/v1/extensibility>
- ACP elicitation RFD: <https://agentclientprotocol.com/rfds/elicitation>
