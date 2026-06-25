import { PLAN_UI_TOKEN_QUERY } from "../../../constants.js";

/**
 * @param {string} path
 * @param {URL} url
 */
function linkWithToken(path, url) {
    const token = url.searchParams.get(PLAN_UI_TOKEN_QUERY) || "";
    const next = new URL(path, url);
    if (token) next.searchParams.set(PLAN_UI_TOKEN_QUERY, token);
    return `${next.pathname}${next.search}`;
}

/** @param {{ Component: any, url: URL }} props */
export function WorkspaceLayout({ Component, url }) {
    return (
        <div class="workspace-shell">
            <header class="topbar">
                <div>
                    <div class="eyebrow">RunWield Workspace</div>
                    <h1>Project Workspace</h1>
                    <p>Local, token-protected planning surface for this checkout.</p>
                </div>
                <p class="readonly-pill">Read-only Plan foundation</p>
            </header>
            <nav class="tabs" aria-label="Workspace views">
                <a href={linkWithToken("/", url)}>Plan Board</a>
                <a href={linkWithToken("/closed", url)}>Closed</a>
                <a href={linkWithToken("/on-hold", url)}>On Hold</a>
            </nav>
            <main>
                <Component />
            </main>
        </div>
    );
}
