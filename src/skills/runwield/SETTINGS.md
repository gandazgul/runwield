# Settings

Use this file for settings and model questions. Link to these docs for depth:

- https://github.com/gandazgul/runwield/blob/main/docs/settings.md
- https://github.com/gandazgul/runwield/blob/main/docs/providers.md
- https://github.com/gandazgul/runwield/blob/main/docs/router-model-selection.md

## Files and merge behavior

RunWield reads JSONC settings from `~/.wld/settings.json` and project `.wld/settings.json`. Project settings override
global settings. RunWield merges custom object keys `agents` and `modelPresets` by top-level object key instead of
replacing them wholesale.

MCP servers use separate files, not settings: `~/.wld/mcp.json` and optional project `.wld/mcp.json`. The project MCP
file must be local-only: regular file, untracked, not staged, and ignored by Git. See `docs/mcp.md`.

If a user asks what their setup does, read these files before answering.

## Per-Agent model overrides

`agents.<name>` can set:

- `model`: a string in `provider/model_id` form.
- `thinkingLevel`: `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`.
- `temperature`: a number from `0` to `2`.

Bundled Agent names are `architect`, `engineer`, `guide`, `ideator`, `operator`, `planner`, `router`, and `tester`.

## Model presets

`activeModelPreset` names the active entry in `modelPresets`. If it is unset, missing, or unknown, RunWield uses base
`agents` settings. Presets are partial: missing values fall back per Agent to the base `agents` entry. A manual `/model`
override wins until the active Agent changes.

Working example:

```jsonc
{
    "agents": {
        "router": {
            "model": "openai/gpt-5-mini",
            "thinkingLevel": "minimal",
            "temperature": 0.1
        },
        "engineer": {
            "model": "anthropic/claude-sonnet-4-5",
            "thinkingLevel": "high",
            "temperature": 0.4
        }
    },
    "activeModelPreset": "cheap",
    "modelPresets": {
        "cheap": {
            "agents": {
                "router": {
                    "model": "openai/gpt-5-mini",
                    "thinkingLevel": "minimal",
                    "temperature": 0.1
                },
                "planner": {
                    "model": "anthropic/claude-haiku-4-5",
                    "thinkingLevel": "low",
                    "temperature": 0.3
                }
            }
        },
        "quality": {
            "agents": {
                "router": {
                    "model": "anthropic/claude-sonnet-4-5",
                    "thinkingLevel": "medium",
                    "temperature": 0.1
                },
                "engineer": {
                    "model": "anthropic/claude-opus-4-5",
                    "thinkingLevel": "xhigh",
                    "temperature": 0.4
                }
            }
        }
    }
}
```

To make Router cheaper, add or edit `agents.router` in the active preset, then set `activeModelPreset` to that preset
name and run `/reload` in active sessions.

## `visionFallback`

`visionFallback.model` configures a vision-capable fallback model for image inspection when the active Agent model is
text-only. Resolution order:

1. `modelPresets.<activeModelPreset>.visionFallback.model`.
2. Top-level `visionFallback.model`.
3. Disabled when unset.

Vision-capable active models keep receiving images directly and do not get the `see_image` tool. Text-only active models
with a fallback receive image descriptions through `see_image`. Text-only active models without a fallback block image
paste/submission non-destructively.

## Providers and authentication

Use `/login` to configure subscription or API-key credentials. Use `/status` to show configured providers and available
models. RunWield stores credentials in `~/.wld/auth.json`.

`~/.wld/models.json` is the model registry for custom or self-hosted models such as Ollama, LM Studio, vLLM, API
proxies, or OpenAI-compatible servers. Explicit settings use `provider/model_id` values from that registry.

## Other user-facing keys

- `defaultProvider`, `defaultModel`, and `defaultThinkingLevel`: base model defaults.
- `theme`: active TUI theme.
- `compaction.enabled`, `compaction.reserveTokens`, and `compaction.keepRecentTokens`: automatic compaction behavior.
- `compactOnResumeThresholdPercent`: when resume offers compaction.
- `verification_command`: local validation command used by Mechanical Validation.
- `codereview`: human code-review gate; `none`, `ask`, or `always`.
- `cleanupMergedWorktrees`: whether verified merged worktrees are cleaned up.
- `workRecords.autoGenerateOnPlanCompletion`: automatic Work Record creation after supported terminal outcomes.
- `plans.archiveRetentionDays`: project-scope-only archived Plan retention delay. Default `14`. `0` makes a covered
  archived Plan due immediately.
- `plans.archiveKeepLast`: project-scope-only floor that spares the newest eligible archived Plans. Default `10`. `0`
  disables the floor.
- `workflowMetrics.enabled`: local workflow metrics recording.
- `planServerUrl`: default Plan Server URL for collaborative Shared Spaces.
