# RunWield Documentation

RunWield helps you review what an AI plans to do before it changes your code, then verifies the result. Use this manual
to install RunWield, start a Session, understand its workflows, and configure it for your project.

RunWield builds on [Pi](https://pi.dev). These pages explain RunWield-specific behavior and link to Pi when the behavior
is unchanged.

## Start

### Install RunWield

On macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/gandazgul/runwield/main/install.sh | bash
```

Make sure `~/.local/bin` is on your `PATH`, then start RunWield from your project root:

```bash
wld
```

On first use, connect a model provider when prompted. Then initialize the project and make a request:

```text
/init
fix the failing parser test
```

- [Quickstart](quickstart.md) — install, authenticate, initialize a project, and run your first request.
- [Workspace](workspace.md) — use RunWield in a browser or on your phone.

## Use RunWield

- [Using RunWield](usage.md) — commands, routing, Agents, Plans, and TUI behavior.
- [Plans and workflows](workflows.md) — triage, review, execution, validation, and recovery.
- [Sessions](sessions.md) — resume work and manage Session history.
- [Self-hosted collaboration](collaboration.md) — share Plans through a Shared Space Plan Server.
- [Workspace containers](workspace-container.md) — run Workspace in its supported container setup.

## Configure RunWield

- [Providers and models](providers.md) — credentials, model selection, and custom providers.
- [Settings reference](settings.md) — global and project settings.
- [Customization](customization.md) — Agent overrides, prompts, Skills, and themes.
- [Themes](themes.md) — select and create terminal themes.
- [MCP](mcp.md) — connect Model Context Protocol servers.

## Get help

- [Troubleshooting](troubleshooting.md) — resolve common installation and runtime problems.
- [Plan lifecycle](plan-lifecycle.md) — understand durable Plan states and recovery.
- [Validation authority](validation-authority.md) — understand completion and review evidence.
- [Contributing](contributing.md) — build RunWield and contribute changes.

For terminal editing, keybindings, model providers, and other inherited behavior, use the
[Pi documentation](https://pi.dev/docs/latest).
