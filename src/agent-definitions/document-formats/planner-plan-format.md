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

When the implementation makes proposed domain language true, include the applicable domain-language file:
`docs/domain-language.md` for a single-context project, or the context-specific `domain-language.md` identified by
`docs/domain-language-map.md` for a multi-context project.

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

When applicable, include an explicit step that updates the applicable domain-language file in the same change as the
behavior it describes.

## Verification Plan

- Automated: exact command(s) to run
- Manual: precise user flows / checks
- Expected results for key scenarios
- For browser UI work: the exact headed-browser checks a Frontend Engineer must perform, and the dev-server command and
  URL if known.
- When existing tests cover code this Plan reshapes: which behavior must still be protected afterwards, and which
  behavior is expected to stop existing. Without that split, a test that no longer compiles gets deleted and the suite
  still passes.
- When applicable: confirm the glossary describes implemented behavior and does not promote unimplemented proposals.

## Edge Cases & Considerations

- Risk 1 + mitigation
- Compatibility or migration concerns
- Open assumptions (if any)
