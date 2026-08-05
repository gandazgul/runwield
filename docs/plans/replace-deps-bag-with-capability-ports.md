---
classification: "PLANNED_CHANGE"
complexity: "MEDIUM"
summary: ""
affectedPaths:
    []
createdAt: "2026-07-30T17:54:11.445Z"
updatedAt: "2026-08-03T17:15:51.295Z"
status: "draft"
origin: "external"
planId: "d9fa56fe-1ff7-4508-a29a-231cb5a6375e"
---

# Replace the `__deps` bag with capability ports

## Context

51 modules accept a `__deps`/`__testDeps` bag. The largest are `validation.js` (38 distinct injected dependencies),
`workflow.js` (29), `agent-handler.js` (19), `orchestrator.js` (18), `workflow-slicer.js` (11).

Those 38 in `validation.js` are not 38 concerns. They are four: Git operations (12), agent/model/user interaction (~12),
config and observability (4), and RunWield's own machinery (~9 — `recordPlanEvent`, `updatePlanFrontMatter`,
`run*Transition`, registry writers, `stageValidationPassedInExecutionWorktree`, `resolveValidationExecutionContext`). A
few, like the pure formatter `formatWorkRecordAutoGenerationResult`, never needed a seam at all.

The mechanism is not the problem — a plain parameter is the right idea. Three properties of the _shape_ are:

1. **No category.** Machinery sits in the same untyped bag as `git merge`, so replacing the transaction layer looks as
   ordinary as replacing a subprocess.
2. **`?? real` defaults hide mistakes in both directions.** `__deps?.x || realX` silently runs real code when you forget
   to inject; `__deps ? fake : real` silently runs a fake because _something unrelated_ was injected. Neither is visible
   at the call site.
3. **Faking is cheaper than building the environment.** Faking `resolvePlan` is one line; a real temp project with a
   Plan file is ten. So tests skip the environment, and then must fake the machinery too, because the machinery needs a
   project that is not there.

That chain produced three real defects, all found in one review pass:

- `validation.js` replaced both lifecycle transitions with no-op stand-ins whenever _any_ dependency was injected. All
  six validation-loop files — 57 tests — ran with no journaling, locking, CAS, or rollback. The stand-in was also
  masking a production bug: the typed merge failure was flattened to a string, so merge repair was dispatched into the
  wrong worktree.
- `workflow-slicer.js` did the same to the catalog lock _and_ the whole Epic decomposition transaction. That composite
  transaction had zero coverage.
- Tests defaulted their project root to the developer's checkout, so lifecycle locks landed in the real repo. Two CI
  runs contended on the same lock files and blocked each other for minutes; a killed run stranded everything after it.

## Objective

Make the illegal thing structurally impossible rather than discouraged:

- group genuine boundaries into a few named capability ports passed as ordinary required arguments;
- give RunWield-owned machinery no injection point at all, so it cannot be disarmed;
- remove defaulted seams, so the choice of real or fake is explicit and type-checked;
- make the right thing cheap — real fixtures that cost less than writing a fake.

## Approach

A test seam is a public statement that something is _not ours_. Ports therefore follow ownership, not convenience:

- **Leaves the process** (subprocess, network, another program's state) → port.
- **Nondeterministic or slow** (agent turns, CI runs, clocks) → port.
- **We own its invariants** (Plan store, transitions, registry, locks) → never a port. It is the code under test even
  when it is not the subject of the test.
- **Faking it would make the assertion tautological** → no port; the test would assert its own wiring.

Ports are behavioural, not one function per call site: `git.isAncestor(a, b)`, not twelve separate injectables. That is
what stops the count growing with each new caller.

Construct ports once at the edge (CLI entry, session boot) and thread them as a normal argument. No `||` fallback inside
the callee: a missing port is a type error, not a silent switch. Tool factories keep construction-time injection —
`createSlicerFinalizeTool({ planName, cwd, git, agent })` — since the factory is already the right seam; only the shape
of what it receives changes.

Explicitly rejected: a DI container (hides wiring, still permits faking machinery) and module-level mocking (Deno has no
first-class support, and it would make faking machinery easier — backwards).

One honest tension to hold: a test-only branch in production code is normally a lie about what ships. The exception is
where the _environment_ lives, not what the code does — `getRunWieldRuntimeDir()` relocating lock files under a test
sandbox is configuration, and the locking behaviour is byte-identical. Anything that changes behaviour, rather than
location, does not get that exemption.

## Files to Modify

- `src/shared/workflow/architecture-boundary.test.js` — add the machinery-denylist assertion and a no-conditional-seam
  assertion (Step 0). Extend `HIGH_LEVEL_FILES` to include `workflow-slicer.js`, `orchestrator.js`,
  `epic-continuation.js`, `plan-review.js`, and `archive.js`, which are currently unguarded.
- `src/shared/worktree.js` — expose `GitPort` as the single boundary object for Git operations.
- `src/shared/workflow/validation.js` — migrate 12 Git deps to `git`, ~12 agent/user deps to `agent`/`user`, 4 config
  deps to `env`; delete the machinery deps outright.
- `src/shared/workflow/workflow.js`, `workflow-slicer.js`, `orchestrator.js`, `epic-continuation.js`,
  `src/shared/session/agent-handler.js` — same migration, in descending order of seam count.
- `src/cmd/load-plan/load-plan-test-helpers.js` — drop the `cwd: getCwd()` default once the tests that fake
  `resolvePlan` are converted to real fixtures.
- `src/cmd/load-plan/load-plan-recovery.test.js` — two tests are entangled with `session.cwd` being the real repo in
  opposite directions; both need real temp projects.
- `src/skills/write-tests/SKILL.md` — record the ownership heuristic once ports exist, so new code follows it.

## Reuse Opportunities

- `src/shared/git-test-fixture.ts#defineGitFixture` — real repositories at 5ms per test. The cheap-fixture half of the
  argument already exists; ports make the expensive half unnecessary.
- `src/shared/workflow/validation-test-helpers.js#makeValidationProjectRoot` — the same idea for Plan projects.
- `src/shared/worktree.js#runGitResult` — already the funnel for worktree Git calls; `GitPort` can wrap it rather than
  replacing call sites one by one.
- `src/constants.js#getRunWieldRuntimeDir` — the sandbox-isolation precedent for environment relocation.

## Implementation Steps

- [x] **Step 0 — freeze the problem, no refactor.** Done: `scripts/check-injection-seams.js` plus
      `scripts/injection-seam-baseline.json`, wired into `deno task ci` as `seams:check`, mirroring the JS-to-TS
      ratchet. Three rules, in descending strictness: conditional seams are never allowed (zero-tolerance, since the
      codebase has none); machinery seams may only shrink, listed per module; seam counts may only shrink, frozen per
      module so a refactor cannot trade one seam for two. `--update` refuses to loosen, so re-baselining is not an
      escape hatch. Verified by introducing each of the three regressions on purpose and confirming a red build.

      **Baseline at freeze: 155 seams across 13 modules, 13 of them machinery.** Machinery still to remove:

      | Module | Machinery seams |
      | --- | --- |
      | `validation.js` | `recordPlanEvent`, `updatePlanFrontMatter`, `updateWorktreeRegistryEntry`, `removeWorktreeRegistryEntry` |
      | `workflow-slicer.js` | `recordPlanEvent`, `saveChildFeaturePlans`, `withPlanCatalogLock` |
      | `workflow.js` | `recordPlanEvent`, `updateWorktreeRegistryEntry` |
      | `agent-handler.js` | `recordPlanEvent` |
      | `epic-continuation.js` | `recordPlanEvent` |
      | `execution-context.js` | `updatePlanFrontMatter` |
      | `plan-review.js` | `recordPlanEvent` |

      Run `deno task seams:update` after each removal to tighten the ratchet. The number that matters is the
      machinery column reaching zero; the total count follows from Steps 1–3.
- [ ] **Step 1 — `GitPort`.** Biggest cluster, cleanest boundary. Define it in `worktree.js`, migrate `validation.js`
      and `workflow.js` off their Git deps, and keep a handful of real-Git contract tests to verify the port's semantics
      (argument order, exit-code meaning) as described in the write-tests skill.
- [ ] **Step 2 — `AgentPort` / `UserPort` / `EnvPort`.** Where the genuinely slow and nondeterministic work lives. Agent
      turns and CI runs stay faked; everything derived from them gets covered, failures included.
- [ ] **Step 3 — delete `__deps` from migrated modules.** This forces the remaining tests onto real temp projects, which
      is the same work as the two entangled `load-plan-recovery` tests, so it converges. Remove the `cwd: getCwd()`
      default from the load-plan fixture at the end of this step.

## Verification Plan

- Automated: `deno task ci`, twice concurrently, both green — the parallel-run property must not regress.
- Automated: `deno test -A src/shared/workflow/architecture-boundary.test.js` fails when a machinery name is added to
  any `__deps` bag, and when a conditional seam is introduced. Prove both by adding one on purpose.
- Automated: after each step, the migrated module's suite passes with no `__deps` remaining for that category.
- Manual: for each port, break one call inside it on purpose (reverse an argument, drop a flag) and confirm a test goes
  red. A port whose misuse nothing catches needs a contract test, not more unit tests.
- Manual: confirm no lock or journal files appear under the checkout's `.wld/` after a full run.
- Expected: no module can replace a Plan transaction, Plan write, registry write, or lock; seam count per module drops
  from tens to single digits; test setup cost drops enough that faking the Plan store stops being the attractive option.

## Edge Cases & Considerations

- Seam count per module is a design smell metric worth watching. Thirty-eight injectables is not a testability
  achievement; it is an unmade design decision.
- A fake encodes the author's beliefs about the real thing, so it can never validate its own understanding of an
  external contract. Ports need a small verified-fake contract suite run against the real dependency.
- Cross-cutting guarantees cannot be tested with the cross-cutting thing removed. Atomicity exists only in composition,
  which is why the transaction layer must never sit behind a seam.
- Pure functions (formatters, mappers) never need a seam. Several current `__deps` entries are only noise.
- Migration order matters: do Step 0 first. Without it, every later step can be undone by the next module that adds a
  convenient seam.
