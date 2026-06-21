---
title: Vision Fallback See-Image Tool
status: draft
createdAt: "2026-06-19T00:00:00.000Z"
---

# Vision Fallback See-Image Tool PRD

## Objective

Add a native Harns image fallback for text-only models: when the active Agent model cannot receive images directly,
Harns can route image inspection through a configured vision-capable model and return a textual description to the
primary Agent.

This is inspired by `opencode-see-image`, but should be implemented using Harns' existing model/provider/session
infrastructure rather than OpenCode plugin mechanics.

## Problem Statement

Harns already supports image attachments in the TUI and can pass them to model providers. This works for vision-capable
models, but text-only models cannot reason about screenshots or images directly.

Users need a safe, predictable fallback path:

- Vision-capable active model: send images normally.
- Text-only active model with a configured fallback: allow images and provide a `see_image` tool.
- Text-only active model without fallback: block image attachment/submission with an actionable setup message.

## Current Research Summary

- `opencode-see-image` registers a `see_image` tool that sends an image to a vision-capable model and returns text to
  the primary model.
- Harns already has image attachments in interactive sessions and passes them to `AgentSession.prompt()` when present.
- Pi/Harns model metadata includes input modality information, including whether a model supports `image` input.
- Harns already injects Custom Tools at Agent Session build time, so a native `see_image` Custom Tool fits the existing
  architecture.
- Google/Hugging Face documentation for `google/gemma-4-12B-it` describes it as multimodal with image input and strong
  image understanding capabilities.
- Google Gemma docs show Gemma 3+ image-understanding workflows; Gemma 4 docs/model cards describe multimodal image
  input and local execution suitability.

## Resolved Assumptions

- This feature applies only when the active Agent model is text-only.
- Vision-capable active models keep direct image behavior.
- Fallback vision configuration is global/preset-level, not per-agent.
- `visionFallback.model` uses the existing Harns single string model format: `provider/model`.
- Resolution order:
  1. Active preset `modelPresets.<activeModelPreset>.visionFallback.model`
  2. Top-level `visionFallback.model`
  3. Disabled if unset
- `see_image` must call the fallback model through Harns/pi provider/model APIs and configured auth. No direct
  provider-specific HTTP calls.
- Pasted images should be saved as session-scoped artifacts with Harns-generated references.
- Local image files should be addressable by safe project-relative path.
- No automatic image cleanup is required in v1, but future session expiration/deletion must remove associated session
  image artifacts.

## Settings UX

Add a Harns custom setting:

```jsonc
{
    "visionFallback": {
        "model": "lmstudio/google/gemma-4-12B-it"
    },

    "activeModelPreset": "local",
    "modelPresets": {
        "local": {
            "visionFallback": {
                "model": "lmstudio/google/gemma-4-12B-it"
            },
            "agents": {
                "engineer": {
                    "model": "lmstudio/some-text-only-code-model"
                }
            }
        }
    }
}
```

Add a docs section named exactly:

```md
### visionFallback
```

The blocking error should point to:

```text
docs/settings.md#visionfallback
```

Docs should include a Gemma 4 / LM Studio setup example and explain that Gemma 4 12B is a recommended local
image-description fallback when available.

## Attachment Gating UX

Harns should check image compatibility twice:

1. Paste/attach time
2. Submit time

This is necessary because the user can attach an image, then switch models or reload settings before submitting.

### Vision-capable active model

- Allow paste/attach.
- Send raw images to the active model as today.
- Do not inject `see_image` merely because fallback exists.

### Text-only active model with fallback configured

- Allow paste/attach.
- Show a warning:

```text
Current model does not support vision. Images will be described using visionFallback.model: <provider/model>.
```

- On submit, do not send raw image content to the primary model.
- Send textual markers for available image references.
- Inject/enable `see_image` for the Agent.

### Text-only active model without fallback configured

- Block image paste/attach.
- If a submit-time check fails, block submission non-destructively.
- Preserve typed text and attached image previews so the user can configure `visionFallback.model` or switch to a
  vision-capable model and retry.
- Show an actionable message:

```text
Cannot attach image: current model does not support vision and no visionFallback.model is configured.
See docs/settings.md#visionfallback to configure an image fallback model.
```

## Image References

Do not rely only on turn-local image indexes. Generalize image references so agents can inspect pasted images and local
image files.

Supported v1 references:

- `attachment:<uuid>` — pasted/session image saved by Harns.
- `relative/path.png` — local/project image file, resolved with normal safe read-path rules.

Bare filename search is out of scope for v1.

When a pasted image is attached for a text-only model with fallback, the primary model should receive a marker like:

```text
[Image attached: attachment:8f3c... image/png]
```

## Session Image Storage

Pasted images should be persisted as session-scoped artifacts so resumed sessions can still resolve their
`attachment:<uuid>` references.

Proposed storage shape:

```text
~/.hns/sessions/<encoded-cwd>/<sessionId>_images/<uuid>.<ext>
```

Rules:

- Attachment refs are scoped to the Agent Session.
- Resuming the same session rehydrates access to the same refs.
- Other sessions cannot rely on those refs.
- v1 does not need automatic cleanup.
- Future session expiration/deletion must remove the matching image directory.

## `see_image` Tool

Register a Harns Custom Tool named `see_image` when all are true:

- Active Agent model is text-only.
- A `visionFallback.model` is configured and resolved.
- There is at least one available image reference in the current session/context, or local image paths are allowed.

Suggested schema:

```json
{
    "imageRef": "attachment:8f3c...",
    "question": "What error is shown in the screenshot?"
}
```

Fields:

- `imageRef` — required string. Either `attachment:<uuid>` or a safe local/project image path.
- `question` — optional string. Defaults to a detailed general description prompt.

Default vision prompt should ask for:

- A detailed description of visible UI/content.
- Any readable text or error messages.
- Relevant layout, controls, highlighted regions, or visual state.
- Explicit uncertainty when text/details are unclear.

The tool returns plain text to the primary Agent.

## Fallback Model Invocation

`see_image` must use Harns/pi's existing model registry/provider/auth path.

Requirements:

- Resolve `visionFallback.model` with the same strict model resolution principles as other configured models.
- Ensure the fallback model supports image input before use.
- Use a minimal single-shot prompt/session without workflow tools, memories, or agent-specific system prompts.
- Do not implement provider-specific HTTP calls.
- Surface clear errors if the configured fallback model is unavailable, unauthenticated, or not vision-capable.

## Out of Scope

- Direct OpenCode plugin integration.
- Querying OpenCode SQLite databases.
- macOS screenshot filesystem search by bare filename.
- Direct provider-specific HTTP clients.
- Per-agent vision fallback configuration.
- Automatic cleanup of session image directories in v1.
- Using fallback when the active model already supports vision.
- Treating `see_image` as a general OCR-only tool; it is a vision-description fallback.
