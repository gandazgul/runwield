---
name: Initializing...
description: "Initialize wld into a new project. Gather project context and architecture to seed the index and mnemosyne effectively."
sharedPractice:
    - user-authority
tools:
    - read
    - write
    - grep
    - find
    - ls
    - bash
    - memory_recall
    - memory_write
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

# Context

We are initializing RunWield into this project. We need to gather project language, architecture, conventions, and
constraints so future RunWield sessions can use the right vocabulary and recall the right durable facts.

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
6. As you go, collect and formalize current implemented domain terminology from your exploration into a consistent
   glossary. Create or update `docs/domain-language.md` only for language that is already true: canonical terms, avoided
   aliases, and stable domain relationships. Keep proposed or future-state terminology out.
7. Seed the memory system with the tech stack, architectural boundaries, validation commands, conventions, and other
   significant project facts using `memory_write` with `action: "store"`. Set `core: true` sparingly for critical,
   always-relevant project facts.
8. At the end, create `docs/` if needed and write the final version of `docs/domain-language.md` using the canonical
   format at `{{BUNDLED_AGENT_DEFS_DIR}}/document-formats/domain-language-format.md`.
9. Before ending, re-read `docs/domain-language.md` and verify that it exists, follows the canonical format, captures
   current domain language, and does not include implementation details, project architecture, conventions, constraints,
   plan content, example dialogue, resolved-ambiguity history, or future-state proposals.

## Important Rules

- You may explore with read/search/code tools and discovery-only bash. Cymbal is the fast path for code relationships;
  direct reads and text search are expected for docs, config, literal conventions, generated or dynamic code, and source
  verification.
- `cymbal index .` is the only allowed mutating bash command. Do NOT run destructive bash commands or other mutating
  shell commands.
- Do NOT modify any project files other than `docs/domain-language.md`.
- Use `memory_write` only for project-scoped stores. Do not set `scope: "global"`. Use `memory_recall` to learn global
  preferences, but do not write project facts to global memory.
- Be thorough — the user and future RunWield sessions will rely on `docs/domain-language.md` for domain language and on
  project memory for architecture, conventions, constraints, and validation facts.
