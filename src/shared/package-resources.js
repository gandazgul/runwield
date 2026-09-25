/**
 * @module shared/package-resources
 * Helpers for consuming Pi package resources through RunWield policy.
 */

import { DefaultPackageManager } from "@earendil-works/pi-coding-agent";
import { isAbsolute, join, relative } from "@std/path";
import { getCwd } from "../constants.js";
import { getSettingsDir, getSettingsManager } from "./settings.js";
import {
    assertPersonalResourcePath,
    personalPackageRoots,
    remotePersonalResourcesActive,
} from "./remote/personal-resources.ts";

/**
 * @typedef {Object} ConfiguredPackage
 * @property {string} source
 * @property {string[]} [prompts]
 * @property {boolean} [autoload]
 */
/** @typedef {string | ConfiguredPackage} ConfiguredPackageEntry */

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
    const settings = options.settingsManager || getSettingsManager(options.cwd);
    const remote = remotePersonalResourcesActive();
    const roots = personalPackageRoots();
    if (remote) {
        for (const [source, path] of Object.entries(roots)) {
            await assertPersonalResourcePath(path, `package root "${source}"`, { packageResource: true });
            await assertPersonalResourcePath(join(path, "package.json"), `package manifest "${source}"`, {
                packageResource: true,
            });
        }
    }
    const originalSources = new Map();
    // Only the laptop-verified package inventory is eligible remotely. In
    // particular, Pi must never probe a remote account's legacy global npm root.
    const settingsManager = remote ? mappedRemotePackageSettings(settings, roots, originalSources) : settings;
    const packageManager = new DefaultPackageManager({
        cwd: options.cwd || getCwd(),
        agentDir: options.agentDir || getSettingsDir("global"),
        settingsManager: /** @type {any} */ (settingsManager),
    });

    const resolved = await packageManager.resolve(() => Promise.resolve("skip"));
    const prompts = filterEnabledPackagePrompts(resolved);
    if (remote) {
        const project = await Deno.realPath(options.cwd || getCwd());
        for (const resource of prompts) {
            const path = await Deno.realPath(resource.path);
            const rest = relative(project, path);
            if (rest !== "" && rest !== ".." && !rest.startsWith("../") && !isAbsolute(rest)) continue;
            await assertPersonalResourcePath(resource.path, `package prompt "${resource.metadata.source}"`, {
                packageResource: true,
            });
        }
    }
    return remote
        ? prompts.map((resource) => ({
            ...resource,
            metadata: {
                ...resource.metadata,
                source: originalSources.get(resource.metadata.source) ?? resource.metadata.source,
            },
        }))
        : prompts;
}

/**
 * Map only laptop-installed global packages. Pi's loader also resolves packages before applying resource flags.
 * @param {import('@earendil-works/pi-coding-agent').SettingsManager} settings
 * @param {Readonly<Record<string, string>>} [roots]
 * @param {Map<string, string>} [originalSources]
 */
export function mappedRemotePackageSettings(settings, roots = personalPackageRoots(), originalSources = new Map()) {
    return new Proxy(settings, {
        get(target, key) {
            if (key === "getGlobalSettings") {
                return () => ({
                    ...target.getGlobalSettings(),
                    packages: (/** @type {ConfiguredPackageEntry[]} */ (target.getGlobalSettings().packages ?? []))
                        .flatMap((entry) => {
                            const source = typeof entry === "string" ? entry : entry.source;
                            const path = roots[source];
                            if (!path) return [];
                            // Pi must read the installed laptop directory, never install
                            // a missing package or interpret a laptop path on the server.
                            if (!originalSources.has(path)) originalSources.set(path, source);
                            return [typeof entry === "string" ? path : { ...entry, source: path }];
                        }),
                });
            }
            return Reflect.get(target, key, target);
        },
    });
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
