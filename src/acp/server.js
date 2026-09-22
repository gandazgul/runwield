/**
 * @module acp/server
 * RunWield ACP stdio server.
 */

import { agent, methods, ndJsonStream, PROTOCOL_VERSION, RequestError } from "@agentclientprotocol/sdk";
import { isAbsolute } from "@std/path";
import { VERSION } from "../shared/version.js";
import { openFileSessionStore } from "../shared/session/file-session-store.ts";
import { getSelectedDefaultModelAvailability } from "../shared/session/model-readiness.ts";
import { createSessionRuntime, SessionTurnInProgressError } from "../shared/session/session-runtime.ts";
import { RuntimeEventTypes } from "../shared/session/session-runtime-events.js";
import { AcpSessionMap, normalizeAcpSessionIdForLoad } from "./session-map.js";
import { mapRuntimeContextToAcpUpdate, mapRuntimeEventToAcpSessionNotification } from "./event-mapper.js";
import { createAcpInteractionAdapter } from "./interaction-mapper.js";
import { buildAcpModelOptions } from "./model-options.ts";
import { getCommandDefinition, getSlashCommandDefinition, getSlashCommandDefinitions } from "../cmd/registry.js";
import { ProjectRuntimeEntryRefusedError } from "../shared/project-runtime-layout.ts";
import { RuntimeInteractionOutcomes, RuntimeInteractionTypes } from "../shared/session/session-runtime-interactions.js";
import {
    applyUserModelSelection,
    listUserModelOptions,
    parseUserModelSelection,
} from "../shared/session/user-selection.ts";

const ACP_AUTH_REQUIRED = -32000;
const ACP_NOT_IMPLEMENTED = -32004;
const ACP_INVALID_PARAMS = -32602;
const ACP_NOT_FOUND = -32001;
const ACP_INVALID_STATE = -32002;
const ACP_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** @typedef {"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"} AcpThinkingLevel */

/** @param {string} value @returns {value is AcpThinkingLevel} */
function isAcpThinkingLevel(value) {
    return ACP_THINKING_LEVELS.has(value);
}

/** @param {unknown} value */
function isRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/** @param {unknown} clientCapabilities */
function supportsTerminalAuth(clientCapabilities) {
    if (!isRecord(clientCapabilities)) return false;
    const capabilities = /** @type {Record<string, unknown>} */ (clientCapabilities);
    const auth = capabilities.auth;
    if (isRecord(auth) && /** @type {Record<string, unknown>} */ (auth).terminal === true) return true;
    const meta = capabilities._meta;
    return isRecord(meta) && /** @type {Record<string, unknown>} */ (meta)["terminal-auth"] === true;
}

/** @param {string} cwd */
function throwAuthenticationRequired(cwd) {
    throw new RequestError(
        ACP_AUTH_REQUIRED,
        "RunWield login and default model setup are required before starting ACP.",
        {
            cwd,
        },
    );
}

/** @param {string} message */
function isAuthenticationSetupFailure(message) {
    return /^Unknown .*model:/.test(message) || /^Invalid .*model:/.test(message) ||
        /^No configured model found/.test(message) || /^No API key configured for /.test(message) ||
        /^No configured auth for provider /.test(message) || message.includes("missing_auth");
}

/** @typedef {import('@agentclientprotocol/sdk').AgentApp} AgentApp */
/** @typedef {import('@agentclientprotocol/sdk').AgentConnection} AgentConnection */
/** @typedef {import('@agentclientprotocol/sdk').Stream} AcpStream */
/** @typedef {import('../shared/session/session-runtime.ts').SessionRuntime} SessionRuntime */

/**
 * @typedef {Object} AcpNotificationContext
 * @property {{ notify?: Function }} [client]
 * @property {Function} [notify]
 */

/**
 * @typedef {Object} RunWieldAcpServerOptions
 * @property {(message: string) => void | Promise<void>} [diagnostic]
 */

/**
 * @typedef {Object} AcpServerContext
 * @property {SessionRuntime} runtime
 * @property {AcpSessionMap} sessionMap
 * @property {(requestId: string, release: () => void) => void} [releasePromptAfterResponse]
 */

/**
 * Build the stable initialize response for the ACP MVP.
 *
 * The response always carries the version RunWield speaks. ACP negotiation puts the
 * decision on the Client: it reads the Agent's version and either accepts it or
 * disconnects. Echoing a requested version RunWield does not implement would tell the
 * Client the wrong thing.
 *
 * @param {import('@agentclientprotocol/sdk').InitializeRequest | undefined} request
 * @returns {import('@agentclientprotocol/sdk').InitializeResponse}
 */
export function createInitializeResponse(request) {
    const authMethods = supportsTerminalAuth(request?.clientCapabilities)
        ? [{
            id: "runwield-terminal-login",
            name: "RunWield Login",
            description: "Open a terminal to configure RunWield credentials and choose a default model.",
            type: "terminal",
            args: ["login"],
        }]
        : [];
    return {
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {
            loadSession: true,
            promptCapabilities: {
                image: true,
                _meta: { runwield: { contentTypes: ["text", "image", "resource_link"] } },
            },
            sessionCapabilities: {
                close: {},
                _meta: {
                    runwield: {
                        implementedMethods: [
                            "session/new",
                            "session/load",
                            "session/prompt",
                            "session/cancel",
                            "session/close",
                            "session/set_config_option",
                        ],
                        updateNotifications: ["session/update"],
                    },
                },
            },
        },
        authMethods,
        agentInfo: { name: "RunWield", version: VERSION },
    };
}

/**
 * @param {string} method
 * @returns {never}
 */
function throwUnimplemented(method) {
    throw new RequestError(ACP_NOT_IMPLEMENTED, `RunWield ACP method is not implemented yet: ${method}`, {
        method,
        phase: "session-runtime-acp-mvp",
    });
}

/**
 * @param {string} message
 * @param {Record<string, unknown>} [data]
 * @returns {never}
 */
function throwInvalidParams(message, data = {}) {
    throw new RequestError(ACP_INVALID_PARAMS, message, data);
}

/**
 * @param {string} sessionId
 * @returns {never}
 */
function throwUnknownSession(sessionId) {
    throw new RequestError(ACP_NOT_FOUND, `Unknown ACP session: ${sessionId}`, { sessionId });
}

/** @param {unknown} error @param {string} cwd @returns {never|void} */
function throwProjectRuntimeRefusal(error, cwd) {
    if (!(error instanceof ProjectRuntimeEntryRefusedError)) return;
    throw new RequestError(ACP_INVALID_STATE, error.message, {
        cwd,
        reason: error.reason,
        paths: error.paths,
        ...(error.securityAction ? { securityAction: error.securityAction } : {}),
    });
}

/**
 * @param {{ client?: { notify?: Function }, notify?: Function }} context
 * @param {import('@agentclientprotocol/sdk').ClientNotificationMethod} method
 * @param {unknown} params
 * @returns {Promise<void>}
 */
function notifyClient(context, method, params) {
    const maybeContextNotify = /** @type {{ notify?: Function }} */ (context).notify;
    if (typeof maybeContextNotify === "function") {
        return maybeContextNotify.call(context, method, params);
    }
    const clientContext = context.client;
    if (clientContext && typeof clientContext.notify === "function") {
        return clientContext.notify(method, /** @type {any} */ (params));
    }
    return Promise.resolve();
}

/**
 * @param {AgentApp} app
 * @param {import('@agentclientprotocol/sdk').AgentRequestMethod} method
 */
function registerUnimplementedRequest(app, method) {
    app.onRequest(method, () => throwUnimplemented(method));
}

/** @param {unknown} value */
function isNonEmptyArray(value) {
    return Array.isArray(value) && value.length > 0;
}

/** @param {unknown} value */
function isPlainRecord(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
function validateAcpMcpEnv(value) {
    if (!Array.isArray(value)) {
        throwInvalidParams("ACP stdio MCP server env must be an array", { field: "mcpServers.env" });
    }
    /** @type {Record<string, string>} */
    const env = {};
    for (const entry of value) {
        if (!isPlainRecord(entry) || typeof entry.name !== "string" || typeof entry.value !== "string") {
            throwInvalidParams("ACP stdio MCP server env entries require string name and value", {
                field: "mcpServers.env",
            });
        }
        env[entry.name] = entry.value;
    }
    return env;
}

/**
 * @param {unknown} value
 * @returns {import('../shared/mcp/config.ts').McpServerDefinition[]}
 */
function validateAcpMcpServers(value) {
    if (!Array.isArray(value)) throwInvalidParams("ACP mcpServers must be an array", { field: "mcpServers" });
    /** @type {import('../shared/mcp/config.ts').McpServerDefinition[]} */
    const servers = [];
    for (const server of value) {
        if (!isPlainRecord(server)) throwInvalidParams("ACP MCP server must be an object", { field: "mcpServers" });
        if (server.type === "http" || server.type === "sse" || server.type === "acp") {
            throwInvalidParams(`RunWield supports only stdio MCP servers, not ${server.type}`, {
                field: "mcpServers.type",
                transport: server.type,
            });
        }
        if (server.type !== undefined && server.type !== "stdio") {
            throwInvalidParams("Unsupported ACP MCP server transport", { field: "mcpServers.type" });
        }
        if (typeof server.name !== "string" || !server.name.trim()) {
            throwInvalidParams("ACP stdio MCP server requires a name", { field: "mcpServers.name" });
        }
        if (typeof server.command !== "string" || !isAbsolute(server.command)) {
            throwInvalidParams("ACP stdio MCP server requires an absolute command path", {
                field: "mcpServers.command",
            });
        }
        if (!Array.isArray(server.args) || server.args.some((/** @type {unknown} */ arg) => typeof arg !== "string")) {
            throwInvalidParams("ACP stdio MCP server args must be an array of strings", { field: "mcpServers.args" });
        }
        servers.push({
            name: server.name,
            command: server.command,
            args: server.args,
            env: validateAcpMcpEnv(server.env),
            source: "request",
        });
    }
    return servers;
}

/**
 * @typedef {Object} AcpPromptBlock
 * @property {string} [type]
 * @property {string | null} [text]
 * @property {string | null} [data]
 * @property {string | null} [mimeType]
 * @property {string | null} [title]
 * @property {string | null} [name]
 * @property {string | null} [uri]
 */

/**
 * @typedef {Object} ConvertedAcpPrompt
 * @property {string} text
 * @property {import('../shared/session/types.js').ImageAttachment[]} images
 */

/**
 * @param {AcpPromptBlock[]} blocks
 * @returns {ConvertedAcpPrompt}
 */
export function convertAcpPrompt(blocks) {
    if (!Array.isArray(blocks) || blocks.length === 0) {
        throwInvalidParams("session/prompt requires at least one prompt content block");
    }
    /** @type {string[]} */
    const parts = [];
    /** @type {import('../shared/session/types.js').ImageAttachment[]} */
    const images = [];
    for (const block of blocks) {
        if (!block || typeof block !== "object") throwInvalidParams("Invalid prompt content block");
        if (block.type === "text") {
            parts.push(String(block.text || ""));
            continue;
        }
        if (block.type === "image") {
            if (typeof block.data !== "string" || !block.data) {
                throwInvalidParams("ACP image prompt content requires base64 data", { contentType: block.type });
            }
            if (typeof block.mimeType !== "string" || !block.mimeType) {
                throwInvalidParams("ACP image prompt content requires a MIME type", { contentType: block.type });
            }
            images.push({ base64: block.data, mimeType: block.mimeType });
            continue;
        }
        if (block.type === "resource_link") {
            const label = block.title || block.name || block.uri;
            parts.push(`[Resource: ${label} <${block.uri}>]`);
            continue;
        }
        throwInvalidParams(`Unsupported prompt content block type for RunWield ACP MVP: ${block.type}`, {
            contentType: block.type,
        });
    }
    return { text: parts.join("\n").trim(), images };
}

/**
 * @param {unknown} blocks
 * @returns {{ name: string, args: string[] } | null}
 */
function extractAcpBuiltinCommand(blocks) {
    if (!Array.isArray(blocks) || blocks.length === 0) {
        throwInvalidParams("session/prompt requires at least one prompt content block");
    }
    /** @type {string[]} */
    const commandTexts = [];
    for (const block of blocks) {
        if (!block || typeof block !== "object") throwInvalidParams("Invalid prompt content block");
        if (block.type !== "text") continue;
        const text = String(block.text || "").trim();
        if (text.startsWith("/")) commandTexts.push(text);
    }
    if (commandTexts.length === 0) return null;
    if (commandTexts.length > 1) throwInvalidParams("ACP prompts can include only one slash command.");
    const text = commandTexts[0];
    if (/\r?\n/.test(text)) throwInvalidParams("ACP slash command prompts must contain only the command line.");
    const [name = "", ...args] = text.slice(1).trim().split(/\s+/).filter(Boolean);
    if (!name) throwInvalidParams("Slash command name is required.");
    return { name, args };
}

/**
 * @param {SessionRuntime} runtime
 * @param {string} runtimeSessionId
 */
async function buildAcpAvailableCommands(runtime, runtimeSessionId) {
    const snapshot = runtime.getSessionSnapshot(runtimeSessionId);
    const cwd = snapshot?.cwd;
    const builtins = getSlashCommandDefinitions("acp").map((command) => ({
        name: command.name,
        description: command.description,
        ...(command.usage?.[0] ? { input: { hint: command.usage[0].replace(/^.*?\s+/, "") } } : {}),
    }));
    if (!cwd) return builtins;
    const [templates, skills] = await Promise.all([
        runtime.listSessionPromptTemplates(runtimeSessionId),
        runtime.listSessionSkills(runtimeSessionId),
    ]);
    return [
        ...builtins,
        ...templates.filter((template) => !getCommandDefinition(template.name)).map((template) => ({
            name: template.name,
            description: template.description || "Prompt template",
            ...(template.argumentHint ? { input: { hint: template.argumentHint } } : {}),
        })),
        ...skills.map((skill) => ({
            name: `skill:${skill.name}`,
            description: skill.description || "Skill",
        })),
    ];
}

/**
 * @param {{ client?: { notify?: Function }, notify?: Function }} context
 * @param {SessionRuntime} runtime
 * @param {string} runtimeSessionId
 * @param {string} acpSessionId
 */
async function notifyAcpCommandCatalog(context, runtime, runtimeSessionId, acpSessionId) {
    await notifyClient(context, methods.client.session.update, {
        sessionId: acpSessionId,
        update: {
            sessionUpdate: "available_commands_update",
            availableCommands: await buildAcpAvailableCommands(runtime, runtimeSessionId),
        },
    });
}

/**
 * @param {AcpNotificationContext} context
 * @param {SessionRuntime} runtime
 * @param {string} runtimeSessionId
 * @param {string} acpSessionId
 */
async function notifyAcpModelOptions(context, runtime, runtimeSessionId, acpSessionId) {
    await notifyClient(context, methods.client.session.update, {
        sessionId: acpSessionId,
        update: {
            sessionUpdate: "config_option_update",
            configOptions: await buildAcpModelOptions(runtime, runtimeSessionId),
        },
    });
}

/**
 * @param {AcpNotificationContext} context
 * @param {SessionRuntime} runtime
 * @param {AcpSessionMap} sessionMap
 * @param {string} runtimeSessionId
 * @param {string} acpSessionId
 */
async function notifyAcpContextUsage(context, runtime, sessionMap, runtimeSessionId, acpSessionId) {
    const contextUsage = runtime.getSessionSnapshot(runtimeSessionId)?.contextUsage || null;
    const update = mapRuntimeContextToAcpUpdate(
        contextUsage,
        sessionMap.getRecord(acpSessionId)?.usageCostUsd || 0,
    );
    if (update) await notifyClient(context, methods.client.session.update, { sessionId: acpSessionId, update });
}

/**
 * @typedef {{ value: string, label: string, description?: string, [key: string]: unknown }} AcpCommandSelectOption
 */

/**
 * @param {{ runtime: SessionRuntime, runtimeSessionId: string, sendMessage: (text: string, isError?: boolean) => void }} options
 */
function createAcpCommandUiAPI(options) {
    /**
     * @param {import('../shared/session/session-runtime-interactions.js').RuntimeInteractionRequest['type']} type
     * @param {string} title
     * @param {AcpCommandSelectOption[]} choices
     * @param {{ defaultValue?: string, placeholder?: string, allowEmpty?: boolean }} [requestOptions]
     */
    const requestSelection = async (type, title, choices, requestOptions = {}) => {
        const response = await options.runtime.requestInteraction(options.runtimeSessionId, {
            type,
            prompt: title,
            options: choices,
            defaultValue: requestOptions.defaultValue,
            placeholder: requestOptions.placeholder,
            allowEmpty: requestOptions.allowEmpty,
        });
        if (
            response.outcome === RuntimeInteractionOutcomes.CANCELED ||
            response.outcome === RuntimeInteractionOutcomes.UNSUPPORTED ||
            response.outcome === RuntimeInteractionOutcomes.BLOCKED
        ) {
            if (response.message) options.sendMessage(response.message, true);
            return null;
        }
        return String(response.value || "");
    };
    /** @param {string} text */
    const appendAgentText = (text) => options.sendMessage(text);
    /** @param {string} title @param {AcpCommandSelectOption[]} choices */
    const promptSelect = (title, choices) => requestSelection(RuntimeInteractionTypes.SELECT, title, choices);
    /** @param {string} title @param {{ defaultValue?: string, placeholder?: string, allowEmpty?: boolean }} [textOptions] */
    const promptText = (title, textOptions = {}) =>
        requestSelection(RuntimeInteractionTypes.TEXT, title, [], {
            defaultValue: textOptions.defaultValue,
            placeholder: textOptions.placeholder,
            allowEmpty: textOptions.allowEmpty,
        });
    return {
        appendSystemMessage: options.sendMessage,
        appendAgentMessageStart: () => ({ appendText: appendAgentText }),
        requestRender: () => {},
        abortActivePrompt: () => {},
        promptSelect,
        promptText,
        showModelSelector: async (initialSearchInput = "") => {
            const available = await listUserModelOptions();
            const choices = available.map((model) => ({
                value: `${model.provider}/${model.id}`,
                label: model.name ? `${model.name} (${model.provider}/${model.id})` : `${model.provider}/${model.id}`,
            }));
            const selected = await requestSelection(RuntimeInteractionTypes.SELECT, "Select model", choices, {
                defaultValue: initialSearchInput,
            });
            if (!selected) return { selected: false };
            const parsed = parseUserModelSelection(selected);
            const result = await applyUserModelSelection(
                options.runtime,
                options.runtimeSessionId,
                parsed.model,
                parsed.provider,
            );
            if (!result.ok) {
                options.sendMessage(
                    `Could not switch model to ${parsed.provider}/${parsed.model}: ${result.error}. The active model did not change.`,
                    true,
                );
                return { selected: false };
            }
            return { selected: true };
        },
    };
}

/**
 * @param {{ context: any, runtime: SessionRuntime, sessionMap: AcpSessionMap, acpSessionId: string, runtimeSessionId: string, clientCapabilities: unknown, commandName: string, args: string[], requestId?: string, releasePromptAfterResponse?: (requestId: string, release: () => void) => void }} options
 */
async function dispatchAcpBuiltinCommand(options) {
    let runtimeSessionId = options.runtimeSessionId;
    const definition = getSlashCommandDefinition(options.commandName, "acp");
    /** @type {Promise<unknown>[]} */
    const pendingNotifications = [];
    let unsubscribe = () => {};
    const prompt = options.sessionMap.beginPrompt(
        options.acpSessionId,
        `command-${crypto.randomUUID()}`,
        options.requestId,
    );
    if (!prompt) throwUnknownSession(options.acpSessionId);
    /** @param {string} text @param {boolean} [isError] */
    const sendMessage = (text, isError = false) => {
        const pending = notifyClient(options.context, methods.client.session.update, {
            sessionId: options.acpSessionId,
            update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text },
                _meta: { runwield: { command: options.commandName, level: isError ? "error" : "info" } },
            },
        });
        pendingNotifications.push(pending);
    };
    try {
        if (!definition) {
            const reserved = getCommandDefinition(options.commandName);
            sendMessage(
                reserved
                    ? `Command /${options.commandName} is not available in ACP.`
                    : `Unknown command: /${options.commandName}`,
            );
            await Promise.allSettled(pendingNotifications);
            return { stopReason: "end_turn" };
        }
        if (["help", "--help", "-h"].includes(options.args[0] || "")) {
            const { formatCommandHelp } = await import("../cmd/help/index.js");
            sendMessage(formatCommandHelp(definition.name) || `No help is available for /${definition.name}.`);
            await Promise.allSettled(pendingNotifications);
            return { stopReason: "end_turn" };
        }
        const installInteractionAdapter = () => {
            options.runtime.setInteractionAdapter?.(
                runtimeSessionId,
                createAcpInteractionAdapter({
                    context: options.context,
                    acpSessionId: options.acpSessionId,
                    clientCapabilities: options.clientCapabilities,
                }),
            );
        };
        const subscribeCurrentSession = () => {
            unsubscribe = options.runtime.subscribeSessionEvents(runtimeSessionId, (event) => {
                if (event.type === RuntimeEventTypes.SESSION_REPLACED) {
                    const replacement = /** @type {{ newSessionId: string }} */ (event);
                    const replacementSnapshot = options.runtime.getSessionSnapshot(replacement.newSessionId);
                    options.sessionMap.replaceRuntimeSession(options.acpSessionId, {
                        sessionId: replacement.newSessionId,
                        cwd: replacementSnapshot?.cwd,
                    });
                    options.runtime.setInteractionAdapter?.(runtimeSessionId, null);
                    const previousUnsubscribe = unsubscribe;
                    runtimeSessionId = replacement.newSessionId;
                    installInteractionAdapter();
                    previousUnsubscribe();
                    subscribeCurrentSession();
                    return;
                }
                if (event.type === RuntimeEventTypes.COMMAND_CATALOG_CHANGED) {
                    const pending = notifyAcpCommandCatalog(
                        options.context,
                        options.runtime,
                        runtimeSessionId,
                        options.acpSessionId,
                    );
                    pendingNotifications.push(pending);
                    return pending;
                }
                const contextUsage = options.runtime.getSessionSnapshot(runtimeSessionId)?.contextUsage || null;
                const notification = mapEventWithSessionCost(
                    options.sessionMap,
                    options.acpSessionId,
                    event,
                    contextUsage,
                );
                if (
                    event.type === RuntimeEventTypes.MODEL_CHANGED || event.type === RuntimeEventTypes.AGENT_CHANGED ||
                    event.type === RuntimeEventTypes.THINKING_LEVEL_CHANGED
                ) {
                    pendingNotifications.push(Promise.all([
                        notifyAcpModelOptions(options.context, options.runtime, runtimeSessionId, options.acpSessionId),
                        notifyAcpContextUsage(
                            options.context,
                            options.runtime,
                            options.sessionMap,
                            runtimeSessionId,
                            options.acpSessionId,
                        ),
                    ]));
                }
                if (!notification) return;
                const pending = notifyClient(options.context, methods.client.session.update, notification);
                pendingNotifications.push(pending);
                return pending;
            });
        };
        installInteractionAdapter();
        subscribeCurrentSession();
        const commandUiAPI = createAcpCommandUiAPI({ runtime: options.runtime, runtimeSessionId, sendMessage });
        const commandEditor = {
            disableSubmit: false,
            setText: () => {},
            setAutocompleteProvider: () => {},
            handleInput: () => {},
        };
        const commandTui = { requestRender: () => {}, setFocus: () => {} };
        await definition.execute(options.args, {
            uiAPI: commandUiAPI,
            editor: commandEditor,
            tui: commandTui,
            sessionRuntime: options.runtime,
            sessionId: runtimeSessionId,
            slashSurface: "acp",
            replaceRuntimeSession: (nextSessionId) => {
                const replacementSnapshot = options.runtime.getSessionSnapshot(nextSessionId);
                options.sessionMap.replaceRuntimeSession(options.acpSessionId, {
                    sessionId: nextSessionId,
                    cwd: replacementSnapshot?.cwd,
                });
                runtimeSessionId = nextSessionId;
            },
        });
        await Promise.allSettled(pendingNotifications);
        return prompt.cancelled ? { stopReason: "cancelled" } : { stopReason: "end_turn" };
    } catch (error) {
        await Promise.allSettled(pendingNotifications);
        if (prompt.cancelled) return { stopReason: "cancelled" };
        throw error;
    } finally {
        unsubscribe();
        options.runtime.setInteractionAdapter?.(runtimeSessionId, null);
        const release = () => options.sessionMap.endPrompt(options.acpSessionId, prompt);
        if (prompt.requestId && options.releasePromptAfterResponse) {
            options.releasePromptAfterResponse(prompt.requestId, release);
        } else {
            release();
        }
    }
}

/**
 * @param {unknown} params
 */
export function validateNewSessionParams(params) {
    const request = /** @type {import('@agentclientprotocol/sdk').NewSessionRequest} */ (params || {});
    if (!request.cwd || typeof request.cwd !== "string" || !isAbsolute(request.cwd)) {
        throwInvalidParams("session/new requires an absolute cwd", { cwd: request.cwd });
    }
    const mcpServers = validateAcpMcpServers(request.mcpServers);
    if (
        isNonEmptyArray(request.additionalDirectories) ||
        (request.additionalDirectories && typeof request.additionalDirectories === "object" &&
            Object.keys(request.additionalDirectories).length > 0)
    ) {
        throwInvalidParams("RunWield ACP MVP does not support additionalDirectories yet", {
            field: "additionalDirectories",
        });
    }
    return { ...request, mcpServers: request.mcpServers, runwieldMcpServers: mcpServers };
}

/** @param {unknown} params */
function validateLoadSessionParams(params) {
    const request = /** @type {import('@agentclientprotocol/sdk').LoadSessionRequest & { _meta?: { runwield?: { sessionPath?: unknown } } }} */
        (params || {});
    const validated = validateNewSessionParams(request);
    if (!request.sessionId || typeof request.sessionId !== "string") {
        throwInvalidParams("session/load requires sessionId", { sessionId: request.sessionId });
    }
    const sessionPath = request._meta?.runwield?.sessionPath;
    if (sessionPath !== undefined && typeof sessionPath !== "string") {
        throwInvalidParams("session/load _meta.runwield.sessionPath must be a string", { field: "sessionPath" });
    }
    return { ...request, runwieldMcpServers: validated.runwieldMcpServers, sessionPath };
}

/** @param {unknown} params */
function validateCloseSessionParams(params) {
    const request = /** @type {import('@agentclientprotocol/sdk').CloseSessionRequest} */ (params || {});
    if (!request.sessionId || typeof request.sessionId !== "string") {
        throwInvalidParams("session/close requires sessionId", { sessionId: request.sessionId });
    }
    return request;
}

/**
 * @param {SessionRuntime} runtime
 * @param {AcpSessionMap} sessionMap
 * @param {string} acpSessionId
 */
async function closeMappedSession(runtime, sessionMap, acpSessionId) {
    const record = sessionMap.getRecord(acpSessionId);
    if (!record) return { ok: false, closed: false, error: "not_found" };
    const runtimeSessionId = sessionMap.getRuntimeSessionId(acpSessionId);
    sessionMap.markCancelled(acpSessionId);
    if (runtimeSessionId) {
        if (runtime.closeSessionWhenIdle) {
            await runtime.closeSessionWhenIdle(runtimeSessionId);
        } else {
            try {
                runtime.cancelSession(runtimeSessionId);
            } catch {
                // Close should still dispose mapping if cancellation fails.
            }
            await runtime.closeSession(runtimeSessionId);
        }
    }
    sessionMap.deleteRecord(acpSessionId);
    return { ok: true, closed: Boolean(runtimeSessionId), record };
}

/** @param {SessionRuntime} runtime @param {AcpSessionMap} sessionMap */
async function closeAllMappedSessions(runtime, sessionMap) {
    for (const record of sessionMap.listRecords()) await closeMappedSession(runtime, sessionMap, record.acpSessionId);
    if (runtime.closeAllSessionsWhenIdle) await runtime.closeAllSessionsWhenIdle();
    else runtime.closeAllSessions?.();
}

/**
 * Map one Runtime event for an ACP Session, folding usage cost into the Session total.
 *
 * The Runtime reports the cost of a single assistant message; ACP wants the cumulative
 * Session cost. Every mapping site goes through here so live, replayed, and setup events
 * all add to the same total.
 *
 * @param {AcpSessionMap} sessionMap
 * @param {string} acpSessionId
 * @param {import('../shared/session/session-runtime-events.js').SessionRuntimeEvent} event
 * @param {{ tokens: number | null, contextWindow: number } | null} [contextUsage]
 */
export function mapEventWithSessionCost(sessionMap, acpSessionId, event, contextUsage = null) {
    const sessionCostUsd = event.type === RuntimeEventTypes.USAGE
        ? sessionMap.addUsageCost(acpSessionId, event.usage?.costUsd)
        : sessionMap.getRecord(acpSessionId)?.usageCostUsd || 0;
    return mapRuntimeEventToAcpSessionNotification(acpSessionId, event, sessionCostUsd, contextUsage);
}

/**
 * @param {AcpStream} stream
 * @param {Map<string, () => void>} promptReleases
 * @returns {AcpStream}
 */
function releasePromptsAfterResponses(stream, promptReleases) {
    const writer = stream.writable.getWriter();
    return {
        readable: stream.readable,
        writable: new WritableStream({
            async write(message) {
                const responseId = isRecord(message) && "id" in message && ("result" in message || "error" in message)
                    ? String(message.id)
                    : null;
                try {
                    await writer.write(message);
                } finally {
                    if (responseId) {
                        const release = promptReleases.get(responseId);
                        if (release) {
                            promptReleases.delete(responseId);
                            release();
                        }
                    }
                }
            },
            close() {
                return writer.close();
            },
            abort(reason) {
                return writer.abort(reason);
            },
        }),
    };
}

/**
 * @param {{ client?: { notify?: Function }, notify?: Function }} context
 * @param {SessionRuntime} runtime
 * @param {AcpSessionMap} sessionMap
 * @param {string} runtimeSessionId
 * @param {string} acpSessionId
 */
async function replaySetupEvents(context, runtime, sessionMap, runtimeSessionId, acpSessionId) {
    /** @type {Promise<unknown>[]} */
    const pendingNotifications = [];
    const unsubscribe = runtime.subscribeSessionEvents(runtimeSessionId, (event) => {
        const contextUsage = runtime.getSessionSnapshot(runtimeSessionId)?.contextUsage || null;
        const notification = mapEventWithSessionCost(sessionMap, acpSessionId, event, contextUsage);
        if (!notification) return;
        const pending = notifyClient(context, methods.client.session.update, notification);
        pendingNotifications.push(pending);
        return pending;
    });
    try {
        await runtime.replaySession(runtimeSessionId);
        await Promise.allSettled(pendingNotifications);
    } finally {
        unsubscribe();
    }
}

/**
 * Create the RunWield ACP agent app.
 *
 * @param {AcpServerContext} context
 * @returns {AgentApp}
 */
function createRunWieldAcpServer(context) {
    const app = agent({ name: "RunWield ACP MVP" });
    const { runtime, sessionMap, releasePromptAfterResponse } = context;
    /** @type {unknown} */
    let clientCapabilities = null;

    app.onRequest(methods.agent.initialize, (context) => {
        clientCapabilities = context.params?.clientCapabilities || null;
        return createInitializeResponse(context.params);
    });

    app.onRequest(methods.agent.session.new, async (context) => {
        const request = validateNewSessionParams(context.params);
        const readiness = getSelectedDefaultModelAvailability(request.cwd);
        if (!readiness.available) throwAuthenticationRequired(request.cwd);
        let runtimeSessionId;
        try {
            runtimeSessionId = await runtime.createPromptReadySession({
                cwd: request.cwd,
                mcpServers: request.runwieldMcpServers,
            });
        } catch (error) {
            throwProjectRuntimeRefusal(error, request.cwd);
            throw error;
        }
        const snapshot = runtime.getSessionSnapshot(runtimeSessionId);
        if (!snapshot) throwUnknownSession(runtimeSessionId);
        const persistedSessionId = snapshot.sessionManagerId || runtimeSessionId;
        const record = sessionMap.createRecord(
            { sessionId: runtimeSessionId, cwd: snapshot.cwd },
            { persistedSessionId },
        );
        await replaySetupEvents(context, runtime, sessionMap, runtimeSessionId, record.acpSessionId);
        const configOptions = await buildAcpModelOptions(runtime, runtimeSessionId);
        queueMicrotask(() => {
            notifyAcpCommandCatalog(context, runtime, runtimeSessionId, record.acpSessionId).catch(() => {});
        });
        return {
            sessionId: record.acpSessionId,
            configOptions,
            _meta: {
                runwield: {
                    runtimeSessionId,
                    persistedSessionId,
                    cwd: snapshot.cwd,
                },
            },
        };
    });

    app.onRequest(methods.agent.session.load, async (context) => {
        const request = validateLoadSessionParams(context.params);
        const persistedSessionId = normalizeAcpSessionIdForLoad(request.sessionId);
        try {
            const result = await runtime.loadSession({
                cwd: request.cwd,
                sessionId: persistedSessionId,
                sessionPath: request.sessionPath,
                mcpServers: request.runwieldMcpServers,
            });
            const snapshot = runtime.getSessionSnapshot(result.sessionId);
            const stablePersistedSessionId = snapshot?.managed?.runwieldSessionId || result.sessionManagerId;
            const record = sessionMap.createRecord({ sessionId: result.sessionId, cwd: result.cwd }, {
                acpSessionId: request.sessionId,
                loaded: true,
                persistedSessionId: stablePersistedSessionId,
                sessionPath: result.sessionPath,
            });
            const notifications = result.replayEvents
                .map((event) =>
                    mapEventWithSessionCost(
                        sessionMap,
                        record.acpSessionId,
                        event,
                        runtime.getSessionSnapshot(result.sessionId)?.contextUsage || null,
                    )
                )
                .filter(Boolean)
                .map((notification) => notifyClient(context, methods.client.session.update, notification));
            await Promise.allSettled(notifications);
            const configOptions = await buildAcpModelOptions(runtime, result.sessionId);
            queueMicrotask(() => {
                notifyAcpCommandCatalog(context, runtime, result.sessionId, record.acpSessionId).catch(() => {});
            });
            return {
                configOptions,
                _meta: {
                    runwield: {
                        runtimeSessionId: result.sessionId,
                        persistedSessionId: stablePersistedSessionId,
                        sessionPath: result.sessionPath,
                        cwd: result.cwd,
                        replayedUpdates: notifications.length,
                    },
                },
            };
        } catch (error) {
            throwProjectRuntimeRefusal(error, request.cwd);
            const message = error instanceof Error ? error.message : String(error || "session/load failed");
            if (message.includes("already exists")) {
                throw new RequestError(ACP_INVALID_STATE, message, { sessionId: request.sessionId });
            }
            if (isAuthenticationSetupFailure(message)) throwAuthenticationRequired(request.cwd);
            throw new RequestError(ACP_NOT_FOUND, `Unable to load ACP session: ${request.sessionId}`, {
                sessionId: request.sessionId,
                cwd: request.cwd,
            });
        }
    });

    app.onRequest(methods.agent.session.setConfigOption, async (context) => {
        const { sessionId, configId, value } = context.params;
        if (typeof sessionId !== "string" || !sessionId) {
            throwInvalidParams("session/set_config_option requires sessionId");
        }
        const runtimeSessionId = sessionMap.getRuntimeSessionId(sessionId);
        if (!runtimeSessionId) throwUnknownSession(sessionId);
        if (typeof configId !== "string" || typeof value !== "string") {
            throwInvalidParams("Expected a select config option with a string value");
        }
        const exposedOptions = await buildAcpModelOptions(runtime, runtimeSessionId);
        const option = exposedOptions.find((candidate) => candidate.id === configId);
        if (!option || option.type !== "select") {
            throwInvalidParams(`Config option is not available: ${configId}=${value}`, { configId, value });
        }
        const optionValues = option.options
            .flatMap((entry) => "options" in entry ? entry.options : [entry])
            .map((entry) => entry.value);
        if (!optionValues.includes(value)) {
            throwInvalidParams(`Config option is not available: ${configId}=${value}`, { configId, value });
        }
        if (sessionMap.getRecord(sessionId)?.activePrompt) {
            throw new RequestError(
                ACP_INVALID_STATE,
                "Wait for the active turn to finish before changing configuration",
                {
                    sessionId,
                },
            );
        }
        if (configId === "model") {
            const models = await listUserModelOptions();
            const selected = models.find((model) => `${model.provider}/${model.id}` === value);
            if (!selected) throwInvalidParams(`Model is not available: ${value}`, { configId, value });
            const result = await applyUserModelSelection(runtime, runtimeSessionId, selected.id, selected.provider);
            if (!result.ok) {
                throw new RequestError(ACP_INVALID_STATE, result.error || "Model switch failed", {
                    sessionId,
                    configId,
                    value,
                });
            }
        } else if (configId === "thought_level") {
            if (!isAcpThinkingLevel(value)) {
                throwInvalidParams(`Reasoning level is not available: ${value}`, { configId, value });
            }
            const result = await runtime.setSessionThinkingLevel(runtimeSessionId, value);
            if (!result?.ok) {
                throw new RequestError(ACP_INVALID_STATE, result?.error || "Reasoning level switch failed", {
                    sessionId,
                    configId,
                    value,
                });
            }
        }
        const configOptions = await buildAcpModelOptions(runtime, runtimeSessionId);
        await notifyClient(context, methods.client.session.update, {
            sessionId,
            update: { sessionUpdate: "config_option_update", configOptions },
        });
        await notifyAcpContextUsage(context, runtime, sessionMap, runtimeSessionId, sessionId);
        return { configOptions };
    });

    app.onRequest(methods.agent.session.prompt, async (context) => {
        const request = /** @type {import('@agentclientprotocol/sdk').PromptRequest} */ (context.params || {});
        const acpSessionId = request.sessionId;
        if (!acpSessionId || typeof acpSessionId !== "string") {
            throwInvalidParams("session/prompt requires sessionId");
        }
        let runtimeSessionId = /** @type {string} */ (sessionMap.getRuntimeSessionId(acpSessionId));
        if (!runtimeSessionId) throwUnknownSession(acpSessionId);
        if (sessionMap.getRecord(acpSessionId)?.activePrompt) {
            throw new RequestError(
                ACP_INVALID_STATE,
                `ACP session already has an active prompt: ${acpSessionId}`,
                { sessionId: acpSessionId },
            );
        }
        const builtinCommand = extractAcpBuiltinCommand(request.prompt);
        if (builtinCommand) {
            const isBuiltInName = Boolean(getCommandDefinition(builtinCommand.name));
            const [templates, skills] = isBuiltInName ? [[], []] : await Promise.all([
                runtime.listSessionPromptTemplates(runtimeSessionId),
                runtime.listSessionSkills(runtimeSessionId),
            ]);
            const isResourceName = templates.some((template) => template.name === builtinCommand.name) ||
                skills.some((skill) => `skill:${skill.name}` === builtinCommand.name);
            if (!isResourceName) {
                return await dispatchAcpBuiltinCommand({
                    context,
                    runtime,
                    sessionMap,
                    acpSessionId,
                    runtimeSessionId,
                    clientCapabilities,
                    commandName: builtinCommand.name,
                    args: builtinCommand.args,
                    requestId: context.requestId === undefined ? undefined : String(context.requestId),
                    releasePromptAfterResponse,
                });
            }
        }
        const { text: promptText, images: promptImages } = convertAcpPrompt(request.prompt);
        const initialSnapshot = runtime.getSessionSnapshot(runtimeSessionId);
        if (initialSnapshot?.managed?.syncState?.status === "active_elsewhere") {
            const queued = runtime.queueNextTurnMessage(runtimeSessionId, promptText, promptImages, {
                deliverWhenAvailable: true,
            });
            if (!queued.ok) {
                throw new RequestError(ACP_INVALID_STATE, queued.error || "ACP prompt could not be queued", {
                    sessionId: acpSessionId,
                });
            }
            return {
                stopReason: "end_turn",
                _meta: { runwield: { queued: queued.queued, queuedMessageId: queued.message?.id || "" } },
            };
        }

        /** @type {Promise<void>[]} */
        const pendingNotifications = [];
        /** @type {import('./session-map.js').AcpPromptRecord | null} */
        let activePrompt = null;
        /** @returns {import('./session-map.js').AcpPromptRecord | null} */
        const getActivePrompt = () => activePrompt;
        /** @type {() => void} */
        let unsubscribe = () => {};
        let promptStarted = false;
        let cleanupStarted = false;

        const cleanupPromptResources = () => {
            if (!promptStarted || cleanupStarted) return;
            cleanupStarted = true;
            try {
                unsubscribe();
            } finally {
                if (activePrompt && sessionMap.isCurrentPrompt(acpSessionId, activePrompt)) {
                    runtime.setInteractionAdapter?.(runtimeSessionId, null);
                }
            }
        };

        const releasePrompt = () => {
            const prompt = activePrompt;
            cleanupPromptResources();
            if (!prompt) return;
            sessionMap.endPrompt(acpSessionId, prompt);
            if (activePrompt === prompt) activePrompt = null;
        };

        const finishPromptRequest = () => {
            const prompt = activePrompt;
            cleanupPromptResources();
            if (!prompt) return;
            if (prompt.requestId && releasePromptAfterResponse) {
                releasePromptAfterResponse(prompt.requestId, () => {
                    sessionMap.endPrompt(acpSessionId, prompt);
                    if (activePrompt === prompt) activePrompt = null;
                });
                return;
            }
            releasePrompt();
        };

        const subscribeCurrentRuntimeSession = () => {
            unsubscribe = runtime.subscribeSessionEvents(runtimeSessionId, (event) => {
                if (event.type === "session_replaced") {
                    const replacement = /** @type {any} */ (event);
                    sessionMap.replaceRuntimeSession(acpSessionId, {
                        sessionId: replacement.newSessionId,
                        cwd: sessionMap.getRecord(acpSessionId)?.cwd,
                    });
                    runtime.setInteractionAdapter?.(
                        replacement.newSessionId,
                        createAcpInteractionAdapter({
                            context,
                            acpSessionId,
                            clientCapabilities,
                        }),
                    );
                    const previousUnsubscribe = unsubscribe;
                    runtimeSessionId = replacement.newSessionId;
                    previousUnsubscribe();
                    subscribeCurrentRuntimeSession();
                    return;
                }
                const contextUsage = runtime.getSessionSnapshot(runtimeSessionId)?.contextUsage || null;
                const notification = mapEventWithSessionCost(sessionMap, acpSessionId, event, contextUsage);
                if (
                    event.type === RuntimeEventTypes.MODEL_CHANGED || event.type === RuntimeEventTypes.AGENT_CHANGED ||
                    event.type === RuntimeEventTypes.THINKING_LEVEL_CHANGED
                ) {
                    pendingNotifications.push(
                        Promise.all([
                            notifyAcpModelOptions(context, runtime, runtimeSessionId, acpSessionId),
                            notifyAcpContextUsage(
                                context,
                                runtime,
                                sessionMap,
                                runtimeSessionId,
                                acpSessionId,
                            ),
                        ]).then(() => undefined),
                    );
                }
                if (!notification) return;
                const pending = notifyClient(context, methods.client.session.update, notification);
                pendingNotifications.push(pending);
                return pending;
            });
        };

        try {
            const runtimePrompt = runtime.promptUserTurn(runtimeSessionId, {
                initialRequest: promptText,
                initialImages: promptImages,
                onTurnStarted: (/** @type {{ turnId: string }} */ { turnId }) => {
                    activePrompt = sessionMap.beginPrompt(
                        acpSessionId,
                        turnId,
                        context.requestId === undefined ? undefined : String(context.requestId),
                    );
                    if (!activePrompt) throwUnknownSession(acpSessionId);
                    promptStarted = true;
                    try {
                        runtime.setInteractionAdapter?.(
                            runtimeSessionId,
                            createAcpInteractionAdapter({
                                context,
                                acpSessionId,
                                clientCapabilities,
                            }),
                        );
                        subscribeCurrentRuntimeSession();
                    } catch (error) {
                        releasePrompt();
                        throw error;
                    }
                    return cleanupPromptResources;
                },
            });
            // The Runtime turn is the only thing that completes this request. session/cancel
            // marks the prompt and aborts the run, but the response waits for the Runtime to
            // settle and for every mapped update — including the Runtime's own cancellation
            // message — to reach the Client first.
            const result = /** @type {any} */ (await runtimePrompt);
            await Promise.allSettled(pendingNotifications);
            if (getActivePrompt()?.cancelled) return { stopReason: "cancelled" };
            if (result?.stopReason === "cancelled") return result;
            if (!result.ok) {
                if (
                    result.error === "managed_operation_in_progress" &&
                    !sessionMap.getRecord(acpSessionId)?.activePrompt
                ) {
                    const queued = runtime.queueNextTurnMessage(runtimeSessionId, promptText, promptImages, {
                        deliverWhenAvailable: true,
                    });
                    if (queued.ok) {
                        return {
                            stopReason: "end_turn",
                            _meta: { runwield: { queued: queued.queued, queuedMessageId: queued.message?.id || "" } },
                        };
                    }
                }
                throw new RequestError(ACP_INVALID_STATE, result.error || "ACP prompt was rejected", {
                    sessionId: acpSessionId,
                });
            }
            return { stopReason: "end_turn" };
        } catch (error) {
            await Promise.allSettled(pendingNotifications);
            if (getActivePrompt()?.cancelled) return { stopReason: "cancelled" };
            if (error instanceof SessionTurnInProgressError) {
                throw new RequestError(
                    ACP_INVALID_STATE,
                    `ACP session already has an active prompt: ${acpSessionId}`,
                    { sessionId: acpSessionId },
                );
            }
            throw error;
        } finally {
            finishPromptRequest();
        }
    });

    app.onRequest(methods.agent.session.close, async (context) => {
        const request = validateCloseSessionParams(context.params);
        const record = sessionMap.getRecord(request.sessionId);
        if (!record) throwUnknownSession(request.sessionId);
        const result = await closeMappedSession(runtime, sessionMap, request.sessionId);
        if (!result.ok) throwUnknownSession(request.sessionId);
        return { _meta: { runwield: { sessionId: request.sessionId, closed: result.closed } } };
    });

    app.onNotification(methods.agent.session.cancel, (context) => {
        const sessionId = context.params?.sessionId;
        if (!sessionId || typeof sessionId !== "string") return;
        const runtimeSessionId = sessionMap.getRuntimeSessionId(sessionId);
        if (!runtimeSessionId) return;
        sessionMap.markCancelled(sessionId);
        runtime.cancelSession(runtimeSessionId);
    });

    registerUnimplementedRequest(app, methods.agent.authenticate);
    registerUnimplementedRequest(app, methods.agent.logout);
    registerUnimplementedRequest(app, methods.agent.providers.list);
    registerUnimplementedRequest(app, methods.agent.providers.set);
    registerUnimplementedRequest(app, methods.agent.providers.disable);
    registerUnimplementedRequest(app, methods.agent.session.list);
    registerUnimplementedRequest(app, methods.agent.session.delete);
    registerUnimplementedRequest(app, methods.agent.session.fork);
    registerUnimplementedRequest(app, methods.agent.session.resume);
    registerUnimplementedRequest(app, methods.agent.session.setMode);
    registerUnimplementedRequest(app, methods.agent.nes.start);
    registerUnimplementedRequest(app, methods.agent.nes.suggest);
    registerUnimplementedRequest(app, methods.agent.nes.close);

    return app;
}

/**
 * Start the RunWield ACP server on newline-delimited JSON streams.
 *
 * @param {ReadableStream<Uint8Array>} input
 * @param {WritableStream<Uint8Array>} output
 * @param {RunWieldAcpServerOptions} [options]
 * @returns {AgentConnection}
 */
export function startRunWieldAcpServer(input, output, options = {}) {
    /** @type {Map<string, () => void>} */
    const promptReleases = new Map();
    const stream = releasePromptsAfterResponses(ndJsonStream(output, input), promptReleases);
    const sessionStore = openFileSessionStore();
    const runtime = createSessionRuntime({ sessionStore, ownerProcessKind: "acp" });
    const sessionMap = new AcpSessionMap();
    const connection = createRunWieldAcpServer({
        runtime,
        sessionMap,
        releasePromptAfterResponse: (requestId, release) => {
            promptReleases.set(requestId, release);
        },
    }).connect(stream);
    const closeMachinery = async () => {
        try {
            await closeAllMappedSessions(runtime, sessionMap);
        } finally {
            sessionStore.close();
        }
    };
    const closed = connection.closed.then(closeMachinery, closeMachinery);
    const diagnostics = options.diagnostic;
    if (diagnostics) diagnostics("RunWield ACP stdio server started");
    return {
        signal: connection.signal,
        client: connection.client,
        close: (error) => connection.close(error),
        closed,
    };
}
