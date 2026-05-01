# ADR-002: Codebase Optimization — Centralized Types, Pure Handlers, and Shared Helpers

## Status

Accepted

## Context

The Harns codebase has grown organically. Several modules use `any` and `unknown` JSDoc types, command handler patterns
are duplicated across `cmd/` modules, and `chat-session.js::editor.onSubmit` has ballooned to 350+ lines. The triage
report flagged these for systematic cleanup to reach production-grade quality.

Scope was later expanded to cover all type positions across `src/` (runtime and tests), not just an initial subset.

## Decisions

### 1. Centralized JSDoc type definitions (`src/shared/types.js`)

Cross-module types that are currently `any` or duplicated inline (e.g. `ImageAttachment`, `AgentMessageHandler`,
`CommandContext`) will live in a single `src/shared/types.js` module. Other modules import them via
`@typedef {import('./types.js').Foo} Foo`. This reduces drift and makes type intent explicit without adding a build-step
type checker.

### 2. Pure function event handlers for `chat-session.js`

The monolithic `editor.onSubmit` closure will be decomposed into focused, named async functions (`handleBashCommand`,
`handleSlashCommand`, `handleAgentMessage`) that receive their dependencies and mutable state through an explicit
`ChatSessionContext` parameter object. This makes the handlers testable and eliminates the need for deep closure
nesting.

### 3. Shared command helpers (`src/shared/command-helpers.js`)

Three repeated patterns were identified:

- TUI state reset (`disableSubmit`, `setBusy(false)`, `enableInput()`, `setFocus(editor)`)
- Error-to-string formatting (`err instanceof Error ? err.message : String(err)`)
- Repair-loop prompt text (identical string in `router/index.js` and `resume/index.js`)

These will be extracted into `src/shared/command-helpers.js` so that `cmd/` modules consume them rather than duplicating
logic.

## Consequences

- **Positive**: Fewer `any` types, smaller functions, DRY command handlers, clearer concurrency semantics.
- **Negative**: A new shared types module introduces a dependency hub; changes to it affect many files. We mitigate this
  by keeping the module stable and additive-only after initial creation.
- **Migration**: All modified files must pass `deno run ci` before the plan is considered complete.
