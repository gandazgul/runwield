import { assertEquals } from "@std/assert";
import { runPlansCommand } from "./index.js";

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
    /** @type {string[]} */
    const logs = [];
    const orig = console.log;
    console.log = (msg = "") => logs.push(String(msg));
    try {
        await runPlansCommand(
            [],
            /** @type {any} */ ({
                __testDeps: {
                    listPlans: () => Promise.resolve([]),
                },
            }),
        );
    } finally {
        console.log = orig;
    }

    assertEquals(logs.some((m) => m.includes("No saved plans found")), true);
});

Deno.test("runPlansCommand prints plan entries", async () => {
    /** @type {string[]} */
    const logs = [];
    const orig = console.log;
    console.log = (msg = "") => logs.push(String(msg));
    try {
        await runPlansCommand(
            [],
            /** @type {any} */ ({
                __testDeps: {
                    listPlans: () =>
                        Promise.resolve([
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
                        ]),
                },
            }),
        );
    } finally {
        console.log = orig;
    }

    assertEquals(logs.some((m) => m.includes("p1")), true);
});
