import { PlanBoard } from "../components/Board.jsx";
import { loadBoard, serializePlanError } from "../server/plan-adapter.js";

/**
 * @param {"active"|"closed"|"onHold"} view
 */
export function boardRoute(view) {
    return async (/** @type {any} */ ctx) => {
        try {
            const board = await loadBoard(ctx.state.cwd);
            return ctx.render(<PlanBoard board={board} view={view} url={ctx.url} />);
        } catch (error) {
            const body = serializePlanError(error);
            return ctx.render(
                <section class="error-panel">
                    <h2>Plan Board failed to load</h2>
                    <p>{body.error}</p>
                    <p>{body.repair}</p>
                </section>,
                { status: 409 },
            );
        }
    };
}
