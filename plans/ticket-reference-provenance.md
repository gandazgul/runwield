---
planId: "b1f73d48-320a-4451-bd59-b4f9a0b266fe"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Add provider-agnostic Ticket References to Plans, surface them in Workspace, and preserve them through standalone and Epic Work Records."
affectedPaths:
    - "PRD.md"
    - "docs/prd/work-records-prd.md"
    - "docs/design-system.md"
    - "src/shared/ticket-references.js"
    - "src/plan-front-matter.js"
    - "src/plan-store.js"
    - "src/agent-definitions/document-formats/planner-plan-format.md"
    - "src/agent-definitions/document-formats/architect-plan-format.md"
    - "src/agent-definitions/planner.md"
    - "src/agent-definitions/architect.md"
    - "src/agent-definitions/workflow-prompts/slicer-prompt.md"
    - "src/shared/workflow/workflow-slicer.js"
    - "src/shared/workflow/workflow-prompts.js"
    - "src/shared/work-records/schema.js"
    - "src/shared/work-records/markdown.js"
    - "src/shared/work-records/generation.js"
    - "src/shared/work-records/auto-generation.js"
    - "src/shared/work-records/index-adapter.js"
    - "src/shared/work-records/search.js"
    - "src/ui/workspace/server/plan-adapter.js"
    - "src/ui/workspace/components/PlanDetail.jsx"
    - "src/ui/design-system/components.css"
    - "src/plan-store.test.js"
    - "src/shared/workflow/workflow.test.js"
    - "src/shared/workflow/workflow-prompts.test.js"
    - "src/shared/work-records/work-records.test.js"
    - "src/ui/workspace/workspace.test.js"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-07-22T13:11:44-04:00"
updatedAt: "2026-07-22T17:15:42.050Z"
status: "ready_for_work"
origin: "internal"
---

# Preserve Ticket References Through Delivery

## Context

External Work Sources such as Jira, GitHub Issues, and Notion work databases own demand management; RunWield owns
planning, execution, Plan Lifecycle, and delivery truth. The useful initial integration is therefore provenance and
navigation rather than synchronization. When a user identifies related Tickets in the User Request or planning
conversation, the resulting Plan should retain provider-agnostic Ticket References as structured front matter:

```yaml
tickets:
    - url: "https://example.com/tickets/ABC-123"
```

The relation is optional and many-to-many. It must remain visible in Workspace and survive completion in Work Records.
Standalone FEATURE Work Records snapshot their source Plan references. Epic Work Records snapshot the deduplicated union
from the Epic and every child FEATURE Plan; child Plans do not receive copied Epic references and still do not generate
individual Work Records by default. This feature does not fetch Ticket content, map status, write back, authenticate to
providers, or make RunWield a demand-management system.

## Objective

Make `tickets: [{ url }]` a canonical, extensible, provider-neutral field on Plans and Work Records; teach planning
Agents and Slicer to author direct relations; render direct and inherited context as accessible links in Workspace; and
make Ticket URLs retrievable through the existing Work Record index and search/read surfaces without introducing any
provider integration or lifecycle coupling.

## Approach

Create one pure-JavaScript Ticket Reference module that defines the JSDoc shape and centralizes tolerant normalization,
first-seen URL deduplication, and URL safety checks used at storage and presentation boundaries. A Ticket Reference
requires a non-empty `url`; its URL is trimmed but otherwise preserved, and additional YAML-safe object properties are
round-tripped so future metadata can extend the object without another list-shape migration. Provider identity is not
stored or inferred as canonical metadata.

Promote `tickets` into canonical Plan front matter so all Plan writes—including collaboration metadata rewrites—preserve
it. Planner and Architect author references only when the user identifies a URL as a Ticket, rather than treating every
URL as demand provenance. Slicer may assign direct child references and must preserve existing child references when an
updated descriptor omits the field; an explicit empty list clears direct child references. Epic references are context,
not inherited child front matter.

Work Record generation copies references mechanically, outside Recorder model output. Standalone records copy direct
Plan references. Epic records process Epic references first, then child references in stable child order, deduplicate by
the exact trimmed URL, and preserve the first full object when duplicates carry different future metadata. Targeted
auto-generation and backfill must apply the same aggregation across active and archived children. Existing linked Work
Records remain historical snapshots and are not rewritten when Plan references later change.

Workspace continues to use canonical Plan data from the existing adapter. Plan detail renders direct references in a
dedicated metadata group. Child detail projects parent Epic references separately as inherited context without merging
them into child front matter. Links use the RunWield Design System, open externally with safe browser attributes, wrap
long URLs, and have visible keyboard focus. Workspace does not fetch provider data or imply status synchronization.

## Files to Modify

- `src/shared/ticket-references.js` — add shared JSDoc types and pure helpers for Ticket Reference normalization,
  first-seen URL deduplication, and safe HTTP(S) link projection.
- `src/plan-front-matter.js` and `src/plan-store.js` — register, normalize, format, parse, update, and round-trip
  canonical `tickets` metadata, including future per-reference properties and collaboration metadata rewrites.
- `src/agent-definitions/document-formats/planner-plan-format.md`,
  `src/agent-definitions/document-formats/architect-plan-format.md`, `src/agent-definitions/planner.md`, and
  `src/agent-definitions/architect.md` — document optional Ticket Reference authoring from user-identified Tickets while
  preserving the external-demand/RunWield-delivery boundary.
- `src/agent-definitions/workflow-prompts/slicer-prompt.md`, `src/shared/workflow/workflow-slicer.js`, and
  `src/shared/workflow/workflow-prompts.js` — carry direct child references through Slicer descriptors and expose
  existing Epic/child references during resumed decomposition without copying Epic references to children.
- `src/shared/work-records/schema.js` and `src/shared/work-records/markdown.js` — add top-level Work Record `tickets`
  schema, normalization, validation, YAML formatting, and parsing.
- `src/shared/work-records/generation.js` and `src/shared/work-records/auto-generation.js` — snapshot standalone
  references and deterministically aggregate Epic plus active/archived child references for both normal generation and
  backfill.
- `src/shared/work-records/index-adapter.js` and `src/shared/work-records/search.js` — include Ticket URLs in derived
  searchable text and hydrated search/read results without creating high-cardinality tags.
- `src/ui/workspace/server/plan-adapter.js` and `src/ui/workspace/components/PlanDetail.jsx` — project inherited Epic
  context separately and render Ticket References as semantic links instead of JSON metadata.
- `src/ui/design-system/components.css` and `docs/design-system.md` — add/document the reusable metadata-reference list
  treatment using existing `--rw-*` tokens, long-link wrapping, and focus-visible behavior.
- `PRD.md` and `docs/prd/work-records-prd.md` — record the permanent ownership boundary, optional provider-neutral Plan
  field, Work Record snapshot/aggregation semantics, and search/index behavior; retain commits, PRs, and incidental
  links as non-schema references.
- `src/plan-store.test.js`, `src/shared/workflow/workflow.test.js`, `src/shared/workflow/workflow-prompts.test.js`,
  `src/shared/work-records/work-records.test.js`, relevant `src/tools/work-record-*.test.js` /
  `src/cmd/wr/index.test.js` fixtures, and `src/ui/workspace/workspace.test.js` — add storage, Slicer, Work Record,
  retrieval, API, SSR, and accessibility regressions.

## Reuse Opportunities

- `PLAN_FRONT_MATTER_KEYS`, `formatFrontMatter()`, `injectFrontMatter()`, and `parsePlanFrontMatter()` in
  `src/plan-front-matter.js` / `src/plan-store.js` already centralize canonical Plan serialization and preserve custom
  metadata.
- `pickKnownPlanFrontMatter()` in `src/plan-store.js` becomes safe for Ticket References once `tickets` is canonical.
- `attachEpicChildren()` and `compareChildPlansByOrder()` provide the existing Epic-child aggregation and deterministic
  ordering seams for Work Record generation.
- `normalizeWorkRecordFrontMatter()` and `formatWorkRecordFrontMatter()` in `src/shared/work-records/markdown.js` remain
  the canonical Work Record Markdown boundary.
- `buildWorkRecordIndexDocument()` and `formatHydratedWorkRecord()` already separate canonical Markdown from derived
  retrieval projections.
- `workspaceSafeFrontMatter()`, `serializePlanDetail()`, `serializeNonEpicDetail()`, and the grouped metadata machinery
  in `PlanDetail.jsx` already carry and organize Plan front matter without creating a second data source.
- Existing `.metadata-section`, `.metadata-group`, and semantic `--rw-*` tokens provide the Workspace visual baseline;
  add only the missing reusable reference-list behavior.

## Implementation Steps

- [ ] Add the shared Ticket Reference contract in `src/shared/ticket-references.js`.
  - Define `TicketReference` with required `url` and preserved additional properties using JSDoc, not TypeScript.
  - Normalize only plain-object entries with non-empty string URLs; trim URL whitespace, omit empty collections, keep
    entry order, and retain supported extra metadata.
  - Deduplicate only when explicitly requested by exact normalized URL, preserving the first complete object.
  - Expose a presentation guard that allows clickable absolute HTTP(S) URLs without performing network validation.
- [ ] Make Ticket References canonical Plan metadata.
  - Add `tickets` near planning provenance fields in `PLAN_FRONT_MATTER_KEYS`, `PlanFrontMatter`, canonical ordering,
    `formatFrontMatter()`, `injectFrontMatter()`, and `parsePlanFrontMatter()`.
  - Ensure normal status/lifecycle/front-matter updates and collaboration metadata clear/update paths retain references.
  - Keep absent or empty references omitted so all existing Plans remain valid and unchanged.
  - Add round-trip coverage for multiple objects, future metadata, malformed entries, clearing, canonical ordering, and
    preservation through metadata rewrites.
- [ ] Teach Plan-producing Agents and Slicer to author direct relations.
  - Add a commented optional `tickets` example to FEATURE and PROJECT Plan formats.
  - In Planner/Architect guidance, capture URLs the user identifies as Tickets in the original User Request or planning
    conversation; do not classify every external link as a Ticket and do not copy Ticket content or state.
  - Extend `ChildFeaturePlanDescriptor`, `CHILD_DESCRIPTOR_SCHEMA`, child materialization, Slicer summaries, and Slicer
    handoff text with optional direct Ticket References.
  - Preserve existing child references when Slicer updates an agreed child without supplying `tickets`; allow explicit
    `tickets: []` to clear them; never inherit all Epic references into each child.
  - Test initial materialization, resumed child preservation, explicit clearing, and the non-inheritance invariant.
- [ ] Extend canonical Work Records and deterministic generation.
  - Add optional top-level `tickets` to Work Record schema, parser, formatter, and hydrated resource types, reusing the
    shared Ticket Reference rules and omitting empty arrays.
  - In `generateWorkRecordForSource()`, copy direct references for standalone FEATURE sources without asking Recorder to
    reproduce them.
  - For Epic sources, aggregate Epic references first and then every matching child FEATURE reference in `order`/name
    order, regardless of child Plan Status; deduplicate by exact trimmed URL with first occurrence winning.
  - Make targeted auto-generation and broad active/archived backfill discover the same active and archived child set.
  - Preserve existing Work Records as snapshots when later Plan edits or generation reconciliation find an already
    linked record.
  - Add generation tests for direct snapshots, Epic/child union, duplicate metadata precedence, unfinished and archived
    children, no child Work Record/backlink, backfill parity, and later Plan edits not mutating an existing record.
- [ ] Carry Ticket References through Work Record retrieval.
  - Add Ticket URLs to `buildWorkRecordIndexDocument()` compact text so ticket keys and URLs are searchable, but do not
    create Ticket-derived tags.
  - Hydrate structured references in search/read results and render their URLs in Agent/CLI search and read output.
  - Keep list output compact unless an existing output contract requires the references there.
  - Cover index rebuild documents, search hydration, read formatting, and tool fixtures.
- [ ] Surface Ticket References in Workspace Plan detail.
  - Keep each Plan's direct references in canonical `attrs/frontMatter`; add a separate parent-Epic reference projection
    for child detail rather than merging inherited references.
  - Render a dedicated “Ticket references” metadata group with one semantic external link per direct reference and an
    explicitly contextual “Epic ticket references” group for inherited child context.
  - Do not add provider icons, fetched titles, statuses, synchronization language, or Ticket badges to Plan Cards.
  - Add shared metadata-reference styling with RunWield tokens, long-URL wrapping, safe external-link attributes, and a
    visible `:focus-visible` state; document the pattern in `docs/design-system.md`.
  - Test API projection, direct versus inherited separation, exact hrefs, unsafe/non-HTTP values not becoming clickable,
    absence of JSON-object rendering, and Epic/child detail behavior.
- [ ] Align durable product documentation.
  - Update `PRD.md` so optional provider-neutral Ticket References complement rather than violate the non-goal against
    making external trackers mandatory product concepts.
  - Update the Work Records PRD identity/reference rules, front matter examples, Epic generation policy, indexing, and
    search result contracts; explicitly distinguish Ticket demand provenance from commits, PRs, and incidental links.
- [ ] Run targeted tests, headed browser verification, and the full quality gate; repair every failure before
      completion.

## Verification Plan

- Automated:
  - `deno test -A src/plan-store.test.js`
  - `deno test -A src/shared/workflow/workflow.test.js src/shared/workflow/workflow-prompts.test.js`
  - `deno test -A src/shared/work-records/work-records.test.js src/tools/work-record-search.test.js src/tools/work-record-read.test.js src/cmd/wr/index.test.js`
  - `deno task workspace:test`
  - `deno task ci`
- Manual:
  - Create fixture Plans containing a standalone Ticket Reference, an Epic reference, distinct direct child references,
    a duplicate URL, a long URL, and a future metadata property; exercise Plan metadata updates and confirm YAML
    round-trip fidelity.
  - Generate/backfill Work Records and confirm the standalone record snapshots its Plan objects while the Epic record
    contains the stable deduplicated Epic-plus-child union, including archived or unfinished children, with no child
    Work Record backlink.
  - Search Work Records by a Ticket key embedded in the URL and confirm search/read output includes the canonical link.
  - Run `deno task workspace:dev`, open the standalone and child Plan detail routes at `http://127.0.0.1:5173`, and
    verify direct versus inherited grouping, keyboard focus, long-link wrapping, safe new-tab behavior, responsive
    layout, and no provider network request before link activation.
- Expected results:
  - Plans without `tickets` and historical Work Records continue to parse, render, execute, and validate unchanged.
  - User-identified Ticket URLs survive Plan authoring, lifecycle/collaboration metadata updates, Workspace projection,
    Work Record generation, index rebuild, and search/read hydration.
  - Epic Work Records include each unique direct Epic/child URL once, in deterministic first-seen order, while child
    Plan front matter contains only direct child relations.
  - Workspace renders usable links rather than serialized objects and never implies Ticket status or lifecycle sync.
  - All targeted commands and `deno task ci` pass.
- Execution policy matrix:
  - This FEATURE is Engineer-owned and autonomous because the primary outcome is cross-artifact provenance; Workspace
    link rendering is an incidental browser UI slice rather than a visual redesign.
  - Browser behavior still receives headed verification against the current RunWield Design System.
  - No target execution branch was specified.

## Edge Cases & Considerations

- Ticket URLs may identify private organizational work and are committed repo-local metadata. Keep them conspicuous in
  Plan review, store only user-supplied data, and never fetch titles/content or transmit them to a provider implicitly.
- URL comparison intentionally trims surrounding whitespace only. Textually different URLs remain distinct even if a
  provider might resolve them to the same Ticket; avoiding provider-specific canonicalization preserves neutrality.
- Malformed Ticket Reference entries must not make an otherwise loadable Plan disappear. Ignore invalid entries at the
  tolerant Plan boundary, keep Work Record generation best-effort, and never render unsafe URL schemes as links.
- Future Ticket Reference metadata must round-trip and copy with the winning object, but v1 interprets only `url`.
- Existing Work Records are historical snapshots. Adding or removing a Plan reference later does not silently rewrite an
  approved record; correction follows existing Work Record edit/supersession rules.
- Epic aggregation includes child references regardless of child completion because the Epic Work Record must retain all
  demand provenance associated with the delivered/deferred Epic boundary.
- QUICK_FIX remains no-Plan work and does not gain automatic Ticket Reference or Work Record behavior in this FEATURE.
- Structured Workspace editing of Ticket References, provider authentication, webhooks, polling, content import,
  write-back, status mapping, and automatic Ticket closure are out of scope.
