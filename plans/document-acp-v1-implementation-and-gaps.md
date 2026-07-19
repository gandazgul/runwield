---
classification: "FEATURE"
complexity: "LOW"
summary: "Document RunWield's ACP v1 implementation, assess conformance against the current stable specification, and identify required and optional gaps."
affectedPaths:
    - "docs/acp-implementation-details.md"
    - "docs/index.md"
frontend: false
createdAt: "2026-07-19T09:26:10-04:00"
updatedAt: "2026-07-19T13:51:33.142Z"
status: "verified"
origin: "internal"
implementedAt: "2026-07-19T13:44:38.285Z"
verifiedAt: "2026-07-19T13:51:33.142Z"
executionReport: "- Added `docs/acp-implementation-details.md` with ACP v1 audit baseline, current stdio/SessionRuntime implementation details, method/capability/event/interaction mappings, and prioritized required vs optional gaps.\n- Updated `docs/index.md` to link the new ACP reference under RunWield reference docs.\n- Key documented verdict: RunWield is an ACP v1 stdio MVP, not fully v1-conformant; required gaps include version negotiation, reloadable session ids, stdio MCP server support, cancellation settlement ordering, and `usage_update.cost` shape.\n- Verified docs formatting with `deno fmt --check docs/acp-implementation-details.md docs/index.md`.\n- Verified full repository with `deno task ci` (passed; only expected warnings about missing `.env`, chunk size, and package/build-script notices)."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
routingIntent: "FEATURE"
---

# Document ACP v1 Implementation and Gaps

## Context

RunWield ships an ACP stdio adapter through `wld acp` and `wld --mode acp`, backed by the adapter-neutral
`SessionRuntime`. Existing PRDs and Work Records accurately call this an ACP v1 MVP, but the repository has no focused
reference that explains the wire behavior or distinguishes stable v1 conformance failures from optional protocol and
RunWield product gaps.

The audit is against the current stable ACP v1 documentation as of 2026-07-19 and the repository's pinned
`@agentclientprotocol/sdk` 1.2.1 schema. Current evidence shows that RunWield implements the baseline session methods
but is not fully v1-conformant: unsupported protocol versions are echoed, `session/new` returns an ACP id that is not
the persisted id expected by `session/load`, non-empty stdio MCP server configurations are rejected, cancellation may
return before the underlying turn and final updates settle, and `usage_update.cost` has the wrong wire shape. These must
be separated from optional capabilities that RunWield simply does not advertise.

## Objective

Create a source-backed ACP implementation reference under `docs/` that:

- gives a direct “not fully v1-conformant” verdict with the audit date and comparison baseline;
- documents RunWield's transport, architecture, capabilities, methods, session identities, prompt conversion, event
  mapping, interactions, errors, concurrency, and shutdown behavior;
- classifies gaps as required v1 conformance issues, advertised-capability correctness issues, optional stable v1
  coverage, experimental extensions, or RunWield workflow/product parity;
- cites the official ACP v1 pages and points each implementation claim to the relevant repository source or test; and
- is discoverable from the documentation index.

## Approach

Write `docs/acp-implementation-details.md` as an implementation/audit reference rather than a roadmap or replacement for
the Session Host PRD. Begin with scope, audit baseline, and verdict, then document the implemented vertical slice from
CLI entry point through `SessionRuntime`, ACP session mapping, notifications, and interactions. Use concise matrices for
method/capability coverage, Runtime-event mapping, prompt content, and gaps.

Treat ACP v1 as a capability-negotiated protocol: missing optional methods are coverage gaps, not conformance failures,
when RunWield does not advertise them. Reserve “required” findings for normative v1 violations or invalid emitted wire
shapes. Label `elicitation/create` as an unstable SDK/RFD extension, and label `_meta.runwield` fields as namespaced
extensions. Keep future implementation recommendations brief and prioritized; do not modify the current PRDs or ADRs.

Primary protocol sources:

- `https://agentclientprotocol.com/protocol/v1/overview`
- `https://agentclientprotocol.com/protocol/v1/initialization`
- `https://agentclientprotocol.com/protocol/v1/session-setup`
- `https://agentclientprotocol.com/protocol/v1/prompt-turn`
- `https://agentclientprotocol.com/protocol/v1/schema`
- `https://agentclientprotocol.com/protocol/v1/transports`
- `https://agentclientprotocol.com/protocol/v1/content`
- `https://agentclientprotocol.com/protocol/v1/tool-calls`
- `https://agentclientprotocol.com/protocol/v1/extensibility`
- `https://agentclientprotocol.com/rfds/elicitation`

## Files to Modify

- `docs/acp-implementation-details.md` — add the ACP architecture, wire-contract reference, conformance verdict,
  evidence, and prioritized gap inventory.
- `docs/index.md` — add the new reference under “RunWield reference” with a one-line description.

## Reuse Opportunities

- `docs/prd/runwield-acp-session-host-PRD.md` — reuse the established Session Host/SessionRuntime/ACP roadmap language,
  while keeping this document focused on current implementation facts.
- `docs/adr/010-session-runtime-sibling-adapters-and-acp.md` — reuse the accepted sibling-adapter boundary and identity
  separation rationale.
- `docs/work-records/2026-07-17-sessionruntime-and-acp-v1-stdio-mvp.md` — cite the delivered MVP scope and deferred rich
  workflow UX.
- `src/acp/server.js` — source of truth for initialization, methods, validation, cancellation, close, errors, and
  capability declarations.
- `src/acp/session-map.js` — source of truth for ACP/runtime identity mapping and active-prompt cancellation records.
- `src/acp/event-mapper.js` — source of truth for `session/update` wire mappings and unsupported Runtime events.
- `src/acp/interaction-mapper.js` — source of truth for unstable form elicitation and remote Plan review behavior.
- `src/acp/server.test.js`, `src/acp/session-map.test.js`, and `src/acp/protocol-smoke.test.js` — reuse tested behavior
  as implementation evidence and state the limits of current coverage.

## Implementation Steps

- [ ] Create `docs/acp-implementation-details.md` with an audit header that records the 2026-07-19 review date, official
      stable ACP v1 pages, SDK 1.2.1, review scope, and the verdict that RunWield is an ACP v1 MVP but not yet fully
      conformant.
- [ ] Document the architecture and transport path: `wld acp`/`wld --mode acp`, UTF-8 newline-delimited JSON-RPC over
      stdio, protocol-only stdout, stderr diagnostics, ACP as a sibling adapter over `SessionRuntime`, and cleanup when
      the connection closes.
- [ ] Add an initialization/capability table showing the exact advertised standard capabilities (`loadSession`, baseline
      text/resource-link prompting, `sessionCapabilities.close`, no auth) separately from `_meta.runwield` capability
      details and client capabilities consumed by the adapter.
- [ ] Add a stable method matrix for `initialize`, `session/new`, `session/load`, `session/prompt`, `session/cancel`,
      and `session/close`, plus unsupported optional stable methods. For each method, state request validation, Runtime
      call, response/update behavior, advertised status, and source location. Do not count unadvertised optional methods
      as baseline violations.
- [ ] Explain the three identities—transport-facing ACP session id, opaque live Runtime session id, and persisted
      SessionManager id—and explicitly show why the current `acp-<runtime-id>` returned by `session/new` is not reliably
      reloadable through standard `session/load` without the nonstandard persisted id in `_meta.runwield`.
- [ ] Add prompt-content and event-mapping tables. Record text and lossy `resource_link` conversion, unsupported richer
      prompt content, message/thought/tool/status/usage/review-link mappings, ignored Runtime state events, stable IDs,
      tool result structure, and current stop-reason collapsing.
- [ ] Document interaction behavior: unstable capability-gated form `elicitation/create` for select/text/approval,
      unsupported fallback behavior, remote Plan sharing for Plan review, and the lack of stable ACP-native Feedback or
      approval parity. Clearly distinguish experimental ACP extension behavior from stable v1.
- [ ] Add a prioritized gap table with classification, normative basis, current evidence, interoperability impact, and
      likely remediation seam. Required/high-priority findings must include protocol-version negotiation, reloadable
      session identity, required stdio MCP server support, cancellation settlement/update ordering, and valid
      `usage_update` cost/context semantics. Include stop-reason fidelity and real `agentInfo.version` as conditional or
      SHOULD-level quality findings.
- [ ] Add separate optional-coverage sections for session list/resume/delete, config options/modes, additional
      directories, richer prompt blocks, standard Plan and slash-command updates, client filesystem/terminal use, and
      richer tool locations/diffs. Keep provider/NES/fork APIs labeled unstable or outside the stable-v1 comparison
      where appropriate.
- [ ] Summarize current automated coverage and explicitly note that passing repository ACP tests proves current MVP
      behavior, not official v1 conformance; recommend future schema/black-box conformance fixtures without expanding
      this documentation task into code changes.
- [ ] Add the new page to `docs/index.md`, check every source path and external link, and ensure terminology follows
      `CONTEXT.md` (`Agent Client Protocol`, `SessionRuntime`, `Session Host`, `Agent Session`, and `Plan`).

## Verification Plan

- Automated: run `deno fmt docs/acp-implementation-details.md docs/index.md`.
- Manual: verify every implemented-method and event-mapping row against `src/acp/`, every Runtime claim against
  `src/shared/session/session-runtime.js`, and every normative claim against the cited official ACP v1 page.
- Manual: confirm the document clearly answers “Is RunWield up to ACP v1?” before presenting implementation details and
  does not conflate optional unadvertised capabilities with protocol violations.
- Manual: confirm `docs/index.md` links to the new document and all repository-relative links resolve.
- Expected: the final document provides enough detail for an engineer to reproduce the current wire behavior and scope a
  later conformance-fix Plan without reopening this audit.

## Edge Cases & Considerations

- ACP v1 gains non-breaking optional capabilities over time. Pin the audit date and SDK version so later additions do
  not silently make the verdict stale.
- The working tree already contains unrelated edits to ACP PRDs and other files. Execution must not overwrite or
  reformat those files; this Plan only writes the new reference and its index entry.
- Avoid claiming that all methods present in the SDK are stable v1 requirements. The SDK includes explicitly unstable
  provider, NES, fork, and elicitation surfaces.
- `resource_link` is baseline content but RunWield flattens it into text. Describe this as lossy support and an
  interoperability limitation unless a stricter normative conclusion is backed by the official schema.
- `usage_update.used` and `size` need semantic as well as structural review: the current fallback sets size to used when
  no context window is available, which may misstate total capacity even after fixing the cost object shape.
- No implementation fixes, tests, PRD edits, ADR edits, or new conformance claims are in scope for this documentation
  Plan.
