/**
 * @module shared/ui/theme-discovery
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
 *     createTheme: (themeJson: ThemeJson) => ThemeInstance,
 * }} deps
 * @returns {Promise<ThemeInstance[]>}
 */
export async function loadExternalThemes({
    packageManager,
    readTextFile,
    warn = console.warn,
    defaultThemeName,
    baseThemeJson,
    createTheme,
}) {
    const resolved = await packageManager.resolve();
    /** @type {ThemeInstance[]} */
    const externalThemes = [];

    for (const themeResource of resolved.themes) {
        try {
            const themeJson = JSON.parse(await readTextFile(themeResource.path));

            if (themeJson.name === defaultThemeName) {
                continue;
            }

            externalThemes.push(createTheme(mergeThemeJson(baseThemeJson, themeJson)));
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            warn(`Failed to load theme from ${themeResource.path}: ${msg}`);
        }
    }

    return externalThemes;
}
