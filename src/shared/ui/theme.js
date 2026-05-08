/**
 * @module shared/theme
 * Theme integration — uses the upstream pi-coding-agent Theme class
 * with catppuccin-mocha colors, set as the global theme singleton.
 */

import process from "node:process";
import {
    getMarkdownTheme as upstreamGetMarkdownTheme,
    getSelectListTheme as upstreamGetSelectListTheme,
    Theme,
} from "@earendil-works/pi-coding-agent";

// ─── Global theme singleton key (matches the upstream) ───────────────────────
const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");

/**
 * The theme proxy — reads from globalThis just like the upstream.
 * All modules import `theme` from here and get the same singleton.
 * @type {InstanceType<typeof Theme>}
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

/**
 * Lazily-built markdown theme from the upstream Theme singleton.
 * Must be called after initHarnsTheme().
 * @returns {import('@earendil-works/pi-tui').MarkdownTheme}
 */
export function getMarkdownTheme() {
    if (!_markdownTheme) {
        _markdownTheme = upstreamGetMarkdownTheme();
    }
    return _markdownTheme;
}

/**
 * Lazily-built select list theme from the upstream Theme singleton.
 * Must be called after initHarnsTheme().
 * @returns {import('@earendil-works/pi-tui').SelectListTheme}
 */
export function getSelectListTheme() {
    if (!_selectListTheme) {
        _selectListTheme = upstreamGetSelectListTheme();
    }
    return _selectListTheme;
}

/**
 * Editor theme for pi-tui Editor component.
 * Lazily-built from the upstream Theme singleton.
 * @returns {import('@earendil-works/pi-tui').EditorTheme}
 */
export function getEditorTheme() {
    return {
        /** @param {string} s */
        borderColor: (s) => theme.fg("borderAccent", s),
        selectList: getSelectListTheme(),
    };
}

/**
 * Image theme for pi-tui Image component.
 */
export const imageTheme = {
    /** @param {string} s */
    fallbackColor: (s) => {
        try {
            return theme.fg("dim", s);
        } catch (_e) {
            // Theme not yet initialized — return unstyled
            return s;
        }
    },
};

// ─── Theme Color Resolution ──────────────────────────────────────────────────

/**
 * Detect terminal color capability.
 * @returns {"truecolor" | "256color"}
 */
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

/**
 * Resolve variable references in theme color values.
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

// Background color token names in the upstream Theme schema
const BG_TOKEN_NAMES = new Set([
    "selectedBg",
    "userMessageBg",
    "customMessageBg",
    "toolPendingBg",
    "toolSuccessBg",
    "toolErrorBg",
]);

// Catppuccin Mocha theme data (inlined for deno compile compatibility).
// Source: https://github.com/otahontas-works/pi-coding-agent-catppuccin
const CATPPUCCIN_MOCHA = {
    name: "catppuccin-mocha",
    vars: {
        rosewater: "#f5e0dc",
        flamingo: "#f2cdcd",
        pink: "#f5c2e7",
        mauve: "#cba6f7",
        red: "#f38ba8",
        maroon: "#eba0ac",
        peach: "#fab387",
        yellow: "#f9e2af",
        green: "#a6e3a1",
        teal: "#94e2d5",
        sky: "#89dceb",
        sapphire: "#74c7ec",
        blue: "#89b4fa",
        lavender: "#b4befe",
        text: "#cdd6f4",
        subtext1: "#bac2de",
        subtext0: "#a6adc8",
        overlay2: "#9399b2",
        overlay1: "#7f849c",
        overlay0: "#6c7086",
        surface2: "#585b70",
        surface1: "#45475a",
        surface0: "#313244",
        base: "#1e1e2e",
        mantle: "#181825",
        crust: "#11111b",
    },
    colors: {
        accent: "mauve",
        border: "blue",
        borderAccent: "sapphire",
        borderMuted: "surface0",
        success: "green",
        error: "red",
        warning: "yellow",
        muted: "overlay1",
        dim: "overlay0",
        text: "",
        thinkingText: "overlay1",
        selectedBg: "surface0",
        userMessageBg: "surface0",
        userMessageText: "",
        customMessageBg: "surface1",
        customMessageText: "",
        customMessageLabel: "mauve",
        toolPendingBg: "mantle",
        toolSuccessBg: "#3e4b4c",
        toolErrorBg: "#4c3a4c",
        toolTitle: "",
        toolOutput: "subtext0",
        mdHeading: "peach",
        mdLink: "blue",
        mdLinkUrl: "overlay0",
        mdCode: "teal",
        mdCodeBlock: "green",
        mdCodeBlockBorder: "overlay1",
        mdQuote: "subtext0",
        mdQuoteBorder: "overlay1",
        mdHr: "overlay1",
        mdListBullet: "mauve",
        toolDiffAdded: "green",
        toolDiffRemoved: "red",
        toolDiffContext: "overlay1",
        syntaxComment: "overlay0",
        syntaxKeyword: "mauve",
        syntaxFunction: "blue",
        syntaxVariable: "text",
        syntaxString: "green",
        syntaxNumber: "peach",
        syntaxType: "yellow",
        syntaxOperator: "sky",
        syntaxPunctuation: "overlay2",
        thinkingOff: "surface0",
        thinkingMinimal: "overlay0",
        thinkingLow: "blue",
        thinkingMedium: "sapphire",
        thinkingHigh: "mauve",
        thinkingXhigh: "pink",
        bashMode: "green",
    },
};

/**
 * Initialize the harns theme.
 * Constructs a Theme instance from catppuccin-mocha colors and sets it
 * as the global theme singleton.
 * Must be called before any UI rendering.
 */
export function initHarnsTheme() {
    const themeJson = CATPPUCCIN_MOCHA;

    const vars = themeJson.vars || {};
    const colorMode = detectColorMode();

    /** @type {Record<string, string | number>} */
    const fgColors = {};
    /** @type {Record<string, string | number>} */
    const bgColors = {};

    for (const [key, value] of Object.entries(themeJson.colors)) {
        const resolved = resolveVarRef(/** @type {string | number} */ (value), vars);
        if (BG_TOKEN_NAMES.has(key)) {
            bgColors[key] = resolved;
        } else {
            fgColors[key] = resolved;
        }
    }

    const themeInstance = new Theme(
        /** @type {any} */ (fgColors),
        /** @type {any} */ (bgColors),
        colorMode,
        { name: themeJson.name },
    );

    // Set the global singleton (same key the upstream theme proxy reads from)
    /** @type {any} */ (globalThis)[THEME_KEY] = themeInstance;

    // Reset cached sub-themes since the theme instance changed
    _markdownTheme = null;
    _selectListTheme = null;
}
