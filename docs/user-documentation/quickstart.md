# Quickstart

This page gets you from install to a useful first RunWield Session.

For terminal setup, keybindings, and model-provider background inherited from Pi, see the
[Pi Quickstart](https://pi.dev/docs/latest/quickstart).

## Install

Choose one install method.

**Shell installer (macOS or Linux):**

```bash
curl -fsSL https://raw.githubusercontent.com/gandazgul/runwield/main/install.sh | bash
```

This installs `wld` to `~/.local/bin`. If your shell can't find `wld`, add that folder to your `PATH`. To install
somewhere else, set `WLD_INSTALL_DIR`:

```bash
WLD_INSTALL_DIR="$HOME/bin" \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/gandazgul/runwield/main/install.sh)"
```

**Homebrew (macOS):**

```bash
brew install gandazgul/tap/wld
```

A Windows package is coming soon.

### Helper programs

RunWield uses a few helper programs. Both install methods set them up for you:

| Helper          | Used for                                     | Required |
| --------------- | -------------------------------------------- | -------- |
| `mnemoteca`     | Project and global memory                    | Yes      |
| `cymbal`        | Symbol-aware code search                     | Yes      |
| `agent-browser` | Opening a browser to check UI work           | Yes      |
| `snip`          | Shortening shell output (shell install only) | No       |

The shell installer keeps any helper you already have on your `PATH`. Mnemoteca downloads its model the first time it is
used, not during install.

If you already use `mnemoteca` and need data from an install made before it was renamed, run the official [Mnemoteca]
installer first.

## Sign in to a model provider

From your project folder, run:

```bash
wld login
```

Choose a subscription or API-key provider, then choose a default model. You can also run `/login` inside RunWield. See
[Providers and models](providers.md) for more options.

## Initialize the project

```bash
wld init
```

RunWield explores the repository, writes `docs/domain-language.md`, and saves core project memories. You can also run
`/init` inside a Session.

## Try the Tutorial

The first time you start RunWield, it offers an optional Tutorial that walks you through one real, small change in your
project: choosing it, reviewing the Plan, and following it through implementation, checks, review, and delivery. In an
empty folder, it helps you start a small project instead.

The Tutorial edits your real project and uses your configured model, and it says so before it starts. Nothing happens
until you choose **Start tutorial**. Choosing **Skip** stops the automatic offer in every project.

Start it any time with `wld onboard`, or `/onboard` inside RunWield. During Plan review you can keep the guidance, turn
it off and continue the workflow, or press Escape to pause. When you resume a saved Session, RunWield asks whether to
bring the guidance back. The Tutorial runs in the terminal only.

## Make your first request

```bash
wld "summarize this repository and tell me how to run its checks"
```

RunWield first decides what kind of request this is: a question, an idea to explore, a quick fix, or a change that needs
a Plan. Then it hands the request to the right Agent. See [Plans and workflows](workflows.md) for how each kind is
handled.

## Open Workspace in your browser or on your phone

Run this in a separate terminal and leave it running:

```bash
wld workspace serve
```

Your browser opens Workspace and shows a pairing code. Follow the [Workspace guide](workspace.md) to pair your browser,
link your repository, and continue a Session from your phone.

## Next steps

- [Using RunWield](usage.md): day-to-day commands.
- [Plans and workflows](workflows.md): how RunWield plans, executes, and verifies changes.
- [Settings reference](settings.md): defaults and per-Agent models.

[Mnemoteca]: https://github.com/gandazgul/mnemoteca
