---
kind: "work_record"
recordId: "1df2705b-f38e-4d95-b233-b1d9f1ac6637"
status: "approved"
scope: "planned_change"
workKind: "FEATURE"
origin: "internal"
completionMode: "verified"
createdAt: "2026-08-09T19:39:38.458Z"
provenance:
    sourcePlans:
        - "e992c156-7b85-426b-9e1e-dfa7ca74540b"
---

# Bridge RunWield tools to Claude CLI turns

## Summary

Claude CLI turns now receive RunWield tool parity through generalized Bridged Tools. The work added host-neutral
Mnemoteca and Cymbal tool factories, bridged memory, code, Work Record, interview, lifecycle, multi-file edit,
return-to-router, and caller-supplied tools, and corrected the Claude CLI system prompt tool list. Verification passed
with `deno task ci`, including checks, lint, seams check, doc links, and the full test suite.

## Deviations from Plan

One archived Plan doc link found by CI was fixed as part of the work. Some tests were rewritten because Mnemoteca
initialization moved from session start to first tool call.

## Deferred Work

`delegate_agent` remains deferred to its own Plan.

## Future Planning Notes

The Bridged Tool abstraction is now the durable term for RunWield tools exposed to Claude CLI over the loopback MCP
bridge. Future Claude CLI tool work should reuse the host-neutral factories and the bridge composer instead of adding
backend-specific tool copies.

[Mnemoteca]: https://github.com/gandazgul/mnemoteca
