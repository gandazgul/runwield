/* @module ui/workspace/routes/owner-session-api */

import { ownerErrorJson, ownerJson, sanitizeOwnerError } from "./owner-api.js";

const MAX_JSON_BYTES = 64 * 1024;

/** @param {Request} request */
async function readJson(request) {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) throw new Error("Request body is too large.");
    return text ? JSON.parse(text) : {};
}

/** @param {unknown} value @param {string} field @param {number} max */
function requireBoundedString(value, field, max) {
    if (typeof value !== "string" || value.length < 1 || value.length > max) {
        throw new Error(`${field} is invalid.`);
    }
    return value;
}

/** @param {unknown} value */
function requireExpectedGeneration(value) {
    const generation = Number(value);
    if (!Number.isInteger(generation) || generation < 0) throw new Error("expectedGeneration is invalid.");
    return generation;
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
        const cursor = ctx.url.searchParams.get("cursorEventId") || undefined;
        const cursorEventId = cursor ? requireBoundedString(cursor, "cursorEventId", 200) : undefined;
        const rawLimit = ctx.url.searchParams.get("limit");
        const limit = rawLimit ? Math.max(1, Math.min(500, Number(rawLimit) || 200)) : undefined;
        const result = await ctx.state.sessionContinuation.timeline(ctx.params.runwieldSessionId, {
            projectId: ctx.params.projectId,
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
            requestId: requireBoundedString(body.requestId, "requestId", 128),
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
            requestId: requireBoundedString(body.requestId, "requestId", 128),
            expectedGeneration: requireExpectedGeneration(body.expectedGeneration),
            text: requireBoundedString(body.text, "text", 32_000),
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
