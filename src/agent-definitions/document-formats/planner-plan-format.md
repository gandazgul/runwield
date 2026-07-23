---
classification: "FEATURE"
complexity: "LOW|MEDIUM|HIGH"
summary: "<Brief summary of the feature change>"
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

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `path/to/existing/module.ts` — what to reuse
- `path/to/utility.ts` — what to reuse

## Implementation Steps

- [ ] Step 1: Atomic action with concrete file/function targets
- [ ] Step 2: Next dependent action
- [ ] Step 3: Testing/validation implementation

## Verification Plan

- Automated: exact command(s) to run
- Manual: precise user flows / checks
- Expected results for key scenarios
- Execution policy matrix:
  - FEATURE Plans may omit `executionAgent`; omission defaults to `engineer` for backward compatibility.
  - FEATURE Plans may set `executionAgent: "engineer"` with `collaborationRecommendation: "autonomous"` or omitted.
    `pair` is invalid for Engineer-owned execution.
  - FEATURE Plans may set `executionAgent: "frontend-engineer"` with `collaborationRecommendation: "autonomous"` or
    `"pair"`.
  - Use `frontend-engineer` for browser-rendered UI work whose primary outcome is materially visual or interactive;
    otherwise use `engineer` (including TUI work and incidental frontend-file edits).
  - Recommend `pair` only when live visual judgment is valuable; use `autonomous` otherwise. Include known dev-server
    hints and exact headed-browser checks. Real-browser verification is mandatory for Frontend Engineer unless
    externally blocked.
  - PROJECT Epics are non-executable containers and must not define `executionAgent` or `collaborationRecommendation`;
    execution policy belongs only on child FEATURE Plans.
  - Legacy `frontend: true` on FEATURE Plans is still accepted as Frontend Engineer/autonomous compatibility metadata,
    but new Plans should use canonical `executionAgent` / `collaborationRecommendation` instead. Legacy
    `frontend: false` remains Engineer compatibility metadata and is distinct from an absent canonical owner.

## Edge Cases & Considerations

- Risk 1 + mitigation
- Compatibility or migration concerns
- Open assumptions (if any)
