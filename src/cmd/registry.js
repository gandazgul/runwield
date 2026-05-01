/**
 * @module cmd/registry
 * Central command handler registry.
 */

import { COMMAND_NAMES } from "../constants.js";
import { runHelpCommand } from "./help/index.js";
import { runPlansCommand } from "./plans/index.js";
import { runRouterCommand } from "./router/index.js";
import { runSleepCommand } from "./sleep/index.js";
import { getAgentCompletions, runAgentsCommand } from "./agents/index.js";
import { getModelCompletions, runModelsCommand } from "./models/index.js";
import { runQuitCommand } from "./quit/index.js";
import { getResumeCompletions, runResumeCommand } from "./resume/index.js";

/**
 * @typedef {import('./types.js').CommandContext} CommandContext
 */

/**
 * @typedef {(argv: string[], options?: CommandContext) => Promise<void>} CommandHandler
 */

/**
 * @typedef {Object} CommandDefinition
 * @property {string} name
 * @property {string} displayName
 * @property {string} description
 * @property {CommandHandler} execute
 * @property {boolean} isSlash
 * @property {boolean} isCli
 * @property {(argumentPrefix: string) => Promise<import('./types.js').CommandCompletionItem[]>} [getArgumentCompletions]
 */

/** @type {Record<string, CommandDefinition>} */
export const commandRegistry = {
    [COMMAND_NAMES.ROUTER]: {
        name: COMMAND_NAMES.ROUTER,
        displayName: "Router",
        description: "Triage the current request (default)",
        execute: runRouterCommand,
        isSlash: false,
        isCli: true,
    },
    [COMMAND_NAMES.AGENT]: {
        name: COMMAND_NAMES.AGENT,
        displayName: "Agent",
        description: "Switch active agent",
        execute: runAgentsCommand,
        isSlash: true,
        isCli: true,
        getArgumentCompletions: getAgentCompletions,
    },
    [COMMAND_NAMES.MODEL]: {
        name: COMMAND_NAMES.MODEL,
        displayName: "Model",
        description: "Switch AI model",
        execute: runModelsCommand,
        isSlash: true,
        isCli: true,
        getArgumentCompletions: getModelCompletions,
    },
    [COMMAND_NAMES.RESUME]: {
        name: COMMAND_NAMES.RESUME,
        displayName: "Resume",
        description: "Resume a saved plan",
        execute: runResumeCommand,
        isSlash: true,
        isCli: true,
        getArgumentCompletions: getResumeCompletions,
    },
    [COMMAND_NAMES.PLANS]: {
        name: COMMAND_NAMES.PLANS,
        displayName: "Plans",
        description: "List or manage plans",
        execute: runPlansCommand,
        isSlash: false,
        isCli: true,
    },
    [COMMAND_NAMES.SLEEP]: {
        name: COMMAND_NAMES.SLEEP,
        displayName: "Sleep",
        description: "Let the model consolidate context",
        execute: runSleepCommand,
        isSlash: true,
        isCli: true,
    },
    [COMMAND_NAMES.HELP]: {
        name: COMMAND_NAMES.HELP,
        displayName: "Help",
        description: "Show help information",
        execute: runHelpCommand,
        isSlash: false,
        isCli: true,
    },
    [COMMAND_NAMES.QUIT]: {
        name: COMMAND_NAMES.QUIT,
        displayName: "Quit",
        description: "Exit the application",
        execute: runQuitCommand,
        isSlash: true,
        isCli: true,
    },
    [COMMAND_NAMES.EXIT]: {
        name: COMMAND_NAMES.EXIT,
        displayName: "Exit",
        description: "Exit the application",
        execute: runQuitCommand,
        isSlash: true,
        isCli: true,
    },
};
