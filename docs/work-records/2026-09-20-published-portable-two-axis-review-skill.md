---
kind: "work_record"
recordId: "c11cd225-63ac-4096-98b7-3fcec83b2b1b"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-20T03:14:24.879Z"
provenance:
    sourcePlans:
        - "f62d88b6-b3b3-4c05-a169-8b0d2058f58a"
---

# Published portable two-axis review skill

## Summary

Added the standalone `skills/review/` package for Standards and Spec reviews of pull requests, fixed points, and working
trees, with GitHub and GitLab comment guidance. Extended skill publishing checks to support source-less skills and
recursively hash and leak-scan every Markdown support file. Automated CI passed before the final GitLab guidance
rewrite; the affected sync tests, skill check, and formatting check passed afterward.

## Deviations from Plan

Support-file discovery now recurses through subdirectories, closing the same tracking gap below the skill root. GitLab
guidance uses `glab mr` commands except for draft-note bulk publication, which still needs one documented `glab api`
call because `glab mr` has no publish command. The planned `HEAD~3` no-spec exercise reached spec-ladder rung 5 through
the matching Plan rather than rung 6.

## Deferred Work

Live pull-request read and posting behavior was not exercised. Remote installation awaits committed publication. GitLab
commands were documentation-verified because `glab` was unavailable. The local `~/.agents/skills/review/` still shadows
the published skill and remains for the user to remove or rename.

## Future Planning Notes

Keep published-skill file discovery recursive and disk-led so unregistered support files cannot bypass drift or wording
checks. Preserve one batched GitLab API exception unless unbatched notifications are acceptable.
