/**
 * @module shared/interactive/slash-dispatch
 *
 * Routes a `/command` user submission to either:
 * - a built-in command from cmd/registry.js, or
 * - a user-defined prompt template / skill macro.
 *
 * Built-in commands receive the full TUI context (editor, ui, tui, sessionManager).
 * Templates switch to Operator, expand the text, then submit it through the
 * active root path. Skills expand in the current active agent context.
 */

import { basename } from "@std/path";
import { abortActiveSession, expandPromptTemplate, expandSkillCommand } from "../session/session.js";
import { setTerminalTitleForName } from "../../ui/tui/terminal-title.js";

const OPERATOR_AGENT = "operator";

/**
 * If the current session has no display name, update the terminal title to
 * `wld - {folder} - {displayName}` so it reflects the active slash command
 * rather than the raw cwd basename.
 *
 * For `/agent`, displayName should be the chosen agent name (not "agent").
 *
 * @param {string} command
 * @param {import('../session/hosted-session.js').HostedSession} hostedSession
 * @param {string} [displayName] - Override for the suffix (e.g. agent name).
 */
function maybeUpdateTitleForSlashCommand(command, hostedSession, displayName) {
    const rootSessionManager = /** @type {any} */ (hostedSession?.getRootSessionManager?.());
    if (rootSessionManager && !rootSessionManager.getSessionName?.()) {
        const folder = basename(Deno.cwd());
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
 * @property {import('../session/types.js').ImageAttachment[]} savedImages
 * @property {import('../session/hosted-session.js').HostedSession} hostedSession
 * @property {import('../session/session-host.js').SessionHost} [sessionHost]
 * @property {import('../../ui/tui/types.js').UiAPI} uiAPI
 * @property {import('@earendil-works/pi-tui').Editor} editor
 * @property {import('@earendil-works/pi-tui').TUI} tui
 * @property {string} sessionStartedAt
 * @property {(data: string) => void} originalHandleInput
 * @property {Set<string>} builtinNames
 * @property {Map<string, { name: string, argumentHint?: string, description?: string, model?: string, source?: string }>} promptTemplateByName
 * @property {SkillMeta[]} skills
 * @property {string} chatPromptAgentName
 * @property {(templateModel: string) => ({ ok: true, provider: string, id: string } | { ok: false })} resolveTemplateModel
 * @property {(hostedSession: import('../session/hosted-session.js').HostedSession | undefined, agentName: string, handler: import('../session/types.js').AgentMessageHandler, uiAPI: import('../../ui/tui/types.js').UiAPI, agentModel?: string) => void} setActiveAgent
 * @property {(hostedSession: import('../session/hosted-session.js').HostedSession | undefined, uiAPI: import('../../ui/tui/types.js').UiAPI) => Promise<void>} applyPendingRootSwap
 * @property {(model: string, provider?: string) => Promise<void> | void} [setActiveModel]
 * @property {(nextSession: import('../session/hosted-session.js').HostedSession) => void} [replaceHostedSession]
 * @property {(text: string, images: import('../session/types.js').ImageAttachment[]) => Promise<void>} [dispatchExpandedUserRequest]
 * @property {import('./generation-guard.js').GenerationGuard} generationGuard
 * @property {(cancel: (() => void) | null) => void} registerOperationCancel
 * @property {{
 *   abortActiveSession?: typeof abortActiveSession,
 *   expandPromptTemplate?: typeof expandPromptTemplate,
 *   expandSkillCommand?: typeof expandSkillCommand,
 *   getRootSessionManager?: () => import('../session/types.js').SessionManagerLike | null,
 *   getActiveOnMessage?: () => import('../session/types.js').AgentMessageHandler | null,
 *   createAgentHandler?: (agentName: string, deps?: { hostedSession?: import('../session/hosted-session.js').HostedSession }) => import('../session/types.js').AgentMessageHandler,
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
        maybeUpdateTitleForSlashCommand(builtinCommand.name, ctx.hostedSession, displayName);
        await dispatchBuiltin(ctx, builtinCommand.name, args, commandRegistry, thisGen);
        return true;
    }

    const template = ctx.promptTemplateByName.get(command);
    if (template) {
        maybeUpdateTitleForSlashCommand(command, ctx.hostedSession);
        await dispatchTemplate(ctx, template, args.join(" "), thisGen);
        return true;
    }

    // Skill commands (/skill:{name})
    if (command.startsWith("skill:")) {
        const skillName = command.slice(6);
        const skill = ctx.skills.find((s) => s.name === skillName);
        if (skill) {
            maybeUpdateTitleForSlashCommand(command, ctx.hostedSession);
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
        registerOperationCancel,
        applyPendingRootSwap,
    } = ctx;

    const deps = ctx.__deps || {};
    const abortActiveSessionImpl = deps.abortActiveSession || abortActiveSession;
    const getRootSessionManagerImpl = deps.getRootSessionManager || (() => ctx.hostedSession.getRootSessionManager());

    registerOperationCancel(() => {
        abortActiveSessionImpl(ctx.hostedSession);
    });

    try {
        await commandRegistry[command].execute(args, {
            uiAPI,
            editor,
            hostedSession: ctx.hostedSession,
            sessionHost: ctx.sessionHost,
            sessionManager: getRootSessionManagerImpl() || undefined,
            sessionStartedAt,
            tui,
            originalHandleInput,
            registerOperationCancel,
            setActiveAgent: ctx.setActiveAgent,
            applyPendingRootSwap: ctx.applyPendingRootSwap,
            setActiveModel: ctx.setActiveModel,
            replaceHostedSession: ctx.replaceHostedSession,
        });
    } catch (err) {
        if (generationGuard.isCurrent(thisGen)) {
            uiAPI.appendSystemMessage(
                `Error: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    } finally {
        registerOperationCancel(null);
        await applyPendingRootSwap(ctx.hostedSession, uiAPI);
    }
}

/**
 * Submit expanded slash macro text through the active root input path.
 *
 * @param {SlashContext} ctx
 * @param {string} expandedText
 * @param {import('../session/types.js').ImageAttachment[]} images
 */
async function dispatchExpandedInput(ctx, expandedText, images) {
    if (ctx.dispatchExpandedUserRequest) {
        await ctx.dispatchExpandedUserRequest(expandedText, images);
        return;
    }

    const deps = ctx.__deps || {};
    const getActiveOnMessageImpl = deps.getActiveOnMessage || (() => ctx.hostedSession.getActiveOnMessage());
    const getRootSessionManagerImpl = deps.getRootSessionManager || (() => ctx.hostedSession.getRootSessionManager());
    const activeOnMessage = getActiveOnMessageImpl();
    const rootSessionManager = getRootSessionManagerImpl();
    if (!activeOnMessage || !rootSessionManager) {
        ctx.uiAPI.appendSystemMessage("Error: No active agent handler or session manager.");
        return;
    }

    ctx.uiAPI.appendUserMessage?.(expandedText);
    images.forEach((img) => {
        if (ctx.uiAPI.appendImage) ctx.uiAPI.appendImage(img.base64, img.mimeType);
    });
    await activeOnMessage(expandedText, images, ctx.uiAPI, rootSessionManager);
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
    const expandSkillCommandImpl = deps.expandSkillCommand || expandSkillCommand;

    try {
        const expandedText = await expandSkillCommandImpl(skill.name, additionalInstructions || undefined);

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
 * Queue Operator as the target for the next expanded prompt-template turn.
 *
 * @param {SlashContext} ctx
 */
async function switchToOperatorForTemplate(ctx) {
    const deps = ctx.__deps || {};
    let createAgentHandlerImpl = deps.createAgentHandler;
    if (!createAgentHandlerImpl) {
        const agentHandlerModule = await import("../session/agent-handler.js");
        createAgentHandlerImpl = agentHandlerModule.createAgentHandler;
    }

    ctx.setActiveAgent(
        ctx.hostedSession,
        OPERATOR_AGENT,
        createAgentHandlerImpl(OPERATOR_AGENT, { hostedSession: ctx.hostedSession }),
        ctx.uiAPI,
    );
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
    const expandPromptTemplateImpl = deps.expandPromptTemplate || expandPromptTemplate;

    const images = savedImages;

    let expandedText = "";
    try {
        if (template.path) {
            expandedText = await expandPromptTemplateImpl(template.path, additionalInstructions || undefined);
        } else {
            // Fallback just in case path is somehow missing
            expandedText = `/${template.name} ${additionalInstructions}`.trim();
        }
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
