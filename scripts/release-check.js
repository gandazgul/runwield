/**
 * Run the local release preflight: build the standalone binary with the same
 * script used by the release workflow, then smoke-test the native executable.
 */

import { join } from "@std/path";

/**
 * @typedef {Object} RunResult
 * @property {boolean} success
 * @property {number} code
 */

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<RunResult>}
 */
async function run(command, args) {
    const child = new Deno.Command(command, {
        args,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    });
    const { success, code } = await child.output();
    return { success, code };
}

/**
 * @param {string} label
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<void>}
 */
async function mustRun(label, command, args) {
    console.log(`\n==> ${label}`);
    const result = await run(command, args);
    if (!result.success) {
        throw new Error(`${label} failed with exit code ${result.code}.`);
    }
}

const tempDir = await Deno.makeTempDir({ prefix: "wld-release-check-" });
const binaryName = Deno.build.os === "windows" ? "wld.exe" : "wld";
const output = join(tempDir, binaryName);

try {
    await mustRun("Compile release binary", "deno", ["run", "-A", "scripts/compile.js", "--output", output]);
    await mustRun("Smoke test release binary", output, ["--version"]);
} finally {
    await Deno.remove(tempDir, { recursive: true }).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
}
