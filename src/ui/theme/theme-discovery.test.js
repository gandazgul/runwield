import { assertEquals } from "@std/assert";
import { loadExternalThemes } from "./theme-discovery.js";

Deno.test("loadExternalThemes merges partial themes and skips built-in name overrides", async () => {
    const baseThemeJson = {
        name: "catppuccin-mocha",
        vars: { base: "#111111", accent: "#222222" },
        colors: { accent: "accent", text: "", selectedBg: "base" },
    };
    const files = {
        "/themes/custom.json": JSON.stringify({
            name: "custom",
            vars: { customAccent: "#abcdef" },
            colors: { accent: "customAccent" },
        }),
        "/themes/catppuccin-mocha.json": JSON.stringify({
            name: "catppuccin-mocha",
            colors: { accent: "#000000" },
        }),
    };
    const themes = /** @type {any[]} */ (await loadExternalThemes({
        packageManager: {
            resolve: () =>
                Promise.resolve({
                    themes: [
                        { path: "/themes/custom.json" },
                        { path: "/themes/catppuccin-mocha.json" },
                    ],
                }),
        },
        readTextFile: (path) => files[/** @type {keyof typeof files} */ (path)],
        defaultThemeName: "catppuccin-mocha",
        baseThemeJson,
        createTheme: (themeJson) => /** @type {any} */ (themeJson),
    }));

    assertEquals(themes, [{
        name: "custom",
        vars: { base: "#111111", accent: "#222222", customAccent: "#abcdef" },
        colors: { accent: "customAccent", text: "", selectedBg: "base" },
        export: {},
    }]);
});
