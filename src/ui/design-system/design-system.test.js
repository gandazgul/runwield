import { assertEquals, assertStringIncludes } from "@std/assert";
import { actionClassName } from "./components/Button.jsx";
import { Dialog } from "./components/Dialog.jsx";
import { renderRunWieldThemeCss } from "./theme-bridge.js";

Deno.test("design-system actionClassName maps visual action variants", () => {
    assertEquals(actionClassName("primary"), "primary-action");
    assertEquals(actionClassName("secondary"), "secondary-action");
    assertEquals(actionClassName("danger"), "danger-action");
});

Deno.test("design-system Dialog primitive is importable and styled", async () => {
    assertEquals(typeof Dialog, "function");
    const css = await Deno.readTextFile(new URL("./components.css", import.meta.url));
    assertStringIncludes(css, ".rw-dialog-backdrop");
    assertStringIncludes(css, ".rw-dialog-panel");
    assertStringIncludes(css, ".rw-dialog-footer");
});

Deno.test("renderRunWieldThemeCss renders browser theme variables", () => {
    const css = renderRunWieldThemeCss({
        name: "design-system",
        vars: {
            overlay1: "#505152",
            text: "#202122",
            subtext1: "#303132",
        },
        colors: {
            accent: "#abcdef",
            borderAccent: "#123456",
            mdHeading: "accent",
            borderMuted: "#334455",
            border: "#445566",
            success: "#0bad55",
            error: "#fedcba",
            warning: "#404142",
            mdCode: "#708090",
            selectedBg: "#090807",
            customMessageBg: "#111111",
        },
        export: {
            pageBg: "#010203",
            cardBg: "#111213",
            infoBg: "#141516",
        },
    });

    assertStringIncludes(css, '--rw-theme-name: "design-system"');
    assertStringIncludes(css, "--rw-page-bg: #010203;");
    assertStringIncludes(css, "--rw-surface: #111213;");
    assertStringIncludes(css, "--rw-accent-text: #abcdef;");
    assertStringIncludes(css, "--rw-complexity-high: #fedcba;");
});
