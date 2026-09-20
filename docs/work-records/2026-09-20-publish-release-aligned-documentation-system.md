---
kind: "work_record"
recordId: "fd8b0c45-5d82-43dd-9714-857a6de311b5"
status: "approved"
scope: "planned_change"
workKind: "DOCUMENTATION"
origin: "internal"
completionMode: "verified"
createdAt: "2026-09-20T03:13:31.894Z"
provenance:
    sourcePlans:
        - "2735bd6a-955b-40e1-a71a-e0f015b94488"
---

# Publish release-aligned documentation system

## Summary

Built an isolated Starlight manual from an explicit 17-file allowlist, with RunWield branding, search, safe link and
asset rewriting, output-boundary checks, and release-aligned GitHub Pages automation. Added docs/stable reconciliation
that preserves corrections, deploys exact commits, rejects conflicts and stale updates, and supports Stable releases and
independent documentation fixes. Automated checks, seven new tests, and headed desktop and mobile browser checks passed
locally.

## Deviations from Plan

Added the Workspace Documentation menu link during this change instead of leaving it as follow-up work. The full CI task
remained unclean because existing Workspace and design-system check, lint, and language-policy failures reproduced at
the baseline; the documentation and Workspace-specific checks passed.

## Deferred Work

Public deployment is not yet verified. After merge, run scripts/setup-docs-pages.sh to create docs/stable, configure
GitHub Pages and DNS, enable HTTPS, then verify https://docs.runwield.dev; it currently redirects to /review and Pages
returns 404.

## Future Planning Notes

Keep live publication evidence separate from local build and browser evidence. Preserve docs/stable with normal
reconciliation and non-force pushes so release updates cannot overwrite independent documentation corrections.
