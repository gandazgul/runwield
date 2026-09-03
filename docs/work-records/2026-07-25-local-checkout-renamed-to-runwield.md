---
kind: "work_record"
recordId: "b73d647d-0706-4054-b7a3-7f132c8c20b9"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-25T22:09:34.206Z"
provenance:
    sourcePlans:
        - "16e5c776-d721-4a70-ae0f-a940b3fb140f"
---

# Local checkout renamed to runwield

## Summary

Verified completion of the local-only checkout rename from /Users/gandazgul/Documents/web/harns to
/Users/gandazgul/Documents/web/runwield without rebranding source or changing the GitHub repository. The migration
preserved the operational path identities that mattered for RunWield sessions, Mnemoteca project memory, Claude Code,
Codex, shell command resolution, worktree state, and IDE/tool continuity.

## Future Planning Notes

Future path-identity migrations should treat absolute paths as durable tool state, not cosmetic labels: drain linked
worktrees first, quiesce path-owning processes, back up external session stores, transform only structural cwd/project
metadata, and verify resume behavior before deleting rollback state.

[Mnemoteca]: https://github.com/gandazgul/mnemoteca
