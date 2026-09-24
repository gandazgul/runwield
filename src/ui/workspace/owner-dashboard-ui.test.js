import { assertEquals, assertStringIncludes } from "@std/assert";
import { Window } from "happy-dom";

const source = await Deno.readTextFile(new URL("./components/OwnerDashboard.astro", import.meta.url));
const script = source.match(/<script is:inline data-astro-rerun>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error("Dashboard script is missing");

function dashboard() {
    const window = new Window({ url: "http://workspace.test/" });
    window.document.body.innerHTML = `
        <section data-owner-dashboard>
            <div data-dashboard-status></div>
            <div data-dashboard-warning hidden></div>
            <div data-dashboard-sections></div>
        </section>`;
    window.setInterval = () => 1;
    Object.defineProperty(window.document, "visibilityState", { value: "visible" });
    let payload = { projects: [], dashboard: { sections: [] } };
    window.fetch = () => Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }));
    window.eval(script);
    const refresh = async (next) => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        payload = next;
        window.document.dispatchEvent(new window.Event("visibilitychange"));
        await new Promise((resolve) => setTimeout(resolve, 0));
    };
    return { window, refresh };
}

function sections(items) {
    return { dashboard: { sections: [{ label: "Needs You", items }] }, projects: [] };
}

const first = { href: "/plans/1", title: "First plan", projectName: "A", statusLabel: "Ready" };
const second = { href: "/plans/2", title: "Second plan", projectName: "A", statusLabel: "Ready" };

Deno.test("Dashboard shows the next step and relevant time beside a Plan", async () => {
    const { window, refresh } = dashboard();
    try {
        await refresh(sections([{
            ...first,
            actionLabel: "Review Plan",
            updatedAt: "2026-09-20T12:00:00.000Z",
            recentAt: "2026-09-19T12:00:00.000Z",
        }]));
        const row = window.document.querySelector(".owner-dashboard-row");
        assertEquals(row.querySelector(".owner-dashboard-row-action").textContent, "Review Plan");
        assertEquals(row.querySelectorAll("time").length, 2);
        assertStringIncludes(row.textContent, "Finished");
    } finally {
        await window.happyDOM.abort();
    }
});

Deno.test("Dashboard sort icon shows the update order and reverses it", async () => {
    const { window, refresh } = dashboard();
    try {
        await refresh(sections([first, second]));
        let section = window.document.querySelector('.owner-dashboard-section[aria-label="Needs You"]');
        let button = section.querySelector("[data-dashboard-sort]");
        assertEquals(button.textContent, "");
        assertEquals(button.querySelector("svg").getAttribute("aria-hidden"), "true");
        assertStringIncludes(button.getAttribute("aria-label"), "Newest update first");
        assertEquals(section.querySelector(".owner-dashboard-row").getAttribute("href"), first.href);
        button.click();
        section = window.document.querySelector('.owner-dashboard-section[aria-label="Needs You"]');
        button = section.querySelector("[data-dashboard-sort]");
        assertStringIncludes(button.getAttribute("aria-label"), "Oldest update first");
        assertEquals(button.getAttribute("aria-pressed"), "true");
        assertEquals(section.querySelector(".owner-dashboard-row").getAttribute("href"), second.href);
        button.click();
        section = window.document.querySelector('.owner-dashboard-section[aria-label="Needs You"]');
        assertEquals(section.querySelector(".owner-dashboard-row").getAttribute("href"), first.href);
    } finally {
        await window.happyDOM.abort();
    }
});

Deno.test("Dashboard keeps keyboard focus on a Plan when a refresh adds a row", async () => {
    const { window, refresh } = dashboard();
    try {
        await refresh(sections([first]));
        window.document.querySelector(".owner-dashboard-row").focus();
        await refresh(sections([second, first]));
        assertEquals(window.document.activeElement.getAttribute("href"), first.href);
    } finally {
        await window.happyDOM.abort();
    }
});

Deno.test("Dashboard moves focus to its section when the focused Plan disappears", async () => {
    const { window, refresh } = dashboard();
    try {
        await refresh(sections([first, second]));
        window.document.querySelector(".owner-dashboard-row").focus();
        await refresh(sections([second]));
        assertEquals(window.document.activeElement.textContent, "Needs You");
    } finally {
        await window.happyDOM.abort();
    }
});

Deno.test("Dashboard warns about incomplete Project reads without adding a false work item", async () => {
    const { window, refresh } = dashboard();
    try {
        await refresh({
            ...sections([]),
            projects: [{
                lifecycle: "enabled",
                displayName: "Example",
                diagnostics: [{ repairHref: "/projects/1/settings" }],
            }],
        });
        const warning = window.document.querySelector("[data-dashboard-warning]");
        assertEquals(warning.hidden, false);
        assertStringIncludes(warning.textContent, "Dashboard items may be missing");
        assertEquals(warning.querySelector("a").getAttribute("href"), "/projects/1/settings");
        assertEquals(window.document.querySelectorAll(".owner-dashboard-row").length, 0);
        assertEquals(window.document.querySelectorAll("[data-dashboard-sort]").length, 0);
        assertStringIncludes(
            window.document.querySelector(".owner-dashboard-section .empty").textContent,
            "items may be missing",
        );
        assertEquals(window.document.querySelector(".owner-dashboard-section-heading span").textContent, "0+");
    } finally {
        await window.happyDOM.abort();
    }
});
