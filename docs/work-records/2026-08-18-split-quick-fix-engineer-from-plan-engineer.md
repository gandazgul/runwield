---
kind: "work_record"
recordId: "8141165a-a255-46a8-a5d0-7b986a55efde"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-18T13:26:51.018Z"
provenance:
    sourcePlans:
        - "e29bc564-93dc-4440-a1b5-79fe9f3041a2"
---

# Split Quick Fix Engineer from Plan Engineer

## Summary

Completed the agent identity split so selectable Engineer now owns Quick Fix work, new workflow-only Plan Engineer owns
engineer-planned execution, and Frontend Engineer is workflow-only for browser-UI-dominated Plans. The change added the
policy-to-runtime resolver, hid workflow-only agents from manual selection, generalized Pair Execution for both Plan
owners, centralized Workspace Plan Review policy, updated domain language, and added focused coverage for agent
contracts, runtime boundaries, Pair, Workspace policy, and command discoverability.

## Deviations from Plan

`deno task ci` still has one failing pre-existing test in `src/shared/runwield-owned-paths.test.js` about whether
`.wld/worktrees.json.tmp` is RunWield-owned. The failure reproduces at HEAD in a clean detached worktree and was left
for a separate product decision. The manual Workspace browser inspection was not run; automated policy tests and the
Astro workspace check covered the non-browser parts.

## Deferred Work

Decide and fix the pre-existing `.wld/worktrees.json.tmp` ownership expectation. Run the manual headed-browser Workspace
Plan Review check at desktop and narrow widths to verify rendered controls and console/network cleanliness.

## Future Planning Notes

Keep Plan policy values stable as `engineer | frontend-engineer` and map to runtime agents only at activation and
comparison boundaries. Test harnesses can depend on visible agent names in subtle ways, so identity changes need focused
runtime, golden TUI, and progress-event coverage.
