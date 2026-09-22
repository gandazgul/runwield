/**
 * Runs the test suite with each file in its own process and its own sandbox.
 *
 * `deno test --parallel` runs every test file in one process, giving each its
 * own module realm but sharing cwd, environment and the filesystem. Realms are
 * initialized at arbitrary moments, so one file's `Deno.chdir` or `Deno.env.set`
 * is visible to every other file — and a module-scope snapshot taken during that
 * window keeps the wrong value for the life of the realm. That is the root of
 * every flake and every stray write this runner exists to prevent, including
 * test runs rewriting the developer's real ~/.wld and mnemoteca database.
 *
 * One process per file removes the sharing instead of policing it, and no child
 * can reach the real HOME or the real mnemoteca database.
 *
 * Every file gets a fresh HOME and temporary directory, including files sharing
 * a worker slot. Only dependency caches and immutable fixture templates may be
 * shared; mutable settings, stores, registry entries, and locks stay isolated.
 *
 * DENO_DIR is shared across all slot sandboxes for one run, but it is still a
 * temp directory owned by this runner rather than the developer's real cache.
 * The shared cache is prewarmed once with `deno test --no-run` before isolated
 * children start, so slot-local HOME does not force every child through a
 * separate cold module cache.
 * Prewarming also installs npm dependencies. Workers use that node_modules
 * directory in manual mode, avoiding repeated installation scans in every file.
 *
 * Usage:
 *   deno run -A scripts/run-tests.js                    isolated run of every test file
 *   deno run -A scripts/run-tests.js --isolated <paths> isolated parallel run of matching files
 *   deno run -A scripts/run-tests.js <deno test args>   single sandboxed `deno test` (subsets, filters)
 *
 * `--exclude <path>` drops a file or directory from the discovered set. It is how
 * `deno task test` leaves the Golden TUI portfolio to `deno task test:golden-tui`,
 * while `deno task ci` includes both in one worker pool. It applies to
 * discovery only, so it has no effect on the passthrough `deno test` form.
 *
 * The passthrough form injects `-A` unless the caller passed their own
 * permission flags: without env access the sandbox marker in src/constants.js
 * is unreadable and its guard misfires, blaming a direct `deno test` run.
 * It also injects `--no-check` (matching the full-suite path and every task
 * invocation) unless the caller passed it: type-checking here resolves
 * deno.json's `compilerOptions.types` graph, whose `"vite/client"` entry pulls
 * npm:vite on every run — a large registry download on cold caches. The type
 * gate is `deno task check`, not these sandboxed executions.
 */
import { retainTestEvidence } from "./retain-test-evidence.js";
import { basename, dirname, fromFileUrl, join, relative, resolve } from "@std/path";
import { listCiFiles } from "./ci-files.ts";
import { runWithSnip, writeSnipCommandResult } from "./run-with-snip.ts";
import { mergeTestTimings, orderTestsByTiming, readTestTimings, writeTestTimings } from "./test-timings.js";

const REPO_ROOT = dirname(dirname(fromFileUrl(import.meta.url)));
const TEST_FILE_PATTERN = /(^|\/)(test|.+[._]test)\.(js|mjs|jsx|ts|tsx|mts)$/;
const SKIP_DIRS = new Set([
    "node_modules",
    "third_party",
    "dist",
    "bin",
    "_fresh",
    ".git",
    ".astro",
    ".history",
    ".wld",
]);
const DENO_SNIP_FILTER_FILES = [
    "deno-check.yaml",
    "deno-fmt.yaml",
    "deno-lint.yaml",
    "deno-test.yaml",
    "deno-task.yaml",
];

/** @param {string} dir @returns {AsyncGenerator<string>} */
async function* findTestFiles(dir) {
    for await (const entry of Deno.readDir(dir)) {
        if (entry.isDirectory) {
            if (SKIP_DIRS.has(entry.name)) continue;
            yield* findTestFiles(join(dir, entry.name));
        } else if (!entry.name.startsWith("__debug") && TEST_FILE_PATTERN.test(entry.name)) {
            // Throwaway debug harnesses (files starting with `__debug`) never run in the
            // discovered suite; they are diagnosis scratch and may fail by design. Run one
            // explicitly by passing its path as an argument.
            yield join(dir, entry.name);
        }
    }
}

/**
 * @param {string} sandboxRoot
 * @param {string} name
 * @param {string} denoDir
 * @returns {Promise<Record<string, string>>}
 */
async function createSandboxEnv(sandboxRoot, name, denoDir) {
    const home = join(sandboxRoot, name);
    const temp = join(sandboxRoot, `tmp-${name}`);
    const snipFiltersDir = join(home, ".config", "snip", "filters");
    await Promise.all([
        Deno.mkdir(join(home, ".wld"), { recursive: true }),
        Deno.mkdir(join(home, "AppData", "Roaming"), { recursive: true }),
        Deno.mkdir(join(home, "AppData", "Local"), { recursive: true }),
        Deno.mkdir(temp, { recursive: true }),
        Deno.mkdir(snipFiltersDir, { recursive: true }),
    ]);
    await Promise.all(
        DENO_SNIP_FILTER_FILES.map((fileName) =>
            Deno.copyFile(join(REPO_ROOT, "src", "snip-filters", fileName), join(snipFiltersDir, fileName))
        ),
    );
    // WLD_TEST_SANDBOX_HOME is the marker src/constants.js refuses to run without.
    return {
        HOME: home,
        USERPROFILE: home,
        APPDATA: join(home, "AppData", "Roaming"),
        LOCALAPPDATA: join(home, "AppData", "Local"),
        WLD_TEST_SANDBOX_HOME: home,
        MNEMOTECA_DB_PATH: join(home, "mnemoteca-test.db"),
        SNIP_DB_PATH: join(home, "snip-tracking.db"),
        TMPDIR: temp,
        TEMP: temp,
        TMP: temp,
        DENO_DIR: denoDir,
    };
}

/**
 * @param {Record<string, string>} env
 * @param {string[]} testArgs
 * @returns {Promise<void>}
 */
async function prewarmDenoDir(env, testArgs) {
    const child = new Deno.Command(Deno.execPath(), {
        args: ["test", "--no-run", ...testArgs],
        cwd: REPO_ROOT,
        env,
        stdout: "piped",
        stderr: "piped",
    });
    const result = await child.output();
    if (result.success) return;

    const decoder = new TextDecoder();
    const output = `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`;
    throw new Error(`Deno cache prewarm failed:\n${output}`);
}

/**
 * @typedef {Object} RunnerArguments
 * @property {string[]} excludedPaths absolute file or directory paths to drop from discovery
 * @property {boolean} failFast stop scheduling files after the first failure
 * @property {string | undefined} timingsFile timing history input and output path
 * @property {string | undefined} shard one-based shard index/count
 * @property {string | undefined} reportDir directory for per-test JUnit reports
 * @property {string[]} rest every remaining argument, in the order it was given
 */

/**
 * @param {string[]} args
 * @returns {RunnerArguments}
 */
export function parseRunnerArguments(args) {
    /** @type {string[]} */
    const excludedPaths = [];
    /** @type {string[]} */
    const rest = [];
    let failFast = false;
    let timingsFile;
    let reportDir;
    let shard = Deno.env.get("WLD_TEST_SHARD");
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--fail-fast") {
            failFast = true;
            continue;
        }
        if (arg === "--shard") {
            shard = args[++index];
            if (!shard) throw new Error("--shard requires index/count.");
            continue;
        }
        if (arg === "--report-dir") {
            const value = args[++index];
            if (!value) throw new Error("--report-dir requires a path.");
            reportDir = resolve(REPO_ROOT, value);
            continue;
        }
        if (arg === "--timings-file") {
            const value = args[++index];
            if (!value) throw new Error("--timings-file requires a path.");
            timingsFile = resolve(REPO_ROOT, value);
            continue;
        }
        if (arg !== "--exclude") {
            rest.push(arg);
            continue;
        }
        const value = args[++index];
        if (!value) throw new Error("--exclude requires a test file or directory.");
        excludedPaths.push(resolve(REPO_ROOT, value));
    }
    return { excludedPaths, failFast, timingsFile, reportDir, shard, rest };
}

/**
 * Assign every file exactly once, independent of each runner's timing cache.
 * Sorting before round-robin assignment makes filesystem traversal irrelevant.
 * @param {string[]} files
 * @param {string | undefined} shard
 * @returns {string[]}
 */
export function selectTestShard(files, shard) {
    if (!shard) return files;
    const match = /^(\d+)\/(\d+)$/.exec(shard);
    const index = Number(match?.[1]);
    const count = Number(match?.[2]);
    if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index < 1 || count < index) {
        throw new Error(`Invalid test shard ${shard}; expected index/count with 1 <= index <= count.`);
    }
    return [...files].sort().filter((_file, position) => position % count === index - 1);
}

/**
 * @param {string} root
 * @param {string} file
 * @returns {boolean}
 */
function isPathAtOrBelow(root, file) {
    if (file === root) return true;
    const child = relative(root, file);
    return child !== "" && child !== "." && !child.startsWith("..") && !child.startsWith("/") &&
        !/^[A-Za-z]:[\\/]/.test(child);
}

/**
 * @param {string} file
 * @param {string[]} excludedPaths
 * @returns {boolean}
 */
function isExcluded(file, excludedPaths) {
    return excludedPaths.some((excluded) => isPathAtOrBelow(excluded, file));
}

/**
 * @typedef {Object} SuiteOptions
 * @property {boolean} [failFast]
 * @property {string} [timingsFile]
 * @property {string} [reportDir]
 * @property {string} [shard]
 */

/**
 * @param {string} sandboxRoot
 * @param {string} denoDir
 * @param {string[]} [roots]
 * @param {string[]} [excludedPaths]
 * @param {SuiteOptions} [options]
 * @returns {Promise<number>} process exit code
 */
async function runIsolatedSuite(sandboxRoot, denoDir, roots = [REPO_ROOT], excludedPaths = [], options = {}) {
    const suiteStart = performance.now();
    if (options.reportDir) await Deno.mkdir(options.reportDir, { recursive: true });
    const discovered = new Set();
    const repositoryFiles = (await listCiFiles(REPO_ROOT)).map((file) => resolve(REPO_ROOT, file));
    for (const root of roots) {
        const path = resolve(REPO_ROOT, root);
        const stat = await Deno.stat(path);
        if (stat.isFile) {
            if (TEST_FILE_PATTERN.test(path)) discovered.add(path);
            continue;
        }
        if (isPathAtOrBelow(REPO_ROOT, path)) {
            for (const file of repositoryFiles) {
                if (
                    isPathAtOrBelow(path, file) && !basename(file).startsWith("__debug") && TEST_FILE_PATTERN.test(file)
                ) {
                    discovered.add(file);
                }
            }
            continue;
        }
        for await (const file of findTestFiles(path)) discovered.add(file);
    }
    const discoveredFiles = [...discovered].filter((file) => !isExcluded(file, excludedPaths)).sort();
    const previousTimings = options.timingsFile ? await readTestTimings(options.timingsFile) : {};
    const files = orderTestsByTiming(selectTestShard(discoveredFiles, options.shard), REPO_ROOT, previousTimings);

    let goldenFixtureRoot = "";
    if (files.some((file) => file.includes("/src/ui/tui/golden-scenarios/"))) {
        const { prepareGoldenRepositoryTemplates } = await import("../src/ui/tui/testing/isolated-environment.js");
        goldenFixtureRoot = join(sandboxRoot, "golden-fixtures");
        await prepareGoldenRepositoryTemplates(goldenFixtureRoot);
    }

    const prewarmStart = performance.now();
    const prewarmEnv = await createSandboxEnv(sandboxRoot, "prewarm", denoDir);
    if (files.length) await prewarmDenoDir(prewarmEnv, ["-A", "--no-check", "--quiet", ...files]);

    const prewarmMs = performance.now() - prewarmStart;

    // Most integration work waits on Git and other subprocesses. Keep enough
    // independent files in flight to use the machine, with an explicit override
    // for smaller CI runners and concurrent local workloads.
    const configured = Number(Deno.env.get("WLD_TEST_CONCURRENCY") || "");
    const concurrency = Number.isFinite(configured) && configured > 0
        ? Math.max(1, Math.floor(configured))
        : Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 8));
    const queue = [...files];
    /** @type {Array<{ file: string, failureLogPath: string }>} */
    const failures = [];
    /** @type {Array<{ file: string, durationMs: number }>} */
    const observedTimings = [];
    let completed = 0;
    let stopScheduling = false;
    const startedAt = Date.now();

    /** @param {number} slot */
    const worker = async (slot) => {
        let slotRuns = 0;
        while (queue.length > 0 && !stopScheduling) {
            const file = queue.shift();
            if (!file) return;
            const name = relative(REPO_ROOT, file);
            const fileStartedAt = Date.now();

            const env = await createSandboxEnv(sandboxRoot, `slot-${slot}-file-${slotRuns}`, denoDir);
            // Nested runner tests must exercise their entire fixture suite.
            env.WLD_TEST_SHARD = "";
            if (goldenFixtureRoot) env.WLD_GOLDEN_FIXTURE_ROOT = goldenFixtureRoot;
            slotRuns += 1;
            const reportArgs = options.reportDir
                ? ["--junit-path", join(options.reportDir, `${name.replace(/[^a-zA-Z0-9.-]/g, "_")}.xml`)]
                : [];
            const result = await runWithSnip("deno", [
                "test",
                "-A",
                "--no-check",
                "--node-modules-dir=manual",
                "--quiet",
                ...reportArgs,
                file,
            ], {
                cwd: REPO_ROOT,
                env,
                failureLabel: "tests",
            });
            const durationMs = Date.now() - fileStartedAt;
            observedTimings.push({ file: name, durationMs });

            completed += 1;
            if (result.code !== 0) {
                failures.push({
                    file: name,
                    failureLogPath: result.failureLogPath || "failure log unavailable",
                });
                if (options.failFast) stopScheduling = true;
            }
        }
    };

    await Promise.all(Array.from({ length: concurrency }, (_unused, slot) => worker(slot)));

    failures.sort((left, right) => left.file.localeCompare(right.file));
    for (const failure of failures) console.log(`FAIL ${failure.file} — failure log: ${failure.failureLogPath}`);
    if (options.timingsFile) {
        await writeTestTimings(options.timingsFile, mergeTestTimings(previousTimings, observedTimings));
    }
    if (options.reportDir) {
        await Deno.writeTextFile(
            join(options.reportDir, "run.json"),
            JSON.stringify(
                {
                    elapsedMs: performance.now() - suiteStart,
                    prewarmMs,
                    concurrency,
                    shard: options.shard || null,
                    completed,
                    failed: failures.length,
                    skipped: files.length - completed,
                    files: observedTimings,
                },
                null,
                2,
            ) + "\n",
        );
    }
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
        `\n${failures.length === 0 ? "ok" : "FAILED"} | ${completed - failures.length} files passed | ` +
            `${failures.length} failed | ${files.length - completed} skipped (${seconds}s, ${concurrency} at a time)`,
    );
    return failures.length === 0 ? 0 : 1;
}

export async function main(args = Deno.args) {
    const {
        excludedPaths,
        failFast,
        shard,
        timingsFile: requestedTimingsFile,
        reportDir: requestedReportDir,
        rest: runnerArgs,
    } = parseRunnerArguments(args);
    selectTestShard([], shard);
    const sandboxRoot = await Deno.makeTempDir({ prefix: "runwield-test-sandboxes-" });
    const denoDir = Deno.env.get("WLD_TEST_DENO_DIR") || join(sandboxRoot, "deno-dir");
    await Deno.mkdir(denoDir, { recursive: true });

    // Deliberately do not call Deno.exit() inside try/finally: it terminates without
    // running finally blocks, which left ~600MB of sandboxes behind per run.
    let exitCode = 0;
    const suite = runnerArgs.some((arg) => arg.includes("src/ui/tui/golden-scenarios")) &&
            !excludedPaths.some((path) => path.endsWith("src/ui/tui/golden-scenarios"))
        ? "golden"
        : "tests";
    const reportsRoot = Deno.env.get("WLD_TEST_SANDBOX_HOME") ? sandboxRoot : join(REPO_ROOT, ".ci-cache");
    const suffix = shard ? `-${shard.replace("/", "-of-")}` : "";
    const reportDir = requestedReportDir || join(reportsRoot, `${suite}${suffix}-report`);
    const timingsFile = requestedTimingsFile || join(reportsRoot, `${suite}${suffix}-timings.json`);
    try {
        if (runnerArgs[0] === "--isolated") {
            const roots = runnerArgs.slice(1);
            if (roots.length === 0) throw new Error("--isolated requires at least one test file or directory.");
            exitCode = await runIsolatedSuite(sandboxRoot, denoDir, roots, excludedPaths, {
                failFast,
                timingsFile,
                reportDir,
                shard,
            });
        } else if (runnerArgs.length > 0) {
            // Explicit paths or flags: one sandboxed process, arguments passed through.
            if (shard) throw new Error("--shard requires isolated discovery; use --isolated <paths>.");
            const env = await createSandboxEnv(sandboxRoot, "single", denoDir);
            // Grant full permissions unless the caller passed their own permission
            // flags — `-A` conflicts with explicit `--allow-*` grants, so it cannot
            // be injected unconditionally. `--deny-*` narrows allow-all safely.
            const hasPermissionFlags = runnerArgs.some((arg) =>
                arg === "-A" || arg === "--allow-all" || arg.startsWith("--allow-")
            );
            const testArgs = hasPermissionFlags ? runnerArgs : ["-A", ...runnerArgs];
            // Match the full-suite path (runIsolatedSuite) and every task invocation
            // (test:golden-tui, workspace:test) by running tests with `--no-check`
            // unless the caller already asked for type-checking. Type-checking here
            // resolves deno.json's whole `compilerOptions.types` graph — the
            // `"vite/client"` entry pulls npm:vite and its dependencies on every
            // invocation, a large registry download on any machine without a warm
            // cache that can blow past minute-scale budgets before a single test
            // runs. `deno task check` owns type-checking; these children are
            // sandboxed executions, not the type gate.
            if (!testArgs.includes("--no-check")) testArgs.push("--no-check");
            await prewarmDenoDir(env, testArgs);
            // Preserve explicit dependency modes for loader diagnostics. Otherwise
            // use the installation just prepared by the real no-run invocation.
            const executionArgs = testArgs.some((arg) => arg.startsWith("--node-modules-dir"))
                ? testArgs
                : ["--node-modules-dir=manual", ...testArgs];
            const result = await runWithSnip("deno", ["test", ...executionArgs], {
                env,
                stdin: "inherit",
                failureLabel: "tests",
            });
            await writeSnipCommandResult(result);

            exitCode = result.code;
        } else {
            exitCode = await runIsolatedSuite(sandboxRoot, denoDir, [REPO_ROOT], excludedPaths, {
                failFast,
                timingsFile,
                reportDir,
                shard,
            });
        }
    } finally {
        if (exitCode !== 0) {
            const destination = `${sandboxRoot}-evidence`;
            await retainTestEvidence(sandboxRoot, destination);
            console.error(`Retained test evidence: ${destination}`);
        }
        await Deno.remove(sandboxRoot, { recursive: true }).catch(() => {});
    }
    return exitCode;
}

if (import.meta.main) Deno.exit(await main());
