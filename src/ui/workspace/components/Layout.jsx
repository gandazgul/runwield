import { PLAN_UI_TOKEN_QUERY } from "../constants.js";
import { PLAN_SEARCH_QUERY_PARAM } from "../islands/PlanBoardSearch.jsx";

/**
 * @param {string} path
 * @param {URL} url
 */
function linkWithToken(path, url) {
    const token = url.searchParams.get(PLAN_UI_TOKEN_QUERY) || "";
    const query = url.searchParams.get(PLAN_SEARCH_QUERY_PARAM) || "";
    const next = new URL(path, url);
    if (token) next.searchParams.set(PLAN_UI_TOKEN_QUERY, token);
    if (query) next.searchParams.set(PLAN_SEARCH_QUERY_PARAM, query);
    return `${next.pathname}${next.search}`;
}

/** @param {{ Component: any, url: URL }} props */
export function WorkspaceLayout({ Component, url }) {
    return (
        <div class="workspace-shell">
            <header class="topbar">
                <a class="brand" href={linkWithToken("/", url)} aria-label="RunWield Planning Workspace home">
                    <img class="brand-logo" src="/logo.svg" alt="" aria-hidden="true" />
                    <span>RunWield Planning Workspace</span>
                </a>
            </header>
            <nav class="tabs" aria-label="Workspace views">
                <a class={url.pathname === "/" ? "active" : ""} data-tab="active" href={linkWithToken("/", url)}>
                    Plan Board
                </a>
                <a
                    class={url.pathname === "/closed" ? "active" : ""}
                    data-tab="closed"
                    href={linkWithToken("/closed", url)}
                >
                    Closed
                </a>
                <a
                    class={url.pathname === "/on-hold" ? "active" : ""}
                    data-tab="on-hold"
                    href={linkWithToken("/on-hold", url)}
                >
                    On Hold
                </a>
                <div class="tab-search-slot" data-plan-search-slot></div>
            </nav>
            <main>
                <Component />
            </main>
        </div>
    );
}
