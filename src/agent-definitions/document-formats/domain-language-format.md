# Domain Language Format

A domain-language file is RunWield's durable glossary for implemented project terminology. It records stable current
truth for Agents, Skills, docs, Plans, and code.

## Purpose

Use domain-language files to capture:

- canonical terms and definitions;
- avoided aliases and confusing alternatives;
- stable relationships between domain concepts;
- durable ambiguity that has been explicitly flagged but not resolved.

Do not use domain-language files as implementation notes, roadmaps, PRDs, ADRs, or scratchpads for proposed terms.
Proposed language belongs in PRDs and Plans until implementation makes it true.

## Layouts

**Single context:** one project glossary at `docs/domain-language.md`.

**Multiple contexts:** one project map at `docs/domain-language-map.md`. The map lists contexts, where they live, and
which per-context glossary applies. Each context directory owns its glossary as `domain-language.md` directly in that
directory.

Example map:

```markdown
# Domain Language Map

- [Ordering](./src/ordering/domain-language.md) — receives and tracks customer orders
- [Billing](./src/billing/domain-language.md) — generates invoices and processes payments
- [Fulfillment](./src/fulfillment/domain-language.md) — manages warehouse picking and shipping
```

## Discovery

- If `docs/domain-language-map.md` exists, read it to find the relevant context glossary.
- If only `docs/domain-language.md` exists, treat the repository as a single-context project.
- If neither exists, create `docs/domain-language.md` lazily when the first implemented term needs to be recorded.
- Do not assign RunWield domain-language meaning to other harness context filenames or case variants.

## Migration

On project-capable startup, RunWield temporarily migrates exact-uppercase artifacts created by older RunWield versions
to these canonical paths. Existing canonical destinations always win; startup warns instead of overwriting or merging.
This compatibility behavior is not a readable fallback and may be removed only by a future breaking-change Planned
Change.

## File Shape

```markdown
# <Project or Context> Domain Language

Short paragraph explaining the product/context boundary.

## Language

### <Category>

**Canonical Term**: Definition in current implemented truth. Include stable relationships to other terms. _Avoid_: Alias
A, Alias B

**Another Term**: Definition.

## Open Language Questions

- **Question**: Concise durable ambiguity, owner decision needed, and current safe wording.
```

Keep entries concise and deterministic. Prefer editing existing definitions over adding near-duplicates.
