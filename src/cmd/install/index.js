/**
 * @module cmd/install
 * RunWield install command wrapping Pi's PackageManager.
 */

import { DefaultPackageManager } from "@earendil-works/pi-coding-agent";
import { getSettingsDir, getSettingsManager } from "../../shared/settings.js";
import { discoverAndRegisterThemes } from "../../ui/theme/theme.js";
import { countPackageResourcesForSource } from "../../shared/package-resources.js";
import { filterWldCompatibleExtensionResources } from "../../shared/extensions/wld-extension-manifest.js";

/**
 * @typedef {string | {
 *   source: string,
 *   extensions?: string[],
 *   skills?: string[],
 *   prompts?: string[],
 *   themes?: string[],
 * }} PackageSourceSetting
 */

/**
 * @param {PackageSourceSetting} entry
 * @returns {string}
 */
function packageEntrySource(entry) {
    return typeof entry === "string" ? entry : entry.source;
}

/**
 * @param {{ getGlobalSettings: () => { packages?: PackageSourceSetting[] }, setPackages: (packages: PackageSourceSetting[]) => void }} settings
 * @param {string} source
 * @returns {boolean}
 */
export function disablePackageExtensions(settings, source) {
    const packages = settings.getGlobalSettings().packages || [];
    const index = packages.findIndex((entry) => packageEntrySource(entry) === source);
    if (index === -1) return false;

    const current = packages[index];
    const sourceValue = packageEntrySource(current);
    const nextEntry = typeof current === "string"
        ? { source: sourceValue, extensions: [] }
        : { ...current, extensions: [] };
    const nextPackages = [...packages];
    nextPackages[index] = nextEntry;
    settings.setPackages(nextPackages);
    return true;
}

/**
 * @param {string} source
 * @param {number} extensionCount
 * @param {(message?: unknown, ...optionalParams: unknown[]) => void} log
 * @returns {boolean}
 */
export function confirmWldExtensionInstall(source, extensionCount, log = console.log) {
    log(`Package source contains WLD-compatible code extensions: ${extensionCount}`);
    log("");
    log("Extensions can register tools, alter prompts, intercept tool calls, read project/session data, and call external services.");
    log("RunWield has not vetted this extension package. It could leak data, run unwanted commands, or cause other issues.");
    log("");
    const answer = globalThis.prompt(`Enable extensions from ${source} for loading? [y/N] `) || "";
    return /^(?:y|yes)$/i.test(answer.trim());
}

/**
 * @param {string[]} argv
 * @param {import('../registry.js').CommandContext} _options
 */
export async function runInstallCommand(argv, _options = {}) {
    const deps = /** @type {{
        PackageManager?: typeof DefaultPackageManager,
        getSettingsManager?: typeof getSettingsManager,
        getSettingsDir?: typeof getSettingsDir,
        discoverAndRegisterThemes?: typeof discoverAndRegisterThemes,
        confirmWldExtensionInstall?: typeof confirmWldExtensionInstall,
        cwd?: () => string,
        log?: typeof console.log,
        error?: typeof console.error,
        exit?: typeof Deno.exit,
    }} */
        (_options.__testDeps || {});
    const error = deps.error || console.error;
    const exit = deps.exit || Deno.exit;

    if (argv.length === 0) {
        error("Usage: wld install <source>");
        error("Sources: npm:<spec>, git:<url>, local:<path>");
        exit(1);
        return;
    }

    const source = argv[0];
    try {
        const SettingsPackageManager = deps.PackageManager || DefaultPackageManager;
        const settings = (deps.getSettingsManager || getSettingsManager)();
        const packageManager = new SettingsPackageManager({
            cwd: (deps.cwd || Deno.cwd)(),
            agentDir: (deps.getSettingsDir || getSettingsDir)("global"),
            settingsManager: settings,
        });

        await packageManager.installAndPersist(source);

        // Inspect what this specific package contributed. Passive resources are
        // registered; code extensions need WLD compatibility plus install consent.
        const resolved = await packageManager.resolve();
        const counts = countPackageResourcesForSource(resolved, source);
        const sourceExtensions = resolved.extensions.filter((resource) => resource.metadata?.source === source);
        const compatibleExtensions = await filterWldCompatibleExtensionResources(sourceExtensions);
        const ignoredExtensionCount = Math.max(0, counts.extensions - compatibleExtensions.length);
        let enabledExtensionCount = compatibleExtensions.length;
        let skippedExtensionCount = 0;

        if (compatibleExtensions.length > 0) {
            const confirm = deps.confirmWldExtensionInstall || confirmWldExtensionInstall;
            const allowExtensions = await confirm(source, compatibleExtensions.length, deps.log || console.log);
            if (!allowExtensions) {
                disablePackageExtensions(/** @type {any} */ (settings), source);
                skippedExtensionCount = compatibleExtensions.length;
                enabledExtensionCount = 0;
            }
        }

        await (deps.discoverAndRegisterThemes || discoverAndRegisterThemes)();

        const log = deps.log || console.log;
        log(`Installed ${source}`);
        log(`  Themes registered: ${counts.themes}`);
        log(`  Prompt templates available: ${counts.prompts}`);
        if (enabledExtensionCount > 0) {
            log(`  WLD-compatible code extensions enabled: ${enabledExtensionCount}`);
        }
        if (skippedExtensionCount > 0) {
            log(`  WLD-compatible code extensions skipped: ${skippedExtensionCount}`);
        }
        if (ignoredExtensionCount > 0) {
            log(`  Code extensions ignored: ${ignoredExtensionCount} (missing pi.wld compatibility marker)`);
        }
        if (counts.skills > 0) {
            log(`  Skills ignored: ${counts.skills} (RunWield does not load Pi package skills)`);
            log(`  Install skills separately with: npx skills add ${source}`);
            log("  Use -a/--agent to choose the target agent when needed.");
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        error(`Installation failed: ${msg}`);
        exit(1);
    }
}
