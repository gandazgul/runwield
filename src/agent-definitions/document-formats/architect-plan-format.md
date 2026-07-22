---
classification: "PROJECT"
complexity: "LOW|MEDIUM|HIGH"
summary: "<Brief summary of the project-level change>"
affectedPaths:
    - "path/to/file1"
    - "path/to/file2"
devServerCommand: null
devServerUrl: null
devServerHmr: null
# Optional: target execution branch for child FEATURE plans when explicitly requested by the user.
# worktreeBaseBranch: "feature/base-branch"
createdAt: "<ISO-8601 timestamp>"
status: "draft"
---

# <Plan Title>

## Context

What problem/request this plan addresses and the intended outcome.

## Objective

Clear statement of what changes and why. Reference any ADRs created.

## Vertical Slice Findings

Brief summary of what you traced deeply and how it informs the plan.

## Files to Modify

- `path/to/file` — what changes here and why
- `path/to/another-file` — what changes here and why

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `path/to/existing/module.ts` — what to reuse
- `path/to/utility.ts` — what to reuse

## Verification Plan

- Automated: exact command(s) to run
- Manual: precise user flows / checks
- Expected results for key scenarios
- For Epics with browser UI scope: do not set Epic-level `executionAgent`, `collaborationRecommendation`, or `frontend`.
  Describe which child FEATURE slices will need Frontend Engineer ownership and headed browser verification; the Slicer
  assigns canonical ownership on executable child FEATURE Plans.

## Edge Cases & Considerations

- Risk 1 + mitigation
- Compatibility or migration concerns
- Open assumptions (if any)
