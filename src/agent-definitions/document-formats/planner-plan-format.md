---
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX|FEATURE|REFACTOR|MAINTENANCE|DOCUMENTATION"
complexity: "LOW|MEDIUM|HIGH"
summary: "<Brief summary of the planned change>"
affectedPaths:
    - "path/to/file1"
    - "path/to/file2"
# Optional: only when the user identifies external demand URLs as Tickets.
# tickets:
#     - url: "https://example.com/tickets/ABC-123"
executionAgent: "engineer|frontend-engineer"
collaborationRecommendation: "pair|autonomous"
devServerCommand: null
devServerUrl: null
devServerHmr: null
# Optional: target execution branch when explicitly requested by the user.
# worktreeBaseBranch: "feature/base-branch"
createdAt: "<ISO-8601 timestamp>"
status: "draft"
---

# <Plan Title>

## Context

What problem/request this plan addresses and the intended outcome.

## Objective

What will be built/changed and why.

## Approach

Recommended implementation approach (focused, practical, no long alternatives section).

## Files to Modify

- `path/to/file` — what changes here and why
- `path/to/another-file` — what changes here and why

When the implementation makes proposed domain language true, include the relevant `CONTEXT.md`.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `path/to/existing/module.ts` — what to reuse
- `path/to/utility.ts` — what to reuse

## Implementation Steps

State each step as an outcome that is either true or false when the step is done, never as an action that is satisfied
by attempting it. An empty file, a placeholder module, an alias, or a pass-through wrapper must not be able to satisfy
any step.

- [ ] `src/parser/tokens.ts` owns and exports `tokenize` and `TokenKind`; those declarations no longer exist in
      `src/parser/index.ts`, which imports them from `tokens.ts`.
- [ ] `src/parser/index.ts` is under 400 lines and contains no `@ts-nocheck`.
- [ ] `src/parser/tokens.test.ts` covers <named behavior> against the real tokenizer and fails if `tokenize` returns a
      pass-through result.

When applicable, include an explicit step that updates `CONTEXT.md` in the same change as the behavior it describes.

## Verification Plan

- Automated: exact command(s) to run
- Manual: precise user flows / checks
- Expected results for key scenarios
- When existing tests cover code this Plan reshapes: which behavior must still be protected afterwards, and which
  behavior is expected to stop existing. Without that split, a test that no longer compiles gets deleted and the suite
  still passes.
- When applicable: confirm the glossary describes implemented behavior and does not promote unimplemented proposals.

### Objective-Failing Checks

Type-check, lint, and "existing tests still pass" all succeed on a change that did nothing, so they cannot verify this
Plan on their own. List **at least one** check that is red today and can only go green when the objective is actually
met.

Each check is a shell command with one uniform contract: **exit 0 means the objective was met.** RunWield runs these
commands, so they must be literal and runnable from the repository root — not instructions to eyeball something. When
you call `plan_written`, pass the same checks in the `objectiveChecks` parameter as `{ id, command, rationale }`; the
Plan body remains the reviewable explanation, while Front Matter carries RunWield's executable copy.

- `OC1` — `! grep -rq "renderLegacy" src/` — the legacy renderer no longer exists anywhere.
- `OC2` — `test "$(wc -l < src/parser/index.ts)" -lt 400` — the monolith was actually split, not renamed.
- `OC3` — `deno test src/parser/tokens.test.ts` — the new behavior exists and is exercised.

## Execution Policy

- Planned Change Plans may omit `executionAgent`; omission defaults to `engineer`.
- `executionAgent: "engineer"` takes `collaborationRecommendation: "autonomous"` or omits it. `pair` is invalid for
  Engineer-owned execution.
- `executionAgent: "frontend-engineer"` takes `collaborationRecommendation: "autonomous"` or `"pair"`.
- Use `frontend-engineer` for browser-rendered UI work whose primary outcome is materially visual or interactive;
  otherwise use `engineer` (including TUI work and incidental frontend-file edits).
- Recommend `pair` only when live visual judgment is valuable; use `autonomous` otherwise. Include known dev-server
  hints and exact headed-browser checks. Real-browser verification is mandatory for Frontend Engineer unless externally
  blocked.
- PROJECT Epics are non-executable containers and must not define `executionAgent` or `collaborationRecommendation`;
  execution policy belongs only on child Plans.

## Edge Cases & Considerations

- Risk 1 + mitigation
- Compatibility or migration concerns
- Open assumptions (if any)
