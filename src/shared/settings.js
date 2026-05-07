import { SettingsManager } from "@mariozechner/pi-coding-agent";
import { dirname, join } from "@std/path";
import lockfile from "npm:proper-lockfile";

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
     * Implement the lock interface expected by SettingsManager.
     * @param {"global" | "project"} scope
     * @param {(content: string | undefined) => string | undefined} callback
     */
    async withLock(scope, callback) {
        const path = this.#resolvePath(scope);

        // Ensure the file exists before locking to avoid proper-lockfile errors
        // If it doesn't exist, we create an empty JSON object.
        try {
            Deno.statSync(path);
        } catch (_e) {
            const parentDir = dirname(path);
            try {
                Deno.mkdirSync(parentDir, { recursive: true });
            } catch (_e2) { /* ignore */ }
            Deno.writeTextFileSync(path, "{}");
        }

        const release = await lockfile.lock(path);
        try {
            const content = this.#readSettings(scope);
            const newContent = await callback(content);
            if (newContent !== undefined && newContent !== content) {
                this.#writeSettings(scope, newContent);
            }
        } finally {
            await release();
        }
    }
}

/** @type {SettingsManager | null} */
let settingsManager = null;

/**
 * Initializes the settings manager with the current working directory.
 */
export function initSettings() {
    if (!settingsManager) {
        settingsManager = SettingsManager.fromStorage(new HarnsSettingsStorage());
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
