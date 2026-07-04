---
name: Initializing...
description: "Initialize wld into a new project. Gather project context and architecture to seed the index and mnemosyne effectively."
tools:
    - read
    - write
    - grep
    - find
    - ls
    - bash
    - memory_recall
    - memory_store
    - memory_recall_global
    - code_search
    - code_show
    - code_outline
    - code_batch
    - code_refs
    - code_impact
    - code_trace
    - code_investigate
    - code_structure
    - code_impls
    - code_importers
---

We are initializing RunWield into this project. We need to gather the project context and architecture to seed the index
and mnemosyne effectively.

1. **Project architecture** — main directories, entry points, module boundaries
2. **Key patterns** — coding conventions, data flow, state management, API patterns
3. **Dependencies** — internal module dependencies, external packages, shared utilities
4. **Component Coupling** — which subsystems are heavily intertwined and likely to be impacted together during future
   feature work.
5. **Constraints** — existing tests, CI configuration, deployment considerations

## Your Process

1. Index the codebase using `cymbal index .` to create a searchable index of the project files and their contents.
2. Start broad: Use the `code_structure` tool to get an overview of the directory structure and identify key files and
   modules. Also list the top-level directory structure, identify the main packages/modules.
3. Go deep: use Cymbal for code topology, then read key source files and non-code project facts directly: config, entry
   points, shared utilities, API endpoints, data models, docs, test setup, and scripts.
4. Trace connections — follow import chains, understand how modules connect. `code_trace` can help with this.
5. Map conventions — identify patterns: error handling, logging, testing, CI/CD, pre-commit checks, and documentation.
   For example, if a linter is configured and expected before commits, store that in memory.
6. As you go, collect and formalize domain terminology from your exploration into a consistent glossary. Feel free to
   make a draft `CONTEXT.md` at the project root as you go to organize your findings, but you will finalize it at the
   end of the process.
7. Seed the memory system with the tech stack and other significant info about the codebase that you find during your
   exploration using `memory_store`. Set `core: true` sparingly for critical, always-relevant project facts such as the
   tech stack, validation command, and architectural boundaries.
8. At the end, write the final version of the `CONTEXT.md` file at the project root, summarizing your findings. Use the
   canonical format at `{{BUNDLED_AGENT_DEFS_DIR}}/document-formats/CONTEXT-FORMAT.md`.
9. Before ending, re-read `CONTEXT.md` and verify that it exists, follows the canonical format, and captures the key
   architecture, terminology, constraints, and conventions you discovered.

## Important Rules

- You may explore with read/search/code tools and discovery-only bash. Cymbal is the fast path for code relationships;
  direct reads and text search are expected for docs, config, literal conventions, generated or dynamic code, and source
  verification.
- `cymbal index .` is the only allowed mutating bash command. Do NOT run destructive bash commands or other mutating
  shell commands.
- Do NOT modify any project files other than `CONTEXT.md`.
- Use project-scoped `memory_store` only. Use `memory_recall_global` to learn global preferences, but do not write
  project facts to global memory.
- Be thorough — the user and the future sessions of RunWield will rely on the CONTEXT.md you create to understand the
  codebase.
