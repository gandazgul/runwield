# 000 - Initial Technology Stack

## Status

Accepted

## Context

Harns is designed to be an opinionated, plan-by-default coding harness that operates directly in the developer's
terminal. To ensure high maintainability, extreme execution speed, and an iteration cycle that feels instantaneous, the
foundational technology stack must be chosen carefully.

We need an environment that allows for rapid scripting without the overhead of heavy compilation pipelines, while still
maintaining strict type safety and leveraging modern, robust foundations for agentic AI interactions.

## Decision

We have selected the following foundational stack for Harns:

1. **Runtime: Deno**
   - **Why:** Deno provides a modern, secure-by-default JavaScript runtime with built-in utilities (formatter, linter,
     test runner). It eliminates the need for `package.json` bloat, `node_modules` hell, and complex build tooling,
     perfectly aligning with a zero-friction CLI ethos.

2. **Language: Vanilla JavaScript with JSDoc**
   - **Why:** We will write pure ES Modules (`.js`) and use JSDoc comments for type-checking. This completely eliminates
     the TypeScript transpilation step (`tsc` or `esbuild`). The codebase remains type-safe via Deno's native LSP, but
     execution is instantaneous. This is critical for dogfooding Harns: when the agent writes or modifies code, there is
     no build step required before the next agent session can test the change.

3. **Agent Foundation: `pi-mono` Ecosystem**
   - **Why:** Instead of building an LLM orchestration layer from scratch, Harns will heavily leverage
     `@mariozechner/pi-coding-agent`, `pi-tui`, and related packages from the `pi-mono` ecosystem. These packages
     provide the core state machines, tool-calling wrappers, and terminal UI components needed to build a sophisticated
     agent workflow, allowing Harns to focus strictly on the opinionated DAG execution and architectural routing.

## Consequences

### Positive

- **Instant Execution:** No build steps mean the CLI boots and executes immediately.
- **Simplified Tooling:** `deno test`, `deno lint`, and `deno fmt` replace an entire ecosystem of fragmented Node.js
  tooling (Jest, ESLint, Prettier).
- **Agent Synergy:** Using `pi-mono` allows Harns to inherit battle-tested LLM abstractions and focus purely on the
  "Gatekeeper" and planning logic.
- **Type Safety without Friction:** JSDoc provides the safety net of TypeScript without the runtime or compilation tax.

### Negative

- **Ecosystem Lock-in:** Heavy reliance on Deno-specific APIs (`Deno.readTextFile`, `Deno.watchFs`) makes porting the
  tool back to Node.js non-trivial if the need ever arises.
- **JSDoc Verbosity:** Writing complex generic types in JSDoc can occasionally be more verbose and visually noisy
  compared to native TypeScript syntax.
