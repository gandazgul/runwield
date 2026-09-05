// @ts-nocheck: Deno test imports browser-shell helpers with a small fake DOM.
import { assert, assertEquals, assertStrictEquals, assertStringIncludes } from "@std/assert";
import {
    applyActiveRoute,
    currentRouteFromUrl,
    installWorkspaceShellBrowser,
    renderSidebar,
    shouldApplySidebarRefresh,
    sidebarProjectOrder,
    sidebarSessionOrder,
} from "./static/workspace-shell.ts";

class FakeClassList {
    constructor(element) {
        this.element = element;
    }
    _classes() {
        return new Set(String(this.element.className || "").split(/\s+/).filter(Boolean));
    }
    add(...names) {
        const classes = this._classes();
        names.forEach((name) => classes.add(name));
        this.element.className = [...classes].join(" ");
    }
    remove(...names) {
        const classes = this._classes();
        names.forEach((name) => classes.delete(name));
        this.element.className = [...classes].join(" ");
    }
    contains(name) {
        return this._classes().has(name);
    }
    toggle(name, force) {
        const shouldHave = force === undefined ? !this.contains(name) : Boolean(force);
        if (shouldHave) this.add(name);
        else this.remove(name);
    }
}

class FakeElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.parentElement = null;
        this.attributes = new Map();
        this.className = "";
        this.dataset = new Proxy({}, {
            set: (_target, key, value) => {
                this.setAttribute(
                    `data-${String(key).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`,
                    value,
                );
                return true;
            },
            get: (_target, key) =>
                this.getAttribute(`data-${String(key).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`),
        });
        this.classList = new FakeClassList(this);
        this._textContent = "";
    }
    set textContent(value) {
        this.children = [];
        this._textContent = String(value);
    }
    get textContent() {
        return this._textContent || this.children.map((child) => child.textContent).join("");
    }
    set innerHTML(value) {
        this.children = [];
        this._textContent = String(value).replace(/<[^>]+>/g, "");
        for (const className of String(value).matchAll(/class="([^"]+)"/g)) {
            const child = new FakeElement("span");
            child.className = className[1];
            this.append(child);
        }
    }
    append(...nodes) {
        for (const node of nodes) {
            node.parentElement?.removeChild(node);
            node.parentElement = this;
            this.children.push(node);
        }
    }
    before(...nodes) {
        const parent = this.parentElement;
        if (!parent) return;
        const index = parent.children.indexOf(this);
        for (const node of nodes) {
            node.parentElement?.removeChild(node);
            node.parentElement = parent;
        }
        parent.children.splice(index, 0, ...nodes);
    }
    replaceChildren(...nodes) {
        this.children.forEach((child) => child.parentElement = null);
        this.children = [];
        this.append(...nodes);
    }
    removeChild(node) {
        const index = this.children.indexOf(node);
        if (index >= 0) this.children.splice(index, 1);
        node.parentElement = null;
    }
    remove() {
        this.parentElement?.removeChild(this);
    }
    setAttribute(name, value) {
        if (name === "class") this.className = String(value);
        else this.attributes.set(name, String(value));
    }
    getAttribute(name) {
        if (name === "class") return this.className;
        return this.attributes.get(name) ?? null;
    }
    removeAttribute(name) {
        if (name === "class") this.className = "";
        else this.attributes.delete(name);
    }
    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }
    querySelectorAll(selector) {
        const direct = selector.startsWith(":scope > ");
        const simple = direct ? selector.slice(9) : selector;
        const candidates = direct ? [...this.children] : this._descendants();
        return candidates.filter((node) => node._matches(simple));
    }
    _descendants() {
        return this.children.flatMap((child) => [child, ...child._descendants()]);
    }
    _matches(selector) {
        if (selector === "span" || selector === "small") return this.tagName.toLowerCase() === selector;
        if (selector.startsWith(".")) return String(this.className).split(/\s+/).includes(selector.slice(1));
        const attrEquals = /^\[([^=\]]+)="([^"]*)"\]$/.exec(selector);
        if (attrEquals) return this.getAttribute(attrEquals[1]) === attrEquals[2];
        const attr = /^\[([^\]]+)\]$/.exec(selector);
        if (attr) return this.getAttribute(attr[1]) !== null;
        return false;
    }
}

class FakeDocument extends FakeElement {
    constructor() {
        super("document");
        this.readyState = "complete";
        this.listeners = new Map();
    }
    createElement(tagName) {
        return new FakeElement(tagName);
    }
    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }
    dispatchEvent(event) {
        for (const listener of this.listeners.get(event.type) || []) listener(event);
        return !event.defaultPrevented;
    }
}

function installFakeBrowser(pathname = "/projects/project-a/sessions/session-a") {
    const document = new FakeDocument();
    const shell = document.createElement("div");
    shell.className = "workspace-shell-with-sidebar";
    const sidebar = document.createElement("aside");
    sidebar.className = "workspace-sidebar";
    sidebar.dataset.workspaceSidebar = "";
    sidebar.append(
        Object.assign(document.createElement("p"), {
            className: "workspace-sidebar-empty",
            textContent: "Loading Workspace…",
        }),
    );
    const header = document.createElement("div");
    header.dataset.workspaceMainHeaderLeft = "";
    shell.append(sidebar, header);
    document.append(shell);
    globalThis.document = document;
    globalThis.location = { href: `http://workspace.local${pathname}`, pathname, assign() {}, replace() {} };
    globalThis.localStorage = { getItem: () => null, setItem() {} };
    globalThis.CSS = { escape: (value) => String(value) };
    return { document, sidebar };
}

Deno.test("Workspace shell maps owner review and artifact routes back to the owning Session", () => {
    assertEquals(currentRouteFromUrl("http://workspace.local/projects/project-a/sessions/session-a"), {
        kind: "session",
        projectId: "project-a",
        runwieldSessionId: "session-a",
    });
    assertEquals(currentRouteFromUrl("http://workspace.local/projects/project-a/sessions/session-a/review/code"), {
        kind: "session",
        projectId: "project-a",
        runwieldSessionId: "session-a",
    });
    assertEquals(
        currentRouteFromUrl("http://workspace.local/projects/project-a/sessions/session-a/artifacts/artifact-a"),
        {
            kind: "session",
            projectId: "project-a",
            runwieldSessionId: "session-a",
        },
    );
    assertEquals(currentRouteFromUrl("http://workspace.local/projects/project-a/plans/plan-a?session=session-a"), {
        kind: "session",
        projectId: "project-a",
        runwieldSessionId: "session-a",
    });
});

Deno.test("Workspace sidebar refreshes reject stale navigation responses", () => {
    assertEquals(shouldApplySidebarRefresh(2, 2, "http://workspace.local/a", "http://workspace.local/a"), true);
    assertEquals(shouldApplySidebarRefresh(1, 2, "http://workspace.local/a", "http://workspace.local/a"), false);
    assertEquals(shouldApplySidebarRefresh(2, 2, "http://workspace.local/a", "http://workspace.local/b"), false);
});

Deno.test("Workspace sidebar reconciliation keeps only loaded older Sessions while inserting new server rows first", () => {
    const order = sidebarSessionOrder(
        {
            projectId: "project-a",
            sessions: [
                { runwieldSessionId: "ordinary", displayName: "Ordinary" },
                { runwieldSessionId: "loaded-old", displayName: "Loaded old", loaded: true },
            ],
        },
        {
            projectId: "project-a",
            sessions: [{ runwieldSessionId: "new", displayName: "New Session" }],
        },
    );
    assertEquals(order.map((session) => session.runwieldSessionId), ["new", "loaded-old"]);
});

Deno.test("Workspace sidebar drops active omitted Sessions after the user navigates away", () => {
    const { sidebar } = installFakeBrowser("/projects/project-a/sessions/omitted");
    const payload = {
        projects: [{
            projectId: "project-a",
            displayName: "Project A",
            enabled: true,
            hasMoreSessions: true,
            sessions: [
                { runwieldSessionId: "session-a", displayName: "Alpha", state: "idle" },
            ],
        }],
    };

    renderSidebar(payload, { kind: "session", projectId: "project-a", runwieldSessionId: "omitted" });

    const omitted = sidebar.querySelector('[data-sidebar-session="omitted"]');
    assert(omitted);
    assertEquals(omitted.getAttribute("data-sidebar-loaded"), null);

    renderSidebar(payload, { kind: "session", projectId: "project-a", runwieldSessionId: "session-a" });

    assertEquals(sidebar.querySelector('[data-sidebar-session="omitted"]'), null);
});

Deno.test("Workspace sidebar project reconciliation removes Projects omitted by the server", () => {
    const order = sidebarProjectOrder(
        [{ projectId: "project-a", sessions: [] }, { projectId: "loaded-project", sessions: [] }],
        [{ projectId: "project-a", displayName: "Project A", enabled: true, sessions: [] }],
    );
    assertEquals(order.map((project) => project.projectId), ["project-a"]);
});

Deno.test("Workspace sidebar updates rows in place, inserts new Sessions, removes stale rows, and preserves expansion", () => {
    const { sidebar } = installFakeBrowser();
    const current = { kind: "session", projectId: "project-a", runwieldSessionId: "session-a" };
    renderSidebar({
        projects: [{
            projectId: "project-a",
            displayName: "Project A",
            enabled: true,
            sessions: [
                { runwieldSessionId: "session-a", displayName: "Alpha", state: "idle" },
                { runwieldSessionId: "ordinary", displayName: "Ordinary", state: "idle" },
            ],
        }],
    }, current);
    const project = sidebar.querySelector('[data-sidebar-project="project-a"]');
    project.setAttribute("open", "");
    const alpha = sidebar.querySelector('[data-sidebar-session="session-a"]');

    renderSidebar({
        projects: [{
            projectId: "project-a",
            displayName: "Project A",
            enabled: true,
            sessions: [
                { runwieldSessionId: "new-session", displayName: "New", state: "idle" },
                { runwieldSessionId: "session-a", displayName: "Alpha Renamed", state: "busy" },
            ],
        }],
    }, current);

    assertStrictEquals(sidebar.querySelector('[data-sidebar-session="session-a"]'), alpha);
    assertEquals(alpha.querySelector("span").textContent, "Alpha Renamed");
    assertEquals(alpha.querySelector("small").textContent, "busy");
    assert(sidebar.querySelector('[data-sidebar-session="new-session"]'));
    assertEquals(sidebar.querySelector('[data-sidebar-session="ordinary"]'), null);
    assertEquals(project.getAttribute("open"), "");
    assertEquals(sidebar.querySelectorAll(":scope > .workspace-sidebar-empty").length, 0);
});

Deno.test("Workspace sidebar active route uses both Project and Session keys", () => {
    installFakeBrowser("/projects/project-b/sessions/shared");
    renderSidebar({
        projects: [
            {
                projectId: "project-a",
                displayName: "Project A",
                enabled: true,
                sessions: [{ runwieldSessionId: "shared", displayName: "Wrong" }],
            },
            {
                projectId: "project-b",
                displayName: "Project B",
                enabled: true,
                sessions: [{ runwieldSessionId: "shared", displayName: "Right" }],
            },
        ],
    }, { kind: "session", projectId: "project-b", runwieldSessionId: "shared" });
    applyActiveRoute({ kind: "session", projectId: "project-b", runwieldSessionId: "shared" });
    const rows = globalThis.document.querySelectorAll('[data-sidebar-session="shared"]');
    assertEquals(rows.map((row) => row.classList.contains("active")), [false, true]);
    assertStringIncludes(globalThis.document.querySelector("[data-workspace-main-session-name]").textContent, "Right");
});

Deno.test("Workspace shell installs one sidebar refresh per page-load navigation", async () => {
    const { document } = installFakeBrowser();
    let refreshes = 0;
    globalThis.fetch = () => {
        refreshes += 1;
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ projects: [] }) });
    };
    installWorkspaceShellBrowser();
    installWorkspaceShellBrowser();
    document.dispatchEvent(new CustomEvent("astro:page-load"));
    document.dispatchEvent(new CustomEvent("astro:page-load"));
    await Promise.resolve();
    assertEquals(refreshes, 3);
});

Deno.test("Workspace shell is event-driven and does not poll the sidebar", async () => {
    const shell = await Deno.readTextFile(new URL("./static/workspace-shell.ts", import.meta.url));
    assertStringIncludes(shell, 'document.addEventListener("astro:page-load", installWorkspaceShell)');
    assertStringIncludes(shell, 'ownerJson("/api/owner/sidebar"');
    assertEquals(/setInterval\s*\(/.test(shell), false);
    assertEquals(shell.includes("setTimeout(()"), false);
    assertEquals(/visibilitychange[^\n]+sidebar/.test(shell), false);
});

Deno.test("Workspace owner layout persists the real sidebar and owns navigation", async () => {
    const layout = await Deno.readTextFile(new URL("./layouts/WorkspaceLayout.astro", import.meta.url));
    assertStringIncludes(layout, 'import { ClientRouter } from "astro:transitions";');
    assertStringIncludes(layout, "<ClientRouter />");
    assertStringIncludes(layout, 'transition:name="workspace-sidebar" transition:persist');
    assertStringIncludes(layout, 'document.addEventListener("runwield:workspace-navigate"');
    assertEquals(layout.includes("__runwieldWorkspaceNavigate"), false);
    assertStringIncludes(layout, '<script is:inline type="module" src="/workspace-shell.js"></script>');
});
