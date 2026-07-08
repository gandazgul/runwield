import { renderRunWieldThemeCss } from "../../design-system/theme-bridge.js";

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
export const GET = async () => {
    const css = renderRunWieldThemeCss(await loadSelectedThemeJsonForAstroDev());
    return new Response(css, {
        headers: {
            "content-type": "text/css; charset=utf-8",
            "cache-control": "no-store",
        },
    });
};
