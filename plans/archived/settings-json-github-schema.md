---
classification: "FEATURE"
complexity: "LOW"
summary: "Create a JSON schema for wld settings.json and document how to reference it via GitHub releases. This involves defining the schema based on RUNWEILD_CUSTOM_SETTING_KEYS and existing settings logic in src/shared/settings.js, and updating the README to provide the $schema URL."
affectedPaths:
    - "config.schema.json"
    - "README.md"
createdAt: "2026-06-23T21:07:43-04:00"
updatedAt: "2026-06-24T17:35:15.322Z"
status: "verified"
origin: "internal"
verifiedAt: "2026-06-24T17:35:15.322Z"
humanReviewMode: "ask"
humanReviewDecision: "skipped"
---

# Settings JSON Schema Release Asset

## Context

RunWield users edit global and project settings in JSONC files at `~/.wld/settings.json` and `.wld/settings.json`. The
request is for those files to be able to reference a schema directly from GitHub releases, using this style:

```json
{
    "$schema": "https://github.com/gandazgul/runwield/releases/latest/download/config.schema.json"
}
```

There is currently no settings schema file in the repository. The release workflow uploads compiled binaries and
`SHA256SUMS`, but it does not upload a schema asset.

## Objective

Add a permissive-but-useful JSON Schema for RunWield settings and ensure release publishing attaches it as
`config.schema.json`, so editors can fetch the schema from
`https://github.com/gandazgul/runwield/releases/latest/download/config.schema.json`. Document the URL and example
`$schema` entry for both global and project settings files.

## Approach

Create a root `config.schema.json` using JSON Schema draft 2020-12. Model both RunWield custom settings from
`src/shared/settings.js` / `docs/settings.md` and inherited Pi-backed settings from `@earendil-works/pi-coding-agent`'s
`Settings` interface. Keep the schema forward-compatible by allowing additional properties while defining known
properties for editor autocomplete and validation. Include `$schema` as an allowed string property because users will
place the schema URL directly in their settings files.

Update `.github/workflows/release.yml` so the release job checks out the repository and includes the root schema file in
the `softprops/action-gh-release` file list. Add concise documentation in `docs/settings.md` and a short README pointer.

## Files to Modify

- `config.schema.json` — new root JSON Schema release asset for RunWield settings.
- `.github/workflows/release.yml` — check out the repo in the release job and upload `config.schema.json` alongside
  binary assets.
- `docs/settings.md` — document the `$schema` URL, JSONC compatibility note, and example usage.
- `README.md` — add a brief settings-schema pointer near the settings/data-location documentation.

## Reuse Opportunities

Existing source/docs to mirror rather than invent:

- `src/shared/settings.js` — RunWield custom setting keys and runtime behavior for `agents`, `modelPresets`,
  `visionFallback`, `compactOnResumeThresholdPercent`, `verification_command`, `codereview`, cleanup, and external
  skill/global prompt toggles.
- `src/shared/session/session.js` — per-agent `model`, `thinkingLevel`, and `temperature` resolution and validation
  rules.
- `src/cmd/resume/index.js` — `compactOnResumeThresholdPercent` range (`1` through `100`) and default behavior.
- `docs/settings.md` — current public settings reference and examples.
- `../pi-mono/packages/coding-agent/src/core/settings-manager.ts` — upstream Pi-backed `Settings` shape for inherited
  keys.
- `../pi-mono/packages/ai/src/types.ts` — inherited transport enum values (`sse`, `websocket`, `websocket-cached`,
  `auto`).
- `.github/workflows/release.yml` — existing release asset publishing path.

## Implementation Steps

- [ ] Add `config.schema.json` at the repository root.
  - Use draft 2020-12 metadata: `"$schema": "https://json-schema.org/draft/2020-12/schema"`.
  - Set `$id` to `https://github.com/gandazgul/runwield/releases/latest/download/config.schema.json`.
  - Set root `type` to `object` and leave `additionalProperties: true` so future upstream Pi keys, extension-owned
    settings, and future RunWield keys do not become false errors.
  - Include top-level `"$schema"` as a string property with the recommended GitHub release URL.
  - Define reusable `$defs` for common shapes: thinking levels, provider/model references, agent overrides, model
    presets, package sources, string arrays, compaction, branch summaries, retry settings, terminal settings, image
    settings, thinking budgets, markdown, and warnings.
- [ ] Ensure schema coverage matches current RunWield behavior.
  - Custom top-level keys: `agents`, `activeModelPreset`, `modelPresets`, `visionFallback`,
    `compactOnResumeThresholdPercent`, `verification_command`, `codereview`, `cleanupMergedWorktrees`,
    `enableExternalSkills`, and `enableExternalGlobalAgentsMd`.
  - Agent override fields: `model` as a non-empty string in broad `provider/model_id` form, `thinkingLevel` enum
    `off|minimal|low|medium|high|xhigh`, and `temperature` number from `0` through `2`.
  - Preset shape: optional `agents` map plus optional `visionFallback` object.
  - `compactOnResumeThresholdPercent`: integer minimum `1`, maximum `100`.
  - `codereview`: enum `none|ask|always`.
- [ ] Ensure schema coverage matches inherited Pi-backed settings.
  - Include keys from the current `Settings` interface: `lastChangelogVersion`, `defaultProvider`, `defaultModel`,
    `defaultThinkingLevel`, `transport`, `steeringMode`, `followUpMode`, `theme`, `compaction`, `branchSummary`,
    `retry`, `hideThinkingBlock`, `shellPath`, `quietStartup`, `defaultProjectTrust`, `shellCommandPrefix`,
    `npmCommand`, `collapseChangelog`, `enableInstallTelemetry`, `enableAnalytics`, `trackingId`, `packages`,
    `extensions`, `skills`, `prompts`, `themes`, `enableSkillCommands`, `terminal`, `images`, `enabledModels`,
    `doubleEscapeAction`, `treeFilterMode`, `thinkingBudgets`, `editorPaddingX`, `autocompleteMaxVisible`,
    `showHardwareCursor`, `markdown`, `warnings`, `sessionDir`, `httpProxy`, `httpIdleTimeoutMs`, and
    `websocketConnectTimeoutMs`.
  - For legacy migration keys that users may still have (`queueMode`, `websockets`, old object-shaped `skills`, and
    `retry.maxDelayMs`), either allow them via `additionalProperties` only or define them with `deprecated: true` and a
    description pointing at the modern key. Prefer explicit deprecated definitions if they improve editor guidance
    without overcomplicating the schema.
- [ ] Update `.github/workflows/release.yml`.
  - Add a checkout step to the `release` job before publishing assets, because the current release job only downloads
    artifacts.
  - Add `config.schema.json` to `softprops/action-gh-release` `files:` so tags publish a release asset named exactly
    `config.schema.json`.
- [ ] Update `docs/settings.md`.
  - Add a short “JSON Schema” section near the top with the exact `$schema` URL and a JSONC example.
  - Explain that settings files are JSONC, but the schema asset itself is strict JSON for editor compatibility.
  - Mention that the schema is intentionally permissive for unknown keys but validates/autocompletes known RunWield and
    inherited Pi settings.
  - If inherited Pi-backed keys in the schema are missing from the current table, add concise rows for them or
    explicitly note that the schema includes currently inherited upstream settings.
- [ ] Update `README.md`.
  - Add a concise pointer that `~/.wld/settings.json` / `.wld/settings.json` can include the GitHub release `$schema`
    URL.
  - Link to `docs/settings.md` for the complete settings reference.
- [ ] Validate formatting and syntax.
  - Parse `config.schema.json` with `JSON.parse`.
  - Run Deno formatting checks on the changed JSON, YAML, and Markdown files.

## Verification Plan

- Automated:
  - `deno eval 'JSON.parse(await Deno.readTextFile("config.schema.json")); console.log("schema ok")'`
  - `deno fmt --check`
- Manual:
  - Confirm `config.schema.json` contains
    `$id: "https://github.com/gandazgul/runwield/releases/latest/download/config.schema.json"`.
  - Confirm `.github/workflows/release.yml` uploads `config.schema.json` as a top-level release asset, not inside a
    tarball.
  - Open a sample settings object containing the documented `$schema`, `agents.router.model`,
    `modelPresets.fast.visionFallback.model`, `codereview`, and `packages` entries against the schema in an editor or
    schema validator to verify autocomplete/validation appears sensible.
- Expected results:
  - The schema JSON parses cleanly.
  - Formatting checks pass.
  - Future GitHub releases expose `config.schema.json` at `/releases/latest/download/config.schema.json`.
- Its ok with deno fmt formatted unrelated files this is always ok

## Edge Cases & Considerations

- GitHub `releases/latest/download/...` only resolves after a release containing the schema has been published; before
  the next release, local docs can point users to the raw file or explain that the URL becomes available on release.
- Settings files are JSONC, but JSON Schema files must remain strict JSON; do not add comments to `config.schema.json`.
- `additionalProperties: true` is intentional to avoid blocking upstream Pi settings, extension-owned settings, and
  future RunWield keys.
- The schema should validate shapes that RunWield actually tolerates; avoid over-constraining model IDs because many
  providers use slash-containing model names after the provider prefix.
- `defaultProjectTrust`, external skills, and external global prompt toggles are effectively global settings, but the
  schema should describe this rather than invalidating project files that happen to contain them.
- Existing unrelated working tree changes should not be modified by this feature.
