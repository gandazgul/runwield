---
kind: "work_record"
recordId: "b007c18e-55c1-4897-a272-19e7d9aeadff"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-22T17:32:13.639Z"
provenance:
    sourcePlans:
        - "b587b9c5-cc2f-4cce-8564-93b6b86c2cd1"
---

# Guide gained Markdown-only document tools

## Summary

Implemented and verified `write_docs` and `edit_docs` as Markdown-restricted Custom Tools for Guide, allowing explicit
user-requested preservation or updates of ordinary `.md` documentation without granting general file mutation. Guide
policy, Runtime presentation, metrics, delegated-agent exclusions, and user/Core documentation were updated; Router and
Operator behavior remain unchanged.

## Deviations from Plan

Manual model-backed Guide conversation flows were not run; equivalent tool restrictions, policy behavior, Runtime
handling, metrics, and delegated-agent exclusions were covered by automated tests.

## Deferred Work

The broader canonical Guide/domain-context reconciliation noted in the Plan remains outside this implementation.

## Future Planning Notes

The `.md` guard is intentionally lexical and not a sandbox; future expansion to `.markdown` or `.mdx` should be a
deliberate validator-policy change with regression coverage.

## Execution Report

- Implemented `write_docs` / `edit_docs` Markdown-restricted Custom Tools and auto-wiring; non-`.md` targets are
  rejected before mutation.
- Updated Guide policy/tools and docs so Guide can only preserve/update ordinary `.md` docs on explicit follow-up;
  Router and Operator behavior remain unchanged.
- Added regression coverage for tool behavior, Guide tool policy, Runtime titles, metrics, and delegated-agent
  exclusion.
- Verification passed: `deno test -A src/tools/__tests__/docs-file-tools.test.js`; targeted session/runtime tests;
  `deno test -A src/tools/__tests__/delegate-agent.test.js`; `deno task ci`.
- Manual model-backed Guide conversation flows were not run; equivalent tool and policy behavior was covered by
  automated tests.
