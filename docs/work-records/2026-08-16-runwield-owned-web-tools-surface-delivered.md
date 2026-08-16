---
kind: "work_record"
recordId: "14846fc9-43d3-4b04-847a-0f233d8fa485"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "user_verified"
createdAt: "2026-08-16T03:51:30.245Z"
provenance:
    sourcePlans:
        - "4de05d1a-78a4-4694-a109-d6e9b2d816bc"
---

# RunWield-owned web tools surface delivered

## Summary

The user attested verification; RunWield Workflow Validation did not establish this result. RunWield now provides
`web_search`, `web_fetch`, `web_code_search`, and `web_docs_search` as owned tools backed by the required `ketch`
helper. The work gives Pi and Claude CLI sessions the same web surface, removes Claude native `WebFetch` and `WebSearch`
authorization, protects the new tool names from overrides, updates prompts and docs away from the deleted `ketch` Skill,
and adds runtime, installer, bridge, and tool coverage. The user established verification: No feedback; verified
manually from merged worktree runwield-web-tools-surface-0ac7eb0e.

## Deferred Work

Manual interactive Pi-backed and Claude CLI `wld` sessions were not exercised in the non-interactive run; bridge and
startup behavior were covered by automated tests.

## Future Planning Notes

When a helper-backed capability must be consistent across model backends, implement it as RunWield-owned tools with
pinned behavior, required-helper preflight, installer coverage, and backend bridge tests rather than as advisory Skill
guidance.
