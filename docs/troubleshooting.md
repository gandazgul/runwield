# Troubleshooting

## Mnemosyne, Cymbal, or agent-browser is missing

Interactive agent workflows require all three binaries in `PATH`. Rerun the RunWield installer to restore missing
required helpers into the same install directory as `wld`:

```bash
curl -fsSL https://raw.githubusercontent.com/gandazgul/runwield/main/install.sh | bash
```

If you use a custom directory, pass the same `WLD_INSTALL_DIR` again. Existing helper binaries found on `PATH` or in the
install directory are preserved; remove a RunWield-managed helper from `WLD_INSTALL_DIR` before rerunning if you want
the installer to fetch a fresh copy.

## Plan review UI does not open

Plan review runs inside the Workspace UI. For source checkouts, confirm the reviewed Plannotator source checkout and
published Plannotator packages are available:

- `third_party/plannotator/` exists and matches `third_party/plannotator-revision.txt`.
- `deno task workspace:dev:plan-review` starts the fixture-backed review route.
- `deno task workspace:dev:surfaces` opens the development catalog for local/TUI and Workspace variants of the Plan
  Board, Plan Review, and Code Review.
- `deno task workspace:check` can resolve the `@plannotator/*` imports from `deno.json` and Workspace aliases.

## A saved plan is not loading

- Use `wld plans` to list plan names.
- Use `wld load-plan <name>` for a plan in `docs/plans/`.
- Use `wld load-plan docs/plans/<name>.md` for a direct path.
- Use `/resume` only for chat sessions, not plan files.
- If `docs/plans/<name>.md` was deleted or became unreadable during an active worktree run, use the Plan name rather
  than the path: `wld load-plan <name>`. RunWield will restore the file only when one matching execution worktree proves
  its identity; malformed bytes are backed up under `.wld/recovery/`.

## Publication stopped or cleanup was incomplete

- A temporary remote failure is retried automatically. If retries run out, restore network access and run
  `wld load-plan <name>` again; the validated commits remain on the source branch.
- If Git reports a force-with-lease race, RunWield rereads the target branch and retries with its new commits.
- If publication succeeded but cleanup did not, follow the worktree path and source branch printed in the TUI. Inspect
  them with `git status` and `git branch -vv`, save any files you need, then run `wld plans doctor` before deleting
  anything manually.

## Agent behavior looks off

- Check local overrides in `<repo>/.wld/agents/`.
- Check home overrides in `~/.wld/agents/`.
- Run `/reload` in the TUI after changing memories, settings, prompt templates, skills, models, or themes.
