import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "@std/path";
import { parse as parseJsonc } from "@std/jsonc";
import lockfile from "proper-lockfile";
import { normalizeServerUrl } from "./collaboration/urls.js";

export const PLAN_SERVER_URL_SETTING_KEY = "planServerUrl";

const RUNWEILD_CUSTOM_SETTING_KEYS = [
    "agents",
    "activeModelPreset",
    "modelPresets",
    "visionFallback",
    "compactOnResumeThresholdPercent",
    "verification_command",
    "codereview",
    "cleanupMergedWorktrees",
    "workflowMetrics",
    "enableExternalSkills",
    "enableExternalGlobalAgentsMd",
    PLAN_SERVER_URL_SETTING_KEY,
];

/**
 * Get the settings directory path for a given scope.
 *
 * @param {string} scope
 *
 * @returns {string}
 */
export function getSettingsDir(scope) {
    const homeDir = Deno.env.get("HOME") || "";
    if (scope === "global") {
        return join(homeDir, ".wld");
    }
    return join(Deno.cwd(), ".wld");
}

/**
 * RunWield custom storage for SettingsManager.
 *
 * Implementation Details:
 * - Global Scope:
 *     - Read: uses ~/.wld/settings.json only.
 *     - Migration: if ~/.wld/settings.json is missing, copies once from ~/.pi/agent/settings.json.
 *     - Write: always writes to ~/.wld/settings.json.
 * - Project Scope:
 *     - Read/Write: use <cwd>/.wld/settings.json.
 */
/**
 * @param {string} path
 * @returns {boolean}
 */
function fileExists(path) {
    try {
        return Deno.statSync(path).isFile;
    } catch {
        return false;
    }
}

/**
 * One-time import of legacy Pi settings into RunWield-owned settings.
 * Existing RunWield settings always win; Pi is never used as a runtime fallback.
 *
 * @param {{ homeDir?: string, runwieldPath?: string, piPath?: string }} [options]
 * @returns {{ copied: boolean, skipped: boolean, error?: string }}
 */
export function migratePiSettingsOnce(options = {}) {
    const homeDir = options.homeDir ?? Deno.env.get("HOME") ?? "";
    const runwieldPath = options.runwieldPath ?? join(homeDir, ".wld", "settings.json");
    const piPath = options.piPath ?? join(homeDir, ".pi", "agent", "settings.json");

    if (fileExists(runwieldPath) || !fileExists(piPath)) {
        return { copied: false, skipped: true };
    }

    try {
        Deno.mkdirSync(dirname(runwieldPath), { recursive: true });
        Deno.copyFileSync(piPath, runwieldPath);
        return { copied: true, skipped: false };
    } catch (error) {
        return { copied: false, skipped: false, error: error instanceof Error ? error.message : String(error) };
    }
}

class RunWieldSettingsStorage {
    /**
     * Resolves the path for a given scope.
     * @param {"global" | "project"} scope
     * @returns {string}
     */
    #resolvePath(scope) {
        return getSettingsDir(scope) + "/settings.json";
    }

    /**
     * Read settings file content, stripping JSONC comments/trailing commas
     * so callers (Pi's SettingsManager, custom setters) receive valid JSON.
     * @param {"global" | "project"} scope
     * @returns {string | undefined}
     */
    #readSettings(scope) {
        const path = this.#resolvePath(scope);
        if (scope === "global") {
            migratePiSettingsOnce({ runwieldPath: path });
        }
        try {
            const raw = Deno.readTextFileSync(path);
            return stripJsoncComments(raw);
        } catch (_e) {
            return undefined;
        }
    }

    /**
     * Logic for writing settings.
     * @param {"global" | "project"} scope
     * @param {string} content
     */
    #writeSettings(scope, content) {
        const path = this.#resolvePath(scope);

        // ensure directory exists
        const parentDir = dirname(path);
        try {
            Deno.mkdirSync(parentDir, { recursive: true });
        } catch (_e) { /* ignore */ }

        Deno.writeTextFileSync(path, content);
    }

    /**
     * Acquire a sync lock with retry on ELOCKED, mirroring upstream
     * FileSettingsStorage behavior.
     * @param {string} path
     * @returns {() => void}
     */
    #acquireLockSyncWithRetry(path) {
        const maxAttempts = 10;
        const delayMs = 20;
        let lastError;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return lockfile.lockSync(path, { realpath: false });
            } catch (error) {
                const code = (error && typeof error === "object" && "code" in error) ? String(error.code) : undefined;
                if (code !== "ELOCKED" || attempt === maxAttempts) {
                    throw error;
                }
                lastError = error;
                const start = Date.now();
                while (Date.now() - start < delayMs) { /* busy-wait */ }
            }
        }

        throw lastError ?? new Error("Failed to acquire settings lock");
    }

    /**
     * Implement the lock interface expected by SettingsManager. Must be
     * synchronous: SettingsManager calls this without awaiting.
     * @param {"global" | "project"} scope
     * @param {(content: string | undefined) => string | undefined} callback
     */
    withLock(scope, callback) {
        const path = this.#resolvePath(scope);

        const content = this.#readSettings(scope);
        let newContent = callback(content);
        if (newContent !== undefined) {
            newContent = preserveRunWieldCustomSettingsForWrite(content, newContent);
        }
        if (newContent !== undefined && newContent !== content) {
            // Ensure the file exists before locking; proper-lockfile requires the
            // target to exist.
            try {
                Deno.statSync(path);
            } catch (_e) {
                const parentDir = dirname(path);
                try {
                    Deno.mkdirSync(parentDir, { recursive: true });
                } catch (_e2) { /* ignore */ }
                Deno.writeTextFileSync(path, "{}");
            }

            const release = this.#acquireLockSyncWithRetry(path);
            try {
                this.#writeSettings(scope, newContent);
            } finally {
                release();
            }
        }
    }
}

/** @type {RunWieldSettingsStorage | null} */
let storageInstance = null;

/** @type {SettingsManager | null} */
let settingsManager = null;

/**
 * Initializes the settings manager with the current working directory.
 */
export function initSettings() {
    if (!settingsManager) {
        storageInstance = new RunWieldSettingsStorage();
        settingsManager = SettingsManager.fromStorage(storageInstance);
    }
}

/**
 * Provides the SettingsManager singleton.
 * @returns {SettingsManager}
 */
export function getSettingsManager() {
    if (!settingsManager) {
        initSettings();
    }
    return /** @type {SettingsManager} */ (settingsManager);
}

/**
 * Test-only escape hatch for tests that need to change HOME or cwd before
 * exercising settings-backed behavior.
 */
export function __resetSettingsForTests() {
    storageInstance = null;
    settingsManager = null;
}

/**
 * Strip JSONC comments/trailing commas from a raw string, producing valid JSON.
 * Uses @std/jsonc parse then re-serializes for callers that expect clean JSON.
 *
 * @param {string} raw
 * @returns {string}
 */
function stripJsoncComments(raw) {
    try {
        const parsed = parseJsonc(raw);
        return JSON.stringify(parsed);
    } catch {
        // If JSONC parse fails, return original — let the caller's JSON.parse
        // throw with the real error message.
        return raw;
    }
}

/**
 * Preserve RunWield custom settings when Pi's SettingsManager writes its known
 * schema back to disk. Without this, operations like changing theme/model can
 * silently drop RunWield-only keys such as `modelPresets`.
 *
 * @param {string | undefined} previousContent
 * @param {string} nextContent
 * @returns {string}
 */
export function preserveRunWieldCustomSettingsForWrite(previousContent, nextContent) {
    if (!previousContent) return nextContent;

    try {
        const previous = /** @type {Record<string, any>} */ (parseJsonc(previousContent));
        const next = /** @type {Record<string, any>} */ (parseJsonc(nextContent));
        if (
            !previous || typeof previous !== "object" || Array.isArray(previous) ||
            !next || typeof next !== "object" || Array.isArray(next)
        ) {
            return nextContent;
        }

        let changed = false;
        for (const key of RUNWEILD_CUSTOM_SETTING_KEYS) {
            if (
                Object.prototype.hasOwnProperty.call(previous, key) && !Object.prototype.hasOwnProperty.call(next, key)
            ) {
                next[key] = previous[key];
                changed = true;
            }
        }

        return changed ? JSON.stringify(next, null, 2) : nextContent;
    } catch {
        return nextContent;
    }
}

/**
 * Safely reads a custom key from the underlying JSON file, bypassing SettingsManager types.
 * Content is parsed as JSONC (comments/trailing commas tolerated).
 * @param {string} key
 * @param {"global" | "project"} scope
 * @returns {any}
 */
export function getCustomSetting(key, scope = "project") {
    if (!storageInstance) initSettings();
    let result = undefined;

    // @ts-ignore storageInstance is definitely assigned here
    storageInstance.withLock(scope, (content) => {
        if (content) {
            try {
                const parsed = /** @type {Record<string, any>} */ (parseJsonc(content));
                result = parsed[key];
            } catch (_e) { /* ignore */ }
        }

        return undefined; // Return undefined to signify no file changes
    });

    return result;
}

/**
 * Safely writes a custom key to the underlying JSON file, bypassing SettingsManager types,
 * and forces the SettingsManager to sync its in-memory state.
 *
 * Output is always normalized JSON (no comments).
 *
 * @param {string} key
 * @param {any} value
 * @param {"global" | "project"} scope
 */
export async function setCustomSetting(key, value, scope = "project") {
    if (!storageInstance) initSettings();

    // @ts-ignore storageInstance is definitely assigned here
    storageInstance.withLock(scope, (content) => {
        let parsed = /** @type {Record<string, any>} */ ({});
        if (content) {
            try {
                parsed = /** @type {Record<string, any>} */ (parseJsonc(content));
            } catch (_e) { /* ignore */ }
        }
        parsed[key] = value;

        return JSON.stringify(parsed, null, 2);
    });

    // Force Pi's manager to reload from disk so it doesn't accidentally
    // overwrite our custom key during its next flush() operation.
    await getSettingsManager().reload();
}

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {number}
 */
function validatePositiveIntegerSetting(value, label) {
    const numberValue = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
    if (!Number.isInteger(numberValue) || /** @type {number} */ (numberValue) < 1) {
        throw new Error(`${label} must be a positive integer.`);
    }
    return /** @type {number} */ (numberValue);
}

/**
 * Safely updates one numeric global compaction setting while preserving siblings.
 * Pi's SettingsManager exposes getters for these fields but only provides a
 * setter for enabled, so RunWield writes the same global compaction object.
 *
 * @param {"reserveTokens" | "keepRecentTokens"} key
 * @param {number} value
 */
async function setGlobalCompactionSetting(key, value) {
    if (!storageInstance) initSettings();

    // @ts-ignore storageInstance is definitely assigned here
    storageInstance.withLock("global", (content) => {
        let parsed = /** @type {Record<string, any>} */ ({});
        if (content) {
            try {
                parsed = /** @type {Record<string, any>} */ (parseJsonc(content));
            } catch (_e) { /* ignore */ }
        }

        const existing = parsed.compaction;
        const compaction = existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {};
        parsed.compaction = { ...compaction, [key]: value };

        return JSON.stringify(parsed, null, 2);
    });

    await getSettingsManager().reload();
}

/**
 * Set the global compaction reserve token budget.
 * @param {unknown} value
 */
export async function setCompactionReserveTokens(value) {
    await setGlobalCompactionSetting("reserveTokens", validatePositiveIntegerSetting(value, "Reserve tokens"));
}

/**
 * Set the global compaction keep-recent token window.
 * @param {unknown} value
 */
export async function setCompactionKeepRecentTokens(value) {
    await setGlobalCompactionSetting("keepRecentTokens", validatePositiveIntegerSetting(value, "Keep recent tokens"));
}

/**
 * Merged custom key lookup: reads a key from both global and project scopes
 * and returns the value with project scope taking precedence.
 *
 * For object-valued keys (e.g. `agents`, `modelPresets`), the result is a
 * deep merge where project values override global values at the top level.
 * For scalar keys, project value wins if present.
 *
 * @param {string} key
 * @returns {any} Merged value from global + project scopes, or undefined if neither has it.
 */
export function getMergedCustomSetting(key) {
    if (!storageInstance) initSettings();

    const globalVal = getCustomSetting(key, "global");
    const projectVal = getCustomSetting(key, "project");

    if (globalVal === undefined && projectVal === undefined) return undefined;
    if (globalVal === undefined) return projectVal;
    if (projectVal === undefined) return globalVal;

    // Both present: merge if both are plain objects, otherwise project wins.
    if (
        typeof globalVal === "object" && globalVal !== null && !Array.isArray(globalVal) &&
        typeof projectVal === "object" && projectVal !== null && !Array.isArray(projectVal)
    ) {
        return { ...globalVal, ...projectVal };
    }

    return projectVal;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizePlanServerUrl(value) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error("Plan Server URL must be a non-empty string.");
    }
    const normalized = normalizeServerUrl(value.trim());
    const url = new URL(normalized);
    if (/(?:^|\/)p\/[^/]+\/?$/.test(url.pathname)) {
        throw new Error("Plan Server URL must not be a full collaboration share URL.");
    }
    return normalized;
}

/**
 * @returns {string | undefined}
 */
export function getDefaultPlanServerUrl() {
    const value = getMergedCustomSetting(PLAN_SERVER_URL_SETTING_KEY);
    if (value === undefined) return undefined;
    return normalizePlanServerUrl(value);
}

/**
 * @param {unknown} value
 * @param {"global" | "project"} [scope]
 */
export async function setDefaultPlanServerUrl(value, scope = "project") {
    await setCustomSetting(PLAN_SERVER_URL_SETTING_KEY, normalizePlanServerUrl(value), scope);
}

/**
 * Whether merged execution worktrees should be removed after successful merge-back.
 * Defaults to true; set `cleanupMergedWorktrees: false` in global or project
 * settings to keep merged worktree checkouts for inspection.
 *
 * @returns {boolean}
 */
/**
 * Resolve the configured vision fallback model string.
 *
 * Resolution order:
 * 1. Active preset `modelPresets.<activeModelPreset>.visionFallback.model`
 * 2. Top-level `visionFallback.model`
 * 3. Disabled when unset or not a string
 *
 * @returns {string | undefined}
 */
export function getResolvedVisionFallbackModelSetting() {
    const activeModelPreset = /** @type {string | undefined} */ (getMergedCustomSetting("activeModelPreset"));
    if (activeModelPreset) {
        const modelPresets = /** @type {Record<string, { visionFallback?: { model?: unknown } }> | undefined} */ (
            getMergedCustomSetting("modelPresets")
        );
        const presetModel = modelPresets?.[activeModelPreset]?.visionFallback?.model;
        if (typeof presetModel === "string" && presetModel.trim()) return presetModel.trim();
    }

    const visionFallback = /** @type {{ model?: unknown } | undefined} */ (getMergedCustomSetting("visionFallback"));
    const model = visionFallback?.model;
    return typeof model === "string" && model.trim() ? model.trim() : undefined;
}

/**
 * Whether merged execution worktrees should be removed after successful merge-back.
 * Defaults to true; set `cleanupMergedWorktrees: false` in global or project
 * settings to keep merged worktree checkouts for inspection.
 *
 * @returns {boolean}
 */
export function shouldCleanupMergedWorktrees() {
    return getMergedCustomSetting("cleanupMergedWorktrees") !== false;
}

/**
 * Resolve the optional human code review gate mode.
 *
 * @returns {"none" | "ask" | "always"}
 */
export function getCodeReviewMode() {
    const mode = getMergedCustomSetting("codereview");
    if (typeof mode !== "string") return "none";

    const normalized = mode.trim().toLowerCase();
    if (normalized === "ask" || normalized === "always") return normalized;
    return "none";
}
