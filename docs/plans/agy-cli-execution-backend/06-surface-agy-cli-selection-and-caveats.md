---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
affectedPaths:
    - "src/ui/tui/model-selector.ts"
    - "src/ui/tui/model-welcome.ts"
    - "src/ui/tui/model-selector.test.ts"
    - "src/ui/tui/model-welcome.test.ts"
    - "src/ui/workspace/"
    - "src/ui/workspace/static/workspace.css"
    - "docs/design-system.md"
    - "docs/prd/runwield.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-08-23T20:02:05.487Z"
status: "draft"
origin: "internal"
parentPlan: "agy-cli-execution-backend"
order: 6
dependencies:
    - "05-harden-agy-cli-failures-and-continuations"
planId: "3f664125-84bc-4f9a-8c13-eb98d2240f28"
targetBranch: "feature/agy-cli-execution-backend"
---

# Surface Agy CLI Selection and Caveats

## Context

Once `agy-cli` can execute, complete workflows through MCP, and handle failures safely, users need to see and select it
without confusing it with API-key model providers or RunWield Connect. The TUI owns terminal model selection. Workspace
should at least disclose the committed Session model and Execution Backend, plus any backend caveat that affects replay.

This child is intentionally user-facing and should not create a separate Workspace model-state authority. Model choice
stays owned by Session Runtime and existing settings/model resolution.

## Objective

Make Antigravity CLI discoverable and selectable through user-facing model surfaces, show clear setup and global
custom-agent caveats, disclose when a Session uses the `agy-cli` Execution Backend, and update durable product
documentation to describe the implemented behavior without overclaiming native Antigravity internal tool transcript
parity.

## Approach

Extend the same selectable-model UI path used for Pi and Claude CLI. Label Antigravity as an external CLI Execution
Backend that requires installed/authenticated `agy` and user-approved global custom-agent setup. In Workspace Session
detail, show the committed model/backend and a concise caveat when backend metadata is `agy-cli`.

Use existing RunWield design-system surfaces and semantic tokens:

```text
Session detail
  Model: agy-cli/<selector>
  Backend: Antigravity CLI
  Note: Antigravity owns internal file/Bash/tool activity; RunWield stores final assistant, workflow, and status history.
```

The option set aside is a full Workspace model settings editor. That is larger and would duplicate runtime authority;
this slice only discloses and uses existing mutation paths.

## Files to Modify

- `src/ui/tui/model-selector.ts` — list and label `agy-cli` selectable models with setup guidance.
- `src/ui/tui/model-welcome.ts` — offer Antigravity CLI setup without routing users through API-key login.
- `src/ui/tui/model-selector.test.ts` and `src/ui/tui/model-welcome.test.ts` — cover mixed Pi, Claude, and Antigravity
  selection behavior.
- `src/ui/workspace/` — show read-only Session backend disclosure and Antigravity caveat where Session detail is
  rendered.
- `src/ui/workspace/static/workspace.css` — style any new disclosure with existing `--rw-*` semantic tokens.
- `docs/design-system.md` — update only if a new reusable visual pattern is necessary.
- `docs/prd/runwield.md` — document Antigravity CLI as a Core Execution Backend and distinguish it from RunWield Connect
  / External Agent Host flows.

## Reuse Opportunities

- `src/ui/tui/model-selector.ts` — reuse selectable model registry data rather than custom Antigravity lists.
- `src/ui/tui/model-welcome.ts` — reuse no-provider external CLI onboarding patterns from Claude CLI.
- `src/ui/workspace/islands/SessionSurface.jsx` or current Session detail surface — reuse the existing summary-card and
  notice patterns.
- `src/ui/design-system/` and `docs/design-system.md` — reuse tokens and primitives before adding a new pattern.
- `docs/prd/runwield.md` — reuse existing Execution Backend and RunWield Connect language.

## Implementation Steps

- [ ] TUI model selection shows `agy-cli` references as selectable external CLI backend choices without API-key auth
      prompts.
- [ ] No-model or missing-model onboarding can guide the user to Antigravity CLI setup and selection without calling
      `/login` for API credentials.
- [ ] Workspace Session detail shows the committed model/backend and an Antigravity-specific replay/tooling caveat when
      the Session used `agy-cli`.
- [ ] Browser UI uses existing design-system tokens and patterns; any new reusable visual pattern is added to the
      design-system docs and shared layer in the same change.
- [ ] `docs/prd/runwield.md` documents only the implemented Antigravity backend behavior and keeps it distinct from
      RunWield Connect.

## Verification Plan

- Automated: targeted TUI model selector, model welcome, Workspace disclosure, and documentation link tests through
  `deno run -A scripts/run-tests.js ...`.
- Automated: `deno task workspace:check`, `deno task doc-links:check`, and relevant lint/check tasks.
- Browser: run `deno task workspace:dev`, open `http://127.0.0.1:5173`, and verify the Session detail flow that displays
  an `agy-cli` model/backend disclosure and caveat.
- Browser: inspect desktop and narrow viewport layouts, and confirm no new console errors appear during the checked
  flow.
- Expected result: users can see what Antigravity CLI is, select it through the established model path, and understand
  the global custom-agent and transcript caveats.

## Edge Cases & Considerations

- Workspace disclosure must use committed Session snapshot data; it must not invent a separate model setting.
- Browser verification is required for this Frontend Engineer slice unless blocked by missing fixture/API state, in
  which case the blocker and closest manual evidence must be recorded.
- Do not hard-code colors; use `--rw-*` tokens through the design system.
- Documentation must not imply that Antigravity internal file/Bash/tool history is native RunWield tool history.
