/**
 * @module tools/delegate-agent
 * Context-isolated foreground Delegated Agent Session tool.
 */

import { join } from "@std/path";
import { StringEnum, Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { AGENTS, SUBAGENTS } from "../constants.js";
import { formatProviderModelReference } from "../shared/models/model-validation.js";
import {
    DELEGATED_ROLE_GENERAL,
    DELEGATED_ROLE_IDS,
    getDelegatedRole,
    loadSubAgentDefinition,
} from "../shared/session/subagent-definitions.ts";
import { extractAssistantOutput } from "../shared/workflow/workflow-results.js";

const READ_TOOLS = Object.freeze([
    "read",
    "grep",
    "find",
    "ls",
    "code_search",
    "code_show",
    "code_outline",
    "code_batch",
    "code_refs",
    "code_impact",
    "code_trace",
    "code_investigate",
    "code_structure",
    "code_impls",
    "code_importers",
]);

const WRITE_TOOLS = Object.freeze([
    ...READ_TOOLS,
    "bash",
    "edit",
    "write",
    "multi_file_edit",
]);

const TOOL_PARAMS = Type.Object({
    mode: StringEnum(["read", "write"], {
        description:
            "Delegation authority. Use read for investigation/review and write for one exclusive implementation task.",
    }),
    role: Type.Optional(StringEnum([...DELEGATED_ROLE_IDS], {
        description:
            "Optional Delegated Agent Role. Omit (or use 'general') for an unspecialized delegate. Use 'verification-adversary' to have a read-only delegate attack a draft Plan's checks with the cheapest counterfeit implementation; a role's authority ceiling can reduce the requested mode.",
    })),
    brief: Type.String({
        minLength: 1,
        maxLength: 12000,
        description:
            "Self-contained bounded brief for the Delegated Agent. Include all paths, goals, constraints, and expected handoff details.",
    }),
}, { additionalProperties: false });

/**
 * @typedef {Object} DelegateAgentDeps
 * @property {typeof import('../shared/session/session.js').runIsolatedAgentSession} runIsolatedAgentSession
 * @property {(path: string | URL) => Promise<string>} [readTextFile]
 * @property {(relativePath: string) => Promise<string>} [ensurePromptFile]
 * @property {(cwd: string) => Promise<DelegatedChangeSnapshot | null>} [captureChangeSnapshot]
 * @property {(cwd: string) => Promise<string[] | null>} [captureChangedPaths]
 * @property {string} [modelOverride]
 * @property {"off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max"} [thinkingLevelOverride]
 */

/**
 * @typedef {Object} DelegateAgentToolOptions
 * @property {import('../shared/session/hosted-session.js').HostedSession} hostedSession
 * @property {string} cwd
 * @property {string[]} parentTools
 * @property {DelegateAgentDeps['runIsolatedAgentSession']} runIsolatedAgentSession
 * @property {DelegateAgentDeps['readTextFile']} [readTextFile]
 * @property {DelegateAgentDeps['ensurePromptFile']} [ensurePromptFile]
 * @property {DelegateAgentDeps['captureChangeSnapshot']} [captureChangeSnapshot]
 * @property {DelegateAgentDeps['captureChangedPaths']} [captureChangedPaths]
 * @property {DelegateAgentDeps['modelOverride']} [modelOverride]
 * @property {DelegateAgentDeps['thinkingLevelOverride']} [thinkingLevelOverride]
 */

/**
 * @typedef {Object} DelegatedChangeEntry
 * @property {string} path
 * @property {string} status
 * @property {string | null} contentHash
 */

/**
 * @typedef {Object} DelegatedChangeSnapshot
 * @property {string | null} head
 * @property {DelegatedChangeEntry[]} entries
 */

/**
 * @typedef {Object} PorcelainStatusEntry
 * @property {string} status
 * @property {string} path
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function errorMessage(value) {
    return value instanceof Error ? value.message : String(value);
}

/**
 * @param {string[]} parentTools
 * @param {"read" | "write"} mode
 * @returns {string[]}
 */
export function resolveDelegatedToolNames(parentTools, mode) {
    const allowed = new Set(mode === "read" ? READ_TOOLS : WRITE_TOOLS);
    return [...new Set(parentTools)].filter((toolName) => allowed.has(toolName));
}

/**
 * @param {(path: string | URL) => Promise<string>} [readTextFile]
 * @param {(relativePath: string) => Promise<string>} [ensurePromptFile]
 * @param {import('../shared/session/subagent-definitions.ts').DelegatedRoleId} [role]
 * @returns {Promise<import('../shared/session/types.js').AgentDefinition>}
 */
export async function loadDelegatedAgentPrompt(
    readTextFile = Deno.readTextFile,
    ensurePromptFile,
    role = DELEGATED_ROLE_GENERAL,
) {
    return await loadSubAgentDefinition(SUBAGENTS.DELEGATED, {
        delegatedRole: role,
        readTextFile: (path) => readTextFile(path),
        ensurePromptFile,
    });
}

/**
 * A role's authority ceiling is the most authority that role may receive; the effective
 * delegation mode is the intersection of what the caller asked for and what the role allows.
 *
 * @param {"read" | "write"} requestedMode
 * @param {import('../shared/session/subagent-definitions.ts').DelegatedAuthority} authorityCeiling
 * @returns {"read" | "write"}
 */
export function resolveEffectiveDelegationMode(requestedMode, authorityCeiling) {
    return authorityCeiling === "read" ? "read" : requestedMode;
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<string>}
 */
async function runGit(cwd, args) {
    const command = new Deno.Command("git", { args, cwd, stdout: "piped", stderr: "piped" });
    const output = await command.output();
    if (!output.success) {
        throw new Error(new TextDecoder().decode(output.stderr).trim() || `git ${args.join(" ")} failed`);
    }
    return new TextDecoder().decode(output.stdout);
}

/**
 * @param {string} cwd
 * @param {string} path
 * @returns {Promise<string | null>}
 */
async function hashWorktreeFile(cwd, path) {
    try {
        const bytes = await Deno.readFile(join(cwd, path));
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    } catch {
        return null;
    }
}

/**
 * @param {string} line
 * @returns {PorcelainStatusEntry | null}
 */
function parsePorcelainLine(line) {
    if (!line.trim()) return null;
    const status = line.slice(0, 2);
    const rawPath = line.slice(3).trim();
    if (!rawPath) return null;
    const renameParts = rawPath.split(" -> ");
    return { status, path: renameParts[renameParts.length - 1] };
}

/**
 * @param {string} cwd
 * @returns {Promise<DelegatedChangeSnapshot | null>}
 */
export async function captureDelegatedChangeSnapshot(cwd) {
    try {
        const [head, output] = await Promise.all([
            runGit(cwd, ["rev-parse", "HEAD"]).then((value) => value.trim()).catch(() => null),
            runGit(cwd, ["status", "--porcelain", "--untracked-files=all"]),
        ]);
        const entries = [];
        for (const line of output.split("\n")) {
            const parsed = parsePorcelainLine(line);
            if (!parsed) continue;
            entries.push({
                path: parsed.path,
                status: parsed.status,
                contentHash: await hashWorktreeFile(cwd, parsed.path),
            });
        }
        return { head, entries: entries.sort((a, b) => a.path.localeCompare(b.path)) };
    } catch {
        return null;
    }
}

/**
 * @param {string} cwd
 * @returns {Promise<string[] | null>}
 */
export async function captureDelegatedChangedPaths(cwd) {
    const snapshot = await captureDelegatedChangeSnapshot(cwd);
    return snapshot ? snapshot.entries.map((entry) => entry.path) : null;
}

/**
 * @param {DelegatedChangeSnapshot | DelegatedChangeEntry[] | null} snapshot
 * @returns {DelegatedChangeSnapshot | null}
 */
function normalizeDelegatedChangeSnapshot(snapshot) {
    if (!snapshot) return null;
    if (Array.isArray(snapshot)) return { head: null, entries: snapshot };
    return snapshot;
}

/**
 * @param {DelegatedChangeSnapshot | DelegatedChangeEntry[] | null} before
 * @param {DelegatedChangeSnapshot | DelegatedChangeEntry[] | null} after
 * @returns {string[] | null}
 */
export function diffDelegatedChangeSnapshot(before, after) {
    const normalizedBefore = normalizeDelegatedChangeSnapshot(before);
    const normalizedAfter = normalizeDelegatedChangeSnapshot(after);
    if (!normalizedAfter) return null;
    if (normalizedBefore?.head && normalizedAfter.head && normalizedBefore.head !== normalizedAfter.head) return null;
    if (!normalizedBefore) return normalizedAfter.entries.map((entry) => entry.path);
    const beforeSignatures = new Map(
        normalizedBefore.entries.map((entry) => [entry.path, `${entry.status}\0${entry.contentHash || ""}`]),
    );
    const afterSignatures = new Map(
        normalizedAfter.entries.map((entry) => [entry.path, `${entry.status}\0${entry.contentHash || ""}`]),
    );
    return [...new Set([...beforeSignatures.keys(), ...afterSignatures.keys()])]
        .filter((path) => beforeSignatures.get(path) !== afterSignatures.get(path))
        .sort();
}

/**
 * @param {DelegatedChangeSnapshot | DelegatedChangeEntry[] | null} before
 * @param {DelegatedChangeSnapshot | DelegatedChangeEntry[] | null} after
 * @returns {boolean}
 */
function delegatedHeadChanged(before, after) {
    const normalizedBefore = normalizeDelegatedChangeSnapshot(before);
    const normalizedAfter = normalizeDelegatedChangeSnapshot(after);
    return Boolean(normalizedBefore?.head && normalizedAfter?.head && normalizedBefore.head !== normalizedAfter.head);
}

/**
 * @param {string} text
 * @returns {string}
 */
function truncateToolText(text) {
    const trimmed = text.trim();
    return trimmed.length > 20000 ? `${trimmed.slice(0, 19950)}\n\n[Delegated output truncated]` : trimmed;
}

/**
 * @param {import('../shared/session/hosted-session.js').HostedSession} hostedSession
 * @param {string | undefined} explicitOverride
 * @returns {string | undefined}
 */
function resolveDelegatedModelOverride(hostedSession, explicitOverride) {
    if (explicitOverride) return explicitOverride;
    if (hostedSession.isUserModelOverride()) return undefined;
    const activeModel = hostedSession.getActiveModelState();
    return activeModel.model ? formatProviderModelReference(activeModel) : undefined;
}

/**
 * @param {import('../shared/session/hosted-session.js').HostedSession} hostedSession
 * @param {DelegateAgentDeps['thinkingLevelOverride']} explicitOverride
 * @returns {DelegateAgentDeps['thinkingLevelOverride']}
 */
function resolveDelegatedThinkingLevelOverride(hostedSession, explicitOverride) {
    return explicitOverride || hostedSession.getThinkingLevel() || undefined;
}

/**
 * Role context for the child's user request. A general delegation adds nothing, so its
 * request text stays byte-identical to pre-role delegation.
 *
 * @param {import('../shared/session/subagent-definitions.ts').DelegatedRoleDefinition} role
 * @param {"read" | "write"} requestedMode
 * @param {"read" | "write"} effectiveMode
 * @returns {string[]}
 */
function roleRequestLines(role, requestedMode, effectiveMode) {
    if (role.id === DELEGATED_ROLE_GENERAL) return [];
    const lines = [`Delegated role: ${role.id}`];
    if (effectiveMode !== requestedMode) {
        lines.push(
            `The parent requested ${requestedMode} mode; the ${role.id} role has a ${role.authorityCeiling}-only authority ceiling, so this session runs as ${effectiveMode}.`,
        );
    }
    return lines;
}

/**
 * @param {DelegateAgentToolOptions} opts
 * @returns {import('@earendil-works/pi-coding-agent').ToolDefinition}
 */
export function createDelegateAgentTool(opts) {
    if (!opts.hostedSession) throw new Error("createDelegateAgentTool: hostedSession is required");
    if (!opts.cwd) throw new Error("createDelegateAgentTool: cwd is required");
    if (!opts.runIsolatedAgentSession) throw new Error("createDelegateAgentTool: runIsolatedAgentSession is required");
    const captureChangeSnapshot = opts.captureChangeSnapshot || (opts.captureChangedPaths
        ? async (cwd) => {
            const paths = await opts.captureChangedPaths?.(cwd);
            return paths ? { head: null, entries: paths.map((path) => ({ path, status: "", contentHash: "" })) } : null;
        }
        : captureDelegatedChangeSnapshot);

    return defineTool({
        name: "delegate_agent",
        label: "Delegate Agent",
        description:
            "Run a bounded context-isolated Delegated Agent Session. Use mode 'read' for parallel investigation/review and mode 'write' for one exclusive synchronous implementation task. Pass an optional role to specialize the delegate: 'verification-adversary' attacks a draft Plan with the cheapest counterfeit implementation that would pass its checks. The parent waits for the result.",
        parameters: TOOL_PARAMS,
        async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
            const requestedMode = /** @type {"read" | "write"} */ (params.mode);
            const requestedRole = typeof params.role === "string" && params.role ? params.role : DELEGATED_ROLE_GENERAL;
            const brief = typeof params.brief === "string" ? params.brief.trim() : "";
            if (!brief) {
                return {
                    content: [{ type: "text", text: "Delegation failed: brief is required." }],
                    details: { ok: false, mode: requestedMode, role: requestedRole, error: "brief_required" },
                    isError: true,
                };
            }

            const role = getDelegatedRole(requestedRole);
            if (!role) {
                const message = `Delegation failed: unknown role "${requestedRole}". Valid roles: ${
                    DELEGATED_ROLE_IDS.join(", ")
                }.`;
                return {
                    content: [{ type: "text", text: message }],
                    details: {
                        ok: false,
                        mode: requestedMode,
                        role: requestedRole,
                        error: "unknown_role",
                        validRoles: [...DELEGATED_ROLE_IDS],
                    },
                    isError: true,
                };
            }

            const mode = resolveEffectiveDelegationMode(requestedMode, role.authorityCeiling);
            const childTools = resolveDelegatedToolNames(opts.parentTools, mode);
            /** @type {undefined | (() => void)} */
            let release;
            /** @type {DelegatedChangeSnapshot | null} */
            let beforeSnapshot = null;
            try {
                release = opts.hostedSession.acquireDelegatedAgentLease(mode);
                beforeSnapshot = mode === "write" ? await captureChangeSnapshot(opts.cwd) : null;
                signal?.throwIfAborted?.();
                const agentDef = await loadDelegatedAgentPrompt(opts.readTextFile, opts.ensurePromptFile, role.id);
                agentDef.tools = childTools;
                const userRequest = [
                    `Delegation mode: ${mode}`,
                    ...roleRequestLines(role, requestedMode, mode),
                    "",
                    "You are running as a context-isolated child. Complete only the brief below and return a concise handoff.",
                    "",
                    "## Brief",
                    brief,
                ].join("\n");
                const modelOverride = resolveDelegatedModelOverride(opts.hostedSession, opts.modelOverride);
                const thinkingLevelOverride = resolveDelegatedThinkingLevelOverride(
                    opts.hostedSession,
                    opts.thinkingLevelOverride,
                );
                const messages = await opts.runIsolatedAgentSession({
                    hostedSession: opts.hostedSession,
                    agentName: AGENTS.DELEGATED,
                    userRequest,
                    cwd: opts.cwd,
                    _agentDefOverride: agentDef,
                    toolNames: childTools,
                    includeEditFallback: mode === "write",
                    allowReturnToRouter: false,
                    modelOverride,
                    thinkingLevelOverride,
                    projectStateContext: opts.hostedSession.getProjectStateContext(),
                    signal,
                });
                const output = truncateToolText(
                    extractAssistantOutput(messages) || "(Delegated Agent returned no text.)",
                );
                const afterSnapshot = mode === "write" ? await captureChangeSnapshot(opts.cwd) : null;
                const changedPaths = mode === "write"
                    ? diffDelegatedChangeSnapshot(beforeSnapshot, afterSnapshot)
                    : undefined;
                const committedChangesDetected = mode === "write"
                    ? delegatedHeadChanged(beforeSnapshot, afterSnapshot)
                    : undefined;
                return {
                    content: [{ type: "text", text: output }],
                    details: {
                        ok: true,
                        mode,
                        role: role.id,
                        requestedAuthority: requestedMode,
                        effectiveAuthority: mode,
                        roleAuthorityCeiling: role.authorityCeiling,
                        output,
                        tools: childTools,
                        changedPaths,
                        changeAttributionComplete: mode === "write"
                            ? Boolean(beforeSnapshot && afterSnapshot && !committedChangesDetected)
                            : undefined,
                        committedChangesDetected,
                    },
                };
            } catch (error) {
                const afterSnapshot = mode === "write" && release ? await captureChangeSnapshot(opts.cwd) : null;
                const changedPaths = mode === "write" && release
                    ? diffDelegatedChangeSnapshot(beforeSnapshot, afterSnapshot)
                    : undefined;
                const committedChangesDetected = mode === "write" && release
                    ? delegatedHeadChanged(beforeSnapshot, afterSnapshot)
                    : undefined;
                const message = `Delegation failed: ${errorMessage(error)}`;
                return {
                    content: [{ type: "text", text: message }],
                    details: {
                        ok: false,
                        mode,
                        role: role.id,
                        requestedAuthority: requestedMode,
                        effectiveAuthority: mode,
                        roleAuthorityCeiling: role.authorityCeiling,
                        error: errorMessage(error),
                        tools: childTools,
                        changedPaths,
                        changeAttributionComplete: mode === "write" && release
                            ? Boolean(beforeSnapshot && afterSnapshot && !committedChangesDetected)
                            : undefined,
                        committedChangesDetected,
                    },
                    isError: true,
                };
            } finally {
                release?.();
            }
        },
    });
}
