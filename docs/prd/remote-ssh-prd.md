# Product Requirements Document: Remote SSH

Last updated: 2026-09-17 EDT

**Status:** Proposed. Product direction agreed; remote behavior is not implemented or verified. **Document role:**
Transient feature proposal. RunWield Core owns this capability.

## Background

Developers work on servers that already contain their code and development tools. They should be able to open RunWield
there without a second personal setup. The requested experience is connected remote development, like VS Code Remote
SSH—not an unattended worker.

## Problem and Value

Today, running `wld` on another machine uses that machine's settings, credentials, memories, and Session storage. Users
must recreate their environment, and personal data can diverge. Copying the local profile also copies sensitive and
machine-specific state.

The goal is one command to work on remote files with the user's existing RunWield environment. The local machine keeps
personal data; the server keeps project files. This removes setup friction for developers whose projects do not run on
their laptop. Demand beyond the owner's stated use case has not been measured.

## Audience and Scope

**Primary audience:** An individual developer with working SSH access to a trusted development server and an existing
local RunWield setup.

**Included:** Remote TUI, remote folders or home, automatic RunWield setup, local personal data, remote project tools,
local browser reviews, connected-only execution, and saved Session resume.

**Not included:** Unattended execution, source-code synchronization, a required local checkout, multi-user
collaboration, hosted Workspace registration, remote ACP clients, migration of an existing local Session to another
checkout, or automatic installation of every project dependency. Hostile-server isolation is not promised.

## Product Fit and Main Journey

Proposed commands:

```sh
wld remote sct:~/my-awesome-project
wld remote sct
```

`sct` is an SSH configuration alias or hostname. The first command opens the remote folder; the second opens the remote
user's home. `~` refers to the remote user's home, not the laptop's. A remote folder need not be a Git repository.

1. Connect with the user's existing SSH configuration and authentication.
2. Prepare compatible RunWield tools without a second personal setup.
3. Open the TUI on the server in the requested directory. Show the host and folder clearly.
4. Work with the usual Agents, models, memories, and workflows. Project operations use the server.
5. Open reviews in the laptop browser and return decisions to the same Session.
6. Disconnect to stop active work. Reconnect and use saved history to continue.

The TUI runs remotely. This does not require model calls, credentials, or personal storage to run remotely too; their
placement is an architecture question constrained by the ownership below.

| Data or activity                                                                                             | Product ownership                    |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| Personal settings, model configuration, credentials, Agents, skills, and prompt templates                    | Local machine                        |
| Personal project/global memories and Session history, including Session attachments                          | Local machine                        |
| Project files, project settings/instructions, Plans, Work Records, Git, worktrees, and Project Runtime State | Remote project/environment           |
| Project reads, edits, shell commands, code search, builds, and tests                                         | Remote environment                   |
| Human review interaction                                                                                     | Local browser, acting on remote work |

“Everything stays local” applies to personal data, not remote source files or project artifacts. Reading remote source
into a prompt or review does not constitute a synchronized checkout. Installed tools and project-owned state can remain
on the server after exit; a separate saved personal profile must not remain.

## Capability Requirements

### Remote connection and setup

**Scope and maturity:** Proposed addition.

**Requirement: Open the requested remote location.** Both command forms work with SSH aliases and hostnames. Existing
SSH user, key, port, jump-host, and host-verification behavior remains effective. Paths are data, not shell commands. An
invalid or inaccessible folder fails clearly; RunWield must not silently work in another folder or create the target.

**Requirement: Prepare RunWield automatically.** A supported host does not need a prior RunWield installation or
provider login. RunWield prepares compatible required tools and reports progress. It does not overwrite a remote user's
existing profile or package-managed installation. Missing permission or unsupported platform errors identify the real
prerequisite; ordinary internal setup and repair stay automatic.

**Acceptance scenarios:**

- Given a valid alias and existing remote folder, when the folder command runs, the TUI opens there. Reading a file and
  executing a command use that folder on the server, even when the laptop has a same-named folder with different files.
- Given no folder argument, when the host command runs, the TUI opens in the remote user's home without requiring Git.
- Given a supported host without RunWield, when the user connects, setup completes without manual profile copying.
- Given a bad host key, denied access, or missing folder, connection fails without bypassing SSH checks or starting work
  in a fallback folder.

**Shared requirements:** [Installation and updates](runwield-core-prd.md#installation-and-updates),
[project context](runwield-core-prd.md#project-context-and-initialization).

### Local personal environment

**Scope and maturity:** Proposed extension of Core customization and model behavior.

**Requirement: Use one personal environment.** Local user settings, model selections, Agents, skills, and prompts apply
to the remote Session. Remote project overrides retain their normal precedence. Personal changes save locally; changes
to project settings save in the remote project. Reconnect uses current local data, not a stale remote profile.

**Requirement: Keep credentials local.** RunWield does not copy local provider credentials, private SSH keys, or an
entire local environment to the server. Supported providers use the existing local sign-in. A selected provider must not
silently change to another provider or billing method. Compatibility failures explain the limitation before the affected
turn starts.

**Requirement: Use customizations honestly.** Supported skills can read their instructions and referenced resources;
local paths must not accidentally select unrelated remote files. Machine-specific scripts and MCP integrations require
compatibility checks rather than a claim that every local executable is portable.

**Acceptance scenarios:**

- Given a local Agent/model preset and a remote project override, when the Session starts, the effective settings match
  normal precedence without overwriting either machine's personal profile.
- Given a personal setting changed through the remote TUI, when the user later opens local RunWield, that change is
  present. A project-scoped change instead remains with the remote project.
- Given a supported provider authenticated only on the laptop, when it performs a remote edit, no second provider login
  or remote credential copy is required. OAuth renewal, where used, updates local credentials.
- Given an incompatible provider or path-dependent integration, when it is needed, RunWield reports the specific limit
  instead of silently substituting a model, omitting required tools, or operating on laptop files.

**Shared requirements:** [Customization](runwield-core-prd.md#agent-and-skill-customization),
[models and providers](runwield-core-prd.md#models-and-providers).

### Local memories and saved Sessions

**Scope and maturity:** Proposed extension of project context and Session continuity.

**Requirement: Read and update the same local memories.** Core Memory injection, recall, additions, and deletions use
local storage and preserve project/global scope. Work Record retrieval reads the remote project's canonical records. A
successful personal-data save means the change is saved locally, not merely queued on the server until exit.

**Requirement: Keep project knowledge correctly scoped.** Unrelated remote folders must not share memories or Sessions
because their directory names match. A remote project can use an intended existing local Memory collection without
requiring a local checkout. When that relationship cannot be established safely, ask once rather than guess; retain the
choice for later connections. A new remote-only project can have locally stored memories of its own. This must not
silently remap existing local projects.

**Requirement: Preserve local history.** Saved remote Session history remains available locally after disconnect.
Reconnecting to the same remote project lets the user resume that Session with its saved Agent, model, and workflow
context. History identifies the remote target. Resume does not recreate unfinished tool effects automatically.

**Acceptance scenarios:**

- Given existing global and selected project memories, when the remote Agent recalls them, it receives the correct
  scopes. A successful store or delete is visible from local RunWield before disconnect.
- Given unrelated same-named folders on two servers, when both are used, their Session history and project memories
  remain distinct unless the user deliberately selects shared project memories.
- Given a saved remote conversation, when SSH closes, the local history remains readable. Reconnect permits continuation
  without restarting the conversation or requiring a local clone.
- Given loss during a personal-data save, RunWield does not report success without local evidence or overwrite newer
  local data on reconnect.

**Shared requirements:** [Project context](runwield-core-prd.md#project-context-and-initialization),
[Session continuity](runwield-core-prd.md#session-continuity), [Work Records](runwield-core-prd.md#work-records).

### Remote workflows and local review

**Scope and maturity:** Proposed extension; existing approval and validation meanings remain unchanged.

**Requirement: Complete normal Core work remotely.** Reading and editing, Git, code search, planning, isolated
execution, validation, repair, and publication use the remote project and its environment. This is not a shell-only
shortcut while other tools operate on the laptop. Existing permissions and external prerequisites still apply;
connecting does not silently grant access to local Git credentials.

**Requirement: Review remote work locally.** Plan and Code Review open in the user's local browser, show the actual
remote artifacts, and apply decisions to the correct live Session. Users need not configure tunnels or expose a public
review server. Closing only the browser does not end the SSH Session.

**Acceptance scenarios:**

- Given a project available only remotely, when the user takes a change through planning, review, execution, validation,
  and publication, all project effects and validation commands occur remotely and the local Session records the results.
- Given Plan or Code Review, when it opens, the laptop browser displays the remote content. Approval or feedback reaches
  the same Session. Closing and reopening the browser while SSH remains connected does not cancel the wait.
- Given remote home without Git or a project with missing build dependencies, RunWield retains the ordinary supported
  non-Git behavior or reports the relevant prerequisite; it does not invent a repository or validate on the laptop.

**Shared requirements:** [Plan review](runwield-core-prd.md#plan-review),
[execution, validation, and recovery](runwield-core-prd.md#execution-validation-and-recovery),
[work protection](runwield-core-prd.md#work-protection).

### Disconnect and recovery

**Scope and maturity:** Proposed connected-only behavior. This does not change Workspace browser-disconnect behavior.

**Requirement: Do not continue unattended.** Normal exit ends the remote TUI and stops active RunWield-owned work.
Unexpected connection loss stops new work and cancels active owned processes when loss is detected, including when the
laptop cannot send a final stop request. No detached Agent continues or restarts automatically. Unrelated server
processes must not be stopped.

**Requirement: Preserve work and report uncertainty.** Disconnect is neither workflow completion nor deliberate
abandonment. Remote edits and project artifacts remain. Local saved history remains. Unreceived output is not claimed as
saved; uncertain remote effects are checked on reconnect before further work or retry.

Instant network-loss detection, rollback of completed effects, and cancellation of an external action already accepted
by another service are not promised. Detection and process-cleanup behavior must be demonstrated before release; a
best-effort stop request alone does not meet connected-only operation.

**Acceptance scenarios:**

- Given an active Agent and a long-running owned subprocess, when the user exits normally, both stop and saved work
  remains. No background Agent continues after the TUI closes.
- Given abrupt laptop or network loss, when the server detects loss, owned work stops without requiring a final client
  message. Unrelated processes remain running.
- Given a remote edit or publication attempt whose result was not saved locally before loss, when the user reconnects,
  RunWield checks available evidence and reports the actual or uncertain result without repeating the action blindly.
- Given completed personal-data saves and remote edits, when the user reconnects, those saves and edits remain. No
  separate remote personal profile must be merged back manually.

**Shared requirements:** [Recovery](runwield-core-prd.md#execution-validation-and-recovery),
[Session continuity](runwield-core-prd.md#session-continuity).

## Success Measures

- Complete the remote-only project journey above without manual profile copying, a second provider login, or a local
  checkout. Baseline: this command and data split do not exist today.
- Observe first-use setup effort and successful return visits in an owner pilot. No time target or adoption threshold
  has been agreed; record friction before setting either.
- Pass the data-scope, wrong-machine, review, provider, and disconnect acceptance scenarios on each advertised supported
  combination. A successful chat alone is not evidence of a complete remote workflow.

## Delivery and Feasibility Limits

The smallest useful release is a complete connected remote development journey, not just a remote prompt. The
[feasibility report](../research/remote-ssh-feasibility.md) found a plausible path for Pi API/OAuth providers, including
Codex through Pi and local/custom API endpoints. It did not prove remote operation.

Claude CLI and Antigravity CLI remain part of the compatibility target, but their existing native tools and local
sign-in are coupled to one machine. Do not claim support without proof. Excluding them from an initial release requires
an explicit scope decision; copying credentials or silently selecting another provider is not an acceptable workaround.

Host platform coverage and machine-specific integration support also need verification. Ordinary application build
prerequisites remain the user's project environment, not automatic RunWield installation scope.

Handoff: `/agent planner` uses this proposal and the research report. Architecture decisions and implementation work
remain separate. No Plan or Epic has been created. After delivery, fold lasting requirements into
[RunWield Core](runwield-core-prd.md), retain unresolved scope explicitly, fix references, and remove this transient
proposal under project policy.

## Risks and Mitigations

- **Credential privacy mistaken for server isolation:** A trusted server can see supplied instructions, memories, and
  tool results. Local ownership is not secrecy from the connected server. Limit access to what the connection needs; do
  not promise forensic erasure of all temporary bytes.
- **False remote support:** CLI tools or local skill paths can operate on the wrong machine. Verify remote-only files
  and distinct local files, not just mocked tool calls.
- **Silent data divergence:** Exit-only synchronization can lose memories or settings. Require local save confirmation
  during work and preserve existing local data on failure.
- **False disconnect success:** Ending the TUI can leave children running. Verify normal exit and loss without client
  cleanup. Preserve evidence when external effects cannot be confirmed.

## Proposed Domain Language

**Remote SSH connection:** A connected-only RunWield interaction opened through `wld remote` against a remote folder,
using locally owned personal data. Avoid calling it Personal Workspace, an unattended worker, or a separate Session
type. It contains or resumes an ordinary **Session**; it does not own the Session's durable history.

Affected existing terms: **RunWield Core**, **TUI**, **Session**, and **Project Runtime State**. Core gains remote
project execution while personal data remains local. Project Runtime State stays with the remote checkout. These are
proposed relationships; the current glossary is unchanged until implementation makes them true.

## Evidence and Open Checks

The owner requested the two commands above, existing remote files with no local checkout, local personal data, and no
unattended work. [VS Code Remote SSH](https://code.visualstudio.com/docs/remote/ssh) is the setup and interaction
reference, not proof of identical storage or shutdown behavior.

The [research report](../research/remote-ssh-feasibility.md) records source findings, official documentation, and
evidence limits. Before committing delivery scope, planning must resolve:

- CLI-provider compatibility without remote credentials or a local checkout.
- Supported host builds and demonstrated connection-loss cleanup.
- Correct project Memory selection across all entry points, including Core injection and `/sleep`.

These are technical evidence gaps, not a need to repeat the product interview. If a gap requires a narrower product,
bring that specific scope decision back to the owner.
