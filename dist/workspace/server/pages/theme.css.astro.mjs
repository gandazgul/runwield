export { renderers } from '../renderers.mjs';

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
function renderRunWieldThemeCss(themeJson) {
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

/** @type {import("../../design-system/theme-bridge.js").RunWieldBrowserThemeJson} */
const FALLBACK_THEME_JSON = {
    name: "catppuccin-mocha",
    vars: {
        text: "#cdd6f4",
        subtext1: "#bac2de",
        overlay1: "#7f849c",
    },
    colors: {
        selectedBg: "#313244",
        customMessageBg: "#181825",
        accent: "#89b4fa",
        borderAccent: "#89b4fa",
        mdHeading: "#cba6f7",
        borderMuted: "#45475a",
        border: "#585b70",
        success: "#a6e3a1",
        error: "#f38ba8",
        warning: "#f9e2af",
        mdCode: "#a6e3a1",
    },
    export: {
        pageBg: "#11111b",
        cardBg: "#1e1e2e",
        infoBg: "#313244",
    },
};

/**
 * Astro dev runs this route through Vite's module runner, which cannot resolve
 * Deno JSR imports pulled in by the full settings/theme discovery stack. Use a
 * Deno subprocess for selected-theme lookup, then render via the canonical
 * theme bridge in this route.
 * @returns {Promise<import("../../design-system/theme-bridge.js").RunWieldBrowserThemeJson>}
 */
async function loadSelectedThemeJsonForAstroDev() {
    const command = new Deno.Command(Deno.execPath(), {
        args: [
            "eval",
            "--config",
            "deno.json",
            `import { resolveSelectedThemeJson } from "./src/ui/theme/theme.js";
console.log(JSON.stringify(await resolveSelectedThemeJson()));`,
        ],
        cwd: new URL("../../../..", import.meta.url),
        stdout: "piped",
        stderr: "null",
    });
    const output = await command.output();
    if (!output.success) return FALLBACK_THEME_JSON;
    try {
        return JSON.parse(new TextDecoder().decode(output.stdout));
    } catch {
        return FALLBACK_THEME_JSON;
    }
}

/** @type {import("astro").APIRoute} */
const GET = async () => {
    const css = renderRunWieldThemeCss(await loadSelectedThemeJsonForAstroDev());
    return new Response(css, {
        headers: {
            "content-type": "text/css; charset=utf-8",
            "cache-control": "no-store",
        },
    });
};

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
    __proto__: null,
    GET
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
