/**
 * @module ui/tui/slash-dispatch
 * Routes built-in slash commands, prompt templates, and skill macros.
 */

import type { EditorAPI, TuiAPI, UiAPI } from "./types.js";
import type { ImageAttachment } from "../../shared/session/types.js";
import type { SessionRuntime } from "../../shared/session/session-runtime.js";
import type { GenerationGuard } from "./generation-guard.js";
import { basename } from "@std/path";
import { setTerminalTitleForName } from "./terminal-title.ts";
import { notifyRunWieldEventQuietly } from "./system-notifications.ts";

const OPERATOR_AGENT = "operator";

const IMMEDIATE_BUILTIN_SLASH_COMMANDS_WHILE_STREAMING = new Set([
    "context",
    "copy",
    "exit",
    "export",
    "help",
    "name",
    "quit",
    "session",
    "share",
    "version",
]);

interface PromptTemplateMeta {
    name: string;
    argumentHint?: string;
    description?: string;
    model?: string;
    path?: string;
    source?: string;
}

export interface SkillMeta {
    name: string;
    description: string;
    path: string;
    source: "local" | "home" | "bundled" | "external";
    disableModelInvocation?: boolean;
}

interface NotificationOptions {
    sessionName?: string;
    agentName?: string;
}

type NotificationEventName = "agentStopped" | "planWritten" | "userInterview" | "compactionFinished";

interface ResolvedTemplateModel {
    ok: true;
    provider: string;
    id: string;
}

interface UnresolvedTemplateModel {
    ok: false;
}

export interface SlashContext {
    userRequest: string;
    savedImages: ImageAttachment[];
    sessionId: string;
    sessionRuntime: SessionRuntime;
    uiAPI: UiAPI;
    editor: EditorAPI;
    tui: TuiAPI;
    sessionStartedAt: string;
    originalHandleInput(data: string): void;
    initCommandAvailable: boolean;
    promptTemplateByName: Map<string, PromptTemplateMeta>;
    skills: SkillMeta[];
    chatPromptAgentName: string;
    resolveTemplateModel(templateModel: string): ResolvedTemplateModel | UnresolvedTemplateModel;
    replaceRuntimeSession?(nextSessionId: string): void;
    notifyRunWieldEvent?(eventName: string, options?: NotificationOptions): Promise<void> | void;
    dispatchExpandedUserRequest?(text: string, images: ImageAttachment[]): Promise<void>;
    generationGuard: GenerationGuard;
}

type CommandRegistry = typeof import("../../cmd/registry.js").commandRegistry;

function isNotificationEventName(eventName: string): eventName is NotificationEventName {
    return eventName === "agentStopped" || eventName === "planWritten" || eventName === "userInterview" ||
        eventName === "compactionFinished";
}

export function isImmediateBuiltinSlashCommandWhileStreaming(userRequest: string): boolean {
    if (!userRequest.startsWith("/")) return false;
    const [rawCommand] = userRequest.slice(1).split(" ");
    return IMMEDIATE_BUILTIN_SLASH_COMMANDS_WHILE_STREAMING.has(rawCommand.trim());
}

function maybeUpdateTitleForSlashCommand(
    command: string,
    runtime: SessionRuntime,
    sessionId: string,
    displayName?: string,
): void {
    const snapshot = runtime.getSessionSnapshot(sessionId);
    if (snapshot && !snapshot.name) {
        const folder = basename(snapshot.cwd);
        if (displayName === "") setTerminalTitleForName(folder);
        else setTerminalTitleForName(`${folder} - ${displayName || command}`);
    }
}

export async function handleSlashCommand(ctx: SlashContext): Promise<boolean> {
    const { userRequest } = ctx;
    if (!userRequest.startsWith("/")) return false;

    const [rawCommand, ...args] = userRequest.slice(1).split(" ");
    const command = rawCommand.trim();
    const thisGen = ctx.generationGuard.bump();
    const registryModule = await import("../../cmd/registry.js");
    const builtinCommand = registryModule.getSlashCommandDefinition(command);

    if (builtinCommand?.name === "init" && !ctx.initCommandAvailable) {
        ctx.uiAPI.appendSystemMessage(
            "The /init command is unavailable because RunWield is already initialized for this project.",
        );
        return true;
    }

    if (builtinCommand) {
        const displayName = command === "agent" ? (args[0] || "") : undefined;
        maybeUpdateTitleForSlashCommand(builtinCommand.name, ctx.sessionRuntime, ctx.sessionId, displayName);
        await dispatchBuiltin(ctx, builtinCommand.name, args, registryModule.commandRegistry, thisGen);
        return true;
    }

    const template = ctx.promptTemplateByName.get(command);
    if (template) {
        maybeUpdateTitleForSlashCommand(command, ctx.sessionRuntime, ctx.sessionId);
        await dispatchTemplate(ctx, template, args.join(" "), thisGen);
        return true;
    }

    if (command.startsWith("skill:")) {
        const skillName = command.slice(6);
        const skill = ctx.skills.find((candidate) => candidate.name === skillName);
        if (skill) {
            maybeUpdateTitleForSlashCommand(command, ctx.sessionRuntime, ctx.sessionId);
            await dispatchSkill(ctx, skill, args.join(" "), thisGen);
            return true;
        }
    }

    ctx.uiAPI.appendSystemMessage(`Unknown command: /${command}`);
    return true;
}

async function dispatchBuiltin(
    ctx: SlashContext,
    command: string,
    args: string[],
    commandRegistry: CommandRegistry,
    thisGen: number,
): Promise<void> {
    try {
        const notifyRunWieldEvent = ctx.notifyRunWieldEvent || ((eventName: string, options?: NotificationOptions) => {
            if (!isNotificationEventName(eventName)) return;
            return notifyRunWieldEventQuietly(eventName, options);
        });
        await commandRegistry[command].execute(args, {
            uiAPI: ctx.uiAPI,
            editor: ctx.editor,
            sessionId: ctx.sessionId,
            sessionRuntime: ctx.sessionRuntime,
            sessionStartedAt: ctx.sessionStartedAt,
            tui: ctx.tui,
            originalHandleInput: ctx.originalHandleInput,
            replaceRuntimeSession: ctx.replaceRuntimeSession,
            notifyRunWieldEvent,
        });
    } catch (error) {
        if (ctx.generationGuard.isCurrent(thisGen)) {
            ctx.uiAPI.appendSystemMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

async function dispatchExpandedInput(
    ctx: SlashContext,
    expandedText: string,
    images: ImageAttachment[],
): Promise<void> {
    if (!ctx.dispatchExpandedUserRequest) throw new Error("Expanded commands require the runtime submission surface.");
    await ctx.dispatchExpandedUserRequest(expandedText, images);
}

async function dispatchSkill(
    ctx: SlashContext,
    skill: SkillMeta,
    additionalInstructions: string,
    thisGen: number,
): Promise<void> {
    try {
        const expandedText = await ctx.sessionRuntime.expandSessionSkillCommand(
            ctx.sessionId,
            skill.name,
            additionalInstructions || undefined,
        );
        await dispatchExpandedInput(ctx, expandedText, ctx.savedImages);
    } catch (error) {
        if (ctx.generationGuard.isCurrent(thisGen)) {
            ctx.uiAPI.appendSystemMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

async function dispatchTemplate(
    ctx: SlashContext,
    template: PromptTemplateMeta,
    additionalInstructions: string,
    thisGen: number,
): Promise<void> {
    let expandedText = "";
    try {
        if (!template.path) throw new Error(`Prompt template "${template.name}" has no source path.`);
        expandedText = await ctx.sessionRuntime.expandSessionPromptTemplate(
            template.path,
            additionalInstructions || undefined,
        );
    } catch (error) {
        if (ctx.generationGuard.isCurrent(thisGen)) {
            ctx.uiAPI.appendSystemMessage(
                `Error expanding template: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        return;
    }

    try {
        await ctx.sessionRuntime.switchAgent(ctx.sessionId, { agentName: OPERATOR_AGENT });
        await dispatchExpandedInput(ctx, expandedText, ctx.savedImages);
    } catch (error) {
        if (ctx.generationGuard.isCurrent(thisGen)) {
            ctx.uiAPI.appendSystemMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
