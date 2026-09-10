# PRD: RunWield Session Host and ACP Integration

**Document role: Living central PRD.** Principles and lasting requirements for external ACP clients, protocol
compatibility, and chat-channel integration.

Keep this document as current product guidance. Fold lasting requirements from completed feature PRDs here;
implementation steps belong in Plans, architectural choices in ADRs, and delivery evidence in Work Records.

**Status:** Living roadmap — Session Host and ACP stdio MVP implemented; OpenAB/Telegram follows Personal Remote
Workspace\
**Author:** Gandazgul + RunWield Ideator\
**Last Updated:** 2026-07-22

---

## 1. Objective

Make RunWield usable from external clients through **Agent Client Protocol (ACP)** with the same conversations, Agent
behavior, and Plan workflows available in the TUI.

The delivery goals are:

1. **OpenAB/Telegram compatibility:** one trusted operator can complete and recover a RunWield workflow through
   Telegram, using OpenAB as a replaceable reference ACP client.
2. **Full ACP v1 compliance:** supported capabilities behave according to the protocol and interoperability claims are
   backed by evidence independently of Telegram.

Personal Workspace and ACP share the same user outcome: the owner can continue a saved Session from another screen
without closing an idle client. Neither channel introduces a separate conversation or approval model.

OpenAB is a practical validation host, not a permanent RunWield infrastructure commitment. A future SaaS deployment may
fork OpenAB or build a purpose-optimized integration layer if tenancy, throughput, operations, or channel UX require it.

## 2. Problem Statement

RunWield began as a TUI-first product. External-client support must prove more than sending a prompt: users need
progress, structured questions, browser Plan review, execution, validation, cancellation, and useful recovery after
interruption.

The [ACP implementation audit](../acp-implementation-details.md) records current capability coverage and remaining gaps.
Those gaps are delivery work, not permanent product restrictions.

OpenAB is the selected reference chat host because it connects chat channels to ACP. A RunWield-owned multi-channel
gateway is deferred until a demonstrated product need justifies it.

## 3. Product Decisions

- ACP is the external-client contract; clients should not need bespoke RunWield integrations for ordinary workflows.
- OpenAB is the first reference chat host and remains replaceable. Prefer generic upstream contributions; a passing,
  reviewed contribution branch plus an open PR is sufficient for the first proof.
- Stage 1 serves one trusted operator in Telegram with an explicit allowlist. Slack, Discord, team identity, and SaaS
  operations are later scope.
- Use standard or generic ACP interactions where supported. Unsupported interactions must be visible rather than
  silently answered.
- Plan review remains in the browser. Telegram delivers the link and reports feedback or approval outcomes.
- Telegram access and Shared Plan links have separate permissions. No account-linking system is required.
- External clients preserve RunWield's execution, worktree, validation, and recovery behavior.
- Interrupted work with uncertain effects requires an informed next action; loading a Session does not authorize blind
  repetition of commands.

## 4. Architectural References

- [Runtime and adapter boundaries](../adr/010-session-runtime-sibling-adapters-and-acp.md)
- [Session continuity](../adr/015-file-authoritative-session-bundles.md)
- [Protocol coverage and implementation details](../acp-implementation-details.md)

## 5. Product Surface

`wld acp` and `wld --mode acp` expose RunWield to ACP clients. The core experience includes Session creation and
loading, text and resource-link prompts, cancellation, closing, history replay, Agent and tool progress, usage, Plan
links, and structured questions when supported by the client. Compatibility documentation must clearly state the
capabilities actually available.

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
2. Start a new RunWield Session or reload the durable Session associated with the chat.
3. Receive streamed Agent messages, tool progress, relevant status, and actionable failure information.
4. Answer select, text, and approval interactions through generic ACP form elicitation rendered by OpenAB.
5. Receive the public Shared Plan URL in Telegram.
6. Submit Feedback or approve the Plan in Plannotator.
7. Resume the same Session after approval and execute the Plan in a RunWield-owned worktree.
8. Receive execution and Workflow Validation progress and the terminal outcome in Telegram.
9. Cancel a live turn and receive its settled final updates before the turn is considered available again.
10. Restart OpenAB or `wld acp`, reload the same durable session, and continue without losing settled conversation
    history.
11. Recover safely when the process fails during Plan execution.

### 6.3 ACP compatibility requirements

Stage 1 proves the reference journey through the shared Session experience. Protocol requirements include:

- The standard `sessionId` returned by `session/new` remains loadable after the `wld acp` process exits and maps to the
  same saved RunWield Session.
- `initialize` negotiates the supported protocol version instead of echoing unsupported versions.
- `usage_update.cost` uses the ACP cost object shape with cumulative USD Session cost. Exact context-capacity reporting
  remains separate work.
- ACP supports continuing the same saved Session used in TUI or Workspace. An idle open client does not prevent another
  client from continuing it. If work is currently running, the client reports that state without losing the user's
  input. Session storage and writer coordination follow ADR-015.
- Cancellation waits for Runtime settlement and final mapped updates before `session/prompt` returns `cancelled`.
- OpenAB advertises and handles generic ACP form elicitation for RunWield select, text, and approval interactions.
- Unsupported interaction capabilities fail visibly and safely rather than selecting a default.
- Plan review links remain useful as normal text even when a client ignores `_meta.runwield` enhancements.
- Black-box compatibility coverage exercises the actual ACP wire behavior OpenAB depends on.

`session/resume` is not required for this stage. Correct durable `session/load` behavior is the interoperability
requirement.

### 6.4 Recovery and retry requirement

After a process failure, the user can reopen saved history and see whether associated Plan work was interrupted.
RunWield preserves partial work and offers applicable actions such as inspect, continue, reset, reopen for review, hold,
or cancel. It explains uncertainty and requires the operator's choice before resuming interrupted execution whose
effects are unclear.

Continuing uses the current Plan and preserved work. It must not silently delete changes, repeat uncertain operations,
or submit a duplicate request. If the process handling a live question has stopped, explain that the question needs to
be retried. Exact continuation of an interrupted token, tool call, or command is outside this promise.

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

- An unauthorized Telegram user cannot start or mutate the configured RunWield Session.
- One authorized operator completes the required FEATURE journey from Telegram through a Verified Plan.
- At least one structured interaction is completed through OpenAB's generic elicitation support.
- Plannotator Feedback or approval resumes the waiting Session without Telegram account linking.
- Restarting OpenAB and `wld acp` between settled turns preserves the Telegram-to-session mapping and conversation.
- A forced interruption during execution produces operator-confirmed Plan Recovery and can continue to a safe terminal
  outcome without abandoning the preserved worktree or blindly replaying side effects.
- Live cancellation settles the Runtime turn and delivers final mapped updates before a new turn starts.
- RunWield remains usable by other conforming ACP clients without requiring OpenAB-specific behavior.
- The integration passes against a pinned OpenAB commit associated with an open upstream PR.

## 7. Stage 2 — Full ACP v1 Compliance

Full ACP v1 compliance covers every required behavior for the capabilities RunWield advertises, including stdio MCP
support, protocol negotiation, authentication, notifications, usage, and cancellation. Verify interoperability with more
than one ACP client and keep public claims aligned with evidence.

Current conformance evidence and unfinished checks belong in the
[implementation audit](../acp-implementation-details.md), not a second checklist here. Protocol hardening can proceed
independently of the Telegram proof.

Optional listing, deletion, configuration, additional roots, rich media, embedded resources, and client filesystem or
terminal delegation should be evaluated on user value. Compliance does not require advertising unsupported options.

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
| **A crash leaves ambiguous partial side effects.**                 | Preserve partial work, explain what is uncertain, and offer informed recovery choices without blind repetition.                                                                                  |
| **OpenAB's process-per-thread model may not scale efficiently.**   | Accept it for the single-operator proof; measure before adopting it for a hosted service. Preserve RunWield's multi-session Session Host for other clients.                                      |
| **Reference-client accommodations could leak into core.**          | Keep OpenAB-specific transport behavior outside RunWield; core changes must improve standard ACP or adapter-neutral Runtime semantics.                                                           |

## 10. Future Work Unlocked

- Validate Slack and Discord through the same OpenAB ACP core.
- Add richer IDE integrations through conforming ACP clients.
- Let the owner start, resume, or monitor the same Sessions across Workspace, ACP, and TUI.
- Evaluate a forked OpenAB deployment or RunWield-owned gateway for SaaS tenancy and scale.
- Add richer ACP session discovery, configuration, and workflow-specific presentation without weakening standard
  fallbacks.
- Run multiple chat-backed Hosted Sessions in one RunWield process when the chosen host can exploit that architecture.

## 11. References

- ACP implementation audit: `docs/acp-implementation-details.md`
- SessionRuntime architecture decision: `docs/adr/010-session-runtime-sibling-adapters-and-acp.md`
- File-backed Session continuity: `docs/adr/015-file-authoritative-session-bundles.md`
- SessionRuntime and ACP MVP Work Record: `docs/work-records/2026-07-17-sessionruntime-and-acp-v1-stdio-mvp.md`
- OpenAB: <https://github.com/openabdev/openab>
- ACP v1 extensibility: <https://agentclientprotocol.com/protocol/v1/extensibility>
- ACP elicitation RFD: <https://agentclientprotocol.com/rfds/elicitation>
