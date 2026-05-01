/**
 * @module cmd/registry
 * Central command handler registry.
 */

import { COMMAND_NAMES } from "../constants.js";
import { runHelpCommand } from "./help/index.js";
import { runPlansCommand } from "./plans/index.js";
import { runResumeCommand } from "./resume/index.js";
import { runRouterCommand } from "./router/index.js";
import { runSleepCommand } from "./sleep/index.js";
import { runAgentsCommand } from "./agents/index.js";
import { runModelsCommand } from "./models/index.js";
import { runQuitCommand } from "./quit/index.js";

/**
 * @typedef {Object} CommandContext
 * @property {import('../shared/workflow.js').UiAPI} [uiAPI]
 * @property {any} [editor]
 * @property {string} [text]
 * @property {any} [tui]
 * @property {Function} [originalHandleInput]
 */

/**
 * @typedef {(argv: string[], options?: CommandContext) => Promise<void>} CommandHandler
 */

/** @type {Record<string, CommandHandler>} */
export const commandRegistry = {
    [COMMAND_NAMES.ROUTER]: runRouterCommand,
    [COMMAND_NAMES.AGENT]: runAgentsCommand,
    [COMMAND_NAMES.MODEL]: runModelsCommand,
    [COMMAND_NAMES.RESUME]: runResumeCommand,
    [COMMAND_NAMES.PLANS]: runPlansCommand,
    [COMMAND_NAMES.SLEEP]: runSleepCommand,
    [COMMAND_NAMES.HELP]: runHelpCommand,
    [COMMAND_NAMES.QUIT]: runQuitCommand,
    [COMMAND_NAMES.EXIT]: runQuitCommand,
};
