// @ts-nocheck: served as plain browser JavaScript from the owner Workspace static route.
(() => {
    const LAST_SESSION_KEY = "runwield:owner:last-session";
    const LAST_PROJECT_KEY = "runwield:owner:last-project";

    function html(value) {
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

    function currentRoute() {
        const session = /^\/projects\/([^/]+)\/sessions\/([^/?#]+)$/.exec(location.pathname);
        if (session) {
            return {
                projectId: decodeURIComponent(session[1]),
                runwieldSessionId: decodeURIComponent(session[2]),
                kind: "session",
            };
        }
        const project = /^\/projects\/([^/]+)(?:\/|$)/.exec(location.pathname);
        if (project) return { projectId: decodeURIComponent(project[1]), kind: "project" };
        return { kind: "home" };
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

    async function ownerJson(url) {
        const response = await fetch(url, { headers: { accept: "application/json" } });
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

    function renderSessionRow(projectId, session, current, extraClass = "") {
        const active = current.runwieldSessionId === session.runwieldSessionId ? " active" : "";
        const status = sessionStatusLabel(session.state);
        return `<a class="workspace-sidebar-session${active}${extraClass}" href="${
            sessionHref(projectId, session.runwieldSessionId)
        }" data-sidebar-session="${html(session.runwieldSessionId)}"><span>${
            html(session.displayName || "Untitled Session")
        }</span>${status ? `<small>${html(status)}</small>` : ""}</a>`;
    }

    function renderProject(project, current) {
        const projectId = project.projectId;
        const open = current.projectId === projectId ? " open" : "";
        const sessions = Array.isArray(project.sessions) ? project.sessions : [];
        const items = sessions.map((session) => renderSessionRow(projectId, session, current)).join("");
        const activeOutsidePage = current.kind === "session" && current.projectId === projectId &&
            current.runwieldSessionId !== "new" &&
            !sessions.some((session) => session.runwieldSessionId === current.runwieldSessionId);
        const activeItem = activeOutsidePage
            ? renderSessionRow(
                projectId,
                {
                    runwieldSessionId: current.runwieldSessionId,
                    displayName: titleFromSessionId(current.runwieldSessionId),
                    state: "idle",
                },
                current,
                " workspace-sidebar-session-extra",
            )
            : "";
        const showMore = project.hasMoreSessions
            ? `<button type="button" class="workspace-sidebar-show-more" data-show-more-sessions="${
                html(projectId)
            }">Show more...</button>`
            : "";
        return `<details class="workspace-sidebar-project" data-sidebar-project="${
            html(projectId)
        }"${open}><summary><span class="workspace-sidebar-folder" aria-hidden="true">▸</span><span class="workspace-sidebar-project-name">${
            html(project.displayName)
        }</span><a class="workspace-sidebar-gear" href="${settingsHref(projectId)}" aria-label="${
            html(project.displayName)
        } settings">⚙</a></summary><div class="workspace-sidebar-project-links"><a href="${
            plansHref(projectId)
        }">Plan Board</a></div><div class="workspace-sidebar-sessions">${
            items || `<p class="workspace-sidebar-empty">No Sessions yet.</p>`
        }${activeItem}${showMore}</div></details>`;
    }

    function renderSidebar(payload, current) {
        const sidebar = document.querySelector("[data-workspace-sidebar]");
        if (!sidebar) return;
        const projects = Array.isArray(payload.projects) ? payload.projects : [];
        const rememberedProject = readStored(LAST_PROJECT_KEY)?.projectId || "";
        const newProjectId = current.projectId || rememberedProject ||
            projects.find((project) => project.enabled)?.projectId || projects[0]?.projectId || "";
        sidebar.innerHTML =
            `<div class="workspace-sidebar-brand"><a href="/" aria-label="RunWield Workspace home"><img src="/brand/logo.svg" alt="" aria-hidden="true"><span>Workspace</span></a></div><a class="workspace-sidebar-new" href="${
                newProjectId ? newSessionHref(newProjectId) : "/projects"
            }" ${
                newProjectId ? "" : 'aria-disabled="true"'
            }><span class="workspace-sidebar-plus" aria-hidden="true">+</span><span>New Session</span></a><a class="workspace-sidebar-section-title" href="/projects">Projects</a><nav class="workspace-sidebar-project-list" aria-label="Projects and Sessions">${
                projects.map((project) => renderProject(project, current)).join("") ||
                `<p class="workspace-sidebar-empty">No Projects registered.</p>`
            }</nav>`;
        sidebar.querySelectorAll("[data-show-more-sessions]").forEach((button) => {
            button.addEventListener("click", async () => {
                const projectId = button.getAttribute("data-show-more-sessions") || "";
                button.setAttribute("disabled", "true");
                button.textContent = "Loading...";
                try {
                    const data = await ownerJson(
                        `/api/owner/projects/${encodeURIComponent(projectId)}/sessions?page=0&pageSize=100`,
                    );
                    const parent = button.closest(".workspace-sidebar-sessions");
                    const known = new Set(
                        Array.from(parent?.querySelectorAll("a[href]") || []).map((link) => link.getAttribute("href")),
                    );
                    const rows = (Array.isArray(data.sessions) ? data.sessions : [])
                        .map((session) => ({ session, href: sessionHref(projectId, session.runwieldSessionId) }))
                        .filter((entry) => !known.has(entry.href))
                        .map((entry) => renderSessionRow(projectId, entry.session, current))
                        .join("");
                    button.insertAdjacentHTML(
                        "beforebegin",
                        rows || `<p class="workspace-sidebar-empty">No more Sessions.</p>`,
                    );
                    button.remove();
                } catch (error) {
                    button.removeAttribute("disabled");
                    button.textContent = error instanceof Error ? error.message : "Show more failed";
                }
            });
        });
    }

    async function boot() {
        const current = rememberCurrentRoute();
        if (location.pathname === "/") {
            const last = readStored(LAST_SESSION_KEY);
            if (last?.projectId && last?.runwieldSessionId) {
                location.replace(sessionHref(last.projectId, last.runwieldSessionId));
                return;
            }
        }
        try {
            const payload = await ownerJson("/api/owner/sidebar");
            if (location.pathname === "/") {
                const lastProject = readStored(LAST_PROJECT_KEY)?.projectId;
                const fallbackProject = payload.projects?.find((project) => project.projectId === lastProject) ||
                    payload.projects?.find((project) => project.enabled) || payload.projects?.[0];
                const fallbackSession = fallbackProject?.sessions?.[0];
                if (fallbackProject && fallbackSession) {
                    location.replace(sessionHref(fallbackProject.projectId, fallbackSession.runwieldSessionId));
                    return;
                }
                if (fallbackProject) {
                    location.replace(newSessionHref(fallbackProject.projectId));
                    return;
                }
            }
            renderSidebar(payload, current);
        } catch {
            const sidebar = document.querySelector("[data-workspace-sidebar]");
            if (sidebar) sidebar.innerHTML = `<p class="workspace-sidebar-empty">Sidebar failed to load.</p>`;
        }
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
})();
