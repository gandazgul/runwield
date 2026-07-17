---
kind: "work_record"
recordId: "770c5b8f-23c5-488c-b9ad-c8f718b7c1e1"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-17T04:41:11.361Z"
provenance:
    sourcePlans:
        - "44407264-433c-4ac6-93a3-6a3aa0a46f77"
---

# Enabled consent-gated WLD-compatible Pi extensions

## Summary

RunWield can now recognize, install, persist, and load Pi-shaped code extensions that explicitly declare WLD
compatibility. Installation requires clear user consent and defaults to denial in non-interactive flows, while passive
themes and prompts remain available and incompatible extensions and skills remain ignored. Manifest filtering, session
loading, help text, settings documentation, and automated coverage were added and verified.

## Deferred Work

Skills remain unsupported. Package prompt support is tracked separately.

## Future Planning Notes

Treat compatibility metadata as author self-attestation rather than vetting or sandboxing. Future extension API versions
should define an explicit compatibility and migration policy.
