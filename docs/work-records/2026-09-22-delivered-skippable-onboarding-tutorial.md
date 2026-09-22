---
kind: "work_record"
recordId: "05d1aa33-187b-4577-9be9-932a559522ea"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-22T16:17:42.129Z"
provenance:
    sourcePlans:
        - "363848da-a5f1-469e-8da0-b06ed9a89da5"
---

# Delivered skippable onboarding tutorial

## Summary

Implemented and verified an optional TUI tutorial for one real Planned Change. Users can permanently skip automatic
offers or start guidance through `/onboard` and interactive `wld onboard`; consent, setup, planning, review, execution,
recovery, and recap reuse the normal workflow. Durable Session context preserves deduplicated guidance across resume and
rollover, while verified recaps require actual delivery evidence. Documentation and 20 tests were added. Focused checks,
type checks, lint, policy checks, seam checks, docs build, Workspace checks, browser rendering, and diff checks passed;
full CI was otherwise blocked only by nine pre-existing broken links in untouched dashboard-plan files.

## Deferred Work

Workspace-native tutorial controls and cross-device narration remain deferred. The unrelated broken links under
`docs/plans/reliable-usage-dashboard-and-langfuse-export/` still need repair.

## Future Planning Notes

Keep tutorial narration derived from committed workflow facts rather than a parallel progress state. Require confirmed
verified delivery evidence before showing a successful recap; user-verified or closed-without-verification outcomes must
remain distinct.
