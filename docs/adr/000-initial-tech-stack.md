---
status: accepted
---

# 000 - Initial Technology Stack

## Context

RunWield is designed to be an opinionated, plan-by-default coding harness that operates directly in the developer's
terminal. To ensure high maintainability, extreme execution speed, and an iteration cycle that feels instantaneous, the
foundational technology stack must be chosen carefully.

We need an environment that allows for rapid scripting without the overhead of heavy compilation pipelines, while still
maintaining strict type safety and leveraging modern, robust foundations for agentic AI interactions.

## Decision

We have selected the following foundational stack for RunWield:

1. **Runtime: Deno**
   - **Why:** Deno provides a modern, secure-by-default JavaScript runtime with built-in utilities (formatter, linter,
     test runner). It eliminates the need for `package.json` bloat, `node_modules` hell, and complex build tooling,
     perfectly aligning with a zero-friction CLI ethos.

2. **Language: Deno-native JavaScript/TypeScript mix**
   - **Why:** Superseded by [ADR-013](013-deno-native-typescript-ratchet.md). Existing JavaScript with JSDoc remains
     valid, but new production source under `src/` is ratcheted toward native TypeScript (`.ts`/`.tsx`) while preserving
     direct Deno execution and avoiding a TypeScript emit pipeline.

3. **Agent Foundation: `pi-mono` Ecosystem**
   - **Why:** Instead of building an LLM orchestration layer from scratch, RunWield will heavily leverage
     `@mariozechner/pi-coding-agent`, `pi-tui`, and related packages from the `pi-mono` ecosystem. These packages
     provide the core state machines, tool-calling wrappers, and terminal UI components needed to build a sophisticated
     agent workflow, allowing RunWield to focus strictly on the opinionated DAG execution and architectural routing.

## Consequences

### Positive

- **Instant Execution:** No build steps mean the CLI boots and executes immediately.
- **Simplified Tooling:** `deno test`, `deno lint`, and `deno fmt` replace an entire ecosystem of fragmented Node.js
  tooling (Jest, ESLint, Prettier).
- **Agent Synergy:** Using `pi-mono` allows RunWield to inherit battle-tested LLM abstractions and focus purely on the
  "Gatekeeper" and planning logic.
- **Type Safety without Friction:** Deno-native checking provides a safety net without a separate runtime compilation
  tax; see ADR-013 for the current language ratchet.

### Negative

- **Ecosystem Lock-in:** Heavy reliance on Deno-specific APIs (`Deno.readTextFile`, `Deno.watchFs`) makes porting the
  tool back to Node.js non-trivial if the need ever arises.
- **JSDoc Verbosity:** Writing complex generic types in JSDoc can occasionally be more verbose and visually noisy
  compared to native TypeScript syntax.
