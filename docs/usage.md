# Using RunWield

This page covers daily RunWield usage and the places where RunWield differs from Pi.

For editor features, terminal shortcuts, image paste, file references, shell commands, and message queue behavior that
RunWield inherits from Pi, see [Pi Usage](https://pi.dev/docs/latest/usage) and
[Pi Keybindings](https://pi.dev/docs/latest/keybindings).

## Default workflow: Router first

The default CLI command is `router`:

```bash
wld "fix the bug in the parser"
wld router "fix the bug in the parser"
```

Router is the default Agent for fresh triage. It calls `triage_report`, and that tool outcome starts the workflow:

| Routing intent | Use when                                            | Typical path                                                                                                                                     |
| -------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `INQUIRY`      | The user needs an answer, explanation, or guidance. | Guide answers directly, can preserve ordinary `.md` docs on explicit follow-up, and can return to Router if the request becomes executable work. |
| `IDEATION`     | The user wants to explore or sharpen an idea.       | Ideator interviews, researches, and produces a PRD or synthesis before routing implementation back through Router.                               |
| `OPERATION`    | Direct non-code repository/environment work.        | Operator executes directly and self-verifies; no RunWield validation loop runs afterward.                                                        |
| `QUICK_FIX`    | Bounded no-plan code implementation.                | Engineer implements directly, then RunWield runs Mechanical Validation only.                                                                     |
| `FEATURE`      | Non-trivial implementation needs a reviewable plan. | Planner records an owner; Engineer or Frontend Engineer executes it, then RunWield validates it.                                                 |
| `PROJECT`      | Large work needs architecture and slicing.          | Architect designs the Epic, interactive Slicer creates child FEATURE plans, execution proceeds one feature at a time.                            |

## Interactive sessions

Start an interactive session with:

```bash
wld
```

A new interactive session starts with Router. After `triage_report` dispatches to Guide, Ideator, Operator, Planner,
Architect, or another specialist, that specialist remains the active root agent so follow-up messages stay in the same
working context. When Guide has already produced a useful explanation, you can explicitly ask it to save or update an
ordinary `.md` document using its docs-only tools; this is an in-session preservation follow-up, not a Router routing
change.

Use:

- `/new` to start a fresh routed session.
- `/agent router` to send the next message in the same session back through Router.
- `/resume` to browse recent sessions.
- `/session` to inspect the active session's history and cumulative token totals.
- `/context` to inspect the active Agent Session's current context-window usage and resident context estimates.

### Terminal Markdown math

Interactive session messages render completed LaTeX math as terminal Unicode text. Supported delimiters are inline
`$...$` and `\(...\)`, and display `$$...$$` and `\[...\]`. A formula must be complete before it renders. During
streaming, incomplete formulas stay visible as source text. Unsupported formulas also stay visible as source text so the
message remains readable.

Unicode math and Mermaid can appear in the same message. Completed top-level Mermaid fences still render as diagrams
after the closing fence. Math rendering and Mermaid rendering are built-in message behavior, not user-configurable
settings.

### Image attachments with text-only models

If the active model supports image input, RunWield sends pasted images directly to it. If the active model is text-only,
configure [`visionFallback.model`](settings.md#visionfallback) to let RunWield save pasted images as session attachments
and expose the `see_image` tool to the active agent. Without a configured fallback, image paste/submission is blocked
with a link back to the `visionFallback` settings section.

## Agents

List agents:

```bash
wld agent
```

Talk directly to one agent:

```bash
wld agent engineer "implement the approved plan"
```

Inside the TUI:

```text
/agent engineer
```

Specific Agent usage bypasses the default Router prompt. Use it when you intentionally do not want fresh triage.

User-selectable bundled agent definitions live in `src/agent-definitions/` and can be overridden by home or project
definitions. Workflow-only pseudo-agents such as Slicer and Reviewer are loaded from workflow prompts and do not appear
in normal `/agent` listings. See [Customization](customization.md).

Frontend and browser UI work can load the bundled `agent-browser-use` skill for headed browser inspection, screenshots,
accessibility snapshots, console checks, and interactive verification. The `agent-browser` CLI is a required runtime
helper and is provisioned by the installer when it is not already available.

## Plans

List saved plans:

```bash
wld plans
```

Load a plan by name or path:

```bash
wld load-plan my-feature
wld load-plan docs/plans/my-feature.md
```

Loading a plan lets you inspect it, continue work, recover failed work, or re-open review depending on the plan status.

Plans live under `docs/plans/` and use Markdown plus YAML front matter. RunWield treats the plan file as durable
workflow state, not just a generated note.

PROJECT plans are Epic containers by default. Loading an approved or decomposing Epic opens the interactive Slicer so
you can discuss child FEATURE boundaries and materialize drafts under `docs/plans/<epic-name>/`. Once decomposition is
finalized, loading the Epic offers child FEATURE selection; loading a child FEATURE runs the normal FEATURE review,
execution, validation, and recovery flow.

After a child FEATURE verifies, RunWield automatically continues the active Epic in strict child order. Verification now
requires explicit execution mode and delivery evidence: worktree-backed children must prove their sealed implementation
commit and verified metadata reached the target branch before Work Records or Epic continuation run. For Epic children,
Manual QA is written as an advisory Epic Artifact at `docs/plans/<epic-name>/manual-qa.md` before delivery when
possible, not left as a transient old-Session checklist. RunWield then finishes Work Record output and starts a fresh
persisted Session for the next child. Draft and feedback children open Planner; approved and ready-for-work children
execute automatically. The chain stops at the first remaining child when it is blocked by a hold, recovery state, unmet
dependency, unsupported status, or unverifiable worktree publication context.

The `manual-qa.md` Epic Artifact is not a Plan. RunWield reserves that exact nested name, excludes it from Plan lists,
and moves it with the Epic during archive and restore. You own checkbox state like any other repository Markdown. If
checklist generation fails, RunWield warns and continues; verification and Epic continuation do not depend on it.

See [Plans and workflows](workflows.md) and [Plan Lifecycle](plan-lifecycle.md).

## Work Records

Work Records are canonical repo-local Markdown artifacts in `docs/work-records/`. They summarize completed planned work
for future planning and are linked from eligible top-level Plans through `workRecord` front matter.

RunWield automatically generates or links a Work Record after supported terminal outcomes: verified standalone FEATURE
completion, PROJECT Epics marked done enough, eligible Workspace close-without-verification actions, and parent Epics
that become done enough when the final child FEATURE verifies. Child FEATURE plans do not get their own Work Records;
the parent Epic receives one once it is terminal. Automatic failures do not roll back the Plan outcome and are
recoverable with explicit backfill.

Available commands:

```bash
wld wr                         # list current records
wld wr list [--all]            # list current or maintenance/all records
wld wr search <query> [--all]  # search the derived Work Record index
wld wr read <recordId>         # open one record read-only in the browser by stable recordId
wld wr index rebuild           # rebuild the derived index from Markdown
wld wr backfill                # generate/link missing records for completed Plans/Epics
```

Disable only automatic completion hooks with
[`workRecords.autoGenerateOnPlanCompletion`](settings.md#workrecordsautogenerateonplancompletion); listing, search/read,
index rebuild, and backfill remain available.

`wld wr read <recordId>` starts a local token-protected read-only browser view with Contents navigation, the canonical
Work Record Markdown, and any maintenance notices. The command remains attached until the browser view's Close button is
used or the process is cancelled.

## Personal owner Workspace

Persistent owner Workspace is the paired-device, multi-Project browser surface for personal remote use:

```bash
wld workspace serve
wld workspace pair <code>
```

`wld workspace serve` uses a Workspace database under `~/.wld/` for registration, pairing, receipts, and projections;
Session history and writer safety remain file-backed independently. It binds to `127.0.0.1:8787` by default. An unpaired
browser shows a short-lived pairing code and a copyable command such as `wld workspace pair ABC123`. Approving that code
locally pairs that specific browser; the browser then receives a persistent, revocable device credential stored in
cookies. The pairing code is not a password or bearer token, and owner credentials are not stored in Plans, Session
Transcripts, URLs, or repository files.

Owner Workspace is authorization, not encryption. Loopback HTTP is safe for same-machine use. For phone access, put the
loopback listener behind Tailscale Serve, WireGuard plus a trusted HTTPS terminator, or an equivalent private-network
TLS boundary. Direct non-loopback owner serving is refused unless trusted-terminator mode is explicit and the configured
public origin is `https://...`; do not expose the plaintext backend listener directly to browsers.

A typical Tailscale Serve setup keeps RunWield on loopback and terminates HTTPS at the trusted Tailscale boundary:

```bash
wld workspace serve --bind 127.0.0.1 --port 8787 --public-origin https://<tailnet-name>.<tailnet>.ts.net --no-open
tailscale serve --https=443 127.0.0.1:8787
```

If a trusted terminator must reach a non-loopback backend address, start owner Workspace only with explicit terminator
trust and an HTTPS public origin, then firewall the plaintext listener so browsers cannot reach it directly:

```bash
wld workspace serve --bind 0.0.0.0 --port 8787 --trust-tls-terminator --public-origin https://workspace.example.test --no-open
```

Manage paired browsers from the owner Workspace device page:

```bash
open http://127.0.0.1:8787/devices
```

The page lists active, current, and revoked devices by safe device label and pairing time. Use **Revoke** to invalidate
a browser; revoking the current browser clears its cookies and returns it to pairing, while revoking another browser
closes registered live connections and denies its next owner request.

Projects must be explicitly registered before Workspace can show their Plans. The owner Project view reuses the existing
Plan Board inside the registered Project boundary. Consequential Plan actions run through owner Workspace APIs that
check the paired device, CSRF token, Session identity, current Plan revision, and current Plan/worktree evidence before
they mutate state.

Every RunWield Session uses a stable local identity, an OS writer lock, and ordered transcript segments. New Sessions
are cataloged automatically. When an older local transcript is opened, RunWield migrates it automatically and resumes it
under the same visible conversation; there is no migration prompt or activation flag. This local cataloging does not
register the Project with Workspace or expose it remotely. Projects must still be registered explicitly before they
appear in Workspace.

Supported Workspace continuation is conversation-only for idle Sessions; remote Plan materialization, workflow gates,
shell/repository actions, image turns, and other consequential direct mutations remain separately authorized. Writer
conflicts, stale generations, and transcript mismatches are reported conservatively. A process crash releases its file
lock automatically; RunWield never uses a timeout to steal control or replay unfinished effects.

When an already-open TUI is attached to an idle Session, it quietly observes committed Session generations from
Workspace or ACP. The TUI reads only verified committed transcript prefixes, shows new committed messages once,
refreshes Session title/Agent/model/thinking/workflow summaries, and may display a compact read-only ownership/sync
status such as another generic surface being active, blocked, or degraded. It does not show owner instance IDs,
transcript paths, operation IDs, fences, or proof material, and it does not display live in-progress tokens from another
surface. Automatic refresh preserves the exact unsent editor draft, pasted image previews/order, input history, and
focus. If a submit loses the generation race, RunWield refreshes first, restores the draft unchanged, and requires an
explicit second submit. Persistent projection/evidence failures leave submission disabled until a later safe refresh
succeeds.

`wld plans ui` remains the temporary current-checkout compatibility launcher. Use it when you want a one-shot local Plan
Board without registering the Project or pairing a device. It uses the same Plan Board surface as owner Workspace, with
a compact current-checkout shell instead of the Project/Session sidebar.

## Collaborative Plan review

A self-hosted Plan Server can host encrypted remote-canonical Shared Spaces for browser review:

```bash
wld plans share <plan-name-or-id>
wld plans pull <maintainer-url-or-plan-name-or-id>
wld plans push <plan-name-or-id>
wld plans unshare <plan-name-or-id>
```

Configure a non-secret `planServerUrl` in settings or pass `--plan-server <url>` to `share` for one invocation. Reviewer
and maintainer URLs contain secret fragment/capability material; do not paste them into settings, Plans, issues, or
logs. See [Self-hosted collaborative planning](collaboration.md) for Podman/OCI setup, the privacy model, and recovery
flows.

## Slash commands

Type `/` in the editor for completion.

| Command          | Description                                                                     |
| ---------------- | ------------------------------------------------------------------------------- |
| `/login`         | Configure subscription or API-key credentials.                                  |
| `/logout`        | Remove stored credentials.                                                      |
| `/status`        | Show configured providers and available models.                                 |
| `/model`         | Switch active model.                                                            |
| `/agent`         | Switch active agent.                                                            |
| `/init`          | Initialize the current project.                                                 |
| `/load-plan`     | Continue a saved plan.                                                          |
| `/resume`        | Browse and resume a recent session.                                             |
| `/new`           | Start a new root session.                                                       |
| `/name`          | Set or show the current session name.                                           |
| `/session`       | Show current session information and cumulative token totals.                   |
| `/context`       | Show current Agent Session context-window usage and resident context estimates. |
| `/sleep`         | Run the bundled sleep prompt for memory/context cleanup.                        |
| `/compact`       | Compact session context.                                                        |
| `/theme`         | Pick a theme.                                                                   |
| `/reload`        | Reload settings, instructions, prompts, skills, models, themes, and memories.   |
| `/export`        | Export the current session to HTML or JSONL.                                    |
| `/share`         | Export and upload the session as a secret GitHub Gist.                          |
| `/quit`, `/exit` | Exit.                                                                           |

Prompt templates and skills can also appear as slash commands. Core resolves them the same way in TUI, Workspace, and
ACP. Prompt Templates run one auxiliary turn and then restore the root profile; Skills expand into the current Agent's
turn. See [Customization](customization.md).

## CLI commands

```bash
wld help                         # global help
wld help <command>               # command help
wld version                      # version and platform architecture
wld router "request"             # explicit routing
wld agent [name] [request]       # list or use agents
wld model <provider>/<model_id>  # switch model
wld plans                        # list plans
wld plans share <plan>           # publish an encrypted Shared Space
wld plans pull <url-or-plan>      # import/pull reviewer feedback as maintainer
wld plans push <plan>            # publish the next encrypted Revision
wld plans unshare <plan>         # destructively delete a remote Shared Space
wld load-plan <name-or-path>     # continue a plan
wld wr [list|search|read|backfill|index rebuild] # Work Record retrieval and recovery
wld init                         # initialize project context
wld sleep                        # memory/context cleanup prompt
wld theme <name>                 # set theme
wld theme --list                 # list themes
wld install <source>             # install a theme package
wld remove <source>              # remove a theme package
```

## File references and shell commands

RunWield inherits Pi's TUI behavior:

- Type `@` to fuzzy-search project files.
- Use `!command` to run a shell command and send output to the model.
- Use `!!command` to run a shell command without adding output to model context.
- Use the Pi editor shortcuts for multiline input, external editor, and queued messages.

Full details: [Pi Usage](https://pi.dev/docs/latest/usage).

## Project data locations

RunWield uses RunWield-owned paths instead of Pi-owned paths:

| Data                         | Location                                   |
| ---------------------------- | ------------------------------------------ |
| Global settings              | `~/.wld/settings.json`                     |
| Credentials                  | `~/.wld/auth.json`                         |
| Custom models                | `~/.wld/models.json`                       |
| Sessions                     | `~/.wld/sessions/`                         |
| Global RunWield instructions | `~/.wld/RUNWIELD.md` or `~/.wld/AGENTS.md` |
| Home agents                  | `~/.wld/agents/`                           |
| Home prompts                 | `~/.wld/prompts/`                          |
| Project settings             | `.wld/settings.json`                       |
| Project agents               | `.wld/agents/`                             |
| Project prompts              | `.wld/prompts/`                            |
| Project plans                | `docs/plans/`                              |

On first use, RunWield imports some Pi config files into `~/.wld/` when the RunWield copy does not exist.

## Plan recovery and doctor

Use `wld plans doctor` to inspect Plan/worktree lifecycle drift:

```bash
wld plans doctor
wld plans doctor --repair
```

The default command reports issues without changing the project. `--repair` applies only safe metadata repairs, such as
marking a registry entry abandoned when its recorded worktree path is missing. Destructive actions like deleting a
branch, deleting a directory, or abandoning ambiguous work require an explicit recovery choice or a manual command.

If a lifecycle action is interrupted, RunWield may leave a recovery record in `.wld/plan-transitions/`. The next
`wld load-plan`, validation retry, or doctor run uses that record to decide whether the action was already completed,
can be rolled back, or needs user confirmation.

If the main-checkout Plan file is missing or has unreadable front matter, `wld load-plan <name>` can restore it from the
one matching execution worktree. RunWield verifies the Plan/worktree identity first. An unreadable file is copied to
`.wld/recovery/` before it is replaced. A valid main-checkout Plan is never overwritten by this recovery path.

Known Git gotcha: treat an execution worktree as exclusively owned by its active run. If another process commits or
edits source files there after validation has finished but before a publication retry, the retry can include that newer
work without rerunning the completed checks. This is not expected in isolated RunWield deployments. For a local run,
inspect the execution worktree before retrying if another tool may have touched it.

RunWield also supports Projects without Git. In that mode FEATURE execution can run in the current checkout after the
non-Git prompt/consent path. Doctor skips Git worktree checks that do not apply and reports only Plan metadata issues.
