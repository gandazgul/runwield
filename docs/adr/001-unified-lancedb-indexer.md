# 1. Unified Local Semantic Indexer (Code + Memory)

Date: 2026-04-29

## Status

Accepted

## Context

Harns operates on a strict principle of Token Parsimony and fast TTFT (Time to First Token). As the system scales to handle `PROJECT` level classifications and large legacy codebases, injecting entire files into the context window for `QUICK_FIX` or `FEATURE` requests is unsustainable. We need a way to provide agents with hyper-relevant code snippets (Context Handoff).

Simultaneously, Harns relies on an external memory system, Mnemosyne, to store and retrieve architectural decisions, user preferences, and core project DNA. Previously, Mnemosyne was conceived as a separate pipeline/binary. Running two separate AI pipelines means paying the RAM and cold-start penalty for ONNX models twice, complicating deployment, and duplicating the vector storage logic.

## Decision

We will absorb the Mnemosyne memory system directly into the Harns binary and build a **Unified Local Semantic Indexer** using LanceDB. 

The architecture will rely entirely on local execution natively within Deno, with zero cloud dependencies or external Python environments:

1. **Storage Engine (`@lancedb/lancedb`)**: 
   - A multi-table LanceDB instance.
   - **Local Scope:** `.hns/index/` will store ephemeral `code_chunks` (rebuilt on file changes) and `project_memories`.
   - **Global Scope:** `~/.config/harns/index/` will store persistent `global_memories`.

2. **Embedding & Re-ranking (`npm:@huggingface/transformers`)**:
   - We will run ONNX models natively via transformers.js.
   - **Recall (Embeddings):** `Xenova/snowflake-arctic-embed-m-v1.5` (256-dim). The 256-dimensional space is the optimal sweet spot for speed and disk footprint in a single-repo context.
   - **Precision (Cross-Encoder):** `Xenova/ms-marco-MiniLM-L-6-v2`. Reranks the top 50 vector results to yield the top 3-5 hyper-relevant snippets, ensuring the LLM only receives high-signal context.

3. **Structural Chunking (`npm:web-tree-sitter`)**:
   - Instead of naive character-count chunking, we will use Tree-sitter WASM to parse the AST.
   - Files will be chunked by structural boundaries (functions, classes, interfaces) to preserve semantic integrity.

4. **Lifecycle & Opt-in**:
   - The indexer will run silently in the background using `Deno.watchFs` to debounce and re-embed modified files.
   - To respect system resources, Harns will prompt the user to initialize the index on first run. If declined, Harns degrades gracefully to standard LLM file reading (with warnings for large files).

## Consequences

### Positive
- **Extreme Speed:** Running everything in-process via Deno and LanceDB Rust bindings eliminates network I/O and local HTTP overhead.
- **Token Efficiency:** Agents receive exact line-numbered snippets instead of 5,000-line monoliths.
- **Maintainer Velocity:** A single codebase and binary (`hns`) handles routing, planning, codebase search, and memory retrieval.
- **Privacy:** 100% local context. No proprietary code is sent to third-party embedding APIs.

### Negative
- **Initial Payload:** The first initialization will require downloading the ONNX models (~100-200MB) to the user's local cache.
- **Background CPU:** The `Deno.watchFs` listener and re-indexing pipeline will consume some idle CPU resources during active development, requiring careful debouncing logic.
