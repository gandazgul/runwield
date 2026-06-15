import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { join } from "@std/path";
import { getSettingsDir } from "../settings.js";

const MODEL_CONFIG_FILES = ["models.json", "auth.json"];

/**
 * @returns {string}
 */
export function getHarnsModelConfigDir() {
    return getSettingsDir("global");
}

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
 * Pi historically stores model/auth config under ~/.pi/agent, but support the
 * shorter ~/.pi path as an import source too because some early installs and
 * docs used that shape.
 *
 * @param {string} fileName
 * @param {string} homeDir
 * @returns {string[]}
 */
function getPiConfigMigrationCandidates(fileName, homeDir) {
    if (!homeDir) return [];
    return [
        join(homeDir, ".pi", "agent", fileName),
        join(homeDir, ".pi", fileName),
    ];
}

/**
 * One-time import of Pi-owned model/auth files into Harns-owned config.
 * Existing Harns files always win; Pi is never used as a runtime fallback.
 *
 * @param {{ homeDir?: string, harnsDir?: string }} [options]
 * @returns {{ copied: string[], skipped: string[], failed: Array<{ file: string, error: string }> }}
 */
export function migratePiModelConfigOnce(options = {}) {
    const homeDir = options.homeDir ?? Deno.env.get("HOME") ?? "";
    const harnsDir = options.harnsDir ?? getHarnsModelConfigDir();
    /** @type {string[]} */
    const copied = [];
    /** @type {string[]} */
    const skipped = [];
    /** @type {Array<{ file: string, error: string }>} */
    const failed = [];

    for (const fileName of MODEL_CONFIG_FILES) {
        const targetPath = join(harnsDir, fileName);
        if (fileExists(targetPath)) {
            skipped.push(fileName);
            continue;
        }

        const sourcePath = getPiConfigMigrationCandidates(fileName, homeDir).find(fileExists);
        if (!sourcePath) {
            skipped.push(fileName);
            continue;
        }

        try {
            Deno.mkdirSync(harnsDir, { recursive: true });
            Deno.copyFileSync(sourcePath, targetPath);
            copied.push(fileName);
        } catch (error) {
            failed.push({ file: fileName, error: error instanceof Error ? error.message : String(error) });
        }
    }

    return { copied, skipped, failed };
}

/**
 * Get a configured ModelRegistry instance.
 * @returns {ModelRegistry}
 */
export function getModelRegistry() {
    const agentDir = getHarnsModelConfigDir();
    const migration = migratePiModelConfigOnce({ harnsDir: agentDir });
    for (const failure of migration.failed) {
        console.warn(`Failed to migrate Pi ${failure.file} to Harns config: ${failure.error}`);
    }

    const authStorage = AuthStorage.create(join(agentDir, "auth.json"));
    return ModelRegistry.create(authStorage, join(agentDir, "models.json"));
}
