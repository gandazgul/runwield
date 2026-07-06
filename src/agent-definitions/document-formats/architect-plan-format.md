---
classification: "PROJECT"
type: "epic"
complexity: "LOW|MEDIUM|HIGH"
summary: "<Brief summary of the project-level change>"
affectedPaths:
    - "path/to/file1"
    - "path/to/file2"
frontend: false
devServerCommand: null
devServerUrl: null
devServerHmr: null
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
- For Epics with frontend scope: set `frontend: true` on the Epic, and describe which child FEATURE slices will need
  headed browser verification. The Slicer is responsible for marking those executable child FEATURE plans with
  `frontend: true`.

## Edge Cases & Considerations

- Risk 1 + mitigation
- Compatibility or migration concerns
- Open assumptions (if any)
