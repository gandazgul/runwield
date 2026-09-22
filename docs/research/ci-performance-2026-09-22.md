# CI and Golden TUI performance — 2026-09-22

## Scope and constraints

Keep every existing test and assertion. Exercise real RunWield Runtime, workflow, storage, locking, Git, and terminal
composition. Script only external services. Successful commands should give a short summary; diagnostic and timing files
remain available without verbose console output.

## Ranking and reevaluation

The final ranking prioritizes release wall time, then measured local savings. Hosted estimates remain unverified until a
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
2. **Measure greater local concurrency and scheduling.** Twelve workers are being compared with the existing eight.
   Scheduling currently discards measurements until a file has three observations, even though changing execution order
   cannot remove coverage. Replaying the previous complete suite's measured durations predicts a 31.7s shorter tail at
   twelve workers when all observations are used; this is a scheduling simulation, not a wall-time claim.
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
| Vite+ / Vitest under Deno            | at least 111.8s |                         111.8s |                        64.2s |

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
