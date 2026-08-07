---
kind: "work_record"
recordId: "ad7a0b9b-b855-499c-87d9-d373ee31c00b"
status: "approved"
scope: "planned_change"
workKind: "MAINTENANCE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-31T04:10:08.017Z"
provenance:
    sourcePlans:
        - "6aa3e38e-de12-47d4-a584-926d24061f79"
---

# TypeScript ratchet policy enforced

## Summary

RunWield adopted a Deno-native mixed JS/TS policy for main source: ADR-013 now defines the TypeScript ratchet, ADR-000
points to it for the superseded language decision, CI rejects new production JS/JSX and stale baseline entries, and
non-Workspace TS/TSX is checked directly. The base64url collaboration helper and focused test were migrated to
TypeScript as the canary, with repository imports updated to real `.ts` extensions. Verification passed through targeted
checks, the language-policy guard, full CI, and compile.

## Deviations from Plan

The optional `src/shared/package-resources.js` migration was not performed; the required base64url canary and policy
guard were clean, so the second canary was left out to keep scope low-risk.

## Deferred Work

Migrate `src/shared/package-resources.js` and its test in a later behavior-preserving change if it remains a simple
low-risk TypeScript conversion.

## Future Planning Notes

Future migrations should shrink `scripts/language-policy-baseline.json` in the same change, keep real file extensions in
imports, and avoid expanding TypeScript canaries into high-authority lifecycle, session, validation, or worktree modules
unless explicitly planned.
