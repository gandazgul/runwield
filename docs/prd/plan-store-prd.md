# Plan Store

Last updated: 2026-10-02 EDT

## Background

RunWield keeps every Plan as a Markdown file in the project's repository, under `docs/plans/`. Each checkout of that
repository therefore holds its own copy of every Plan: the primary checkout, every planning and execution worktree, and
every branch, including Epic branches. RunWield spends a large and growing share of its workflow machinery deciding
which copy is authoritative and reconciling the others. This proposal moves Plans into one RunWield-managed store
outside the repository, while keeping them plain, unencrypted, human-readable Markdown.

## Problem Description

**One Plan, many copies.** A Plan's status, metadata, and body can each differ between checkouts. Recurring failures
trace back to that, including several fixed in the last week:

- A new Epic branch is missing its child drafts, so the first child cannot start.
- Planner's edits to sibling Plans stay stranded in one child's worktree until that child's execution starts.
- Lifecycle status is written in an execution worktree and must be carried back to the primary checkout; a stale primary
  copy must never overwrite it.
- Archiving or reading a child silently prepares a planning worktree because the authoritative copy lives on a branch.
- Publication must carry Plan files through merges and treat them specially in conflict and cleanup handling.

Each fix closes one path; the next workflow finds another. The cause is structural: code needs many divergent copies,
but a Plan needs exactly one.

**Plans leave a footprint in other people's repositories.** A contributor who uses RunWield on an open-source project
puts `docs/plans/` files into their branches and pull requests. Some maintainers will not want that, and the contributor
may not want to publish their planning.

**Plans are lost when a folder moves.** RunWield keys Sessions by folder path today. Renaming or moving a project folder
loses Session history; tying Plans to the same key would lose Plans too.

**Goals:**

- Every Plan has exactly one live copy, and every RunWield process, Session, worktree, and agent reads and writes it.
- Plans remain plain Markdown files a person can open, edit, and search with ordinary tools.
- RunWield adds no Plans to a repository unless the project asks for them.
- Plans and Sessions survive folder renames, moves, and remote changes.
- A Plan's important versions are kept and restorable.

**Non-goals:**

- Encrypting or hiding Plans.
- Real-time multi-user editing. Workspace Plan sharing remains the team channel.
- Moving Work Records. They stay in the repository: they are the project's shared delivery memory, and the repository is
  the only place teammates can find them until shared memory exists. They are not committed automatically, so the user
  decides whether to keep them.
- Changing the managed `.gitignore` block, which stays as it is.

## Why Are We Building It?

- **Reliability.** Removing Plan copies removes the largest source of workflow and recovery bugs instead of patching
  them one at a time. Walk-away-and-resume becomes simpler because recovery reads one Plan, not a search across copies.
- **Epics work as designed.** Planner can reshape sibling drafts as part of planning, and every later child sees the
  change immediately, with no seeding or carry-over through execution.
- **RunWield is safe to use on any repository.** Open-source contributors can plan with RunWield without publishing
  their Plans or changing the project.
- **The repository stays readable where the owner wants it.** Owners of their own projects can still have the Plan that
  produced each delivered change sit beside the code.

This matters now because the Plan Packages Epic is about to redefine Plan storage in its first child. Settling where
Plans live first avoids building packages on the copy model and migrating twice.

## Audience

- **Primary:** developers using RunWield on their own projects, who need Plans that never disagree with themselves and
  survive restarts, folder moves, and long Epics.
- **Primary:** developers contributing to repositories they do not own, who need RunWield to leave no trace there.
- **Secondary:** readers of a repository who benefit from delivered Plans beside the code, when the owner opts in.
- **Out of scope for this version:** teams that want live Plans to appear automatically for every collaborator through
  Git. They use Workspace sharing.

## Product Fit, Prototypes, and Descriptions

Today a user opens `docs/plans/my-feature.md` in the project. After this change they open `.wld/plans/my-feature.md` in
the same project, the same way, in the same editor. That path is a link to the project's store, so the file they edit is
the one RunWield uses everywhere.

```text
~/.wld/projects/<project>/
  plans/
    my-feature.md                         the live Plan: the only copy RunWield reads
    my-epic.md
    my-epic/01-first-child.md
  history/
    my-feature/
      2026-10-02T14-05-approved.md        frozen copy at each milestone
      2026-10-04T09-30-delivered.md

<project folder>/
  .wld/plans  →  ~/.wld/projects/<project>/plans/   (never shown as a repository change)
  docs/plans/my-feature.md                         delivery copy, only when the project opts in
```

Journeys:

- **Planning and running.** Planner writes the draft into the store. Review, execution, validation, and delivery read
  and update the same file. Worktrees contain code only.
- **Epics.** While planning one child, Planner edits a sibling's draft in the store. The next child's Planner session
  sees the change at once.
- **Delivery copies.** In a project that opts in, the delivery commit includes a copy of the Plan as delivered at
  `docs/plans/`. RunWield writes that copy and never reads it again. A reader browsing `main` sees the Plan that
  produced the code.
- **Open-source contribution.** In a project that has not opted in, branches and pull requests contain only the code.
- **Bringing in a Plan.** A user who has a Markdown spec from anywhere — a teammate, an issue, an older `docs/plans/`
  file — points RunWield at it, and RunWield copies it into the store as a draft.
- **Upgrading.** After upgrading, an existing user sees no Plans until they run `wld plans import docs/plans/` once. The
  release notes say so. RunWield then asks whether to keep delivered Plans in `docs/plans/` for this project.
- **Moving the project.** The user renames the project folder. RunWield still finds its Plans and Sessions.

## Capability Requirements

These are proposed changes. The owning Core capabilities are linked for each; implementation updates them in the same
change that delivers the behavior.

### Plan store

**Scope and maturity:** Target. Changes
[Plan authoring and external adoption](runwield-core-prd.md#plan-authoring-and-external-adoption) and every capability
that reads Plans from a checkout.

**Requirement: Every Plan has one live copy.** RunWield keeps each project's Plans in one store outside the repository.
Every Session, worktree, agent, and client reads and writes that copy. No checkout or branch holds a live Plan, so no
Plan can disagree with itself.

**Requirement: Plans stay plain Markdown.** Plans in the store are ordinary unencrypted Markdown files with their
existing structure. The user can open, edit, search, and copy them with ordinary tools. Edits made outside RunWield are
the Plan's content from then on, with the same body-ownership rules as today.

**Requirement: Plans are reachable from the project.** The project folder contains a link, `.wld/plans`, to the store,
so editors and agents limited to the project folder can reach Plans. The link never appears as a repository change.

**Requirement: Recovery reads the one copy.** Restarting, crashing, or walking away and returning resumes from the
store's copy at every status, from draft through delivery, with no reconciliation between copies.

**Acceptance scenarios:**

- Given Planner editing a sibling draft while planning one Epic child, when the next child's planning starts, it sees
  the edit without any execution or publication step.
- Given a Plan edited in an editor through `.wld/plans`, when the user loads it, RunWield uses the edited content.
- Given an external host whose file access is limited to the project folder, when it reads a Plan through `.wld/plans`,
  it reads the live Plan.
- Given a project with the link, when the user runs `git status`, the link does not appear.
- Given a crash during a review turn, execution, or publication, when the user loads the Plan again, RunWield resumes
  from the store's status without consulting any checkout's copy.

### Plan history

**Scope and maturity:** Target.

**Requirement: Milestone versions are kept.** When a Plan is approved, delivered, and closed or archived, RunWield keeps
a frozen copy of it as a readable Markdown file in the project's history. History works without Git, in every project.

**Requirement: A kept version can be restored.** The user can restore a kept version as the live Plan, through RunWield
or by copying the file.

**Acceptance scenarios:**

- Given an approved Plan that Planner later rewrites, when the user looks at its history, the approved version is there
  unchanged.
- Given a machine without Git, when a Plan reaches a milestone, its version is kept.
- Given a crash between a Plan change and its next milestone, when RunWield restarts, the live Plan is intact and the
  next milestone keeps it.

### Project identity

**Scope and maturity:** Target. Changes [Session continuity](runwield-core-prd.md#session-continuity).

**Requirement: Plans and Sessions belong to the project, not its folder.** RunWield identifies a project by an identity
it creates once and keeps with the project's local repository configuration, or in a small file for a folder without a
repository. Renaming or moving the folder, or adding, changing, or removing a remote, keeps the same Plans and Sessions.
Worktrees of a project share its identity.

**Requirement: A fresh clone can join its project's Plans.** When a new clone matches a known project by repository
remote, RunWield asks once whether to use that project's Plans. Otherwise the clone starts a new project.

**Requirement: Identity leaves no repository footprint.** The identity is never committed. A folder that later becomes a
repository keeps its identity, and the identity file is removed from the working tree so it cannot be committed by
accident.

**Acceptance scenarios:**

- Given a project with Plans and Sessions, when the user renames its folder, RunWield shows the same Plans and Sessions.
- Given a local project with no remote, when the user adds a remote, RunWield keeps the same Plans.
- Given a folder without Git that later runs `git init`, when RunWield next opens it, it keeps the same Plans and the
  working tree has no identity file to commit.
- Given a second clone of a repository whose remote matches a known project, when RunWield first opens it, the user is
  asked once whether to link it; declining starts a separate project.

### Repository footprint and delivery copies

**Scope and maturity:** Target. Changes
[Keep Project Runtime State out of repository changes](runwield-core-prd.md#work-protection).

**Requirement: RunWield adds no Plans to a repository by default.** Without the project setting, RunWield writes no Plan
files, branches, or commits for Plans into the repository. Branches and change requests contain the work, plus any Work
Records the user chooses to keep.

**Requirement: Owners can keep delivered Plans beside the code.** With the project setting on, each delivery commit
includes a copy of the delivered Plan at `docs/plans/`. RunWield writes that copy at delivery and never reads, lists, or
compares it afterwards. Editing it changes nothing in RunWield.

**Acceptance scenarios:**

- Given a project without the setting, when a Plan is delivered, the delivery commit contains only the implementation.
- Given a project with the setting, when a Plan is delivered, its delivery commit contains `docs/plans/<plan>.md` as
  delivered, and the live Plan is unchanged.
- Given a delivery copy edited by hand, when the user loads the Plan, RunWield uses the store's copy.
- Given a publication retried after a crash, when it completes, the delivery copy matches the Plan version the attempt
  started with, even if the Plan was edited in between.

### Plan import

**Scope and maturity:** Target. Replaces
[External Markdown Plans are first-class](runwield-core-prd.md#plan-authoring-and-external-adoption). This is a one-time
breaking change for existing users.

**Requirement: RunWield lists Plans from the store only.** Nothing outside the store is found, listed, or imported
automatically. A file in `docs/plans/`, from this project or anyone else's, is an ordinary file until the user imports
it.

**Requirement: Import is one explicit command for a file or a folder.** `wld plans import <path>` copies Markdown into
the store and leaves the originals untouched. A file with RunWield metadata keeps its identity, status, and Epic
relationships; a file without it becomes a draft with its prose unchanged. Importing the same Plan twice does not create
a duplicate. Loading a Markdown file by path is the same import for one file.

**Requirement: Import offers delivery copies once.** After importing a folder of Plans from the project's repository,
RunWield asks once whether to keep delivered Plans in `docs/plans/` for this project, with yes preselected. The answer
sets the project's delivery copy setting.

**Requirement: Upgrading is announced, not automated.** The release that introduces the store tells existing users to
run `wld plans import docs/plans/` once per project. RunWield does not detect, offer, or perform the import on its own.

**Acceptance scenarios:**

- Given an upgraded project with Plans in `docs/plans/`, when the user opens RunWield without importing, no Plans are
  listed and the repository files are unchanged.
- Given that project, when the user runs `wld plans import docs/plans/`, every RunWield Plan appears in the store with
  its identity, status, and Epic relationships, the originals are untouched, and RunWield asks whether to keep delivered
  Plans in `docs/plans/`.
- Given a Markdown file without RunWield metadata, when the user imports it or loads it by path, it becomes a draft with
  its prose unchanged.
- Given a Plan already in the store, when the user imports the same file again, no duplicate appears.
- Given a fresh clone of someone else's repository with `docs/plans/` files, when the user opens it in RunWield, nothing
  is imported and nothing is offered.

## Success Metrics

- **Copy-related defects stop.** Baseline: the recurring class of Plan-copy defects described above. Target: no new
  defects of that class after release. Measured from bug reports and fixes over the following months.
- **No repository footprint by default.** Observable directly: a change request from a project without the setting
  contains no RunWield files.
- **Rename survival.** Observable directly: Plans and Sessions remain after a folder rename.

The capability scenarios above show the behavior is present; these measures show it helped.

## Delivery

The smallest useful release is the store, project identity, the project link, and explicit import, released with a note
telling existing users to run `wld plans import docs/plans/` once. Delivery copies and milestone history can follow in a
second step without changing the store.

This work changes Plan storage, so it is planned before the
[Plan Packages and Independent Validation](../plans/plan-packages-and-independent-validation.md) Epic, whose first child
defines Plan storage. That Epic then builds packages inside the store. Hand this PRD to Architect for an Epic.

## Attached Research and Other Evidence

- The 2026-10-01 Epic branch and integration gate work (`epic-branches-and-integration-gate`) needed seeding child
  drafts onto Epic branches, read-only Plan resolution for archive and Work Records, parent-Epic lookup across
  checkouts, and carrying sibling edits through execution preparation. Each was a Plan-copy problem.
- The document-location and recovery machinery in Core (`plan-location`, controller document worktrees, execution Plan
  materialization, publication Plan paths) exists to choose between Plan copies.
- The owner's own use: across building RunWield with RunWield, the external-adoption-by-folder feature was never used.

## Risks and Mitigations

- **Plans are tied to one machine.** A second machine or a teammate's clone does not see live Plans automatically.
  Mitigation: Workspace Plan sharing; the user can also synchronize the store directory with tools of their choice.
- **Losing `~/.wld` loses Plans.** Mitigation: milestone history and delivery copies; state the store location plainly
  so users can back it up.
- **The project link can break on platforms without symbolic links or with restricted permissions.** Mitigation: a
  directory junction on Windows; report a broken link with a one-step repair instead of failing silently.
- **Agents may read a stale delivery copy in a worktree.** Mitigation: agents are always given the live Plan's path, and
  delivery copies are only written in projects that opt in.
- **Users upgrade with work in progress.** Plans imported with their status keep their identity, so RunWield's runtime
  records for in-progress work still apply. Mitigation: the release note recommends finishing or pausing in-progress
  Plans before upgrading, and the import keeps every Plan's status as it was.
- **Users miss the release note and think their Plans are gone.** Mitigation: when the store is empty and the project
  has `docs/plans/`, the empty Plan list says how to import. It does not import.

## Proposed Domain Language

These terms are proposed. The implementing work updates `docs/domain-language.md` when they become true.

- **Plan Store:** the one RunWield-managed location holding a project's live Plans as Markdown files, outside the
  repository. _Avoid:_ Plan database, plans folder. Replaces `docs/plans/` as the meaning of "where Plans live."
- **Project Identity:** the identity RunWield creates once per project and keeps with its local repository configuration
  or folder, used to find its Plan Store and Sessions. _Avoid:_ project path, repo ID.
- **Plan History:** the frozen Markdown versions a Plan keeps at its milestones. _Avoid:_ Plan revisions, backups.
- **Delivery Copy:** the Plan as delivered, written into a delivery commit when the project opts in, and never read by
  RunWield. _Avoid:_ mirror, synced Plan, snapshot Plan.
- **Affected existing terms:** External Markdown Plans become explicitly imported; Epic Branch no longer carries child
  drafts; Epic Artifacts move with their Epic into the store.
