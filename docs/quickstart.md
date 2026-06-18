# Quickstart

This page gets you from install to a useful first Harns session.

For terminal setup, keybindings, and model-provider background that are inherited from Pi, see the
[Pi Quickstart](https://pi.dev/docs/latest/quickstart).

## Install

On macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/gandazgul/harns/main/install.sh | bash
```

The installer installs the `hns` binary to `~/.local/bin` by default. If your shell cannot find `hns`, add the install
directory to your `PATH`.

To choose a different install directory:

```bash
HNS_INSTALL_DIR="$HOME/bin" \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/gandazgul/harns/main/install.sh)"
```

## Run from source

Contributors can run the CLI directly with Deno:

```bash
deno run -A src/cli.js help
```

To build the standalone binary:

```bash
deno task compile
./bin/hns help
```

## Runtime helpers

Interactive Harns workflows expect these tools to be available when you want the full experience:

- `mnemosyne` - project/global memory.
- `cymbal` - symbol-aware code search and impact analysis.
- `rtk` - optional compact shell-output rewriting.

Harns still starts if RTK is missing. Memory and code-intelligence features require their corresponding binaries.

## Authenticate

Start Harns in a project directory:

```bash
cd /path/to/project
hns
```

Then run:

```text
/login
```

Choose a subscription provider or API-key provider. Harns stores credentials in `~/.hns/auth.json`.

You can also use provider API keys through environment variables where supported by Pi's provider system. See
[Pi Providers](https://pi.dev/docs/latest/providers) for provider-specific setup.

## Initialize the project

Run:

```bash
hns init
```

This bootstraps durable Harns context:

- explores the repository,
- writes `CONTEXT.md`,
- stores core project memories,
- records that initialization has run for the project.

You can also run `/init` inside an interactive session.

## First routed request

Send a request from the command line:

```bash
hns "summarize this repository and tell me how to run its checks"
```

`router` is the default command, so this is equivalent:

```bash
hns router "summarize this repository and tell me how to run its checks"
```

Router is the default Agent for fresh triage. It calls `triage_report` to classify the request as a `QUICK_FIX`,
`FEATURE`, or `PROJECT`; that tool outcome hands off to the appropriate workflow.

## Common commands

```bash
hns "your request"                  # route through triage
hns router "your request"           # explicit router form
hns agent                           # list available agents
hns agent engineer "implement X"    # start with Engineer instead of Router
hns plans                           # list saved plans
hns load-plan <name-or-path>        # review, execute, or continue a plan
hns init                            # bootstrap project context
hns theme --list                    # list themes
hns help
hns help <command>
hns version
```

## Next steps

- [Using Harns](usage.md) - day-to-day workflow and commands.
- [Plans and workflows](workflows.md) - Harns planning and validation behavior.
- [Providers and models](providers.md) - Harns-specific provider paths.
- [Settings Reference](settings.md) - configure defaults and agent model overrides.
