/**
 * @module scripts/release
 *
 * WLD release orchestration helpers. The script owns Git tag creation and
 * preflight only; the GitHub Actions tag workflow owns host release creation.
 */

const RELEASE_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/;
const WLD_RELEASE_ASSET_SUFFIXES = Object.freeze([
    "darwin-arm64",
    "darwin-x64",
    "linux-x64",
    "linux-arm64",
    "windows-x64",
]);

/**
 * @typedef {"candidate" | "stable"} ReleaseKind
 */

/**
 * @typedef {Object} ReleaseTag
 * @property {string} tag
 * @property {number} major
 * @property {number} minor
 * @property {number} patch
 * @property {number | undefined} rc
 * @property {ReleaseKind} kind
 * @property {string} stableTag
 */

/**
 * @typedef {Object} CommandResult
 * @property {boolean} success
 * @property {number} code
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * @typedef {(command: string, args: string[], options?: { cwd?: string, env?: Record<string, string> }) => Promise<CommandResult>} CommandRunner
 */

/**
 * @typedef {Object} ReleaseDeps
 * @property {CommandRunner} [run]
 * @property {(path: string) => Promise<string>} [readTextFile]
 * @property {(options?: { prefix?: string }) => Promise<string>} [makeTempDir]
 * @property {(path: string, options?: { recursive?: boolean }) => Promise<void>} [remove]
 * @property {(message?: unknown, ...optionalParams: unknown[]) => void} [log]
 * @property {(message?: unknown, ...optionalParams: unknown[]) => void} [error]
 */

/**
 * @param {string} value
 */
function assertSafeTagText(value) {
    if (!value) throw new Error(`Unsafe release tag: ${JSON.stringify(value)}`);
    for (const character of value) {
        const code = character.charCodeAt(0);
        if (code <= 0x1f || code === 0x7f || /\s/.test(character) || character === "/" || character === "\\") {
            throw new Error(`Unsafe release tag: ${JSON.stringify(value)}`);
        }
    }
}

/**
 * @param {string} tag
 * @returns {ReleaseTag}
 */
export function parseReleaseTag(tag) {
    assertSafeTagText(tag);
    const match = tag.match(RELEASE_TAG_PATTERN);
    if (!match) throw new Error(`Unsupported release tag: ${tag}`);
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);
    const rc = match[4] === undefined ? undefined : Number(match[4]);
    if (rc !== undefined && rc < 1) throw new Error(`Release Candidate ordinal must be positive: ${tag}`);
    const stableTag = `v${major}.${minor}.${patch}`;
    return { tag, major, minor, patch, rc, kind: rc === undefined ? "stable" : "candidate", stableTag };
}

/**
 * @param {string} candidateTag
 * @returns {string}
 */
export function stableTagForCandidate(candidateTag) {
    const parsed = parseReleaseTag(candidateTag);
    if (parsed.kind !== "candidate") throw new Error(`Not a Candidate tag: ${candidateTag}`);
    return parsed.stableTag;
}

/**
 * @param {ReleaseTag} left
 * @param {ReleaseTag} right
 */
export function compareReleaseTags(left, right) {
    for (const key of /** @type {const} */ (["major", "minor", "patch"])) {
        if (left[key] !== right[key]) return left[key] - right[key];
    }
    const leftRc = left.rc ?? Number.POSITIVE_INFINITY;
    const rightRc = right.rc ?? Number.POSITIVE_INFINITY;
    return leftRc - rightRc;
}

/**
 * @param {string[]} tags
 * @returns {string | undefined}
 */
export function nextCandidateTag(tags) {
    const parsed = tags.map((tag) => {
        try {
            return parseReleaseTag(tag);
        } catch {
            return null;
        }
    }).filter((tag) => tag !== null);
    const stableTags = /** @type {ReleaseTag[]} */ (parsed).filter((tag) => tag.kind === "stable");
    stableTags.sort(compareReleaseTags);
    const lastStable = stableTags.at(-1);
    if (!lastStable) return undefined;
    const base = `v${lastStable.major}.${lastStable.minor}.${lastStable.patch + 1}`;
    const candidates = /** @type {ReleaseTag[]} */ (parsed).filter((tag) =>
        tag.stableTag === base && tag.rc !== undefined
    );
    const nextRc = Math.max(0, ...candidates.map((tag) => tag.rc || 0)) + 1;
    return `${base}-rc.${nextRc}`;
}

/**
 * @param {string[]} tags
 * @returns {string | undefined}
 */
export function previousStableTag(tags) {
    const stable = /** @type {ReleaseTag[]} */ (tags.map((tag) => {
        try {
            return parseReleaseTag(tag);
        } catch {
            return null;
        }
    }).filter((tag) => tag?.kind === "stable"));
    stable.sort(compareReleaseTags);
    return stable.at(-1)?.tag;
}

/**
 * @param {string} tag
 * @returns {{ tag: string, kind: ReleaseKind, buildVersion: string, prerelease: boolean, makeLatest: boolean }}
 */
export function releaseMetadataForTag(tag) {
    const parsed = parseReleaseTag(tag);
    return {
        tag: parsed.tag,
        kind: parsed.kind,
        buildVersion: parsed.tag,
        prerelease: parsed.kind === "candidate",
        makeLatest: parsed.kind === "stable",
    };
}

/**
 * @returns {CommandRunner}
 */
function defaultRun() {
    return async (command, args, options = {}) => {
        const child = new Deno.Command(command, {
            args,
            cwd: options.cwd,
            env: options.env,
            stdout: "piped",
            stderr: "piped",
        });
        const output = await child.output();
        const decoder = new TextDecoder();
        return {
            success: output.success,
            code: output.code,
            stdout: decoder.decode(output.stdout),
            stderr: decoder.decode(output.stderr),
        };
    };
}

/**
 * @param {ReleaseDeps} deps
 */
function normalizeDeps(deps = {}) {
    return {
        run: deps.run || defaultRun(),
        readTextFile: deps.readTextFile || Deno.readTextFile,
        makeTempDir: deps.makeTempDir || Deno.makeTempDir,
        remove: deps.remove || Deno.remove,
        log: deps.log || console.log,
        error: deps.error || console.error,
    };
}

/**
 * @param {ReleaseDeps} deps
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string> }} [options]
 * @returns {Promise<CommandResult>}
 */
export async function runGit(deps, command, args, options = {}) {
    return await normalizeDeps(deps).run(command, args, options);
}

/**
 * @param {ReleaseDeps} deps
 * @param {string} label
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string> }} [options]
 * @returns {Promise<CommandResult>}
 */
async function mustRun(deps, label, command, args, options = {}) {
    const result = await normalizeDeps(deps).run(command, args, options);
    if (!result.success) {
        throw new Error(`${label} failed with exit code ${result.code}: ${result.stderr || result.stdout}`.trim());
    }
    return result;
}

/**
 * @param {string} stdout
 * @returns {string[]}
 */
function splitLines(stdout) {
    return stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

/**
 * @param {ReleaseDeps} deps
 * @returns {Promise<string[]>}
 */
export async function listTags(deps = {}) {
    const result = await mustRun(deps, "List release tags", "git", ["tag", "--list", "v*"]);
    return splitLines(result.stdout);
}

/**
 * @param {ReleaseDeps} deps
 * @param {string} tag
 * @returns {Promise<string | undefined>}
 */
export async function resolveLocalTagCommit(deps, tag) {
    assertSafeTagText(tag);
    const result = await normalizeDeps(deps).run("git", ["rev-parse", `${tag}^{commit}`]);
    if (!result.success) return undefined;
    return result.stdout.trim() || undefined;
}

/**
 * @param {ReleaseDeps} deps
 * @param {string} tag
 * @returns {Promise<string | undefined>}
 */
export async function resolveRemoteTagCommit(deps, tag) {
    assertSafeTagText(tag);
    const result = await normalizeDeps(deps).run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`]);
    if (!result.success) throw new Error(`Failed to inspect remote tag ${tag}: ${result.stderr || result.stdout}`);
    const line = result.stdout.split("\n").find((entry) => entry.includes(`refs/tags/${tag}`));
    return line?.split(/\s+/)[0] || undefined;
}

/**
 * @param {ReleaseDeps} deps
 * @param {string} tag
 */
async function assertTagAvailable(deps, tag) {
    if (await resolveLocalTagCommit(deps, tag)) throw new Error(`Local tag already exists: ${tag}`);
    if (await resolveRemoteTagCommit(deps, tag)) throw new Error(`Remote tag already exists: ${tag}`);
}

/**
 * @param {ReleaseDeps} deps
 */
export async function assertCleanMainCheckout(deps = {}) {
    const branch = await mustRun(deps, "Read branch", "git", ["branch", "--show-current"]);
    if (branch.stdout.trim() !== "main") {
        throw new Error(`Release commands must run from main, not ${branch.stdout.trim() || "detached HEAD"}.`);
    }
    const status = await mustRun(deps, "Read working tree status", "git", ["status", "--porcelain"]);
    if (status.stdout.trim()) throw new Error(`Release checkout must be clean:\n${status.stdout}`);
    const head = await mustRun(deps, "Read HEAD", "git", ["rev-parse", "HEAD"]);
    const upstream = await mustRun(deps, "Read upstream", "git", ["rev-parse", "@{u}"]);
    if (head.stdout.trim() !== upstream.stdout.trim()) {
        throw new Error("Release checkout must match its upstream before tagging.");
    }
}

/**
 * @param {ReleaseDeps} deps
 * @param {string} buildVersion
 * @param {string | undefined} cwd
 */
async function runQualification(deps, buildVersion, cwd) {
    await mustRun(deps, "Remote submodule fetchability check", "deno", ["task", "submodules:check:remote"], { cwd });
    await mustRun(deps, "Release qualification", "deno", ["task", "release:check", "--build-version", buildVersion], {
        cwd,
    });
}

/**
 * @param {string} stdout
 */
function parseJson(stdout) {
    try {
        return JSON.parse(stdout || "null");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not parse GitHub release JSON: ${message}\n${stdout}`);
    }
}

/**
 * @param {string} tag
 * @returns {string[]}
 */
export function expectedReleaseAssetNames(tag) {
    /** @type {string[]} */
    const names = ["SHA256SUMS", "config.schema.json"];
    for (const suffix of WLD_RELEASE_ASSET_SUFFIXES) {
        names.push(
            `wld-${tag}-${suffix}.tar.gz`,
            `wld-${tag}-${suffix}.tar.zst`,
            `wld-${tag}-${suffix}.tar.gz.sha256`,
            `wld-${tag}-${suffix}.tar.zst.sha256`,
        );
    }
    return names;
}

/**
 * @param {ReleaseDeps} deps
 * @param {string} candidateTag
 */
export async function assertCandidatePublished(deps, candidateTag) {
    parseReleaseTag(candidateTag);
    const result = await mustRun(deps, "Read Candidate release", "gh", [
        "release",
        "view",
        candidateTag,
        "--json",
        "isPrerelease,isDraft,assets",
    ]);
    const release = /** @type {{ isDraft?: boolean, isPrerelease?: boolean, assets?: Array<{ name: string }> }} */
        (parseJson(result.stdout));
    if (!release || release.isDraft) throw new Error(`Candidate release is not published: ${candidateTag}`);
    if (!release.isPrerelease) throw new Error(`Candidate release is not marked as a prerelease: ${candidateTag}`);
    const names = new Set((release.assets || []).map((asset) => asset.name));
    for (const expected of expectedReleaseAssetNames(candidateTag)) {
        if (!names.has(expected)) throw new Error(`Candidate release ${candidateTag} is missing asset: ${expected}`);
    }
}

/**
 * @param {ReleaseDeps} deps
 * @param {string} tag
 * @param {string} targetCommit
 * @param {string} message
 * @param {boolean} dryRun
 */
async function createAndPushTag(deps, tag, targetCommit, message, dryRun) {
    const { log } = normalizeDeps(deps);
    if (dryRun) {
        log(`[dry-run] would create annotated tag ${tag} at ${targetCommit}`);
        log(`[dry-run] would push refs/tags/${tag} to origin`);
        return;
    }
    await mustRun(deps, "Create annotated release tag", "git", ["tag", "-a", tag, targetCommit, "-m", message]);
    await mustRun(deps, "Push release tag", "git", ["push", "origin", `refs/tags/${tag}`]);
}

/**
 * @param {ReleaseDeps} deps
 * @returns {Promise<string>}
 */
async function headCommit(deps) {
    const result = await mustRun(deps, "Read HEAD", "git", ["rev-parse", "HEAD"]);
    return result.stdout.trim();
}

/**
 * @param {ReleaseDeps} deps
 * @param {string} tag
 * @param {boolean} dryRun
 */
export async function createCandidate(deps, tag, dryRun = false) {
    const parsed = parseReleaseTag(tag);
    if (parsed.kind !== "candidate") throw new Error(`Candidate release requires an rc tag: ${tag}`);
    await assertCleanMainCheckout(deps);
    await assertTagAvailable(deps, tag);
    await assertTagAvailable(deps, parsed.stableTag);
    if (!dryRun) await runQualification(deps, tag, undefined);
    const commit = await headCommit(deps);
    await createAndPushTag(deps, tag, commit, `Release Candidate ${tag}`, dryRun);
}

/**
 * @param {ReleaseDeps} deps
 * @param {string} tag
 * @param {boolean} dryRun
 */
export async function createStable(deps, tag, dryRun = false) {
    const parsed = parseReleaseTag(tag);
    if (parsed.kind !== "stable") throw new Error(`Stable release requires a stable tag: ${tag}`);
    await assertCleanMainCheckout(deps);
    await assertTagAvailable(deps, tag);
    if (!dryRun) await runQualification(deps, tag, undefined);
    const commit = await headCommit(deps);
    await createAndPushTag(deps, tag, commit, `Stable release ${tag}`, dryRun);
}

/**
 * @param {ReleaseDeps} deps
 * @param {string} candidateTag
 * @param {boolean} dryRun
 */
export async function promoteCandidate(deps, candidateTag, dryRun = false) {
    const parsed = parseReleaseTag(candidateTag);
    if (parsed.kind !== "candidate") throw new Error(`Promotion requires a Candidate tag: ${candidateTag}`);
    const stableTag = parsed.stableTag;
    await assertTagAvailable(deps, stableTag);
    await mustRun(deps, "Fetch release tags", "git", ["fetch", "origin", "--tags"]);
    const candidateCommit = await resolveLocalTagCommit(deps, candidateTag) ||
        await resolveRemoteTagCommit(deps, candidateTag);
    if (!candidateCommit) throw new Error(`Candidate tag does not exist locally or remotely: ${candidateTag}`);
    await assertCandidatePublished(deps, candidateTag);

    if (!dryRun) {
        const tempDir = await normalizeDeps(deps).makeTempDir({ prefix: "wld-release-promote-" });
        try {
            await mustRun(deps, "Create detached promotion worktree", "git", [
                "worktree",
                "add",
                "--detach",
                tempDir,
                candidateCommit,
            ]);
            await runQualification(deps, stableTag, tempDir);
        } finally {
            await normalizeDeps(deps).run("git", ["worktree", "remove", "--force", tempDir]);
            await normalizeDeps(deps).remove(tempDir, { recursive: true }).catch(() => {});
        }
    }

    await createAndPushTag(
        deps,
        stableTag,
        candidateCommit,
        `Stable release ${stableTag}\n\nPromoted-From: ${candidateTag}`,
        dryRun,
    );
}

/**
 * @param {string[]} args
 * @returns {{ command: string, tag?: string, candidate?: string, dryRun: boolean }}
 */
export function parseReleaseArgs(args) {
    const [command, ...rest] = args;
    /** @type {{ command: string, tag?: string, candidate?: string, dryRun: boolean }} */
    const options = { command: command || "", dryRun: false };
    for (let index = 0; index < rest.length; index += 1) {
        const arg = rest[index];
        if (arg === "--dry-run") options.dryRun = true;
        else if (arg === "--tag") options.tag = rest[++index];
        else if (arg === "--candidate") options.candidate = rest[++index];
        else throw new Error(`Unknown release argument: ${arg}`);
    }
    return options;
}

/**
 * @param {string[]} [args]
 * @param {ReleaseDeps} [deps]
 */
export async function main(args = Deno.args, deps = {}) {
    const options = parseReleaseArgs(args);
    if (options.command === "metadata") {
        if (!options.tag) throw new Error("release metadata requires --tag <tag>");
        console.log(JSON.stringify(releaseMetadataForTag(options.tag)));
        return;
    }
    if (options.command === "candidate") {
        if (!options.tag) throw new Error("release candidate requires --tag <candidate-tag>");
        await createCandidate(deps, options.tag, options.dryRun);
        return;
    }
    if (options.command === "stable") {
        if (!options.tag) throw new Error("release stable requires --tag <stable-tag>");
        await createStable(deps, options.tag, options.dryRun);
        return;
    }
    if (options.command === "promote") {
        if (!options.candidate) throw new Error("release promote requires --candidate <candidate-tag>");
        await promoteCandidate(deps, options.candidate, options.dryRun);
        return;
    }
    throw new Error(
        "Usage: release.js metadata --tag <tag> | candidate --tag <tag> [--dry-run] | stable --tag <tag> [--dry-run] | promote --candidate <tag> [--dry-run]",
    );
}

if (import.meta.main) await main();
