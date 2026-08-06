---
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Expose Claude CLI model/backend selection and MVP limitations in user-facing TUI/Workspace surfaces and PRD documentation. This includes browser-verified Workspace UI that follows RunWield's design system and clear language distinguishing this backend from Attached Mode."
affectedPaths:
    - "src/ui/tui/model-welcome.js"
    - "src/ui/tui/ui-api-overrides.ts"
    - "src/ui/workspace/"
    - "docs/design-system.md"
    - "docs/prd/runwield-core-prd.md"
    - "docs/prd/attached-mode-prd.md"
    - "docs/domain-language.md"
executionAgent: "frontend-engineer"
collaborationRecommendation: "autonomous"
devServerCommand: "deno task workspace:dev"
devServerUrl: "http://127.0.0.1:5173"
devServerHmr: true
createdAt: "2026-08-03T18:20:03.246Z"
updatedAt: "2026-08-03T18:20:03.246Z"
status: "draft"
origin: "internal"
parentPlan: "claude-cli-execution-backend"
order: 5
dependencies:
    - "04-harden-claude-cli-backend-failures-and-continuations"
---

# Surface Claude CLI Selection and Caveats

## Context

The backend/model, runtime, MCP signal, and failure-handling slices make Claude CLI execution real. Users now need to
understand and select it safely. The Epic requires TUI and Workspace settings/model preset UI to expose Claude CLI
availability and the MVP caveat: Claude Code owns its internal file/Bash/tool activity, while RunWield owns workflow
state and Session Transcript persistence.

This feature is related to Attached Mode but is not Attached Mode. Here, RunWield shells out to Claude Code from inside
a RunWield Session; the user's Claude Code conversation is not the host.

## Objective

Surface Claude CLI model/backend selection, health guidance, and MVP caveats in TUI/Workspace user-facing surfaces and
documentation, with headed-browser verification for Workspace UI and language aligned across Core and Attached Mode
PRDs.

## Approach

Use the backend/model metadata from prior children to present Claude CLI as a selectable execution backend alongside
normal model references. Keep visual changes consistent with the RunWield browser design system and avoid creating a
separate Claude-specific visual identity. Put durable product wording in the PRDs and, if implementation makes new
stable domain language true, update `docs/domain-language.md` in the same change.

Workspace changes should be browser-verified through the normal dev server. If the current Workspace has limited model
settings UI, the implementation should add the smallest coherent surface that lets users see/select Claude CLI where
model or execution settings are already presented, rather than inventing a disconnected settings experience.

## Files to Modify

- `src/ui/tui/model-welcome.js` — show Claude CLI model availability/auth-health guidance where model setup and
  selection are introduced.
- `src/ui/tui/ui-api-overrides.ts` — ensure model selector behavior can display/select Claude CLI backend models without
  implying API-key auth.
- `src/ui/workspace/` — surface Claude CLI provider/model selection and caveats in the relevant settings/model preset
  UI.
- `docs/design-system.md` — update only if a genuinely new reusable visual pattern is introduced for Workspace
  settings/caveats.
- `docs/prd/runwield-core-prd.md` — document Claude CLI as a Core-supported execution backend and clarify model/backend
  terminology.
- `docs/prd/attached-mode-prd.md` — align language so this feature is not conflated with Attached Mode.
- `docs/domain-language.md` — add or refine glossary language only for stable terms made true by the implementation,
  such as a Claude CLI execution backend distinction.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `docs/design-system.md` — use current RunWield design-system guidance before adding Workspace UI patterns.
- `src/ui/design-system/` — use semantic `--rw-*` tokens and shared components/styles rather than hard-coded colors.
- `src/ui/tui/model-welcome.js` — reuse existing no-model onboarding and provider availability messaging.
- `src/ui/tui/ui-api-overrides.ts` — reuse existing `ModelSelectorComponent` integration where it can represent backend
  models.
- `src/ui/workspace/react/PlanReviewSettings.tsx` and related Workspace settings surfaces — reuse existing settings
  layout, tab, and switch patterns where appropriate.

## Implementation Steps

- [ ] TUI model setup/selection surfaces can show Claude CLI backend models and clear health guidance without asking for
      an API key when Claude CLI auth is the relevant requirement.
- [ ] Workspace settings/model UI exposes Claude CLI selection or caveat display in the existing settings experience,
      using RunWield design-system tokens and patterns.
- [ ] User-facing caveat text states that Claude internal file/Bash/tool history is not native RunWield tool transcript
      history in MVP, while RunWield Session Transcript remains the source of truth for resume/replay.
- [ ] Documentation explains that this feature shells out to Claude Code from inside RunWield and is distinct from
      Attached Mode, where Claude Code is the user's External Agent Host.
- [ ] `docs/domain-language.md` is updated only if the implementation introduces stable domain language that agents and
      docs should reuse; the glossary does not promote unimplemented proposals.
- [ ] Headed-browser verification proves the Workspace surface is visually consistent and usable at the relevant
      route/state.

## Verification Plan

- Automated: `deno run -A scripts/run-tests.js src/ui/tui src/ui/workspace src/shared/models/model-registry.test.js`
- Automated: `deno task workspace:check`
- Automated: `deno task doc-links:check`
- Manual: run `deno task workspace:dev`, open `http://127.0.0.1:5173`, navigate to the relevant Workspace settings/model
  surface, and verify Claude CLI selection/caveat UI in a headed browser.
- Manual: verify TUI model onboarding/selection copy distinguishes Claude CLI health from API-key provider auth.
- Expected: users can discover/select Claude CLI backend models and understand the MVP limitation before relying on tool
  transcript parity.
- Expected: Core PRD and Attached Mode PRD use consistent language and do not imply that this backend is Attached Mode.
- Behavior protected afterwards: existing Workspace settings/review UI remains visually consistent with the RunWield
  design system, and existing TUI model selection still works for Pi-backed providers.
- Behavior expected to stop existing: Claude CLI no longer appears as an unexplained or API-key-like provider in
  user-facing selection surfaces.
- Confirm the glossary describes implemented behavior and does not promote unimplemented proposals.

### Objective-Failing Checks

- `OC1` — `deno run -A scripts/run-tests.js src/ui/tui src/ui/workspace` — UI/TUI tests prove Claude CLI
  selection/caveat behavior is covered without breaking existing surfaces.
- `OC2` — `deno task workspace:check` — Workspace TypeScript/Astro validation accepts the browser UI changes.
- `OC3` — `deno task doc-links:check` — PRD/documentation links remain valid after documentation updates.

## Execution Policy

This child is Frontend Engineer-owned because the primary outcome includes browser-rendered Workspace settings/model UI.
It can run autonomously, but headed-browser verification is mandatory unless externally blocked. Use
`deno task workspace:dev` and open `http://127.0.0.1:5173`; HMR is expected.

## Edge Cases & Considerations

- Do not create a separate visual identity for Claude CLI; use RunWield design-system tokens and current Workspace
  patterns.
- If Workspace lacks a full model-preset editor, add the smallest coherent user-facing surface rather than a
  disconnected configuration page.
- Keep docs precise: Claude CLI backend is RunWield-managed execution through Claude Code print mode, not user-hosted
  Attached Mode.
- If new glossary terms are added, assign them to this child only because this child makes the user-facing language
  true.
