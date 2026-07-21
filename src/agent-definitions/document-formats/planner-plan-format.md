---
classification: "FEATURE"
complexity: "LOW|MEDIUM|HIGH"
summary: "<Brief summary of the feature change>"
affectedPaths:
    - "path/to/file1"
    - "path/to/file2"
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
- For browser-rendered UI work whose primary outcome is materially visual or interactive, set
  `executionAgent:
  frontend-engineer`; otherwise use `engineer` (including TUI work and incidental frontend-file
  edits). Recommend `pair` when live visual judgment is valuable and `autonomous` otherwise. Include known dev-server
  hints and exact headed-browser checks; real-browser verification is mandatory for Frontend Engineer unless externally
  blocked.

## Edge Cases & Considerations

- Risk 1 + mitigation
- Compatibility or migration concerns
- Open assumptions (if any)
