/* @module ui/workspace/routes/owner-session-api */

import { ownerErrorJson, ownerJson, sanitizeOwnerError } from "./owner-api.js";
import { requireOwnerProjectRoot } from "../server/owner-projects.js";

const MAX_JSON_BYTES = 12 * 1024 * 1024;

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

/** @param {string | null} value @param {string} field @param {number} fallback @param {number} max */
function readPageValue(value, field, fallback, max) {
    if (value === null || value === "") return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) throw new Error(`${field} is invalid.`);
    return parsed;
}

/** @param {unknown} value */
function readSubmittedImages(value) {
    if (!Array.isArray(value)) return [];
    return value.map((image) => {
        const source = image && typeof image === "object" ? /** @type {Record<string, unknown>} */ (image) : {};
        const base64 = requireBoundedString(source.base64, "image.base64", 10 * 1024 * 1024);
        const mimeType = requireBoundedString(source.mimeType, "image.mimeType", 80);
        if (!mimeType.startsWith("image/")) throw new Error("Only image attachments are supported.");
        return { base64, mimeType };
    });
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

/** @param {unknown} value */
function safeDiagnostic(value) {
    if (!value || typeof value !== "object") return { code: "catalog_diagnostic", message: String(value || "") };
    const source = /** @type {Record<string, unknown>} */ (value);
    return {
        code: typeof source.code === "string" ? source.code : "catalog_diagnostic",
        message: typeof source.message === "string"
            ? source.message.replaceAll(/(?:[A-Za-z]:)?[/\\][^\s,)]+/g, "[local path]")
            : "Catalog diagnostic recorded.",
    };
}

/** @param {Record<string, unknown>} result */
function safeTimelineResult(result) {
    const safe = { ...result };
    delete safe.segments;
    return safe;
}

/** @param {any} ctx */
export async function ownerProjectSessionsApi(ctx) {
    try {
        requireOwnerProjectRoot(ctx.state.store, ctx.params.projectId);
        const page = readPageValue(ctx.url.searchParams.get("page"), "page", 0, 10_000);
        const pageSize = readPageValue(ctx.url.searchParams.get("pageSize"), "pageSize", 30, 100);
        const result = await ctx.state.sessionContinuation.listSessions(ctx.params.projectId, { page, pageSize });
        return ownerJson({ ...result, diagnostics: (result.diagnostics || []).map(safeDiagnostic) });
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
        requireOwnerProjectRoot(ctx.state.store, ctx.params.projectId);
        const result = await ctx.state.sessionContinuation.timeline(ctx.params.runwieldSessionId, {
            projectId: ctx.params.projectId,
            cursorEventId,
            limit,
        });
        return ownerJson({ ...safeTimelineResult(result), events: (result.events || []).map(safeEvent) });
    } catch (error) {
        const message = sanitizeOwnerError(error);
        return ownerJson({ error: message }, /reconcile|uncertain|disabled/.test(message) ? 503 : 409);
    }
}

/** @param {any} ctx */
export async function ownerSessionBootstrapApi(ctx) {
    try {
        const body = await readJson(ctx.req);
        requireOwnerProjectRoot(ctx.state.store, ctx.params.projectId);
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
export async function ownerSessionCreateApi(ctx) {
    try {
        const body = await readJson(ctx.req);
        requireOwnerProjectRoot(ctx.state.store, ctx.params.projectId);
        const result = await ctx.state.sessionContinuation.createSession({
            deviceId: ctx.state.ownerDevice?.deviceId || null,
            projectId: ctx.params.projectId,
            requestId: requireBoundedString(body.requestId, "requestId", 128),
            text: requireBoundedString(body.text, "text", 32_000),
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
        requireOwnerProjectRoot(ctx.state.store, ctx.params.projectId);
        const result = await ctx.state.sessionContinuation.startContinuation({
            deviceId: ctx.state.ownerDevice?.deviceId || null,
            projectId: ctx.params.projectId,
            runwieldSessionId: ctx.params.runwieldSessionId,
            requestId: requireBoundedString(body.requestId, "requestId", 128),
            expectedGeneration: requireExpectedGeneration(body.expectedGeneration),
            text: typeof body.text === "string" && body.text.length === 0
                ? " "
                : requireBoundedString(body.text, "text", 32_000),
            images: readSubmittedImages(body.images),
        });
        return ownerJson(result, 202);
    } catch (error) {
        const message = sanitizeOwnerError(error);
        return ownerJson({ error: message }, /not enabled|epoch|uncertain|reconcile/.test(message) ? 503 : 409);
    }
}

/** @param {any} ctx */
export async function ownerSessionForceRecoverApi(ctx) {
    try {
        const body = await readJson(ctx.req);
        requireOwnerProjectRoot(ctx.state.store, ctx.params.projectId);
        const result = await ctx.state.sessionContinuation.forceRecoverSessionControl({
            projectId: ctx.params.projectId,
            runwieldSessionId: ctx.params.runwieldSessionId,
            expectedGeneration: requireExpectedGeneration(body.expectedGeneration),
            expectedCurrentSegmentId: typeof body.expectedCurrentSegmentId === "string"
                ? requireBoundedString(body.expectedCurrentSegmentId, "expectedCurrentSegmentId", 128)
                : null,
        });
        return ownerJson({ status: "recovered", generation: result.generation?.generation ?? null });
    } catch (error) {
        const message = sanitizeOwnerError(error);
        return ownerJson({ error: message }, /still renewing|not available/.test(message) ? 409 : 503);
    }
}

/** @param {any} ctx */
export async function ownerSessionInteractionAnswerApi(ctx) {
    try {
        const body = await readJson(ctx.req);
        requireOwnerProjectRoot(ctx.state.store, ctx.params.projectId);
        const result = await ctx.state.sessionContinuation.answerInteraction({
            deviceId: ctx.state.ownerDevice?.deviceId || null,
            projectId: ctx.params.projectId,
            operationId: ctx.params.operationId,
            interactionId: ctx.params.interactionId,
            runwieldSessionId: typeof body.runwieldSessionId === "string"
                ? requireBoundedString(body.runwieldSessionId, "runwieldSessionId", 200)
                : null,
            requestId: requireBoundedString(body.requestId, "requestId", 128),
            response: body.response,
        });
        return ownerJson(result, result?.status === "recovery_required" ? 409 : 202);
    } catch (error) {
        return ownerErrorJson(error, 409);
    }
}

/** @param {any} ctx */
export function ownerSessionOperationStatusApi(ctx) {
    const result = ctx.state.sessionContinuation.getOperation(ctx.params.operationId);
    return ownerJson({ ...result, events: (result.events || []).map(safeEvent) });
}
