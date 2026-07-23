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
 * @param {Deno.CommandOptions} [options]
 * @returns {Promise<RunResult>}
 */
async function run(command, args, options = {}) {
    const child = new Deno.Command(command, {
        ...options,
        args,
        stdin: options.stdin || "inherit",
        stdout: options.stdout || "inherit",
        stderr: options.stderr || "inherit",
    });
    const { success, code } = await child.output();
    return { success, code };
}

/**
 * @param {string} label
 * @param {string} command
 * @param {string[]} args
 * @param {Deno.CommandOptions} [options]
 * @returns {Promise<void>}
 */
async function mustRun(label, command, args, options = {}) {
    console.log(`\n==> ${label}`);
    const result = await run(command, args, options);
    if (!result.success) {
        throw new Error(`${label} failed with exit code ${result.code}.`);
    }
}

/** @param {ReadableStream<Uint8Array> | null} stream @param {(text: string) => void} onText */
async function collectStream(stream, onText) {
    if (!stream) return;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        onText(decoder.decode(value, { stream: true }));
    }
    const tail = decoder.decode();
    if (tail) onText(tail);
}

/** @param {string} output */
function readReviewUrl(output) {
    return output.match(/http:\/\/127\.0\.0\.1:\d+\/review\/plan\?token=[^\s]+/)?.[0] || "";
}

/** @param {string} html */
function assertBinaryReviewHtml(html) {
    if (html.includes("Workspace review UI assets are unavailable")) {
        throw new Error("Standalone binary rendered the old unavailable-assets review page.");
    }
    if (html.includes("built-in review surface")) {
        throw new Error("Standalone binary rendered a review fallback instead of the real Astro UI.");
    }
    if (html.includes("Workspace Astro build unavailable")) {
        throw new Error("Standalone binary rendered the Workspace build-unavailable error.");
    }
    if (!html.includes("data-astro-review-shell")) throw new Error("Standalone binary review shell did not render.");
    if (!html.includes("astro-island")) throw new Error("Standalone binary review page lacks Astro island markup.");
    if (!html.includes("/_astro/")) throw new Error("Standalone binary review page lacks built Astro asset links.");
    if (!html.includes("Release binary review smoke")) {
        throw new Error("Standalone binary review page did not include the smoke-test Plan content.");
    }
}

/**
 * @param {string} binaryPath
 * @param {string} root
 */
async function smokeTestBinaryReviewSurface(binaryPath, root) {
    console.log("\n==> Smoke test standalone review surface");
    const projectDir = join(root, "project");
    await Deno.mkdir(join(projectDir, "plans"), { recursive: true });
    await Deno.writeTextFile(
        join(projectDir, "plans", "release-review-smoke.md"),
        `---\nplanId: release-review-smoke\nclassification: FEATURE\nstatus: draft\n---\n# Release binary review smoke\n`,
    );

    const child = new Deno.Command(binaryPath, {
        args: ["plans", "read", "release-review-smoke"],
        cwd: projectDir,
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
    }).spawn();

    let output = "";
    /** @param {string} text */
    const append = (text) => {
        output += text;
    };
    const stdoutDone = collectStream(child.stdout, append);
    const stderrDone = collectStream(child.stderr, append);

    let url = "";
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        url = readReviewUrl(output);
        if (url) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!url) {
        try {
            child.kill("SIGTERM");
        } catch {
            // Process may have exited before printing a URL.
        }
        await Promise.allSettled([child.status, stdoutDone, stderrDone]);
        throw new Error(`Standalone binary did not print a review URL. Output:\n${output}`);
    }

    try {
        const response = await fetch(url);
        const html = await response.text();
        if (response.status !== 200) throw new Error(`Review URL returned ${response.status}: ${html.slice(0, 200)}`);
        assertBinaryReviewHtml(html);

        const token = new URL(url).searchParams.get("token") || "";
        const origin = new URL(url).origin;
        await fetch(`${origin}/api/review/exit?token=${encodeURIComponent(token)}`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-runwield-review-token": token },
            body: JSON.stringify({ reviewType: "plan" }),
        });
        const status = await child.status;
        if (!status.success) throw new Error(`Standalone review command exited ${status.code}. Output:\n${output}`);
    } finally {
        try {
            child.kill("SIGTERM");
        } catch {
            // Process already exited after the review close request.
        }
        await Promise.allSettled([child.status, stdoutDone, stderrDone]);
    }
}

const tempDir = await Deno.makeTempDir({ prefix: "wld-release-check-" });
const binaryName = Deno.build.os === "windows" ? "wld.exe" : "wld";
const output = join(tempDir, binaryName);

try {
    await mustRun("Compile release binary", "deno", ["run", "-A", "scripts/compile.js", "--output", output]);
    await mustRun("Smoke test release binary", output, ["--version"]);
    await smokeTestBinaryReviewSurface(output, tempDir);
} finally {
    await Deno.remove(tempDir, { recursive: true }).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
}
