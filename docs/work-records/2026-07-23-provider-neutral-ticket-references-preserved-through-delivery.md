---
kind: "work_record"
recordId: "09979af2-211b-4e57-8517-f81c39d18ce3"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-23T19:01:24.995Z"
provenance:
    sourcePlans:
        - "b1f73d48-320a-4451-bd59-b4f9a0b266fe"
---

# Provider-neutral Ticket References preserved through delivery

## Summary

Implemented canonical provider-neutral Ticket References for Plans and Work Records, including Plan front matter
round-tripping, Slicer/agent guidance, Work Record snapshot and Epic aggregation behavior, searchable/readable ticket
URLs, and Workspace Plan detail rendering with safe external links. Regression coverage and full RunWield Workflow
Validation passed, including targeted Plan/workflow/Work Record/Workspace tests, headed browser verification, and
`deno task ci`.

## Future Planning Notes

Ticket References are demand provenance only: RunWield preserves user-supplied URLs for navigation and delivery history
without fetching provider data, syncing status, or treating external trackers as lifecycle owners. Epic Work Records
aggregate Epic and child Ticket References deterministically while child Plans retain only direct references.

## Execution Report

- Implemented provider-neutral Ticket References across Plan front matter, Slicer descriptors/prompts, Work Record
  schema/generation/index/search/read surfaces, and Workspace Plan detail rendering.
- Updated Planner/Architect/Slicer guidance plus PRD and design-system docs for demand-provenance boundaries and
  metadata-reference link styling.
- Added regression coverage for Plan round-trips/child preservation, Work Record snapshot/aggregation/search hydration,
  and Workspace safe link rendering.
- Verification passed: `deno test -A src/plan-store.test.js`; workflow prompt/tests; Work Record/tool/CLI tests;
  `deno task workspace:test`; and full `deno task ci` (1583 passed, release smoke passed).
- Headed browser check: ran Workspace at `http://127.0.0.1:5173`, opened standalone and child Ticket fixture details
  with `agent-browser --headed`; verified direct vs Epic inherited groups, long URL rendering, safe external
  href/target/rel, non-HTTP value not linked, no `example.com` network request before activation; screenshots saved at
  `/tmp/ticket-standalone.png` and `/tmp/ticket-child.png`.
