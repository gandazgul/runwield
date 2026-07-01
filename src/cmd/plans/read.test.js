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

Deno.test("read command prints active plans before archived duplicates", async () => {
    const logs = await captureLogs(() =>
        runPlansReadCommand(
            ["same"],
            /** @type {any} */ ({
                __testDeps: {
                    loadPlan: () =>
                        Promise.resolve({
                            path: "/repo/plans/same.md",
                            attrs: { status: "draft", classification: "FEATURE", complexity: "LOW", summary: "Active" },
                            body: "# Active",
                        }),
                    loadArchivedPlan: () => {
                        throw new Error("should not read archive");
                    },
                },
            }),
        )
    );

    assertEquals(logs.some((line) => line.includes("Path: /repo/plans/same.md")), true);
    assertEquals(logs.some((line) => line.includes("# Active")), true);
});

Deno.test("read command prints archived plans when explicitly addressed", async () => {
    const logs = await captureLogs(() =>
        runPlansReadCommand(
            ["archived/same"],
            /** @type {any} */ ({
                __testDeps: {
                    loadPlan: () => Promise.resolve(null),
                    loadArchivedPlan: () =>
                        Promise.resolve({
                            name: "same",
                            path: "/repo/plans/archived/same.md",
                            attrs: {
                                status: "verified",
                                classification: "FEATURE",
                                complexity: "MEDIUM",
                                summary: "Archived",
                                archivedAt: "now",
                            },
                            body: "# Archived",
                        }),
                },
            }),
        )
    );

    assertEquals(logs.some((line) => line.includes("plans/archived/same.md")), true);
    assertEquals(logs.some((line) => line.includes("Archived: now")), true);
    assertEquals(logs.some((line) => line.includes("# Archived")), true);
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
