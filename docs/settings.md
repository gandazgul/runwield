# Settings Reference

Harns reads settings from JSONC files, so comments and trailing commas are allowed.

- Global settings: `~/.hns/settings.json`
- Project settings: `<project>/.hns/settings.json`

Project settings override global settings. For ordinary Pi-backed settings, nested objects are shallow-merged and arrays
replace the global value. For Harns custom object keys such as `agents` and `modelPresets`, Harns merges the top-level
object keys only, so a project `agents.router` object replaces the global `agents.router` object.

If `~/.hns/settings.json` does not exist, Harns imports `~/.pi/agent/settings.json` once. After that, Harns only reads
and writes `~/.hns/settings.json`.

Run `/reload` in an active TUI session after editing settings by hand. `/reload` refreshes settings, the active theme,
the root agent model, the root agent thinking level, prompt templates, skills, and memories.

## Example

```jsonc
{
    "defaultProvider": "anthropic",
    "defaultModel": "claude-sonnet-4-5",
    "defaultThinkingLevel": "medium",
    "theme": "catppuccin-mocha",

    "visionFallback": {
        "model": "lmstudio/google/gemma-4-12B-it"
    },

    "agents": {
        "router": {
            "model": "openai/gpt-5-mini",
            "thinkingLevel": "minimal"
        },
        "engineer": {
            "model": "anthropic/claude-sonnet-4-5",
            "thinkingLevel": "high"
        }
    },

    "activeModelPreset": "fast",
    "modelPresets": {
        "fast": {
            "agents": {
                "router": {
                    "model": "openai/gpt-5-mini",
                    "thinkingLevel": "minimal"
                },
                "engineer": {
                    "model": "anthropic/claude-haiku-4-5",
                    "thinkingLevel": "low"
                }
            }
        },
        "quality": {
            "agents": {
                "router": {
                    "model": "anthropic/claude-sonnet-4-5",
                    "thinkingLevel": "medium"
                },
                "engineer": {
                    "model": "anthropic/claude-opus-4-5",
                    "thinkingLevel": "xhigh"
                }
            }
        }
    },

    "compaction": {
        "enabled": true,
        "reserveTokens": 16384,
        "keepRecentTokens": 20000
    },

    "compactOnResumeThresholdPercent": 50,
    "verification_command": "deno run ci",
    "cleanupMergedWorktrees": true
}
```

## Agent Model Overrides

Bundled agent names are `architect`, `engineer`, `guide`, `ideator`, `operator`, `planner`, `router`, and `tester`.
Custom agent names can also be used if they match the agent definition name.

### `agents`

Type: object.

Maps agent names to base per-agent overrides:

```jsonc
{
    "agents": {
        "router": {
            "model": "openai/gpt-5-mini",
            "thinkingLevel": "minimal"
        }
    }
}
```

Agent object values:

- `model`: string in `provider/model_id` format. The provider and model id must exist in the model registry and have
  configured auth.
- `thinkingLevel`: one of `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`.

### `activeModelPreset`

Type: string.

Names the active entry in `modelPresets`. If unset, missing, or unknown, Harns uses the base `agents` overrides. If a
session has a manual `/model` override, the manual override wins until the active agent changes.

### `modelPresets`

Type: object.

Defines named groups of agent overrides:

```jsonc
{
    "activeModelPreset": "fast",
    "agents": {},
    "modelPresets": {
        "fast": {
            "agents": {
                "router": { "model": "openai/gpt-5-mini" }
            }
        }
    }
}
```

Each preset has the same `agents.<agentName>.model` and `agents.<agentName>.thinkingLevel` shape as the base `agents`
key. Presets are partial: if the active preset does not define a value for an agent, Harns falls back to that agent's
base `agents` entry.

### visionFallback

Type: object with `model` string in `provider/model_id` format.

`visionFallback` configures a vision-capable fallback model for image inspection when the active agent model is
text-only. Vision-capable active models keep receiving images directly and do not get the `see_image` tool.

Resolution order:

1. Active preset `modelPresets.<activeModelPreset>.visionFallback.model`.
2. Top-level `visionFallback.model`.
3. Disabled when unset.

Example with LM Studio and Gemma 4 12B:

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

Gemma 4 12B is a recommended local image-description fallback when available in LM Studio. Configure the LM Studio
provider/model in Harns' model registry with image input support and auth/base URL as usual, then set
`visionFallback.model` to that `provider/model_id`.

Behavior:

- Vision-capable active model: images are sent directly; `see_image` is not injected just because fallback exists.
- Text-only active model with fallback: image paste/submission is allowed, Harns warns that `visionFallback.model` will
  describe images, raw image bytes are withheld from the primary model, and `see_image` can inspect `attachment:<uuid>`
  or safe project-relative image paths.
- Text-only active model without fallback: image paste/submission is blocked non-destructively with:

```text
Cannot attach image: current model does not support vision and no visionFallback.model is configured.
See docs/settings.md#visionfallback to configure an image fallback model.
```

#### Declaring vision support for discovered models

OpenAI-compatible `/models` endpoints (used to auto-discover models for providers configured with only `baseUrl` +
`apiKey` in `~/.hns/models.json`) do not report per-model input modalities. Harns therefore registers discovered models
as **text-only** by default — sending raw image bytes to a text-only model can fail silently on some providers.

To mark specific discovered models as vision-capable, add an `imageInputModels` array to the provider entry in
`models.json`:

```json
{
    "providers": {
        "crofai": {
            "baseUrl": "https://crof.ai/v1",
            "api": "openai-completions",
            "apiKey": "...",
            "imageInputModels": ["some-vision-model"]
        }
    }
}
```

Models not listed remain text-only and rely on `visionFallback.model`. A model named in `visionFallback.model` is always
treated as vision-capable, so it does not need to appear in `imageInputModels`. To fully control a model's metadata
(context window, cost, etc.), define it explicitly under `providers.<p>.models[]` with `input: ["text", "image"]`
instead of relying on discovery.

### Resolution Order

Model resolution for an agent invocation:

1. Manual `/model` user override for the current active agent.
2. Invocation-specific model, such as a prompt-template `model` frontmatter value.
3. Active preset `modelPresets.<activeModelPreset>.agents.<agent>.model`.
4. Base `agents.<agent>.model`.
5. `defaultProvider` plus `defaultModel`.
6. Layered agent definition frontmatter `model` (`./.hns` > `~/.hns` > bundled).

If none of these resolve to a registered, authenticated model, Harns reports an error instead of falling through to the
underlying agent library's built-in fallback.

Thinking level resolution:

1. Active preset `modelPresets.<activeModelPreset>.agents.<agent>.thinkingLevel`.
2. Base `agents.<agent>.thinkingLevel`.
3. `defaultThinkingLevel`.
4. Layered agent definition frontmatter `thinkingLevel` (`./.hns` > `~/.hns` > bundled).

## Harns Custom Keys

These keys are read by Harns outside the upstream Pi `SettingsManager` schema.

| Key                               | Type    | Values / default        | Scope            | Description                                                                                                                                                                        |
| --------------------------------- | ------- | ----------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agents`                          | object  | agent-name map          | global + project | Base per-agent `model` and `thinkingLevel` overrides.                                                                                                                              |
| `activeModelPreset`               | string  | unset                   | global + project | Selects a named preset from `modelPresets`.                                                                                                                                        |
| `modelPresets`                    | object  | preset-name map         | global + project | Named per-agent override sets.                                                                                                                                                     |
| `visionFallback`                  | object  | unset                   | global + project | Vision-capable fallback model used by `see_image` when the active model is text-only.                                                                                              |
| `compactOnResumeThresholdPercent` | integer | `1`-`100`, default `50` | global + project | `/resume` offers compaction when estimated context reaches this percentage of the selected model context window.                                                                   |
| `verification_command`            | string  | no default              | project          | Command used by workflow validation. Saved when Harns asks for a validation command.                                                                                               |
| `cleanupMergedWorktrees`          | boolean | default `true`          | global + project | When true, successful merge-back removes the execution checkout, deletes its registry entry, and clears plan worktree metadata. Set false to keep merged worktrees for inspection. |
| `enableExternalSkills`            | boolean | default `true`          | global           | When true, Harns includes skills from `~/.agents/skills` after local, home, and bundled Harns skills.                                                                              |
| `enableExternalGlobalAgentsMd`    | boolean | default `true`          | global           | When true, global prompt loading includes `~/.agents/AGENTS.md` after `~/.hns/HARNS.md` and `~/.hns/AGENTS.md`.                                                                    |

## Pi-Backed Keys

These keys come from the upstream `@earendil-works/pi-coding-agent` settings schema used by Harns.

| Key                      | Type         | Values / default                                                             | Description                                                                                   |
| ------------------------ | ------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `lastChangelogVersion`   | string       | unset                                                                        | Last version whose changelog was shown. Usually managed automatically.                        |
| `defaultProvider`        | string       | unset                                                                        | Default model provider, for example `anthropic`, `openai`, or `google`.                       |
| `defaultModel`           | string       | unset                                                                        | Default model id within `defaultProvider`. Unlike agent overrides, this is only the model id. |
| `defaultThinkingLevel`   | string       | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`                           | Default reasoning depth for thinking-capable models.                                          |
| `transport`              | string       | `auto`, `sse`, `websocket`, `websocket-cached`; default `auto`               | Preferred provider transport when supported.                                                  |
| `steeringMode`           | string       | `all` or `one-at-a-time`; default `one-at-a-time`                            | How messages submitted while the agent is streaming are delivered.                            |
| `followUpMode`           | string       | `all` or `one-at-a-time`; default `one-at-a-time`                            | How queued follow-up messages are delivered after the agent stops.                            |
| `theme`                  | string       | default `catppuccin-mocha`                                                   | Active TUI theme name.                                                                        |
| `hideThinkingBlock`      | boolean      | default `false`                                                              | Hide assistant thinking blocks in rendered output.                                            |
| `shellPath`              | string       | unset                                                                        | Custom shell path.                                                                            |
| `quietStartup`           | boolean      | default `false`                                                              | Suppress verbose startup output.                                                              |
| `shellCommandPrefix`     | string       | unset                                                                        | Prefix prepended to each bash command.                                                        |
| `npmCommand`             | string array | unset                                                                        | Command argv used for npm package lookup and install operations.                              |
| `collapseChangelog`      | boolean      | default `false`                                                              | Show condensed changelog after updates.                                                       |
| `enableInstallTelemetry` | boolean      | default `true`                                                               | Send anonymous version/update ping after changelog-detected updates.                          |
| `packages`               | array        | default `[]`                                                                 | Installed npm/git/local package sources. Harns registers theme resources from these packages. |
| `extensions`             | string array | default `[]`                                                                 | Local extension file paths or directories.                                                    |
| `skills`                 | string array | default `[]`                                                                 | Local skill file paths or directories.                                                        |
| `prompts`                | string array | default `[]`                                                                 | Local prompt template file paths or directories.                                              |
| `themes`                 | string array | default `[]`                                                                 | Local theme file paths or directories.                                                        |
| `enableSkillCommands`    | boolean      | default `true`                                                               | Register skills as `/skill:name` commands.                                                    |
| `enabledModels`          | string array | unset                                                                        | Model patterns for model cycling, using the same format as the `--models` CLI flag.           |
| `doubleEscapeAction`     | string       | `fork`, `tree`, `none`; default `tree`                                       | Action for pressing Escape twice with an empty editor.                                        |
| `treeFilterMode`         | string       | `default`, `no-tools`, `user-only`, `labeled-only`, `all`; default `default` | Default filter when opening the session tree.                                                 |
| `editorPaddingX`         | number       | clamped to `0`-`3`, default `0`                                              | Horizontal input editor padding.                                                              |
| `autocompleteMaxVisible` | number       | clamped to `3`-`20`, default `5`                                             | Maximum visible autocomplete items.                                                           |
| `showHardwareCursor`     | boolean      | default `false`, or `PI_HARDWARE_CURSOR=1`                                   | Show the terminal cursor while positioning it for IME support.                                |
| `sessionDir`             | string       | unset                                                                        | Custom session storage directory. `~` and `~/...` are expanded.                               |

### `compaction`

| Key                           | Type    | Values / default | Description                                                          |
| ----------------------------- | ------- | ---------------- | -------------------------------------------------------------------- |
| `compaction.enabled`          | boolean | default `true`   | Enable automatic context compaction.                                 |
| `compaction.reserveTokens`    | number  | default `16384`  | Tokens reserved for prompt and response during compaction decisions. |
| `compaction.keepRecentTokens` | number  | default `20000`  | Recent context budget retained around the compaction boundary.       |

### `branchSummary`

| Key                           | Type    | Values / default | Description                                                         |
| ----------------------------- | ------- | ---------------- | ------------------------------------------------------------------- |
| `branchSummary.reserveTokens` | number  | default `16384`  | Tokens reserved for prompt and response while summarizing a branch. |
| `branchSummary.skipPrompt`    | boolean | default `false`  | Skip the "Summarize branch?" prompt and default to no summary.      |

### `retry`

| Key                              | Type    | Values / default | Description                                                                |
| -------------------------------- | ------- | ---------------- | -------------------------------------------------------------------------- |
| `retry.enabled`                  | boolean | default `true`   | Enable high-level retry behavior.                                          |
| `retry.maxRetries`               | number  | default `3`      | Maximum high-level retry attempts.                                         |
| `retry.baseDelayMs`              | number  | default `2000`   | Base exponential backoff delay in milliseconds.                            |
| `retry.provider.timeoutMs`       | number  | unset            | Provider SDK/request timeout in milliseconds when supported.               |
| `retry.provider.maxRetries`      | number  | unset            | Provider SDK/client retry attempts when supported.                         |
| `retry.provider.maxRetryDelayMs` | number  | default `60000`  | Maximum server-requested retry delay before failing; `0` disables the cap. |

### `terminal`

| Key                             | Type    | Values / default                           | Description                                         |
| ------------------------------- | ------- | ------------------------------------------ | --------------------------------------------------- |
| `terminal.showImages`           | boolean | default `true`                             | Render images inline when the terminal supports it. |
| `terminal.imageWidthCells`      | number  | integer minimum `1`, default `60`          | Preferred inline image width in terminal cells.     |
| `terminal.clearOnShrink`        | boolean | default `false`, or `PI_CLEAR_ON_SHRINK=1` | Clear empty rows when content shrinks.              |
| `terminal.showTerminalProgress` | boolean | default `false`                            | Show OSC `9;4` terminal progress indicators.        |

### `images`

| Key                  | Type    | Values / default | Description                                                   |
| -------------------- | ------- | ---------------- | ------------------------------------------------------------- |
| `images.autoResize`  | boolean | default `true`   | Resize images to a 2000x2000 maximum for model compatibility. |
| `images.blockImages` | boolean | default `false`  | Prevent all images from being sent to model providers.        |

### `thinkingBudgets`

Type: object. Values are token budgets for token-budgeted thinking providers.

| Key                       | Type   | Description                 |
| ------------------------- | ------ | --------------------------- |
| `thinkingBudgets.minimal` | number | Token budget for `minimal`. |
| `thinkingBudgets.low`     | number | Token budget for `low`.     |
| `thinkingBudgets.medium`  | number | Token budget for `medium`.  |
| `thinkingBudgets.high`    | number | Token budget for `high`.    |

### `markdown`

| Key                        | Type   | Values / default   | Description                                        |
| -------------------------- | ------ | ------------------ | -------------------------------------------------- |
| `markdown.codeBlockIndent` | string | default two spaces | Prefix used when rendering code block indentation. |

### `warnings`

| Key                            | Type    | Values / default | Description                                                     |
| ------------------------------ | ------- | ---------------- | --------------------------------------------------------------- |
| `warnings.anthropicExtraUsage` | boolean | default `true`   | Warn when Anthropic subscription auth may use paid extra usage. |

## Package Sources

`packages` entries can be strings or filtered objects.

```jsonc
{
    "packages": [
        "npm:@scope/theme-pack",
        {
            "source": "git:https://github.com/example/themes.git",
            "themes": ["themes/theme-a.json"],
            "extensions": [],
            "skills": [],
            "prompts": []
        }
    ]
}
```

Object fields:

- `source`: package source string.
- `extensions`: extension files to load from the package.
- `skills`: skill files or directories to load from the package.
- `prompts`: prompt template files to load from the package.
- `themes`: theme JSON files to load from the package.

Harns currently filters installed packages for themes; see [themes.md](themes.md).

## Legacy Migrations

Harns and Pi migrate a few older key shapes while loading settings:

- `queueMode` becomes `steeringMode` when `steeringMode` is not already set.
- `websockets: true` becomes `transport: "websocket"`; `websockets: false` becomes `transport: "sse"`.
- Old object-shaped `skills` settings become `enableSkillCommands` and/or a `skills` path array.
- `retry.maxDelayMs` becomes `retry.provider.maxRetryDelayMs` when the provider field is not already set.
