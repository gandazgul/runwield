---
kind: "work_record"
recordId: "d00b50ee-721b-4e0f-a3d4-58ec2e4eb96d"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-26T04:57:29.112Z"
provenance:
    sourcePlans:
        - "74e5e3f3-097a-4311-8e8a-5ab5deaf22f7"
---

# Split Serial-Heavy Test Suites

## Summary

Split five aggregate test suites into focused domain modules while preserving split-family inventory parity across
load-plan, workspace, validation, worktree, and install tests. Added language/framework-agnostic write-tests Skill
guidance for behavioral module boundaries, serial critical paths, and parallel-safe fixture extraction. Focused parallel
split-family suites passed.

## Deviations from Plan

The measured full-suite performance objective did not improve on this machine: median warm runtime increased from 28.29s
before the split to 39.48s after. Shuffle stress was only partially completed; seeds 101 and 202 passed, while seed 303
exposed a settings-order/global-state issue before repair.

## Deferred Work

No failing verification remains after merge-back repair. The only deferred follow-up is performance analysis if the team
still wants wall-clock test runtime improvement beyond structural splitting.

## Future Planning Notes

Structural test splitting can expose hidden global state and may not improve wall-clock time without also inspecting the
new longest modules and remaining serialization. Future test-module refactors should pair inventory parity with shuffle
stress and full-suite timing before claiming performance gains.

## Execution Report

- Split the five aggregate suites into focused destination modules with exact split-family inventory parity: load-plan
  80, workspace 84, validation 73, worktree 44, install 8; removed the original aggregate test files.
- Updated `src/skills/write-tests/SKILL.md` with language/framework-agnostic module-shaping guidance for behavioral
  boundaries, serial critical paths, and parallel-safe fixture extraction.
- Resolved reviewer and merge-back issues without reintroducing production-only test hooks; bundled skill cache
  extraction now prunes stale cache entries while preserving current bundled skills for parallel readers.
- Focused split-family suites passed for load-plan, workspace, validation/review-diff, worktree, install, and affected
  merge-repair tests.
- Full-suite baseline warm runs before split were 28.29s, 24.39s, 36.61s (median 28.29s). After split they were 38.31s,
  39.48s, 44.96s (median 39.48s), so the measured performance objective did not improve on this machine.
- Shuffle stress was partially completed: seeds 101 and 202 passed; seed 303 exposed global-state ordering issues that
  were repaired during validation.
- Final post-merge verification passed: `deno task ci` reported 1728 passed (9 steps) and 0 failed.
