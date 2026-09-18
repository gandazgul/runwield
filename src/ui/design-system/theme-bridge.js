/** Browser theme CSS and aliases for shared review components. */
import { DARK_BROWSER_THEME } from "./themes/dark.ts";

/**
 * Render a browser-owned theme. Callers can supply another token set without
 * changing component CSS or reading TUI settings.
 * @param {import("./themes/dark.ts").BrowserTheme} [theme]
 * @returns {string}
 */
export function renderRunWieldThemeCss(theme = DARK_BROWSER_THEME) {
    const lines = [
        ":root {",
        `    --rw-theme-name: ${JSON.stringify(theme.name)};`,
        `    color-scheme: ${theme.colorScheme};`,
        ...Object.entries(theme.colors).map(([token, value]) => `    ${token}: ${value};`),
    ];

    lines.push("    --rw-radix-popover-bg: var(--rw-surface-raised);");
    lines.push("    --rw-radix-focus-ring: var(--rw-accent);");
    lines.push("    --rw-plannotator-surface: var(--rw-surface-raised);");
    lines.push("    --rw-plannotator-text: var(--rw-text);");
    lines.push("    --rw-plannotator-accent: var(--rw-accent);");
    lines.push("}");
    lines.push("");
    lines.push(".theme-runwield {");
    lines.push("    --background: var(--rw-page-bg);");
    lines.push("    --foreground: var(--rw-text);");
    lines.push("    --card: var(--rw-surface);");
    lines.push("    --card-foreground: var(--rw-text);");
    lines.push("    --popover: var(--rw-surface-raised);");
    lines.push("    --popover-foreground: var(--rw-text);");
    lines.push("    --primary: var(--rw-accent);");
    lines.push("    --primary-foreground: var(--rw-on-accent);");
    lines.push("    --secondary: var(--rw-accent-strong);");
    lines.push("    --secondary-foreground: var(--rw-on-accent-strong);");
    lines.push("    --muted: var(--rw-surface-muted);");
    lines.push("    --muted-foreground: var(--rw-text-muted);");
    lines.push("    --accent: var(--rw-accent);");
    lines.push("    --accent-foreground: var(--rw-on-accent);");
    lines.push("    --destructive: var(--rw-error);");
    lines.push("    --destructive-foreground: var(--rw-on-error);");
    lines.push("    --success: var(--rw-success);");
    lines.push("    --success-foreground: var(--rw-on-success);");
    lines.push("    --warning: var(--rw-warning);");
    lines.push("    --warning-foreground: var(--rw-on-warning);");
    lines.push("    --border: var(--rw-border);");
    lines.push("    --input: var(--rw-surface-muted);");
    lines.push("    --ring: var(--rw-accent);");
    lines.push("    --code-bg: var(--rw-surface-raised);");
    lines.push("    --focus-highlight: color-mix(in srgb, var(--rw-accent) 28%, transparent);");
    lines.push("    --font-sans: var(--rw-font-sans);");
    lines.push("    --font-mono: var(--rw-font-mono);");
    lines.push("    --radius: var(--rw-radius-panel);");
    lines.push("}");
    lines.push("");
    return lines.join("\n");
}
