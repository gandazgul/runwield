import { assertEquals, assertRejects } from "@std/assert";
import { runPlansArchiveCommand } from "./archive.js";

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
 * @param {() => Promise<void>} fn
 * @returns {Promise<{ logs: string[], error: unknown }>}
 */
async function captureLogsAndError(fn) {
    /** @type {string[]} */
    const logs = [];
    const orig = console.log;
    console.log = (msg = "") => logs.push(String(msg));
    try {
        await fn();
        return { logs, error: undefined };
    } catch (error) {
        return { logs, error };
    } finally {
        console.log = orig;
    }
}

Deno.test("archive command lists archived plans when no target is provided", async () => {
    const logs = await captureLogs(() =>
        runPlansArchiveCommand(
            [],
            /** @type {any} */ ({
                __testDeps: {
                    listArchivedPlans: () =>
                        Promise.resolve([
                            {
                                name: "done",
                                planName: "done",
                                relativePath: "plans/archived/done.md",
                                path: "/repo/plans/archived/done.md",
                                status: "verified",
                                summary: "Done plan",
                                planId: "done-id",
                                attrs: { status: "verified", summary: "Done plan", archivedAt: "now" },
                            },
                        ]),
                },
            }),
        )
    );

    assertEquals(logs.some((line) => line.includes("Archived plans")), true);
    assertEquals(logs.some((line) => line.includes("done-id")), true);
});

Deno.test("archive command archives a target with reason and force", async () => {
    /** @type {any} */
    let call;
    const logs = await captureLogs(() =>
        runPlansArchiveCommand(
            ["draft", "--reason", "stale", "--force"],
            /** @type {any} */ ({
                __testDeps: {
                    archivePlan: (
                        /** @type {string} */ _cwd,
                        /** @type {string} */ target,
                        /** @type {{ reason?: string, force?: boolean }} */ options,
                    ) => {
                        call = { target, options };
                        return Promise.resolve({ relativePath: "plans/archived/draft.md" });
                    },
                },
            }),
        )
    );

    assertEquals(call, { target: "draft", options: { reason: "stale", force: true } });
    assertEquals(logs.some((line) => line.includes("plans/archived/draft.md")), true);
});

Deno.test("archive command restores an archived target with optional destination", async () => {
    /** @type {any} */
    let call;
    const logs = await captureLogs(() =>
        runPlansArchiveCommand(
            ["restore", "done-id", "--to", "done-restored"],
            /** @type {any} */ ({
                __testDeps: {
                    restoreArchivedPlan: (
                        /** @type {string} */ _cwd,
                        /** @type {string} */ target,
                        /** @type {{ to?: string }} */ options,
                    ) => {
                        call = { target, options };
                        return Promise.resolve({ relativePath: "plans/done-restored.md" });
                    },
                },
            }),
        )
    );

    assertEquals(call, { target: "done-id", options: { to: "done-restored" } });
    assertEquals(logs.some((line) => line.includes("Restored done-id")), true);
});

Deno.test("archive command reports missing restore target", async () => {
    await assertRejects(
        () => runPlansArchiveCommand(["restore"], /** @type {any} */ ({ __testDeps: {} })),
        Error,
        "Missing archived Plan name",
    );
});

Deno.test("archive command bulk archives matching status with reason and force", async () => {
    /** @type {any} */
    let call;
    const logs = await captureLogs(() =>
        runPlansArchiveCommand(
            ["--all", "--status", "verified", "--reason", "done", "--force"],
            /** @type {any} */ ({
                __testDeps: {
                    archivePlansByStatus: (
                        /** @type {string} */ _cwd,
                        /** @type {string} */ status,
                        /** @type {{ reason?: string, force?: boolean }} */ options,
                    ) => {
                        call = { status, options };
                        return Promise.resolve({
                            matched: [{ name: "done", relativePath: "plans/done.md" }],
                            archived: [{ name: "done", relativePath: "plans/archived/done.md" }],
                            failed: [],
                        });
                    },
                },
            }),
        )
    );

    assertEquals(call, { status: "verified", options: { reason: "done", force: true } });
    assertEquals(logs.some((line) => line.includes("Archived done to plans/archived/done.md")), true);
    assertEquals(logs.some((line) => line.includes("Archived 1/1 matching Plan(s); 0 failed")), true);
});

Deno.test("archive command prints no-op bulk archive summary", async () => {
    const logs = await captureLogs(() =>
        runPlansArchiveCommand(
            ["--all", "--status", "verified"],
            /** @type {any} */ ({
                __testDeps: {
                    archivePlansByStatus: () => Promise.resolve({ matched: [], archived: [], failed: [] }),
                },
            }),
        )
    );

    assertEquals(logs, ["[RunWield] No active Plans with status verified found."]);
});

Deno.test("archive command reports bulk failures and exits non-zero after best-effort successes", async () => {
    const { logs, error } = await captureLogsAndError(() =>
        runPlansArchiveCommand(
            ["--all", "--status", "verified"],
            /** @type {any} */ ({
                __testDeps: {
                    archivePlansByStatus: () =>
                        Promise.resolve({
                            matched: [
                                { name: "blocked", relativePath: "plans/blocked.md" },
                                { name: "ok", relativePath: "plans/ok.md" },
                            ],
                            archived: [{ name: "ok", relativePath: "plans/archived/ok.md" }],
                            failed: [{ name: "blocked", relativePath: "plans/blocked.md", message: "already exists" }],
                        }),
                },
            }),
        )
    );

    assertEquals(error instanceof Error ? error.message : String(error), "Bulk archive failed for 1 Plan(s).");
    assertEquals(logs.some((line) => line.includes("Archived ok to plans/archived/ok.md")), true);
    assertEquals(logs.some((line) => line.includes("Failed blocked (plans/blocked.md): already exists")), true);
});

Deno.test("archive command rejects invalid bulk archive argument combinations", async () => {
    await assertRejects(
        () => runPlansArchiveCommand(["--all"], /** @type {any} */ ({ __testDeps: {} })),
        Error,
        "Missing --status",
    );
    await assertRejects(
        () => runPlansArchiveCommand(["--status", "verified"], /** @type {any} */ ({ __testDeps: {} })),
        Error,
        "--status requires --all",
    );
    await assertRejects(
        () =>
            runPlansArchiveCommand(
                ["some-plan", "--all", "--status", "verified"],
                /** @type {any} */ ({ __testDeps: {} }),
            ),
        Error,
        "Unexpected archive argument with --all",
    );
    await assertRejects(
        () => runPlansArchiveCommand(["restore", "done", "--all"], /** @type {any} */ ({ __testDeps: {} })),
        Error,
        "Cannot use --all",
    );
    await assertRejects(
        () =>
            runPlansArchiveCommand(
                ["restore", "done", "--status", "verified"],
                /** @type {any} */ ({ __testDeps: {} }),
            ),
        Error,
        "Cannot use --status",
    );
});
