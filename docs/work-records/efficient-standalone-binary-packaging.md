---
kind: work_record
recordId: e5b81ccd-0e5a-44f5-aea6-574af4726ed8
status: approved
scope: feature
origin: external
completionMode: verified
createdAt: 2026-07-14T08:32:00-04:00
provenance:
    evidence:
        - path: scripts/compile.js
          note: Defines the pinned Deno build, bundled/minified default-VFS executable, and complete passive-resource include set.
        - path: scripts/build-workspace-runtime.js
          note: Produces the compact server bundle and opaque browser assets used by the standalone Workspace runtime.
        - path: runtime-root.js
          note: Gives source runs and bundled executables one stable root for resolving embedded resources.
        - path: src/ui/workspace/server.js
          note: Loads the standalone Astro server and browser assets from the embedded Workspace runtime.
        - path: src/shared/workflow/review-launcher.js
          note: Keeps Workspace-hosted review as the production path without embedding the legacy compiled Plannotator package.
        - path: .github/workflows/release.yml
          note: Reuses the pinned compile path across release targets and publishes Zstandard and gzip archives.
        - path: install.sh
          note: Prefers the smaller Zstandard release archive and falls back to gzip when required for compatibility.
---

# Efficient Standalone Binary Packaging

## Summary

RunWield's standalone executable now uses Deno's bundled, minified default virtual filesystem instead of self-extracting
its dependency tree at startup. Stable resource roots and an opaque Workspace runtime preserve Astro SSR and browser
assets without tracing the full frontend dependency graph, while the obsolete compiled Plannotator production payload
has been removed. Local and release builds share the same Deno 2.9.2 compile path.

The verified macOS arm64 artifact fell from roughly 910 MB to 278 MB, launched warm in 0.27 seconds with about 153 MiB
peak RSS, and created no new self-extraction directory. Releases provide a roughly 72 MB Zstandard archive as the
preferred download plus an 88 MB gzip compatibility fallback, substantially reducing distribution and startup costs
without loading the entire executable into precious RAM.
