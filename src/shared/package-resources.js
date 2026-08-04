/**
 * @module shared/package-resources
 * Helpers for consuming Pi package resources through RunWield policy.
 */

import { DefaultPackageManager } from "@earendil-works/pi-coding-agent";
import { getSettingsDir, getSettingsManager } from "./settings.js";

/**
 * @typedef {Object} PathMetadata
 * @property {string} source
 * @property {string} scope
 * @property {"package" | "top-level"} origin
 * @property {string | undefined} [baseDir]
 */

/**
 * @typedef {Object} ResolvedResource
 * @property {string} path
 * @property {boolean} enabled
 * @property {PathMetadata} metadata
 */

/**
 * @typedef {Object} ResolvedPaths
 * @property {ResolvedResource[]} extensions
 * @property {ResolvedResource[]} skills
 * @property {ResolvedResource[]} prompts
 * @property {ResolvedResource[]} themes
 */

/**
 * @param {ResolvedResource} resource
 * @returns {boolean}
 */
export function isEnabledPackageResource(resource) {
    return resource.enabled === true && resource.metadata?.origin === "package";
}

/**
 * Resolve installed package prompt resources without installing missing packages.
 * Prompt templates are passive Markdown resources, so they do not require the
 * executable extension compatibility gate.
 *
 * @param {{
 *   cwd?: string,
 *   agentDir?: string,
 *   settingsManager?: any,
 * }} [options]
 * @returns {Promise<ResolvedResource[]>}
 */
export async function resolveInstalledPackagePromptResources(options = {}) {
    const packageManager = new DefaultPackageManager({
        cwd: options.cwd || Deno.cwd(),
        agentDir: options.agentDir || getSettingsDir("global"),
        settingsManager: /** @type {any} */ (options.settingsManager || getSettingsManager()),
    });

    const resolved = await packageManager.resolve(() => Promise.resolve("skip"));
    return filterEnabledPackagePrompts(resolved);
}

/** @param {ResolvedPaths} resolved @returns {ResolvedResource[]} */
export function filterEnabledPackagePrompts(resolved) {
    return resolved.prompts.filter(isEnabledPackageResource);
}

/**
 * @param {ResolvedResource[]} resources
 * @returns {string[]}
 */
export function getPackagePromptTemplatePaths(resources) {
    return resources.map((resource) => resource.path);
}

/**
 * @param {ResolvedPaths} resolved
 * @param {string} source
 * @returns {{ themes: number, prompts: number, extensions: number, skills: number }}
 */
export function countPackageResourcesForSource(resolved, source) {
    const fromSource = (/** @type {ResolvedResource} */ resource) => resource.metadata?.source === source;
    return {
        themes: resolved.themes.filter(fromSource).length,
        prompts: resolved.prompts.filter(fromSource).length,
        extensions: resolved.extensions.filter(fromSource).length,
        skills: resolved.skills.filter(fromSource).length,
    };
}
