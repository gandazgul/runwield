import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "@std/path";
import lockfile from "proper-lockfile";

/**
 * Harns custom storage for SettingsManager.
 *
 * Implementation Details:
 * - Global Scope:
 *     - Read: prioritizes ~/.hns/settings.json, falls back to ~/.pi/agent/settings.json.
 *     - Write: always writes to ~/.hns/settings.json.
 * - Project Scope:
 *     - Read/Write: use <cwd>/.hns/settings.json.
 */
class HarnsSettingsStorage {
    /** @type {string} */
    #cwd;

    constructor() {
        this.#cwd = Deno.cwd();
    }

    /**
     * Resolves the path for a given scope.
     * @param {"global" | "project"} scope
     * @returns {string}
     */
    #resolvePath(scope) {
        const homeDir = Deno.env.get("HOME") || "";
        if (scope === "global") {
            return join(homeDir, ".hns", "settings.json");
        }
        return join(this.#cwd, ".hns", "settings.json");
    }

    /**
     * Fallback path for global settings.
     * @returns {string}
     */
    #getGlobalFallbackPath() {
        const homeDir = Deno.env.get("HOME") || "";
        return join(homeDir, ".pi", "agent", "settings.json");
    }

    /**
     * Logic for reading settings with fallback.
     * @param {"global" | "project"} scope
     * @returns {string | undefined}
     */
    #readSettings(scope) {
        const path = this.#resolvePath(scope);
        try {
            return Deno.readTextFileSync(path);
        } catch (_e) {
            if (scope === "global") {
                try {
                    const fallbackPath = this.#getGlobalFallbackPath();
                    return Deno.readTextFileSync(fallbackPath);
                } catch (_e2) {
                    return undefined;
                }
            }
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
            const content = this.#readSettings(scope);
            const newContent = callback(content);
            if (newContent !== undefined && newContent !== content) {
                this.#writeSettings(scope, newContent);
            }
        } finally {
            release();
        }
    }
}

/** @type {HarnsSettingsStorage | null} */
let storageInstance = null;

/** @type {SettingsManager | null} */
let settingsManager = null;

/**
 * Initializes the settings manager with the current working directory.
 */
export function initSettings() {
    if (!settingsManager) {
        storageInstance = new HarnsSettingsStorage();
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
 * Safely reads a custom key from the underlying JSON file, bypassing SettingsManager types.
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
                const parsed = JSON.parse(content);
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
 * @param {string} key
 * @param {any} value
 * @param {"global" | "project"} scope
 */
export async function setCustomSetting(key, value, scope = "project") {
    if (!storageInstance) initSettings();

    // @ts-ignore storageInstance is definitely assigned here
    storageInstance.withLock(scope, (content) => {
        let parsed = {};
        if (content) {
            try {
                parsed = JSON.parse(content);
            } catch (_e) { /* ignore */ }
        }
        parsed[key] = value;
        return JSON.stringify(parsed, null, 2);
    });

    // Force Pi's manager to reload from disk so it doesn't accidentally
    // overwrite our custom key during its next flush() operation.
    await getSettingsManager().reload();
}
