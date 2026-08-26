---
planId: "d95497fb-0ec8-41ae-98e5-57f3fa7c0d51"
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "HIGH"
affectedPaths:
    - "src/shared/settings.js"
    - "src/shared/workflow/validation-local-ci.ts"
    - "src/shared/workflow/validation.ts"
    - "src/shared/workflow/validation-mechanical.ts"
    - "src/shared/settings.test.js"
    - "src/shared/workflow/validation-local-ci.test.ts"
    - "src/shared/workflow/validation-loop-repair.test.js"
    - "src/shared/workflow/validation-repair-resume.integration.test.ts"
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-26T11:55:53-04:00"
status: "in_progress"
origin: "internal"
userVerifiedAt: null
targetBranch: "main"
---

# Use Execution-Tree Settings for Plan CI

## Context

Mechanical Validation for an executable Plan runs the configured shell command with the execution worktree as its
working directory. However, `getCustomSetting("verification_command", "project", executionCwd)` resolves a linked
worktree back to the primary checkout. The command can therefore come from the primary checkout while its files and
process come from the execution tree.

This also makes a validation repair unreliable. If the Validation Repair Engineer corrects `verification_command` in the
execution tree's `.wld/settings.json`, the next validation attempt can continue to use the primary checkout command. The
current CI repair packet only says to fix build errors; it does not tell the Engineer that a new project's configured
command can itself be the defect or that the corrected command must pass before Task Completion.

Normal project settings must keep their current primary-checkout ownership. The exception applies only to Plan
Mechanical Validation.

## Objective

For every Plan Mechanical Validation attempt, load `verification_command` afresh from
`<executionCwd>/.wld/settings.json` and run that command in `executionCwd`. Do not reuse a command from an earlier
attempt and do not fall back to the primary checkout's project command.

When Plan CI fails, tell the Validation Repair Engineer to inspect the execution tree's `.wld/settings.json`, correct
the configured command when it is the cause, run the resulting command in the repair checkout, and emit `task_completed`
only after that verification passes. RunWield must then independently reload the execution-tree command and run it
again.

## Approach

Keep the general settings contract unchanged and add a narrow exact-tree project-settings operation in the settings
module. The operation must reuse the existing JSONC parsing and locked-write behavior, but it must not call
`resolvePrimaryCheckoutRoot`. It must read the file on each request rather than retain its contents.

Bind this behavior at the Core Session composition point for Workflow Validation. The session-independent engine can
keep its existing `localCI.run({ cwd })` interface: `createEngineValidationArgs` knows that these calls belong to
executable Plan validation and can configure the real local-CI adapter to use `cwd` as both the command settings root
and process working directory. The no-Plan QUICK_FIX path and injected CI test ports keep their current behavior.

```text
Plan Mechanical Validation attempt
  resolve executionCwd
  read executionCwd/.wld/settings.json now
  select verification_command
  spawn command with cwd = executionCwd
  if failed:
    dispatch focused CI repair in executionCwd
    require the repaired command to pass before task_completed
    repeat from the fresh settings read
```

Use CI-specific repair text in `dispatchCiRepair`; do not add settings instructions to the shared repair prompt used by
semantic and merge repairs.

The set-aside option is to change all linked-worktree project settings to use the linked tree. That would break the
established primary-checkout settings policy for unrelated runtime configuration.

## Expected Change Surface

The boundaries this change is expected to touch. This list is guidance, not an allowlist: verify the real footprint
during implementation and change whatever the Implementation Steps need, including files not named here. Stop and report
only when discovery changes approved intent — the change reaches another subsystem, public behavior or architecture
shifts, migration or compatibility risk grows, or the Verification Plan no longer proves the objective.

- `src/shared/settings.js` — provide an explicit exact-tree custom-setting read/write path that reloads file content
  without changing normal linked-worktree settings resolution.
- `src/shared/workflow/validation-local-ci.ts` — select and, when prompted, save the validation command through the
  configured settings location while preserving process execution, cancellation, output bounds, and operational-failure
  behavior.
- `src/shared/workflow/validation.ts` — bind executable Plan validation to exact execution-tree settings without
  widening the session-independent engine port.
- `src/shared/workflow/validation-mechanical.ts` — make the focused CI repair packet cover a defective
  `.wld/settings.json` command and completion-after-success rules.
- `src/shared/settings.test.js` — protect both the existing primary-checkout settings policy and the new fresh
  exact-tree operation.
- `src/shared/workflow/validation-local-ci.test.ts` — prove command reload, exact settings location, process working
  directory, and no primary fallback through the real shell boundary.
- `src/shared/workflow/validation-loop-repair.test.js` — protect completion gating and the CI-specific repair
  instructions.
- `src/shared/workflow/validation-repair-resume.integration.test.ts` — prove that a command corrected during a real
  completion-gated repair is reloaded and independently rerun before validation advances. The executing Engineer can
  place the linked-worktree fixture in a more suitable existing validation integration file if discovery shows a clearer
  home.

`docs/settings.md` is deliberately outside this change. It is already modified in the primary working tree, and the
general project-settings policy remains unchanged. The implementation adds a Workflow Validation exception rather than
changing the documented default.

## Reuse Opportunities

- `src/shared/settings.js` — reuse `RunWieldSettingsStorage`, JSONC parsing, `proper-lockfile` locking, and
  custom-setting preservation instead of adding direct unguarded file access in validation code.
- `src/shared/primary-checkout.ts` — preserve `resolvePrimaryCheckoutRoot` for ordinary settings; the new operation must
  explicitly bypass it rather than weaken it.
- `src/shared/workflow/validation-local-ci.ts` — retain `spawnForegroundShell`, bounded stream capture, runtime tool
  events, and cancellation behavior.
- `src/shared/workflow/validation-repair-prompt.ts` — keep the common focused-repair packet and supply CI-only
  `repairsNeeded` or completion text from `dispatchCiRepair`.
- `src/shared/git-test-fixture.ts` — use `defineGitFixture` and real linked worktrees for the primary-versus-execution
  regression.
- `src/shared/workflow/validation-repair-resume.integration.test.ts` — reuse its real Task Completion repair-turn
  pattern and `onRun` hook to change the settings file during repair.

## Implementation Steps

- [ ] `src/shared/settings.js` exposes a named exact-tree custom-setting operation whose project path is exactly
      `<providedRoot>/.wld/settings.json`; each read parses the current on-disk JSONC content, and exact-tree writes use
      the existing lock and preservation rules.
- [ ] Existing `getCustomSetting`, `setCustomSetting`, `getSettingsDir`, and Pi `SettingsManager` behavior still resolve
      linked-worktree project settings to the primary checkout for all ordinary callers.
- [ ] The real local-CI adapter supports an explicit Plan-validation settings policy without making new arguments
      mandatory for existing callers. Under that policy, command lookup and prompted command persistence both use the
      exact execution tree; a missing or malformed execution-tree setting does not silently use the primary checkout
      command.
- [ ] `createEngineValidationArgs` binds every executable Plan local-CI run to a fresh exact-tree command lookup while
      keeping `ValidationLocalCIPort.run({ cwd })`, public injected CI ports, and the no-Plan QUICK_FIX path compatible.
- [ ] Every Plan Mechanical Validation attempt opens and parses `.wld/settings.json` after the phase resolves its
      current `executionCwd` and immediately before process launch. It does not cache the command or use file metadata
      as a substitute for the read. A retry, resumed validation, or post-repair attempt observes an on-disk command
      change without a RunWield restart or `/reload`.
- [ ] The command selected from `<executionCwd>/.wld/settings.json` runs with `cwd = executionCwd`; neither command
      selection nor process execution uses the primary checkout when the Plan has a linked execution worktree.
- [ ] `dispatchCiRepair` tells the Validation Repair Engineer that the failing command is configured in the repair
      checkout's `.wld/settings.json`, that the command itself can be wrong on a new project, and that it must correct
      the file or implementation as needed and run the configured command successfully in that checkout before Task
      Completion.
- [ ] The generic semantic-review and merge-repair packets do not gain CI-settings instructions.
- [ ] A real linked-worktree regression gives the primary checkout and execution tree different marker-producing
      commands and proves Plan Mechanical Validation executes only the execution-tree marker command from the
      execution-tree working directory.
- [ ] A completion-gated repair regression starts with a failing execution-tree command, changes that command during the
      Validation Repair Engineer turn, emits Task Completion, and proves the next independent Mechanical Validation
      attempt reloads and passes the replacement command before Plan status advances. Preserve the settings file's size
      and restore its prior modification time after the rewrite so a command cache keyed by path, size, or timestamp
      fails the test. The test also fails if the command is read from primary or trusted solely from the Engineer's
      report.
- [ ] Existing local-CI behavior remains protected: JSONC support, missing-command handling, process-start failure
      classification, bounded output, cancellation of the process tree, and ordinary primary-checkout settings
      ownership.

## Approval Confirmation

This Plan does not supersede a Work Record.

## Verification Plan

- Automated: run the focused settings and validation tests with
  `deno run -A scripts/run-tests.js src/shared/settings.test.js src/shared/workflow/validation-local-ci.test.ts src/shared/workflow/validation-loop-repair.test.js src/shared/workflow/validation-repair-resume.integration.test.ts`.
- Automated behavior proof: the linked-worktree test must fail against the current code because the primary marker runs
  instead of the execution-tree marker. It must also assert the observed process working directory.
- Automated reload proof: use equal-length failing and passing commands and restore the settings file's original
  modification time after the repair rewrite. The integration must fail if local CI remembers the first command, uses
  path/size/timestamp metadata instead of opening the file for the new attempt, accepts the repair report alone as
  proof, or does not perform the second real command run after Task Completion.
- Automated prompt proof: capture the actual `dispatchCiRepair` request and assert it names `.wld/settings.json`, the
  repair checkout, successful command verification, and the restriction on calling `task_completed`. Also assert a
  semantic or merge repair request does not inherit these CI-only instructions.
- Automated compatibility: run `deno task seams:check` to confirm the change does not add an injection seam, then run
  `deno task test` for the full suite.
- Manual: in a disposable Git repository with a registered execution worktree, put distinguishable commands in primary
  and execution-tree `.wld/settings.json`. Start Plan validation and confirm the execution-tree command runs. Make it
  fail, let the repair update the execution-tree command, and confirm RunWield reruns the corrected command before it
  reports Mechanical Validation passed.
- Expected: primary-checkout command output never appears during Plan validation; a changed execution-tree command is
  used on the next attempt; normal non-validation settings reads from a linked worktree still resolve to primary;
  QUICK_FIX validation behavior is unchanged.
- Existing tests that protect shell execution, cancellation, output capture, settings JSONC parsing, and normal
  linked-worktree settings must remain. No behavior is expected to stop existing except the incorrect use of the primary
  checkout's command for executable Plan validation.

## Edge Cases & Considerations

- The execution tree can equal the project root for non-Git and in-place Plans. Exact-tree mode must work without
  special casing and must not duplicate writes.
- A missing, empty, non-string, or malformed execution-tree command must fail closed or use the existing command prompt.
  It must never fall back to the primary command.
- If command entry is prompted during Plan validation, save it to the same execution-tree file that subsequent attempts
  reload.
- Open and read the settings file once per process attempt so command selection is internally consistent. Do not retain
  that snapshot, the parsed command, or a metadata-keyed result for a later retry.
- Preserve JSONC comments/trailing-comma acceptance on reads and the current normalized-write behavior on RunWield
  writes.
- Preserve file locking for RunWield writes. An Engineer can also edit the user-owned file directly; the next attempt
  must observe the completed write.
- A settings change can be part of the execution diff and publication. Do not copy it to or overwrite the primary
  checkout during validation.
- The execution worktree can move only through validated workflow state. Continue to use the phase's resolved
  `executionCwd`; do not trust a stale session or caller path.
- Assumption: “reload before running” means a fresh on-disk read before every command attempt, not a broad `/reload` of
  models, themes, Agents, and other session settings.
