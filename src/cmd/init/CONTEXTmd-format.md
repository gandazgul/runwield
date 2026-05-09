# {{Project Name}} - Context Overview

Brief description of what the project does and its high-level architecture.

## Language

Extract and formalize domain terminology from your exploration into a consistent glossary.

e.g.

### Order lifecycle

| Term        | Definition                                              | Aliases to avoid      |
| ----------- | ------------------------------------------------------- | --------------------- |
| **Order**   | A customer's request to purchase one or more items      | Purchase, transaction |
| **Invoice** | A request for payment sent to a customer after delivery | Bill, payment request |

### People

| Term         | Definition                                  | Aliases to avoid       |
| ------------ | ------------------------------------------- | ---------------------- |
| **Customer** | A person or organization that places orders | Client, buyer, account |
| **User**     | An authentication identity in the system    | Login, account         |

### Relationships

- An **Invoice** belongs to exactly one **Customer**
- An **Order** produces one or more **Invoices**

## Key Files

Entry points, configs, where are the docs? Any other gravity centers of the codebase?

## Patterns & Conventions

Coding patterns, naming conventions, error handling approaches, etc.
