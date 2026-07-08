/** @module ui/workspace/routes/remote-api */

import { MAINTAINER_SCOPE, REVIEWER_SCOPE } from "../../../shared/collaboration/capabilities.js";
import {
    assertNonEmptyString,
    assertPositiveInteger,
    normalizeAppendCommentPayload,
    normalizeAppendRevisionPayload,
    normalizeCommentStateChangePayload,
    normalizeCreateSharedSpacePayload,
    normalizeSharedSpaceLifecyclePayload,
} from "../../../shared/collaboration/protocol.js";
import { RemoteWorkspaceError } from "../server/remote-adapter.js";

/** @param {{ get: Function, post: Function }} app */
export function registerRemoteApiRoutes(app) {
    app.post("/api/spaces", createSpaceApi);
    app.get("/api/spaces/:spaceId", getSpaceApi);
    app.get("/api/spaces/:spaceId/revisions/:revision", getRevisionApi);
    app.post("/api/spaces/:spaceId/revisions", appendRevisionApi);
    app.get("/api/spaces/:spaceId/revisions/:revision/comments", listCommentsApi);
    app.post("/api/spaces/:spaceId/revisions/:revision/comments", appendCommentApi);
    app.post("/api/spaces/:spaceId/comments/:commentId/state", setCommentStateApi);
    app.post("/api/spaces/:spaceId/lifecycle", lifecycleApi);
}

/** @param {any} ctx */
async function createSpaceApi(ctx) {
    try {
        const payload = normalizeCreateSharedSpacePayload(await readJson(ctx.req));
        const hasReviewer = payload.capabilities.some((capability) => capability.scope === REVIEWER_SCOPE);
        const hasMaintainer = payload.capabilities.some((capability) => capability.scope === MAINTAINER_SCOPE);
        if (!hasReviewer || !hasMaintainer) throw new Error("capabilities must include reviewer and maintainer hashes");
        const result = ctx.state.collaboration.createSharedSpace({
            planId: payload.planId,
            payloadCiphertext: payload.initialRevision.payloadCiphertext,
            capabilities: payload.capabilities,
        });
        return json(result, 201);
    } catch (error) {
        return errorJson(error);
    }
}

/** @param {any} ctx */
async function getSpaceApi(ctx) {
    try {
        const spaceId = assertNonEmptyString(ctx.params.spaceId, "spaceId");
        await requireCapability(ctx, spaceId, REVIEWER_SCOPE);
        return json(ctx.state.collaboration.getSharedSpace(spaceId));
    } catch (error) {
        return errorJson(error);
    }
}

/** @param {any} ctx */
async function getRevisionApi(ctx) {
    try {
        const spaceId = assertNonEmptyString(ctx.params.spaceId, "spaceId");
        const revision = assertRevisionParam(ctx.params.revision);
        await requireCapability(ctx, spaceId, REVIEWER_SCOPE);
        return json({ revision: ctx.state.collaboration.getRevision(spaceId, revision) });
    } catch (error) {
        return errorJson(error);
    }
}

/** @param {any} ctx */
async function appendRevisionApi(ctx) {
    try {
        const spaceId = assertNonEmptyString(ctx.params.spaceId, "spaceId");
        await requireCapability(ctx, spaceId, MAINTAINER_SCOPE);
        const payload = normalizeAppendRevisionPayload(await readJson(ctx.req));
        return json({
            revision: ctx.state.collaboration.appendRevision(
                spaceId,
                payload.payloadCiphertext,
                payload.expectedRevision,
            ),
        }, 201);
    } catch (error) {
        return errorJson(error);
    }
}

/** @param {any} ctx */
async function listCommentsApi(ctx) {
    try {
        const spaceId = assertNonEmptyString(ctx.params.spaceId, "spaceId");
        const revision = assertRevisionParam(ctx.params.revision);
        await requireCapability(ctx, spaceId, REVIEWER_SCOPE);
        return json({ comments: ctx.state.collaboration.listComments(spaceId, revision) });
    } catch (error) {
        return errorJson(error);
    }
}

/** @param {any} ctx */
async function appendCommentApi(ctx) {
    try {
        const spaceId = assertNonEmptyString(ctx.params.spaceId, "spaceId");
        const revision = assertRevisionParam(ctx.params.revision);
        await requireCapability(ctx, spaceId, REVIEWER_SCOPE);
        const payload = normalizeAppendCommentPayload(await readJson(ctx.req));
        return json({ comment: ctx.state.collaboration.appendComment(spaceId, revision, payload.ciphertext) }, 201);
    } catch (error) {
        return errorJson(error);
    }
}

/** @param {any} ctx */
async function setCommentStateApi(ctx) {
    try {
        const spaceId = assertNonEmptyString(ctx.params.spaceId, "spaceId");
        await requireCapability(ctx, spaceId, REVIEWER_SCOPE);
        const commentId = assertNonEmptyString(ctx.params.commentId, "commentId");
        const payload = normalizeCommentStateChangePayload({ commentId, ...(await readJson(ctx.req)) });
        return json({ comment: ctx.state.collaboration.setCommentState(spaceId, commentId, payload.action) });
    } catch (error) {
        return errorJson(error);
    }
}

/** @param {any} ctx */
async function lifecycleApi(ctx) {
    try {
        const spaceId = assertNonEmptyString(ctx.params.spaceId, "spaceId");
        await requireCapability(ctx, spaceId, MAINTAINER_SCOPE);
        const payload = normalizeSharedSpaceLifecyclePayload({ spaceId, ...(await readJson(ctx.req)) });
        if (payload.action === "close") return json(ctx.state.collaboration.closeSharedSpace(spaceId));
        ctx.state.collaboration.deleteSharedSpace(spaceId);
        return json({ deleted: true, spaceId });
    } catch (error) {
        return errorJson(error);
    }
}

/** @param {Request} request */
async function readJson(request) {
    try {
        return await request.json();
    } catch {
        throw new RemoteWorkspaceError("invalid_json", "Request body must be valid JSON.", 400);
    }
}

/** @param {any} ctx @param {string} spaceId @param {"reviewer" | "maintainer"} scope */
async function requireCapability(ctx, spaceId, scope) {
    const capability = extractBearerCapability(ctx.req);
    await ctx.state.collaboration.verifyCapability(spaceId, capability, scope);
}

/** @param {Request} request */
function extractBearerCapability(request) {
    const header = request.headers.get("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) throw new RemoteWorkspaceError("unauthorized", "Bearer capability is required.", 401);
    return match[1].trim();
}

/** @param {unknown} value */
function assertRevisionParam(value) {
    const revision = Number(value);
    return assertPositiveInteger(revision, "revision");
}

/** @param {unknown} data @param {number} [status] */
function json(data, status = 200) {
    return Response.json(data, {
        status,
        headers: { "cache-control": "no-store" },
    });
}

/** @param {unknown} error */
function errorJson(error) {
    if (error instanceof RemoteWorkspaceError) {
        return json({ error: error.code, message: error.message, status: error.status }, error.status);
    }
    const message = error instanceof Error ? error.message : "Invalid request.";
    return json({ error: "bad_request", message, status: 400 }, 400);
}
