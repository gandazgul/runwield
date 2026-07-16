---
planId: "d6c115a6-1868-4c09-96b0-d047dfc2d406"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Build the derived Work Record search index, add CLI search, and expose work_record_search/read tools to Guide, Ideator, Planner, Architect, and Recorder while keeping Engineer excluded. This makes canonical records retrievable for future planning without making the index authoritative."
affectedPaths:
    - "src/shared/work-records/"
    - "src/cmd/wr/"
    - "src/tools/work-record-search.js"
    - "src/tools/work-record-read.js"
    - "src/tools/registry.js"
    - "src/shared/session/session.js"
    - "src/shared/session/tool-event-title.js"
    - "src/shared/session/__tests__/session-tools-policy.test.js"
    - "src/agent-definitions/guide.md"
    - "src/agent-definitions/ideator.md"
    - "src/agent-definitions/planner.md"
    - "src/agent-definitions/architect.md"
    - "src/agent-definitions/recorder.md"
frontend: false
createdAt: "2026-07-15T21:05:36.853Z"
updatedAt: "2026-07-15T21:05:36.853Z"
status: "draft"
origin: "internal"
parentPlan: "work-records-v1"
order: 3
dependencies:
    - "02-recorder-generation-and-backfill"
---

# Index, Search CLI, and Agent Retrieval Tools

## Context

Canonical Work Records are Markdown files, but humans and planning Agents need retrieval over the approved current
subset. The PRD requires a derived Work Record search index isolated from normal project memory and `work_record_search`
/ `work_record_read` tools for Guide, Ideator, Planner, Architect, and Recorder. Engineer should not receive default
Work Record retrieval.

This slice adds retrieval and indexing after records can already be generated/backfilled. The index remains rebuildable
derived state; Markdown remains authoritative.

## Objective

Add an isolated derived Work Record index, CLI search, and agent retrieval tools. Search should default to approved,
non-archived, non-superseded records; results must show completion mode prominently and include full Summary text,
compact metadata, source Plan IDs, and path. Agent definitions should receive the tools declaratively, with runtime
auto-wiring and protected-tool policy only for agents whose bundled definitions include them.

## Approach

Implement index and search services inside `src/shared/work-records/`. Build compact index documents from canonical
Markdown H1, Summary, and metadata, and write them to a separate Mnemosyne collection such as
`<projectName>:work-records`. Do not store Mnemosyne document IDs in committed Markdown.

`wld wr search <query>` should search current usable records and print enough path/status information for users to open
the Markdown. Agent `work_record_search` should return structured results with full Summary;
`work_record_read(recordId)` should load canonical Markdown by `recordId` and return metadata/body with status warnings.
Keep tool access declarative through bundled Agent Definition front matter and `buildAgentSession()` custom-tool
auto-wiring.

## Files to Modify

- `src/shared/work-records/` — add index adapter, sync/rebuild service, search service, read-by-recordId service,
  status-warning helpers, and tests.
- `src/cmd/wr/` — add `search` command and any index rebuild/sync command if needed for reliable local operation.
- `src/tools/work-record-search.js` — expose current-project Work Record search as an internal custom tool.
- `src/tools/work-record-read.js` — expose canonical Work Record read by `recordId` as an internal custom tool.
- `src/tools/registry.js` — protect Work Record tools from layered-agent removal when bundled definitions include them.
- `src/shared/session/session.js` — auto-wire Work Record custom tools when requested by Agent Definition tool names.
- `src/shared/session/tool-event-title.js` — classify Work Record tool events as search/read operations with useful
  titles.
- `src/shared/session/__tests__/session-tools-policy.test.js` — verify role-specific tool availability and protection
  behavior.
- `src/agent-definitions/guide.md` — grant and instruct Work Record access with prominent status/completion warnings for
  broader project-history inquiries.
- `src/agent-definitions/ideator.md` — grant default current approved Work Record retrieval for ideation context.
- `src/agent-definitions/planner.md` — grant default current approved Work Record retrieval for planning context.
- `src/agent-definitions/architect.md` — grant default current approved Work Record retrieval for architecture planning
  context.
- `src/agent-definitions/recorder.md` — grant broader Work Record read/search access for maintenance, generation,
  supersession, and backfill workflows.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/extensions/mnemosyne/index.js` — command execution patterns and Mnemosyne availability/error handling.
- `src/cmd/sleep/index.js` — explicit Mnemosyne collection operation patterns and user-facing failure messages.
- Work Record store/list/read APIs from earlier slices — canonical source loading and filtering.
- `src/shared/session/session.js` — existing internal custom-tool auto-wiring used by workflow tools.
- `src/tools/registry.js` — protected context-tool policy pattern.
- `src/shared/session/tool-event-title.js` — runtime tool title/kind conventions.

## Implementation Steps

- [ ] Step 1: Add a Work Record index document builder that extracts H1 title, Summary, scope, origin, completionMode,
      status, archived state, source Plan IDs, and path from canonical Markdown.
- [ ] Step 2: Add an isolated Mnemosyne index adapter using a Work Record-specific collection and tags such as
      `status:approved`, `scope:feature`, `completion:verified`, and `archived:false`.
- [ ] Step 3: Implement sync/rebuild behavior from canonical Markdown without persisting Mnemosyne IDs in Work Record
      files.
- [ ] Step 4: Implement Work Record search service with default current-record filtering and result hydration from
      canonical Markdown so full Summary and status warnings are accurate.
- [ ] Step 5: Implement canonical read-by-recordId service that tolerates path moves by scanning IDs and returns
      metadata, path, body, Summary, source Plan IDs, and warnings.
- [ ] Step 6: Add `wld wr search <query>` output showing title, recordId, completionMode, status, scope, origin,
      Summary, source Plan IDs, path, and prominent warnings for skipped verification/supersession/archive when
      included.
- [ ] Step 7: Add `work_record_search` and `work_record_read` custom tool definitions and auto-wire them in
      `buildAgentSession()` when requested.
- [ ] Step 8: Update tool protection, runtime tool titles/kinds, and bundled Agent Definitions for Guide, Ideator,
      Planner, Architect, and Recorder; confirm Engineer does not list the tools.
- [ ] Step 9: Add tests for index document construction, sync/rebuild, default filtering, CLI search output, canonical
      read by moved path, tool auto-wiring, protected-tool policy, and agent definition access.

## Verification Plan

- Automated: `deno test -A src/shared/work-records/**/*.test.js src/cmd/wr/**/*.test.js`
- Automated:
  `deno test -A src/shared/session/__tests__/session-tools-policy.test.js src/shared/session/session-prompt.test.js`
- Automated: `deno test -A src/shared/session/session-runtime.test.js`
- Automated: `deno task ci`
- Manual: Generate or fixture several Work Records, delete/rebuild derived index state, run `wld wr search <query>`, and
  confirm records are found from canonical Markdown-derived indexing.
- Manual: Confirm default search excludes draft, pending, superseded, and archived records unless explicit maintenance
  behavior is implemented and requested.
- Manual: Invoke Guide/Ideator/Planner/Architect/Recorder sessions with bundled definitions and confirm Work Record
  tools are available where expected; confirm Engineer does not receive them by default.
- Manual: Use `work_record_search` and `work_record_read` as an agent; confirm completion mode, status,
  supersession/archive warnings, path, source Plan IDs, and full Summary are visible.
- Expected result: Search/read retrieval improves planning context while Markdown remains the only canonical Work Record
  state and the normal project memory collection remains separate.

## Edge Cases & Considerations

- Mnemosyne failures must not corrupt Markdown or Plan backlinks; index sync should be retryable/rebuildable.
- V1 does not need role-aware ranking or rich filters unless required to implement Guide/Recorder broader-status access
  safely.
- `work_record_read(recordId)` should resolve by ID, not path, so moved files remain readable.
- Search should not expose draft/pending/superseded/archived records to planning agents by default.
- Guide and Recorder can have broader retrieval semantics only with prominent warnings and without presenting unsettled
  records as verified history.
- Protection applies only to agents whose bundled definitions include Work Record tools; do not grant Engineer default
  access.
