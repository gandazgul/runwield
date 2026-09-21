---
kind: "work_record"
recordId: "cb218bdd-6b7c-4638-bf0c-34f30c0f3988"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-20T03:14:45.661Z"
provenance:
    sourcePlans:
        - "4ccd11cc-7bc9-4e05-8cce-3448d5862cd6"
---

# Isolated Release Candidates on Release Branches

## Summary

Implemented and verified RunWield-only release branches for new Candidate series. RC1 now atomically publishes
`release/vX.Y.Z` with its tag; later Candidates use the checked remote branch tip instead of caller HEAD. Stable
promotion, Direct Stable, dirty-checkout support, legacy series behavior, and repository-neutral `/release` guidance
remain intact. Release policy, Core requirements, and domain language now define fixes-first stabilization and explicit
forward-porting to `main`.

## Deviations from Plan

The targeted release suite, `deno task check`, and `deno task seams:check` passed. Full `deno task ci` did not pass
because `doc-links:check` found three broken links in untouched remote-SSH documentation; the archived HEAD baseline
reproduced all three failures, and every other CI task passed.

## Deferred Work

Repair the three pre-existing broken links in the remote-SSH documentation separately.

## Future Planning Notes

For new release series, make fixes on the release branch first and forward-port them to `main`. Later Candidates must
use the live pushed release-branch tip, with ancestry and race checks; never fall back to caller HEAD.
