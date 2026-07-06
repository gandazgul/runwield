/**
 * @module ui/theme/theme-discovery
 * Load external JSON themes from resolved package resources.
 */

import { mergeThemeJson } from "./theme-json.js";

/** @typedef {import('@earendil-works/pi-coding-agent').Theme} ThemeInstance */
/** @typedef {import('./theme-json.js').ThemeJson} ThemeJson */

/**
 * @param {{
 *     packageManager: { resolve: () => Promise<{ themes: Array<{ path: string }> }> },
 *     readTextFile: (path: string) => string | Promise<string>,
 *     warn?: (message: string) => void,
 *     defaultThemeName: string,
 *     baseThemeJson: ThemeJson,
 * }} deps
 * @returns {Promise<ThemeJson[]>}
 */
export async function loadExternalThemeJsons({
    packageManager,
    readTextFile,
    warn = console.warn,
    defaultThemeName,
    baseThemeJson,
}) {
    const resolved = await packageManager.resolve();
    /** @type {ThemeJson[]} */
    const externalThemeJsons = [];

    for (const themeResource of resolved.themes) {
        try {
            const themeJson = JSON.parse(await readTextFile(themeResource.path));

            if (themeJson.name === defaultThemeName) {
                continue;
            }

            externalThemeJsons.push(mergeThemeJson(baseThemeJson, themeJson));
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            warn(`Failed to load theme from ${themeResource.path}: ${msg}`);
        }
    }

    return externalThemeJsons;
}

/**
 * @param {{
 *     packageManager: { resolve: () => Promise<{ themes: Array<{ path: string }> }> },
 *     readTextFile: (path: string) => string | Promise<string>,
 *     warn?: (message: string) => void,
 *     defaultThemeName: string,
 *     baseThemeJson: ThemeJson,
 *     createTheme: (themeJson: ThemeJson) => ThemeInstance,
 * }} deps
 * @returns {Promise<ThemeInstance[]>}
 */
export async function loadExternalThemes(deps) {
    const externalThemeJsons = await loadExternalThemeJsons(deps);
    /** @type {ThemeInstance[]} */
    const externalThemes = [];

    for (const themeJson of externalThemeJsons) {
        externalThemes.push(deps.createTheme(themeJson));
    }

    return externalThemes;
}
