---
kind: "work_record"
recordId: "0997e0f3-2a9d-48a7-bcd4-90048ff232cc"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-17T04:41:04.980Z"
provenance:
    sourcePlans:
        - "008736c6-9dde-4d0c-a6b2-ea86adc65398"
---

# Allow WLD-Compatible Extension Prompts

## Summary

Enabled installed Pi packages to contribute passive slash prompt templates without requiring the executable-extension
compatibility marker. Package prompts are loaded through the existing resource loader, retain source metadata, and are
filtered against built-in slash command names. Skills remain ignored, executable extensions remain compatibility-gated,
and install output, warnings, tests, and settings documentation were updated.

## Deferred Work

Trusted package prompts cannot override built-in commands. A manifest-level explicit override policy may be considered
later.

## Future Planning Notes

If prompt overrides are introduced, define trust, precedence, collision warnings, and manifest opt-in semantics before
implementation.
