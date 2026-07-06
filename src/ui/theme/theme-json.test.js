import { assertEquals, assertThrows } from "@std/assert";
import { createThemeFromJson, mergeThemeJson, resolveThemeVars, splitFgBgColors } from "./theme-json.js";

Deno.test("resolveThemeVars resolves nested references and leaves literals intact", () => {
    const resolved = resolveThemeVars({
        name: "test-theme",
        vars: {
            accent: "base",
            base: "#abcdef",
            indexed: 42,
        },
        colors: {
            accent: "accent",
            muted: "",
            warning: "indexed",
            selectedBg: "#111111",
        },
    });

    assertEquals(resolved.colors, {
        accent: "#abcdef",
        muted: "",
        warning: 42,
        selectedBg: "#111111",
    });
});

Deno.test("resolveThemeVars reports missing and circular variables", () => {
    assertThrows(
        () =>
            resolveThemeVars({
                colors: { accent: "missing" },
            }),
        Error,
        "Variable reference not found: missing",
    );

    assertThrows(
        () =>
            resolveThemeVars({
                vars: { one: "two", two: "one" },
                colors: { accent: "one" },
            }),
        Error,
        "Circular variable reference",
    );
});

Deno.test("mergeThemeJson supports partial external themes", () => {
    const base = {
        name: "catppuccin-mocha",
        vars: { base: "#111111", accent: "#222222" },
        colors: { accent: "accent", text: "", selectedBg: "base" },
        export: { pageBg: "base" },
    };
    const external = {
        name: "custom",
        vars: { customAccent: "#abcdef" },
        colors: { accent: "customAccent" },
    };

    const merged = mergeThemeJson(base, external);
    const resolved = resolveThemeVars(merged);

    assertEquals(merged.name, "custom");
    assertEquals(resolved.colors, {
        accent: "#abcdef",
        text: "",
        selectedBg: "#111111",
    });
    assertEquals(merged.export, { pageBg: "base" });
});

Deno.test("splitFgBgColors separates Pi foreground and background tokens", () => {
    const split = splitFgBgColors({
        accent: "#abcdef",
        selectedBg: "#111111",
        toolErrorBg: 52,
        text: "",
    });

    assertEquals(split.fgColors, { accent: "#abcdef", text: "" });
    assertEquals(split.bgColors, { selectedBg: "#111111", toolErrorBg: 52 });
});

Deno.test("createThemeFromJson constructs a Theme from resolved foreground and background colors", () => {
    class FakeTheme {
        /** @param {Record<string, string | number>} fgColors @param {Record<string, string | number>} bgColors @param {string} colorMode @param {{ name?: string }} options */
        constructor(fgColors, bgColors, colorMode, options) {
            this.fgColors = fgColors;
            this.bgColors = bgColors;
            this.colorMode = colorMode;
            this.name = options.name;
        }
    }

    const theme = /** @type {any} */ (createThemeFromJson({
        name: "custom",
        vars: { accent: "#abcdef", bg: "#111111" },
        colors: {
            accent: "accent",
            selectedBg: "bg",
        },
    }, {
        colorMode: "256color",
        ThemeCtor: /** @type {any} */ (FakeTheme),
    }));

    assertEquals(theme.name, "custom");
    assertEquals(theme.colorMode, "256color");
    assertEquals(theme.fgColors, { accent: "#abcdef" });
    assertEquals(theme.bgColors, { selectedBg: "#111111" });
});
