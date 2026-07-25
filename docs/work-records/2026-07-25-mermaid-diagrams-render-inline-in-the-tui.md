---
kind: "work_record"
recordId: "08994572-66cb-473f-be2e-0f6b80a15c31"
status: "approved"
scope: "feature"
origin: "internal"
completionMode: "verified"
createdAt: "2026-07-25T22:09:45.693Z"
provenance:
    sourcePlans:
        - "981d9e35-8c77-4638-bdf2-47e40119302b"
---

# Mermaid diagrams render inline in the TUI

## Summary

Completed verified TUI support for rendering finished top-level Mermaid fences as compact Unicode diagrams while
preserving canonical source fallback for streaming, invalid, unsupported, nested, or too-wide diagrams. Agent messages
now use the Mermaid-aware Markdown renderer, Planner and Architect prompts guide terminal-readable diagrams, and
focused/manual checks plus the full `deno task ci` gate passed.

## Future Planning Notes

Keep Mermaid source canonical and treat terminal rendering as presentation-only. Width-safe fallback and conservative
diagram guidance are important for avoiding misleading wrapped or clipped topology in terminal surfaces.

## Execution Report

- Implemented `MermaidMarkdown` with `beautiful-mermaid` Unicode rendering, top-level completed-fence interception,
  ANSI-aware width fallback, per-source caching, and upstream Markdown delegation.
- Wired Agent TUI messages to use `MermaidMarkdown` and added focused renderer plus `AgentMessageBlock` integration
  coverage.
- Updated Planner and Architect Mermaid guidance for narrow, top-to-bottom, terminal-readable diagrams.
- Verified `renderMermaidASCII` import/dependency via Deno lock refresh;
  `deno test -A src/ui/tui/mermaid-markdown.test.js src/ui/tui/blocks.test.js` passed.
- Full quality gate passed: `deno task ci` (1414 tests, check/lint/fmt/test/release smoke all clean; only existing build
  warnings emitted).
- Manual TUI checks: launched `deno task cli` successfully; exercised `AgentMessageBlock` rendering by script for
  partial stream source fallback, completed flowchart Unicode, sequence/state/class/ER diagrams, malformed fallback, and
  narrow-width fallback.
