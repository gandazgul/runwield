# CI and Golden TUI performance — 2026-09-22

## Scope and constraints

Keep every existing test and assertion. Exercise real RunWield Runtime, workflow, storage, locking, Git, and terminal
composition. Script only external services. Successful commands should give a short summary; diagnostic and timing files
remain available without verbose console output.

## Ranking and reevaluation

The first round prioritized release wall time, then measured local savings. Hosted estimates remain unverified until a
pushed workflow run.

Quiet output and measurement came first. Initial ranking from the last successful release was: parallelize test
qualification, overlap compilation with qualification, split long sequential Golden files, reuse real fixtures, and
cache tool setup. Individual test timings then promoted artificial model latency above further file splitting.

| Priority after measurement | Change                                                           | Evidence / expected saving                                                                                                                                                                                                                                |
| -------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1                          | Run isolated files concurrently and shard CI across four runners | Local default grows from four to at most eight workers. PR/release source and Golden suites each have four required shards. Actual hosted improvement awaits a pushed run.                                                                                |
| 2                          | Build and check packages while tests run                         | Builds previously added 142s, asset preparation 90s, and native checks up to 212s after qualification. These now overlap source/Golden; publication still requires every check.                                                                           |
| 3                          | Remove artificial LLM response rate limits                       | Source compaction tests consumed minutes waiting for fixture tokens; all response bytes, streamed deltas, context sizes, and compaction assertions remain.                                                                                                |
| 4                          | Split long sequential Golden registration files                  | Same scenarios spread over smaller CI, human-review, round-limit, load-plan, and planned-change groups. Portfolio grew from 34 to 46 files without dropping tests.                                                                                        |
| 5                          | Prepare already-stale lock fixtures                              | Two tests waited 30 seconds each because zero timestamps fell back to a fresh mtime. Fixtures now have old real mtimes; real lock classification and concurrent recovery still run.                                                                       |
| 6                          | Reuse immutable real Git baselines                               | Twenty alternating fresh/reused fixture setups: 2.286s versus 0.419s, plus 0.136s to prepare templates once. Copies have separate working trees, indexes, refs, and bare remotes. Source worktree tests also reuse the existing real-Git fixture builder. |
| 7                          | Cache setup                                                      | Reuse Deno dependencies and the pinned Snip binary. Copy repository filters into ephemeral CI homes without starting the application.                                                                                                                     |

Changes were measured between steps. Adding workers alone exposed both long sequential groups and waits within
individual tests; splitting files alone could not remove those waits. Once fixture response delays were identified,
removing them became the higher-value change. Escape cancellation retains deliberately slow external streaming.

## Observations

The initial local runs overlapped each other and other work on this machine, and failed on existing defects. They are
useful diagnosis, **not controlled speedup claims**: source CI took 1,089s and Golden 976s at four workers. The last
successful hosted release ran source qualification in 429s and Golden in 577s; these are separate Linux measurements.

| Local measurement                                         |      Wall time | Result                                                                |
| --------------------------------------------------------- | -------------: | --------------------------------------------------------------------- |
| Golden, eight workers, before scenario splits             |         396.7s | 33 passed, one publication journey failed                             |
| Golden after scenario splits                              |         343.9s | 40 passed, same journey failed                                        |
| Golden with reusable fixtures and completion fix          |         279.3s | All 41 files / 172 tests passed                                       |
| Golden after removing default fixture streaming delay     |         246.3s | All 41 files / 172 tests passed                                       |
| Final Golden suite, four workers                          |         328.9s | All 46 files / 172 tests passed                                       |
| Final Golden suite, eight workers                         |         243.5s | All 46 files / 172 tests passed; 26% less wall time                   |
| Complete CI, including source and Golden                  |         606.8s | All 456 files / 3,788 tests; two existing Windows-only skips on macOS |
| Source CI, eight workers, before removing fixture latency |         402.5s | 408 files passed; docs build and obsolete workflow assertion failed   |
| Final source-only CI, eight workers                       |         330.2s | All 410 files passed; 18% below the earlier 402.5s run                |
| Session Runtime file before / after rate-limit removal    | 255.7s / 32.3s | All 86 tests passed after change                                      |
| Deferred repair file before / after rate-limit removal    | 227.2s / 19.0s | All four tests passed after change                                    |

The final four/eight-worker comparison ran sequentially on the same final scenario portfolio, using fresh timing
histories so both started in filename order. The second round of registration splits changed the eight-worker result
only from 246.3s to 243.5s (about 1%, within normal run variation); no further splitting was pursued. Its value is
smaller individual scheduling units for the four hosted shards, not a claimed large local speedup.

Runs used the same machine but had differing background load and cache history. Do not add these savings together or
present local numbers as measured GitHub release improvements. Raw benchmark logs and per-test XML from this session are
under `/private/tmp/runwield-ci-speed/`. Normal runs persist their reports under `.ci-cache/`.

The source-only comparison preserves the gate's scope: all source tests plus the ten static checks. The earlier 402.5s
run completed all files but failed on the docs race and an outdated workflow assertion. The final 330.2s run passed.
This is an observed 72.3s reduction, not a controlled estimate for any single change. The combined CI checkpoint above
predates the final source-fixture reuse; final source and Golden runs separately verified that final code.

## Reliability and coverage

The before/after Golden JUnit name inventory preserves all 171 original tests and adds one real fixture-isolation test.
The complete CI run executed 3,616 source tests plus 172 Golden tests; its only skips were the two unchanged
Windows-only foreground-shell tests on macOS. Scenario scripts and assertions were not weakened. No golden outputs were
re-recorded. The new fixture test commits and pushes one copy, proving that another copy and its template are unchanged,
including onboarding variants.

Two existing defects surfaced during measurement:

- Exact `/load-plan <full-name>` completion could consume Enter instead of submitting. Exact names now return no
  argument completion, including when a longer Plan shares the prefix. The original one-Enter Golden journey passes; a
  focused test uses real Plan storage in a real Git fixture.
- The docs build could leave an empty Pagefind entry file. Pagefind 1.5.2's disk writer does not await an explicit flush
  before Starlight closes its service. The build now obtains the real indexer's generated files and awaits writes in the
  parent process. The test reads JSON immediately and additionally checks every search output is nonempty.

`deno task ci` now includes Golden rather than allowing the full local gate to pass without composed UX journeys. Hosted
jobs use `ci --source-only` alongside required Golden shards. Aggregate check names remain `ci` and `golden`; failed,
canceled, or missing shards cannot produce a successful aggregate. A real-process runner test proves shard membership
executes every fixture file exactly once. Timing history can change order, never shard membership. A fractional
concurrency setting is clamped to at least one worker and verified with a real subprocess, preventing an empty
successful run.

Golden remains the right layer for deterministic composed TUI journeys: real input, Runtime events, durable lifecycle
state, and rendered output together. It complements focused tests, browser tests, and a thin real-terminal smoke layer.
Replacing it with isolated component tests would lose precisely the coverage that found the Enter defect.

## Reproduce and inspect

```sh
deno task ci
deno task test:golden-tui --report-dir /tmp/golden-results --timings-file /tmp/golden-timings.json
WLD_TEST_CONCURRENCY=4 deno task test:golden-tui --report-dir /tmp/golden-four
WLD_TEST_SHARD=2/4 deno task ci --source-only
```

`run.json` contains file wall times, prewarm time, concurrency, and pass/fail/skip totals. Its `files` list is the
authoritative inventory when reusing a local report directory. JUnit XML contains individual executed test names,
durations, failures, and ignored status. CI uploads these artifacts on success and failure; failures also retain
filtered diagnostics and fixture evidence. Successful CI prints one summary. Full CI passed all ten static gates and 456
test files. Workflow validation with Actionlint also passed. Publication-condition tests reject every failed, canceled,
or skipped qualification job for both fresh releases and recovery.

References: [release baseline](https://github.com/gandazgul/runwield/actions/runs/35672710829),
[Pagefind output writer](https://github.com/CloudCannon/pagefind/blob/v1.5.2/pagefind/src/output/mod.rs),
[Pagefind generated-file API](https://pagefind.app/docs/node-api/).

## Follow-up: repeated gates, alternate runner, and external binaries

The next ranking is based on the owner's repeated local validation cost:

1. **Avoid prescribing a duplicate full run.** Engineer, Plan Engineer, Frontend Engineer, repair prompts, and the
   bundled testing skill previously required complete CI immediately before `task_completed`, including an explicit
   instruction that RunWield would run it again. Managed Agents now perform focused verification and acceptance checks;
   RunWield still executes the full configured gate after completion and every repair. Standalone Agents still run full
   validation. This can avoid one entire CI duration per handoff, but is a guidance change, not a measured
   model-behavior guarantee. No successful result is cached or accepted from an Agent's narrative.
2. **Measure greater local concurrency and scheduling.** Twelve workers completed the whole gate in 523.5s (457 files
   passed, one prompt-contract failure subsequently fixed), versus the earlier 606.8s at eight. This initially suggested
   a twelve-worker default; the final paired comparison below rejected that choice. Hosted worker overrides stay
   unchanged. Scheduling now uses the first observation instead of discarding timings for two further runs; changing
   order cannot remove coverage. Replaying the previous complete suite's measured durations predicts a 31.7s shorter
   tail at twelve workers when all observations are used; this is a scheduling simulation, not a wall-time claim.
3. **Try Vite+/Vitest before migrating.** Actual experiment below found no advantage on the slow composed workloads.
4. **Make external binary fixtures consistent.** Local composed tests previously used installed Cymbal/Ketch while
   hosted CI provided shell stubs. Shared fixtures now cover Mnemoteca, Cymbal, and Ketch, with unsupported calls both
   rejected and recorded. Teardown checks the record even when production correctly catches an optional helper error.
   Git, Deno, Snip, and RunWield's storage, registry, lifecycle, and TUI are real. Existing adapter tests and package
   qualification remain separate; no test assertions were removed. Mnemoteca's default workflow fixture represents an
   empty external index; Work Record indexing tests retain their stateful external-port fixtures.

### Vite+ experiment

Installed `vite-plus@0.3.3` into a temporary directory only. It bundles Vitest 4.1.11. Native Node 24.20.0 failed to
import RunWield's Deno/JSR dependencies (`@std/assert`). Running Vitest under the real Deno 2.9.4 runtime worked after
passing the repository configuration to its fork workers. A registration adapter mapped `Deno.test` to Vitest's `test`;
native imports retained Deno's import map and actual APIs. Every worker had its own HOME, temporary directory, and
Mnemoteca path. Golden used the existing real child protocol and reusable real Git fixtures.

| Same two files, two isolated workers | Total wall time | Cleanup integration (34 tests) | Publication Golden (9 tests) |
| ------------------------------------ | --------------: | -----------------------------: | ---------------------------: |
| Current Deno runner                  |           90.7s |                          89.9s |                        62.7s |
| Vite+ / Vitest under Deno            |          112.4s |                         111.8s |                        64.2s |

All 43 original tests passed in both runs. These are sequential local observations, not a statistical benchmark.
Vitest's registration wrapper used native imports for application code, so this compares runner orchestration, not a
complete Oxc-transformed port. The native Node attempt and Deno-compatible attempt are both retained. A complete port
would also need to preserve Deno's resource/async-operation sanitizers; the experimental adapter is not production-ready
and has not replaced any tests. No new runner dependency was added to RunWield.

After introducing the binary fixtures, the same Deno pair took 101.1s (100.1s cleanup, 71.7s Golden). This did **not**
demonstrate a speedup; the fixtures are retained for isolation and matching local/hosted external boundaries, not
credited with performance savings. Benchmark evidence is under `/private/tmp/runwield-ci-speed/`:
`runner-deno-isolated/`, `vitest-native-results.json`, `vitest-direct.log`, `vitest-experiment-evidence/`, and
`binary-fixtures-pair/`.

### Coverage overlap assessment

The measured source and Golden inventories share no exact test names; that alone is not proof of unique coverage.
Inspection of the slow publication groups found overlapping behavior but different failure detection:

- The 34 cleanup command cases cover named/picker entry, view versus explicit cleanup, missing registrations, preserved
  user files, remote advancement/rewrites, and changed or missing upstreams.
- The publication crash matrix exercises 24 effect/receipt crash boundaries and eight later-commit restart cases with
  actual process death and actual Git. These are not substitutes for visible keyboard/menu behavior.
- The nine publication Golden journeys compose input, rendered output, Runtime events, real lifecycle state, and
  publication. Their counterfeit-evidence checks also protect against false positives.

No cases were deleted as redundant. Keep Golden for these composed UX contracts. A component-only replacement or shared
mutable in-process session would give up the isolation and integration coverage that caught the Enter regression. Use
focused tests to diagnose and repair, followed by the complete gate once; do not reuse a green result across changed
inputs without a separately proven invalidation scheme.

References: [Vite+ test command](https://viteplus.dev/guide/test),
[Vitest runtime requirements](https://vitest.dev/guide/),
[Vitest isolation and performance](https://vitest.dev/guide/improving-performance),
[Deno CLI code-cache options](https://docs.deno.com/runtime/reference/cli/run/).

### Import cost in real crash tests

The publication driver loaded the full agent package through three static dependencies: URL normalization in Plan
locking, non-Git consent in generic Git helpers, and metrics settings. The unchanged URL validator now lives in the
existing URL module; consent helpers live in their own settings-dependent module; metrics import settings when actually
recording a metric. Ordinary Git/publication processes no longer initialize the agent package. Metrics still honor the
real settings, and consent still persists through the real settings implementation. No internal operation is
substituted.

Sequential one-worker runs of `publication-machine.e2e.test.ts`, each with a fresh per-run cache, took **78.06s before
and 61.96s after** (20.6% less wall time). All three top-level tests and all 32 crash/restart subcases passed unchanged.
Evidence: `crash-before-imports/`, `crash-after-imports/`, and the before/after `publication-driver-graph*.json` files
under `/private/tmp/runwield-ci-speed/`. This measured result promoted import cleanup above speculative fixture or
runner gains.

### Failure collection and concurrency repairs

CI collects all test failures by default. `deno task ci --fail-fast` is optional: it stops scheduling new files after a
failure and lets already-running files finish. Collecting failures costs more on that individual failed run, but permits
one repair batch instead of repeated model turns and reruns. No fail-fast run with skipped files counts as a complete
qualification run.

Import cleanup and higher concurrency exposed test assumptions and a real runtime race. Lock-holder subprocesses now
keep themselves alive explicitly instead of depending on background handles from an unrelated agent import. Migration
rechecks transient state under its migration lock and waits for an active registry lock before rereading the registry;
the existing test now observes the real migration lock instead of guessing readiness with a sleep. The large ACP usage
fixture retains its complete 48,000-token context and assertions, while allowing more than 80 transport chunks.

The concurrent Golden model fixture previously assigned both sessions the first session's Plan identity and shared turn
ordinals. It now matches the real model request's canonical working directory to the correct Runtime snapshot, with
distinct Plan scripts. All lifecycle, publication, registry, identity, and rendered UX assertions remain.

### Real macOS clipboard contention

A subsequent loaded run exposed another external dependency: every composed TUI polled the user's real clipboard every
1.5 seconds. With an image on this machine's clipboard, individual `osascript` probes used approximately 270 MB and
substantial CPU. Concurrent Golden processes multiplied that unrelated work and made the external state affect screens.
The shared binary fixtures now answer only the exact image-availability AppleScript with an empty clipboard; unsupported
AppleScript fails and is recorded. Production clipboard logic still invokes a real subprocess. Dedicated clipboard
reader tests and the composed paste test retain their image, extraction, attachment, error, and cleanup coverage.

### Accurate TUI idle detection

Loaded runs exposed that `waitForIdle` only observed Runtime busy state and a stable screen. A slash command can still
be processing before the Runtime becomes busy, so the harness could assert incomplete output or dispose the fixture
under a running command. Composition now also observes the real input controller's pending submission. A composed
regression opens the real theme selector, confirms the Runtime is not busy, verifies idle cannot finish while selection
is pending, then cancels through terminal input and observes completion. No command, lifecycle, or lock is substituted.

## Final verification and worker reevaluation

Both complete gates passed on the repaired code. The runs used the same saved input timing history, fresh per-run Deno
caches, and exactly the same 460 files and 3,826 JUnit cases. There were **3,824 passing cases and two unchanged
Windows-only skips** on this macOS machine (12 logical CPUs, 48 GiB RAM).

| Complete local CI                                   | Wall time | Result                                              |
| --------------------------------------------------- | --------: | --------------------------------------------------- |
| Earlier eight-worker checkpoint                     |    606.8s | 456 files; 3,788 cases including two platform skips |
| Repaired code, twelve workers                       |    527.9s | All 460 files passed                                |
| Same repaired code and input history, eight workers |    505.4s | All 460 files passed                                |

**Keep eight workers by default.** Twelve increased contention; its complete run was 22.5s slower. The final observed
reduction from the earlier checkpoint is 101.4s (16.7%), despite 38 additional cases from this work and concurrent
repository changes. These are sequential observations on a working machine, not repeated statistical trials; do not
attribute the entire difference to one change. The controlled publication-driver comparison remains 78.06s versus
61.96s. Hosted release savings still require a pushed workflow run.

The final ranking is: avoid a prescribed duplicate full gate; overlap required hosted qualification and builds; remove
artificial external latency and costly unrelated imports; reuse real fixtures and schedule long files early; then tune
workers from measurements. The alternate runner and a twelve-worker default did not justify adoption. All Golden
journeys remain required by local CI. The original Golden inventory is preserved. The four names missing from the older
combined inventory are replacements: the timing policy and repair-guidance assertions changed intentionally, while
concurrent ACP work strengthened the schema/usage tests with exact context and unknown-capacity cases. No test was
deleted as redundant.

The successful commands each printed only the Deno task banner and `CI passed (...)`. Detailed task times, individual
case durations, and failure diagnostics remain in artifacts. Repaired reruns also passed the 25 journeys in the four
previously failing Golden groups, all three Epic journeys under load, the clipboard/paste checks, migration tests, and
the new real-input idle regression. The zero-internal-seam check still passes.

Final evidence: `ci-repaired-eight-report/`, `ci-repaired-twelve-report/`, their `*-tasks.json` and `*-summary.json`
files, and `repaired-worker-comparison-input.json` under `/private/tmp/runwield-ci-speed/`. The intermediate failed
collect-all run is retained as `ci-collect-all-failure-report/`; it is not counted as a successful timing result.

## Separate suite measurements and subprocess profiles

Fresh measurements after the owner stopped the other CI run and automatic compilation:

| Command                      |          Wall time | Result                                                           |
| ---------------------------- | -----------------: | ---------------------------------------------------------------- |
| `deno task ci --source-only` | **310.5s (5m10s)** | 414 files; 3,652 passing cases, two unchanged Windows-only skips |
| `deno task test:golden-tui`  | **229.5s (3m50s)** | 46 files; all 172 cases passed                                   |

These ran sequentially with the default eight workers. The first source attempt overlapped another CI run and was
stopped; it is excluded. The earlier combined CI measurement remains 505.4s. Adding two separately scheduled runs is not
a measurement of the combined worker pool.

Source test execution accounted for 291.4s; static checks, Workspace build, and surrounding task work accounted for
19.1s. Prewarming took 0.67s for source and 0.86s for Golden. Source file durations total 2,325 worker-seconds: their
ideal eight-worker scheduling floor is 290.6s, almost the observed 291.4s. Golden totals 1,708 worker-seconds: its floor
is 213.6s versus 229.2s inside the runner. These floors hold observed file durations constant; they do not predict
behavior under a different concurrency. Further scheduling alone has little source-suite opportunity.

### Longest files and cases

File wall times below include process/import overhead and reflect contention in the eight-worker suite:

| File                                                                  |                            Cases | File wall time |
| --------------------------------------------------------------------- | -------------------------------: | -------------: |
| `src/cmd/load-plan/publication-cleanup.integration.test.ts`           |                               34 |         160.7s |
| `src/cmd/load-plan/index.integration.test.ts`                         |                               44 |         119.6s |
| `src/ui/tui/golden-scenarios/validation-workflow-publication.test.ts` |                                9 |         118.2s |
| `src/shared/workflow/publication-machine.e2e.test.ts`                 | 35, including nested crash cases |         114.0s |
| `src/ui/tui/golden-scenarios/slash-command-configuration.test.ts`     |                               15 |          86.5s |
| `src/ui/tui/golden-scenarios/validation-workflow-lifecycle.test.ts`   |                                9 |          83.6s |
| `src/ui/tui/golden-scenarios/project-workflow.test.js`                |                                3 |          80.1s |
| `src/shared/workflow/sequence-review.test.ts`                         |                               15 |          77.8s |

The longest source parent case was the complete remote/local process-death matrix, 76.6s, followed by the separate
failure/recovery matrix, 50.9s. The longest Golden case was `project-two-child-continuation-epic-evidence`, 48.1s;
concurrent Plan execution took 32.4s. Parent-case durations overlap their nested steps and must not be added together.

### What the slow tests actually do

Seven files were rerun sequentially with a diagnostic preload that records real command start/end times, timer
callbacks, test boundaries, and Golden startup markers. Every command and test delegates to its original implementation.
[V8 CPU profiles](https://docs.deno.com/runtime/fundamentals/cpu_profiling/) were captured for test processes and real
Deno children, including the deliberately crashing publication drivers. The final Golden profiles use the suite's
reusable real repository templates. An earlier diagnostic pass without shared templates is retained separately.

All **155 profiled JUnit cases passed**, with exact name inventories matching the uninstrumented suite. No product code,
test assertions, test membership, or golden expectations changed for this profiling pass. Sampling and tracing add
overhead; the single-file durations below diagnose costs and are not speedup comparisons with the concurrent suite.

| Profiled file         | Main process wall | Real Git calls across its processes | `worktree list` calls | Tracked-path scans | Time in those two Git queries |
| --------------------- | ----------------: | ----------------------------------: | --------------------: | -----------------: | ----------------------------: |
| Cleanup recovery      |             87.5s |                               7,962 |                 1,680 |              1,660 |                         15.1s |
| Crash/restart matrix  |             64.1s |                               7,623 |                 1,541 |              1,579 |                         14.1s |
| Load-plan integration |             76.0s |                               6,001 |                 2,612 |              2,771 |                         21.9s |
| Sequence review       |             58.8s |                               7,827 |                 3,909 |              3,906 |                         33.1s |
| Golden publication    |             69.1s |                               7,395 |                 1,931 |              2,769 |                         21.4s |
| Golden PROJECT        |             53.2s |                               7,970 |                 2,974 |              3,981 |                         31.6s |
| Golden configuration  |             50.7s |                                 314 |                    47 |                 47 |                          0.4s |

Counts are commands launched through Deno, including instrumented Deno children; Git's own subprocesses are not counted
separately. Query times are accumulated observed intervals, not CPU time. Parent waits include child work, so neither
process durations nor parent/child command durations should be added into one wall-time total.

**Repeated migration checks are the largest shared finding.** `enterProjectRuntime()` calls
`migrateLegacyProjectRuntimeState()`, which calls `preflight()` before `completeMarkerNeedsNoWork()`. Even an already
migrated Project is enumerated and scanned before that quick return. Plan locks, registry reads/writes, controller
reads, and publication phases all enter this path. `withProjectRuntimeReadScope()` shares checks in some bounded reads,
but does not currently cover the nested controller/read chains responsible for these profiles.

In Sequence review, 1,287 worktree listings came through `inspectControllerWorktree()` and another 1,287 through
`readControllerRecord()` inside `loadControllerView()`. Another 249 came through `listControllerDocumentWorktrees()`.
The 15 tests made 3,909 listings overall. This is repeated production work, not a special expensive Golden assertion. In
cleanup recovery, 1,456 listings came directly through the ordinary migration preflight call site.

**Durable Session writes also matter.** Load-plan's sampled main-thread stacks spent about 15.4s inside synchronous
file/directory flushes; cleanup spent 6.3s. The callers are `writeTextAtomically()` and `syncParent()` in
`src/shared/session/file-session-storage.ts`. These samples include blocking native I/O, not just CPU computation.
Removing flushes would change durability and is not an acceptable test optimization.

**External helper startup is still measurable with fixtures.** Mnemoteca/Cymbal calls cost 13.4s in load-plan and 10.7s
in cleanup, mainly their first `--help` checks. Each fixture changes PATH, invalidating `runtime-preflight.ts`'s
PATH-keyed availability cache. These are real executions of the external fixture scripts. Their exact OS startup cost
has not been isolated from filesystem/security-service overhead; the profile does not establish that cause.

**Golden has two distinct costs.** Publication children spent 19.8s before readiness, 48.5s in the journeys, and about
0.15s in final cleanup. PROJECT children spent 7.0s starting and 45.4s in journeys. Configuration children spent 30.9s
starting and 18.2s in journeys. Startup includes process/module loading, fixture setup, helper checks, and real TUI
composition. It is 63% of the configuration cohort but only 13% of the PROJECT cohort. Replacing the test registration
runner cannot by itself remove this application startup work.

Sampled JavaScript self time in TUI files and Pi TUI totaled approximately 0.5s for publication, 0.4s for PROJECT, and
0.8s for configuration. That is not an exhaustive accounting of everything called by rendering, but rendering did not
appear as the dominant sampled cost. The four source parent profiles recorded no fired timer callbacks: shortening
sleeps is not the explanation for their long durations. Golden polling timers overlap actual workflow/Git work and must
not be counted as entirely removable delay.

### Revised optimization order

1. **Remove repeated migration inspections within bounded operations.** Reuse real validation results across nested
   controller/registry reads, with revalidation at write/external-change boundaries. Never install a process-lifetime
   “already migrated” cache that misses later legacy files, worktrees, or conflicts. The two Git queries alone consume
   33.1s in Sequence review and 31.6s in the PROJECT cohort, before their associated filesystem traversal.
2. **Reduce repeated Golden startup and external fixture startup.** Configuration spends 30.9s before readiness. Measure
   reusable immutable helper executables with separate per-test logs/state and a prebuilt child/import path; preserve
   fresh HOME, Runtime, Git, terminal, and application state for every scenario. The existing real repository templates
   already remain enabled. Startup and helper figures overlap and are not additive savings.
3. **Find redundant durable writes.** Investigate unnecessary repeated manifest/recovery-descriptor writes. Keep
   required flushes and all process-death/restart assertions; do not replace storage with a fake or skip persistence.
4. **Only then revisit scheduling or a runner conversion.** Source scheduling is already close to its measured floor;
   the earlier Vite+ experiment was slower. Keep composed Golden coverage because it catches real input/lifecycle
   integration defects.

These numbers rank observed costs, not guaranteed removable seconds. The profiling pass makes no claim of an additional
optimization or measured release-run improvement.

Raw evidence is under `/private/tmp/runwield-ci-profile/`: `source-ci-tasks.json`, `source-report/`, `golden-wall.json`,
`golden-report/`, `final-profile-summary.json`, per-file JUnit, command/timer traces, and `.cpuprofile` files.
`observe.js`, `run-profiles.py`, `run-golden-profiles.py`, and `final-analysis.py` preserve the diagnostic method. The
`*-shared` Golden results are the authoritative profiles matching normal fixture reuse. All successful suite/profile
commands remained concise.

## Migration and repeated Git checks: implementation follow-up

Runtime verification now spans the nested reads in Plan listings, controller views, Plan evidence lookup, action
identity resolution, and Sequence review snapshots. Each grouped read verifies each selected checkout once. Actual Plan,
controller, registry, and publication contents are still read from disk. There is no process-lifetime migration cache.
Results expire when the initiating read settles, including failures and detached asynchronous continuations; failed
validation can be retried after repair. Controller writes force fresh validation before writing and invalidate
surrounding read results afterward. Migration locks and write-boundary checks remain in place.

The runtime-safety guard also no longer runs a redundant `git diff --cached --name-only`: its existing HEAD tree and
index scans already cover staged deletions, additions, and rename destinations. Real Git remains in every fixture.
Session persistence and required disk flushes remain enabled, including Golden tests. Disabling them would remove
reload, recovery, and write-order coverage and would measure different behavior from production.

### Re-evaluation after each change

| Isolated Sequence review profile                            | Wall time | Worktree listings | Tracked-path scans | Git commands |
| ----------------------------------------------------------- | --------: | ----------------: | -----------------: | -----------: |
| Before                                                      |    58.78s |             3,909 |              3,906 |        7,827 |
| Controller and Plan-list read scopes, with bounded lifetime |    30.14s |             1,763 |              1,760 |        3,535 |
| Add grouped Plan-evidence and Sequence reads                |    25.01s |             1,210 |              1,207 |        2,429 |

All 15 Sequence cases passed in every profile. The final measurement is **57.4% faster**, with **69.0% fewer worktree
listings**. These use the same observational profiler and run one test file at a time. Remaining repeated inspections
mostly occur at separate write/lock boundaries; broadening reuse across those boundaries would need additional
correctness evidence. The redundant staged-diff removal is separate from this Sequence result.

Six new regression tests exercise real Git command counts, fresh controller contents, newly staged runtime files, write
invalidation, scope expiration after success and failure, and repair/retry. Both pre-existing read-scope tests remain.
The four migration/controller/isolation test files pass together; no assertions or test cases were removed.

### Full-suite correctness check

The complete CI run executed all **460 files and 3,832 cases**: **3,829 passed, two existing Windows-only cases skipped,
and one skill-sync test failed**. The six added cases account for the entire increase from the previous 3,826-case
inventory; no previous case disappeared. All Golden, migration, controller, Git-safety, and crash/recovery cases passed.
All ten initial CI checks passed, including typechecking, lint, and the zero-seam check.

The skill-sync failure reported an Agent Definition changed without its corresponding published skill. Agent Definitions
were being edited by another task during the test run; they are outside this optimization. The failure remains visible
rather than being filtered or accepted as success.

CI wall time was **761.33s (12m41s)**, but another CI began in a separate Plan checkout about five minutes into this run
and overlapped the rest. This is a correctness run under contention, **not an uncontended end-to-end performance
comparison**. No total CI speedup is claimed from it. Saved evidence: `ci-tasks.json`, `ci-report/`, `ci-summary.json`,
and `inventory-comparison.json` under `/private/tmp/runwield-migration-speed/`.

### Follow-up profiles and next priorities

After waiting for the competing CI, several of its Golden cases were still running for minutes. The following two
profiles therefore ran with that CI still active. Their **Git call counts are directly comparable**, but their wall
times are confounded by the overlap and cannot establish a speedup or regression.

| Profile             | Before / after wall | Before / after worktree listings | Before / after tracked-path scans |     Cases |
| ------------------- | ------------------: | -------------------------------: | --------------------------------: | --------: |
| Golden PROJECT      |     53.22s / 45.61s |                    2,974 / 1,936 |                     3,981 / 2,506 |  3 passed |
| Publication cleanup |    87.49s / 105.14s |                    1,680 / 1,578 |                     1,660 / 1,524 | 34 passed |

Golden PROJECT eliminates **34.9% of worktree listings** and **37.1% of tracked-path scans**. Cleanup eliminates only
**6.1%** and **8.2%**, respectively, so these bounded read changes help it much less. Both profiles have exactly the
same test-name inventory as their earlier runs. All real Git operations, persisted Sessions, restart/recovery paths, and
assertions remain enabled. The final full suite also retains every previous case.

The next optimization target is Golden/module/external-fixture startup, followed by genuinely redundant durable writes.
Do not broaden the migration cache across separate writes, locks, or external work merely to remove the remaining
inspections. Concurrent CI runs also need separate measurement before deciding whether a shared machine worker limit or
reuse of an identical completed validation would help release time without skipping required checks.

A final skill-sync recheck still reports the unrelated `ideator.md`/published-skill mismatch. It has not been suppressed
or re-baselined by this work. Full CI is therefore **not green**, despite all migration and Golden cases passing.

Additional evidence under `/private/tmp/runwield-migration-speed/`: `profile-comparison.json`, per-profile JUnit,
`sequence-first/`, `sequence-second/`, `golden-project/`, and `cleanup/` command traces and CPU profiles.
