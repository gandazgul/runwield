import { PlanDetail } from "../components/PlanDetail.jsx";
import { loadWorkspaceDetail, serializePlanError } from "../server/plan-adapter.js";

/** @param {any} ctx */
export async function detailRoute(ctx) {
    try {
        const plan = await loadWorkspaceDetail(ctx.state.cwd, ctx.params.planId);
        return ctx.render(
            <PlanDetail plan={plan} url={ctx.url} editIntent={ctx.url.searchParams.get("edit") === "body"} />,
        );
    } catch (error) {
        const body = serializePlanError(error);
        const status = body.error.includes("not found") || body.error.includes("Plan not found") ? 404 : 409;
        return ctx.render(
            <section class="error-panel">
                <h2>Plan lookup failed</h2>
                <p>{body.error}</p>
                <p>{body.repair}</p>
            </section>,
            { status },
        );
    }
}
