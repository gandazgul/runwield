# ADR-005: Concurrent Execution Isolation via Git Worktrees

## Status

Accepted

## Context

RunWield previously executed plan work in the primary working tree (CWD = `Deno.cwd()`). This meant:

- Two RunWield instances executing plans concurrently could step on each other's file changes.
- Failed execution recovery could reset the primary checkout to a baseline snapshot and destroy unrelated user edits.
- Plan recovery had no isolated place to inspect, merge, continue, or discard a partial execution.

ADR-003 introduced execution baseline trees (git tree objects captured before execution) as a lightweight recovery
mechanism, but those trees operated on the same working tree. ADR-004 centralized the plan lifecycle, but did not change
the single-worktree constraint.

We need a mechanism that lets multiple RunWield instances, or multiple sequential plan executions, operate independently
on the same repository.

## Decision

Use **git worktrees** (`git worktree add`) to isolate each saved plan execution into its own linked working tree.

### Isolation Granularity

**Plan-level isolation.** Each plan execution gets one worktree. Tasks within a PROJECT plan share that worktree because
they are already coordinated by the orchestrator and write-scope conflict detection runs against the same tree. This
avoids per-task worktree complexity while allowing concurrent plan executions to avoid primary-checkout conflicts.

### Worktree Lifecycle

1. **Creation** — Before `execution_started`, RunWield creates or reuses a worktree branch with the prefix
   `runwield/worktree/` from the selected base ref. If plan front matter has `worktreeBaseBranch`, RunWield resolves it
   to a local branch first: existing local branch, local tracking branch from `origin/<branch>`, or a new local branch
   from `main`. Without that field, creation keeps the legacy current-checkout `HEAD` behavior. The worktree path is
   created adjacent to the primary repo and includes a sanitized plan slug plus a short id, e.g.
   `../<repo>-runwield-<plan-slug>-<id>`.
2. **Execution** — Implementation runs in the worktree cwd. RunWield records the execution baseline tree from that
   worktree. Agent sessions and file-writing tools receive the worktree cwd explicitly; RunWield does not mutate the
   process cwd with `Deno.chdir()`.
3. **Implementation complete** — `implementation_finished` means implementation finished in the worktree. It sets Plan
   Status `implemented` and worktree status `completed`, but does **not** merge the branch into the primary checkout.
4. **Validation** — Workflow Validation runs local CI, workflow diff computation, semantic review, and repair sessions
   in the execution worktree.
5. **Merge-back** — Only after Workflow Validation passes does RunWield merge the worktree branch into the primary
   checkout. `validation_passed` and Plan Status `verified` are recorded only after that merge succeeds.
6. **Recovery/failure** — If execution, validation, or merge-back fails, the worktree is left in place. Recovery can
   inspect, continue, retry validation, merge, recreate, or abandon the isolated worktree depending on plan state.

### CWD Plumbing

`CWD` remains the primary project root. It anchors saved plan files, RunWield settings, `.wld/worktrees.json`, and
`.wld/worktrees.lock`.

Execution code must pass an explicit execution cwd to every operation that reads or writes implementation files:

- `runAgentSession()` / agent session creation
- built-in file tools and custom edit tools
- PROJECT task sub-sessions
- local CI
- workflow diff computation
- reviewer sessions
- operator/engineer repair sessions
- git snapshot helpers that operate on the implementation tree

Prompt templates, settings, plan metadata updates, and worktree registry updates remain anchored to the primary project
root unless a caller explicitly needs worktree-local files.

### Worktree Registry

A persistent local JSON file at `<project>/.wld/worktrees.json` tracks active and historical execution worktrees. It is
runtime state, not source state, and should stay ignored by Git alongside `.wld/worktrees.lock`:

```json
{
    "version": 1,
    "entries": [
        {
            "id": "5fe73e21",
            "planName": "add-dark-mode-toggle",
            "baseBranch": "main",
            "baseRef": "HEAD",
            "baseCommit": "abc123def...",
            "branch": "runwield/worktree/add-dark-mode-toggle-5fe73e21",
            "path": "/absolute/path/to/repo-runwield-add-dark-mode-toggle-5fe73e21",
            "status": "active",
            "createdAt": "2026-06-15T12:00:00.000Z",
            "updatedAt": "2026-06-15T12:00:00.000Z"
        }
    ]
}
```

A best-effort advisory lockfile at `<project>/.wld/worktrees.lock` prevents concurrent RunWield instances from racing
while creating, updating, or deleting registry entries.

### Front Matter Additions

The plan's `PlanFrontMatter` includes optional worktree fields:

| Field                | Type                                                                                                                                    | Description                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `worktreeId`         | `string \| null`                                                                                                                        | Durable registry id for the execution worktree.                                       |
| `worktreePath`       | `string \| null`                                                                                                                        | Filesystem path to the execution worktree.                                            |
| `worktreeBranch`     | `string \| null`                                                                                                                        | Branch checked out in the execution worktree.                                         |
| `worktreeBaseBranch` | `string \| null`                                                                                                                        | Authored target branch before execution; durable merge target after execution starts. |
| `worktreeStatus`     | `"none" \| "active" \| "completed" \| "execution_failed" \| "validation_failed" \| "merge_conflict" \| "merged" \| "abandoned" \| null` | Lifecycle status of the worktree.                                                     |

### Merge Strategy

RunWield performs a branch merge after validation passes into the recorded `worktreeBaseBranch` target when present, or
into the current checkout branch for legacy untargeted plans. The merge helper refuses to proceed when the target branch
is checked out elsewhere or when the primary checkout has blocking uncommitted changes, while allowing RunWield-owned
metadata paths needed during the workflow. If merge fails or is refused, RunWield records `worktree_merge_failed`, keeps
Plan Status `implemented`, sets `worktreeStatus: "merge_conflict"`, and leaves the worktree branch/path intact for
recovery.

Dirty primary checkout state is therefore a **merge-back risk**, not a worktree creation blocker. Worktree creation can
start from `HEAD` even when the primary checkout has unrelated uncommitted edits; those edits are not copied into the
execution worktree.

### Recovery Integration

The `load-plan` recovery flow resolves worktree context from plan front matter first and the registry second. Inspect
reports plan status, worktree status, path, branch, base ref/commit, git status, and diff from the execution baseline.

Recovery actions for worktree-backed plans include:

- **Continue execution from current worktree** for `in_progress` and `failed` plans.
- **Retry Workflow Validation** for `implemented` plans.
- **Merge worktree changes** for implemented worktrees that need merge-back.
- **Delete/recreate worktree and start over** without restoring the primary checkout.
- **Delete/abandon worktree** to discard the isolated checkout and clear plan worktree fields.
- **Re-open for review** to revise the plan.

Legacy plans with an execution baseline but no worktree metadata keep the older primary-checkout baseline reset path
with a destructive warning.

### Plan List Visibility

`wld plans` displays concise worktree state when a plan has worktree metadata, for example:

```text
Worktree: merge_conflict (runwield/worktree/add-dark-mode-toggle-5fe73e21)
```

## Consequences

### Positive

- Multiple RunWield instances can execute plans concurrently without implementation-file conflicts.
- The primary working tree is not touched during implementation or validation repair.
- Workflow Validation checks the isolated execution result before anything is merged back.
- Plan recovery can inspect, continue, retry validation, merge, recreate, or abandon an isolated checkout.
- The worktree registry provides durable state for recovery and plan listing.

### Negative

- Worktree creation and deletion add latency to execution start/recovery.
- Disk usage increases while worktrees remain active.
- Branch namespace `runwield/worktree/*` needs periodic cleanup when worktrees are abandoned.
- The `.wld/worktrees.json` registry and lockfile must be kept consistent after crashes or interrupted sessions.
- Merge-back can be blocked by dirty primary-checkout files or conflicts even after validation passes in the worktree.

### Mitigations

- Registry writes use a lockfile plus atomic temp-file-and-rename updates.
- Recovery detects missing worktree paths and can abandon or recreate isolated worktrees.
- Worktree pruning compares registry entries with filesystem/git worktree state and removes stale records.
- Merge failures keep the worktree branch/path intact and leave the plan in `implemented` for recovery.
- Baseline-tree reset remains available only for legacy no-worktree plans, with the existing destructive warning.
