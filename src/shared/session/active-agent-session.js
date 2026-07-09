/**
 * @module shared/session/active-agent-session
 *
 * Persists RunWield-specific root-agent state in Pi's append-only session stream.
 * Pi records model changes, but RunWield owns root-agent switching, so we store a
 * small custom marker that `/resume` can use for newer sessions.
 */

import { AGENTS } from "../../constants.js";
import { loadAgentDef } from "./agents.js";

export const ACTIVE_AGENT_CUSTOM_TYPE = "runwield.active_agent";

/**
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined} sessionManager
 * @param {string} agentName
 */
export function recordActiveAgent(sessionManager, agentName) {
    if (!sessionManager?.appendCustomEntry || !agentName) return;

    try {
        const latest = readPersistedActiveAgentName(sessionManager);
        if (latest === agentName) return;
        sessionManager.appendCustomEntry(ACTIVE_AGENT_CUSTOM_TYPE, { agentName });
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
 * @returns {Promise<string>}
 */
export async function resolveResumeAgentName(sessionManager) {
    const entries = getSessionEntries(sessionManager);
    const projectRoot = sessionManager?.getCwd?.();

    for (let i = entries.length - 1; i >= 0; i--) {
        const agentName = readAgentNameFromEntry(entries[i]);
        if (!agentName) continue;

        try {
            await loadAgentDef(agentName, projectRoot || undefined);
            return agentName;
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
