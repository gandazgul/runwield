/**
 * @module shared/session/active-agent-session
 *
 * Persists RunWield-specific root-agent state in Pi's append-only session stream.
 * Pi records model changes, but RunWield owns root-agent switching, so we store a
 * small custom marker that `/resume` can use for newer sessions.
 */

import { AGENTS } from "../../constants.js";
import { loadAgentDef, normalizeAgentInternalName } from "./agents.js";

export const ACTIVE_AGENT_CUSTOM_TYPE = "runwield.active_agent";

/**
 * @typedef {Object} PersistedModelState
 * @property {string} provider
 * @property {string} model
 */

/**
 * @typedef {Object} ModelChangeEntry
 * @property {string} [type]
 * @property {string} [provider]
 * @property {string} [modelId]
 */

/**
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} sessionManager
 * @param {string} agentName
 */
export function recordActiveAgent(sessionManager, agentName) {
    if (!sessionManager?.appendCustomEntry || !agentName) return;

    try {
        const canonicalName = normalizeAgentInternalName(agentName);
        const latest = readPersistedActiveAgentName(sessionManager);
        if (latest && normalizeAgentInternalName(latest) === canonicalName) return;
        sessionManager.appendCustomEntry(ACTIVE_AGENT_CUSTOM_TYPE, { agentName: canonicalName });
    } catch (_e) {
        // Active-agent persistence should never block session construction.
    }
}

/**
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} sessionManager
 * @returns {string | null}
 */
export function readPersistedActiveAgentName(sessionManager) {
    const entries = getSessionEntries(sessionManager);

    for (let i = entries.length - 1; i >= 0; i--) {
        const agentName = readAgentNameFromEntry(entries[i]);
        if (agentName) return agentName;
    }

    return null;
}

/**
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} sessionManager
 * @returns {PersistedModelState | null}
 */
export function readPersistedModelState(sessionManager) {
    const entries = getSessionEntries(sessionManager);
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (!entry || typeof entry !== "object") continue;
        const typed = /** @type {ModelChangeEntry} */ (entry);
        if (typed.type !== "model_change" || !typed.modelId?.trim()) continue;
        return {
            provider: typed.provider?.trim() || "",
            model: typed.modelId.trim(),
        };
    }
    return null;
}

/**
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} sessionManager
 * @returns {Promise<string>}
 */
export async function resolveResumeAgentName(sessionManager) {
    const entries = getSessionEntries(sessionManager);
    const projectRoot = sessionManager?.getCwd?.();

    for (let i = entries.length - 1; i >= 0; i--) {
        const agentName = readAgentNameFromEntry(entries[i]);
        if (!agentName) continue;

        // Slicer is a persistent interactive workflow phase, but its definition
        // intentionally lives outside top-level Agent discovery. The Runtime
        // reconstructs its Epic-scoped definition and tools when this marker is
        // resumed, so do not skip back to the preceding Architect marker here.
        if (agentName.trim().toLowerCase() === AGENTS.SLICER) return AGENTS.SLICER;

        try {
            const agentDefinition = await loadAgentDef(agentName, projectRoot || undefined);
            return agentDefinition.name;
        } catch (_e) {
            // Keep scanning so a corrupt/stale marker does not hide the last
            // valid active agent recorded in this session.
        }
    }

    return AGENTS.ROUTER;
}

/**
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} sessionManager
 * @returns {unknown[]}
 */
function getSessionEntries(sessionManager) {
    const entries = sessionManager?.getBranch?.() || sessionManager?.getEntries?.() || [];
    return Array.isArray(entries) ? entries : [];
}

/**
 * @param {unknown} entry
 * @returns {string}
 */
function readAgentNameFromEntry(entry) {
    if (!entry || typeof entry !== "object") return "";
    if (/** @type {{ type?: string }} */ (entry).type !== "custom") return "";
    const customType = /** @type {{ customType?: string }} */ (entry).customType;
    if (customType !== ACTIVE_AGENT_CUSTOM_TYPE) return "";

    const data = /** @type {{ data?: { agentName?: unknown } }} */ (entry).data;
    return data && typeof data.agentName === "string" ? data.agentName.trim() : "";
}
