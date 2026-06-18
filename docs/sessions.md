# Sessions

Harns inherits Pi's session model and TUI behavior, but stores session data under Harns-owned paths and adds
Harns-specific root-agent behavior.

For full session tree, fork, clone, export, and compaction details that match Pi, see
[Pi Sessions](https://pi.dev/docs/latest/sessions) and [Pi Compaction](https://pi.dev/docs/latest/compaction).

## Storage

Harns stores sessions under:

```text
~/.hns/sessions/
```

This is separate from Pi's `~/.pi/agent/sessions/` path.

## Starting and resuming

Use:

```bash
hns              # start an interactive session
```

Inside the TUI:

```text
/resume          # browse recent sessions
/new             # start a fresh root session
/session         # show current session information
/compact         # compact current context
/export          # export to HTML or JSONL
/share           # upload a secret GitHub Gist
```

## Root-agent behavior

New sessions start with Router. After Router hands off to a specialist, that specialist remains the active root agent so
follow-up messages stay in the same topic and context.

Use `/new` for a fresh routed session, or `/agent router` when you want the next message in the current session to go
back through triage.

Router is not a special session mode. It is the default Agent for fresh triage. Boot, `/agent`, workflow restores, and
`return_to_router` all activate Agents through the same Agent Handler. Workflow progression is driven by Custom Tool
outcomes such as `triage_report`, `plan_written`, and `task_completed`, not by special-casing a particular Agent name.

## Resume compaction

When resuming a large session, Harns can offer to compact the session first. The threshold is controlled by
`compactOnResumeThresholdPercent` in settings. See [Settings Reference](settings.md).
