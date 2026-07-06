/**
 * @module ui/theme/theme-json
 * Pure helpers for Pi-compatible JSON theme files.
 */

import process from "node:process";
import { Theme } from "@earendil-works/pi-coding-agent";

/** @typedef {import('@earendil-works/pi-coding-agent').Theme} ThemeInstance */

/** @typedef {string | number} ThemeColorValue */

/** @typedef {{ name?: string, vars?: Record<string, ThemeColorValue>, colors?: Record<string, ThemeColorValue>, export?: Record<string, ThemeColorValue> }} ThemeJson */

export const BG_TOKEN_NAMES = new Set([
    "selectedBg",
    "userMessageBg",
    "customMessageBg",
    "toolPendingBg",
    "toolSuccessBg",
    "toolErrorBg",
]);

/** @returns {"truecolor" | "256color"} */
export function detectColorMode() {
    const colorterm = process.env.COLORTERM;
    if (colorterm === "truecolor" || colorterm === "24bit") return "truecolor";
    if (process.env.WT_SESSION) return "truecolor";
    const term = process.env.TERM || "";
    if (term === "dumb" || term === "" || term === "linux") return "256color";
    if (process.env.TERM_PROGRAM === "Apple_Terminal") return "256color";
    if (term === "screen" || term.startsWith("screen-") || term.startsWith("screen.")) return "256color";
    return "truecolor";
}

/**
 * @param {ThemeColorValue} value
 * @param {Record<string, ThemeColorValue>} vars
 * @param {Set<string>} [visited]
 * @returns {ThemeColorValue}
 */
function resolveVarRef(value, vars, visited = new Set()) {
    if (typeof value === "number" || value === "" || value.startsWith("#")) return value;
    if (visited.has(value)) throw new Error(`Circular variable reference: ${value}`);
    if (!(value in vars)) throw new Error(`Variable reference not found: ${value}`);
    visited.add(value);
    return resolveVarRef(vars[value], vars, visited);
}

/**
 * Resolve variable references in a theme JSON object's colors.
 * @param {ThemeJson} themeJson
 * @returns {ThemeJson & { colors: Record<string, ThemeColorValue> }}
 */
export function resolveThemeVars(themeJson) {
    const vars = themeJson.vars || {};
    const colors = themeJson.colors || {};
    /** @type {Record<string, ThemeColorValue>} */
    const resolvedColors = {};

    for (const [key, value] of Object.entries(colors)) {
        resolvedColors[key] = resolveVarRef(value, vars);
    }

    return {
        ...themeJson,
        vars,
        colors: resolvedColors,
    };
}

/**
 * Merge a partial external theme on top of a complete base theme.
 * @param {ThemeJson} baseThemeJson
 * @param {ThemeJson} overrideThemeJson
 * @returns {ThemeJson & { vars: Record<string, ThemeColorValue>, colors: Record<string, ThemeColorValue> }}
 */
export function mergeThemeJson(baseThemeJson, overrideThemeJson) {
    return {
        ...baseThemeJson,
        ...overrideThemeJson,
        vars: { ...(baseThemeJson.vars || {}), ...(overrideThemeJson.vars || {}) },
        colors: { ...(baseThemeJson.colors || {}), ...(overrideThemeJson.colors || {}) },
        export: { ...(baseThemeJson.export || {}), ...(overrideThemeJson.export || {}) },
    };
}

/**
 * Split resolved color tokens into Pi Theme foreground/background maps.
 * @param {Record<string, ThemeColorValue>} colors
 * @returns {{ fgColors: Record<string, ThemeColorValue>, bgColors: Record<string, ThemeColorValue> }}
 */
export function splitFgBgColors(colors) {
    /** @type {Record<string, ThemeColorValue>} */
    const fgColors = {};
    /** @type {Record<string, ThemeColorValue>} */
    const bgColors = {};

    for (const [key, value] of Object.entries(colors)) {
        if (BG_TOKEN_NAMES.has(key)) {
            bgColors[key] = value;
        } else {
            fgColors[key] = value;
        }
    }

    return { fgColors, bgColors };
}

/**
 * Build a Pi Theme instance from a parsed theme JSON object.
 * @param {ThemeJson} themeJson
 * @param {{ colorMode?: "truecolor" | "256color", ThemeCtor?: typeof Theme }} [options]
 * @returns {ThemeInstance}
 */
export function createThemeFromJson(themeJson, options = {}) {
    const resolvedJson = resolveThemeVars(themeJson);
    const { fgColors, bgColors } = splitFgBgColors(resolvedJson.colors);
    const ThemeCtor = options.ThemeCtor || Theme;

    return new ThemeCtor(
        /** @type {any} */ (fgColors),
        /** @type {any} */ (bgColors),
        options.colorMode || detectColorMode(),
        { name: themeJson.name },
    );
}
