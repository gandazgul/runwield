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
