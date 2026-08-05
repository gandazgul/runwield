---
planId: "38f852a4-325e-4726-9fb2-258186fcb8ca"
classification: "FEATURE"
complexity: "HIGH"
summary: "Implement a vision fallback mechanism for text-only models. This involves: 1. Adding `visionFallback` configuration to settings. 2. Modifying session building to inject a `see_image` tool when the active model is text-only but a fallback is configured. 3. Implementing the `see_image` tool, which uses the configured fallback vision model to describe images. 4. Implementing image attachment gating (block/warn/allow) based on model capabilities and fallback configuration. 5. Implementing session-scoped image storage for pasted attachments. 6. Updating settings documentation."
affectedPaths:
    - "src/shared/settings.js"
    - "src/shared/session/session.js"
    - "src/shared/models/model-registry.js"
    - "src/tools/see-image.js"
    - "src/shared/ui/interactive-session.js"
    - "docs/settings.md"
createdAt: "2026-06-19T04:10:33.000Z"
updatedAt: "2026-07-17T04:52:44.556Z"
status: "verified"
origin: "internal"
implementedAt: "2026-06-19T04:25:35.650Z"
verifiedAt: "2026-06-19T04:43:23.927Z"
workRecord:
    status: "generated"
    recordId: "09c20c7b-870b-4d13-bb62-98803cf71145"
    path: "docs/work-records/2026-07-17-added-vision-fallback-for-text-only-models.md"
    lastAttemptAt: "2026-07-17T04:52:37.432Z"
routingIntent: "FEATURE"
---

# Vision Fallback See-Image Tool

## Context

`docs/prd/done/vision-fallback-see-image.md` specifies a native Harns fallback for users running text-only agent models.
Harns can already paste and send image attachments to providers, but text-only models cannot consume those raw image
blocks. The desired behavior is:

- vision-capable active models keep the current direct image path;
- text-only active models with a configured `visionFallback.model` can accept images and inspect them through a
  `see_image` Custom Tool;
- text-only active models without a fallback get a non-destructive, actionable block message.

## Objective

Implement `visionFallback.model` resolution, image capability checks, session-scoped pasted-image references,
submit/paste-time gating, and a `see_image` tool that invokes the configured fallback model through Harns/pi
model/provider/auth infrastructure. Update docs and tests so the feature is safe to use with local LM Studio/Gemma-style
fallback models.

## Approach

Add small reusable helpers instead of embedding vision logic directly in UI handlers:

- settings/model helpers resolve and validate `visionFallback.model` in the same strict `provider/model` format as
  configured models;
- image-reference helpers persist pasted images under the root session image directory and resolve `attachment:<uuid>`
  or safe project-relative image paths for the tool;
- session prompt helpers decide whether to send raw image content or textual `[Image attached: ...]` markers based on
  the active model's `input` metadata;
- `buildAgentSession()` resolves the active model before final tool assembly, then auto-injects `see_image` only for
  text-only models with a validated fallback;
- paste and submit handlers call the same preflight helper so model/settings changes between paste and submit are
  caught.

Use `completeSimple()` from `@earendil-works/pi-ai` for the fallback model call, with API key/headers/env obtained from
`getModelRegistry().getApiKeyAndHeaders(fallbackModel)`. This keeps provider access inside pi's provider layer and
avoids adding provider-specific HTTP clients.

## Files to Modify

- `src/shared/settings.js` — preserve `visionFallback` as a Harns custom setting and add a helper to resolve
  active-preset fallback before top-level fallback.
- `src/shared/models/model-registry.js` — reuse existing discovery behavior; add focused helpers only if needed for
  strict fallback lookup errors.
- `src/shared/session/types.js` — extend `ImageAttachment` with optional `ref`, `path`, and/or persisted metadata fields
  via JSDoc.
- `src/shared/session/root-session.js` — expose a helper for `<sessionId>_images` directory path using the existing
  encoded cwd/session directory shape.
- `src/shared/session/image-attachments.js` — new pure-JS module for model vision capability checks, paste/submit
  preflight, artifact persistence, marker formatting, and attachment/local-path resolution.
- `src/tools/see-image.js` — new Custom Tool factory for `see_image` with schema, image resolution, fallback model
  invocation, and plain-text result extraction.
- `src/shared/session/session.js` — resolve model before final custom-tool assembly, auto-inject `see_image`, transform
  images in `runPrompt()`/steering, and keep reload behavior consistent when model/settings change.
- `src/shared/interactive/keybindings.js` — gate `Ctrl+V` paste, persist the pasted artifact, and show warn/block
  messages before adding previews.
- `src/shared/interactive/chat-session.js` — submit-time preflight before clearing editor/previews; preserve text/images
  on block; apply marker/direct-image behavior for queued/steered messages.
- `docs/settings.md` — add `### visionFallback` exactly and include LM Studio/Gemma 4 12B setup guidance plus the
  actionable error anchor.
- Tests beside modified modules — add unit coverage for settings resolution, image storage/resolution, prompt
  transformation, tool invocation, keybinding gating, and non-destructive submit blocking.

## Reuse Opportunities

- `src/shared/settings.js#getMergedCustomSetting()` — read merged global/project `activeModelPreset`, `modelPresets`,
  and `visionFallback` values.
- `src/shared/models/model-validation.js#parseProviderModel()` — enforce strict `provider/model` parsing for fallback
  settings.
- `src/shared/models/model-registry.js#discoverProviderModel()` — discover configured OpenAI-compatible provider models
  before failing strict fallback validation.
- `src/shared/session/root-session.js#getHarnsSessionDir()` — build `~/.hns/sessions/<encoded-cwd>/<sessionId>_images`
  without duplicating cwd encoding.
- `src/shared/session/session.js#buildAgentSession()` — existing custom-tool injection point for native Harns tools.
- `src/shared/session/session.js#runPrompt()` and `steerRootSessionWithTarget()` — current centralized raw image-to-LLM
  conversion points.
- `src/shared/interactive/keybindings.js` and `chat-session.js#editor.onSubmit` — existing paste and submit lifecycle
  points.
- `@earendil-works/pi-ai#completeSimple()` — single-shot provider/model call for the fallback vision model.

## Implementation Steps

- [ ] Step 1: Add settings and model capability helpers.
  - Add `"visionFallback"` to `HARNS_CUSTOM_SETTING_KEYS` in `src/shared/settings.js` so Pi settings writes preserve it.
  - Add `getResolvedVisionFallbackModelSetting()` (name can vary) that returns the model string by resolution order:
    active preset `modelPresets.<active>.visionFallback.model`, then top-level `visionFallback.model`, else `undefined`.
  - Add unit tests for preset wins, top-level fallback, unset, invalid shapes ignored, and preservation across
    `preserveHarnsCustomSettingsForWrite()`.
  - Add a `modelSupportsImageInput(model)` helper that returns true only when `model.input` includes `"image"`.

- [ ] Step 2: Add session-scoped image artifact helpers.
  - Create `src/shared/session/image-attachments.js`.
  - Implement `getSessionImageDir(sessionManager, cwd)` using `getHarnsSessionDir(cwd)` and
    `sessionManager.getSessionId()` to produce `<sessionId>_images`.
  - Implement `persistImageAttachment({ base64, mimeType }, sessionManager, cwd)`:
    - generate a UUID with `crypto.randomUUID()`;
    - choose `.png`, `.jpg`, `.jpeg`, `.gif`, or `.webp` from MIME, defaulting safely/rejecting unsupported non-image
      MIME;
    - create the image directory recursively;
    - decode base64 and write bytes;
    - return an `ImageAttachment` including `{ base64, mimeType, ref: "attachment:<uuid>", path }`.
  - Implement `resolveImageRef(imageRef, { sessionManager, cwd })`:
    - `attachment:<uuid>` resolves only inside that session's image directory by locating `<uuid>.<known-image-ext>`;
    - local refs must be project-relative paths (strip a leading `@` if present), must not escape `cwd`, and must point
      to an image file;
    - return `{ path, mimeType, refType }` or throw clear user-facing errors.
  - Unit-test persistence path shape, base64 decoding, attachment ref resolution after re-instantiating helper state,
    bad UUID/path rejection, path traversal rejection, and MIME inference.

- [ ] Step 3: Add fallback model validation/resolution.
  - Implement `resolveVisionFallbackModel(modelRegistry = getModelRegistry())` in a shared module or
    `src/tools/see-image.js` helper:
    - read `getResolvedVisionFallbackModelSetting()`;
    - parse with `parseProviderModel()` and throw `Invalid visionFallback.model: <value>. Use provider/id.` on invalid
      configured strings;
    - find or `discoverProviderModel()`;
    - require `modelRegistry.hasConfiguredAuth(found)`;
    - require `modelSupportsImageInput(found)`;
    - return `{ model, modelRef }` or `undefined` when unset.
  - Keep errors explicit for unknown, unauthenticated, or non-vision fallback models.
  - Unit-test strict errors and discovery fallback using a fake registry/fetch.

- [ ] Step 4: Implement the `see_image` Custom Tool.
  - Create `src/tools/see-image.js` exporting
    `createSeeImageTool({ cwd, sessionManager, fallbackModel, modelRegistry })`.
  - Define parameters with `Type.Object({ imageRef: Type.String(...), question: Type.Optional(Type.String(...)) })` and
    `additionalProperties: false`.
  - In `execute()`, resolve `imageRef`, read bytes, base64 encode, build the default detailed description prompt when
    `question` is omitted, and call
    `completeSimple(fallbackModel, { messages: [...] }, { signal, apiKey, headers, env, maxTokens: reasonableLimit })`.
  - Obtain auth with `modelRegistry.getApiKeyAndHeaders(fallbackModel)` and surface its error if it returns `ok: false`
    or no usable auth.
  - Return plain text by joining text blocks from the assistant response; if the model returns an error stop reason,
    return an error tool result with the provider message.
  - Add tests that mock `completeSimple`/auth dependencies and verify default prompt content, local and attachment refs,
    auth errors, non-vision validation, and text extraction.

- [ ] Step 5: Auto-inject `see_image` only for text-only active models with fallback.
  - In `src/shared/session/session.js#buildAgentSession()`, resolve `resolvedModel` before final tool list/custom tool
    assembly.
  - If `resolvedModel` is text-only and `resolveVisionFallbackModel()` returns a fallback, append `see_image` to the
    effective `tools` list and add
    `createSeeImageTool({ cwd: sessionCwd, sessionManager, fallbackModel, modelRegistry })` to `finalCustomTools` unless
    already present.
  - Store enough root-session metadata to know whether the current root was built in direct-vision mode, fallback mode,
    or no-image mode.
  - Do not inject the tool when the active model supports images, even if fallback is configured.
  - Ensure `assembleFinalSystemPrompt()` receives the final tool list including `see_image` so agents see its schema and
    usage guidance.
  - On `/model` changes in `chat-session.js#setActiveModel()` and on `/reload`, rebuild the root session when image
    capability/fallback availability changes, because the tool set cannot be safely updated by only changing
    `session.setModel()`/system prompt.
  - Add/update session tests proving: vision-capable active model sends images directly and has no `see_image`;
    text-only + fallback injects `see_image`; text-only + no fallback does not inject; invalid fallback gives a clear
    setup error; switching between vision/text-only models updates the tool set.

- [ ] Step 6: Transform image submissions according to active model capability.
  - Add a helper such as `prepareImagesForModel({ text, images, activeModel, fallbackModelRef })`:
    - vision-capable active model: return original text and raw `requestOptions.images`;
    - text-only + fallback: append markers like `[Image attached: attachment:<uuid> image/png]` to the user text and
      return no raw images;
    - text-only + no fallback: return/block with the configured error message.
  - Use it in `runPrompt()` before calling `session.prompt()`.
  - Use the same transformation in `steerRootSessionWithTarget()` before calling `session.steer()` so mid-run steering
    does not leak raw images to a text-only model.
  - Preserve existing UI rendering of previews/user messages; only provider payload changes.
  - Add tests around `runPrompt()`/steering behavior using fake session objects.

- [ ] Step 7: Gate image paste/attach at paste time.
  - Extend `installKeybindings()` context with an async `handleImagePaste` or `preflightImageAttachment` dependency
    supplied by `chat-session.js`.
  - On `Ctrl+V`, after `readClipboardImage()` succeeds, preflight against `getRootAgentSession()?.model` and current
    fallback setting:
    - vision-capable active model: persist artifact optionally but allow normally;
    - text-only + fallback: persist artifact, append warning
      `Current model does not support vision. Images will be described using visionFallback.model: <provider/model>.`,
      then add preview;
    - text-only + no fallback: do not mutate `pastedImages`/previews and show exactly the configured blocking message
      pointing to `docs/settings.md#visionfallback`.
  - Prefer persisting all pasted images so resumed sessions can resolve refs even if the user later switches to a
    text-only fallback path.
  - Update keybinding tests with injected fake preflight/persist behavior.

- [ ] Step 8: Gate image submission non-destructively at submit time.
  - Make `editor.onSubmit` in `chat-session.js` run image preflight before it clears `pastedImages`, previews, or editor
    text.
  - If submit-time check blocks, append the blocking message and return with typed text and previews intact.
  - If text-only + fallback, append the warning if it was not already shown for these images and continue with marker
    transformation downstream.
  - Apply the same check before steering/queueing while `isProcessingSubmission` is true; if blocked, keep the editor
    state intact rather than creating a queued message.
  - Add tests for model switch between paste and submit: pasted image remains visible and text remains editable when
    fallback is missing; switching to vision-capable or configuring fallback allows retry.

- [ ] Step 9: Update docs.
  - In `docs/settings.md`, add a section named exactly `### visionFallback` under Harns custom keys or near model
    presets.
  - Document top-level and preset-level shapes, resolution order, behavior matrix, the blocking error anchor, and LM
    Studio/Gemma 4 12B example:
    ```jsonc
    {
        "visionFallback": { "model": "lmstudio/google/gemma-4-12B-it" },
        "modelPresets": {
            "local": {
                "visionFallback": { "model": "lmstudio/google/gemma-4-12B-it" }
            }
        }
    }
    ```
  - Add `visionFallback` to the Harns Custom Keys table.

- [ ] Step 10: Run full validation and fix all issues.
  - Run targeted tests for modified modules while iterating.
  - Run `deno fmt`.
  - Run `deno run ci` and fix all failures.

## Verification Plan

- Automated:
  - `deno test src/shared/settings.test.js src/shared/session/session-prompt.test.js src/shared/session/session-catalog.test.js src/shared/interactive/keybindings.test.js src/shared/interactive/chat-session.test.js src/tools/see-image.test.js`
  - `deno fmt`
  - `deno run ci`
- Manual:
  - Configure a vision-capable active model, paste a screenshot, submit a prompt, and confirm the provider payload still
    includes raw image content and no `see_image` tool appears.
  - Configure a text-only active model plus `visionFallback.model`, paste an image, confirm the warning appears, submit,
    and confirm the model receives an attachment marker and can call `see_image` with `attachment:<uuid>`.
  - Configure a text-only active model without fallback, paste an image, and confirm the paste is blocked with
    `docs/settings.md#visionfallback` while existing text is untouched.
  - Paste with fallback configured, remove fallback or switch to a text-only model without fallback before submit, and
    confirm submission is blocked non-destructively.
  - Resume the same session and call `see_image` on an existing `attachment:<uuid>` marker; confirm it resolves from
    `~/.hns/sessions/<encoded-cwd>/<sessionId>_images/`.
  - Call `see_image` with a safe project-relative image path and confirm it is described; call it with `../outside.png`
    or an unsupported file and confirm a clear error.
- Expected results:
  - Raw images are never sent to text-only primary models when fallback mode is active.
  - `see_image` is unavailable for vision-capable active models and unavailable when fallback is unset.
  - All blocked flows preserve typed text and visible attachment previews.

## Edge Cases & Considerations

- Provider discovery currently registers dynamically discovered OpenAI-compatible models with
  `input: ["text", "image"]`; this is acceptable for the configured fallback path but still must be checked before use.
- If the active model metadata lacks `input`, treat it as text-only because pi defaults custom model input to
  `["text"]`.
- If fallback validation fails at paste time, show the actionable setup/error message and do not attach the image; if it
  fails at tool-call time, return a tool error with the specific cause.
- `see_image` must not use workflow tools, memories, agent-specific prompts, or Harns system prompts. Keep it a single
  provider call.
- Session image cleanup is out of scope for v1, but store images in a predictable `<sessionId>_images` directory so
  future session deletion can remove it.
- Use only `.js` files and JSDoc typing; do not add TypeScript files or syntax.
