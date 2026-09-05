// @ts-nocheck: served as plain browser JavaScript from the owner Workspace static route.
export const LAST_SESSION_KEY = "runwield:owner:last-session";
export const LAST_PROJECT_KEY = "runwield:owner:last-project";
export const SIDEBAR_COLLAPSED_KEY = "runwield:owner:sidebar-collapsed";

let overlayDismissInstalled = false;
let sidebarDelegationInstalled = false;
let restoreDelegationInstalled = false;
let refreshGeneration = 0;
let activeSidebarAbort = null;
let sidebarHasRendered = false;

export function html(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function readStored(key) {
    try {
        const value = JSON.parse(localStorage.getItem(key) || "null");
        return value && typeof value === "object" ? value : null;
    } catch {
        return null;
    }
}

function writeStored(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Last navigation state is only a convenience.
    }
}

export function currentRouteFromUrl(urlLike) {
    const url = urlLike instanceof URL ? urlLike : new URL(String(urlLike), "http://workspace.local");
    const session = /^\/projects\/([^/]+)\/sessions\/([^/?#]+)(?:\/.*)?$/.exec(url.pathname);
    if (session) {
        return {
            projectId: decodeURIComponent(session[1]),
            runwieldSessionId: decodeURIComponent(session[2]),
            kind: "session",
        };
    }
    const ownerPlan = /^\/projects\/([^/]+)\/plans\/[^/]+(?:\/progress)?$/.exec(url.pathname);
    const planSession = url.searchParams.get("session") || "";
    if (ownerPlan && planSession) {
        return {
            projectId: decodeURIComponent(ownerPlan[1]),
            runwieldSessionId: planSession,
            kind: "session",
        };
    }
    const project = /^\/projects\/([^/]+)(?:\/|$)/.exec(url.pathname);
    if (project) return { projectId: decodeURIComponent(project[1]), kind: "project" };
    return { kind: "home" };
}

function currentRoute() {
    return currentRouteFromUrl(location.href);
}

function rememberCurrentRoute() {
    const route = currentRoute();
    if (
        route.kind === "session" && route.projectId && route.runwieldSessionId && route.runwieldSessionId !== "new"
    ) {
        writeStored(LAST_PROJECT_KEY, { projectId: route.projectId });
        writeStored(LAST_SESSION_KEY, {
            projectId: route.projectId,
            runwieldSessionId: route.runwieldSessionId,
        });
    } else if (route.projectId) {
        writeStored(LAST_PROJECT_KEY, { projectId: route.projectId });
    }
    return route;
}

function sessionHref(projectId, sessionId) {
    return `/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}`;
}

function newSessionHref(projectId) {
    return `/projects/${encodeURIComponent(projectId)}/sessions/new`;
}

function settingsHref(projectId) {
    return `/projects/${encodeURIComponent(projectId)}/settings`;
}

function plansHref(projectId) {
    return `/projects/${encodeURIComponent(projectId)}/plans`;
}

async function ownerJson(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: { accept: "application/json", ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}`);
    return payload;
}

function titleFromSessionId(sessionId) {
    return String(sessionId || "Current Session")
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
        .join(" ") || "Current Session";
}

function sessionStatusLabel(state) {
    const normalized = String(state || "idle").toLowerCase();
    return normalized === "active" || normalized === "busy" ? "busy" : "";
}

function panelCollapseIcon(side) {
    const path = side === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6";
    return `<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"><path d="M5 4v16" stroke-width="1.5" stroke-linecap="round"></path><path d="M19 4v16" stroke-width="1.5" stroke-linecap="round"></path><path d="${path}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
}

function isNarrowSidebarMode() {
    return globalThis.matchMedia?.("(max-width: 860px)").matches === true;
}

function setSidebarCollapsed(collapsed) {
    const shell = document.querySelector(".workspace-shell-with-sidebar");
    if (!shell) return;
    shell.classList.toggle("workspace-sidebar-collapsed", collapsed);
    shell.classList.remove("workspace-sidebar-overlay-open");
    try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "true" : "false");
    } catch {
        // Sidebar state is only a convenience.
    }
}

function openSidebar() {
    const shell = document.querySelector(".workspace-shell-with-sidebar");
    if (!shell) return;
    if (isNarrowSidebarMode()) {
        shell.classList.remove("workspace-sidebar-collapsed");
        shell.classList.add("workspace-sidebar-overlay-open");
        return;
    }
    setSidebarCollapsed(false);
}

function closeSidebarOverlay() {
    document.querySelector(".workspace-shell-with-sidebar")?.classList.remove("workspace-sidebar-overlay-open");
}

function isSidebarCollapsed() {
    try {
        return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
    } catch {
        return false;
    }
}

function sessionTitleFromPayload(payload, current) {
    if (current.kind !== "session") return "";
    if (current.runwieldSessionId === "new") return "New Session";
    const projects = Array.isArray(payload.projects) ? payload.projects : [];
    const project = projects.find((candidate) => candidate?.projectId === current.projectId);
    const sessions = Array.isArray(project?.sessions) ? project.sessions : [];
    const match = sessions.find((session) => session.runwieldSessionId === current.runwieldSessionId);
    if (match) return match.displayName || titleFromSessionId(current.runwieldSessionId);
    return titleFromSessionId(current.runwieldSessionId);
}

function renderMainHeader(payload, current) {
    const header = document.querySelector("[data-workspace-main-header-left]");
    if (!header) return;
    header.querySelector("[data-workspace-sidebar-restore]")?.remove();
    header.querySelector("[data-workspace-main-session-name]")?.remove();
    const title = sessionTitleFromPayload(payload, current);
    const restore = document.createElement("button");
    restore.className = "rw-toolbar-button workspace-sidebar-restore";
    restore.type = "button";
    restore.dataset.workspaceSidebarRestore = "";
    restore.setAttribute("aria-label", "Open Workspace sidebar");
    restore.title = "Open Workspace sidebar";
    restore.innerHTML = panelCollapseIcon("right");
    header.append(restore);
    if (title) {
        const sessionName = document.createElement("strong");
        sessionName.className = "workspace-main-session-name";
        sessionName.dataset.workspaceMainSessionName = "";
        sessionName.textContent = title;
        header.append(sessionName);
    }
}

function createAnchor(className, href, text) {
    const link = document.createElement("a");
    link.className = className;
    link.href = href;
    link.textContent = text;
    return link;
}

function makeSessionRow(projectId, session, current, extraClass = "") {
    const link = document.createElement("a");
    link.className = `workspace-sidebar-session${extraClass}`;
    link.href = sessionHref(projectId, session.runwieldSessionId);
    link.dataset.sidebarSession = session.runwieldSessionId;
    link.dataset.sidebarProjectId = projectId;
    const label = document.createElement("span");
    label.textContent = session.displayName || "Untitled Session";
    link.append(label);
    const status = document.createElement("small");
    link.append(status);
    updateSessionRow(link, projectId, session, current, extraClass);
    return link;
}

function updateSessionRow(link, projectId, session, current, extraClass = "") {
    link.href = sessionHref(projectId, session.runwieldSessionId);
    link.dataset.sidebarSession = session.runwieldSessionId;
    link.dataset.sidebarProjectId = projectId;
    const classNames = ["workspace-sidebar-session"];
    if (extraClass) classNames.push(...extraClass.trim().split(/\s+/));
    if (
        current.kind === "session" && current.projectId === projectId &&
        current.runwieldSessionId === session.runwieldSessionId
    ) classNames.push("active");
    link.className = classNames.join(" ");
    const label = link.querySelector("span") || document.createElement("span");
    label.textContent = session.displayName || "Untitled Session";
    if (!label.parentElement) link.append(label);
    const status = sessionStatusLabel(session.state);
    let statusNode = link.querySelector("small");
    if (status) {
        if (!statusNode) {
            statusNode = document.createElement("small");
            link.append(statusNode);
        }
        statusNode.textContent = status;
    } else {
        statusNode?.remove();
    }
}

function makeShowMoreButton(projectId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "workspace-sidebar-show-more";
    button.dataset.showMoreSessions = projectId;
    button.textContent = "Show more...";
    return button;
}

function makeEmpty(text) {
    const paragraph = document.createElement("p");
    paragraph.className = "workspace-sidebar-empty";
    paragraph.textContent = text;
    return paragraph;
}

function normalizeProject(project) {
    return {
        projectId: String(project?.projectId || ""),
        displayName: String(project?.displayName || "Untitled Project"),
        enabled: project?.enabled !== false,
        hasMoreSessions: Boolean(project?.hasMoreSessions),
        sessions: Array.isArray(project?.sessions)
            ? project.sessions.filter((session) => session?.runwieldSessionId)
            : [],
    };
}

function snapshotProject(projectElement) {
    const projectId = projectElement.getAttribute("data-sidebar-project") || "";
    return {
        projectId,
        sessions: Array.from(projectElement.querySelectorAll("[data-sidebar-session]")).map((link) => ({
            runwieldSessionId: link.getAttribute("data-sidebar-session") || "",
            displayName: link.querySelector("span")?.textContent || "",
            state: link.querySelector("small")?.textContent === "busy" ? "busy" : "idle",
            loaded: link.getAttribute("data-sidebar-loaded") === "true",
        })),
    };
}

export function sidebarSessionOrder(existingProject, incomingProject) {
    const incoming = normalizeProject(incomingProject).sessions;
    const seen = new Set(incoming.map((session) => session.runwieldSessionId));
    const retained = (existingProject?.sessions || []).filter((session) =>
        session.runwieldSessionId && session.loaded === true && !seen.has(session.runwieldSessionId)
    );
    return [...incoming, ...retained];
}

export function shouldApplySidebarRefresh(requestGeneration, latestGeneration, requestUrl, currentUrl) {
    return requestGeneration === latestGeneration && String(requestUrl) === String(currentUrl);
}

function ensureSidebarScaffold(sidebar, payload, current) {
    sidebar.querySelectorAll(":scope > .workspace-sidebar-empty").forEach((node) => node.remove());
    let brand = sidebar.querySelector(".workspace-sidebar-brand");
    if (!brand) {
        brand = document.createElement("div");
        brand.className = "workspace-sidebar-brand";
        const home = document.createElement("a");
        home.href = "/";
        home.setAttribute("aria-label", "RunWield Workspace home");
        home.innerHTML = '<img src="/brand/logo.svg" alt="" aria-hidden="true"><span>Workspace</span>';
        brand.append(home);
        sidebar.append(brand);
    }
    if (!brand.querySelector("[data-workspace-sidebar-collapse]")) {
        const collapse = document.createElement("button");
        collapse.className = "workspace-sidebar-collapse";
        collapse.type = "button";
        collapse.dataset.workspaceSidebarCollapse = "";
        collapse.setAttribute("aria-label", "Collapse Workspace sidebar");
        collapse.title = "Collapse Workspace sidebar";
        collapse.innerHTML = panelCollapseIcon("left");
        brand.append(collapse);
    }
    let newSession = sidebar.querySelector(".workspace-sidebar-new");
    if (!newSession) {
        newSession = document.createElement("a");
        newSession.className = "workspace-sidebar-new";
        newSession.innerHTML =
            '<span class="workspace-sidebar-plus" aria-hidden="true">+</span><span>New Session</span>';
        sidebar.append(newSession);
    }
    let section = sidebar.querySelector(".workspace-sidebar-section-title");
    if (!section) {
        section = createAnchor("workspace-sidebar-section-title", "/projects", "Projects");
        sidebar.append(section);
    }
    let list = sidebar.querySelector(".workspace-sidebar-project-list");
    if (!list) {
        list = document.createElement("nav");
        list.className = "workspace-sidebar-project-list";
        list.setAttribute("aria-label", "Projects and Sessions");
        sidebar.append(list);
    }

    const projects = Array.isArray(payload.projects) ? payload.projects : [];
    const rememberedProject = readStored(LAST_PROJECT_KEY)?.projectId || "";
    const enabledProjects = projects.filter((project) => project.enabled);
    const newProjectId = enabledProjects.find((project) => project.projectId === current.projectId)?.projectId ||
        enabledProjects.find((project) => project.projectId === rememberedProject)?.projectId ||
        enabledProjects[0]?.projectId || "";
    newSession.href = newProjectId ? newSessionHref(newProjectId) : "/projects";
    if (newProjectId) newSession.removeAttribute("aria-disabled");
    else newSession.setAttribute("aria-disabled", "true");
    return list;
}

function makeProjectElement(project, current) {
    const item = document.createElement("details");
    item.className = "workspace-sidebar-project";
    item.dataset.sidebarProject = project.projectId;
    const summary = document.createElement("summary");
    summary.innerHTML =
        `<span class="workspace-sidebar-folder" aria-hidden="true">▸</span><span class="workspace-sidebar-project-name"></span>`;
    const gear = document.createElement("a");
    gear.className = "workspace-sidebar-gear";
    gear.textContent = "⚙";
    summary.append(gear);
    const links = document.createElement("div");
    links.className = "workspace-sidebar-project-links";
    const sessions = document.createElement("div");
    sessions.className = "workspace-sidebar-sessions";
    item.append(summary, links, sessions);
    updateProjectElement(item, project, current);
    return item;
}

function updateProjectElement(item, project, current) {
    item.dataset.sidebarProject = project.projectId;
    if (current.projectId === project.projectId) item.setAttribute("open", "");
    item.querySelector(".workspace-sidebar-project-name").textContent = project.displayName;
    const gear = item.querySelector(".workspace-sidebar-gear");
    gear.href = settingsHref(project.projectId);
    gear.setAttribute("aria-label", `${project.displayName} settings`);
    const links = item.querySelector(".workspace-sidebar-project-links");
    links.replaceChildren(
        project.enabled
            ? createAnchor("", plansHref(project.projectId), "Plan Board")
            : createAnchor("", settingsHref(project.projectId), "Project unavailable · open settings"),
    );
    reconcileSessionRows(item.querySelector(".workspace-sidebar-sessions"), snapshotProject(item), project, current);
}

function reconcileSessionRows(container, existingProject, project, current) {
    const ordered = project.enabled ? sidebarSessionOrder(existingProject, project) : [];
    const byId = new Map(
        Array.from(container.querySelectorAll("[data-sidebar-session]")).map((row) => [
            row.getAttribute("data-sidebar-session") || "",
            row,
        ]),
    );
    const wantedIds = new Set(ordered.map((session) => session.runwieldSessionId));
    const activeOutsidePage = project.enabled && current.kind === "session" &&
        current.projectId === project.projectId &&
        current.runwieldSessionId !== "new" && !wantedIds.has(current.runwieldSessionId);
    if (activeOutsidePage) wantedIds.add(current.runwieldSessionId);

    Array.from(container.querySelectorAll(".workspace-sidebar-empty")).forEach((node) => node.remove());
    Array.from(container.querySelectorAll("[data-sidebar-session]")).forEach((row) => {
        const id = row.getAttribute("data-sidebar-session") || "";
        if (!wantedIds.has(id)) row.remove();
    });

    const nodes = [];
    for (const session of ordered) {
        const retained = byId.get(session.runwieldSessionId);
        const row = retained ||
            makeSessionRow(
                project.projectId,
                session,
                current,
                session.loaded ? " workspace-sidebar-session-extra" : "",
            );
        updateSessionRow(
            row,
            project.projectId,
            session,
            current,
            session.loaded ? " workspace-sidebar-session-extra" : "",
        );
        if (session.loaded) row.dataset.sidebarLoaded = "true";
        nodes.push(row);
    }
    if (activeOutsidePage) {
        const session = {
            runwieldSessionId: current.runwieldSessionId,
            displayName: titleFromSessionId(current.runwieldSessionId),
            state: "idle",
        };
        const row = byId.get(current.runwieldSessionId) ||
            makeSessionRow(project.projectId, session, current, " workspace-sidebar-session-extra");
        updateSessionRow(row, project.projectId, session, current, " workspace-sidebar-session-extra");
        nodes.push(row);
    }

    const showMore = container.querySelector("[data-show-more-sessions]") || makeShowMoreButton(project.projectId);
    if (project.enabled && project.hasMoreSessions) {
        showMore.dataset.showMoreSessions = project.projectId;
        showMore.removeAttribute("disabled");
        showMore.textContent = "Show more...";
        nodes.push(showMore);
    } else {
        showMore.remove();
    }

    if (!nodes.length) nodes.push(makeEmpty(project.enabled ? "No Sessions yet." : "Sessions unavailable."));
    for (const node of nodes) container.append(node);
}

export function sidebarProjectOrder(_existingProjects, incomingProjects) {
    return incomingProjects.map(normalizeProject).filter((project) => project.projectId);
}

function reconcileProjects(list, payload, current) {
    const incomingProjects = Array.isArray(payload.projects) ? payload.projects : [];
    const existingProjects = Array.from(list.querySelectorAll("[data-sidebar-project]")).map(snapshotProject);
    const ordered = sidebarProjectOrder(existingProjects, incomingProjects);
    const byId = new Map(
        Array.from(list.querySelectorAll("[data-sidebar-project]")).map((item) => [
            item.getAttribute("data-sidebar-project") || "",
            item,
        ]),
    );
    list.querySelectorAll(":scope > .workspace-sidebar-empty").forEach((node) => node.remove());
    const wantedIds = new Set(ordered.map((project) => project.projectId));
    byId.forEach((node, projectId) => {
        if (!wantedIds.has(projectId)) node.remove();
    });
    if (!ordered.length) {
        list.append(makeEmpty("No Projects registered."));
        return;
    }
    for (const project of ordered) {
        const node = byId.get(project.projectId) || makeProjectElement(project, current);
        updateProjectElement(node, project, current);
        list.append(node);
    }
}

export function renderSidebar(payload, current) {
    const sidebar = document.querySelector("[data-workspace-sidebar]");
    if (!sidebar) return;
    renderMainHeader(payload, current);
    const list = ensureSidebarScaffold(sidebar, payload, current);
    reconcileProjects(list, payload, current);
    setSidebarCollapsed(isSidebarCollapsed());
    sidebarHasRendered = true;
}

export function applyActiveRoute(current) {
    document.querySelectorAll("[data-sidebar-session]").forEach((row) => {
        row.classList.toggle(
            "active",
            current.kind === "session" &&
                row.getAttribute("data-sidebar-project-id") === current.projectId &&
                row.getAttribute("data-sidebar-session") === current.runwieldSessionId,
        );
    });
    if (current.projectId) {
        document.querySelector(`[data-sidebar-project="${CSS.escape(current.projectId)}"]`)?.setAttribute("open", "");
    }
}

function workspaceNavigate(href, history = "push") {
    const event = new CustomEvent("runwield:workspace-navigate", {
        cancelable: true,
        detail: { href, history },
    });
    if (document.dispatchEvent(event)) {
        if (history === "replace") location.replace(href);
        else location.assign(href);
    }
}

function installRestoreDelegation() {
    if (restoreDelegationInstalled) return;
    restoreDelegationInstalled = true;
    document.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (!target.closest("[data-workspace-sidebar-restore]")) return;
        event.stopPropagation();
        openSidebar();
    });
}

function installSidebarDelegation() {
    if (sidebarDelegationInstalled) return;
    sidebarDelegationInstalled = true;
    document.addEventListener("click", async (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest("[data-workspace-sidebar-collapse]")) {
            setSidebarCollapsed(true);
            return;
        }
        const showMore = target.closest("[data-show-more-sessions]");
        if (showMore) {
            const button = showMore;
            const projectId = button.getAttribute("data-show-more-sessions") || "";
            button.setAttribute("disabled", "true");
            button.textContent = "Loading...";
            try {
                const data = await ownerJson(
                    `/api/owner/projects/${encodeURIComponent(projectId)}/sessions?page=0&pageSize=100`,
                );
                const parent = button.closest(".workspace-sidebar-sessions");
                const current = currentRoute();
                const known = new Set(
                    Array.from(parent?.querySelectorAll("[data-sidebar-session]") || []).map((link) =>
                        link.getAttribute("data-sidebar-session")
                    ),
                );
                const rows = (Array.isArray(data.sessions) ? data.sessions : [])
                    .filter((session) => session?.runwieldSessionId && !known.has(session.runwieldSessionId))
                    .map((session) => {
                        const row = makeSessionRow(projectId, session, current, " workspace-sidebar-session-extra");
                        row.dataset.sidebarLoaded = "true";
                        return row;
                    });
                if (rows.length) button.before(...rows);
                else button.before(makeEmpty("No more Sessions."));
                button.remove();
            } catch (error) {
                button.removeAttribute("disabled");
                button.textContent = error instanceof Error ? error.message : "Show more failed";
            }
        }
    });
}

function installSidebarOverlayDismiss() {
    if (overlayDismissInstalled) return;
    overlayDismissInstalled = true;
    document.addEventListener("click", (event) => {
        const shell = document.querySelector(".workspace-shell-with-sidebar");
        if (!shell?.classList.contains("workspace-sidebar-overlay-open")) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest(".workspace-sidebar")) return;
        closeSidebarOverlay();
    });
}

async function refreshSidebarForPage() {
    installSidebarOverlayDismiss();
    installSidebarDelegation();
    installRestoreDelegation();
    const current = rememberCurrentRoute();
    applyActiveRoute(current);
    activeSidebarAbort?.abort();
    const abort = new AbortController();
    activeSidebarAbort = abort;
    const requestGeneration = refreshGeneration + 1;
    refreshGeneration = requestGeneration;
    const requestUrl = location.href;
    try {
        const payload = await ownerJson("/api/owner/sidebar", { signal: abort.signal });
        if (!shouldApplySidebarRefresh(requestGeneration, refreshGeneration, requestUrl, location.href)) return;
        if (location.pathname === "/") {
            const projects = Array.isArray(payload.projects) ? payload.projects : [];
            const lastSession = readStored(LAST_SESSION_KEY);
            const rememberedSessionProject = projects.find((project) =>
                project.enabled && project.projectId === lastSession?.projectId
            );
            const rememberedSession = rememberedSessionProject?.sessions?.find((session) =>
                session.runwieldSessionId === lastSession?.runwieldSessionId
            );
            if (rememberedSessionProject && rememberedSession) {
                workspaceNavigate(
                    sessionHref(rememberedSessionProject.projectId, rememberedSession.runwieldSessionId),
                    "replace",
                );
                return;
            }
            const lastProject = readStored(LAST_PROJECT_KEY)?.projectId;
            const fallbackProject = projects.find((project) => project.enabled && project.projectId === lastProject) ||
                projects.find((project) => project.enabled);
            const fallbackSession = fallbackProject?.sessions?.[0];
            if (fallbackProject && fallbackSession) {
                workspaceNavigate(sessionHref(fallbackProject.projectId, fallbackSession.runwieldSessionId), "replace");
                return;
            }
            if (fallbackProject) {
                workspaceNavigate(newSessionHref(fallbackProject.projectId), "replace");
                return;
            }
        }
        renderSidebar(payload, current);
    } catch (error) {
        if (error?.name === "AbortError") return;
        const sidebar = document.querySelector("[data-workspace-sidebar]");
        if (sidebar && !sidebarHasRendered) sidebar.replaceChildren(makeEmpty("Sidebar failed to load."));
    }
}

export function installWorkspaceShell() {
    refreshSidebarForPage();
}

let workspaceShellBrowserInstalled = false;

export function installWorkspaceShellBrowser() {
    if (workspaceShellBrowserInstalled) return;
    workspaceShellBrowserInstalled = true;
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", installWorkspaceShell, { once: true });
    } else installWorkspaceShell();
    document.addEventListener("astro:page-load", installWorkspaceShell);
}

if (typeof document !== "undefined") installWorkspaceShellBrowser();
