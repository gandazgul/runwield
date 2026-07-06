import { stopTUI as stopTUIFn } from "../../ui/tui/tui.js";

/**
 * @typedef {Object} CommandDependencies
 * @property {typeof stopTUIFn} [stopTUI]
 * @property {typeof setTimeout} [setTimeout]
 * @property {typeof Deno.exit} [exit]
 */

/**
 * @param {string[]} _argv
 * @param {import('../registry.js').CommandContext & { __testDeps?: CommandDependencies }} [options]
 */
async function runQuitCommand(_argv, options = {}) {
    const deps = /** @type {CommandDependencies} */ ((/** @type {any} */ (options)).__testDeps || {});
    const {
        stopTUI: stopTUIDep,
        setTimeout: setTimeoutDep,
        exit: exitDep,
    } = deps;

    const stopTUI = stopTUIDep || stopTUIFn;
    const setTimeout = setTimeoutDep || globalThis.setTimeout;
    const exit = exitDep || Deno.exit;

    const { editor, tui } = options;

    if (!editor || !tui) return;

    editor.setText("");
    tui.requestRender();
    setTimeout(() => {
        stopTUI();
        setTimeout(() => exit(0), 100);
    }, 50);

    await Promise.resolve();
}

export { runQuitCommand };
