import { assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { actionClassName } from "./components/Button.jsx";
import { Dialog } from "./components/Dialog.jsx";
import { RunWieldButton, RunWieldLink } from "./components/react/RunWieldPrimitives.jsx";
import { renderRunWieldThemeCss } from "./theme-bridge.js";

/** @typedef {{ href?: string, className?: string }} LinkProps */

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

Deno.test("React action primitives preserve button and link semantics", () => {
    /** @type {{ type: string, props: { type?: string, className: string, href?: string } }} */
    const button = RunWieldButton({ children: "Save" });
    /** @type {{ type: string, props: { type?: string, className: string, href?: string } }} */
    const link = RunWieldLink({ children: "Open", href: "/plans", variant: "primary" });
    assertEquals(button.type, "button");
    assertEquals(button.props.type, "button");
    assertEquals(button.props.className, "secondary-action");
    const linkProps = /** @type {LinkProps} */ (link.props);
    assertEquals(link.type, "a");
    assertEquals(linkProps.href, "/plans");
    assertEquals(linkProps.className, "primary-action");
});

Deno.test("design-system exposes review action, modal, and segmented toggle styling", async () => {
    const css = await Deno.readTextFile(new URL("./components.css", import.meta.url));
    assertStringIncludes(css, '.rw-review-action [data-slot="button"]');
    assertStringIncludes(css, ".rw-review-action-button");
    assertStringIncludes(css, ".rw-modal-primary-button");
    assertStringIncludes(css, ".rw-modal-submit-hint");
    assertStringIncludes(css, ".rw-modal-textarea");
    assertStringIncludes(css, ".rw-segmented-toggle button svg");
    assertStringIncludes(css, ".rw-segmented-toggle button > div");
    assertStringIncludes(css, "width: 1.75rem !important;");
    assertStringIncludes(css, "width: auto !important;");
    assertStringIncludes(css, ".rw-segmented-toggle button span:not([aria-hidden])");
    assertStringIncludes(css, "background: color-mix(in srgb, var(--rw-accent) 8%, transparent);");
    assertStringIncludes(css, "overflow: hidden;");
    assertStringIncludes(css, "min-width: 0;");
    assertStringIncludes(css, "max-width: 0;");
    assertStringIncludes(css, "max-width: 12rem;");
});

Deno.test("design-system keeps Workspace controls compact and reserves pills for metadata", async () => {
    const tokens = await Deno.readTextFile(new URL("./tokens.css", import.meta.url));
    const components = await Deno.readTextFile(new URL("./components.css", import.meta.url));
    const workspace = await Deno.readTextFile(new URL("../workspace/static/workspace.css", import.meta.url));
    const docs = await Deno.readTextFile(new URL("../../../docs/design-system.md", import.meta.url));

    assertStringIncludes(tokens, "--rw-radius-control: 0.375rem;");
    assertStringIncludes(tokens, "--rw-radius-panel: 0.5rem;");
    assertStringIncludes(tokens, "--rw-control-height: 2rem;");
    assertStringIncludes(tokens, "box-sizing: border-box;");
    assertStringIncludes(components, "border-radius: var(--rw-radius-control);");
    assertStringIncludes(workspace, "font-size: 0.875rem;");
    assertStringIncludes(workspace, "min-height: var(--rw-control-height);");
    assertStringIncludes(docs, "Plan Review and Code Review are the visual blueprint");
    assertStringIncludes(docs, "pill geometry only for statuses, counts, and short metadata badges");

    const sharedActionRule = components.match(/\.primary-action,[\s\S]*?\{([\s\S]*?)\}/)?.[1] || "";
    assertFalse(sharedActionRule.includes("999px"));
    assertFalse(components.includes(".action-primary"));
    assertFalse(workspace.includes(".action-primary"));
    assertStringIncludes(docs, "Use `.primary-action`, `.secondary-action`, and `.danger-action`");
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
    assertStringIncludes(css, ".theme-runwield {");
    assertStringIncludes(css, "--card: var(--rw-surface);");
    assertStringIncludes(css, "--muted-foreground: var(--rw-text-muted);");
});
