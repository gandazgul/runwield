/**
 * @module ui/tui/prompts
 * Interactive user-facing prompt helpers for TUI overlays and stdin fallback.
 */

import { Container, Input, SelectList, Text } from "@earendil-works/pi-tui";
import { getTUI } from "./tui.js";
import { getSelectListTheme, theme } from "../theme/theme.js";

const defaultPromptDeps = {
    Container,
    Input,
    SelectList,
    Text,
    getTUI,
    getSelectListTheme,
    theme,
    readUserInput: readUserInputFromStdin,
};

/** @type {typeof defaultPromptDeps} */
let promptDeps = defaultPromptDeps;

/**
 * Read a single line-ish response from stdin (fallback used when no TUI is active).
 *
 * @param {number} [maxBytes=256]
 * @returns {Promise<string>}
 */
async function readUserInputFromStdin(maxBytes = 256) {
    const buf = new Uint8Array(maxBytes);
    const bytesRead = await Deno.stdin.read(buf);
    if (bytesRead === null) return "";
    return new TextDecoder()
        .decode(buf.subarray(0, bytesRead))
        .replaceAll("\0", "")
        .trim();
}

/**
 * @returns {{ tui: import('@earendil-works/pi-tui').TUI } | null}
 */
function tryGetTUI() {
    try {
        return promptDeps.getTUI();
    } catch {
        return null;
    }
}

/**
 * Show a multiple-choice select prompt.
 * Uses overlay in TUI mode and stdin fallback otherwise.
 *
 * @param {string} title
 * @param {Array<{value: string, label: string, description?: string}>} options
 * @returns {Promise<string | null>}
 */
export async function select(title, options) {
    const tuiCtx = tryGetTUI();
    if (!tuiCtx) {
        return await selectFallback(title, options);
    }

    const { tui } = tuiCtx;

    return await new Promise((resolve) => {
        const container = new promptDeps.Container();

        container.addChild(new promptDeps.Text("─".repeat(40), 1, 0));
        container.addChild(new promptDeps.Text(promptDeps.theme.fg("accent", promptDeps.theme.bold(title)), 1, 0));
        container.addChild(new promptDeps.Text("─".repeat(40), 1, 0));

        const selectList = new promptDeps.SelectList(
            options,
            Math.min(options.length, 10),
            promptDeps.getSelectListTheme(),
        );

        /** @type {import('@earendil-works/pi-tui').OverlayHandle | null} */
        let handle = null;

        selectList.onSelect = (item) => {
            if (handle) handle.hide();
            resolve(item.value);
        };

        selectList.onCancel = () => {
            if (handle) handle.hide();
            resolve(null);
        };

        container.addChild(selectList);
        container.addChild(new promptDeps.Text("─".repeat(40), 1, 0));
        container.addChild(
            new promptDeps.Text(
                promptDeps.theme.fg("dim", "↑↓ navigate • enter select • esc cancel"),
                1,
                0,
            ),
        );

        const component = {
            /** @param {number} w */
            render: (w) => container.render(w),
            invalidate: () => container.invalidate(),
            /** @param {string} data */
            handleInput: (data) => {
                selectList.handleInput(data);
                tui.requestRender();
            },
        };

        handle = tui.showOverlay(component, {
            width: "80%",
            minWidth: 40,
            anchor: "center",
            margin: 2,
        });
    });
}

/**
 * Prompt for free-text input.
 * Uses overlay in TUI mode and stdin fallback otherwise.
 *
 * @param {string} title
 * @param {{ defaultValue?: string, placeholder?: string, allowEmpty?: boolean }} [opts]
 * @returns {Promise<string | null>} Returns null when canceled.
 */
export async function promptText(title, opts = {}) {
    const { defaultValue, placeholder, allowEmpty = true } = opts;
    const tuiCtx = tryGetTUI();

    if (!tuiCtx) {
        const result = await promptTextFallback(title, opts);
        if (!allowEmpty && !result.trim()) {
            return defaultValue !== undefined ? defaultValue : "";
        }
        return result;
    }

    const { tui } = tuiCtx;

    return await new Promise((resolve) => {
        const container = new promptDeps.Container();
        const input = new promptDeps.Input();
        input.setValue(defaultValue || "");

        container.addChild(new promptDeps.Text("─".repeat(40), 1, 0));
        container.addChild(new promptDeps.Text(promptDeps.theme.fg("accent", promptDeps.theme.bold(title)), 1, 0));
        if (placeholder) {
            container.addChild(new promptDeps.Text(promptDeps.theme.fg("dim", placeholder), 1, 0));
        }
        container.addChild(new promptDeps.Text("─".repeat(40), 1, 0));
        container.addChild(input);
        container.addChild(new promptDeps.Text("─".repeat(40), 1, 0));

        const hints = ["enter submit", "esc cancel"];
        if (!allowEmpty) hints.unshift("non-empty required");

        container.addChild(
            new promptDeps.Text(
                promptDeps.theme.fg("dim", hints.join(" • ")),
                1,
                0,
            ),
        );

        /** @type {import('@earendil-works/pi-tui').OverlayHandle | null} */
        let handle = null;

        input.onSubmit = (value) => {
            const finalValue = value || defaultValue || "";
            if (!allowEmpty && !finalValue.trim()) {
                return;
            }
            if (handle) handle.hide();
            resolve(finalValue);
        };

        input.onEscape = () => {
            if (handle) handle.hide();
            resolve(null);
        };

        const component = {
            /** @param {number} w */
            render: (w) => container.render(w),
            invalidate: () => container.invalidate(),
            /** @param {string} data */
            handleInput: (data) => {
                input.handleInput(data);
                tui.requestRender();
            },
        };

        handle = tui.showOverlay(component, {
            width: "80%",
            minWidth: 50,
            anchor: "center",
            margin: 2,
        });
    });
}

/**
 * Show a yes/no prompt.
 *
 * @param {string} message
 * @returns {Promise<boolean>}
 */
export async function confirm(message) {
    const result = await select(message, [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
    ]);
    return result === "yes";
}

/**
 * @param {string} title
 * @param {Array<{value: string, label: string}>} options
 */
async function selectFallback(title, options) {
    console.log(`\n${title}`);
    options.forEach((opt, i) => {
        console.log(`  ${i + 1}) ${opt.label}`);
    });
    console.log("Select option number and press Enter (empty to cancel):");

    const input = await promptDeps.readUserInput(1024);
    if (!input) return null;

    const index = Number.parseInt(input, 10);
    if (!Number.isNaN(index) && index >= 1 && index <= options.length) {
        return options[index - 1].value;
    }

    const byValue = options.find((opt) => opt.value === input.trim());
    return byValue ? byValue.value : null;
}

/**
 * @param {string} title
 * @param {{ defaultValue?: string, placeholder?: string }} opts
 */
async function promptTextFallback(title, opts) {
    const { defaultValue, placeholder } = opts;
    console.log(`\n${title}`);
    if (placeholder) console.log(`${placeholder}`);
    if (defaultValue !== undefined) {
        console.log(`Default: ${defaultValue}`);
    }
    console.log("Enter response and press Enter (empty uses default, if provided):");

    const input = await promptDeps.readUserInput(4096);
    if (!input && defaultValue !== undefined) return defaultValue;
    return input;
}

/**
 * Override prompt dependencies for tests.
 *
 * @param {Partial<typeof defaultPromptDeps>} [deps]
 */
export function __setPromptDepsForTest(deps = {}) {
    promptDeps = { ...defaultPromptDeps, ...deps };
}
