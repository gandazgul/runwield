import { assertEquals, assertRejects } from "@std/assert";
import { runPlansReadCommand } from "./read.js";

/**
 * @param {() => Promise<void>} fn
 * @returns {Promise<string[]>}
 */
async function captureLogs(fn) {
    /** @type {string[]} */
    const logs = [];
    const orig = console.log;
    console.log = (msg = "") => logs.push(String(msg));
    try {
        await fn();
    } finally {
        console.log = orig;
    }
    return logs;
}

/**
 * @param {(options: any) => void} onStart
 */
function fakeReadSurface(onStart) {
    return /** @type {any} */ ((/** @type {any} */ options) => {
        onStart(options);
        return Promise.resolve({
            url: "http://127.0.0.1:1234/review/plan?token=test",
            opened: true,
            waitForDecision: () => Promise.resolve({ exit: true }),
            stop: () => Promise.resolve(),
        });
    });
}

Deno.test("read command opens active plans before archived duplicates", async () => {
    /** @type {any} */
    let seen;
    const logs = await captureLogs(() =>
        runPlansReadCommand(
            ["same"],
            /** @type {any} */ ({
                __testDeps: {
                    loadPlan: () =>
                        Promise.resolve({
                            path: "/repo/plans/same.md",
                            markdown: "---\nstatus: draft\n---\n# Active",
                            attrs: { status: "draft", classification: "FEATURE", complexity: "LOW", summary: "Active" },
                            body: "# Active",
                        }),
                    loadArchivedPlan: () => {
                        throw new Error("should not read archive");
                    },
                    startArtifactReadSurface: fakeReadSurface((options) => seen = options),
                },
            }),
        )
    );

    assertEquals(seen.artifactKind, "plan");
    assertEquals(seen.title, "same");
    assertEquals(seen.path, "/repo/plans/same.md");
    assertEquals(seen.markdown.includes("# Active"), true);
    assertEquals(logs.some((line) => line.includes("Plan read-only view")), true);
});

Deno.test("read command opens archived plans when explicitly addressed", async () => {
    /** @type {any} */
    let seen;
    await captureLogs(() =>
        runPlansReadCommand(
            ["archived/same"],
            /** @type {any} */ ({
                __testDeps: {
                    loadPlan: () => Promise.resolve(null),
                    loadArchivedPlan: () =>
                        Promise.resolve({
                            name: "same",
                            path: "/repo/plans/archived/same.md",
                            markdown: "---\nstatus: verified\n---\n# Archived",
                            attrs: {
                                status: "verified",
                                classification: "FEATURE",
                                complexity: "MEDIUM",
                                summary: "Archived",
                                archivedAt: "now",
                            },
                            body: "# Archived",
                        }),
                    startArtifactReadSurface: fakeReadSurface((options) => seen = options),
                },
            }),
        )
    );

    assertEquals(seen.title, "plans/archived/same.md");
    assertEquals(seen.path, "/repo/plans/archived/same.md");
    assertEquals(seen.markdown.includes("# Archived"), true);
});

Deno.test("read command opens archived plans by plan id", async () => {
    /** @type {any} */
    let seen;
    await captureLogs(() =>
        runPlansReadCommand(
            ["archived-id"],
            /** @type {any} */ ({
                __testDeps: {
                    loadPlan: () => Promise.resolve(null),
                    loadArchivedPlan: (/** @type {string} */ _cwd, /** @type {string} */ name) =>
                        name === "archived-match"
                            ? Promise.resolve({
                                name,
                                path: "/repo/plans/archived/archived-match.md",
                                markdown: "# Archived By ID",
                                attrs: {},
                                body: "# Archived By ID",
                            })
                            : Promise.resolve(null),
                    listArchivedPlans: () => Promise.resolve([{ name: "archived-match", planId: "archived-id" }]),
                    startArtifactReadSurface: fakeReadSurface((options) => seen = options),
                },
            }),
        )
    );

    assertEquals(seen.title, "plans/archived/archived-match.md");
    assertEquals(seen.markdown, "# Archived By ID");
});

Deno.test("read command opens active plans by plan id", async () => {
    /** @type {any} */
    let seen;
    await captureLogs(() =>
        runPlansReadCommand(
            ["active-id"],
            /** @type {any} */ ({
                __testDeps: {
                    loadPlan: () => Promise.resolve(null),
                    loadArchivedPlan: () => Promise.resolve(null),
                    listArchivedPlans: () => Promise.resolve([]),
                    findPlanById: () =>
                        Promise.resolve({
                            planName: "id-plan",
                            path: "/repo/plans/id-plan.md",
                            markdown: "# Active By ID",
                            attrs: {},
                        }),
                    startArtifactReadSurface: fakeReadSurface((options) => seen = options),
                },
            }),
        )
    );

    assertEquals(seen.title, "id-plan");
    assertEquals(seen.markdown, "# Active By ID");
});

Deno.test("read command reports duplicate archived plan ids", async () => {
    await assertRejects(
        () =>
            runPlansReadCommand(
                ["dup-id"],
                /** @type {any} */ ({
                    __testDeps: {
                        loadPlan: () => Promise.resolve(null),
                        loadArchivedPlan: () => Promise.resolve(null),
                        listArchivedPlans: () => Promise.resolve([{ planId: "dup-id" }, { planId: "dup-id" }]),
                    },
                }),
            ),
        Error,
        "Duplicate archived planId",
    );
});

Deno.test("read command --no-open suppresses browser launch and manual recovery", async () => {
    /** @type {any} */
    let seen;
    const logs = await captureLogs(() =>
        runPlansReadCommand(
            ["same", "--no-open"],
            /** @type {any} */ ({
                __testDeps: {
                    loadPlan: () =>
                        Promise.resolve({
                            path: "/repo/plans/same.md",
                            markdown: "# Active",
                            attrs: {},
                            body: "# Active",
                        }),
                    startArtifactReadSurface: (/** @type {any} */ options) => {
                        seen = options;
                        return Promise.resolve({
                            url: "http://127.0.0.1:1234/review/plan?token=test",
                            opened: false,
                            waitForDecision: () => Promise.resolve({ exit: true }),
                            stop: () => Promise.resolve(),
                        });
                    },
                },
            }),
        )
    );

    assertEquals(typeof seen.openInDefaultBrowser, "function");
    assertEquals(await seen.openInDefaultBrowser("http://127.0.0.1:1234"), false);
    assertEquals(logs.some((line) => line.includes("Could not open your browser automatically")), false);
});

Deno.test("read command prints manual URL recovery when browser opening fails", async () => {
    const logs = await captureLogs(() =>
        runPlansReadCommand(
            ["same"],
            /** @type {any} */ ({
                __testDeps: {
                    loadPlan: () =>
                        Promise.resolve({
                            path: "/repo/plans/same.md",
                            markdown: "# Active",
                            attrs: {},
                            body: "# Active",
                        }),
                    startArtifactReadSurface: () =>
                        Promise.resolve({
                            url: "http://127.0.0.1:1234/review/plan?token=test",
                            opened: false,
                            waitForDecision: () => Promise.resolve({ exit: true }),
                            stop: () => Promise.resolve(),
                        }),
                },
            }),
        )
    );
    assertEquals(logs.some((line) => line.includes("Could not open your browser automatically")), true);
});
