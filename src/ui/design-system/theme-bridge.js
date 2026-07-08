/**
 * @module ui/design-system/theme-bridge
 * Converts the active RunWield TUI theme into browser CSS variables.
 */

/**
 * @typedef {Object} RunWieldBrowserThemeJson
 * @property {string} [name]
 * @property {Record<string, string | number>} [vars]
 * @property {Record<string, string | number>} [colors]
 * @property {Record<string, string | number>} [export]
 */

/**
 * @typedef {Object} ThemeTokenMapping
 * @property {string} css
 * @property {"vars" | "colors" | "export"} source
 * @property {string} token
 */

/** @type {ThemeTokenMapping[]} */
const RUNWIELD_BROWSER_THEME_TOKEN_MAP = [
    { css: "--rw-page-bg", source: "export", token: "pageBg" },
    { css: "--rw-surface", source: "export", token: "cardBg" },
    { css: "--rw-surface-raised", source: "export", token: "infoBg" },
    { css: "--rw-surface-muted", source: "colors", token: "selectedBg" },
    { css: "--rw-surface-strong", source: "colors", token: "customMessageBg" },
    { css: "--rw-text", source: "vars", token: "text" },
    { css: "--rw-text-strong", source: "vars", token: "text" },
    { css: "--rw-text-muted", source: "vars", token: "subtext1" },
    { css: "--rw-text-dim", source: "vars", token: "overlay1" },
    { css: "--rw-accent", source: "colors", token: "accent" },
    { css: "--rw-accent-strong", source: "colors", token: "borderAccent" },
    { css: "--rw-accent-text", source: "colors", token: "mdHeading" },
    { css: "--rw-border", source: "colors", token: "borderMuted" },
    { css: "--rw-border-strong", source: "colors", token: "border" },
    { css: "--rw-success", source: "colors", token: "success" },
    { css: "--rw-error", source: "colors", token: "error" },
    { css: "--rw-warning", source: "colors", token: "warning" },
    { css: "--rw-complexity-low", source: "colors", token: "success" },
    { css: "--rw-complexity-medium", source: "colors", token: "warning" },
    { css: "--rw-complexity-high", source: "colors", token: "error" },
    { css: "--rw-code", source: "colors", token: "mdCode" },
];

/**
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
function cssColor(value) {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
    return undefined;
}

/**
 * @param {string | number | undefined} value
 * @param {RunWieldBrowserThemeJson} themeJson
 * @param {Set<string>} [visited]
 * @returns {string | undefined}
 */
function resolveThemeColor(value, themeJson, visited = new Set()) {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
    if (visited.has(trimmed)) return undefined;
    visited.add(trimmed);

    const vars = themeJson.vars || {};
    if (Object.hasOwn(vars, trimmed)) {
        return resolveThemeColor(vars[trimmed], themeJson, visited);
    }

    const colors = themeJson.colors || {};
    if (Object.hasOwn(colors, trimmed)) {
        return resolveThemeColor(colors[trimmed], themeJson, visited);
    }

    const exports = themeJson.export || {};
    if (Object.hasOwn(exports, trimmed)) {
        return resolveThemeColor(exports[trimmed], themeJson, visited);
    }

    return undefined;
}

/**
 * @param {string | undefined} name
 * @returns {string}
 */
function cssString(name) {
    return (name || "default").replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

/**
 * @param {RunWieldBrowserThemeJson} themeJson
 * @returns {string}
 */
export function renderRunWieldThemeCss(themeJson) {
    const lines = [
        ":root {",
        `    --rw-theme-name: "${cssString(themeJson.name)}";`,
    ];

    for (const mapping of RUNWIELD_BROWSER_THEME_TOKEN_MAP) {
        const source = themeJson[mapping.source] || {};
        const color = resolveThemeColor(source[mapping.token], themeJson);
        const cssValue = cssColor(color);
        if (cssValue) lines.push(`    ${mapping.css}: ${cssValue};`);
    }

    lines.push("    --rw-radix-popover-bg: var(--rw-surface-raised);");
    lines.push("    --rw-radix-focus-ring: var(--rw-accent);");
    lines.push("    --rw-plannotator-surface: var(--rw-surface-raised);");
    lines.push("    --rw-plannotator-text: var(--rw-text);");
    lines.push("    --rw-plannotator-accent: var(--rw-accent);");
    lines.push("}");
    lines.push("");
    return lines.join("\n");
}

/**
 * @returns {Promise<string>}
 */
export async function loadRunWieldThemeCss() {
    const { resolveSelectedThemeJson } = await import("../theme/theme.js");
    return renderRunWieldThemeCss(await resolveSelectedThemeJson());
}
