/**
 * @module ui/tui/slash-dispatch
 *
 * Routes a `/command` user submission to either:
 * - a built-in command from cmd/registry.js, or
 * - a user-defined prompt template / skill macro.
 *
 * Built-in commands receive presentation objects plus an opaque runtime session id.
 * Templates switch to Operator, expand the text, then submit it through the
 * active root path. Skills expand in the current active agent context.
 */

import { basename } from "@std/path";
import { setTerminalTitleForName } from "./terminal-title.js";

const OPERATOR_AGENT = "operator";

/**
 * If the current session has no display name, update the terminal title to
 * `wld - {folder} - {displayName}` so it reflects the active slash command
 * rather than the raw cwd basename.
 *
 * For `/agent`, displayName should be the chosen agent name (not "agent").
 *
 * @param {string} command
 * @param {import('../../shared/session/session-runtime.js').SessionRuntime} runtime
 * @param {string} sessionId
 * @param {string} [displayName] - Override for the suffix (e.g. agent name).
 */
function maybeUpdateTitleForSlashCommand(command, runtime, sessionId, displayName) {
    const snapshot = runtime.getSessionSnapshot(sessionId);
    if (snapshot && !snapshot.name) {
        const folder = basename(snapshot.cwd);
        if (displayName === "") {
            // No suffix yet (e.g. /agent with interactive picker before selection)
            setTerminalTitleForName(folder);
        } else {
            const label = displayName || command;
            setTerminalTitleForName(`${folder} - ${label}`);
        }
    }
}

/**
 * @typedef {Object} SkillMeta
 * @property {string} name
 * @property {string} description
 * @property {string} path
 * @property {"local" | "home" | "bundled" | "external"} source
 * @property {boolean} [disableModelInvocation]
 */

/**
 * @typedef {Object} SlashContext
 * @property {string} userRequest
 * @property {import('../../shared/session/types.js').ImageAttachment[]} savedImages
 * @property {string} sessionId
 * @property {import('../../shared/session/session-runtime.js').SessionRuntime} sessionRuntime
 * @property {import('./types.js').UiAPI} uiAPI
 * @property {import('@earendil-works/pi-tui').Editor} editor
 * @property {import('@earendil-works/pi-tui').TUI} tui
 * @property {string} sessionStartedAt
 * @property {(data: string) => void} originalHandleInput
 * @property {Set<string>} builtinNames
 * @property {Map<string, { name: string, argumentHint?: string, description?: string, model?: string, source?: string }>} promptTemplateByName
 * @property {SkillMeta[]} skills
 * @property {string} chatPromptAgentName
 * @property {(templateModel: string) => ({ ok: true, provider: string, id: string } | { ok: false })} resolveTemplateModel
 * @property {(model: string, provider?: string) => Promise<void> | void} [setActiveModel]
 * @property {(nextSessionId: string) => void} [replaceRuntimeSession]
 * @property {(text: string, images: import('../../shared/session/types.js').ImageAttachment[]) => Promise<void>} [dispatchExpandedUserRequest]
 * @property {import('./generation-guard.js').GenerationGuard} generationGuard
 * @property {{
 *   expandPromptTemplate?: (templatePath: string, instructions?: string) => Promise<string>,
 *   expandSkillCommand?: (skillName: string, instructions?: string, cwd?: string) => Promise<string>,
 *   commandRegistry?: Record<string, { execute: (args: string[], deps: object) => Promise<void> | void }>,
 *   getSlashCommandDefinition?: (name: string) => { name: string } | undefined,
 * }} [__deps]
 */

/**
 * Try to handle a `/command` user submission.
 *
 * @param {SlashContext} ctx
 * @returns {Promise<boolean>} True if input started with `/` (handled or unknown); false to defer.
 */
export async function handleSlashCommand(ctx) {
    const { userRequest } = ctx;
    if (!userRequest.startsWith("/")) return false;

    const [rawCommand, ...args] = userRequest.slice(1).split(" ");
    const command = rawCommand.trim();

    const thisGen = ctx.generationGuard.bump();

    const registryDeps = ctx.__deps || {};
    let commandRegistry = registryDeps.commandRegistry;
    let getSlashCommandDefinition = registryDeps.getSlashCommandDefinition;
    if (!commandRegistry || !getSlashCommandDefinition) {
        const registryModule = await import("../../cmd/registry.js");
        commandRegistry = commandRegistry || registryModule.commandRegistry;
        getSlashCommandDefinition = getSlashCommandDefinition || registryModule.getSlashCommandDefinition;
    }

    const builtinCommand = getSlashCommandDefinition(command);
    if (builtinCommand && ctx.builtinNames.has(builtinCommand.name)) {
        // For /agent, use the chosen agent name instead of "agent".
        // When no arg is given (interactive picker), pass "" so title is folder-only
        // until the user picks; runAgentsCommandTUI updates it after selection.
        const displayName = command === "agent" ? (args[0] || "") : undefined;
        maybeUpdateTitleForSlashCommand(builtinCommand.name, ctx.sessionRuntime, ctx.sessionId, displayName);
        await dispatchBuiltin(ctx, builtinCommand.name, args, commandRegistry, thisGen);
        return true;
    }

    const template = ctx.promptTemplateByName.get(command);
    if (template) {
        maybeUpdateTitleForSlashCommand(command, ctx.sessionRuntime, ctx.sessionId);
        await dispatchTemplate(ctx, template, args.join(" "), thisGen);
        return true;
    }

    // Skill commands (/skill:{name})
    if (command.startsWith("skill:")) {
        const skillName = command.slice(6);
        const skill = ctx.skills.find((s) => s.name === skillName);
        if (skill) {
            maybeUpdateTitleForSlashCommand(command, ctx.sessionRuntime, ctx.sessionId);
            await dispatchSkill(ctx, skill, args.join(" "), thisGen);
            return true;
        }
        // Skill name doesn't match any known skill — fall through to unknown command
    }

    ctx.uiAPI.appendSystemMessage(`Unknown command: /${command}`);
    return true;
}

/**
 * @param {SlashContext} ctx
 * @param {string} command
 * @param {string[]} args
 * @param {Record<string, { execute: (args: string[], deps: object) => Promise<void> | void }>} commandRegistry
 * @param {number} thisGen
 */
async function dispatchBuiltin(ctx, command, args, commandRegistry, thisGen) {
    const {
        uiAPI,
        editor,
        tui,
        sessionStartedAt,
        originalHandleInput,
        generationGuard,
    } = ctx;

    try {
        await commandRegistry[command].execute(args, {
            uiAPI,
            editor,
            sessionId: ctx.sessionId,
            sessionRuntime: ctx.sessionRuntime,
            sessionStartedAt,
            tui,
            originalHandleInput,
            setActiveModel: ctx.setActiveModel,
            replaceRuntimeSession: ctx.replaceRuntimeSession,
        });
    } catch (err) {
        if (generationGuard.isCurrent(thisGen)) {
            uiAPI.appendSystemMessage(
                `Error: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
}

/**
 * Submit expanded slash macro text through the active root input path.
 *
 * @param {SlashContext} ctx
 * @param {string} expandedText
 * @param {import('../../shared/session/types.js').ImageAttachment[]} images
 */
async function dispatchExpandedInput(ctx, expandedText, images) {
    if (!ctx.dispatchExpandedUserRequest) throw new Error("Expanded commands require the runtime submission surface.");
    await ctx.dispatchExpandedUserRequest(expandedText, images);
}

/**
 * @param {SlashContext} ctx
 * @param {SkillMeta} skill
 * @param {string} additionalInstructions
 * @param {number} thisGen
 */
async function dispatchSkill(ctx, skill, additionalInstructions, thisGen) {
    const {
        uiAPI,
        savedImages,
        generationGuard,
    } = ctx;
    const deps = ctx.__deps || {};
    const expandSkillCommandImpl = deps.expandSkillCommand ||
        ((name, instructions) => ctx.sessionRuntime.expandSessionSkillCommand(ctx.sessionId, name, instructions));

    try {
        const expandedText = await expandSkillCommandImpl(
            skill.name,
            additionalInstructions || undefined,
        );

        await dispatchExpandedInput(ctx, expandedText, savedImages);
    } catch (err) {
        if (generationGuard.isCurrent(thisGen)) {
            uiAPI.appendSystemMessage(
                `Error: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
}

/**
 * Switch Operator before the next expanded prompt-template turn.
 *
 * @param {SlashContext} ctx
 */
async function switchToOperatorForTemplate(ctx) {
    await ctx.sessionRuntime.switchAgent(ctx.sessionId, { agentName: OPERATOR_AGENT });
}

/**
 * @param {SlashContext} ctx
 * @param {{ name: string, model?: string, path?: string }} template
 * @param {string} additionalInstructions
 * @param {number} thisGen
 */
async function dispatchTemplate(ctx, template, additionalInstructions, thisGen) {
    const {
        uiAPI,
        savedImages,
        generationGuard,
    } = ctx;
    const deps = ctx.__deps || {};
    const expandPromptTemplateImpl = deps.expandPromptTemplate ||
        ((path, instructions) => ctx.sessionRuntime.expandSessionPromptTemplate(path, instructions));

    const images = savedImages;

    let expandedText = "";
    try {
        if (template.path) {
            expandedText = await expandPromptTemplateImpl(template.path, additionalInstructions || undefined);
        } else throw new Error(`Prompt template "${template.name}" has no source path.`);
    } catch (err) {
        if (generationGuard.isCurrent(thisGen)) {
            uiAPI.appendSystemMessage(`Error expanding template: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
    }

    try {
        await switchToOperatorForTemplate(ctx);
        await dispatchExpandedInput(ctx, expandedText, images);
    } catch (err) {
        if (generationGuard.isCurrent(thisGen)) {
            uiAPI.appendSystemMessage(
                `Error: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
}
