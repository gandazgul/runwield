# ADR-001: Unified Local Semantic Indexer (Code + Memory)

## Status

Accepted (revised)

## Context

Harns needs two capabilities for its agents to work effectively:

1. **Semantic code search** — agents should find relevant code by concept ("how are passwords hashed?") without
   exhaustive `grep`/`read` exploration. This reduces token waste and improves triage quality.
2. **Persistent memory** — agents need to recall project decisions, user preferences, and architectural context across
   sessions.

Previously, memory was handled by an external Go binary (`mnemosyne`) invoked via subprocess. This worked for
sentence-length memories but has fundamental limitations:

- Mnemosyne's document model (2 sentences max) is not optimized for code chunks (50-200 lines).
- Subprocess overhead per operation (one `mnemosyne add` call per chunk) makes bulk indexing slow.
- No incremental upsert — must delete + re-add on file change.
- Two separate systems (mnemosyne for memory, nothing for code) means duplicated model loading and deployment friction.

## Decision

Build a **unified in-process semantic engine** natively in Harns that handles both memory and codebase indexing. This
replaces the external `mnemosyne` Go binary entirely. The engine lives at `src/semantic-engine/` and tools are standard
`defineTool()` exports in `src/tools/`.

### Technology Stack

| Component      | Technology                                                                | Rationale                                                                       |
| -------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Vector storage | `@lancedb/lancedb` (npm)                                                  | Works in Deno, fast batch upserts, SQL-like filter queries, Rust bindings       |
| Embeddings     | `Snowflake/snowflake-arctic-embed-m-v1.5` via `@huggingface/transformers` | 256-dim (Matryoshka truncation), top of benchmarks for small open-weight models |
| Reranking      | `cross-encoder/ms-marco-MiniLM-L-6-v2` via `@huggingface/transformers`    | High precision, same model mnemosyne used                                       |
| AST chunking   | `tree-sitter` (native N-API via npm)                                      | Multi-language structural parsing (JS, TS, Python, Go, Rust)                    |

All verified working in Deno via PoC testing. Requires `"nodeModulesDir": "auto"` in deno.json for tree-sitter's native
N-API addon.

### Architecture

```
src/semantic-engine/
  engine.js         # Singleton: model loading, embed(), rerank()
  db.js             # LanceDB connection manager (local + global tables)
  chunker.js        # Tree-sitter AST chunking + fallback strategies
  scanner.js        # File discovery (gitignore-aware, mtime tracking)
  watcher.js        # Deno.watchFs file watcher with debounce + batch queue

src/tools/
  codebase-search.js   # Semantic code search tool
  memory-recall.js     # Project + global memory recall
  memory-store.js      # Memory creation
  memory-delete.js     # Memory deletion by ID
  memory-list.js       # Full dump for sleep consolidation
```

No extension pattern — lifecycle wiring (engine init, core memory injection, watcher startup) is handled directly in
`src/shared/session/session.js`.

### Retrieval Pipeline

```
Query → embed with snowflake (256-dim) → top-20 ANN from LanceDB → rerank with ms-marco → threshold filter → return up to 5
```

No BM25/FTS index. The agent already has `grep` for exact keyword matching — the two tools serve different purposes:

- `grep` = "I know the identifier/string I'm looking for"
- `codebase_search` = "I know what concept I need but not where it lives"

### Disk Layout

| Scope              | Path                                      |
| ------------------ | ----------------------------------------- |
| Project code index | `.hns/index/code_chunks/`                 |
| Project memories   | `.hns/index/memories/`                    |
| Global memories    | `~/.hns/index/memories/`                  |
| Model cache        | `~/.hns/models/` (shared across projects) |

### Onboarding Lifecycle

- First run: prompt inside TUI "Would you like to index this codebase?" — blocks input until answered.
- Yes → full index with progress bar. No → noindex marker at `~/.hns/onboarding/<hashed-cwd>/noindex`.
- Post-onboarding: incremental re-indexing on session start (mtime diffing) + live file watcher during session.
- `hns init` command for explicit (re-)indexing.

### Chunking Strategy

- **Tree-sitter languages** (JS, TS, Python, Go, Rust): Extract structural AST nodes (functions, classes, methods,
  interfaces, type declarations). Chunk size limit: 100 lines. Large classes split at method boundaries; large functions
  split into overlapping windows.
- **Fallback** (unknown languages): Line-based heuristic chunking.
- **Non-code** (.md, .yaml): Section-based splitting.

### Model Loading

- Embedding model: loaded eagerly on session start (needed for watcher + core memory queries).
- Cross-encoder: loaded lazily on first search/recall call.

## Consequences

### Positive

- **Single binary, single process** — no external dependency on mnemosyne or any other binary for core functionality.
- **Token efficiency** — agents receive exact, structurally-bounded snippets instead of whole files.
- **Multi-language** — tree-sitter grammars are additive; new languages are just an npm package away.
- **Incremental** — only changed files are re-indexed; startup stays fast even for large repos.
- **Privacy** — 100% local. No code sent to embedding APIs.

### Negative

- **Initial model download** — ~200MB of ONNX models on first use (one-time).
- **nodeModulesDir** — tree-sitter requires `"nodeModulesDir": "auto"`, adding a `node_modules/` folder.
- **CPU usage** — background watcher + embedding consumes idle CPU during active sessions (mitigated by debouncing and
  batch queue limits).
- **`deno compile` complexity** — native N-API addons don't bundle into compiled binary. Solved via `install.sh`
  downloading runtime deps to `~/.hns/lib/`.
