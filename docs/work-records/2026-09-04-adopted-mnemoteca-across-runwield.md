---
kind: "work_record"
recordId: "d966173b-5096-4d45-8eea-767963216246"
status: "approved"
scope: "planned_change"
workKind: "MAINTENANCE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-04T03:28:32.206Z"
provenance:
    sourcePlans:
        - "5a315cc8-5abc-4fb2-a7ad-31b32795d36a"
---

# Adopted Mnemoteca Across RunWield

## Summary

RunWield now uses Mnemoteca as its only current memory integration identity across installer, runtime preflight,
extensions, Claude bridge, Core Memory loading, Sleep backup, Work Record indexing, workflow composition, CI,
sandboxing, docs, and stored project Memories. Verification passed with focused tests, formatting, `deno task pr:check`,
Work Record index rebuild, tracked old-name absence checks, and project/global Memory searches returning zero old-name
matches.

## Deviations from Plan

Direct archive checksum/download installer tests were replaced because RunWield now delegates install and migration
behavior to the official Mnemoteca installer; checksum verification remains covered upstream and archive helper behavior
moved out of RunWield's install path.

## Future Planning Notes

Future Mnemoteca-related changes should keep RunWield delegated to the official installer for migration and archive
integrity, while preserving sandboxed `MNEMOTECA_DB_PATH` handling so tests never touch the developer's real database.
