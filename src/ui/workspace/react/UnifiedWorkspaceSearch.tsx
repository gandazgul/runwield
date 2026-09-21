import { useEffect, useRef, useState } from "react";
import { RunWieldThinkingDots } from "../../design-system/components/react/RunWieldPrimitives.jsx";

interface SearchProject {
    projectId: string;
    name: string;
}
interface SearchState {
    projectId: string;
    state: string;
    reader?: string;
    message?: string;
}
interface SearchResult {
    id: string;
    projectId: string;
    projectName: string;
    contentType: string;
    sourceId: string;
    title: string;
    snippet: string;
    destination: string;
    freshness: string;
    summary?: string;
    completionMode?: string;
    notices?: string[];
}
interface SearchPayload {
    query: string;
    page: number;
    pageSize: number;
    total: number;
    results: SearchResult[];
    projects: SearchProject[];
    contentTypes: string[];
    states: SearchState[];
    error?: string;
}
interface SearchProps {
    fullPage?: boolean;
}

const TYPE_LABELS: Record<string, string> = {
    plan: "Plan",
    "work-record": "Work Record",
    prd: "PRD",
    adr: "ADR",
    "design-system": "Design System",
    "domain-language": "Domain Language",
    session: "Session",
};

function cookieValue(name: string) {
    return document.cookie.split("; ").find((value) => value.startsWith(`${name}=`))?.split("=").slice(1).join("=") ||
        "";
}

function searchStateFromUrl() {
    const params = new URLSearchParams(globalThis.location.search);
    return {
        query: params.get("q") || "",
        projectId: params.get("project") || "",
        contentType: params.get("type") || "",
    };
}

function searchUrl(query: string, projectId: string, contentType: string, pageSize: number) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (projectId) params.set("project", projectId);
    if (contentType) params.set("type", contentType);
    params.set("pageSize", String(pageSize));
    return `/api/owner/search?${params}`;
}

function fullSearchHref(query: string, projectId: string, contentType: string) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (projectId) params.set("project", projectId);
    if (contentType) params.set("type", contentType);
    const search = params.toString();
    return `/search${search ? `?${search}` : ""}`;
}

function resultHref(result: SearchResult, query: string, projectId: string, contentType: string) {
    if (result.contentType === "plan" || result.contentType === "session") return result.destination;
    const returnTo = fullSearchHref(query, projectId, contentType);
    const url = new URL(result.destination, globalThis.location.origin);
    url.searchParams.set("return", returnTo);
    return `${url.pathname}${url.search}`;
}

export function UnifiedWorkspaceSearch({ fullPage = false }: SearchProps) {
    const initial = fullPage ? searchStateFromUrl() : { query: "", projectId: "", contentType: "" };
    const [open, setOpen] = useState(fullPage);
    const [query, setQuery] = useState(initial.query);
    const [projectId, setProjectId] = useState(initial.projectId);
    const [contentType, setContentType] = useState(initial.contentType);
    const [payload, setPayload] = useState<SearchPayload | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [selected, setSelected] = useState(0);
    const dialogRef = useRef<HTMLDialogElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const requestRef = useRef(0);

    useEffect(() => {
        if (fullPage) return;
        const onShortcut = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
                event.preventDefault();
                setOpen(true);
            }
        };
        globalThis.addEventListener("keydown", onShortcut);
        return () => globalThis.removeEventListener("keydown", onShortcut);
    }, [fullPage]);

    useEffect(() => {
        if (fullPage) return;
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        if (!open && dialog.open) dialog.close();
        if (open) requestAnimationFrame(() => inputRef.current?.focus());
    }, [open, fullPage]);

    useEffect(() => {
        if (!open) return;
        const requestId = ++requestRef.current;
        const controller = new AbortController();
        const timer = globalThis.setTimeout(async () => {
            setLoading(true);
            setError("");
            try {
                const response = await fetch(searchUrl(query, projectId, contentType, fullPage ? 20 : 8), {
                    signal: controller.signal,
                    headers: { accept: "application/json" },
                });
                const next = await response.json() as SearchPayload;
                if (!response.ok || next.error) throw new Error(next.error || `Search failed with ${response.status}`);
                if (requestRef.current !== requestId) return;
                setPayload(next);
                setSelected(0);
            } catch (caught) {
                if (controller.signal.aborted || requestRef.current !== requestId) return;
                setError(caught instanceof Error ? caught.message : "Search failed.");
            } finally {
                if (requestRef.current === requestId) setLoading(false);
            }
        }, query ? 120 : 0);
        return () => {
            globalThis.clearTimeout(timer);
            controller.abort();
        };
    }, [query, projectId, contentType, open, fullPage]);

    useEffect(() => {
        if (!fullPage) return;
        const href = fullSearchHref(query, projectId, contentType);
        globalThis.history.replaceState(globalThis.history.state, "", href);
    }, [query, projectId, contentType, fullPage]);

    async function refresh() {
        setLoading(true);
        setError("");
        try {
            const response = await fetch("/api/owner/search/refresh", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-runwield-csrf": decodeURIComponent(cookieValue("rw_owner_csrf")),
                },
                body: "{}",
            });
            const result = await response.json() as { error?: string };
            if (!response.ok || result.error) throw new Error(result.error || "Refresh failed.");
            const next = await fetch(searchUrl(query, projectId, contentType, fullPage ? 20 : 8));
            setPayload(await next.json() as SearchPayload);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Refresh failed.");
        } finally {
            setLoading(false);
        }
    }

    function onResultKeys(event: React.KeyboardEvent<HTMLInputElement>) {
        const resultCount = payload?.results.length || 0;
        if (event.key === "ArrowDown" && resultCount) {
            event.preventDefault();
            setSelected((value) => (value + 1) % resultCount);
        } else if (event.key === "ArrowUp" && resultCount) {
            event.preventDefault();
            setSelected((value) => (value - 1 + resultCount) % resultCount);
        } else if (event.key === "Enter" && payload?.results[selected]) {
            event.preventDefault();
            globalThis.location.assign(resultHref(payload.results[selected], query, projectId, contentType));
        }
    }

    const content = (
        <section
            className={`rw-workspace-search ${fullPage ? "rw-workspace-search-page" : "rw-workspace-search-dialog"}`}
            aria-label="Workspace search"
        >
            <header className="rw-workspace-search-header">
                <div>
                    <h1>{fullPage ? "Search" : "Search Workspace"}</h1>
                    {!fullPage && <p>Plans, project knowledge, and Sessions</p>}
                </div>
                {!fullPage && (
                    <button
                        className="rw-icon-button"
                        type="button"
                        aria-label="Close search"
                        onClick={() => setOpen(false)}
                    >
                        ×
                    </button>
                )}
            </header>
            <div className="rw-workspace-search-query">
                <label
                    className="sr-only"
                    htmlFor={fullPage ? "workspace-search-page-input" : "workspace-search-dialog-input"}
                >
                    Search Workspace
                </label>
                <input
                    ref={inputRef}
                    id={fullPage ? "workspace-search-page-input" : "workspace-search-dialog-input"}
                    type="search"
                    value={query}
                    placeholder="Search Plans, knowledge, and Sessions"
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={onResultKeys}
                    autoComplete="off"
                />
                {loading && <RunWieldThinkingDots label="Searching" showLabel={false} />}
            </div>
            <div className="rw-workspace-search-filters">
                <label>
                    Project
                    <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                        <option value="">All Projects</option>
                        {(payload?.projects || []).map((project) => (
                            <option key={project.projectId} value={project.projectId}>{project.name}</option>
                        ))}
                    </select>
                </label>
                <label>
                    Type
                    <select value={contentType} onChange={(event) => setContentType(event.target.value)}>
                        <option value="">All types</option>
                        {(payload?.contentTypes || []).map((type) => (
                            <option key={type} value={type}>{TYPE_LABELS[type] || type}</option>
                        ))}
                    </select>
                </label>
                <button className="rw-button rw-button-secondary" type="button" onClick={refresh} disabled={loading}>
                    Refresh
                </button>
            </div>
            {error && <p className="rw-workspace-search-error" role="alert">{error}</p>}
            {(payload?.states || []).filter((state) => state.state !== "ready").map((state) => (
                <p className="rw-workspace-search-notice" key={state.projectId}>
                    {payload?.projects.find((project) =>
                        project.projectId === state.projectId
                    )?.name || "Project"}:{" "}
                    {state.state === "indexing" ? "Indexing" : state.message || `${state.reader || "Search"} failed`}
                </p>
            ))}
            {!query.trim()
                ? <p className="rw-workspace-search-empty">Enter a query to find Workspace content.</p>
                : !loading && !payload?.results.length
                ? <p className="rw-workspace-search-empty">No matches found.</p>
                : (
                    <ol className="rw-workspace-search-results" aria-label="Search results">
                        {(payload?.results || []).map((result, index) => (
                            <li key={result.id} data-selected={index === selected || undefined}>
                                <a
                                    href={resultHref(result, query, projectId, contentType)}
                                    onMouseEnter={() =>
                                        setSelected(index)}
                                >
                                    <strong>{result.title}</strong>
                                    <span className="rw-workspace-search-meta">
                                        <span className="badge">
                                            {TYPE_LABELS[result.contentType] || result.contentType}
                                        </span>
                                        <span>{result.projectName}</span>
                                    </span>
                                    <span className="rw-workspace-search-snippet">
                                        {result.summary || result.snippet}
                                    </span>
                                    {result.notices?.map((notice) => (
                                        <span className="rw-workspace-search-result-notice" key={notice}>{notice}</span>
                                    ))}
                                </a>
                            </li>
                        ))}
                    </ol>
                )}
            {!fullPage && (
                <footer className="rw-workspace-search-footer">
                    <span>↑↓ Select · Enter Open · Esc Close</span>
                    <a className="rw-button rw-button-secondary" href={fullSearchHref(query, projectId, contentType)}>
                        View all results
                    </a>
                </footer>
            )}
        </section>
    );

    if (fullPage) return content;
    return (
        <>
            <button
                className="rw-workspace-search-trigger"
                type="button"
                onClick={() => setOpen(true)}
                aria-haspopup="dialog"
            >
                <span aria-hidden="true">⌕</span>
                <span>Search</span>
                <kbd>⌘K</kbd>
            </button>
            <dialog ref={dialogRef} className="rw-workspace-search-modal" onClose={() => setOpen(false)}>
                {content}
            </dialog>
        </>
    );
}
