---
kind: "work_record"
recordId: "852e2fdc-9506-47a5-bbf0-1711f10515c8"
status: "approved"
scope: "planned_change"
workKind: "BUG_FIX"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-04T12:24:27.164Z"
provenance:
    sourcePlans:
        - "4425275e-0a18-4a91-ae3e-29473cf77f86"
---

# Escape reliably cancels active process trees

## Summary

Escape cancellation now reaches RunWield-owned foreground process trees for local shell commands, local CI, and
Objective-Failing Checks through a new shared foreground-process primitive. Workflow Validation treats canceled
Objective-Failing Checks as a resumable pause rather than a validation failure or repair trigger. Regression coverage
was added for descendant termination, abort races, timeout behavior, and validation cancellation; Objective-Failing
Checks turned red on baseline and green after implementation, seams checks held, and `deno task ci` passed.

## Deviations from Plan

Manual interactive TUI verification was not run because no interactive terminal was available. One unrelated golden TUI
scenario flaked during the first full CI run, then passed in isolation and on full rerun.

## Deferred Work

User-facing manual TUI checks remain: Escape during `!`/`!!`, QUICK_FIX CI, executable-Plan CI and Objective-Failing
Checks, and an agent bash tool call.

## Future Planning Notes

Shared process-tree ownership avoided adding a dependency seam while making cancellation reusable across shell, CI, and
Objective-Failing Checks. Treating validation cancellation as a resumable pause preserves Plan/workflow authority and
avoids unnecessary repair routing.
