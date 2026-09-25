import { assertEquals, assertStringIncludes } from "@std/assert";
import { Window } from "happy-dom";

const source = await Deno.readTextFile(new URL("./components/OwnerDashboard.astro", import.meta.url));
const script = source.match(/<script is:inline data-astro-rerun>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error("Dashboard script is missing");
const markup = source.slice(0, source.indexOf("<script is:inline"));
const labels = ["Needs You", "Ready to Continue", "In Progress", "Recently Finished"];
const keys = ["needs-you", "ready", "in-progress", "recently-finished"];
const first = {
    type: "plan",
    projectId: "p",
    planId: "1",
    href: "/plans/1",
    title: "First plan",
    projectName: "A",
    statusLabel: "Ready",
    updatedAt: "2026-09-20T12:00:00.000Z",
};
const second = { ...first, planId: "2", href: "/plans/2", title: "Second plan", updatedAt: "2026-09-21T12:00:00.000Z" };

function frame(type, items = [], diagnostics = []) {
    return {
        type,
        progress: { pending: type !== "complete" },
        diagnostics,
        sections: keys.map((key, index) => ({ key, label: labels[index], items: index === 0 ? items : [] })),
    };
}
function dashboard() {
    const window = new Window({ url: "http://workspace.test/" });
    window.document.body.innerHTML = markup;
    const streams = [];
    window.fetch = () => new Promise((resolve) => streams.push(resolve));
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    window.eval(script);
    async function start() {
        await tick();
        let stream;
        const response = new Response(
            new ReadableStream({
                start(controller) {
                    stream = controller;
                },
            }),
        );
        streams.shift()(response);
        await tick();
        return {
            async send(value) {
                stream.enqueue(new TextEncoder().encode(JSON.stringify(value) + "\n"));
                await tick();
            },
            async end() {
                stream.close();
                await tick();
            },
        };
    }
    return { window, start, tick };
}

Deno.test("Dashboard initial HTML shows four pending cards before JavaScript or data", () => {
    const window = new Window();
    window.document.body.innerHTML = markup;
    assertEquals(
        [...window.document.querySelectorAll(".owner-dashboard-section h2")].map((node) => node.textContent),
        labels,
    );
    assertEquals(window.document.querySelectorAll('.owner-dashboard-section [role="status"]').length, 4);
    assertEquals(window.document.querySelectorAll(".owner-dashboard-section .empty").length, 0);
    window.happyDOM.abort();
});

Deno.test("Dashboard shows verified rows while other cards are loading, then distinguishes empty and errors", async () => {
    const { window, start } = dashboard();
    try {
        const stream = await start();
        await stream.send(frame("snapshot", [first]));
        assertEquals(window.document.querySelectorAll(".owner-dashboard-row").length, 1);
        assertStringIncludes(window.document.querySelector('[data-dashboard-card="ready"]').textContent, "Loading");
        assertEquals(window.document.querySelector(".owner-dashboard-section-heading span").textContent, "1+");
        await stream.send(frame("complete", [first]));
        await stream.end();
        assertStringIncludes(
            window.document.querySelector('[data-dashboard-card="ready"]').textContent,
            "Nothing here",
        );
        assertEquals(window.document.querySelectorAll(".owner-dashboard-error").length, 0);
    } finally {
        await window.happyDOM.abort();
    }
});

Deno.test("Dashboard preserves verified rows on failed refresh and replaces them on Retry", async () => {
    const { window, start, tick } = dashboard();
    try {
        let stream = await start();
        await stream.send(frame("complete", [first]));
        await stream.end();
        window.document.dispatchEvent(new window.Event("visibilitychange"));
        stream = await start();
        assertStringIncludes(
            window.document.querySelector('[data-dashboard-card="needs-you"]').textContent,
            "Updating",
        );
        await stream.end(); // EOF without a completion frame is an error, not empty.
        assertEquals(window.document.querySelectorAll(".owner-dashboard-row").length, 1);
        assertStringIncludes(window.document.querySelector(".owner-dashboard-error").textContent, "Could not update");
        window.document.querySelector("[data-dashboard-retry]").click();
        stream = await start();
        await stream.send(frame("complete", [second]));
        await stream.end();
        await tick();
        assertEquals(window.document.querySelector(".owner-dashboard-row").getAttribute("href"), second.href);
        assertEquals(window.document.querySelectorAll(".owner-dashboard-error").length, 0);
    } finally {
        await window.happyDOM.abort();
    }
});

Deno.test("Dashboard keeps sort, expansion and focused row during incremental updates", async () => {
    const { window, start } = dashboard();
    try {
        const stream = await start();
        await stream.send(frame("snapshot", [first, second]));
        window.document.querySelector("[data-dashboard-sort]").click();
        assertEquals(window.document.querySelector(".owner-dashboard-row").getAttribute("href"), first.href);
        window.document.querySelector(".owner-dashboard-row").focus();
        await stream.send(
            frame("snapshot", [
                second,
                first,
                ...Array.from(
                    { length: 5 },
                    (_, index) => ({
                        ...first,
                        planId: String(index + 3),
                        href: `/plans/${index + 3}`,
                        title: `Plan ${index + 3}`,
                    }),
                ),
            ]),
        );
        assertEquals(window.document.activeElement.textContent, "Needs You");
        window.document.querySelector("[data-dashboard-expand]").click();
        assertEquals(
            window.document.querySelectorAll('[data-dashboard-card="needs-you"] .owner-dashboard-row').length,
            7,
        );
        await stream.send(frame("complete", [second]));
        await stream.end();
        assertEquals(window.document.querySelectorAll(".owner-dashboard-row").length, 1);
        assertEquals(window.document.activeElement.textContent, "Needs You");
    } finally {
        await window.happyDOM.abort();
    }
});

Deno.test("Dashboard first-load error keeps verified partial rows and offers Retry", async () => {
    const { window, start } = dashboard();
    try {
        const stream = await start();
        await stream.send(frame("snapshot", [first]));
        await stream.send({ type: "error", error: "Project read failed." });
        await stream.end();
        assertEquals(window.document.querySelectorAll(".owner-dashboard-row").length, 1);
        assertStringIncludes(
            window.document.querySelector(".owner-dashboard-error").textContent,
            "Some results could not be checked",
        );
        assertEquals(window.document.querySelectorAll("[data-dashboard-retry]").length, 4);
    } finally {
        await window.happyDOM.abort();
    }
});

Deno.test("Dashboard treats Project diagnostics as incomplete rather than empty", async () => {
    const { window, start } = dashboard();
    try {
        const stream = await start();
        await stream.send(frame("complete", [], [{ message: "Unavailable", repairHref: "/projects/1/settings" }]));
        await stream.end();
        assertStringIncludes(window.document.querySelector(".owner-dashboard-error").textContent, "Results incomplete");
        assertEquals(window.document.querySelector(".empty").textContent, "Other items may be missing.");
        assertEquals(window.document.querySelector("[data-dashboard-warning]").hidden, false);
    } finally {
        await window.happyDOM.abort();
    }
});
