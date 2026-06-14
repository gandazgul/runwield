---
classification: "FEATURE"
complexity: "MEDIUM"
summary: "Implement per-agent model overrides in settings.json and support JSONC (comments) for the settings file. 1. Update `resolveModel` in `src/shared/session/session.js` to check for an `agents` object in settings that specifies a model override for the current agent name, inserting it into the priority chain between user-override and agent-definition. 2. Modify `HarnsSettingsStorage` in `src/shared/settings.js` to parse settings using JSONC (or a simple comment-stripping regex) to allow user comments in `settings.json`. 3. Add support for \"model presets\" by allowing the settings override to refer to a predefined set of models or by expanding the `agents` config to support grouped overrides."
affectedPaths:
    - "src/shared/session/session.js"
    - "src/shared/settings.js"
createdAt: "2026-06-02T19:31:36.000Z"
updatedAt: "2026-06-02T19:33:30.876Z"
status: "completed"
origin: "internal"
---

# Per-Agent Model Overrides + Presets + JSONC Settings

## Context

Users want to define agent-specific models in config (`agents: { router: { model: "..." } }`) and have that override
built-in agent-definition models. They also want easy switching across model sets (presets), and comments in settings
files. User decisions for this plan: implement all three now; preset activation is config-only (`activeModelPreset` +
`/reload`), and config should be read from merged scopes (global + project, with project overriding global).

## Objective

Implement a stable, settings-first model resolution layer that supports:

- per-agent model override,
- preset-selected per-agent mappings,
- JSONC parsing for settings files, while preserving existing strict model validation/auth checks and existing explicit
  `/model` behavior.

## Approach

1. Keep the existing runtime model priority chain, but insert config-derived agent overrides before agent definition
   model.
2. Resolve the effective agent override from merged custom settings:
   - base `agents.<agentName>.model`
   - optionally overridden by `modelPresets[activeModelPreset].agents.<agentName>.model`
3. Update footer model display logic to use the same effective resolver so UI and runtime selection stay aligned.
4. Add JSONC parse support in `HarnsSettingsStorage` so settings reads accept comments/trailing commas; writes remain
   normalized JSON.
5. Keep preset switching config-only in v1 (no new slash command), with `/reload` applying changes immediately.

## Files to Modify

- `src/shared/session/session.js` — add reusable effective-agent-model resolver and use it in both `resolveModel()` and
  `buildAgentSession()` footer model selection.
- `src/shared/settings.js` — add JSONC parsing helpers and merged custom-setting readers for global/project custom
  config keys.
- `src/shared/interactive/chat-session.js` — ensure persisted `/model` default behavior remains compatible with new
  per-agent override priority; adjust comments/docs if needed.
- `src/shared/interactive/ui-api-overrides.js` — ensure `setAgentInfo` state updates still parse provider/model
  correctly with override-driven model strings.
- `src/cmd/reload/index.js` — keep `/reload` messaging accurate now that preset/config changes are expected application
  path.

## Reuse Opportunities

Existing functions, modules, or patterns to reuse:

- `src/shared/session/session.js` `resolveModel()` — current candidate iteration with strict `provider/id` parsing +
  registry/auth checks.
- `src/shared/settings.js` `getCustomSetting()` / `setCustomSetting()` — existing custom key persistence path.
- `src/shared/session/session.js` `reloadRootAgentSession()` — already reloads settings and reapplies model defaults;
  use as the preset/apply workflow.
- `src/cmd/theme/index.js` — precedent for config-driven UX where command + reload/persist behavior is explicit.

## Implementation Steps

- [ ] Step 1: In `src/shared/settings.js`, add a safe JSONC parser (via `@std/jsonc`) used by custom-setting
      reads/writes and storage read paths, preserving fallback semantics to `~/.pi/agent/settings.json`.
- [ ] Step 2: Add helper(s) to read merged custom config across scopes (global then project override), e.g.
      `getMergedCustomSettings()` or targeted getters for `agents`, `modelPresets`, and `activeModelPreset`.
- [ ] Step 3: In `src/shared/session/session.js`, add `getConfiguredAgentModel(agentName)` that computes effective agent
      model from base `agents` plus optional active preset overlay.
- [ ] Step 4: Update `resolveModel(modelOverride, agentDef)` signature/usages to include `agentName` context, and insert
      configured-agent model candidate priority as:
  1. explicit `modelOverride`,
  2. active `/model` override (only when user-selected),
  3. configured effective agent model,
  4. `agentDef.model`,
  5. default model from settings.
- [ ] Step 5: Update `buildAgentSession()` footer-model selection to use the same effective configured agent model
      (instead of `agentDef.model` directly), keeping displayed model consistent with actual resolution.
- [ ] Step 6: Add focused tests (new/updated) for: per-agent override precedence, preset overlay precedence, JSONC
      comment parsing tolerance, and fallback on invalid configured model strings.
- [ ] Step 7: Ensure `/reload` remains the documented/apply path for config-only preset switching; update user-facing
      messaging/help text if needed.

## Verification Plan

- Automated:
  - `deno test src/cmd/models/index.test.js`
  - `deno test src/shared/session --allow-all` (or targeted new session tests)
  - `deno test -A` (full suite)
- Manual:
  - Add commented JSONC settings in `~/.hns/settings.json` with `agents.router.model`, run session, confirm router uses
    override.
  - Define `modelPresets.fast` and `modelPresets.quality`, set `activeModelPreset`, run `/reload`, confirm model changes
    per agent.
  - Add both global and project overrides; confirm project wins for same agent key.
  - Set invalid preset model for one agent; confirm resolver skips invalid candidate and falls back without crashing.
- Expected results for key scenarios:
  - Effective runtime and footer model match.
  - Existing `/model` explicit selection still has higher priority for the current agent turn context.
  - JSONC comments/trailing commas are accepted on read; writes remain valid formatted JSON.

## Edge Cases & Considerations

- If `activeModelPreset` references a missing preset, ignore it and use base `agents` map.
- If preset has partial `agents` map, merge only provided agent keys; keep base map for others.
- Invalid candidate model format should not abort unless it came from explicit runtime `modelOverride` (preserve current
  strict behavior for explicit override).
- JSONC parse failure in one scope should not prevent trying fallback/default behavior; avoid hard-failing startup.
