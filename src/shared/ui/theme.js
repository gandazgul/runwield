/**
 * @module shared/theme
 * Theme integration — wraps Pi's Theme class with Harns-local registration,
 * lookup, and a live-swap setter. We re-implement the registration/swap
 * machinery locally because @earendil-works/pi-coding-agent only exports
 * the Theme constructor and initTheme, not the runtime setters.
 */

import process from "node:process";
import {
    DefaultPackageManager,
    getAgentDir,
    getMarkdownTheme as upstreamGetMarkdownTheme,
    getSelectListTheme as upstreamGetSelectListTheme,
    Theme,
} from "@earendil-works/pi-coding-agent";
import { getSettingsManager } from "../settings.js";

/** @typedef {import('@earendil-works/pi-coding-agent').Theme} ThemeInstance */

// ─── Global theme singleton key (matches the upstream) ───────────────────────
const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");

const DEFAULT_THEME_NAME = "catppuccin-mocha";

/**
 * The theme proxy — reads from globalThis just like the upstream.
 * All modules import `theme` from here and get the same singleton.
 * @type {ThemeInstance}
 */
export const theme = new Proxy(/** @type {any} */ ({}), {
    get(_target, prop) {
        const t = /** @type {any} */ (globalThis)[THEME_KEY];
        if (!t) throw new Error("Theme not initialized. Call initHarnsTheme() first.");
        return t[prop];
    },
});

/** @type {import('@earendil-works/pi-tui').MarkdownTheme | null} */
let _markdownTheme = null;

/** @type {import('@earendil-works/pi-tui').SelectListTheme | null} */
let _selectListTheme = null;

/** @returns {import('@earendil-works/pi-tui').MarkdownTheme} */
export function getMarkdownTheme() {
    if (!_markdownTheme) _markdownTheme = upstreamGetMarkdownTheme();
    return _markdownTheme;
}

/** @returns {import('@earendil-works/pi-tui').SelectListTheme} */
export function getSelectListTheme() {
    if (!_selectListTheme) _selectListTheme = upstreamGetSelectListTheme();
    return _selectListTheme;
}

/** @returns {import('@earendil-works/pi-tui').EditorTheme} */
export function getEditorTheme() {
    return {
        /** @param {string} s */
        borderColor: (s) => theme.fg("borderAccent", s),
        selectList: getSelectListTheme(),
    };
}

export const imageTheme = {
    /** @param {string} s */
    fallbackColor: (s) => {
        try {
            return theme.fg("dim", s);
        } catch (_e) {
            return s;
        }
    },
};

// ─── Color mode detection ────────────────────────────────────────────────────

/** @returns {"truecolor" | "256color"} */
function detectColorMode() {
    const colorterm = process.env.COLORTERM;
    if (colorterm === "truecolor" || colorterm === "24bit") return "truecolor";
    if (process.env.WT_SESSION) return "truecolor";
    const term = process.env.TERM || "";
    if (term === "dumb" || term === "" || term === "linux") return "256color";
    if (process.env.TERM_PROGRAM === "Apple_Terminal") return "256color";
    if (term === "screen" || term.startsWith("screen-") || term.startsWith("screen.")) return "256color";
    return "truecolor";
}

// ─── Theme JSON → Theme instance ─────────────────────────────────────────────

/**
 * @param {string | number} value
 * @param {Record<string, string | number>} vars
 * @param {Set<string>} [visited]
 * @returns {string | number}
 */
function resolveVarRef(value, vars, visited = new Set()) {
    if (typeof value === "number" || value === "" || value.startsWith("#")) return value;
    if (visited.has(value)) throw new Error(`Circular variable reference: ${value}`);
    if (!(value in vars)) throw new Error(`Variable reference not found: ${value}`);
    visited.add(value);
    return resolveVarRef(vars[value], vars, visited);
}

const BG_TOKEN_NAMES = new Set([
    "selectedBg",
    "userMessageBg",
    "customMessageBg",
    "toolPendingBg",
    "toolSuccessBg",
    "toolErrorBg",
]);

const CATPPUCCIN_MOCHA_JSON = JSON.parse(
    Deno.readTextFileSync(new URL("./catppuccin-mocha.json", import.meta.url)),
);

/**
 * Build a Pi Theme instance from a parsed theme JSON object.
 * @param {any} themeJson
 * @returns {ThemeInstance}
 */
function createThemeFromJson(themeJson) {
    const vars = themeJson.vars || {};
    const colorMode = detectColorMode();

    const fgColors = /** @type {Record<string, string | number>} */ ({});
    const bgColors = /** @type {Record<string, string | number>} */ ({});

    for (const [key, value] of Object.entries(themeJson.colors)) {
        const resolved = resolveVarRef(/** @type {string | number} */ (value), vars);
        if (BG_TOKEN_NAMES.has(key)) {
            bgColors[key] = resolved;
        } else {
            fgColors[key] = resolved;
        }
    }

    return new Theme(
        /** @type {any} */ (fgColors),
        /** @type {any} */ (bgColors),
        colorMode,
        { name: themeJson.name },
    );
}

// Construct the embedded theme once at module load. It's both the boot default
// and the merge floor for partial external themes.
const EMBEDDED_THEME = createThemeFromJson(CATPPUCCIN_MOCHA_JSON);

// ─── Local theme registry + setters (re-implemented; not in Pi's exports) ────

/** @type {Map<string, ThemeInstance>} */
const registeredThemes = new Map();

/** @param {ThemeInstance} t */
function setGlobalTheme(t) {
    /** @type {any} */ (globalThis)[THEME_KEY] = t;
}

/** @param {ThemeInstance[]} themes */
export function setRegisteredThemes(themes) {
    registeredThemes.clear();
    for (const t of themes) {
        if (t.name) registeredThemes.set(t.name, t);
    }
}

/** @param {ThemeInstance} themeInstance */
export function setThemeInstance(themeInstance) {
    setGlobalTheme(themeInstance);
}

/**
 * Swap to a registered theme by name.
 * Returns success false (and stays on the previous theme) if the name
 * is not registered, instead of silently substituting.
 * @param {string} name
 * @returns {{ success: boolean, error?: string }}
 */
export function setTheme(name) {
    const t = registeredThemes.get(name);
    if (!t) {
        return { success: false, error: `Theme "${name}" is not registered.` };
    }
    setGlobalTheme(t);
    return { success: true };
}

/** @returns {string[]} */
export function getAvailableThemes() {
    return Array.from(registeredThemes.keys()).sort();
}

// ─── Boot + discovery ────────────────────────────────────────────────────────

/**
 * Synchronously install the embedded catppuccin-mocha as the boot default.
 * Safe to call from any sync context — guarantees the theme proxy is usable
 * before first render. External themes are discovered later via
 * applyPersistedTheme().
 */
export function initHarnsTheme() {
    setRegisteredThemes([EMBEDDED_THEME]);
    setThemeInstance(EMBEDDED_THEME);
}

/**
 * Lazy-discover external themes and apply the persisted theme.
 * Awaited by the boot path before first render so the user never sees
 * a flicker from embedded → persisted.
 *
 * No-op when the persisted theme is the embedded default (95% case) — avoids
 * paying the PackageManager.resolve() cost for users who never customized.
 *
 * Tolerant of discovery failures: a broken settings.packages or a missing
 * persisted theme falls back to embedded with a warning instead of crashing.
 */
export async function applyPersistedTheme() {
    const settings = getSettingsManager();
    const persisted = settings.getTheme();
    if (!persisted || persisted === DEFAULT_THEME_NAME) return;

    try {
        await discoverAndRegisterThemes();
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`Theme discovery failed: ${msg}. Using embedded theme.`);
        return;
    }

    const result = setTheme(persisted);
    if (!result.success) {
        console.warn(
            `Persisted theme "${persisted}" is not available. Using embedded theme.`,
        );
    }
}

/**
 * Discover themes from installed packages and register them alongside the
 * embedded default. Idempotent — safe to call after every install/remove.
 *
 * External themes whose `colors`/`vars` are partial are merged on top of the
 * embedded JSON before instantiation, so missing tokens fall back to
 * catppuccin-mocha values instead of throwing.
 *
 * External themes named "catppuccin-mocha" are dropped (builtin precedence)
 * with a warning.
 */
export async function discoverAndRegisterThemes() {
    const settings = getSettingsManager();
    const packageManager = new DefaultPackageManager({
        cwd: Deno.cwd(),
        agentDir: getAgentDir(),
        settingsManager: settings,
    });

    const resolved = await packageManager.resolve();
    const externalThemes = [];

    for (const themeResource of resolved.themes) {
        try {
            const themeJson = JSON.parse(Deno.readTextFileSync(themeResource.path));

            if (themeJson.name === DEFAULT_THEME_NAME) {
                console.warn(
                    `External theme at ${themeResource.path} uses reserved name "${DEFAULT_THEME_NAME}" — ignored.`,
                );
                continue;
            }

            const mergedJson = {
                ...CATPPUCCIN_MOCHA_JSON,
                ...themeJson,
                colors: { ...CATPPUCCIN_MOCHA_JSON.colors, ...themeJson.colors },
                vars: { ...CATPPUCCIN_MOCHA_JSON.vars, ...(themeJson.vars || {}) },
            };

            externalThemes.push(createThemeFromJson(mergedJson));
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn(`Failed to load theme from ${themeResource.path}: ${msg}`);
        }
    }

    setRegisteredThemes([EMBEDDED_THEME, ...externalThemes]);
}
