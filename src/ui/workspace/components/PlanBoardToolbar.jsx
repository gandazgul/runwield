import { PLAN_SEARCH_QUERY_PARAM } from "../constants.js";
import { PlanBoardSearch } from "../islands/PlanBoardSearch.jsx";
import { buildPlanBoardSearchIndex } from "../plan-search.js";
import { workspaceUrl } from "./PlanCard.jsx";

/** @param {{ board: any, view: "active"|"closed"|"onHold", url: URL | string }} props */
export function PlanBoardToolbar({ board, view, url }) {
    const currentUrl = workspaceUrl(url);
    const boardId = `status-board-${view}`;
    return (
        <PlanBoardSearch
            boardId={boardId}
            searchIndex={buildPlanBoardSearchIndex(board.screens[view])}
            initialQuery={currentUrl.searchParams.get(PLAN_SEARCH_QUERY_PARAM) || ""}
        />
    );
}
