# Sessions

RunWield inherits Pi's session model and TUI behavior, but stores session data under RunWield-owned paths and adds
RunWield-specific root-agent behavior.

For full session tree, fork, clone, export, and compaction details that match Pi, see
[Pi Sessions](https://pi.dev/docs/latest/sessions) and [Pi Compaction](https://pi.dev/docs/latest/compaction).

## Storage

RunWield stores sessions under:

```text
~/.wld/sessions/
```

This is separate from Pi's `~/.pi/agent/sessions/` path.

## Starting and resuming

Use:

```bash
wld              # start an interactive session
```

Inside the TUI:

```text
/resume          # browse recent sessions
/new             # start a fresh root session
/name <name>     # set the current session name
/name            # show the current session name, or usage if unnamed
/session         # show current session information
/compact         # compact current context
/export          # export to HTML or JSONL
/share           # upload a secret GitHub Gist
```

## Session names and terminal titles

Fresh sessions start with a terminal title of `wld - <current folder>`. When Router completes Triage, it provides a
short Session Name for unnamed sessions. RunWield persists that name in the session and mirrors it into the terminal
title as `wld - <session name>`.

Manual names win. Use `/name <name>` to set or override the Session Name; later Router Triage will not replace an
existing name. Use `/name` with no arguments to show the current name, matching Pi behavior.

## Root-agent behavior

New sessions start with Router. After Router hands off to Guide, Ideator, Operator, Planner, Architect, or another
specialist, that specialist remains the active root agent so follow-up messages stay in the same topic and context.

Use `/new` for a fresh routed session, or `/agent router` when you want the next message in the current session to go
back through triage.

Router is not a special session mode. It is the default Agent for fresh triage, `/agent router`, and explicit user
requests to reassess. Boot, `/agent`, and workflow restores activate Agents through the same Agent Handler. Workflow
progression is driven by Custom Tool outcomes such as `triage_report`, `plan_written`, and `task_completed`, not by
special-casing a particular Agent name. During active execution, `/agent <name>` is an explicit user-owned release from
workflow ownership; Plan and worktree recovery evidence stay available through `/load-plan`.

## Resume compaction

When resuming a large session, RunWield can offer to compact the session first. The threshold is controlled by
`compactOnResumeThresholdPercent` in settings. See [Settings Reference](settings.md).
