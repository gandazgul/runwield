---
planId: "bbe02826-ea2c-4b92-b41a-a3cb76d0b894"
classification: "PROJECT"
complexity: "HIGH"
summary: ""
affectedPaths:
    []
createdAt: "2026-06-25T14:12:40.436Z"
status: "draft"
origin: "internal"
id: "unified-semantic-indexer"
title: "Unified Local Semantic Indexer (Code + Memory)"
---

# Context

Harns currently has a working memory system (Mnemosyne extension) that shells out to a Go binary (`mnemosyne`) for
hybrid search (BM25 + vector + cross-encoder reranking). The memory tools (`memory_recall`, `memory_store`,
`memory_delete`) work well.

What's **missing** is a `codebase_search` tool — semantic search over the actual source files in the project. This would
let agents find relevant code without exhaustive `grep`/`read` exploration, dramatically improving triage quality and
reducing token waste.

# Resolved Decisions

## D1: In-process LanceDB + transformers.js engine (DECIDED)

Build a unified in-process semantic engine that owns both **memory** and **codebase indexing**. This replaces the
external `mnemosyne` Go binary entirely. Mnemosyne remains as a standalone tool for other harnesses but Harns will have
its own native implementation.

This is a single-phase effort: both memory tools AND codebase search ship together.

**Rationale:** Mnemosyne is optimized for sentence-length docs, not code chunks. Owning the pipeline gives full control
over schema, batch upserts, and incremental updates without subprocess overhead. Harns is pre-MVP — now is the time to
own the full stack before users depend on the mnemosyne binary.

**Feasibility (verified via PoC):**

- ✅ `@lancedb/lancedb` (npm) — works perfectly in Deno. CRUD, vector search, filtered queries all pass.
- ✅ `@huggingface/transformers` (npm) — works in Deno.
- ✅ `Snowflake/snowflake-arctic-embed-m-v1.5` — loads, produces 768-dim embeddings, supports Matryoshka truncation to
  256-dim with re-normalization. Search quality excellent at 256-dim.
- ✅ `cross-encoder/ms-marco-MiniLM-L-6-v2` — loads, correctly reranks candidates. Scores are well-separated.
- ✅ Full pipeline (embed → store → vector search → rerank) works end-to-end in Deno.
- ✅ Native `tree-sitter` (N-API bindings via `npm:tree-sitter`) works with `"nodeModulesDir": "auto"` in deno.json.
  Verified: JS, TS, Python, Go, Rust all parse correctly.

## D1b: Models (DECIDED)

- **Embedding:** `Snowflake/snowflake-arctic-embed-m-v1.5` at 256-dim (Matryoshka truncation + re-normalize). Same model
  mnemosyne uses. Top of benchmarks for small open-weight models. Tested: 768 vs 256 produce identical ranking order on
  code queries — 256 is sufficient, especially with cross-encoder reranking on top. Saves ~3x storage.
- **Reranking:** `cross-encoder/ms-marco-MiniLM-L-6-v2`. Same as mnemosyne. Used to rerank top-K vector results before
  returning to the agent.

## D2: Chunking strategy — tree-sitter (multi-language) + line-based fallback (DECIDED)

Native `tree-sitter` (N-API bindings via `npm:tree-sitter`) works with `"nodeModulesDir": "auto"` in deno.json.
Verified: JS, TS, Python, Go, Rust all parse correctly.

Requires `"nodeModulesDir": "auto"` in deno.json for N-API native addon support. Tree-sitter grammars are native addons
that need to be present at runtime (see D7 for runtime deps strategy).

**AST-chunked languages (tree-sitter):**

- JavaScript/TypeScript: `tree-sitter-javascript`, `tree-sitter-typescript`
- Python: `tree-sitter-python`
- Go: `tree-sitter-go`
- Rust: `tree-sitter-rust`
- (More grammars can be added incrementally as npm packages)

**Target AST nodes per language:**

- JS/TS: `function_declaration`, `class_declaration`, `method_definition`, `export_statement`, `interface_declaration`,
  `type_alias_declaration`
- Python: `function_definition`, `class_definition`
- Go: `function_declaration`, `method_declaration`, `type_declaration`
- Rust: `function_item`, `struct_item`, `impl_item`, `trait_item`, `enum_item`

**Fallback (no grammar available):** Line-based heuristic chunking (split on blank-line-separated blocks, respect
indentation).

**Non-code files (.md, .yaml, etc.):** Section-based splitting (headers for markdown, top-level keys for YAML).

**Chunk size limits:**

- Node ≤100 lines → one chunk as-is.
- Class/impl >100 lines → split at method boundaries. Each method becomes its own chunk with the class signature
  prepended as a 1-2 line context header.
- Single function >100 lines → split into overlapping windows (80 lines with 20-line overlap), preserving the function
  signature at the start of each sub-chunk.

## D3: Disk layout (DECIDED)

| Scope              | Path                                        | Contents                                                                 |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------------------ |
| Project code index | `.hns/index/code_chunks/` (in project root) | LanceDB table of AST-chunked code                                        |
| Project memories   | `.hns/index/memories/` (in project root)    | LanceDB table of project-scoped memories                                 |
| Global memories    | `~/.hns/index/memories/`                    | LanceDB table of cross-project memories                                  |
| Model cache        | `~/.hns/models/`                            | ONNX weights (all-MiniLM-L6-v2), downloaded once, shared across projects |

`.hns/index/` in the project should be gitignored (both code index and project memories are local state).

## D4: Indexing lifecycle — onboarding gate + incremental (DECIDED)

**Two phases:**

### Pre-onboarding (no index exists)

- On session start, Harns checks for an existing index at `.hns/index/`.
- If missing, check for a decline marker at `~/.hns/onboarding/<hashed-cwd>/noindex`.
- If no marker: prompt the user "Would you like to onboard this codebase? This creates a semantic index for better code
  search and memory."
  - **Yes**: Run full `hns init` pipeline (see below). Transition to post-onboarding.
  - **No**: Create the `noindex` marker. Show a message: "Understood. Code search and memory features will be limited.
    Run `hns init` anytime to onboard."
- `hns init` command: explicit onboarding entrypoint. Removes the noindex marker if present, runs full pipeline.

### `hns init` pipeline (this plan)

For this plan, `hns init` does one thing:

1. **Build code index** — Full scan of project files (respects .gitignore, skips binaries/large files). AST-chunk and
   embed all source files into `.hns/index/code_chunks/`.

Future work (out of scope for this plan) will extend init with:

- Run ubiquitous-language prompt template
- Bootstrap project memories via LLM-guided interview (tech stack, verification commands, commit preferences)

### Post-onboarding (index exists)

- **Session start:** Incremental re-index only — compare file mtimes/hashes against stored metadata. Only re-embed
  changed/new files. Delete chunks for removed files.
- **During session:** `Deno.watchFs` keeps the index fresh as files are edited by agents or the user.
  - Per-file debounce (500ms): each file change resets its timer (avoids re-embedding during rapid saves).
  - Global batch queue: processes up to 5 files every 2 seconds.
  - Flush-on-search: if `codebase_search` is called while files are queued, flush the queue first to ensure freshness.
- **Smart diffing (file-level):** Each indexed file stores `{ path, mtime, contentHash }`. On startup, walk the file
  tree and only re-process files where mtime differs. If a file changed, delete ALL its chunks and re-chunk + re-embed
  the whole file. Also delete chunks for files that no longer exist. Simple + fast — re-embedding a single file's chunks
  (typically 3-15) is milliseconds with a warm model.

## D5: Retrieval pipeline — vector + reranker, separate from grep (DECIDED)

`codebase_search` does pure semantic retrieval:

```
Query → embed with snowflake → top-20 ANN from LanceDB → rerank with ms-marco cross-encoder → threshold filter → return up to 5
```

No BM25 / FTS index. The agent already has `grep` for exact keyword matching — these remain separate tools with
different purposes:

- `grep` = "I know the identifier/string I'm looking for"
- `codebase_search` = "I know what concept I need but not what it's called or where it lives"

The LLM is good at knowing which tool to use situationally.

**Threshold filtering:** The cross-encoder reranker always returns results, even irrelevant ones. A minimum score
threshold filters out noise before returning to the agent. Results below threshold are dropped — the tool may return
fewer than 5 results or even 0 with a message like "No relevant code found for this query." The threshold value will
need to be tuned empirically (start with a conservative value and adjust).

**Response format:**

```json
[
    {
        "file": "src/auth/password.js",
        "lines": "14-28",
        "snippet": "export async function hashPassword(plainText) {\n  const salt = await bcrypt.genSalt(10);\n  return bcrypt.hash(plainText, salt);\n}"
    }
]
```

- Returns full chunk content (already structurally bounded by tree-sitter — one function/class/block).
- No score exposed to the LLM — everything returned is above threshold and considered relevant.
- File path + line range included so agent can `read` for broader context if needed.
- Tool parameter: `{ "query": "..." }` — simple string, no options needed.

## D9: Architecture — no extension, direct integration (DECIDED)

Remove the extension pattern entirely. The semantic engine is an internal module, tools are standard `defineTool()`
exports like other tools in `src/tools/`.

**Structure:**

```
src/semantic-engine/           # The engine (no extension API dependency)
  engine.js                    # Singleton: model loading, embed(), rerank()
  db.js                        # LanceDB connection (local + global tables)
  chunker.js                   # Tree-sitter AST chunking
  watcher.js                   # Deno.watchFs file watcher
  scanner.js                   # Full file tree scan (gitignore-aware, mtime tracking)

src/tools/memory-recall.js     # defineTool() exports
src/tools/memory-store.js
src/tools/memory-delete.js
src/tools/codebase-search.js
```

**Lifecycle wiring (in `src/shared/session/session.js`):**

- Engine initialization: lazy singleton in `runAgentSession` (init once on first call, reuse across agent invocations).
- Core memory injection: in the `systemPromptOverride` callback where the system prompt is already built.
- File watcher: started once after onboarding / session start.

The `src/extensions/mnemosyne/` directory is deleted. The `ensureMnemosyneBinary` preflight check is removed.

## D10: Memory tool interface (DECIDED)

Keep the existing tool interface unchanged:

- `memory_recall` — `{ query: string }`
- `memory_recall_global` — `{ query: string }`
- `memory_store` — `{ content: string, core?: boolean }`
- `memory_store_global` — `{ content: string, core?: boolean }`
- `memory_delete` — `{ id: number }`

Pure backend swap: same API contract, LanceDB storage underneath. IDs remain numeric (simpler for LLMs to parse from
recall output).

**Tags beyond `core`:** The schema will support arbitrary string tags internally, but for this plan only `core` is
exposed via the tool interface. Richer tag filtering (list by tag, filter recall by tag) can be added later as needed
for large codebases — not required for MVP.

## D11: Model loading strategy (DECIDED)

- **Embedding model (snowflake-arctic-embed-m-v1.5):** Load eagerly on session start. Needed for file watcher
  (re-embedding changed files) and core memory injection (querying LanceDB).
- **Cross-encoder (ms-marco-MiniLM-L-6-v2):** Load lazily on first `codebase_search` or `memory_recall` call. Only
  needed at query time; the user won't notice 1-2s on top of an LLM call.

If startup feels slow, the embedding model load can be deferred to when the first user message is sent (before the LLM
responds) — that gives a few seconds of buffer before any tool call could happen.

## D12: Core memory injection format (DECIDED)

Same mechanism as today (appended to system prompt in `systemPromptOverride` callback), simplified format:

```
Project Core Memories:

  [1]  Agent definitions and tool permissions use layered overrides...
  [5]  Harns CLI architecture: cli.js is a THIN entry point...

Global Core Memories:

  [12]  Prefer standard SQL over ORMs.

When to use memory:
- Search memory when past context would help...
- Store concise summaries of important decisions...
...
```

No collection name/count heading — the embedded engine knows the project context implicitly. IDs in brackets are the
numeric IDs for `memory_delete`.

## D13: LanceDB schemas (DECIDED)

**`code_chunks` table** (project-local at `.hns/index/code_chunks/`):

| Column        | Type                     | Purpose                                                                           |
| ------------- | ------------------------ | --------------------------------------------------------------------------------- |
| `id`          | integer (auto-increment) | Primary key                                                                       |
| `file`        | string                   | Relative file path                                                                |
| `startLine`   | integer                  | First line of chunk                                                               |
| `endLine`     | integer                  | Last line of chunk                                                                |
| `nodeType`    | string                   | AST node type (e.g., "function_declaration", "class_declaration", "module_scope") |
| `name`        | string (nullable)        | Function/class/method name if extractable                                         |
| `content`     | string                   | Full text of the chunk                                                            |
| `vector`      | float32[256]             | Embedding                                                                         |
| `mtime`       | integer                  | File mtime at indexing time                                                       |
| `contentHash` | string                   | SHA-256 of file content (detect changes even if mtime unreliable)                 |

**`memories` table** (project-local at `.hns/index/memories/`, global at `~/.hns/index/memories/`):

| Column      | Type                     | Purpose                              |
| ----------- | ------------------------ | ------------------------------------ |
| `id`        | integer (auto-increment) | Primary key, used in `memory_delete` |
| `content`   | string                   | The memory text                      |
| `tags`      | string (JSON array)      | Tags including "core"                |
| `vector`    | float32[256]             | Embedding                            |
| `createdAt` | integer                  | Unix timestamp                       |

Same schema for both project and global memory tables. Global table is a single unified collection for cross-project
user preferences — no project scoping needed.

## D14: `hns init` command + onboarding UX (DECIDED)

New command module at `src/cmd/init/index.js`, registered in `src/cmd/registry.js` and `COMMAND_NAMES` in
`constants.js`.

**Explicit `hns init`:**

1. Check if index already exists at `.hns/index/` → if so, ask "Re-index? This will rebuild the code index."
2. Run full scan → chunk → embed → store pipeline with progress indicator.
3. Remove any `~/.hns/onboarding/<hashed-cwd>/noindex` marker if present.
4. Mark post-onboarding mode active (index exists = onboarded).

**Auto-prompt onboarding (inside TUI):** When a user starts `hns` in an un-onboarded project (no index, no noindex
marker), the onboarding prompt renders _inside the TUI_ using the same `select()` / `confirm()` overlay mechanism from
`src/shared/prompts.js`. Input is blocked until the user answers.

- Shows: "Would you like to index this codebase for semantic search?" [Yes / No]
- **Yes**: Render a progress bar inside the TUI, block input until indexing completes, then transition to normal chat.
- **No**: Create `~/.hns/onboarding/<hashed-cwd>/noindex` marker. Show message: "Code search and memory features will be
  limited. Run `hns init` anytime to onboard." Then transition to normal chat (tools still work, just no index).

## D15: Two-tier tool system (DECIDED)

**Core tools** (always injected, not listed in agent frontmatter, cannot be removed by user overrides):

- `codebase_search`
- `memory_recall`, `memory_recall_global`
- `memory_store`, `memory_store_global`
- `memory_delete`
- `switch_agent`
- `triage_report`
- `plan_written`

These are Harns infrastructure — they make the SDLC and semantic backbone work. Removing them breaks the system.

**Agent tools** (customizable via frontmatter/overrides):

- `read`, `grep`, `find`, `ls`, `edit`, `write`, `bash`, `user_interview`, etc.
- These define what the agent _can do_ and are appropriate for user customization.

Implementation: Core tools remain in the bundled agent frontmatter `tools:` lists (source of truth for which agent gets
which core tools). On `loadAgentDef`, after layered merge, the system ensures core tools from the **bundled** layer are
always present in the final tool set — user overrides cannot remove them, only add. De-duplicated.

This means:

- Bundled `router.md` lists `triage_report`, `codebase_search`, `memory_recall`, etc.
- A user override at `.hns/agents/router.md` that only lists `tools: [read, bash]` won't strip the core tools.
- Users CAN add core tools to agents that don't have them by default.

If a user truly wants to replace a core tool (e.g., with their own search extension), extensions that register a tool
with the same name would override — but the default is "it just works."

**Graceful degradation (no index):** If the user declined onboarding and no index exists, `codebase_search` returns: "No
code index available. Fall back to grep and read for this session." No mention of `hns init` — respect the user's
decision. The LLM adjusts strategy accordingly.

## D16: File discovery for scanning (DECIDED)

Cascading strategy for finding indexable files:

1. **Try `git ls-files --cached --others --exclude-standard`** — handles all gitignore edge cases (nested, global,
   `.git/info/exclude`). If git is available and this is a git repo, use this.
2. **Fallback: parse `.gitignore` manually** — if not a git repo (or git unavailable), read `.gitignore` from project
   root and apply patterns ourselves using a glob-matching library.
3. **Fallback: built-in exclude list** — if no `.gitignore` exists either, use hardcoded excludes: `node_modules/`,
   `.git/`, `dist/`, `build/`, `target/`, `vendor/`, `.hns/`, `__pycache__/`, `.venv/`, `.env`

All paths additionally filtered by:

- Max file size (100KB) — skip likely generated/minified files.
- Binary detection (null-byte sniff in first 512 bytes).
- Lock files excluded (`package-lock.json`, `deno.lock`, `yarn.lock`, `Cargo.lock`, `go.sum`, etc.).

## D17: Migration — no formal migration, dev convenience script (DECIDED)

No user-facing migration. Pre-MVP, no users to break. A one-time dev convenience script (`scripts/migrate-mnemosyne.js`)
will:

1. Run `mnemosyne export --no-embeddings` to dump existing memories to JSONL.
2. Read each memory, re-embed with snowflake, and upsert into the new LanceDB tables.
3. Preserve tags (including `core`) and scope (project vs global).

This is a personal dev tool for the transition period, not shipped to users.

## D7: Runtime dependencies strategy (DECIDED)

Harns requires several runtime binaries/assets that can't be bundled into `deno compile` output:

- Tree-sitter native grammars (`.node` N-API addons)
- ONNX models (snowflake-arctic-embed-m-v1.5, ms-marco-MiniLM-L-6-v2)
- `fd` (fast file finder, like pi uses)

**Strategy:** `install.sh` handles downloading all runtime deps to `~/.hns/lib/` and `~/.hns/models/`. At runtime, the
compiled binary checks if deps exist. If not, it prints a clear message asking the user to run `install.sh`.

```
~/.hns/
  lib/
    tree-sitter/           # native grammar .node files
    fd                     # fd binary
  models/
    snowflake-arctic-embed-m-v1.5/   # ONNX embedding model
    ms-marco-MiniLM-L-6-v2/          # ONNX cross-encoder model
  sessions/
  index/                   # global memories LanceDB
    memories/
```

For source-run (`deno run -A src/cli.js`), tree-sitter grammars come from `node_modules/` (managed by
`nodeModulesDir: "auto"`). Models are still loaded from `~/.hns/models/` (or auto-downloaded by transformers.js cache).

## D8: Sleep command — manual only, updated for native LanceDB (DECIDED)

The `hns sleep` command remains manual-only for this plan. It will be rewritten to use the native LanceDB memory tools
instead of shelling out to mnemosyne. Core logic unchanged: LLM reviews all memories, identifies redundancy/staleness,
consolidates via delete + store.

A dedicated `memory_list` tool returns ALL memories (no semantic search, just a full dump). This is given to the
operator agent (which runs sleep) so the LLM can see everything and make consolidation decisions.

`memory_list` parameters: `{ scope: "local" | "global" }` — returns all memories with their IDs, content, and tags.

Auto-triggering (at session end with threshold heuristic) is a future enhancement tracked in TODO.md.

---

# Files to Modify / Create

## New files

| File                             | Purpose                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `src/semantic-engine/engine.js`  | Singleton: loads ONNX models, exposes `embed()` and `rerank()`                  |
| `src/semantic-engine/db.js`      | LanceDB connection manager (local code_chunks, local memories, global memories) |
| `src/semantic-engine/chunker.js` | Tree-sitter AST chunking + fallback strategies                                  |
| `src/semantic-engine/scanner.js` | Full file tree scan (gitignore-aware, mtime/hash tracking)                      |
| `src/semantic-engine/watcher.js` | `Deno.watchFs` with debounce + batch queue                                      |
| `src/tools/codebase-search.js`   | `defineTool()` — semantic code search                                           |
| `src/tools/memory-recall.js`     | `defineTool()` — project + global semantic memory recall                        |
| `src/tools/memory-store.js`      | `defineTool()` — project + global memory store                                  |
| `src/tools/memory-delete.js`     | `defineTool()` — delete memory by ID                                            |
| `src/tools/memory-list.js`       | `defineTool()` — full dump for sleep (operator only)                            |
| `src/cmd/init/index.js`          | `hns init` command                                                              |
| `scripts/migrate-mnemosyne.js`   | Dev convenience: export mnemosyne → import LanceDB                              |

## Modified files

| File                              | Change                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `deno.json`                       | Add `nodeModulesDir: "auto"`, add deps (`@lancedb/lancedb`, `@huggingface/transformers`, `tree-sitter`, grammars) |
| `src/constants.js`                | Add `COMMAND_NAMES.INIT`, core tools list constant                                                                |
| `src/cmd/registry.js`             | Register `init` command                                                                                           |
| `src/shared/session/session.js`   | Remove mnemosyne extension, wire engine init + core memory injection + tools                                      |
| `src/shared/runtime-preflight.js` | Remove `ensureMnemosyneBinary`, add engine/model readiness check                                                  |
| `src/agent-definitions/*.md`      | Add `codebase_search` to all agents, add `memory_list` to operator                                                |
| `src/cmd/sleep/index.js`          | Update sleep to use native tools instead of mnemosyne binary                                                      |
| `src/prompt-templates/sleep.md`   | Rewrite to reference `memory_list` / `memory_delete` / `memory_store`                                             |
| `install.sh`                      | Download tree-sitter grammars, ONNX models, fd to `~/.hns/`                                                       |
| `.gitignore`                      | Add `.hns/`                                                                                                       |

## Deleted files

| File                                     | Reason                             |
| ---------------------------------------- | ---------------------------------- |
| `src/extensions/mnemosyne/index.js`      | Replaced by native semantic engine |
| `src/extensions/mnemosyne/index_test.js` | Tests replaced                     |

---

# Implementation Steps

### Phase 1: Foundation (engine + storage)

- [ ] **T1:** Update `deno.json` — add `nodeModulesDir: "auto"`, add npm imports for `@lancedb/lancedb`,
      `@huggingface/transformers`, `tree-sitter`, `tree-sitter-javascript`, `tree-sitter-typescript`,
      `tree-sitter-python`, `tree-sitter-go`, `tree-sitter-rust`.
- [ ] **T2:** Build `src/semantic-engine/engine.js` — singleton that loads snowflake embedding model (eager) and
      ms-marco cross-encoder (lazy). Exposes `embed(text) → float32[256]`, `embedBatch(texts) → float32[256][]`,
      `rerank(query, candidates) → scored[]`. Handles Matryoshka truncation + re-normalization.
- [ ] **T3:** Build `src/semantic-engine/db.js` — LanceDB connection manager. Opens/creates tables at the correct paths
      (project code_chunks, project memories, global memories). Exposes CRUD operations: `addChunks()`,
      `deleteChunksByFile()`, `searchChunks()`, `addMemory()`, `deleteMemory()`, `searchMemories()`, `listMemories()`,
      `listCoreMemories()`.

### Phase 2: Chunking + scanning

- [ ] **T4:** Build `src/semantic-engine/chunker.js` — tree-sitter AST parsing per language. Maps file extension →
      grammar. Extracts structural nodes, handles chunk size limits (class splitting, function windowing). Falls back to
      line-based chunking for unknown languages. Section splitting for .md/.yaml.
- [ ] **T5:** Build `src/semantic-engine/scanner.js` — file discovery (git ls-files → gitignore parse → built-in
      excludes). File filtering (size, binary detection, lock files). Returns list of files to index with their
      mtime/hash.

### Phase 3: Indexing pipeline + init command

- [ ] **T6:** Build `src/cmd/init/index.js` — `hns init` command. Orchestrates: scan → chunk → embed → store. Shows
      progress indicator. Register in `registry.js` and `constants.js`.
- [ ] **T7:** Build incremental re-indexing logic (in scanner or db) — compare current file tree mtimes against stored
      metadata, identify changed/new/deleted files, re-index only those.

### Phase 4: File watcher

- [ ] **T8:** Build `src/semantic-engine/watcher.js` — `Deno.watchFs` with per-file debounce (500ms), global batch queue
      (5 files / 2s tick), flush-on-search. Respects same file filters as scanner.

### Phase 5: Tools

- [ ] **T9:** Build `src/tools/codebase-search.js` — `defineTool()` for `codebase_search`. Calls flush-on-search, then
      embed query → top-20 ANN → rerank → threshold filter → return up to 5. Graceful degradation if no index.
- [ ] **T10:** Build `src/tools/memory-recall.js` — `defineTool()` for `memory_recall` and `memory_recall_global`. Embed
      query → search memories table → rerank → return results with IDs.
- [ ] **T11:** Build `src/tools/memory-store.js` — `defineTool()` for `memory_store` and `memory_store_global`. Embed
      content → insert into appropriate LanceDB table with tags + timestamp.
- [ ] **T12:** Build `src/tools/memory-delete.js` — `defineTool()` for `memory_delete`. Delete by numeric ID from
      project memory table (scope determined by which table has that ID).
- [ ] **T13:** Build `src/tools/memory-list.js` — `defineTool()` for `memory_list`. Returns all memories for a given
      scope. Used by operator during sleep.

### Phase 6: Session integration

- [ ] **T14:** Update `src/shared/session/session.js` — remove mnemosyne extension factory. Add engine singleton
      initialization. Wire core memory injection into `systemPromptOverride`. Register new tools as `customTools`.
      Implement two-tier tool logic in `loadAgentDef` (bundled core tools protected from override removal).
- [ ] **T15:** Add onboarding prompt logic — on session start, check for index existence / noindex marker. Show TUI
      overlay prompt via `select()`. If yes, run init pipeline with progress. If no, create marker.
- [ ] **T16:** Start file watcher after successful onboarding or on session start (post-onboarding).

### Phase 7: Agent definitions + sleep

- [ ] **T17:** Update all `src/agent-definitions/*.md` — add `codebase_search` to all agents. Add `memory_list` to
      operator. Remove memory tools from frontmatter where they'll be core-injected (or leave for clarity — dedup
      handles it).
- [ ] **T18:** Rewrite `src/prompt-templates/sleep.md` — reference `memory_list`, `memory_delete`, `memory_store`
      instead of mnemosyne CLI commands.
- [ ] **T19:** Update `src/cmd/sleep/index.js` — remove `ensureMnemosyneBinary` call. The operator agent now uses native
      tools.

### Phase 8: Cleanup + infrastructure

- [ ] **T20:** Delete `src/extensions/mnemosyne/index.js` and `src/extensions/mnemosyne/index_test.js`.
- [ ] **T21:** Remove `ensureMnemosyneBinary` from `src/shared/runtime-preflight.js`. Add model/dependency readiness
      checks if needed.
- [ ] **T22:** Update `install.sh` — add steps to download ONNX models and tree-sitter grammars to `~/.hns/`.
- [ ] **T23:** Update `.gitignore` — add `.hns/` and `node_modules/`.
- [ ] **T24:** Write `scripts/migrate-mnemosyne.js` — dev convenience script for transition.

### Phase 9: Testing

- [ ] **T25:** Unit tests for `chunker.js` — verify structural extraction for JS, TS, Python, Go, Rust. Verify chunk
      size limits (class splitting, function windowing). Verify fallback chunking.
- [ ] **T26:** Unit tests for `scanner.js` — verify gitignore handling, binary detection, size filtering.
- [ ] **T27:** Integration tests for `engine.js` + `db.js` — embed → store → search → rerank pipeline.
- [ ] **T28:** Integration tests for memory tools — store, recall, delete lifecycle.
- [ ] **T29:** Integration test for `hns init` — full indexing pipeline on a test fixture project.
- [ ] **T30:** Run `deno run ci` and fix all issues.

---

# Verification

- [ ] `deno run ci` passes (check, lint, fmt, test).
- [ ] `hns init` successfully indexes the harns codebase itself (dogfood).
- [ ] `codebase_search` returns relevant results for queries like "how does agent session routing work?" and "where are
      tool definitions loaded?".
- [ ] `memory_store` + `memory_recall` round-trips correctly (store a memory, recall it by semantic query).
- [ ] `memory_delete` removes memories and they no longer appear in recall or core injection.
- [ ] Core memory injection appears in system prompt when core memories exist.
- [ ] File watcher detects edits and re-indexes (verify by editing a file, then searching for the new content).
- [ ] Onboarding prompt appears on first run in a new project, doesn't appear again after answering.
- [ ] `hns sleep` successfully runs with the operator using `memory_list` + native tools.
- [ ] Graceful degradation: `codebase_search` returns helpful message when no index exists.
