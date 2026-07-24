/* @module ui/workspace/routes/owner-session-api */

import { ownerErrorJson, ownerJson, sanitizeOwnerError } from "./owner-api.js";

const MAX_JSON_BYTES = 64 * 1024;

/** @param {Request} request */
async function readJson(request) {
    const text = await request.text();
    if (text.length > MAX_JSON_BYTES) throw new Error("Request body is too large.");
    return text ? JSON.parse(text) : {};
}

/** @param {unknown} value */
function safeEvent(value) {
    if (!value || typeof value !== "object") return value;
    const source = /** @type {Record<string, unknown>} */ (value);
    const safe = { ...source };
    delete safe._meta;
    delete safe.args;
    return safe;
}

/** @param {any} ctx */
export async function ownerProjectSessionsApi(ctx) {
    try {
        const result = await ctx.state.sessionContinuation.listSessions(ctx.params.projectId);
        return ownerJson(result);
    } catch (error) {
        return ownerErrorJson(error, 400);
    }
}

/** @param {any} ctx */
export async function ownerSessionTimelineApi(ctx) {
    try {
        const cursorEventId = ctx.url.searchParams.get("cursorEventId") || undefined;
        const limit = Number(ctx.url.searchParams.get("limit") || 0) || undefined;
        const result = await ctx.state.sessionContinuation.timeline(ctx.params.runwieldSessionId, {
            cursorEventId,
            limit,
        });
        return ownerJson({ ...result, events: (result.events || []).map(safeEvent) });
    } catch (error) {
        const message = sanitizeOwnerError(error);
        return ownerJson({ error: message }, /reconcile|uncertain|disabled/.test(message) ? 503 : 409);
    }
}

/** @param {any} ctx */
export async function ownerSessionBootstrapApi(ctx) {
    try {
        const body = await readJson(ctx.req);
        const result = await ctx.state.sessionContinuation.bootstrap({
            deviceId: ctx.state.ownerDevice?.deviceId || null,
            projectId: ctx.params.projectId,
            runwieldSessionId: ctx.params.runwieldSessionId,
            requestId: String(body.requestId || ""),
        });
        return ownerJson(result, 202);
    } catch (error) {
        const message = sanitizeOwnerError(error);
        return ownerJson({ error: message }, /not enabled|epoch|uncertain|reconcile/.test(message) ? 503 : 409);
    }
}

/** @param {any} ctx */
export async function ownerSessionContinuationStartApi(ctx) {
    try {
        const body = await readJson(ctx.req);
        const result = await ctx.state.sessionContinuation.startContinuation({
            deviceId: ctx.state.ownerDevice?.deviceId || null,
            projectId: ctx.params.projectId,
            runwieldSessionId: ctx.params.runwieldSessionId,
            requestId: String(body.requestId || ""),
            expectedGeneration: Number(body.expectedGeneration),
            text: String(body.text || ""),
        });
        return ownerJson(result, 202);
    } catch (error) {
        const message = sanitizeOwnerError(error);
        return ownerJson({ error: message }, /not enabled|epoch|uncertain|reconcile/.test(message) ? 503 : 409);
    }
}

/** @param {any} ctx */
export function ownerSessionOperationStatusApi(ctx) {
    const result = ctx.state.sessionContinuation.getOperation(ctx.params.operationId);
    return ownerJson({ ...result, events: (result.events || []).map(safeEvent) });
}
