---
kind: "work_record"
recordId: "56b2d954-c6ee-4b01-ad98-aafaf06b79fa"
status: "approved"
scope: "epic"
origin: "internal"
completionMode: "done_enough"
createdAt: "2026-09-20T03:12:35.831Z"
provenance:
    sourcePlans:
        - "363954ee-cdaa-4014-b749-b1fcc9bd90d7"
---

# Prepared Homebrew and WinGet distribution

## Summary

Closed the Epic done enough after both child plans reached validated. RunWield now has release tooling and package-owned
update behavior for a Homebrew tap, including RunWield and Mnemoteca formulas, plus a complete Windows x64 package path
with bundled helpers, native runtime support, WinGet manifest generation, and publication guidance. This establishes
tested distribution readiness, not public catalog availability.

## Deferred Work

The owner must publish the matching Stable release, create or update `gandazgul/homebrew-tap`, repeat checks against the
published assets, and submit and confirm the WinGet listing. Linux Homebrew and Windows arm64 remain outside this Epic.

## Future Planning Notes

Treat package preparation and public availability as separate states. Generate formulas and WinGet manifests only from
immutable Stable release bytes, then rerun package checks before publishing or submitting.
