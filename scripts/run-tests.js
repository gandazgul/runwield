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
 *   deno run -A scripts/run-tests.js <deno test args>   single sandboxed `deno test` (subsets, filters)
 *
 * The passthrough form injects `-A` unless the caller passed their own
 * permission flags: without env access the sandbox marker in src/constants.js
 * is unreadable and its guard misfires, blaming a direct `deno test` run.
 */
import { join, relative } from "@std/path";

const REPO_ROOT = new URL("..", import.meta.url).pathname;
const TEST_FILE_PATTERN = /(^|\/)(test|.+[._]test)\.(js|mjs|jsx|ts|tsx|mts)$/;
const SKIP_DIRS = new Set(["node_modules", "third_party", "dist", "bin", "_fresh", ".git", ".astro", ".history"]);

/** @param {string} dir @returns {AsyncGenerator<string>} */
async function* findTestFiles(dir) {
    for await (const entry of Deno.readDir(dir)) {
        if (entry.isDirectory) {
            if (SKIP_DIRS.has(entry.name)) continue;
            yield* findTestFiles(join(dir, entry.name));
        } else if (TEST_FILE_PATTERN.test(entry.name)) {
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
    await Deno.mkdir(join(home, ".wld"), { recursive: true });
    // WLD_TEST_SANDBOX_HOME is the marker src/constants.js refuses to run without.
    return {
        HOME: home,
        WLD_TEST_SANDBOX_HOME: home,
        MNEMOSYNE_DB_PATH: join(home, "mnemosyne-test.db"),
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
 * Runs every discovered test file in its own process.
 *
 * @param {string} sandboxRoot
 * @param {string} denoDir
 * @returns {Promise<number>} process exit code
 */
async function runIsolatedSuite(sandboxRoot, denoDir) {
    /** @type {string[]} */
    const files = [];
    for await (const file of findTestFiles(REPO_ROOT)) files.push(file);
    files.sort();

    const prewarmEnv = await createSandboxEnv(sandboxRoot, "prewarm", denoDir);
    await prewarmDenoDir(prewarmEnv, ["-A", "--no-check", "--quiet", ...files]);

    // Core count, measured: child startup is CPU-bound (module graph loading), so
    // oversubscribing loses time — on a 12-core machine 12 ran in 40.9s, 18 in
    // 49.8s, 24 in 45.4s. WLD_TEST_CONCURRENCY overrides it for other hardware.
    const configured = Number(Deno.env.get("WLD_TEST_CONCURRENCY") || "");
    const concurrency = Number.isFinite(configured) && configured > 0
        ? Math.floor(configured)
        : Math.max(1, Math.min(navigator.hardwareConcurrency || 4, 16));
    const queue = [...files];
    /** @type {Array<{ file: string, output: string }>} */
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
            const result = await new Deno.Command(Deno.execPath(), {
                args: ["test", "-A", "--no-check", "--quiet", file],
                cwd: REPO_ROOT,
                env,
                stdout: "piped",
                stderr: "piped",
            }).output();
            completed += 1;
            if (!result.success) {
                const decoder = new TextDecoder();
                failures.push({
                    file: name,
                    output: `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`,
                });
                console.log(`FAIL ${name}`);
            }
        }
    };

    await Promise.all(Array.from({ length: concurrency }, (_unused, slot) => worker(slot)));

    for (const failure of failures) {
        console.log(`\n${"=".repeat(78)}\n${failure.file}\n${"=".repeat(78)}\n${failure.output}`);
    }
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
try {
    if (Deno.args.length > 0) {
        // Explicit paths or flags: one sandboxed process, arguments passed through.
        const env = await createSandboxEnv(sandboxRoot, "single", denoDir);
        // Grant full permissions unless the caller passed their own permission
        // flags — `-A` conflicts with explicit `--allow-*` grants, so it cannot
        // be injected unconditionally. `--deny-*` narrows allow-all safely.
        const hasPermissionFlags = Deno.args.some((arg) =>
            arg === "-A" || arg === "--allow-all" || arg.startsWith("--allow-")
        );
        const testArgs = hasPermissionFlags ? Deno.args : ["-A", ...Deno.args];
        await prewarmDenoDir(env, testArgs);
        const child = new Deno.Command(Deno.execPath(), {
            args: ["test", ...testArgs],
            env,
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
        }).spawn();
        exitCode = (await child.status).code;
    } else {
        exitCode = await runIsolatedSuite(sandboxRoot, denoDir);
    }
} finally {
    await Deno.remove(sandboxRoot, { recursive: true }).catch(() => {});
}

Deno.exit(exitCode);
