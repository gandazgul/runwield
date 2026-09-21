# Supported AI Metrics and Governance Integrations

## Question

With Jellyfish set aside, which tools document a supported way to accept RunWield usage or enforce AI-use controls?

This is a documentation review, not a tested RunWield integration or an approved product specification. No accounts were
created, no data was exported, and no implementation was authorized. Jellyfish is outside the current discussion. This
note extends [the earlier metrics research](metrics-export-and-ai-impact.md). In particular, its DX finding is stronger
than the earlier report: DX documents a native custom AI metrics API, not only custom SQL tables.

## Findings

### Swarmia: native custom-tool adoption reporting

- Push daily usage to `POST https://app.swarmia.com/api/v1/ingest/ai-usage` with a Bearer token scoped to `aiUsage`.
- A new `aiService` identifier creates the tool. RunWield can appear under its own name.
- Supply user email, date, enabled status and active status. Optional data includes spend and model/token breakdowns.
- Reports show adoption and AI-tool filters. Optional details, including custom-tool spend, are stored but not yet
  visible in the app.
- Resending a tool/user/date replaces the previous values. Historical import is supported.
- Daily usage produces time-based, low-confidence PR attribution, not proof that RunWield produced a specific PR.
- Admin access and an organization API token are required. These docs do not establish a free evaluation account.

Sources: [API reference](https://help.swarmia.com/settings/integrations/swarmia-apis/additional-ai-integrations),
[custom-tool setup and limits](https://help.swarmia.com/settings/integrations/ai-coding-tool-integrations/custom-ai-tool-integrations).

### DX: native custom usage, token and cost reporting

- Push to `POST https://yourinstance.getdx.net/api/aiToolMetrics.push` with a Bearer token.
- Required data includes email, date, activity flag and tool name. Optional fields include token counts, spend in cents
  and custom JSON metrics. A DX Data Cloud instance is required.
- Native AI cost management explicitly supports imported custom-tool spend and tokens. Custom metrics are also queryable
  in Data Studio; arbitrary fields do not automatically become charts.
- Automatic usage-level groups require four full weeks of data and eight linked active users. A one-person PoC cannot
  demonstrate those groups. Custom tools use active days for these groups.
- The cost report does not show merged PRs or cost per PR when filtered to a subset of tools.
- The inspected push endpoint does not document duplicate handling. Confirm retry behavior and token permissions before
  building an exporter. Evaluation access and commercial terms remain unchecked.

Sources: [push API](https://docs.getdx.com/datacloudapi/methods/aitoolmetrics.push),
[cost reports](https://docs.getdx.com/reports/ai-cost-management/),
[usage groups](https://docs.getdx.com/reports/ai-usage-attributes/).

### Langfuse: detailed usage and workflow reporting

- Accepts custom OpenTelemetry traces over HTTP at `/api/public/otel/v1/traces`, using project-key Basic authentication.
  HTTP JSON and protobuf are supported; gRPC is not.
- Supports model usage, cost and user/Session metadata through documented attribute mappings.
- Cloud and self-hosted endpoints are documented. This supports an independent local evaluation route.
- The proposed RunWield export would omit prompts, code, tool payloads and other free text. Metadata-only collection
  must be deliberate; automatic instrumentation must not be assumed safe.
- This is reporting, not request-time budget enforcement or a ready-made comparison of developer delivery outcomes.

Source: [OpenTelemetry ingestion and mappings](https://langfuse.com/integrations/native/opentelemetry).

### LiteLLM Proxy: spending and model-access controls

- Applications send model requests through an OpenAI-compatible gateway, using virtual keys. The documented endpoint
  includes `/v1/chat/completions`.
- Virtual keys support budgets, rate limits and model access. The local quickstart includes the gateway and PostgreSQL.
- Budgets require a database. The documentation warns that a database-free deployment does not enforce them.
- This is not an after-the-fact metrics import. Enforcement requires actual requests to pass through the gateway.
- RunWield backend compatibility is not tested. External-host or subscription-backed calls must not be assumed to use
  the gateway. Direct-provider access can bypass its controls.
- The gateway processes request content. This is a different privacy choice from exporting only usage totals.

Sources: [gateway setup](https://docs.litellm.ai/docs/proxy/docker_quick_start),
[budget requirements](https://docs.litellm.ai/docs/proxy/users).

## Inference

There are three distinct product goals:

1. Compare RunWield adoption and delivery with other coding tools: Swarmia or DX.
2. Inspect RunWield model usage, costs and workflow activity: Langfuse.
3. Restrict model access and spending before allowing further calls: a gateway such as LiteLLM.

Reporting does not enforce controls. A model gateway does not govern every local tool action, approval or publication.
None of these products removes RunWield's existing collection gaps. Missing usage and cost must remain explicit;
subscription charges must not be inferred from token prices. Export requires separate permission, including permission
for developer identity. None of the reporting APIs requires prompts or code for a basic usage export.

## Recommendation

For a team-facing adoption proof, start with Swarmia: tool registration and safe repeated daily uploads are explicit.
Choose DX instead if visible spend is central and evaluation access is available. For a self-hosted technical demo,
Langfuse avoids dependence on a commercial analytics evaluation account, but demonstrates a different product outcome.
Do not add gateway enforcement merely to satisfy a reporting need.

## Open Questions

- Is the first goal adoption comparison, detailed usage reporting, or enforceable spending/model policy?
- Which commercial evaluation accounts can we obtain without a customer introduction?
- How does DX handle repeated daily imports?
- Which RunWield backends expose sufficient permitted data, or support gateway routing, for the chosen goal?
