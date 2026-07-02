# Quickstart

This page gets you from install to a useful first RunWield session.

For terminal setup, keybindings, and model-provider background that are inherited from Pi, see the
[Pi Quickstart](https://pi.dev/docs/latest/quickstart).

## Install

On macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/gandazgul/runwield/main/install.sh | bash
```

The installer installs the `wld` binary to `~/.local/bin` by default. If your shell cannot find `wld`, add the install
directory to your `PATH`.

To choose a different install directory:

```bash
WLD_INSTALL_DIR="$HOME/bin" \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/gandazgul/runwield/main/install.sh)"
```

## Run from source

Contributors can run the CLI directly with Deno:

```bash
deno run -A src/cli.js help
```

To build the standalone binary:

```bash
deno task compile
./bin/wld help
```

## Runtime helpers

Interactive RunWield workflows expect these tools to be available when you want the full experience:

- [`mnemosyne`](https://github.com/gandazgul/mnemosyne) - project/global memory.
- [`cymbal`](https://github.com/1broseidon/cymbal) - symbol-aware code search and impact analysis.
- [`snip`](https://github.com/edouard-claude/snip) - optional compact shell-output rewriting.

RunWield still starts if Snip is missing. Memory and code-intelligence features require their corresponding binaries.

## Authenticate

Start RunWield in a project directory:

```bash
cd /path/to/project
wld
```

Then run:

```text
/login
```

Choose a subscription provider or API-key provider. RunWield stores credentials in `~/.wld/auth.json`.

You can also use provider API keys through environment variables where supported by Pi's provider system. See
[Pi Providers](https://pi.dev/docs/latest/providers) for provider-specific setup.

## Initialize the project

Run:

```bash
wld init
```

This bootstraps durable RunWield context:

- explores the repository,
- writes `CONTEXT.md`,
- stores core project memories,
- records that initialization has run for the project.

You can also run `/init` inside an interactive session.

## First routed request

Send a request from the command line:

```bash
wld "summarize this repository and tell me how to run its checks"
```

`router` is the default command, so this is equivalent:

```bash
wld router "summarize this repository and tell me how to run its checks"
```

Router is the default Agent for fresh triage. It calls `triage_report` to assign a routing intent: `INQUIRY`,
`IDEATION`, `OPERATION`, `QUICK_FIX`, `FEATURE`, or `PROJECT`. That tool outcome hands off to Guide for answers, Ideator
for idea sharpening, Operator for direct non-code operations, Engineer for bounded no-plan quick fixes, Planner for
FEATURE plans, or Architect for PROJECT Epics. PROJECT work becomes an Epic design plan first, then the interactive
Slicer breaks it into child FEATURE plans after approval.

## Common commands

```bash
wld "your request"                  # route through triage
wld router "your request"           # explicit router form
wld agent                           # list available agents
wld agent engineer "implement X"    # start with Engineer instead of Router
wld plans                           # list saved plans
wld load-plan <name-or-path>        # review, execute, or continue a plan
wld init                            # bootstrap project context
wld theme --list                    # list themes
wld help
wld help <command>
wld version
```

## Next steps

- [Using RunWield](usage.md) - day-to-day workflow and commands.
- [Plans and workflows](workflows.md) - RunWield planning and validation behavior.
- [Providers and models](providers.md) - RunWield-specific provider paths.
- [Settings Reference](settings.md) - configure defaults and agent model overrides.
