/**
 * Runs the test suite with each file in its own process and its own sandbox.
 *
 * `deno test --parallel` runs every test file in one process, giving each its
 * own module realm but sharing cwd, environment and the filesystem. Realms are
 * initialized at arbitrary moments, so one file's `Deno.chdir` or `Deno.env.set`
 * is visible to every other file — and a module-scope snapshot taken during that
 * window keeps the wrong value for the life of the realm. That is the root of
 * every flake and every stray write this runner exists to prevent, including
 * test runs rewriting the developer's real ~/.wld and mnemosyne database.
 *
 * One process per file removes the sharing instead of policing it, and no child
 * can reach the real HOME or the real mnemosyne database.
 *
 * Sandboxes are per worker slot rather than per file. A sandbox HOME shared by
 * concurrent processes is not safe — extractBundledAgentDefs() deletes and
 * rewrites ~/.wld/bundled-agent-definitions unconditionally, so one process
 * would wipe the cache while another read it. Per-slot sandboxes keep every
 * concurrently-running file on its own HOME while rebuilding that cache once
 * per slot instead of once per file, which is where the wall-clock cost was.
 * Files sharing a slot run sequentially and clean up after themselves.
 *
 * DENO_DIR is shared across all slot sandboxes for one run, but it is still a
 * temp directory owned by this runner rather than the developer's real cache.
 * The shared cache is prewarmed once with `deno test --no-run` before isolated
 * children start, so slot-local HOME does not force every child through a
 * separate cold module cache.
 *
 * Usage:
 *   deno run -A scripts/run-tests.js                    isolated run of every test file
 *   deno run -A scripts/run-tests.js --isolated <paths> isolated parallel run of matching files
 *   deno run -A scripts/run-tests.js <deno test args>   single sandboxed `deno test` (subsets, filters)
 *
 * `--exclude <path>` drops a file or directory from the discovered set. It is how
 * `deno task test` leaves the Golden TUI portfolio to `deno task test:golden-tui`,
 * so the everyday gate does not pay for the composed scenario runs. It applies to
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
import { join, relative, resolve } from "@std/path";
import { runWithSnip, writeSnipCommandResult } from "./run-with-snip.ts";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
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
const DENO_SNIP_FILTER_FILES = ["deno-check.yaml", "deno-fmt.yaml", "deno-lint.yaml", "deno-test.yaml"];

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
    const snipFiltersDir = join(home, ".config", "snip", "filters");
    await Promise.all([
        Deno.mkdir(join(home, ".wld"), { recursive: true }),
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
        WLD_TEST_SANDBOX_HOME: home,
        MNEMOSYNE_DB_PATH: join(home, "mnemosyne-test.db"),
        SNIP_DB_PATH: join(home, "snip-tracking.db"),
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
 * @param {string[]} args
 * @returns {Promise<void>}
 */
async function printSingleRunTestNames(args) {
    const names = [];
    for (const arg of args) {
        if (arg.startsWith("-")) continue;
        const path = resolve(REPO_ROOT, arg);
        let stat;
        try {
            stat = await Deno.stat(path);
        } catch {
            continue;
        }
        if (!stat.isFile || !TEST_FILE_PATTERN.test(path)) continue;
        const text = await Deno.readTextFile(path);
        for (const match of text.matchAll(/Deno\.test\(\s*["'`]([^"'`]+)["'`]/g)) {
            names.push(match[1]);
        }
    }
    for (const name of names) console.log(`passed test: ${name}`);
}

/**
 * @typedef {Object} RunnerArguments
 * @property {string[]} excludedPaths absolute file or directory paths to drop from discovery
 * @property {string[]} rest every remaining argument, in the order it was given
 */

/**
 * @param {string[]} args
 * @returns {RunnerArguments}
 */
function parseRunnerArguments(args) {
    /** @type {string[]} */
    const excludedPaths = [];
    /** @type {string[]} */
    const rest = [];
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] !== "--exclude") {
            rest.push(args[index]);
            continue;
        }
        const value = args[++index];
        if (!value) throw new Error("--exclude requires a test file or directory.");
        excludedPaths.push(resolve(REPO_ROOT, value));
    }
    return { excludedPaths, rest };
}

/**
 * @param {string} file
 * @param {string[]} excludedPaths
 * @returns {boolean}
 */
function isExcluded(file, excludedPaths) {
    return excludedPaths.some((excluded) => file === excluded || file.startsWith(`${excluded}/`));
}

/**
 * Runs every discovered test file in its own process.
 *
 * @param {string} sandboxRoot
 * @param {string} denoDir
 * @param {string[]} [roots]
 * @param {string[]} [excludedPaths]
 * @returns {Promise<number>} process exit code
 */
async function runIsolatedSuite(sandboxRoot, denoDir, roots = [REPO_ROOT], excludedPaths = []) {
    const discovered = new Set();
    for (const root of roots) {
        const path = resolve(REPO_ROOT, root);
        const stat = await Deno.stat(path);
        if (stat.isFile) {
            if (TEST_FILE_PATTERN.test(path)) discovered.add(path);
            continue;
        }
        for await (const file of findTestFiles(path)) discovered.add(file);
    }
    const files = [...discovered].filter((file) => !isExcluded(file, excludedPaths)).sort();

    const prewarmEnv = await createSandboxEnv(sandboxRoot, "prewarm", denoDir);
    await prewarmDenoDir(prewarmEnv, ["-A", "--no-check", "--quiet", ...files]);

    // Golden TUI files create nested child processes. Running one worker per CPU
    // can starve those children long enough to trigger false workflow timeouts,
    // so the safe default is deliberately bounded. WLD_TEST_CONCURRENCY remains
    // available for machines whose process budget has been measured separately.
    const configured = Number(Deno.env.get("WLD_TEST_CONCURRENCY") || "");
    const concurrency = Number.isFinite(configured) && configured > 0
        ? Math.floor(configured)
        : Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 4));
    const queue = [...files];
    /** @type {Array<{ file: string, failureLogPath: string }>} */
    const failures = [];
    let completed = 0;
    const startedAt = Date.now();

    /** @param {number} slot */
    const worker = async (slot) => {
        const env = await createSandboxEnv(sandboxRoot, `slot-${slot}`, denoDir);
        while (queue.length > 0) {
            const file = queue.shift();
            if (!file) return;
            const name = relative(REPO_ROOT, file);
            const result = await runWithSnip("deno", ["test", "-A", "--no-check", "--quiet", file], {
                cwd: REPO_ROOT,
                env,
                failureLabel: "tests",
            });
            completed += 1;
            if (result.code !== 0) {
                failures.push({
                    file: name,
                    failureLogPath: result.failureLogPath || "failure log unavailable",
                });
            }
        }
    };

    await Promise.all(Array.from({ length: concurrency }, (_unused, slot) => worker(slot)));

    failures.sort((left, right) => left.file.localeCompare(right.file));
    for (const failure of failures) console.log(`FAIL ${failure.file} — failure log: ${failure.failureLogPath}`);
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
        `\n${failures.length === 0 ? "ok" : "FAILED"} | ${completed - failures.length} files passed | ` +
            `${failures.length} failed (${seconds}s, ${concurrency} at a time)`,
    );
    return failures.length === 0 ? 0 : 1;
}

const sandboxRoot = await Deno.makeTempDir({ prefix: "runwield-test-sandboxes-" });
const denoDir = join(sandboxRoot, "deno-dir");
await Deno.mkdir(denoDir, { recursive: true });

// Deliberately not Deno.exit() inside try/finally: Deno.exit terminates without
// running finally blocks, which left ~600MB of sandboxes behind per run.
let exitCode = 0;
const { excludedPaths, rest: runnerArgs } = parseRunnerArguments(Deno.args);
try {
    if (runnerArgs[0] === "--isolated") {
        const roots = runnerArgs.slice(1);
        if (roots.length === 0) throw new Error("--isolated requires at least one test file or directory.");
        exitCode = await runIsolatedSuite(sandboxRoot, denoDir, roots, excludedPaths);
    } else if (runnerArgs.length > 0) {
        // Explicit paths or flags: one sandboxed process, arguments passed through.
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
        const result = await runWithSnip("deno", ["test", ...testArgs], {
            env,
            stdin: "inherit",
            failureLabel: "tests",
        });
        await writeSnipCommandResult(result);
        if (result.code === 0) await printSingleRunTestNames(runnerArgs);
        exitCode = result.code;
    } else {
        exitCode = await runIsolatedSuite(sandboxRoot, denoDir, [REPO_ROOT], excludedPaths);
    }
} finally {
    await Deno.remove(sandboxRoot, { recursive: true }).catch(() => {});
}

Deno.exit(exitCode);
