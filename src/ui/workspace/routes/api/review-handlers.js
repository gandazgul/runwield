/** Review decision transport for Workspace-hosted review surfaces. */

const REVIEW_TIMEOUT_MS = 30 * 60 * 1000;
/** @type {Map<string, { resolve: (value: any) => void, promise: Promise<any>, timeoutId: ReturnType<typeof setTimeout> }>} */
const reviewDecisions = new Map();

/**
 * @param {string} token
 * @returns {{ resolve: (value: any) => void, promise: Promise<any> }}
 */
export function registerReviewDecisionPromise(token) {
    unregisterReviewDecision(token);
    /** @type {(value: any) => void} */
    let resolveDecision = () => {};
    const promise = new Promise((resolve) => {
        resolveDecision = resolve;
    });
    const timeoutId = setTimeout(() => {
        resolveReviewDecision(token, { approved: false, feedback: "", annotations: [], canceled: true });
    }, REVIEW_TIMEOUT_MS);
    reviewDecisions.set(token, { resolve: resolveDecision, promise, timeoutId });
    return { resolve: resolveDecision, promise };
}

/**
 * @param {string} token
 * @param {any} decision
 * @returns {boolean}
 */
export function resolveReviewDecision(token, decision) {
    const entry = reviewDecisions.get(token);
    if (!entry) return false;
    clearTimeout(entry.timeoutId);
    reviewDecisions.delete(token);
    entry.resolve(decision);
    return true;
}

/** @param {string} token */
export function unregisterReviewDecision(token) {
    const entry = reviewDecisions.get(token);
    if (!entry) return;
    clearTimeout(entry.timeoutId);
    reviewDecisions.delete(token);
}

/** @param {any} ctx */
export async function reviewDecisionApi(ctx) {
    return await resolveFromRequest(ctx, (body) => ({
        approved: true,
        feedback: typeof body.feedback === "string" ? body.feedback : undefined,
        plan: typeof body.plan === "string" ? body.plan : undefined,
        savedPath: readPlanSavePath(body.planSave),
        agentSwitch: typeof body.agentSwitch === "string" ? body.agentSwitch : undefined,
        permissionMode: typeof body.permissionMode === "string" ? body.permissionMode : undefined,
    }));
}

/** @param {any} ctx */
export async function reviewDenyApi(ctx) {
    return await resolveFromRequest(ctx, (body) => ({
        approved: false,
        feedback: typeof body.feedback === "string" ? body.feedback : "",
        plan: typeof body.plan === "string" ? body.plan : undefined,
        savedPath: readPlanSavePath(body.planSave),
    }));
}

/** @param {any} ctx */
export async function reviewFeedbackApi(ctx) {
    return await resolveFromRequest(ctx, (body) => ({
        approved: body.approved === true,
        feedback: typeof body.feedback === "string" ? body.feedback : "",
        annotations: Array.isArray(body.annotations) ? body.annotations : [],
        agentSwitch: typeof body.agentSwitch === "string" ? body.agentSwitch : undefined,
    }));
}

/** @param {any} ctx */
export async function reviewExitApi(ctx) {
    return await resolveFromRequest(ctx, (body) => {
        if (body.reviewType === "plan") {
            return { approved: false, feedback: "", exit: true };
        }
        return {
            approved: false,
            feedback: "",
            annotations: [],
            exit: true,
        };
    });
}

/**
 * @param {any} ctx
 * @param {(body: any) => any} createDecision
 */
async function resolveFromRequest(ctx, createDecision) {
    const token = reviewToken(ctx.request || ctx.req);
    if (!token) return jsonError("missing_token", "Review token required.", 401);
    const expectedToken = ctx.state?.reviewToken;
    if (expectedToken && token !== expectedToken) return jsonError("invalid_token", "Invalid review token.", 401);
    if (!reviewDecisions.has(token)) return jsonError("review_not_found", "Review expired or completed.", 404);

    let body = {};
    try {
        body = await (ctx.request || ctx.req).json();
    } catch {
        body = {};
    }

    const decision = createDecision(body || {});
    if (!resolveReviewDecision(token, decision)) {
        return jsonError("review_not_found", "Review expired or completed.", 404);
    }
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}

/** @param {any} planSave */
function readPlanSavePath(planSave) {
    if (!planSave || typeof planSave !== "object") return undefined;
    if (planSave.enabled === false) return undefined;
    return typeof planSave.path === "string" ? planSave.path : undefined;
}

/** @param {Request} request */
function reviewToken(request) {
    const url = new URL(request.url);
    return request.headers.get("x-runwield-review-token") || url.searchParams.get("token") || "";
}

/** @param {string} error @param {string} message @param {number} status */
function jsonError(error, message, status) {
    return Response.json({ error, message, status }, { status, headers: { "cache-control": "no-store" } });
}
