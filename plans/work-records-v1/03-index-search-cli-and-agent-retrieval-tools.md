---
planId: "d6c115a6-1868-4c09-96b0-d047dfc2d406"
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Build the derived Work Record search index, add CLI search/read and index rebuild flows, and expose work_record_search/read tools to Guide, Ideator, Planner, Architect, and Recorder while keeping Engineer excluded by default."
affectedPaths:
    - "src/constants.js"
    - "src/shared/work-records/index.js"
    - "src/shared/work-records/index-adapter.js"
    - "src/shared/work-records/search.js"
    - "src/shared/work-records/generation.js"
    - "src/shared/work-records/work-records.test.js"
    - "src/cmd/wr/index.js"
    - "src/cmd/wr/index.test.js"
    - "src/cmd/registry.js"
    - "src/tools/work-record-search.js"
    - "src/tools/work-record-search.test.js"
    - "src/tools/work-record-read.js"
    - "src/tools/work-record-read.test.js"
    - "src/tools/registry.js"
    - "src/shared/session/session.js"
    - "src/shared/session/tool-event-title.js"
    - "src/shared/session/tool-event-title.test.js"
    - "src/shared/session/__tests__/session-tools-policy.test.js"
    - "src/agent-definitions/guide.md"
    - "src/agent-definitions/ideator.md"
    - "src/agent-definitions/planner.md"
    - "src/agent-definitions/architect.md"
    - "src/agent-definitions/recorder.md"
frontend: false
createdAt: "2026-07-15T17:05:36-04:00"
updatedAt: "2026-07-19T12:49:58.251Z"
status: "verified"
origin: "internal"
parentPlan: "work-records-v1"
order: 3
dependencies:
    - "02-recorder-generation-and-backfill"
implementedAt: "2026-07-19T03:11:32.776Z"
verifiedAt: "2026-07-19T12:49:58.251Z"
executionReport: "- Implemented Work Record Mnemosyne index adapter, rebuild/bootstrap search, canonical read-by-recordId, CLI `wr search/read/index rebuild`, generation best-effort sync, and Recorder agent boundary fix.\n- Added `work_record_search` / `work_record_read` custom tools, protected policy entries, session auto-wiring with role-based access modes, event titles/kinds, and bundled agent definition guidance.\n- Verified `mnemosyne update --help`: strict positional `<id>` update with additive `--tag`, `--replace-tags`, and tag-clearing behavior is available.\n- Automated verification passed: targeted Work Record/CLI/tool/session tests and `deno task ci`.\n- Manual fixture end-to-end scenarios from the plan were not exhaustively run beyond the prerequisite help check."
humanReviewMode: "ask"
humanReviewDecision: "approved"
humanReviewedAt: "2026-07-19T12:49:58.216Z"
---

# Index, Search CLI, and Agent Retrieval Tools

## Context

The first two Work Records slices are verified. Canonical Work Record Markdown can be parsed, listed, resolved by
`recordId`, generated from completed top-level Plans/Epics, and linked back to its source Plan. This slice makes those
records retrievable without treating the search index as authoritative.

The Work Records PRD requires a separate derived Mnemosyne collection, human CLI search/read flows, and
`work_record_search` / `work_record_read` Custom Tools. Ideator, Planner, and Architect may retrieve only current usable
Work Records; Guide and Recorder may inspect all current-project statuses with prominent notices; Engineer remains
without default Work Record access.

Mnemosyne currently assigns globally unique numeric document IDs. The user is adding a strict `mnemosyne update` command
before this Plan executes. RunWield will not change Mnemosyne to fit Work Records or persist numeric Mnemosyne IDs in
Markdown. Instead, each index document receives a unique `work-record:<recordId>` tag; sync locates the derived numeric
ID by that tag, then adds a missing document or updates the existing one.

Current source also contains an earlier-slice inconsistency: `recorder.md` exists, but `AGENTS.RECORDER` is absent and
default Recorder generation invokes `AGENTS.PLANNER`. This slice already touches Recorder/session/generation seams, so
it should restore the intended Recorder boundary while adding retrieval.

## Objective

Add a rebuildable Work Record index in `<projectName>:work-records`, incremental index sync for generated records,
indexed `wld wr search`, canonical `wld wr read`, and explicit `wld wr index rebuild` repair/bootstrap behavior.

Expose two structured Custom Tools:

- `work_record_search(query)` returns hydrated canonical results with full Summary, compact Front Matter fields, source
  Plan IDs, path, completion mode, and notices.
- `work_record_read(recordId)` resolves canonical Markdown by stable ID rather than path and returns metadata, body, and
  notices subject to the active Agent's access mode.

Keep Markdown under `docs/work-records/` authoritative. Missing, stale, duplicate, or unavailable derived index state
must never corrupt Work Records, alter Plan terminal state, or turn successful Work Record generation into failure.

## Approach

Add an injectable Mnemosyne adapter under `src/shared/work-records/` using collection name `<projectName>:work-records`.
Build compact index content from H1 title, scope, origin, completion mode, and the full `## Summary`; do not embed the
full body. Attach the PRD tags for status, scope, origin, completion mode, and archived state, plus
`superseded:true|false` and the unique locator tag `work-record:<recordId>`.

For incremental sync, initialize the collection idempotently, list by the unique locator tag, add when no document
exists, and use strict
`mnemosyne update <numericDocumentId> --name <collection> --replace-tags --tag <tag>... <content>` when exactly one
exists. Plain update `--tag` is additive, so sync must pass `--replace-tags` with the complete canonical tag set; an
update with no `--tag` removes all tags and must not be used for indexed Work Records. A missing numeric ID is an error.
More than one document with the same locator tag is derived-index corruption and should produce actionable
`wld wr index rebuild` guidance rather than silently choosing one. Verify the installed `mnemosyne update --help`
contract at implementation time because that external command is a prerequisite being added outside this repository.

`wld wr index rebuild` should forget/reinitialize only the dedicated Work Record collection and add every canonical
record, including non-current records needed by Guide, Recorder, and `--all`. Normal generated writes should sync after
the canonical record and Plan backlink succeed. Index sync is best-effort at that boundary: report a warning but keep
the generation outcome `generated`. Search should automatically bootstrap by rebuilding when the dedicated collection is
empty while canonical records exist; it should not rebuild before every query. Manual Markdown edits/deletions and index
repair use the explicit rebuild command.

Search Mnemosyne for candidate IDs, then hydrate every result from canonical Markdown by `recordId`. Canonical fields
and notices always win over indexed text/tags. Default CLI and planning-Agent search includes only approved,
non-archived, non-superseded records. `wld wr search <query> --all`, Guide, and Recorder may include every status, with
completion, archive, supersession, draft, and pending-verification notices. `wld wr read <recordId>` is an explicit
human lookup and may read any status with notices.

Create Work Record tool factories parameterized by `cwd` and access mode. `buildAgentSession()` should auto-wire them
when the effective Agent Definition requests their names. Guide and Recorder receive broad mode; Ideator, Planner, and
Architect receive current-only mode; any other explicitly customized Agent receives the safer current-only mode. Bundled
Engineer Front Matter remains unchanged. Adding the names to protected-tool policy only preserves them for Agents whose
bundled definitions already contain them; it does not grant them globally.

## Files to Modify

- `src/constants.js` — add `AGENTS.RECORDER` to the canonical Agent identifiers and JSDoc shape.
- `src/shared/work-records/index-adapter.js` — add collection naming, compact document/tag construction, injectable
  Mnemosyne command execution, locator-tag lookup, strict add/update sync, empty-collection detection, and full rebuild.
- `src/shared/work-records/search.js` — add bootstrap, indexed candidate search/JSON parsing, canonical hydration,
  access-mode filtering, result/read formatting, and stale-index handling.
- `src/shared/work-records/index.js` — export the new index/search/read APIs.
- `src/shared/work-records/generation.js` — invoke `AGENTS.RECORDER` by default and best-effort sync successfully
  generated records without changing generated Plan backlinks when indexing fails.
- `src/shared/work-records/work-records.test.js` — cover index documents/tags, add/update/rebuild behavior, bootstrap,
  filtering/hydration, read-by-ID, and non-authoritative generation sync.
- `src/cmd/wr/index.js` — add `search`, `read`, and `index rebuild` dispatch, argument validation, `search --all`,
  output, and dependency injection.
- `src/cmd/wr/index.test.js` — cover new command parsing, default/all visibility, read warnings, rebuild reporting, and
  errors.
- `src/cmd/registry.js` — advertise indexed search, canonical read, and index rebuild syntax; remove deferred-search
  wording while keeping manual create deferred.
- `src/tools/work-record-search.js` and `src/tools/work-record-read.js` — define the two Custom Tool factories and
  structured result contracts.
- `src/tools/work-record-search.test.js` and `src/tools/work-record-read.test.js` — test schemas, access modes,
  structured details, text projections, canonical warnings, and failures.
- `src/tools/registry.js` — add both Work Record tool names to protected-tool policy.
- `src/shared/session/session.js` — auto-wire Work Record tool factories using session `cwd` and Agent-specific access
  mode when requested by effective Agent tools.
- `src/shared/session/tool-event-title.js` and `src/shared/session/tool-event-title.test.js` — title search events by
  query, read events by `recordId`, and classify them as `search` and `read`.
- `src/shared/session/__tests__/session-tools-policy.test.js` — verify bundled role access, layered protection,
  auto-wiring, safe access modes, and Engineer's default exclusion.
- `src/agent-definitions/guide.md`, `src/agent-definitions/ideator.md`, `src/agent-definitions/planner.md`,
  `src/agent-definitions/architect.md`, and `src/agent-definitions/recorder.md` — declare the tools and explain when to
  retrieve Work Records, how completion confidence differs from Memory, and how to surface non-current notices.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/work-records/store.js` — reuse `listWorkRecords()` and `findWorkRecordById()` so path moves do not affect
  identity or canonical reads.
- `src/shared/work-records/markdown.js` — reuse parsed H1, full Summary, body, and canonical Front Matter rather than
  reparsing index text.
- `src/shared/work-records/list.js` — reuse `isCurrentWorkRecord()` and `workRecordNotices()` as the canonical current
  filter and warning vocabulary; extend notices only if draft/pending wording is insufficient.
- `src/shared/work-records/generation.js` — reuse the single successful generation boundary for best-effort incremental
  sync.
- `src/extensions/mnemosyne/index.js` — follow project-name derivation, command error handling, query quoting, and JSON
  search conventions while retaining a separate collection and adapter.
- `src/cmd/sleep/index.js` — reuse injectable `Deno.Command` result/error handling for non-Agent Mnemosyne operations.
- `src/cmd/wr/index.js` — preserve existing command-group parsing, help dispatch, and test dependency injection.
- `src/shared/session/session.js` — follow existing name-driven Custom Tool auto-wiring and close over the session
  `cwd`.
- `src/tools/registry.js` and `src/shared/session/agents.js` — reuse per-bundled-Agent protected-tool semantics rather
  than adding a second access-control mechanism.

## Implementation Steps

- [ ] Step 1: Add `AGENTS.RECORDER`, change default Work Record generation to invoke Recorder, and add a regression test
      proving the intended Agent boundary is used when no injected Recorder runner is supplied.
- [ ] Step 2: Implement collection naming and compact index document/tag construction. Include full Summary, all PRD
      filter tags, `superseded:true|false`, and exactly one `work-record:<recordId>` locator tag; exclude the full body
      and Mnemosyne numeric IDs.
- [ ] Step 3: Add an injectable Mnemosyne command adapter. Verify strict `update` availability, initialize the dedicated
      collection, parse numeric IDs from locator-tag listing, add absent records, and update exactly one existing record
      using positional numeric ID plus `--replace-tags` and the complete canonical tag set. Reject duplicate locator
      matches with rebuild guidance; never rely on additive `--tag` behavior or issue a tagless Work Record update.
- [ ] Step 4: Implement `rebuildWorkRecordIndex(cwd)` by forgetting only `<projectName>:work-records`, reinitializing
      it, loading every canonical Work Record, and adding one document per `recordId`. Return counts and actionable
      partial-failure details while leaving Markdown untouched.
- [ ] Step 5: Add empty-index bootstrap and indexed search. Parse Mnemosyne JSON results, recover `recordId` from the
      locator tag, hydrate through `findWorkRecordById()`, discard missing/stale candidates, apply canonical current/all
      access filtering, preserve ranking order, and return full Summary plus metadata/path/notices.
- [ ] Step 6: Add canonical read service by `recordId`. Current-only mode must reject draft, pending, superseded, and
      archived records without leaking their body; all mode returns them with prominent notices. Human explicit read
      uses all mode.
- [ ] Step 7: Best-effort sync each successfully generated/linked Work Record. Keep generation outcome/backlink
      `generated` when Mnemosyne sync fails and expose a concise index warning for CLI/session callers to report.
- [ ] Step 8: Extend `wld wr` with `search <query> [--all]`, `read <recordId>`, and `index rebuild`. Validate non-empty
      query/ID, reject unsupported flags or extra read/rebuild arguments, and print title, `recordId`, completion mode,
      status, scope, origin, full Summary/body as appropriate, source Plan IDs, path, and notices.
- [ ] Step 9: Update command registry help/usage and add command tests for current-only search, `--all`, canonical read,
      empty-index bootstrap, rebuild counts, malformed input, and Mnemosyne failure messages.
- [ ] Step 10: Implement `createWorkRecordSearchTool({ cwd, accessMode })` and
      `createWorkRecordReadTool({ cwd, accessMode })`. Keep Agent search input query-only; return readable text content
      plus structured `details` containing access mode and hydrated records.
- [ ] Step 11: Auto-wire the tools in `buildAgentSession()`, add protected names, and update runtime titles/kinds. Test
      that Guide/Recorder use all mode, Ideator/Planner/Architect use current mode, local overrides cannot remove their
      bundled protected tools, and Engineer has neither tool by default.
- [ ] Step 12: Update the five bundled Agent Definitions. Planning Agents should retrieve relevant current Work Records
      during discovery rather than ritualistically on every turn; Guide/Recorder must prominently distinguish draft,
      pending, superseded, archived, done-enough, and closed-without-verification history.
- [ ] Step 13: Add focused adapter/search/tool tests with fake Mnemosyne command runners, then run the full RunWield
      quality gate.

## Verification Plan

- Automated: `deno test -A src/shared/work-records/work-records.test.js src/cmd/wr/index.test.js`
- Automated:
  `deno test -A src/tools/work-record-search.test.js src/tools/work-record-read.test.js src/shared/session/tool-event-title.test.js`
- Automated: `deno test -A src/shared/session/__tests__/session-tools-policy.test.js`
- Automated: `deno task ci`
- Manual prerequisite: Run `mnemosyne update --help` and confirm update takes the numeric Mnemosyne document ID as its
  positional argument, errors for a nonexistent ID, treats plain `--tag` as additive, supports `--replace-tags` for
  complete replacement, and removes tags when no `--tag` is supplied.
- Manual: Fixture approved/current plus draft, pending, superseded, archived, done-enough, and
  closed-without-verification Work Records. Delete the dedicated collection, run `wld wr search <query>`, and confirm
  empty-index bootstrap rebuilds it from canonical Markdown.
- Manual: Run default search and `search --all`; confirm default output contains only current usable records while
  `--all` includes matched historical/unsettled records with prominent notices and full Summary text.
- Manual: Run `wld wr read <recordId>` before and after moving the record file; confirm lookup follows `recordId`, shows
  the current path, and displays the full canonical body and notices.
- Manual: Edit a canonical Work Record, run `wld wr index rebuild`, and confirm updated content/tags replace the derived
  collection without changing Markdown or storing Mnemosyne IDs in Git.
- Manual: Generate/backfill a new Work Record and confirm its unique locator tag is added; regenerate sync against the
  same fixture and confirm strict update does not create a duplicate.
- Manual: Simulate Mnemosyne sync failure after successful generation; confirm the Work Record and generated Plan
  backlink remain valid and the caller receives only an index warning.
- Manual: Build Guide, Ideator, Planner, Architect, Recorder, and Engineer Agent Sessions from bundled definitions;
  confirm expected tool availability and access modes, with Engineer excluded by default.
- Expected result: Humans and permitted Agents can retrieve trustworthy Work Record history while canonical Markdown
  remains the sole source of truth and the normal project Memory collection remains isolated.

## Edge Cases & Considerations

- External prerequisite: this Plan assumes the user-provided strict `mnemosyne update` command exists before execution.
  Do not emulate upsert or modify Mnemosyne in this repository if it is unavailable; report the blocked prerequisite.
- The `work-record:<recordId>` tag is the unique canonical locator. Mnemosyne numeric document IDs are derived database
  references only and must never be committed to Work Record or Plan Front Matter.
- Rebuild indexes all statuses because Guide, Recorder, explicit human `--all`, and human `read` require them; access
  filtering happens during retrieval and is rechecked against canonical Markdown.
- Index tags/content can be stale. Search/read output must hydrate canonical records and enforce canonical visibility;
  never trust an indexed status tag enough to expose a restricted body.
- Normal generated writes sync incrementally. Manual filesystem edits/deletions require `wld wr index rebuild`; search
  only auto-rebuilds when the collection is empty, not before every query.
- A duplicate locator tag indicates derived corruption or a concurrent add race. Fail with rebuild guidance rather than
  return ambiguous history. Keep adapter operations serialized within the process where practical; explicit rebuild is
  the cross-process recovery path.
- Rebuild is destructive only to the dedicated derived collection and may be briefly visible as empty to another
  process. It must never forget the normal project Memory collection.
- Mnemosyne command, embedding, or parse failures must be actionable and must not corrupt Markdown, roll back Plan
  terminal state, or overwrite a successful generated backlink with failure.
- `work_record_read` current-only mode must check canonical visibility before returning body content. Knowing a
  restricted `recordId` does not bypass planning-Agent access policy.
- Guide and Recorder broad access is current-project only. Their prompts and outputs must not present draft, pending,
  superseded, archived, done-enough, or skipped-verification records as equivalent to verified current history.
- Bundled Engineer remains without Work Record tools. A user may explicitly customize another Agent Definition to add
  them; such non-bundled access defaults to current-only and is not protected from later override removal.
- V1 does not add cross-project retrieval, role-aware ranking, rich Agent filters, full-body embeddings, manual/external
  creation, archive/supersession commands, or automatic rebuild on every search.
- Keep all new core, CLI, and tool code in pure JavaScript with reusable JSDoc `@typedef` object shapes; do not
  introduce TypeScript syntax.
