---
kind: "work_record"
recordId: "69030c31-0118-4c6a-a794-a3a30a4585bd"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-24T18:36:03.286Z"
provenance:
    sourcePlans:
        - "9e60ab53-4e03-4293-91c3-39ca8df76826"
---

# Guide durable-evidence answers

## Summary

Guide now has evidence-first project inquiry instructions that map durable artifact locations, authority hierarchy,
citation/status rules, and exclusions for raw Session Transcripts and local metrics. ADRs were migrated to required
machine-readable `status: accepted` front matter, the ADR format now requires the status enum, and repository tests lock
in the Guide and ADR contracts. Verification passed with formatting checks, focused tests, Workspace build-related
tests, and final `deno task ci`.

## Deviations from Plan

Existing Workspace tests needed a local Workspace build; `deno task workspace:build` resolved the missing build artifact
before the affected tests and full CI passed.

## Deferred Work

Manual live Guide smoke testing was not run because model API credentials were unavailable in the environment.

## Execution Report

- Implemented Guide evidence-first project inquiry instructions with artifact locations, authority hierarchy,
  citation/status rules, and exclusions for raw Session Transcripts/local metrics.
- Migrated all `docs/adr/*.md` files to machine-readable `status: accepted` front matter and updated `ADR-FORMAT.md` to
  require the ADR status enum.
- Added `src/adr-artifacts.test.js` plus Guide prompt/nudge assertions covering the durable-evidence contract.
- Verified: `deno fmt --check ...` passed for all changed files.
- Verified: focused
  `deno test -A src/adr-artifacts.test.js src/shared/session/__tests__/session-tools-policy.test.js src/shared/session/session-prompt.test.js`
  passed.
- Verified: `deno task workspace:build` resolved missing local Workspace build needed by existing Workspace tests;
  affected Workspace tests passed afterward.
- Verified: final `deno task ci` passed.
- Manual live Guide smoke test was not run because no model API credentials are available in this environment.
