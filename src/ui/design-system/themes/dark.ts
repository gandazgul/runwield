/** Browser-owned colors, separate from layout, typography, and TUI settings. */
const DARK_COLORS = {
    "--rw-page-bg": "#0b1020",
    "--rw-surface": "#0f172a",
    "--rw-surface-raised": "#111827",
    "--rw-surface-muted": "#1e293b",
    "--rw-surface-strong": "#172033",
    "--rw-text": "#e2e8f0",
    "--rw-text-strong": "#f8fafc",
    "--rw-text-muted": "#cbd5e1",
    "--rw-text-dim": "#94a3b8",
    "--rw-accent": "#60a5fa",
    "--rw-accent-strong": "#93c5fd",
    "--rw-accent-text": "#bfdbfe",
    "--rw-on-accent": "#0b1020",
    "--rw-on-accent-strong": "#0b1020",
    "--rw-on-success": "#0b1020",
    "--rw-on-warning": "#0b1020",
    "--rw-on-error": "#0b1020",
    "--rw-on-brand": "#0b1020",
    "--rw-border": "#334155",
    "--rw-border-strong": "#475569",
    "--rw-success": "#22c55e",
    "--rw-error": "#f87171",
    "--rw-warning": "#f59e0b",
    "--rw-code": "#85cbbf",
    "--rw-brand": "#85cbbf",
};

export type BrowserThemeColors = Record<keyof typeof DARK_COLORS, string>;

export interface BrowserTheme {
    name: string;
    colorScheme: "dark" | "light";
    colors: BrowserThemeColors;
}

/** A future theme replaces these color roles without changing component CSS. */
export const DARK_BROWSER_THEME: BrowserTheme = {
    name: "runwield-dark",
    colorScheme: "dark",
    colors: DARK_COLORS,
};
