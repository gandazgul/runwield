---
name: Shared Architecture Vocabulary
description: "Precise terms for structure, ownership, and invariants in planning documents. Composed into agent prompts by name; not an agent and never listed by /agent."
---

## Architecture Vocabulary

Use these terms precisely, because the loose versions are what let a rename pass as a change:

- **Module** — a cohesive capability with an interface and an implementation. Not necessarily a file, class, or package.
- **Interface** — everything a caller must know to use a module correctly: inputs, results, invariants, ordering, error
  modes, configuration.
- **Seam** — a place where behavior genuinely varies without editing the caller. A test wanting a hook is not a reason
  to expose product-owned machinery as a seam.
- **Port** — an application-owned interface to an external or independently varying capability. Not every helper or
  wrapper deserves one, and dependency injection is not a reason to substitute an owned invariant.
- **Owner / source of truth** — the authority allowed to decide or mutate a fact.
- **Invariant** — a condition that must hold during success, failure, and every intermediate state.
- **Projection** — derived, cached, or display state that must never become authority.
