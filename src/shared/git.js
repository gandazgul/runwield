/**
 * @module shared/git
 * Shared Git repository detection and non-Git execution consent helpers.
 */

import { getCustomSetting, setCustomSetting } from "./settings.js";

export const NON_GIT_EXECUTION_CONSENT_KEY = "nonGitExecutionConsent";

/**
 * @typedef {"featurePlan" | "quickFix"} NonGitConsentKind
 */

/**
 * @typedef {"work_tree" | "git_missing" | "not_git" | "bare_or_unsupported" | "error"} GitRepositoryState
 */

/**
 * @typedef {Object} GitRepositoryProbe
 * @property {GitRepositoryState} state
 * @property {boolean} ok
 * @property {string} cwd
 * @property {string} [message]
 */

export class GitRepositoryRequiredError extends Error {
    /**
     * @param {string} message
     * @param {{ cwd: string, operation: string, state?: GitRepositoryState }} details
     */
    constructor(message, details) {
        super(message);
        this.name = "GitRepositoryRequiredError";
        this.cwd = details.cwd;
        this.operation = details.operation;
        this.state = details.state || "error";
    }
}

/** @param {unknown} value */
function decodeBytes(value) {
    return new TextDecoder().decode(/** @type {Uint8Array} */ (value)).trim();
}

/**
 * @param {string} cwd
 * @returns {Promise<GitRepositoryProbe>}
 */
export async function probeGitRepository(cwd) {
    try {
        const command = new Deno.Command("git", {
            args: ["rev-parse", "--is-inside-work-tree", "--is-bare-repository"],
            cwd,
            stdout: "piped",
            stderr: "piped",
        });
        const output = await command.output();
        const stdout = decodeBytes(output.stdout);
        const stderr = decodeBytes(output.stderr);
        if (output.code !== 0) {
            return {
                state: "not_git",
                ok: false,
                cwd,
                message: stderr || stdout || "This directory is not a Git work tree.",
            };
        }
        const [insideWorkTree = "", bare = ""] = stdout.split("\n").map((line) => line.trim());
        if (insideWorkTree === "true" && bare !== "true") {
            return { state: "work_tree", ok: true, cwd };
        }
        return {
            state: "bare_or_unsupported",
            ok: false,
            cwd,
            message: "RunWield requires a non-bare Git work tree for this operation.",
        };
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
            return { state: "git_missing", ok: false, cwd, message: "The git executable was not found." };
        }
        return {
            state: "error",
            ok: false,
            cwd,
            message: error instanceof Error ? error.message : String(error),
        };
    }
}

/**
 * @param {string} cwd
 * @returns {Promise<boolean>}
 */
export async function isGitRepository(cwd) {
    return (await probeGitRepository(cwd)).ok;
}

/**
 * @param {string} operation
 * @param {GitRepositoryProbe} probe
 * @returns {string}
 */
export function buildGitRequiredMessage(operation, probe) {
    const reason = probe.state === "git_missing"
        ? "Git was not found."
        : probe.state === "bare_or_unsupported"
        ? "This directory is not a supported Git work tree."
        : "This directory is not a Git work tree.";
    return `${operation} requires a Git repository. ${reason} RunWield uses Git for worktree isolation, diffs, baseline recovery, and merge-back for this operation.`;
}

/**
 * @param {string} cwd
 * @param {string} operation
 * @returns {Promise<void>}
 */
export async function assertGitRepository(cwd, operation) {
    const probe = await probeGitRepository(cwd);
    if (probe.ok) return;
    throw new GitRepositoryRequiredError(buildGitRequiredMessage(operation, probe), {
        cwd,
        operation,
        state: probe.state,
    });
}

/** @param {unknown} error */
export function isGitRepositoryRequiredError(error) {
    return error instanceof GitRepositoryRequiredError ||
        Boolean(
            error && typeof error === "object" && /** @type {{ name?: unknown }} */
                (error).name === "GitRepositoryRequiredError",
        );
}

/** @param {unknown} error */
export function formatGitRequiredMessage(error) {
    if (isGitRepositoryRequiredError(error)) return error instanceof Error ? error.message : String(error);
    return error instanceof Error ? error.message : String(error);
}

/**
 * @param {unknown} value
 * @returns {Record<string, boolean>}
 */
function normalizeConsent(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? /** @type {Record<string, boolean>} */ (value)
        : {};
}

/**
 * @param {NonGitConsentKind} kind
 * @returns {boolean}
 */
export function hasNonGitExecutionConsent(kind) {
    const consent = normalizeConsent(getCustomSetting(NON_GIT_EXECUTION_CONSENT_KEY, "project"));
    return consent[kind] === true;
}

/**
 * @param {NonGitConsentKind} kind
 * @returns {Promise<void>}
 */
export async function rememberNonGitExecutionConsent(kind) {
    const consent = normalizeConsent(getCustomSetting(NON_GIT_EXECUTION_CONSENT_KEY, "project"));
    await setCustomSetting(NON_GIT_EXECUTION_CONSENT_KEY, { ...consent, [kind]: true }, "project");
}
