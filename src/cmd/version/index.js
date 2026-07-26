/**
 * @module cmd/version
 * Print runwield version and architecture.
 */

import { VERSION } from "../../shared/version.js";

const TARGET_ARCH = Deno.build.target;

/**
 * Run the version command — prints "runwield <version> (<target-triple>)" to stdout,
 * or to the active UI when invoked as an interactive slash command.
 *
 * @param {string[]} [_argv]
 * @param {{ uiAPI?: import('../../ui/tui/types.js').UiAPI }} [options]
 * @returns {Promise<void>}
 */
export function runVersionCommand(_argv = [], options = {}) {
    const message = `runwield ${VERSION} (${TARGET_ARCH})`;
    if (options.uiAPI) {
        options.uiAPI.appendSystemMessage(message);
    } else {
        console.log(message);
    }
    return Promise.resolve();
}
