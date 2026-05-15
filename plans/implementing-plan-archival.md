---
id: plan-archival-system
title: Plan Archival and FTS Retrieval System
status: pending
classification: PROJECT
complexity: MEDIUM
original_prompt: "think about what happens to plans after completion or when the user ends up not executing it, after some time the plan will drift we should have a way to archive them. filter them and search through them"
files_impacted:
    - src/cli.js
    - src/cmd/plans/archive.js
    - src/tools/grep.js
    - src/tools/find.js
    - src/tools/plan_search.js
    - src/tools/plan_read_raw.js
    - src/shared/db.js
    - docs/adr/007-plan-archival-fts.md
---

### Objective

Implement a lifecycle management system for Harns plans to prevent active workspace pollution. Completed or abandoned
plans will be physically moved to an `.hns/plans/archive/` directory. This directory will be natively excluded from
system exploration tools. To preserve architectural history, archived plans will be indexed using LanceDB's Full-Text
Search (FTS) and exposed to agents via token-efficient search tools.

### Vertical Slice Findings

- Standard archival moves would break token parsimony if agents accidentally read the directory. `grep` and `find`
  wrappers must be patched to explicitly ignore `.hns/plans/archive/`.
- The `sleep` command is too infrequent for immediate cleanup; a non-blocking boot sweep in the CLI entry point provides
  a better developer experience.
- Using `@lancedb/lancedb` FTS avoids the overhead of ONNX embeddings while providing robust keyword matching on past
  decision records.
- To prevent blowing out agent context windows, the primary search tool will truncate the DAG tables and only return the
  front-matter, objective, and architectural findings.

### File Impacts

| File                                | Action | Description                                                                                                          |
| ----------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
| `docs/adr/007-plan-archival-fts.md` | Create | Document the decision to use LanceDB FTS and tool-level exclusion for archived plans.                                |
| `src/tools/grep.js`                 | Modify | Inject `--exclude-dir=.hns/plans/archive` into the `args` array.                                                     |
| `src/tools/find.js`                 | Modify | Inject `-not -path "*/.hns/plans/archive/*"` into the search logic.                                                  |
| `src/shared/db.js`                  | Modify | Add LanceDB initialization logic for a `plan_archive` table with FTS enabled.                                        |
| `src/cmd/plans/archive.js`          | Create | Implement the core archival logic: read file, extract metadata, move file, upsert to LanceDB. Expose as CLI command. |
| `src/cli.js`                        | Modify | Add a non-blocking asynchronous sweep function on boot to archive plans older than `archive_ttl_days`.               |
| `src/tools/plan_search.js`          | Create | Expose LanceDB FTS query to agents, returning truncated plan summaries.                                              |
| `src/tools/plan_read_raw.js`        | Create | Allow agents to read the full execution DAG of an archived plan if strictly necessary.                               |

### Tasks

| Task | Assignee   | Dependencies | Description                                                                                                                                                                                               |
| ---- | ---------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1   | doc-writer |              | Write `docs/adr/007-plan-archival-fts.md` detailing the FTS LanceDB index and token-parsimonious search retrieval.                                                                                        |
| T2   | engineer   |              | Update `src/tools/grep.js` and `src/tools/find.js` to strictly exclude the archive directory from all searches.                                                                                           |
| T3   | engineer   | T2           | Implement the LanceDB schema and FTS initialization for archived plans in `src/shared/db.js`.                                                                                                             |
| T4   | engineer   | T3           | Build `src/cmd/plans/archive.js`. It must physically move the target `.md` file, parse its Markdown to isolate the Objective/Findings, and upsert that record into the LanceDB index.                     |
| T5   | engineer   | T4           | Update `src/cli.js` to execute a non-blocking boot sweep. It should read `~/.config/harns/settings.json` for an `archive_ttl_days` integer (defaulting to 3) and call the archive logic on expired plans. |
| T6   | engineer   | T4           | Build `src/tools/plan_search.js` (queries FTS, returns summaries) and `src/tools/plan_read_raw.js` (reads full disk file). Register both to the Architect and Router toolsets.                            |
| T7   | tester     | T5, T6       | Write integration tests verifying that an expired plan is moved on boot, hidden from `grep`, and retrievable via `plan_search`.                                                                           |

### Edge Cases & Considerations

- **Malformed Front-matter:** The archival parsing logic must gracefully handle `.md` files that have missing or
  syntax-error YAML blocks without crashing the background boot sweep.
- **FTS Indexing Constraints:** LanceDB builds the FTS index via Tantivy. Ensure the upsert process during the boot
  sweep does not lock the main process or degrade CLI responsiveness.
