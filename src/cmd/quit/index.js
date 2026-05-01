import { stopTUI } from "../../shared/tui.js";

/**
 * @param {string[]} _argv
 * @param {import('../registry.js').CommandContext} [options]
 */
async function runQuitCommand(_argv, options = {}) {
    const { editor, tui } = options;

    editor.setText("");
    tui.requestRender();
    setTimeout(() => {
        stopTUI();
        setTimeout(() => Deno.exit(0), 100);
    }, 50);

    await Promise.resolve();
}

export { runQuitCommand };
