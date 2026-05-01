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

/**
 * @typedef {(argv: string[], options?: any) => Promise<void>} CommandHandler
 */

/** @type {Record<string, CommandHandler>} */
export const commandRegistry = {
    [COMMAND_NAMES.ROUTER]: runRouterCommand,
    [COMMAND_NAMES.AGENTS]: runAgentsCommand,
    [COMMAND_NAMES.MODELS]: runModelsCommand,
    [COMMAND_NAMES.RESUME]: runResumeCommand,
    [COMMAND_NAMES.PLANS]: runPlansCommand,
    [COMMAND_NAMES.SLEEP]: runSleepCommand,
    [COMMAND_NAMES.HELP]: runHelpCommand,
};
