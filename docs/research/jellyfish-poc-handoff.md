# Handoff: RunWield Metrics and Jellyfish PoC

## Resume Here

Continue as Ideator. Read this handoff, then [the research report](metrics-export-and-ai-impact.md) for source links and
code evidence. Do not repeat the initial interview or broad competitor search.

The next discussion is how to prepare our own small proof of concept and a customer demo. No implementation has been
authorized or started. The Pi-only PoC below is a recommendation, not an approved specification.

## User Goal and Clarifications

- A prospective team already uses Jellyfish. They would try RunWield, but need metrics there to compare it against their
  existing tools.
- Jellyfish is therefore the required destination. Swarmia or a separate dashboard does not satisfy this opportunity.
- The user does not want to depend on the prospect arranging a Jellyfish introduction. We should research the
  integration ourselves and bring them a concrete proposal.
- The user then asked how we could do our own PoC first and show the prospect a demo.
- The conversation paused for a restart. This handoff is not a request to start implementation.

## Work Completed

Created and registered [Metrics Export and AI Impact](metrics-export-and-ai-impact.md). It contains the current-source
audit, vendor evidence, competitors, and a proposed customer pilot. No production code changed. No tests ran. No data
was uploaded, no vendor account was created, and nobody was contacted.

No PRD, executable Plan, or runnable PoC exists from this conversation.

## Main Findings

### RunWield

- Opt-in, local-only JSONL records routing, planning, execution, validation, recovery, model selection, and tool usage.
  The user's global settings enable recording; a metrics file exists for this repository. Event contents were not
  audited.
- Tool metrics primarily cover Pi. Claude/Antigravity do not use the same subscriber path.
- Tokens and some cost information exist in Session records, outside workflow metrics. Missing costs can appear as zero;
  do not present them as measured zero spend.
- Publication records contain Plan/attempt/commit links, but are separate from metrics and can be pruned.
- Metrics lack consistent user/repository identity and links among calls, Sessions, Plans, attempts, and commits.
- Recording is best-effort. There is no reporting UI, CLI summary, or exporter.
- Installed WLD extensions load through Pi, not all execution backends. Extension-only collection is incomplete.
- The sanitizer redacts keys containing `token`, `output`, or `request`. Adding counters to ordinary metric details
  without a reviewed safe contract will not work.
- Local recording permission does not authorize remote export. No prompts, code, raw tool data, or conversations should
  leave the device for this PoC.

Primary source: `src/shared/workflow/metrics.js`. Further paths and line references are in the report.

### Jellyfish

- Public AI Impact tooling exposes adoption and delivery reports: per-tool usage dates, adoption groups, usage
  percentage, median PR/issue cycle time, and PR throughput.
- Its public MCP client performs GET requests against export endpoints. It is not an ingestion API.
- No supported generic custom-tool push API, CSV import, or public self-service sandbox was verified.
- The help center requires login; its documentation-aware MCP requires a Jellyfish API token.
- Jellyfish's Augment partnership explicitly gets telemetry from Augment's API. An integration could require Jellyfish
  to read a RunWield data source rather than a WLD plugin posting records. Neither direction is confirmed for RunWield.
- A WLD exporter is technically plausible, but native display in Jellyfish remains unproved.

Useful sources:

- https://jellyfish.co/platform/jellyfish-ai-impact/
- https://github.com/Jellyfish-AI/jellyfish-mcp/blob/main/server/api.js
- https://github.com/Jellyfish-AI/jellyfish-mcp/blob/main/server/tools.js
- https://jellyfish.co/blog/ai-impact-augment-code
- https://jellyfish.co/request-a-demo/

Competitor research is complete enough for now: Swarmia has a documented custom daily-usage API; DX supports custom SQL
tables; LinearB, Faros, and GitClear are other relevant comparisons. These are not substitutes for Jellyfish here.

## Latest Recommendation: Our Own PoC

Run two efforts in parallel, without relying on the prospective customer.

### Local data proof

Use RunWield's own development, one repository, and initially Pi because coverage is strongest. Include real work that:

- Passes validation immediately.
- Needs repair before publication.
- Is deliberately abandoned.

Show the chain:

```text
RunWield usage → Plan → validation and repair → confirmed published commit
```

A disposable exporter and simple report would show daily active use, per-change model/token usage, reliable cost where
available, validation attempts, outcome, and commit links. Missing data stays explicit. Repeated export must not inflate
counts. Do not build a general plugin platform or claim productivity gains from this small sample.

### Our own Jellyfish evaluation

Approach Jellyfish directly, not through the prospect. Suggested message:

> We build RunWield, an AI development tool. A prospective customer already uses Jellyfish. We want to demonstrate
> RunWield in AI Impact using real usage and commit-linked data. Can we obtain an evaluation environment and the
> supported integration requirements?

Only say the data is ready once it has actually been collected and checked. No outreach has happened yet.

### Demo acceptance

1. Complete a real change in RunWield.
2. Transfer its permitted metrics through a supported connection.
3. Open Jellyfish and show RunWield under the correct developer and period.
4. Show the supported delivery comparison using Jellyfish's existing Git/issue connections.
5. Repeat the transfer and show unchanged counts.

Without Jellyfish access, we can demonstrate collection and export only. A local report must not be presented as a
verified Jellyfish integration. Do not relabel RunWield as Claude or another supported tool to force compatibility.

## Remaining Decisions

- Confirm the bounded PoC scope; Pi-only was suggested, not accepted.
- Establish our own authorized Jellyfish access and supported custom-tool connection.
- Decide which reporting inputs that connection accepts before expanding collection or implementing vendor packaging.
- Obtain permission before exporting local records or contacting anyone.

If asked for a product specification, Ideator can write the PRD. `/agent planner` owns an executable Plan;
`/agent engineer` owns implementation. Do not turn this handoff into an unsubmitted Plan.

## Repository Caution

The working tree was already dirty. This conversation wrote only the research report and this handoff. Preserve all
other changes. No glossary or central PRD was changed. No new Memory was stored because the discussion has not reached
an accepted PRD or ADR; these documents hold the resumable context.
