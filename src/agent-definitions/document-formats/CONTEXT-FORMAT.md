# CONTEXT.md Format

## Structure

```md
# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## Language

**Order**: {A concise description of the term} _Avoid_: Purchase, transaction

**Invoice**: A request for payment sent to a customer after delivery. _Avoid_: Bill, payment request

**Customer**: A person or organization that places orders.

## Relationships

- An **Order** produces one or more **Invoices**
- An **Invoice** belongs to exactly one **Customer**
```

## Rules

- **Be opinionated.** When multiple words exist for the same concept, pick the best one and list the others as aliases
  to avoid.
- **Keep definitions tight.** One sentence max. Define what it IS, not what it does.
- **Show domain relationships.** Use bold term names and express cardinality where obvious. Relationships must describe
  stable domain facts, not code ownership, module dependencies, implementation flow, or architectural decisions.
- **Describe current truth only.** Proposed terms and relationships belong in PRDs and Plans until the implementation
  that makes them true updates `CONTEXT.md` in the same change.
- **Use `_Avoid_` only when it prevents real ambiguity.** Keep rejected or overloaded aliases beside the affected term,
  but omit the list when ordinary synonyms cannot plausibly change meaning.
- **Only include terms specific to this project's context.** General programming concepts (timeouts, error types,
  utility patterns) don't belong even if the project uses them extensively. Before adding a term, ask: is this a concept
  unique to this context, or a general programming concept? Only the former belongs.
- **Group terms under subheadings** when natural clusters emerge. If all terms belong to a single cohesive area, a flat
  list is fine.
- **Keep implementation details out.** `CONTEXT.md` is a domain glossary with stable relationships. It is not a spec,
  architecture overview, project map, scratch pad, implementation journal, plan, roadmap, or future-state proposal.

## Single vs multi-context repos

**Single context (most repos):** One `CONTEXT.md` at the repo root.

**Multiple contexts:** A `CONTEXT-MAP.md` at the repo root lists the contexts, where they live, and how they relate to
each other:

```md
# Context Map

## Contexts

- [Ordering](./src/ordering/CONTEXT.md) — receives and tracks customer orders
- [Billing](./src/billing/CONTEXT.md) — generates invoices and processes payments
- [Fulfillment](./src/fulfillment/CONTEXT.md) — manages warehouse picking and shipping

## Relationships

- **Ordering → Fulfillment**: Ordering emits `OrderPlaced` events; Fulfillment consumes them to start picking
- **Fulfillment → Billing**: Fulfillment emits `ShipmentDispatched` events; Billing consumes them to generate invoices
- **Ordering ↔ Billing**: Shared types for `CustomerId` and `Money`
```

The skill infers which structure applies:

- If `CONTEXT-MAP.md` exists, read it to find contexts
- If only a root `CONTEXT.md` exists, single context
- If neither exists, create a root `CONTEXT.md` lazily when the first term is resolved

When multiple contexts exist, infer which one the current topic relates to. If unclear, ask.
