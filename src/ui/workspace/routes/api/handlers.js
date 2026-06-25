import {
    loadBoard,
    loadPlanSummaries,
    loadWorkspaceDetail,
    serializePlanError,
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
