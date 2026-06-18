# Providers and Models

Harns uses Pi's provider and model infrastructure with Harns-owned config paths.

For complete provider-specific setup, OAuth/API-key options, environment variables, and custom provider details, see
[Pi Providers](https://pi.dev/docs/latest/providers), [Pi Custom Models](https://pi.dev/docs/latest/models), and
[Pi Custom Providers](https://pi.dev/docs/latest/custom-provider).

## Harns storage paths

| Data                  | Harns path             |
| --------------------- | ---------------------- |
| Credentials           | `~/.hns/auth.json`     |
| Model registry/config | `~/.hns/models.json`   |
| Settings              | `~/.hns/settings.json` |

If a Harns file does not exist, Harns may import the matching Pi file from `~/.pi/agent/` once. After that, Harns reads
and writes the Harns-owned file.

## Login commands

Inside the TUI:

```text
/login
/logout
/status
```

`/login` can store subscription or API-key credentials. `/status` shows configured providers and available model count.

## Model selection

Use:

```text
/model
```

or from the CLI:

```bash
hns model <provider>/<model_id>
```

Harns expects strict `provider/model_id` references for explicit model settings and per-agent overrides.

## Agent model overrides

Harns can assign different models to different agents:

```jsonc
{
    "agents": {
        "router": {
            "model": "openai/gpt-5-mini",
            "thinkingLevel": "minimal"
        },
        "engineer": {
            "model": "anthropic/claude-sonnet-4-5",
            "thinkingLevel": "high"
        }
    }
}
```

See [Settings Reference](settings.md) for `agents`, `activeModelPreset`, and `modelPresets`.
