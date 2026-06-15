# ADR-005: Concurrent Execution Isolation via Git Worktrees

## Status

Accepted

## Context

Harns currently executes all plan work in the primary working tree (CWD = `Deno.cwd()`). This means:

- Two Harns instances executing plans concurrently will step on each other's file changes.
- A failed execution leaves the working tree in an unknown state, and recovery resets the entire tree to the baseline
  snapshot — destroying unrelated user edits.
- Plan recovery has no way to inspect, merge, or discard a partial execution without affecting other work.

ADR-003 introduced execution baseline trees (git tree objects captured before execution) as a lightweight recovery
mechanism, but those trees operate on the same working tree. ADR-004 centralized the plan lifecycle, but didn't change
the single-worktree constraint.

We need a mechanism that lets multiple Harns instances (or multiple sequential plan executions) operate independently on
the same repository.

## Decision

Use **git worktrees** (`git worktree add`) to isolate each plan execution into its own linked working tree.

### Isolation Granularity

**Plan-level isolation.** Each plan execution gets its own worktree. Tasks within a PROJECT plan share that worktree
(they are already coordinated by the orchestrator and write-scope conflict detection runs against the same tree). This
avoids the complexity of per-task worktrees while giving us the primary benefit: concurrent plan executions don't
conflict.

### Worktree Lifecycle

1. **Creation** — Before `execution_started`, Harns creates a branch named `harns/worktree/<plan-name>` from the current
   HEAD, then calls `git worktree add -b harns/worktree/<plan-name> <path> HEAD`. The worktree path follows the pattern
   `../<repo-name>-<plan-name>` (adjacent to the primary repo).

2. **Execution** — The execution runs in the worktree's CWD. All git-snapshot operations (baseline capture, diff, tree
   operations) receive the worktree path as their CWD. The primary working tree is completely untouched.

3. **Merge (success)** — On `implementation_finished`, Harns switches back to the primary working tree, merges
   `harns/worktree/<plan-name>` into the current branch (fast-forward when possible), updates the plan's front matter,
   and optionally removes the worktree via `git worktree remove`.

4. **Inspect/Resume (failure)** — On `execution_failed`, the worktree is left in place. Recovery menus show the worktree
   path and can offer to inspect it, continue execution inside it, merge partial changes, or delete it.

### Worktree Registry

A persistent JSON file at `<project>/.hns/worktrees.json` tracks all active and historical worktrees:

```json
{
    "worktrees": [
        {
            "id": "add-dark-mode-toggle",
            "planName": "add-dark-mode-toggle",
            "branch": "harns/worktree/add-dark-mode-toggle",
            "path": "/absolute/path/to/../harns-add-dark-mode-toggle",
            "baseBranch": "main",
            "baseTree": "abc123def...",
            "status": "active",
            "createdAt": "2026-06-15T12:00:00.000Z",
            "updatedAt": "2026-06-15T12:00:00.000Z"
        }
    ]
}
```

A simple lockfile at `<project>/.hns/worktrees.lock` prevents race conditions between concurrent Harns instances
creating or deleting worktrees.

### Front Matter Additions

The plan's `PlanFrontMatter` gains three optional fields:

| Field            | Type                                                                               | Description                                                       |
| ---------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `worktreePath`   | `string \| null`                                                                   | Absolute path to the worktree, or null when no worktree is active |
| `worktreeBranch` | `string \| null`                                                                   | Branch name of the worktree (e.g., `harns/worktree/<plan-name>`)  |
| `worktreeStatus` | `"none" \| "active" \| "completed" \| "failed" \| "merged" \| "abandoned" \| null` | Lifecycle status of the worktree                                  |

### Merge Strategy

**Branch merge** — the worktree is created on a named branch. On success, Harns returns to the primary worktree and runs
`git merge harns/worktree/<plan-name>`. Fast-forward merges are preferred; if conflicts arise, they are surfaced to the
user for manual resolution. For fully automated workflows, the merge can be configured to use
`git merge --no-commit --no-ff` and diff-apply as a fallback.

### Recovery Integration

The `handlePlanRecovery` flow in the `load-plan` command gains worktree-aware options:

- **Inspect worktree** — shows the worktree status, current branch, and diff from base
- **Merge worktree changes** — for `implemented` plans where the worktree is still active but unmerged
- **Continue in worktree** — for `in_progress` or `failed` plans, resume execution inside the existing worktree
- **Delete worktree** — removes the worktree (`git worktree remove`) without merging, discarding changes
- **Reset worktree** — deletes and recreates the worktree from the execution baseline tree

### Locking

A simple advisory lockfile (`<project>/.hns/worktrees.lock`) with a timeout prevents two Harns instances from
simultaneously modifying the worktree registry or creating worktrees for the same plan.

## Consequences

### Positive

- Multiple Harns instances can execute plans concurrently without file conflicts.
- The primary working tree is never touched during execution — unrelated user edits are preserved.
- Plan recovery gains concrete options around merge/inspect/delete instead of only "reset everything."
- The worktree registry provides a durable record of all execution attempts, even past sessions.
- No changes to the task-scheduling or project-executor logic — tasks already receive CWD implicitly.

### Negative

- Git worktrees require a clean working tree in the primary checkout before creation (git enforces this, so `git stash`
  or commit may be needed).
- Worktree creation and deletion adds latency to execution start/end (typically 10–100ms).
- Disk usage increases (one extra checkout per active worktree).
- Branch namespace `harns/worktree/*` needs periodic GC if worktrees are abandoned.
- The `.hns/worktrees.json` registry and lockfile must be kept consistent — a crashed instance could leave stale
  entries.

### Mitigations

- On startup, Harns can prune stale worktree registrations (check if the worktree path still exists, check
  `git worktree list` for orphans).
- A `hns worktrees prune` command can clean up abandoned worktrees and stale registry entries.
- The lockfile uses a 5-second timeout and PID-based detection.
- `git worktree remove --force` is available as a fallback when the primary tree is dirty.
