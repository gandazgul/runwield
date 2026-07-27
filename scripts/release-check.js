/**
 * Run the local release preflight: build the standalone binary with the same
 * script used by the release workflow, then smoke-test the native executable.
 */

import { join } from "@std/path";
import { buildCompileArgs } from "./compile.js";

const BUNDLED_AGENT_DEFS_SOURCE_DIR = join("src", "agent-definitions");
const BUNDLED_SKILLS_SOURCE_DIR = join("src", "skills");

const BUNDLED_EXTRACTED_MARKDOWN_TARGETS = Object.freeze([
    {
        label: "bundled agent definition",
        sourceDir: BUNDLED_AGENT_DEFS_SOURCE_DIR,
        cacheDir: join(".wld", "bundled-agent-definitions"),
    },
    {
        label: "bundled skill",
        sourceDir: BUNDLED_SKILLS_SOURCE_DIR,
        cacheDir: join(".wld", "bundled-skills"),
    },
]);

const REQUIRED_BUNDLED_BINARY_ASSET_INCLUDES = Object.freeze([
    "src/agent-definitions/",
    "src/prompt-templates/",
    "src/shared/session/SYSTEM_PROMPT_TEMPLATE.md",
    "src/skills/",
    "src/ui/theme/catppuccin-mocha.json",
]);

/**
 * @typedef {Object} RunResult
 * @property {boolean} success
 * @property {number} code
 * @property {string} stdout
 * @property {string} stderr
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
    const output = await child.output();
    const decoder = new TextDecoder();
    return {
        success: output.success,
        code: output.code,
        stdout: options.stdout === "piped" ? decoder.decode(output.stdout) : "",
        stderr: options.stderr === "piped" ? decoder.decode(output.stderr) : "",
    };
}

/**
 * @param {string} label
 * @param {string} command
 * @param {string[]} args
 * @param {Deno.CommandOptions} [options]
 * @param {typeof run} [runner]
 * @returns {Promise<RunResult>}
 */
async function mustRun(label, command, args, options = {}, runner = run) {
    console.log(`\n==> ${label}`);
    const result = await runner(command, args, options);
    if (!result.success) {
        throw new Error(`${label} failed with exit code ${result.code}.`);
    }
    return result;
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
export function readReviewUrl(output) {
    return output.match(/http:\/\/127\.0\.0\.1:\d+\/review\/plan\?token=[^\s]+/)?.[0] || "";
}

/** @param {string} html */
export function assertBinaryReviewHtml(html) {
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
 * @param {string} html
 * @param {string} baseUrl
 * @returns {string[]}
 */
export function collectReviewAssetUrls(html, baseUrl) {
    const urls = new Set();
    const attributePattern = /(?:src|href|component-url|renderer-url)=(['"])(.*?)\1/g;
    let match;
    while ((match = attributePattern.exec(html)) !== null) {
        addReviewAssetUrl(urls, match[2], baseUrl);
    }
    return [...urls];
}

/**
 * @param {Set<string>} urls
 * @param {string} rawUrl
 * @param {string} baseUrl
 */
function addReviewAssetUrl(urls, rawUrl, baseUrl) {
    if (!rawUrl || rawUrl.startsWith("data:") || rawUrl.startsWith("#")) return;
    const url = new URL(rawUrl, baseUrl);
    if (url.pathname.startsWith("/_astro/")) urls.add(url.href);
}

/**
 * @param {string} source
 * @param {string} assetUrl
 * @returns {string[]}
 */
export function collectNestedReviewAssetUrls(source, assetUrl) {
    const urls = new Set();
    const importPattern = /(?:import\s*\(\s*|from\s+)(['"])(.*?)\1/g;
    let match;
    while ((match = importPattern.exec(source)) !== null) {
        addReviewAssetUrl(urls, match[2], assetUrl);
    }
    const sideEffectImportPattern = /import\s+(['"])(.*?)\1/g;
    while ((match = sideEffectImportPattern.exec(source)) !== null) {
        addReviewAssetUrl(urls, match[2], assetUrl);
    }
    const cssUrlPattern = /url\(\s*(['"]?)(.*?)\1\s*\)/g;
    while ((match = cssUrlPattern.exec(source)) !== null) {
        addReviewAssetUrl(urls, match[2], assetUrl);
    }
    return [...urls];
}

/**
 * @param {string} pageUrl
 * @param {string} html
 */
export async function assertReviewAssetsLoad(pageUrl, html) {
    const pending = collectReviewAssetUrls(html, pageUrl);
    const seen = new Set();

    while (pending.length) {
        const assetUrl = pending.shift();
        if (!assetUrl || seen.has(assetUrl)) continue;
        seen.add(assetUrl);

        const response = await fetch(assetUrl);
        const body = await response.text();
        if (response.status !== 200) {
            throw new Error(`Review UI asset failed to load (${response.status}): ${assetUrl}\n${body.slice(0, 200)}`);
        }

        if (assetUrl.endsWith(".js") || assetUrl.endsWith(".css")) {
            for (const nestedUrl of collectNestedReviewAssetUrls(body, assetUrl)) {
                if (!seen.has(nestedUrl)) pending.push(nestedUrl);
            }
        }
    }

    if (!seen.size) throw new Error("Review UI page did not reference any loadable Astro assets.");
}

/**
 * @param {string} rootDir
 * @param {string} [relativeDir]
 * @returns {Promise<string[]>}
 */
async function collectMarkdownFiles(rootDir, relativeDir = "") {
    /** @type {string[]} */
    const files = [];
    const currentDir = relativeDir ? join(rootDir, ...relativeDir.split("/")) : rootDir;
    for await (const entry of Deno.readDir(currentDir)) {
        const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        if (entry.isDirectory) files.push(...await collectMarkdownFiles(rootDir, relativePath));
        else if (entry.isFile && entry.name.endsWith(".md")) files.push(relativePath);
    }
    return files.sort();
}

export function assertRequiredBundledAssetsConfigured() {
    const compileArgs = buildCompileArgs();
    const includePaths = new Set();
    for (let index = 0; index < compileArgs.length; index += 1) {
        if (compileArgs[index] === "--include") includePaths.add(compileArgs[index + 1]);
    }

    for (const includePath of REQUIRED_BUNDLED_BINARY_ASSET_INCLUDES) {
        if (!includePaths.has(includePath)) {
            throw new Error(`Release compile is missing bundled asset include: ${includePath}`);
        }
    }
}

/**
 * @returns {Promise<string[]>}
 */
export async function collectBundledAgentReferenceFiles() {
    return await collectMarkdownFiles(BUNDLED_AGENT_DEFS_SOURCE_DIR);
}

/**
 * @returns {Promise<Array<{ label: string, sourceDir: string, cacheDir: string, relativePath: string }>>}
 */
export async function collectExtractedBundledMarkdownFiles() {
    const files = [];
    for (const target of BUNDLED_EXTRACTED_MARKDOWN_TARGETS) {
        for (const relativePath of await collectMarkdownFiles(target.sourceDir)) {
            files.push({ ...target, relativePath });
        }
    }
    return files.sort((a, b) => `${a.cacheDir}/${a.relativePath}`.localeCompare(`${b.cacheDir}/${b.relativePath}`));
}

/**
 * @param {string} homeDir
 */
export async function assertExtractedBundledAgentReferenceFiles(homeDir) {
    for (const { label, sourceDir, cacheDir, relativePath } of await collectExtractedBundledMarkdownFiles()) {
        const sourcePath = join(sourceDir, relativePath);
        const extractedPath = join(homeDir, cacheDir, relativePath);
        let source;
        let extracted;
        try {
            source = await Deno.readTextFile(sourcePath);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Bundled ${label} source file is missing: ${sourcePath}. ${message}`);
        }
        try {
            extracted = await Deno.readTextFile(extractedPath);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(
                `Release binary did not extract ${label} markdown file: ${extractedPath}. ${message}`,
            );
        }
        if (extracted !== source) {
            throw new Error(`Release binary extracted stale ${label} markdown file: ${extractedPath}`);
        }
    }
}

/**
 * @param {string} homeDir
 * @returns {Promise<boolean>}
 */
async function hasExtractedBundledAgentReferenceFiles(homeDir) {
    try {
        await assertExtractedBundledAgentReferenceFiles(homeDir);
        return true;
    } catch {
        return false;
    }
}

/**
 * @param {string} binaryPath
 * @param {string} root
 */
export async function smokeTestBundledAgentReferenceExtraction(binaryPath, root) {
    console.log("\n==> Smoke test bundled agent reference extraction");
    const homeDir = join(root, "reference-home");
    const projectDir = join(root, "reference-project");
    await Deno.mkdir(projectDir, { recursive: true });
    await Deno.mkdir(homeDir, { recursive: true });
    await Deno.writeTextFile(join(projectDir, "README.md"), "# Release reference extraction smoke\n");

    const child = new Deno.Command(binaryPath, {
        args: ["init"],
        cwd: projectDir,
        env: { HOME: homeDir },
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

    try {
        const deadline = Date.now() + 10_000;
        while (Date.now() < deadline) {
            if (await hasExtractedBundledAgentReferenceFiles(homeDir)) return;

            const status = await Promise.race([
                child.status,
                new Promise((resolve) => setTimeout(() => resolve(null), 100)),
            ]);
            if (status) break;
        }

        await assertExtractedBundledAgentReferenceFiles(homeDir);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${message}\nOutput:\n${output}`);
    } finally {
        try {
            child.kill("SIGTERM");
        } catch {
            // Process may have exited after initializing or failing before model invocation.
        }
        await Promise.allSettled([child.status, stdoutDone, stderrDone]);
    }
}

/**
 * @param {string} binaryPath
 * @param {string} root
 */
export async function smokeTestBinaryReviewSurface(binaryPath, root) {
    console.log("\n==> Smoke test standalone review surface");
    const projectDir = join(root, "project");
    await Deno.mkdir(join(projectDir, "plans"), { recursive: true });
    await Deno.writeTextFile(
        join(projectDir, "plans", "release-review-smoke.md"),
        `---\nplanId: release-review-smoke\nclassification: FEATURE\nstatus: draft\n---\n# Release binary review smoke\n`,
    );

    const child = new Deno.Command(binaryPath, {
        args: ["plans", "read", "release-review-smoke", "--no-open"],
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
        await assertReviewAssetsLoad(url, html);

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

/**
 * @param {string[]} args
 * @returns {{ buildVersion: string | undefined }}
 */
export function parseReleaseCheckOptions(args = []) {
    /** @type {{ buildVersion: string | undefined }} */
    const options = { buildVersion: undefined };
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--build-version") options.buildVersion = args[++index];
        else throw new Error(`Unknown release check argument: ${arg}`);
    }
    if (options.buildVersion !== undefined && !options.buildVersion) {
        throw new Error("--build-version requires a value.");
    }
    return options;
}

/**
 * @param {string} output
 * @param {string} expectedVersion
 */
export function assertBinaryVersionOutput(output, expectedVersion) {
    if (!output.includes(`runwield ${expectedVersion} (`)) {
        throw new Error(
            `Release binary reported the wrong version. Expected ${expectedVersion}; output was:\n${output}`,
        );
    }
}

/**
 * @param {string} path
 * @returns {Promise<{ exists: boolean, content: string }>}
 */
async function snapshotFile(path) {
    try {
        return { exists: true, content: await Deno.readTextFile(path) };
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) return { exists: false, content: "" };
        throw error;
    }
}

/**
 * @param {string} path
 * @param {{ exists: boolean, content: string }} snapshot
 */
async function restoreFile(path, snapshot) {
    if (snapshot.exists) {
        await Deno.writeTextFile(path, snapshot.content);
        return;
    }
    await Deno.remove(path).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
}

/**
 * @typedef {Object} ReleaseCheckOptions
 * @property {string} [buildVersion]
 * @property {string} [rootDir]
 * @property {typeof run} [run]
 * @property {(options?: { prefix?: string }) => Promise<string>} [makeTempDir]
 * @property {(path: string, options?: { recursive?: boolean }) => Promise<void>} [remove]
 * @property {(binaryPath: string, root: string) => Promise<void>} [smokeTestBundledAgentReferenceExtraction]
 * @property {(binaryPath: string, root: string) => Promise<void>} [smokeTestBinaryReviewSurface]
 */

/**
 * @param {ReleaseCheckOptions} [options]
 */
export async function runReleaseCheck(options = {}) {
    const tempDir = await (options.makeTempDir || Deno.makeTempDir)({ prefix: "wld-release-check-" });
    const rootDir = options.rootDir || ".";
    const versionPath = join(rootDir, "src", "shared", "version.js");
    const versionSnapshot = await snapshotFile(versionPath);
    const binaryName = Deno.build.os === "windows" ? "wld.exe" : "wld";
    const output = join(tempDir, binaryName);
    const runner = options.run || run;
    const bundledReferenceSmoke = options.smokeTestBundledAgentReferenceExtraction ||
        smokeTestBundledAgentReferenceExtraction;
    const reviewSmoke = options.smokeTestBinaryReviewSurface || smokeTestBinaryReviewSurface;

    try {
        assertRequiredBundledAssetsConfigured();
        const compileEnv = options.buildVersion ? { WLD_BUILD_VERSION: options.buildVersion } : undefined;
        await mustRun("Compile release binary", "deno", ["run", "-A", "scripts/compile.js", "--output", output], {
            cwd: rootDir,
            env: compileEnv,
        }, runner);
        const smoke = await mustRun("Smoke test release binary", output, ["--version"], {
            stdout: "piped",
            stderr: "piped",
        }, runner);
        if (options.buildVersion) assertBinaryVersionOutput(`${smoke.stdout}${smoke.stderr}`, options.buildVersion);
        await bundledReferenceSmoke(output, tempDir);
        await reviewSmoke(output, tempDir);
    } finally {
        await restoreFile(versionPath, versionSnapshot);
        await (options.remove || Deno.remove)(tempDir, { recursive: true }).catch((error) => {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
        });
    }
}

export async function main(args = Deno.args) {
    await runReleaseCheck(parseReleaseCheckOptions(args));
}

if (import.meta.main) await main();
