import {
    applyWorkspaceLifecycleAction,
    loadBoard,
    loadPlanSummaries,
    loadWorkspaceDetail,
    saveWorkspacePlanBody,
    serializePlanError,
    StalePlanBodyError,
    workspaceMetadata,
} from "../../server/plan-adapter.js";

/**
 * @param {unknown} data
 * @param {number} [status]
 */
function json(data, status = 200) {
    return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

/** @param {any} ctx */
export function workspaceApi(ctx) {
    return json(workspaceMetadata(ctx.state.cwd));
}

/** @param {any} ctx */
export async function plansApi(ctx) {
    try {
        return json({ plans: await loadPlanSummaries(ctx.state.cwd) });
    } catch (error) {
        return json(serializePlanError(error), 500);
    }
}

/** @param {any} ctx */
export async function boardApi(ctx) {
    try {
        return json(await loadBoard(ctx.state.cwd));
    } catch (error) {
        return json(serializePlanError(error), 500);
    }
}

/** @param {any} ctx */
export async function planDetailApi(ctx) {
    try {
        return json({ plan: await loadWorkspaceDetail(ctx.state.cwd, ctx.params.planId) });
    } catch (error) {
        const body = serializePlanError(error);
        const status = body.error.includes("not found") || body.error.includes("Plan not found") ? 404 : 409;
        return json(body, status);
    }
}

/** @param {any} ctx */
/** @param {any} ctx */
export async function lifecycleActionApi(ctx) {
    let payload;
    try {
        payload = await ctx.req.json();
    } catch {
        return json({ error: "Request body must be valid JSON." }, 400);
    }

    try {
        const result = await applyWorkspaceLifecycleAction(ctx.state.cwd, ctx.params.planId, payload);
        if (result.blocked) return json(result.body, result.status || 409);
        return json(result.body);
    } catch (error) {
        const body = serializePlanError(error);
        const message = body.error;
        const status = message.includes("not found") || message.includes("Plan not found")
            ? 404
            : message.includes("Unknown") || message.includes("missing targetStatus")
            ? 400
            : 409;
        return json({ ...body, blockedReason: status === 409 ? message : undefined }, status);
    }
}

/** @param {any} ctx */
export async function planBodyApi(ctx) {
    let payload;
    try {
        payload = await ctx.req.json();
    } catch {
        return json({ error: "Request body must be valid JSON." }, 400);
    }

    if (!payload || typeof payload.body !== "string" || typeof payload.expectedBodyHash !== "string") {
        return json({ error: "Expected JSON payload { body: string, expectedBodyHash: string }." }, 400);
    }

    try {
        const plan = await saveWorkspacePlanBody(
            ctx.state.cwd,
            ctx.params.planId,
            payload.body,
            payload.expectedBodyHash,
        );
        return json({ plan, bodyHash: plan.bodyHash });
    } catch (error) {
        if (error instanceof StalePlanBodyError) {
            return json({ error: error.message, bodyHash: error.currentBodyHash }, 409);
        }
        const body = serializePlanError(error);
        const status = body.error.includes("not found") || body.error.includes("Plan not found") ? 404 : 409;
        return json(body, status);
    }
}
