/**
 * @module ui/tui/boot-logo
 *
 * Renders the RunWield boot banner with a block W logo centered on screen.
 * The logo is tinted with the theme's "teal" color. The square on the
 * bottom right blinks like a cursor.
 * Title line keeps its current accent/dim colors.
 */

import { Spacer, Text } from "@earendil-works/pi-tui";
import { getTUI } from "./tui.js";
import { theme } from "../theme/theme.js";

const logo = [
    "▓▓▓▓▓▓▓▓▓▓                            ▓▓▓▓▓▓▓▓▓▓",
    "▓▓▓▓▓▓▓▓▓▓                            ▓▓▓▓▓▓▓▓▓▓",
    "▓▓▓▓▓▓▓▓▓▓                            ▓▓▓▓▓▓▓▓▓▓",
    "▓▓▓▓▓▓▓▓▓▓                            ▓▓▓▓▓▓▓▓▓▓",
    "▓▓▓▓▓▓▓▓▓▓                            ▓▓▓▓▓▓▓▓▓▓",
    "▓▓▓▓▓▓▓▓▓▓                            ▓▓▓▓▓▓▓▓▓▓",
    "▓▓▓▓▓▓▓▓▓▓                            ▓▓▓▓▓▓▓▓▓▓",
    "▓▓▓▓▓▓▓▓▓▓                            ▓▓▓▓▓▓▓▓▓▓",
    "▓▓▓▓▓▓▓▓▓▓                            ▓▓▓▓▓▓▓▓▓▓",
    "▓▓▓▓▓▓▓▓▓▓          ▓▓▓▓▓▓▓▓          ▓▓▓▓▓▓▓▓▓▓",
    "▓▓▓▓▓▓▓▓▓▓         ▓▓▓▓▓▓▓▓▓▓         ▓▓▓▓▓▓▓▓▓▓",
    "▓▓▓▓▓▓▓▓▓▓         ▓▓▓▓▓▓▓▓▓▓         ▓▓▓▓▓▓▓▓▓▓",
    "▓▓▓▓▓▓▓▓▓▓         ▓▓▓▓▓▓▓▓▓▓         ▓▓▓▓▓▓▓▓▓▓",
    "▓▓▓▓▓▓▓▓▓▓         ▓▓▓▓▓▓▓▓▓▓         ▓▓▓▓▓▓▓▓▓▓",
    "▓▓▓▓▓▓▓▓▓▓     ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓     ▓▓▓▓▓▓▓▓▓▓",
    "▓▓▓▓▓▓▓▓▓▓     ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓     ▓▓▓▓▓▓▓▓▓▓",
    "▓▓▓▓▓▓▓▓▓▓     ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓     ▓▓▓▓▓▓▓▓▓▓",
    "▓▓▓▓▓▓▓▓▓▓     ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓     ▓▓▓▓▓▓▓▓▓▓",
];

const dotOff = [
    "▓▓▓▓▓▓▓▓▓▓  ▓▓▓▓▓▓▓▓▓▓    ▓▓▓▓▓▓▓▓▓▓  ▓▓▓▓▓▓▓▓▓▓",
    " ▓▓▓▓▓▓▓▓▓  ▓▓▓▓▓▓▓▓▓▓    ▓▓▓▓▓▓▓▓▓▓  ▓▓▓▓▓▓▓▓▓ ",
    "  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓        ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ",
    "  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓        ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  ",
    "   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓              ▓▓▓▓▓▓▓▓▓▓▓▓▓▓   ",
    "     ▓▓▓▓▓▓▓▓▓▓                  ▓▓▓▓▓▓▓▓▓▓     ",
];

const dotOn = [
    "▓▓▓▓▓▓▓▓▓▓  ▓▓▓▓▓▓▓▓▓▓    ▓▓▓▓▓▓▓▓▓▓  ▓▓▓▓▓▓▓▓▓▓          ▓▓▓▓▓▓▓▓▓▓",
    " ▓▓▓▓▓▓▓▓▓  ▓▓▓▓▓▓▓▓▓▓    ▓▓▓▓▓▓▓▓▓▓  ▓▓▓▓▓▓▓▓▓           ▓▓▓▓▓▓▓▓▓▓",
    "  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓        ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓            ▓▓▓▓▓▓▓▓▓▓",
    "  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓        ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓            ▓▓▓▓▓▓▓▓▓▓",
    "   ▓▓▓▓▓▓▓▓▓▓▓▓▓▓              ▓▓▓▓▓▓▓▓▓▓▓▓▓▓             ▓▓▓▓▓▓▓▓▓▓",
    "     ▓▓▓▓▓▓▓▓▓▓                  ▓▓▓▓▓▓▓▓▓▓               ▓▓▓▓▓▓▓▓▓▓",
];

/** @type {ReturnType<typeof setInterval>} */
let blinkInterval;
/** @type {Text[]} */
const dot = [];

/**
 * Build a centered ASCII logo banner and insert it into the TUI container.
 *
 * @param {import("@earendil-works/pi-tui").Container} container
 */
export function renderBootLogo(container) {
    const { tui, terminal } = getTUI();

    terminal.clearFromCursor();
    terminal.clearScreen();

    container.addChild(new Spacer(1));
    container.addChild(new Spacer(1));

    for (const line of logo) {
        container.addChild(new Text(theme.fg("mdCode", line), 0, 0));
    }

    for (const line of dotOn) {
        const text = new Text(theme.fg("mdCode", line), 0, 0);
        dot.push(text);
        container.addChild(text);
    }

    // Blank lines for spacing
    container.addChild(new Spacer(1));

    // Start the blinking animation
    let visible = true;
    blinkInterval = setInterval(() => {
        visible = !visible;
        const lines = visible ? dotOn : dotOff;
        for (let i = 0; i < dot.length; i++) {
            dot[i].setText(theme.fg("mdCode", lines[i]));
        }

        tui.requestRender();
    }, 1300);
}

export function endBlink() {
    const { tui } = getTUI();

    clearInterval(blinkInterval);

    for (let i = 0; i < dot.length; i++) {
        dot[i].setText(theme.fg("mdCode", dotOn[i]));
    }

    tui.requestRender();
}
