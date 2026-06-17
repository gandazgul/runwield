import { assertEquals } from "@std/assert";
import { runPlansCommand } from "./index.js";

/**
 * @param {Array<{ name: string, path: string, attrs: any }>} plans
 * @returns {Promise<string[]>}
 */
async function capturePlansOutput(plans) {
    /** @type {string[]} */
    const logs = [];
    const orig = console.log;
    console.log = (msg = "") => logs.push(String(msg));
    try {
        await runPlansCommand(
            [],
            /** @type {any} */ ({
                __testDeps: {
                    listPlans: () => Promise.resolve(plans),
                },
            }),
        );
    } finally {
        console.log = orig;
    }
    return logs;
}

Deno.test("runPlansCommand help path", async () => {
    let helped = false;

    await runPlansCommand(
        ["--help"],
        /** @type {any} */ ({
            __testDeps: {
                printCommandHelp: () => {
                    helped = true;
                    return true;
                },
            },
        }),
    );

    assertEquals(helped, true);
});

Deno.test("runPlansCommand no plans", async () => {
    const logs = await capturePlansOutput([]);

    assertEquals(logs.some((m) => m.includes("No saved plans found")), true);
});

Deno.test("runPlansCommand prints plan entries", async () => {
    const logs = await capturePlansOutput([
        {
            name: "p1",
            path: "plans/p1.md",
            attrs: {
                status: "draft",
                classification: "FEATURE",
                complexity: "MEDIUM",
                summary: "test",
                createdAt: "now",
            },
        },
    ]);

    assertEquals(logs.some((m) => m.includes("p1")), true);
});

Deno.test("runPlansCommand prints one Epic with child FEATURE hierarchy and verified progress", async () => {
    const logs = await capturePlansOutput([
        {
            name: "big-project",
            path: "plans/big-project.md",
            attrs: {
                status: "ready_for_work",
                classification: "PROJECT",
                type: "epic",
                complexity: "HIGH",
                summary: "Large project",
                createdAt: "now",
            },
        },
        {
            name: "big-project/01-first",
            path: "plans/big-project/01-first.md",
            attrs: {
                status: "verified",
                classification: "FEATURE",
                complexity: "MEDIUM",
                summary: "First child",
                createdAt: "now",
                parentPlan: "big-project",
                worktreeStatus: "merged",
                worktreeBranch: "feature/first",
            },
        },
        {
            name: "big-project/02-second",
            path: "plans/big-project/02-second.md",
            attrs: {
                status: "implemented",
                classification: "FEATURE",
                complexity: "LOW",
                summary: "Second child",
                createdAt: "now",
                parentPlan: "big-project",
            },
        },
    ]);

    assertEquals(logs.some((m) => m.includes("Epics:")), true);
    assertEquals(logs.some((m) => m.includes("big-project")), true);
    assertEquals(logs.some((m) => m.includes("Progress: 1/2 features verified")), true);
    assertEquals(logs.some((m) => m.includes("- big-project/01-first")), true);
    assertEquals(logs.some((m) => m.includes("Worktree: merged (feature/first)")), true);
});

Deno.test("runPlansCommand marks done-enough Epic while keeping remaining child progress visible", async () => {
    const logs = await capturePlansOutput([
        {
            name: "done-enough-epic",
            path: "plans/done-enough-epic.md",
            attrs: {
                status: "verified",
                classification: "PROJECT",
                type: "epic",
                complexity: "HIGH",
                summary: "Large project",
                createdAt: "now",
                epicCompletionMode: "done_enough",
                epicDoneEnoughSummary: "Done enough: 1/3 verified.",
            },
        },
        {
            name: "done-enough-epic/01-first",
            path: "plans/done-enough-epic/01-first.md",
            attrs: {
                status: "verified",
                classification: "FEATURE",
                complexity: "MEDIUM",
                summary: "First child",
                createdAt: "now",
                parentPlan: "done-enough-epic",
            },
        },
        {
            name: "done-enough-epic/02-second",
            path: "plans/done-enough-epic/02-second.md",
            attrs: {
                status: "approved",
                classification: "FEATURE",
                complexity: "LOW",
                summary: "Second child",
                createdAt: "now",
                parentPlan: "done-enough-epic",
            },
        },
        {
            name: "done-enough-epic/03-third",
            path: "plans/done-enough-epic/03-third.md",
            attrs: {
                status: "draft",
                classification: "FEATURE",
                complexity: "LOW",
                summary: "Third child",
                createdAt: "now",
                parentPlan: "done-enough-epic",
            },
        },
    ]);

    assertEquals(
        logs.some((m) => m.includes("Progress: 1/3 features verified") && m.includes("done enough for now")),
        true,
    );
    assertEquals(logs.some((m) => m.includes("Done enough: Done enough: 1/3 verified.")), true);
    assertEquals(logs.some((m) => m.includes("- done-enough-epic/02-second")), true);
});

Deno.test("runPlansCommand keeps orphan child FEATURE plans visible", async () => {
    const logs = await capturePlansOutput([
        {
            name: "missing-parent/01-orphan",
            path: "plans/missing-parent/01-orphan.md",
            attrs: {
                status: "draft",
                classification: "FEATURE",
                complexity: "MEDIUM",
                summary: "Orphan child",
                createdAt: "now",
                parentPlan: "missing-parent",
            },
        },
    ]);

    assertEquals(logs.some((m) => m.includes("Orphaned child plans:")), true);
    assertEquals(logs.some((m) => m.includes("missing-parent/01-orphan")), true);
});

Deno.test("runPlansCommand renders standalone FEATURE plans separately", async () => {
    const logs = await capturePlansOutput([
        {
            name: "standalone-feature",
            path: "plans/standalone-feature.md",
            attrs: {
                status: "approved",
                classification: "FEATURE",
                complexity: "LOW",
                summary: "Standalone slice",
                createdAt: "now",
            },
        },
    ]);

    assertEquals(logs.some((m) => m.includes("Standalone plans:")), true);
    assertEquals(logs.some((m) => m.includes("standalone-feature")), true);
});
