---
classification: "PLANNED_CHANGE"
workKind: "BUG_FIX"
complexity: "MEDIUM"
summary: "Stop RunWield from writing its own state into execution worktrees, stop it from blocking merges on that state, and rebuild a missing worktree registry entry instead of offering only destructive recovery."
affectedPaths:
    - "src/shared/runwield-owned-paths.ts"
    - "src/shared/primary-checkout.ts"
    - "src/shared/settings.js"
    - "src/shared/worktree.js"
    - "src/shared/worktree-registry.js"
    - "src/shared/workflow/execution-context.ts"
    - "src/shared/workflow/execution-start.ts"
    - "src/shared/workflow/validation-merge-repair.ts"
    - "src/cmd/load-plan/plan-recovery-flow.ts"
    - "src/cmd/load-plan/plan-recovery-actions.ts"
    - "src/ui/tui/golden-scenarios/planned-change-workflow.js"
    - "src/shared/runwield-owned-paths.test.js"
    - "src/shared/primary-checkout.test.js"
    - "src/shared/settings.test.js"
    - "src/shared/worktree-runtime-state-isolation.test.js"
    - "src/shared/worktree-registry-restore.test.js"
    - "src/shared/worktree-merge.test.js"
    - "src/shared/worktree-merge-risk.test.js"
    - "docs/plan-lifecycle.md"
objectiveChecks:
    - id: "OC1"
      command: "deno eval 'import{isRunWieldOwnedRuntimePath as f}from\"./src/shared/runwield-owned-paths.ts\";const p=[\".wld/plan-locks/a.lock\",\".wld/plan-transitions/a.json\",\".wld/plan-backups/a.md\",\".wld/plan-staging/a.md\",\".wld/worktrees.json\",\".wld/worktrees.lock\",\".wld/worktree-registry-migration-issues.json\",\".wld/collaboration-secrets.json\",\".wld/debug/a.log\",\".wld/worktrees/x/y.txt\"],n=[\".wld/settings.json\",\".wld/agents/a.md\",\".wld/skills/s/SKILL.md\",\".wld/prompt-templates/p.md\",\".wld\",\".wldx/a\",\"src/shared/worktree.js\",\"docs/plans/a.md\"];Deno.exit(p.every(f)&&!n.some(f)?0:1)'"
      rationale: "Red today: src/shared/runwield-owned-paths.ts does not exist. Green requires a real enumerated predicate with the agreed semantics, including the negatives that make the decision meaningful: user-owned .wld customization (agents, skills, prompt-templates), .wld/settings.json, and the bare collapsed '.wld' entry are all NOT owned. A stub returning a constant fails one half or the other."
    - id: "OC2"
      command: "deno eval 'import{checkpointExecutionWorktree as C,mergeExecutionWorktree as M}from\"./src/shared/worktree.js\";const r=await Deno.makeTempDir(),w=r+\"-w\",W=Deno.writeTextFile,g=async(c,a)=>new TextDecoder().decode((await new Deno.Command(\"git\",{args:[\"-c\",\"user.email=t\",\"-c\",\"user.name=t\",...a],cwd:c}).output()).stdout);await g(r,[\"init\",\"-b\",\"main\"]);await W(r+\"/SRC\",\"b\");await g(r,[\"add\",\"-A\"]);await g(r,[\"commit\",\"-m\",\"b\"]);await g(r,[\"worktree\",\"add\",\"-b\",\"wt\",w,\"main\"]);await Deno.mkdir(w+\"/.wld/plan-transitions\",{recursive:!0});await W(w+\"/.wld/plan-transitions/o\",\"{}\");await W(w+\"/FEAT\",\"f\");await g(w,[\"add\",\"-A\"]);await g(w,[\"commit\",\"-m\",\"w\"]);await C({worktreePath:w,branch:\"wt\"});await Deno.mkdir(r+\"/.wld\",{recursive:!0});await W(r+\"/.wld/worktrees.json\",\"K\");await M({projectRoot:r,branch:\"wt\",targetBranch:\"main\",worktreePath:w});const k=await Deno.readTextFile(r+\"/.wld/worktrees.json\"),t=await g(r,[\"ls-files\"]);Deno.exit(k==\"K\"&&!t.includes(\".wld/\")&&t.includes(\"FEAT\")?0:1)'"
      rationale: "Reproduces the reported failure against the real checkpointExecutionWorktree and mergeExecutionWorktree. Red today: throws 'refusing to merge: .wld/'. The branch already has .wld/ committed, like the user's stuck branch, so green needs the migration path too. Four independent assertions, so a partial fix cannot pass: merge completes, primary .wld/worktrees.json is byte-identical, no .wld/ path reaches the merged tree, real work still lands."
    - id: "OC3"
      command: "deno eval 'import{inspectExecutionWorktreeMergeRisk as I}from\"./src/shared/worktree.js\";const r=await Deno.makeTempDir(),W=Deno.writeTextFile,g=async(a)=>new TextDecoder().decode((await new Deno.Command(\"git\",{args:[\"-c\",\"user.email=t\",\"-c\",\"user.name=t\",...a],cwd:r}).output()).stdout);await g([\"init\",\"-b\",\"main\"]);await W(r+\"/SRC\",\"b\");await g([\"add\",\"-A\"]);await g([\"commit\",\"-m\",\"b\"]);await g([\"checkout\",\"-b\",\"wt\"]);await Deno.mkdir(r+\"/.wld/plan-transitions\",{recursive:!0});await W(r+\"/.wld/plan-transitions/x\",\"{}\");await W(r+\"/.wld/settings.json\",\"{}\");await W(r+\"/SRC\",\"c\");await g([\"add\",\"-A\"]);await g([\"commit\",\"-m\",\"w\"]);await g([\"checkout\",\"main\"]);await Deno.mkdir(r+\"/.wld/plan-transitions\",{recursive:!0});await W(r+\"/.wld/plan-transitions/y\",\"{}\");await W(r+\"/.wld/worktrees.json\",\"{}\");await W(r+\"/SRC\",\"mine\");const s=JSON.stringify(await I({projectRoot:r,branch:\"wt\",targetBranch:\"main\"}));Deno.exit(!s.includes(\".wld\")&&s.includes(\"SRC\")?0:1)'"
      rationale: "Reproduces the reported trigger at the merge-decision layer: the branch adds .wld/settings.json while the primary checkout has only runtime files untracked, so no real collision exists. Red today, reporting the collapsed '.wld/' entry that blocked the user. Also covers the gap OC2 leaves: once RunWield stops committing .wld/, OC2 stops exercising this check, so the exemption could ship unwired. Also requires the genuinely dirty SRC to still be reported. Forces --untracked-files=all."
    - id: "OC4"
      command: "deno eval 'import{restoreEntryFromPlanEvidence as R,findById as F}from\"./src/shared/worktree-registry.js\";const r=await Deno.makeTempDir(),w=r+\"-w\",W=Deno.writeTextFile,g=async(c,a)=>new TextDecoder().decode((await new Deno.Command(\"git\",{args:[\"-c\",\"user.email=t\",\"-c\",\"user.name=t\",...a],cwd:c}).output()).stdout);await g(r,[\"init\",\"-b\",\"main\"]);await W(r+\"/R\",\"b\");await g(r,[\"add\",\"-A\"]);await g(r,[\"commit\",\"-m\",\"b\"]);await g(r,[\"worktree\",\"add\",\"-b\",\"wt\",w,\"main\"]);await Deno.mkdir(r+\"/.wld\",{recursive:!0});await W(r+\"/.wld/worktrees.json\",JSON.stringify({version:2,entries:[]}));const e={id:\"a1b2c3d4\",planName:\"p\",planId:\"pid\",path:w,branch:\"wt\",baseBranch:\"main\",status:\"completed\"},ok=await R(r,e),f=await F(r,\"a1b2c3d4\"),bad=await R(r,{...e,id:\"e5f6a7b8\",branch:\"nope\"});Deno.exit(ok?.restored===!0&&f?.branch==\"wt\"&&f?.path==w&&bad?.restored===!1?0:1)'"
      rationale: "Red today: restoreEntryFromPlanEvidence does not exist, so losing a registry entry has only destructive recovery. Green needs a real rebuild that both restores a verifiable entry, readable back through the existing findById with branch and path intact, and refuses evidence that disagrees with the attached git worktree. Always-restore fails the refusal case; always-refuse fails the restore case."
    - id: "OC5"
      command: "deno eval 'const t=await Deno.makeTempDir(),h=t+\"/h\";await Deno.mkdir(h);Deno.env.set(\"HOME\",h);const r=t+\"/r\",w=t+\"/w\";await Deno.mkdir(r);const g=(c,a)=>new Deno.Command(\"git\",{args:[\"-c\",\"user.email=t\",\"-c\",\"user.name=t\",...a],cwd:c}).output();await g(r,[\"init\",\"-b\",\"main\"]);await Deno.writeTextFile(r+\"/F\",\"x\");await g(r,[\"add\",\"-A\"]);await g(r,[\"commit\",\"-m\",\"b\"]);await g(r,[\"worktree\",\"add\",\"-b\",\"wt\",w,\"main\"]);const s=await import(\"./src/shared/settings.js\");await s.setCustomSetting(\"verification_command\",\"CMD\",\"project\",w);const p=await Deno.readTextFile(r+\"/.wld/settings.json\").catch(()=>\"\");let e=1;try{await Deno.stat(w+\"/.wld/settings.json\")}catch{e=0}Deno.exit(p.includes(\"CMD\")&&!e&&s.getCustomSetting(\"verification_command\",\"project\",w)===\"CMD\"?0:1)'"
      rationale: "Reproduces the confirmed root trigger against the real setCustomSetting. Red today: the setting lands in the linked worktree and the primary checkout gets nothing — both the merge collision and the reason the user is re-prompted every run. Green requires project scope to resolve to the primary checkout for write AND read; a write-only redirect fails the read-back assertion and would clobber real primary settings. Asserting no worktree file is what keeps it off the execution branch."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-11T00:50:32-0400"
updatedAt: "2026-08-11T13:34:13.350Z"
status: "ready_for_work"
origin: "internal"
userVerifiedAt: null
humanReviewMode: null
humanReviewDecision: null
worktreeStatus: "abandoned"
routingIntent: "PLANNED_CHANGE"
sessionName: "fix worktree merge block"
planId: "ea4f8a95-7e76-435f-90d2-d811f8450885"
---

# Never Block a Merge on RunWield's Own State

## Context

A finished Planned Change could not reach `main`. Publication reported:

> RunWield finished "tow-mvp-epic/01-convert-source-and-tests-to-typescript" but could not add it to your main branch,
> because your project folder has changes you have not saved to git yet — in the same files this work changes. `.wld/`
> Commit, stash, or delete these files, then pick Retry.

Retry could not succeed, and following the instruction made things worse: the second attempt reported
`registry entry 75a4c184 is missing` and offered only "Delete/recreate worktree and start over" or "Re-open for review".
Both throw finished, reviewed, validated work away.

Both failures are the same bug, seen twice: **RunWield writes its own files into the execution worktree, commits them
onto the execution branch, and then refuses the merge because of them.**

**Confirmed trigger: `.wld/settings.json`.** Workflow Validation calls `runLocalCI({ cwd })` with `cwd` set to the
execution worktree. `getOrAskForValidationCommand` (`src/shared/workflow/validation-local-ci.ts:36`) reads
`verification_command` from project settings; the worktree has no `.wld/settings.json`, so it prompts the user and saves
the answer with `setCustomSetting(…, "project", projectRoot)` at line 58. Project scope resolves through
`getSettingsDir` (`src/shared/settings.js:36`) to `join(projectRoot, ".wld")`, so the file is created **inside the
worktree**, where the primary checkout has never had one. `withLock` (`settings.js:186`) creates the file even when the
write is empty.

This is verified against the real code. Calling
`setCustomSetting("verification_command", "CMD", "project",
<linked worktree>)` today creates
`<worktree>/.wld/settings.json` and leaves the primary checkout with no settings file at all. It is a second defect in
its own right: the answer the user typed is saved to a directory that is deleted after the merge, so the next run asks
again.

This was already observed and worked around rather than fixed.
`src/ui/tui/golden-scenarios/planned-change-workflow.js:114` pre-commits `.wld/settings.json` into the fixture with the
comment that doing so "keeps Workflow Validation from writing project `.wld/settings.json` mid-run in both the primary
checkout and the execution worktree, which is what made Direct Delivery refuse the merge for overlapping uncommitted
changes."

**Why an untracked `.wld/` turns that into a block.** The merge pre-check `assertNoOverlappingDirtyPaths`
(`src/shared/worktree.js:775`) compares `git status --porcelain` in the primary checkout against
`git diff --name-only HEAD...branch`. When `.wld/` is untracked and not ignored, git collapses the whole directory into
a single `?? .wld/` entry. That one entry overlaps every `.wld/…` path the branch carries, including
`.wld/settings.json`, so the merge is refused even though no real file collides. Reading the same status with
`--untracked-files=all` expands it to `?? .wld/plan-locks/a.lock`, `?? .wld/worktrees.json`, and the overlap disappears.
A real `git merge` in that state succeeds and leaves `.wld/worktrees.json` untouched — verified.

**Runtime state makes it worse.** Every Plan write resolves its runtime directory through `getRunWieldRuntimeDir(cwd)`
(`src/constants.js:185`), which is `<cwd>/.wld`. During publication, `stageValidationPassedInExecutionWorktree`
(`src/shared/workflow/plan-lifecycle.js:1045`) writes the Plan **inside the execution worktree** —
`updatePlanFrontMatter(executionCwd, …)` and `recordPlanEvent({ cwd: executionCwd, … })`. That creates
`<worktree>/.wld/plan-locks/` and `<worktree>/.wld/plan-transitions/`. `checkpointExecutionWorktree` then calls
`commitDirtyWorktreeState`, which runs `git add -A -- .` (`src/shared/worktree.js:476`), so RunWield's own runtime files
become commits on the execution branch alongside the settings file.

The retry could never work. The session is live, so RunWield recreates `.wld/` the instant it is cleared.

**Second failure, same cause.** The worktree registry _is_ `.wld/worktrees.json`
(`src/shared/worktree-registry.js:131`). RunWield told the user to delete `.wld/`, so following that instruction deleted
RunWield's own record of the work. `findById` then returned nothing and `resolveExecutionContext`
(`src/shared/workflow/execution-context.ts:394`) blocked with `missing_registry_entry`, offering only destructive
options for work that was entirely intact on disk.

## Objective

Three invariants, all currently violated:

1. **RunWield never writes its own state into an execution worktree.** Project settings belong to the project, not to a
   temporary copy of it, so a setting saved during execution lands in the primary checkout and survives the worktree
   being deleted.
2. **RunWield runtime state never enters git and never blocks git.** Files RunWield owns as runtime bookkeeping are
   never committed from an execution worktree, never counted as user dirt, and never overwritten in the primary checkout
   by a merge.
3. **A missing registry entry is repaired, not mourned.** When the Plan metadata and the physical worktree still agree,
   RunWield rebuilds its own record mechanically and continues. The user is never asked to discard finished work because
   RunWield lost a file it owns.

The already-stuck branch must merge after this change without the user restarting the Planned Change.

## Approach

Fix the cause first — stop writing settings into the worktree — then make the git-facing checks correct, then make the
recovery non-destructive.

### 1. Project settings resolve to the primary checkout

`getSettingsDir(scope, projectRoot)` (`src/shared/settings.js:36`) is the single owner of the project settings path.
When `projectRoot` is a **linked worktree**, it resolves to the primary checkout instead. Then Workflow Validation saves
the validation command where the project keeps it, the worktree never gains a `.wld/settings.json`, and nothing about
settings can reach the execution branch.

Detection is filesystem-only and synchronous, because `getSettingsDir` is called from synchronous code paths. A linked
worktree has a `.git` **file** (not a directory) containing `gitdir: <primary>/.git/worktrees/<name>`; three `dirname`
steps give the primary checkout root. A normal checkout has a `.git` directory and a subdirectory of one has no `.git`
at all, so neither is ever redirected — this must not relocate settings for someone running RunWield from a
subdirectory. Both facts are verified against real repositories.

Read and write must redirect **together**. `withLock` reads the current content, hands it to a callback, and writes the
result. Redirecting only the write would compute new content from an absent worktree file and overwrite the primary
checkout's real settings with it.

### 2. One owner for "is this path RunWield runtime state?"

Introduce that owner, then route every git-facing judgement through it.

Ownership is **enumerated**, not the whole `.wld/` directory. This is the load-bearing constraint: `.wld/` also holds
content the user owns and legitimately tracks in git — `.wld/agents/` (`src/shared/session/agents.js:52`),
`.wld/skills/` (`src/shared/session/session.js:387`), `.wld/prompt-templates/`, and `.wld/settings.json` itself (this
repository tracks it today). Exempting `.wld/` wholesale would make a Plan that adds a project agent or skill silently
undeliverable. The owned set is exactly:

```
.wld/plan-locks/
.wld/plan-transitions/
.wld/plan-backups/
.wld/plan-staging/
.wld/worktrees/
.wld/debug/
.wld/worktrees.json
.wld/worktrees.lock
.wld/worktree-registry-migration-issues.json
.wld/collaboration-secrets.json
```

`.wld/collaboration-secrets.json` (`src/shared/collaboration/secrets.js:9`) and `.wld/worktrees/` (the fallback worktree
parent, `src/shared/worktree.js:561`) are included as an assumption: a secret store must never be committed, and a
nested worktree tree must never be staged. Both are already in this repository's `.gitignore`.

**Untracked directories must be expanded.** This is load-bearing, not an optimisation. Git collapses a fully untracked
directory to a single `?? .wld/` entry, and an enumerated rule cannot classify that. Every status read that feeds a
merge judgement must use `git status --porcelain --untracked-files=all` so each file is named individually. Without this
the enumerated decision is unimplementable.

**Pre-fix branches must be repaired, not restarted.** Branches created before this change already carry committed
`.wld/` runtime files — including the user's stuck branch. The checkpoint therefore also un-tracks owned paths that are
already in the index, so the merge cannot deliver them. Un-tracking is limited to paths absent from the merge target's
tree, so a project that intentionally tracks something under `.wld/` never has it deleted by a merge. It is also limited
to the **enumerated owned set**: a Plan whose actual deliverable is a new `.wld/agents/…` file must still deliver it.

The stuck branch's committed `.wld/settings.json` is _not_ in the owned set and is therefore not un-tracked. It does not
need to be: with per-file status the primary checkout has no `.wld/settings.json` to collide with, so the merge proceeds
and that file lands on `main`. See Edge Cases.

### 3. Registry rebuild

The registry is RunWield-owned protected state, so the repair is mechanical, typed, and transactional — never an agent
editing metadata. `resolveExecutionContext` attempts the rebuild before blocking. If the evidence does not agree, a new
non-destructive recovery action appears instead of only the destructive pair.

**Ignore rules.** Per the planning decision, RunWield appends the owned paths to the project's `.gitignore` inside a
managed block. This is defence in depth; the pathspec exclusion at commit time is what actually guarantees correctness,
so the fix holds in a project whose `.gitignore` is missing, read-only, or stale.

## Files to Modify

- `src/shared/primary-checkout.ts` — **new.** Exports `resolvePrimaryCheckoutRoot(root)`: returns the primary checkout
  root when `root` is a linked worktree, and `root` unchanged otherwise. Synchronous and filesystem-only. It is its own
  module rather than living in `src/shared/git.js` because `git.js` already imports `settings.js`, and putting the
  resolver there would create an import cycle.
- `src/shared/settings.js` — `getSettingsDir("project", projectRoot)` resolves through `resolvePrimaryCheckoutRoot`,
  memoised per input root so the filesystem probe runs once. Update the `RunWieldSettingsStorage` doc comment at line
  51, which currently states project scope uses `<cwd>/.wld`. `__resetSettingsForTests` clears the memo.
- `src/shared/runwield-owned-paths.ts` — **new.** Sole owner of the owned-path question. Exports the canonical path
  list, the predicate, the git pathspec exclusions, and the `.gitignore` block text. Composed from the existing
  `src/constants.js` names rather than re-typed literals, so the list cannot drift from the directories the code
  actually writes.
- `src/shared/worktree.js` — `commitDirtyWorktreeState` excludes owned paths from staging and un-tracks any already in
  the index; `checkpointExecutionWorktree`'s post-commit dirty assertion ignores owned paths;
  `assertPreMergeCandidateUnchanged` ignores owned paths in both the committed diff and the dirty status;
  `assertNoOverlappingDirtyPaths` and `inspectExecutionWorktreeMergeRisk` never treat an owned path as blocking;
  `parseStatusPaths` callers on merge paths read with `--untracked-files=all`.
- `src/shared/worktree-registry.js` — new `restoreEntryFromPlanEvidence`, taken under `withWorktreeRegistryLock`,
  subject to the existing `assertNoDuplicateNonterminalAttempt` guard.
- `src/shared/workflow/execution-context.ts` — attempt the rebuild before returning `missing_registry_entry`; surface
  the rebuild through the existing `selfHealNotices` channel; point the remaining blocked message at the new
  non-destructive action first.
- `src/shared/workflow/execution-start.ts` — ensure the managed `.gitignore` block when an execution worktree is
  created.
- `src/shared/workflow/validation-merge-repair.ts` — the `primary_checkout_dirty` pause text no longer suggests deleting
  files, and names only paths the user actually owns.
- `src/cmd/load-plan/plan-recovery-flow.ts` — offer "Restore worktree record and continue" when the Plan records a
  worktree but the registry has no entry.
- `src/cmd/load-plan/plan-recovery-actions.ts` — implement that action over the same mechanical rebuild.
- `src/ui/tui/golden-scenarios/planned-change-workflow.js` — remove the `committedProjectFiles` workaround at lines
  114–121 that masks this bug, and let the scenario exercise the real validation-command prompt.
- `docs/plan-lifecycle.md` — document the recovery action alongside the existing ones at line 406.

Tests: `src/shared/primary-checkout.test.js` (new), `src/shared/runwield-owned-paths.test.js` (new),
`src/shared/worktree-runtime-state-isolation.test.js` (new), `src/shared/worktree-registry-restore.test.js` (new), and
updates to `src/shared/settings.test.js`, `src/shared/worktree-merge.test.js`, and
`src/shared/worktree-merge-risk.test.js`.

No domain-language change. `docs/domain-language.md` defines no worktree, registry, or checkout vocabulary, so this Plan
introduces no glossary term and must not add one.

## Reuse Opportunities

- `src/constants.js` — `RUNWIELD_DIR_NAME`, `PLAN_LOCKS_DIR_NAME`, `PLAN_TRANSITIONS_DIR_NAME`, `PLAN_BACKUPS_DIR_NAME`,
  `PLAN_STAGING_DIR_NAME`, `WORKTREE_REGISTRY_FILE`, `WORKTREE_REGISTRY_LOCK_FILE` already name most of the owned set.
  Compose the list from them.
- `src/shared/collaboration/secrets.js:9` — `PROJECT_SECRET_STORE_RELATIVE_PATH` already holds
  `.wld/collaboration-secrets.json`.
- `src/shared/worktree.js:192` — `isAllowedDirtyPath` already does prefix matching. Reuse it rather than writing a
  second matcher.
- `src/shared/worktree-registry.js` — `withWorktreeRegistryLock`, `addEntry`, `assertNoDuplicateNonterminalAttempt`, and
  the atomic `writeRegistry` give the rebuild its transaction and its duplicate-attempt guard for free.
- `src/shared/git-test-fixture.ts` — `defineGitFixture` builds the real repositories the new tests need. Do not add an
  injection seam; the zero-seam baseline in `CLAUDE.md` applies.
- `src/shared/work-records/index-adapter.js:24` — already resolves a repository root with
  `git rev-parse --path-format=absolute --git-common-dir`. It is the async cross-check for `resolvePrimaryCheckoutRoot`
  in tests; the runtime path stays synchronous and filesystem-only.
- `src/shared/settings.js:253` — `__resetSettingsForTests` is the established place to clear per-root caches.
- `src/shared/workflow/execution-context.ts:370` — the existing `selfHealNotices` array is the established channel for
  "RunWield reconciled its own bookkeeping"; reuse it for the rebuild notice.

## Implementation Steps

- [ ] `src/shared/primary-checkout.ts` exports a synchronous `resolvePrimaryCheckoutRoot(root)` that returns the primary
      checkout root for a linked worktree, and returns `root` unchanged for a normal checkout, for a subdirectory of a
      normal checkout, for a non-git directory, and for a `.git` file whose computed root does not itself contain a
      `.git`. It spawns no subprocess.
- [ ] `getSettingsDir("project", root)` in `src/shared/settings.js` returns `<primary checkout>/.wld` when `root` is a
      linked worktree and `<root>/.wld` otherwise, memoised per input root, with the memo cleared by
      `__resetSettingsForTests`. `getSettingsDir("global", …)` is unchanged. The doc comment at line 51 states the new
      project-scope rule.
- [ ] `setCustomSetting("verification_command", …, "project", <linked worktree>)` writes `<primary>/.wld/settings.json`
      and creates no `.wld/settings.json` in the worktree, and a following
      `getCustomSetting(…, "project", <linked worktree>)` returns that value. Writing a project setting from a worktree
      when the primary checkout already has settings preserves the primary's other keys.
- [ ] `src/shared/runwield-owned-paths.ts` exists and exports `RUNWIELD_OWNED_RUNTIME_PATHS`,
      `isRunWieldOwnedRuntimePath`, `runwieldOwnedPathspecExclusions`, and `RUNWIELD_GITIGNORE_BLOCK`. The predicate
      returns `true` for all ten owned paths and their descendants, and `false` for `.wld/settings.json`,
      `.wld/agents/…`, `.wld/skills/…`, `.wld/prompt-templates/…`, the bare string `.wld`, `.wldx/…`, and any path
      outside `.wld/`. The path list is derived from the `src/constants.js` and `secrets.js` exports named in Reuse
      Opportunities, not re-typed as literals.
- [ ] `commitDirtyWorktreeState` in `src/shared/worktree.js` stages with the owned-path pathspec exclusions applied in
      both the allow-list and the `add -A -- .` branch, and runs `git rm -r --cached --ignore-unmatch` for owned paths
      that are tracked on the branch but absent from the merge target's tree. A worktree containing
      `.wld/plan-transitions/x.json` produces a commit whose tree contains no `.wld/` runtime path, whether that file
      was untracked or already committed by an earlier run. A worktree containing `.wld/agents/a.md` or
      `.wld/settings.json` still commits and delivers those files: un-tracking applies only to the enumerated owned set.
- [ ] `checkpointExecutionWorktree` completes without throwing when the only remaining dirty paths are RunWield-owned,
      and still throws when any non-owned path is dirty after the checkpoint commit.
- [ ] `assertPreMergeCandidateUnchanged` ignores owned paths in both the `sealedExecutionCommit..HEAD` diff and the
      dirty status, and still rejects a non-owned file changed after sealing.
- [ ] `assertNoOverlappingDirtyPaths` and `inspectExecutionWorktreeMergeRisk` read status with `--untracked-files=all`
      and report zero blocking paths and zero warnings for a primary checkout whose only untracked content is
      RunWield-owned. A primary checkout with an uncommitted edit to a real source file that the branch also changes is
      still blocked, with that file named.
- [ ] `src/shared/worktree-registry.js` exports `restoreEntryFromPlanEvidence(projectRoot, evidence)` returning
      `{ restored: boolean, reason?: string, entry?: WorktreeRegistryEntry }`. It runs under `withWorktreeRegistryLock`,
      writes through the existing atomic `writeRegistry`, and restores only when `git worktree list --porcelain` shows
      `evidence.path` attached to `evidence.branch`, the branch and base branch both exist, and
      `assertNoDuplicateNonterminalAttempt` permits the entry. It returns `{ restored: false }` with a reason otherwise,
      and never overwrites an entry that already exists.
- [ ] `resolveExecutionContext` in `src/shared/workflow/execution-context.ts` calls `restoreEntryFromPlanEvidence`
      before returning `missing_registry_entry`, continues with the restored entry on success, and pushes a notice onto
      `selfHealNotices` saying the worktree record was rebuilt. It returns `missing_registry_entry` only when the
      restore refuses, and that message names "Restore worktree record and continue" before any destructive option.
- [ ] `src/cmd/load-plan/plan-recovery-flow.ts` offers a `restore_record` menu option labelled "Restore worktree record
      and continue" whenever the Plan records worktree metadata and the registry has no matching entry, and
      `src/cmd/load-plan/plan-recovery-actions.ts` implements it over `restoreEntryFromPlanEvidence`, reporting which
      id, path, branch and target branch it reconstructed. Neither the reset nor the abandon option is removed.
- [ ] `src/shared/workflow/execution-start.ts` writes a managed `.gitignore` block into the primary checkout when an
      execution worktree is created. The block is delimited by stable start and end marker comments, is rewritten in
      place when the owned list changes, is not duplicated on repeat runs, leaves all other lines byte-identical, and is
      skipped when the file cannot be written. Failure to write it never fails worktree creation.
- [ ] `src/shared/workflow/validation-merge-repair.ts` produces `primary_checkout_dirty` pause text that lists only
      non-owned paths and does not tell the user to delete files.
- [ ] `src/shared/runwield-owned-paths.test.js` covers the predicate's positive and negative sets against the real
      module, including `.wld/settings.json`, `.wld/agents/…`, `.wld/skills/…`, and the bare `.wld` string.
- [ ] `src/shared/primary-checkout.test.js` uses `defineGitFixture` to prove the redirect fires for a real linked
      worktree and does not fire for the primary checkout, a subdirectory of it, or a non-git directory.
- [ ] `src/shared/settings.test.js` proves a project setting written from a linked worktree lands in the primary
      checkout, is readable back through the worktree root, leaves no `.wld/settings.json` in the worktree, and
      preserves the primary's pre-existing keys.
- [ ] `src/shared/worktree-runtime-state-isolation.test.js` uses `defineGitFixture` to prove, against the real
      `checkpointExecutionWorktree` and `mergeExecutionWorktree`: a worktree carrying `.wld/plan-transitions/…` merges
      into a primary checkout whose `.wld/` is untracked; the primary `.wld/worktrees.json` is byte-identical
      afterwards; the merged tree contains no `.wld/` runtime path; the Plan's real files land; and the same holds when
      the branch had already committed `.wld/` before the checkpoint.
- [ ] `src/shared/worktree-registry-restore.test.js` proves the restore rebuilds an entry deleted from a live worktree,
      refuses when the recorded branch does not match the attached worktree, refuses when the worktree path is gone, and
      refuses when a live entry for the same `planId` already exists.
- [ ] `src/ui/tui/golden-scenarios/planned-change-workflow.js` no longer pre-commits `.wld/settings.json` through
      `committedProjectFiles`, its script answers the validation-command prompt instead, and `deno task test:golden-tui`
      passes. The scenario's own workaround comment at lines 114–118 is what identified this bug; removing it is what
      proves the bug is gone at the integration level. Re-record the golden transcript if the added prompt changes it,
      and confirm the re-recorded output shows the merge completing.
- [ ] `docs/plan-lifecycle.md` documents "Restore worktree record and continue" beside the existing recovery actions at
      line 406.

## Verification Plan

**Automated**

- `deno task ci` — the full gate, including `deno check`, `deno task seams:check`, and the suite. The new tests must not
  introduce an injection seam; use `defineGitFixture` and real temp repositories.
- `deno task test:golden-tui` — the integration proof, once the `planned-change-workflow` workaround is removed.
- `deno run -A scripts/run-tests.js src/shared/primary-checkout.test.js src/shared/settings.test.js`
- `deno run -A scripts/run-tests.js src/shared/runwield-owned-paths.test.js`
- `deno run -A scripts/run-tests.js src/shared/worktree-runtime-state-isolation.test.js`
- `deno run -A scripts/run-tests.js src/shared/worktree-registry-restore.test.js`
- `deno run -A scripts/run-tests.js src/shared/worktree-merge.test.js src/shared/worktree-merge-risk.test.js
  src/shared/worktree-plan-handoff.test.js src/shared/workflow/validation-publication-pause.test.js`

Never run `deno test` directly — see `CLAUDE.md`.

**Existing coverage: what must survive, what must change**

- `src/shared/worktree-merge.test.js:732` — "mergeExecutionWorktree includes uncommitted worktree changes". Its subject
  is that uncommitted _work_ reaches the merge. That assertion must still hold: `README.md` and `feature.txt` must
  arrive with their content. Its `allowedDirtyPaths: [".wld/"]` argument becomes redundant once ownership is intrinsic;
  removing the argument is correct, deleting the test is not.
- `src/shared/worktree-merge-risk.test.js` — must keep proving that genuine user dirt overlapping the branch still
  blocks, and that the blocking path is named. This is the behavior that protects the user's unsaved work and it must
  not be weakened; only RunWield-owned paths become non-blocking.
- `src/shared/worktree-registry.test.js` — the duplicate-attempt and migration guards must keep failing the same way.
  The restore path adds a caller; it must not relax those guards.
- `src/shared/settings.test.js` — global-scope behavior, the Pi migration, and `preserveRunWieldCustomSettingsForWrite`
  are untouched by this change and must keep passing unmodified. Only project-scope path resolution changes.
- `src/ui/tui/testing/scenario-runner.js:521` and `src/ui/tui/golden-scenarios/*` — other scenarios also pre-commit
  `.wld/settings.json`. Only `planned-change-workflow.js` is required to drop it. Leaving the others is fine; they now
  pass for an honest reason rather than because the workaround hides the defect.
- **Expected to stop existing:** any assertion that `.wld/` runtime paths appear in an execution branch commit, and any
  assertion that a RunWield-owned path produces `primary_checkout_dirty`. If such an assertion is found, invert it to
  assert the new behavior. Do not delete it.

**Manual**

1. In the `tow-mvp-epic/01-convert-source-and-tests-to-typescript` project, run
   `/load-plan tow-mvp-epic/01-convert-source-and-tests-to-typescript`. Expect the recovery report to load without a
   `missing_registry_entry` block, or to offer "Restore worktree record and continue".
2. Choose "Retry Workflow Validation" or "Merge validated worktree changes". Expect the merge to complete and the Plan
   to reach `verified`. Expect no prompt to commit, stash, or delete `.wld/`.
3. Confirm `.wld/worktrees.json` in that project still lists the other attempts, and that `git log -1 --stat main` shows
   no `.wld/` **runtime** paths in the merge. `.wld/settings.json` is expected to appear once, from the pre-fix commit
   on that branch.
4. Run the next child Planned Change to completion. When Workflow Validation asks for a validation command, answer it,
   then confirm the answer was saved to the **primary checkout's** `.wld/settings.json` and that the execution worktree
   has none. Confirm the run after that does not ask again.
5. Make a real uncommitted edit to a source file the branch also changes, then attempt a merge. Expect the block to
   still happen and to name that source file — the protection for the user's own work is intact.
6. Create a Plan whose deliverable is a new `.wld/agents/<name>.md` or `.wld/skills/<name>/SKILL.md`, run it, and
   confirm the file reaches `main`. User-owned `.wld` content must still be deliverable.

## Edge Cases & Considerations

- **The stuck branch will deliver `.wld/settings.json` to `main`.** That branch already committed the file, and it is
  user-owned content, so nothing un-tracks it. With per-file status the primary checkout has no `.wld/settings.json` to
  collide with, so the merge succeeds and the file lands — carrying the validation command the user typed. This is
  harmless and reversible, and it is strictly better than the current state, where the work cannot merge at all. Expect
  it, and delete the file afterwards if that project does not want it tracked. New runs will not repeat it, because the
  setting now goes to the primary checkout.
- **A project that commits `.wld/settings.json` now reads the primary checkout's copy during execution.** If a branch
  changes that file, the running agent's session sees the primary's value, not the branch's. The branch's change still
  merges normally. This is the correct trade: a project setting describes the project, and the alternative — reading the
  worktree while writing the primary — risks overwriting real settings with content computed from an absent file.
- **Redirection must not fire for a subdirectory.** Running RunWield from a subdirectory of a normal checkout must keep
  using that directory's `.wld`. The `.git`-file test gives this for free: a subdirectory has no `.git` entry at all, so
  it is never redirected. A repository with a separate git directory is the one shape where the three `dirname` steps
  can miss; return the input unchanged when the computed root has no `.git`.
- **The `.gitignore` write is a visible change to a versioned file.** Chosen deliberately so a team shares the rule. It
  also makes the primary checkout dirty at execution start, which could itself block a merge if the Plan's branch also
  edits `.gitignore`. Mitigation: the pathspec exclusion at commit time is the real guarantee, so a project that reverts
  the `.gitignore` block still merges correctly.
- **`--untracked-files=all` cost.** In a repository whose ignore rules do not cover `node_modules` or build output, this
  walks many files. It is confined to the merge-decision reads, which run once per publication, not to any hot path.
- **Un-tracking must not delete real files.** `git rm -r --cached` on a path the merge target actually tracks would land
  as a deletion. Restricting it to paths absent from the target tree is what prevents this, and a project that
  deliberately tracks something under `.wld/` must keep it after a merge.
- **Registry restore must stay mechanical.** Per the established lifecycle invariant, no agent may repair worktree or
  Plan bookkeeping. The rebuild belongs in `worktree-registry.js` under the registry lock, and the recovery action calls
  it rather than reimplementing it.
- **Restore must refuse rather than guess.** If the recorded branch, path, or base disagrees with what git shows,
  rebuilding would attach the Plan to the wrong tree — a worse outcome than blocking. The refusal path keeps the menu
  action available, so the user still has a non-destructive route.
- **Assumption:** `.wld/collaboration-secrets.json` and `.wld/worktrees/` belong in the owned set even though they were
  not named in the planning decision. Both are RunWield-written, both are already in this repository's `.gitignore`, and
  committing a secret store would be a defect in its own right.
- **Assumption:** Plan-lifecycle runtime writes stay in the execution worktree. `resolvePrimaryCheckoutRoot` makes
  redirecting them mechanically possible, and it is tempting to apply it to `getRunWieldRuntimeDir` too, but
  `.wld/plan-locks/` is what serialises concurrent attempts, and moving it changes locking semantics for parallel
  worktrees. Out of scope here: exclusion at commit time already keeps that state out of git. Revisit separately.
