/**
 * @module shared/interactive/slash-dispatch
 *
 * Routes a `/command` user submission to either:
 * - a built-in command from cmd/registry.js, or
 * - a user-defined prompt template, dispatched through the operator agent.
 *
 * Built-in commands receive the full TUI context (editor, ui, tui, sessionManager).
 * Templates set the active agent and run a fresh agent session, optionally with
 * a template-declared model.
 */

import { abortActiveSession, expandSkillCommand, runAgentSession } from "../session/session.js";
import { createDirectAgentHandler } from "../session/direct-agent.js";
import { getRootSessionManager } from "../session/session-state.js";

/**
 * @typedef {Object} SkillMeta
 * @property {string} name
 * @property {string} description
 * @property {string} path
 * @property {"local" | "home" | "bundled" | "external"} source
 */

/**
 * @typedef {Object} SlashContext
 * @property {string} userRequest
 * @property {import('../session/types.js').ImageAttachment[]} savedImages
 * @property {import('../ui/types.js').UiAPI} uiAPI
 * @property {import('@earendil-works/pi-tui').Editor} editor
 * @property {import('@earendil-works/pi-tui').TUI} tui
 * @property {string} sessionStartedAt
 * @property {(data: string) => void} originalHandleInput
 * @property {Set<string>} builtinNames
 * @property {Map<string, { name: string, argumentHint?: string, description?: string, model?: string, source?: string }>} promptTemplateByName
 * @property {SkillMeta[]} skills
 * @property {string} chatPromptAgentName
 * @property {(templateModel: string) => ({ ok: true, provider: string, id: string } | { ok: false })} resolveTemplateModel
 * @property {(agentName: string, handler: import('../session/types.js').AgentMessageHandler, uiAPI: import('../ui/types.js').UiAPI, agentModel?: string) => void} setActiveAgent
 * @property {(uiAPI: import('../ui/types.js').UiAPI) => Promise<void>} applyPendingRootSwap
 * @property {import('./generation-guard.js').GenerationGuard} generationGuard
 * @property {(cancel: (() => void) | null) => void} registerOperationCancel
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

    const { commandRegistry } = await import("../../cmd/registry.js");

    if (ctx.builtinNames.has(command) && commandRegistry[command]) {
        await dispatchBuiltin(ctx, command, args, commandRegistry, thisGen);
        return true;
    }

    const template = ctx.promptTemplateByName.get(command);
    if (template) {
        await dispatchTemplate(ctx, template, thisGen);
        return true;
    }

    // Skill commands (/skill:{name})
    if (command.startsWith("skill:")) {
        const skillName = command.slice(6);
        const skill = ctx.skills.find((s) => s.name === skillName);
        if (skill) {
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

    registerOperationCancel(() => {
        abortActiveSession();
    });

    try {
        await commandRegistry[command].execute(args, {
            uiAPI,
            editor,
            sessionManager: getRootSessionManager() || undefined,
            sessionStartedAt,
            tui,
            originalHandleInput,
            registerOperationCancel,
        });
    } catch (err) {
        if (generationGuard.isCurrent(thisGen)) {
            uiAPI.appendSystemMessage(
                `Error: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    } finally {
        registerOperationCancel(null);
        // Slash commands run between turns, so any swap they queued (e.g.
        // `/agent architect` → setActiveAgent) can be applied immediately.
        // This keeps the footer in lock-step with the live session: the
        // user sees the new agent name only after its session is built.
        await applyPendingRootSwap(uiAPI);
    }
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
        chatPromptAgentName,
        generationGuard,
    } = ctx;

    try {
        const expandedText = await expandSkillCommand(skill.name, additionalInstructions || undefined);

        uiAPI.appendUserMessage?.(expandedText);
        savedImages.forEach((img) => {
            if (uiAPI.appendImage) uiAPI.appendImage(img.base64, img.mimeType);
        });

        await runAgentSession({
            agentName: chatPromptAgentName,
            userRequest: expandedText,
            images: savedImages,
            uiAPI,
            sessionManager: getRootSessionManager() || undefined,
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
 * @param {SlashContext} ctx
 * @param {{ name: string, model?: string }} template
 * @param {number} thisGen
 */
async function dispatchTemplate(ctx, template, thisGen) {
    const {
        uiAPI,
        savedImages,
        userRequest,
        chatPromptAgentName,
        resolveTemplateModel,
        setActiveAgent,
        generationGuard,
    } = ctx;

    let resolvedTemplateModel = null;
    if (template.model) {
        const resolution = resolveTemplateModel(template.model);
        if (!resolution.ok) {
            uiAPI.appendSystemMessage("Invalid template model. Use /model to switch.");
            return;
        }
        resolvedTemplateModel = resolution;
    }

    const images = savedImages;

    uiAPI.appendUserMessage?.(userRequest);
    images.forEach((/** @type {import('../session/types.js').ImageAttachment} */ img) => {
        if (uiAPI.appendImage) uiAPI.appendImage(img.base64, img.mimeType);
    });

    const templateModelValue = resolvedTemplateModel?.ok
        ? `${resolvedTemplateModel.provider}/${resolvedTemplateModel.id}`
        : undefined;

    setActiveAgent(
        chatPromptAgentName,
        createDirectAgentHandler(chatPromptAgentName),
        uiAPI,
        templateModelValue,
    );

    try {
        await runAgentSession({
            agentName: chatPromptAgentName,
            modelOverride: templateModelValue,
            userRequest,
            images,
            uiAPI,
            sessionManager: getRootSessionManager() || undefined,
        });
    } catch (err) {
        if (generationGuard.isCurrent(thisGen)) {
            uiAPI.appendSystemMessage(
                `Error: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }
}
