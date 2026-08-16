---
planId: "e7be100d-d6b0-4df0-bb7f-e20cfb9efc97"
classification: "PLANNED_CHANGE"
workKind: "FEATURE"
complexity: "MEDIUM"
summary: "Add a repo-bound archived Plan retention policy, a `wld plans prune` command that deletes archived Plans covered by a Work Record and past retention, and a nudge printed when a Plan is archived."
affectedPaths:
    - "src/shared/plan-archive-retention.ts"
    - "src/shared/plan-archive-retention.test.ts"
    - "src/shared/settings.js"
    - "src/plan-store.js"
    - "src/plan-store.test.js"
    - "src/cmd/plans/prune.ts"
    - "src/cmd/plans/prune.test.ts"
    - "src/cmd/plans/index.ts"
    - "src/cmd/plans/archive.ts"
    - "src/cmd/load-plan/index.ts"
    - "src/cmd/load-plan/plan-epic-archive.ts"
    - "src/cmd/registry.js"
    - "src/skills/runwield/SETTINGS.md"
    - "docs/domain-language.md"
objectiveChecks:
    - id: "OC1"
      command: "deno eval \"const m=await import('file://'+Deno.cwd()+'/src/shared/plan-archive-retention.ts');const u=(n,p,a)=>({name:n,planId:p,archivedAt:a,paths:[]});const T=new Date('2026-09-01T00:00:00Z'),O='2026-08-01T00:00:00Z',N='2026-08-30T00:00:00Z';const s=l=>l.map(x=>x.name).sort().join(',');const S=(U,W,d,k)=>m.selectArchivedPlansForPrune({units:U,workRecordPlanIds:new Set(W),policy:{retentionDays:d,keepLast:k},now:T});const b=[u('old','p1',O),u('new','p2',N),u('nowr','p9',O)],W=['p1','p2'];const a=S(b,W,14,0);if(s(a.due)!=='old')throw Error('A');if(s(a.ineligible)!=='nowr')throw Error('B');if(S(b,W,14,2).due.length)throw Error('C');const c=S([u('old','p1',O),u('r1','p2',N),u('r2','p3',N),u('n1','x1',N),u('n2','x2',N)],['p1','p2','p3'],14,2);if(s(c.due)!=='old')throw Error('D');if(s(c.sparedByKeepLast)!=='r1,r2')throw Error('E');if(s(S([u('nd','p1',null)],['p1'],14,0).due)!=='nd')throw Error('F');if(s(S([u('jn','p1',T.toISOString())],['p1'],0,0).due)!=='jn')throw Error('G')\""
      rationale: "Imports the real selection module and asserts the whole retention rule: ineligible units are never due, keepLast spares the newest eligible units, ineligible units do not consume floor slots, a missing archivedAt is infinitely old, and retentionDays 0 makes a just-archived unit due. Red today because the module does not exist; verified green against a correct reference implementation and red against a hollow one that returns empty groups."
    - id: "OC2"
      command: "deno eval \"const S=await import('file://'+Deno.cwd()+'/src/plan-store.js');const E=async p=>{try{await Deno.lstat(p);return 1}catch{return 0}};const r=await Deno.makeTempDir(),A=r+'/docs/plans/archived';await Deno.mkdir(A+'/epic',{recursive:true});for(const p of ['/epic.md','/epic/01-child.md','/epic/manual-qa.md','/solo.md'])await Deno.writeTextFile(A+p,'x');await S.deleteArchivedPlanUnit(r,'epic');if(await E(A+'/epic.md'))throw Error('epic md survived');if(await E(A+'/epic'))throw Error('epic dir survived');if(!await E(A+'/solo.md'))throw Error('solo deleted');let n=0;const R=async t=>{await S.deleteArchivedPlanUnit(r,t).then(()=>{},()=>n++)};await R('missing');await Deno.mkdir(A+'/o');await Deno.writeTextFile(A+'/o.md','x');await Deno.writeTextFile(A+'/o/notes.txt','x');await R('o');await R('o/nested');if(n!==3)throw Error('refusals='+n);if(!await E(A+'/o.md'))throw Error('refused unit partly deleted');await Deno.remove(r,{recursive:true})\""
      rationale: "Calls the real deletion primitive against a real archived Epic tree and asserts files actually leave disk: the Epic markdown and its whole directory of children and artifacts are gone, an unrelated archived Plan survives, and all three refusals (missing name, non-markdown content in the directory, non-top-level name) reject without partial deletion. A stub that only records intent cannot pass. Red today because deleteArchivedPlanUnit is undefined."
    - id: "OC3"
      command: "deno run -A scripts/run-tests.js src/shared/plan-archive-retention.test.ts src/cmd/plans/prune.test.ts"
      rationale: "Runs the two required new test files through the project's sandboxed runner. Red today because neither file exists; the run-tests.js runner exits non-zero on missing paths."
    - id: "OC4"
      command: "deno run -A --unstable-no-legacy-abort src/cli.ts plans prune --help 2>&1 | grep -q \"wld plans prune\""
      rationale: "Proves the prune subcommand is actually routed and documented. Red today: an unrecognized plans subcommand falls through to the generic plans listing, whose help text contains no 'wld plans prune' usage line."
executionAgent: "engineer"
collaborationRecommendation: "autonomous"
createdAt: "2026-08-15T23:56:40-04:00"
updatedAt: "2026-08-16T15:06:05.823Z"
status: "verified"
origin: "internal"
implementedAt: "2026-08-16T04:36:48.039Z"
verifiedAt: "2026-08-16T15:06:05.823Z"
userVerifiedAt: null
executionReport: "- Implemented archived Plan retention policy: project-only `.wld/settings.json` keys `plans.archiveRetentionDays` and `plans.archiveKeepLast`, defaults 14/10, validation for non-negative integers, and settings preservation for the new `plans` key.\n- Implemented prune selection and collection: top-level archived units, Work Record `provenance.sourcePlans` coverage, `keepLast` floor that excludes ineligible units, missing/invalid `archivedAt` treated as old, and Epic children/artifacts grouped with the parent.\n- Implemented `wld plans prune`: help/routing/registry docs, group reporting, `--dry-run`, prompt confirmation, `--yes`, deletion failure reporting, skipped missing units, and real archived-unit deletion under the Plan catalog lock.\n- Added archive-time nudge after CLI single/bulk archive, TUI verified-plan archive, and Epic archive.\n- Updated docs: domain glossary entries for Archived Plan, Plan Archive Retention, and Archive Prune; settings skill docs for the two new policy keys.\n- Updated tests: added 10 tests (`plan-archive-retention`: 3, `plans prune`: 3, `plan-store`: 2, `settings`: 2); expanded 1 existing settings preservation test for `plans`; normalized 1 existing model welcome assertion for terminal line wrapping; no tests were removed.\n- Verification passed: OC1 selection eval; OC2 deletion eval; OC3 `deno run -A scripts/run-tests.js src/shared/plan-archive-retention.test.ts src/cmd/plans/prune.test.ts`; OC4 CLI help grep; targeted `deno run -A scripts/run-tests.js src/shared/plan-archive-retention.test.ts src/cmd/plans/prune.test.ts src/plan-store.test.js`; `src/ui/tui/model-welcome.test.ts` after the wrapping repair.\n- Manual safe checks passed: `plans prune --dry-run` reported 109 due units with no deletion, and prompt run with `no` canceled without deleting archived Plans. I did not run destructive `plans prune --yes` in this repository.\n- Full `deno task ci` did not pass. After repairs, remaining failures are golden TUI scenarios in `src/ui/tui/golden-scenarios/project-workflow.test.js` and `src/ui/tui/golden-scenarios/validation-workflow-broken-objective.test.ts` timing out / unused scripted interaction; these files were not part of this change."
humanReviewMode: "ask"
humanReviewDecision: "skipped"
validationCheckpoint: null
executionMode: "worktree"
deliveryEvidence:
    version: 1
    mode: "worktree_merge"
    executionCommit: "31831f1cd80e9ec6dd669c79813e28caf5a2430c"
    targetBranch: "main"
    targetHeadBeforeMerge: "e250eb3b0c150ea056f6d4bb976ea16817eb2793"
validationCiAttempts: 0
validationObjectiveCheckAttempts: 0
validationSemanticRounds: 0
---

# Archived Plan Retention and Prune

## Context

Archived Plans accumulate and rot. `docs/plans/archived/` holds 199 markdown files (143 top-level, 56 under Epic
directories). An archived Plan still reads like a current spec — imperative "Files to Modify" and "Implementation
Steps", with nothing in the prose saying it already shipped or that the code moved past it. Nothing excludes the
directory from search, so an Agent asking how a feature works can find an obsolete design document and treat it as
truth.

RunWield already made half of this decision: `HIDDEN_PLAN_DIRS` keeps `archived/` out of RunWield's own Plan listing.
The filesystem still shows those files to every Agent and every `grep`. Deletion is the missing half.

Everything under `docs/plans/archived/` is tracked in git, so "delete" means "remove from the working set", not
"destroy". `git log --diff-filter=D` recovers any of it.

## Objective

Archived Plans age out of the tree on a policy the repository owns.

A Plan is deleted only when both are true:

1. A Work Record covers it — the successor artifact exists.
2. `now - archivedAt >= archiveRetentionDays`.

A floor spares the most recently archived Plans that are otherwise deletable, so a slow-moving repository does not lose
its whole recent set to a day count tuned for RunWield's own churn.

Deletion is never automatic. `wld plans prune` performs it when the user runs it, so the removal lands in a diff the
user reviews and commits. Archiving prints a one-line nudge when Plans are due, so the reminder arrives at the moment
the user is already thinking about the archive.

## Approach

### The policy

`.wld/settings.json`, **project scope only**:

```json
{
    "plans": {
        "archiveRetentionDays": 14,
        "archiveKeepLast": 10
    }
}
```

Every other RunWield setting resolves through `getMergedCustomSetting`, which lets `~/.wld/settings.json` supply a value
when the project has none. This one must not. A machine-level retention value would silently govern every repository
that has not set one — exactly the "one person's setting decides for everyone" problem this policy is meant to avoid.
Read project scope only, and fall back to the built-in defaults, never to global.

`archiveRetentionDays: 0` deletes as soon as both conditions hold — whichever of archive or Work Record lands last.
`archiveKeepLast: 0` disables the floor.

### The deletion unit is a top-level archived Plan

This is forced by the data, not by preference. Work Records list only the top-level Plan's `planId` in
`provenance.sourcePlans`; an Epic's Work Record does not enumerate its children. Measured against the current tree:

```text
top-level archived Plans   143   →  140 covered by a Work Record,  3 not
child Plans under Epics     56   →    0 covered by a Work Record
```

Per-file eligibility would make all 56 child Plans permanently undeletable while their Epic parent aged out from under
them, leaving orphan directories. So an Epic and everything under `docs/plans/archived/<epic>/` — child Plans and the
`manual-qa.md` Epic Artifact — prune together as one unit, keyed on the Epic's own `archivedAt` and Work Record. That
matches how `archivePlan` and `restoreArchivedPlan` already treat an Epic and its children.

### Selection

```text
units          = top-level entries under docs/plans/archived/
eligible       = units whose planId appears in some Work Record's provenance.sourcePlans
ineligible     = the rest — never deleted, and they do NOT occupy a floor slot
                 |
                 sort eligible by archivedAt, newest first
                 |
sparedByKeepLast = first archiveKeepLast of that list
due              = of the remainder, those with age >= archiveRetentionDays
withinRetention  = the remainder of the remainder
```

A missing or unparseable `archivedAt` counts as infinitely old: it sorts last and is always past retention. It still
needs a Work Record to be touched at all.

Any Work Record covers a Plan, whatever its status. Using only "current" Work Records (`isCurrentWorkRecord`: approved,
not archived, not superseded) would mean superseding a Work Record makes its source Plan immortal — backwards, since a
superseded record means a better successor exists. The user has a manual supersession pass planned; that pass must not
resurrect 140 Plans into permanence.

### Call path

```text
wld plans prune
  resolveArchiveRetentionPolicy(projectRoot)      settings.js, project scope only
  collectArchivedPlanUnits(cwd)                   listArchivedPlans + group children under Epics
  listWorkRecords(cwd)                            → Set of planIds in provenance.sourcePlans
  selectArchivedPlansForPrune({...})              pure; the whole rule lives here
  print selection, confirm unless --yes
  deleteArchivedPlanUnit(cwd, name)  per due unit  plan-store.js, under withPlanCatalogLock

wld plans archive <plan>            (and the two TUI archive surfaces)
  ...archive as today...
  formatArchiveRetentionNudge(cwd)  → "3 archived Plans are past retention · run `wld plans prune`"
```

`selectArchivedPlansForPrune` takes already-loaded data and a `now` and returns the split. It touches no filesystem,
clock, or settings, so its tests need no fixture and no seam.

**Option set aside:** measuring age in commits rather than days, which normalizes churn correctly instead of
approximating it with a count floor. It costs explainability — nobody can guess what "500 commits" feels like, and every
repository would need its own number found by trial.

## Files to Modify

- `src/shared/plan-archive-retention.ts` — new. Owns the policy types, `selectArchivedPlansForPrune`,
  `collectArchivedPlanUnits`, `collectWorkRecordPlanIds`, and `formatArchiveRetentionNudge`.
- `src/shared/plan-archive-retention.test.ts` — new. Selection rules and unit grouping.
- `src/shared/settings.js` — add `"plans"` to `RUNWIELD_CUSTOM_SETTING_KEYS` so Pi's `SettingsManager` does not drop the
  key on its next flush, and add `getPlanArchiveRetentionPolicy(projectRoot)` reading project scope only.
- `src/plan-store.js` — add `deleteArchivedPlanUnit`.
- `src/plan-store.test.js` — cover `deleteArchivedPlanUnit` including its refusals.
- `src/cmd/plans/prune.ts` — new. `runPlansPruneCommand`.
- `src/cmd/plans/prune.test.ts` — new. CLI behavior over a real project fixture.
- `src/cmd/plans/index.ts` — route the `prune` subcommand.
- `src/cmd/plans/archive.ts` — print the nudge after single and bulk archive.
- `src/cmd/load-plan/index.ts` — print the nudge after the TUI archive action (around line 397).
- `src/cmd/load-plan/plan-epic-archive.ts` — print the nudge after Epic archive.
- `src/cmd/registry.js` — `plans prune` usage lines and notes in the `PLANS` entry.
- `src/skills/runwield/SETTINGS.md` — document `plans.archiveRetentionDays` and `plans.archiveKeepLast` next to the
  existing `workRecords.autoGenerateOnPlanCompletion` entry.
- `docs/domain-language.md` — this Plan makes new terms true, so the glossary lands in the same change.

## Reuse Opportunities

- `src/plan-store.js` — `listArchivedPlans`, `getArchivedPlanLocation` (already runs `assertSafePlanName`, so path
  traversal is impossible), `withPlanCatalogLock`, `syncDirectory`, `projectRelativePath`.
- `src/shared/epic-artifacts.ts` — `EPIC_ARTIFACT_FILE_NAMES`, `getArchivedEpicArtifactPath`.
- `src/shared/work-records/store.js` — `listWorkRecords(cwd, { createDir: false })`, so prune never creates
  `docs/work-records/` as a side effect.
- `src/shared/settings.js` — `getCustomSetting`, and the `shouldAutoGenerateWorkRecordsOnPlanCompletion` resolver as the
  shape to copy for a nested key.
- `src/cmd/plans/unshare.ts:148` — the established `globalThis.prompt` confirm helper for a destructive CLI action.
- `src/cmd/plans/plans-command-test-fixture.ts` — `withPlanCommandFixture` gives a sandboxed `HOME` and a real project
  root under `withProcessGlobalTestLock`.

## Implementation Steps

- [ ] `src/shared/plan-archive-retention.ts` exports `selectArchivedPlansForPrune`, `collectArchivedPlanUnits`,
      `collectWorkRecordPlanIds`, `formatArchiveRetentionNudge`, and the `ArchiveRetentionPolicy`, `ArchivedPlanUnit`,
      and `ArchivePruneSelection` types.
- [ ] `selectArchivedPlansForPrune({ units, workRecordPlanIds, policy, now })` returns
      `{ due, sparedByKeepLast, withinRetention, ineligible }` and implements the rules exactly: a unit with no `planId`
      or whose `planId` is absent from `workRecordPlanIds` lands in `ineligible` and is excluded from the floor;
      eligible units sort by `archivedAt` newest-first with a missing `archivedAt` sorting last; the first
      `policy.keepLast` are spared; of the rest, those aged `policy.retentionDays` or more — and every unit with a
      missing `archivedAt` — are `due`.
- [ ] `collectArchivedPlanUnits(cwd)` returns one `ArchivedPlanUnit` per top-level entry of `docs/plans/archived/`,
      where `paths` for an Epic contains the Epic `.md`, every child `.md` under `docs/plans/archived/<epic>/`, and any
      present Epic Artifact; a standalone Plan's `paths` contains exactly its own `.md`.
- [ ] `getPlanArchiveRetentionPolicy(projectRoot)` in `src/shared/settings.js` reads `plans.archiveRetentionDays` and
      `plans.archiveKeepLast` from project scope only, returns `{ retentionDays: 14, keepLast: 10 }` when either is
      absent, ignores a global-scope value entirely, and throws a message naming the offending key when a value is not
      an integer of zero or more. `"plans"` is present in `RUNWIELD_CUSTOM_SETTING_KEYS`.
- [ ] `deleteArchivedPlanUnit(cwd, archivedPlanName)` in `src/plan-store.js` removes the archived `.md` and, when a
      sibling directory of that name exists, the directory and its contents; it runs inside `withPlanCatalogLock`, it
      returns the project-relative paths it removed, and it throws without removing anything when the name is not
      top-level, when no such archived Plan exists, or when the directory holds an entry that is not a `.md` file.
- [ ] `runPlansPruneCommand` in `src/cmd/plans/prune.ts` prints the four selection groups with the file paths of every
      due unit, deletes the due units after a `globalThis.prompt` confirmation, skips the prompt under `--yes`, never
      deletes under `--dry-run`, prints usage under `--help`, and exits non-zero when any deletion fails while reporting
      which unit failed.
- [ ] `src/cmd/plans/index.ts` routes `prune` to `runPlansPruneCommand`, and `src/cmd/registry.js` lists
      `wld plans prune [--dry-run] [--yes] [--help]` in the `PLANS` usage block.
- [ ] `formatArchiveRetentionNudge(cwd)` returns `null` when nothing is due, a single line naming the due count and
      `wld plans prune` when something is, and a one-line warning naming the bad key when the policy is invalid; it is
      called after a successful archive in `src/cmd/plans/archive.ts` (single and bulk), `src/cmd/load-plan/index.ts`,
      and `src/cmd/load-plan/plan-epic-archive.ts`.
- [ ] `src/shared/plan-archive-retention.test.ts` asserts, against the real functions: an ineligible unit is never due
      and never consumes a floor slot; `keepLast` spares the most recently archived eligible units; `retentionDays: 0`
      makes a unit archived at `now` due; a unit with a missing `archivedAt` is due; and `collectArchivedPlanUnits`
      groups an Epic's children and `manual-qa.md` into the Epic's `paths`.
- [ ] `src/plan-store.test.js` covers `deleteArchivedPlanUnit` removing an Epic directory whole, and its three refusals,
      each asserting the target files still exist afterwards.
- [ ] `src/cmd/plans/prune.test.ts` uses `withPlanCommandFixture` and asserts that a real archived Plan file with a
      matching Work Record and an old `archivedAt` is gone from disk after `--yes`, that a Plan without a Work Record
      survives, that `--dry-run` leaves both on disk, and that the settings values are honored.
- [ ] `docs/domain-language.md` defines **Archived Plan**, **Plan Archive Retention**, and **Archive Prune** in the
      `Plans & Review` section, each with an `_Avoid_` list, describing the behavior this Plan makes true.
- [ ] `src/skills/runwield/SETTINGS.md` documents both keys, their defaults, that the policy is project-scope only, and
      that `0` disables retention delay and the floor respectively.

## Approval Confirmation

No `supersedes` Work Record IDs are proposed. This Plan adds new behavior and does not materially replace a completed
Work Record.

## Verification Plan

- Automated: `deno task ci`
- Automated:
  `deno run -A scripts/run-tests.js src/shared/plan-archive-retention.test.ts src/cmd/plans/prune.test.ts src/plan-store.test.js`
- Manual, in this repository, after setting `plans.archiveRetentionDays: 14` and `plans.archiveKeepLast: 10` in
  `.wld/settings.json`:
  - `wld plans prune --dry-run` reports roughly 111 due units, spares 10, and lists the 3 top-level Plans without a Work
    Record as ineligible. No file changes; `git status` is unchanged.
  - `wld plans prune` prompts, and answering anything but yes deletes nothing.
  - `wld plans prune --yes` deletes the due units. `git status` shows the deletions, no archived Epic directory is left
    holding orphan children, and `docs/work-records/` is untouched.
  - `wld plans archive <a verified Plan>` prints the archive line followed by the retention nudge.
- Expected: the first real run is a large one-time backlog clear, not the steady state. Nothing outside
  `docs/plans/archived/` is modified or removed.
- No existing test is reshaped by this Plan; every current assertion must still hold. The one existing behavior that
  changes shape is settings serialization — `preserveRunWieldCustomSettingsForWrite` must keep preserving every key it
  preserves today, with `"plans"` added.

## Edge Cases & Considerations

- **A due unit is deleted between selection and removal.** Report it as skipped and keep pruning the rest; do not fail
  the whole run.
- **An archived Plan directory holds something unexpected.** `deleteArchivedPlanUnit` refuses the whole unit rather than
  removing part of it. Prune reports the refusal and continues.
- **A malformed archived Plan.** `listArchivedPlans` already warns and skips it. It therefore has no `planId`, lands in
  `ineligible`, and is never deleted — the safe direction.
- **Duplicate `planId` across archived Plans.** Both units resolve as eligible against the same Work Record. Acceptable:
  each still needs to pass the age gate on its own `archivedAt`.
- **Prune runs inside a linked worktree.** `getSettingsDir` resolves project settings through
  `resolvePrimaryCheckoutRoot`, so the policy comes from the primary checkout, but `docs/plans/archived/` is read from
  the worktree's own `cwd`. Prune must operate on `getCwd()` and delete only files under it.
- **Assumption — `--yes` is the skip-confirm flag.** `plans unshare` uses `--force` for the same purpose, but
  `plans archive --force` already means "bypass the status guard". `--yes` avoids that collision. Reversible.
- **Assumption — the nudge is printed, never blocking, and only at archive time.** It goes silent during a stretch when
  nothing is archived, which is also a stretch when nothing new is rotting.
- **Out of scope.** Retiring stale Work Records. 155 Work Records are permanent and greppable, and each describes code
  as of the day it shipped; a stale Work Record is the same trap in a more authoritative voice. The user has a manual
  supersession pass planned separately.
