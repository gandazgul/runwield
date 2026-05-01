/**
 * @module shared/theme
 * Catppuccin Mocha theme definitions for pi-tui components.
 */

import chalk from "chalk";

const colors = {
    base: "#1e1e2e",
    mantle: "#181825",
    crust: "#11111b",
    text: "#cdd6f4",
    subtext1: "#bac2de",
    subtext0: "#a6adc8",
    overlay2: "#9399b2",
    overlay1: "#7f849c",
    overlay0: "#6c7086",
    surface2: "#585b70",
    surface1: "#45475a",
    surface0: "#313244",
    rosewater: "#f5e0dc",
    flamingo: "#f2cdcd",
    pink: "#f5c2e7",
    mauve: "#cba6f7", // Accent
    red: "#f38ba8", // Error
    maroon: "#eba0ac",
    peach: "#fab387",
    yellow: "#f9e2af", // Warning
    green: "#a6e3a1", // Success
    teal: "#94e2d5",
    sky: "#89dceb",
    sapphire: "#74c7ec",
    blue: "#89b4fa",
    lavender: "#b4befe",
};

export const theme = {
    /**
     * @param {string} type
     * @param {string} text
     * @returns {string}
     */
    fg: (type, text) => {
        switch (type) {
            case "accent":
                return chalk.hex(colors.mauve)(text);
            case "success":
                return chalk.hex(colors.green)(text);
            case "error":
                return chalk.hex(colors.red)(text);
            case "warning":
                return chalk.hex(colors.yellow)(text);
            case "muted":
                return chalk.hex(colors.overlay0)(text);
            case "dim":
                return chalk.hex(colors.surface2)(text);
            case "bg":
                return chalk.hex(colors.base)(text);
            default:
                return chalk.hex(colors.text)(text);
        }
    },
    /**
     * @param {string} type
     * @param {string} text
     * @returns {string}
     */
    bg: (type, text) => {
        switch (type) {
            case "base":
                return chalk.bgHex(colors.base)(text);
            case "mantle":
                return chalk.bgHex(colors.mantle)(text);
            case "crust":
                return chalk.bgHex(colors.crust)(text);
            default:
                return chalk.bgHex(colors.base)(text);
        }
    },
    bold: chalk.bold,
    italic: chalk.italic,
    colors,
};

export const selectListTheme = {
    /** @param {string} t */
    selectedPrefix: (t) => chalk.hex(colors.mauve)(t),
    /** @param {string} t */
    selectedText: (t) => chalk.hex(colors.mauve).bold(t),
    /** @param {string} t */
    description: (t) => chalk.hex(colors.subtext0)(t),
    /** @param {string} t */
    scrollInfo: (t) => chalk.hex(colors.surface2)(t),
    /** @param {string} t */
    noMatch: (t) => chalk.hex(colors.red)(t),
};

export const editorTheme = {
    /** @param {string} s */
    borderColor: (s) => chalk.hex(colors.teal)(s),
    selectList: selectListTheme,
};

export const markdownTheme = {
    /** @param {string} t */
    heading: (t) => chalk.hex(colors.mauve).bold(t),
    /** @param {string} t */
    link: (t) => chalk.hex(colors.blue).underline(t),
    /** @param {string} t */
    code: (t) => chalk.hex(colors.peach).bgHex(colors.surface0)(t),
    /** @param {string} t */
    codeBlock: (t) => chalk.hex(colors.text).bgHex(colors.mantle)(t),
    /** @param {string} t */
    codeBlockBorder: (t) => chalk.hex(colors.surface1).bgHex(colors.base)(t),
    /** @param {string} t */
    quote: (t) => chalk.hex(colors.subtext1).italic(t),
    /** @param {string} t */
    quoteBorder: (t) => chalk.hex(colors.surface1)(t),
    /** @param {string} t */
    hr: (t) => chalk.hex(colors.surface0)(t),
    /** @param {string} t */
    listBullet: (t) => chalk.hex(colors.mauve)(t),
    /** @param {string} t */
    linkUrl: (t) => chalk.hex(colors.surface2)(t),
    bold: chalk.bold,
    italic: chalk.italic,
    strikethrough: chalk.strikethrough,
    underline: chalk.underline,
};

export const imageTheme = {
    /** @param {string} s */
    fallbackColor: (s) => chalk.hex(colors.surface2)(s),
};
