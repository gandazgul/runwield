import { assertEquals } from "@std/assert";
import { runWorkRecordsCommand } from "./index.js";

const current = {
    title: "Current Record",
    summary: "Current.",
    relativePath: "docs/work-records/current.md",
    path: "/tmp/docs/work-records/current.md",
    body: "",
    markdown: "",
    sections: {},
    attrs: {
        kind: "work_record",
        recordId: "11111111-1111-4111-8111-111111111111",
        status: "approved",
        scope: "feature",
        origin: "internal",
        completionMode: "verified",
        createdAt: "2026-07-14T00:00:00.000Z",
        provenance: { sourcePlans: ["plan-1"] },
    },
};

const archived = {
    ...current,
    title: "Archived Record",
    relativePath: "docs/work-records/archived.md",
    attrs: {
        ...current.attrs,
        recordId: "22222222-2222-4222-8222-222222222222",
        archivedAt: "2026-07-15T00:00:00.000Z",
    },
};

/**
 * @param {string[]} argv
 * @param {any[]} [records]
 */
async function capture(argv, records = [current, archived]) {
    /** @type {string[]} */
    const logs = [];
    const orig = console.log;
    console.log = (msg = "") => logs.push(String(msg));
    try {
        await runWorkRecordsCommand(argv, {
            __testDeps: {
                listWorkRecords: () => Promise.resolve(records),
                printCommandHelp: () => {
                    logs.push("help");
                    return true;
                },
            },
        });
    } finally {
        console.log = orig;
    }
    return logs.join("\n");
}

Deno.test("wld wr defaults to current Work Record listing", async () => {
    const output = await capture([]);

    assertEquals(output.includes("Current Record"), true);
    assertEquals(output.includes("Archived Record"), false);
    assertEquals(output.includes("completionMode: verified"), true);
    assertEquals(output.includes("sourcePlans: plan-1"), true);
});

Deno.test("wld wr list --all includes non-current records with warnings", async () => {
    const output = await capture(["list", "--all"]);

    assertEquals(output.includes("Archived Record"), true);
    assertEquals(output.includes("WARNING: archived at 2026-07-15T00:00:00.000Z."), true);
});

Deno.test("wld wr --help prints command help", async () => {
    const output = await capture(["--help"]);

    assertEquals(output.includes("help"), true);
});
