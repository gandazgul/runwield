/**
 * @module shared/session/workflow-context-session
 *
 * Persists RunWield workflow footer context in Pi's append-only session stream.
 */

import { COMPLEXITIES, ROUTING_INTENTS } from "../../constants.js";

export const WORKFLOW_CONTEXT_CUSTOM_TYPE = "runwield.workflow_context";

/**
 * @typedef {Object} WorkflowContext
 * @property {string} [routingIntent]
 * @property {string} [complexity]
 * @property {string} [planName]
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeWorkflowRoutingIntent(value) {
    if (typeof value !== "string") return "";
    const normalized = value.trim().toUpperCase();
    return ROUTING_INTENTS.includes(normalized) ? normalized : "";
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeWorkflowComplexity(value) {
    if (typeof value !== "string") return "";
    const normalized = value.trim().toUpperCase();
    return COMPLEXITIES.includes(normalized) ? normalized : "";
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeWorkflowPlanName(value) {
    if (typeof value !== "string") return "";
    return value
        .trim()
        .replace(/^plans\//i, "")
        .replace(/\.md$/i, "")
        .replace(/^\/+/, "")
        .trim();
}

/**
 * @param {unknown} value
 * @returns {WorkflowContext | null}
 */
export function normalizeWorkflowContext(value) {
    if (!value || typeof value !== "object") return null;
    const data = /** @type {Record<string, unknown>} */ (value);
    const routingIntent = normalizeWorkflowRoutingIntent(data.routingIntent);
    const complexity = normalizeWorkflowComplexity(data.complexity);
    const planName = normalizeWorkflowPlanName(data.planName);

    /** @type {WorkflowContext} */
    const context = {};
    if (routingIntent && complexity) {
        context.routingIntent = routingIntent;
        context.complexity = complexity;
    }
    if (planName) context.planName = planName;

    return Object.keys(context).length > 0 ? context : null;
}

/**
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined | null} sessionManager
 * @param {{ routingIntent: unknown, complexity: unknown }} details
 * @returns {WorkflowContext | null}
 */
export function recordWorkflowTriageContext(sessionManager, details) {
    const routingIntent = normalizeWorkflowRoutingIntent(details.routingIntent);
    const complexity = normalizeWorkflowComplexity(details.complexity);
    if (!routingIntent || !complexity) return readPersistedWorkflowContext(sessionManager);
    return recordWorkflowContext(sessionManager, { routingIntent, complexity });
}

/**
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined | null} sessionManager
 * @param {unknown} planName
 * @returns {WorkflowContext | null}
 */
export function recordWorkflowPlanName(sessionManager, planName) {
    const normalizedPlanName = normalizeWorkflowPlanName(planName);
    if (!normalizedPlanName) return readPersistedWorkflowContext(sessionManager);
    try {
        const latest = readPersistedWorkflowContext(sessionManager) || {};
        return recordWorkflowContext(sessionManager, { ...latest, planName: normalizedPlanName });
    } catch (_e) {
        // Workflow-context persistence should never block planning.
        return { planName: normalizedPlanName };
    }
}

/**
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined | null} sessionManager
 * @returns {WorkflowContext | null}
 */
export function readPersistedWorkflowContext(sessionManager) {
    try {
        const entries = getSessionEntries(sessionManager);

        for (let i = entries.length - 1; i >= 0; i--) {
            const context = readWorkflowContextFromEntry(entries[i]);
            if (context) return context;
        }
    } catch (_e) {
        // Older or partially available SessionManagers may fail reads; footer
        // context should simply be absent in that case.
    }

    return null;
}

/**
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined | null} sessionManager
 * @param {WorkflowContext} context
 * @returns {WorkflowContext | null}
 */
function recordWorkflowContext(sessionManager, context) {
    const normalized = normalizeWorkflowContext(context);
    if (!normalized) return readPersistedWorkflowContext(sessionManager);
    if (!sessionManager?.appendCustomEntry) return normalized;

    try {
        const latest = readPersistedWorkflowContext(sessionManager);
        if (workflowContextsEqual(latest, normalized)) return latest;
        sessionManager.appendCustomEntry(WORKFLOW_CONTEXT_CUSTOM_TYPE, normalized);
    } catch (_e) {
        // Workflow-context persistence should never block routing or planning.
    }

    return normalized;
}

/**
 * @param {WorkflowContext | null} left
 * @param {WorkflowContext | null} right
 * @returns {boolean}
 */
function workflowContextsEqual(left, right) {
    return (left?.routingIntent || "") === (right?.routingIntent || "") &&
        (left?.complexity || "") === (right?.complexity || "") &&
        (left?.planName || "") === (right?.planName || "");
}

/**
 * @param {import('@earendil-works/pi-coding-agent').SessionManager | undefined | null} sessionManager
 * @returns {unknown[]}
 */
function getSessionEntries(sessionManager) {
    const entries = sessionManager?.getBranch?.() || sessionManager?.getEntries?.() || [];
    return Array.isArray(entries) ? entries : [];
}

/**
 * @param {unknown} entry
 * @returns {WorkflowContext | null}
 */
function readWorkflowContextFromEntry(entry) {
    if (!entry || typeof entry !== "object") return null;
    if (/** @type {{ type?: string }} */ (entry).type !== "custom") return null;
    const customType = /** @type {{ customType?: string }} */ (entry).customType;
    if (customType !== WORKFLOW_CONTEXT_CUSTOM_TYPE) return null;

    const data = /** @type {{ data?: unknown }} */ (entry).data;
    return normalizeWorkflowContext(data);
}
