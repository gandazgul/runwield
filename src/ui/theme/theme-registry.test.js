import { assertEquals } from "@std/assert";
import { createThemeRegistry } from "./theme-registry.js";

/** @param {string} name */
function fakeTheme(name) {
    return /** @type {any} */ ({ name });
}

Deno.test("createThemeRegistry always keeps the default theme available", () => {
    const defaultTheme = fakeTheme("catppuccin-mocha");
    const registry = createThemeRegistry({
        defaultTheme,
        setGlobalTheme: () => {},
    });

    registry.setRegisteredThemes([]);
    assertEquals(registry.getAvailableThemes(), ["catppuccin-mocha"]);
});

Deno.test("createThemeRegistry does not allow external themes to override the built-in default", () => {
    const defaultTheme = fakeTheme("catppuccin-mocha");
    const externalDefault = fakeTheme("catppuccin-mocha");
    let current = /** @type {any} */ (null);
    const registry = createThemeRegistry({
        defaultTheme,
        setGlobalTheme: (theme) => {
            current = theme;
        },
    });

    registry.setRegisteredThemes([externalDefault, fakeTheme("custom")]);
    const result = registry.setTheme("catppuccin-mocha");

    assertEquals(result, { success: true });
    assertEquals(current, defaultTheme);
    assertEquals(registry.getAvailableThemes(), ["catppuccin-mocha", "custom"]);
});

Deno.test("createThemeRegistry warns and keeps current theme when persisted theme is unavailable", () => {
    const defaultTheme = fakeTheme("catppuccin-mocha");
    const customTheme = fakeTheme("custom");
    let current = defaultTheme;
    /** @type {string[]} */
    const warnings = [];
    const registry = createThemeRegistry({
        defaultTheme,
        setGlobalTheme: (theme) => {
            current = theme;
        },
        warn: (message) => warnings.push(message),
    });

    registry.setRegisteredThemes([customTheme]);
    registry.setTheme("custom");
    const result = registry.applyPersistedThemeName("missing");

    assertEquals(result.success, false);
    assertEquals(current, customTheme);
    assertEquals(warnings, ['Persisted theme "missing" is not available. Keeping current theme.']);
});

Deno.test("createThemeRegistry notifies subscribers on successful swaps and isolates throwing listeners", () => {
    const defaultTheme = fakeTheme("catppuccin-mocha");
    const customTheme = fakeTheme("custom");
    /** @type {string[]} */
    const events = [];
    /** @type {string[]} */
    const warnings = [];
    const registry = createThemeRegistry({
        defaultTheme,
        setGlobalTheme: (theme) => events.push(`global:${theme.name}`),
        warn: (message) => warnings.push(message),
    });

    registry.setRegisteredThemes([customTheme]);
    registry.onChange(() => events.push("first"));
    registry.onChange(() => {
        throw new Error("boom");
    });
    const unsubscribe = registry.onChange(() => events.push("third"));

    assertEquals(registry.setTheme("custom"), { success: true });
    unsubscribe();
    assertEquals(registry.setTheme("missing").success, false);

    assertEquals(events, ["global:custom", "first", "third"]);
    assertEquals(warnings, ["Theme change listener threw: boom"]);
});
