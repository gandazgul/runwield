import { assertEquals, assertRejects } from "@std/assert";
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

/** @type {any} */
const preview = {
    sources: [],
    eligible: [
        {
            sourceKind: "active",
            name: "feature",
            relativePath: "plans/feature.md",
            path: "/tmp/plans/feature.md",
            planId: "plan-feature",
            attrs: { classification: "FEATURE", status: "verified" },
            body: "# Feature",
            markdown: "# Feature",
            scope: "feature",
            completionMode: "verified",
        },
    ],
    skipped: [],
};

/**
 * @param {string[]} argv
 * @param {{ confirm?: boolean, run?: () => Promise<any> }} [options]
 */
async function captureBackfill(argv, options = {}) {
    /** @type {string[]} */
    const logs = [];
    const orig = console.log;
    let ran = false;
    console.log = (msg = "") => logs.push(String(msg));
    try {
        await runWorkRecordsCommand(argv, {
            __testDeps: {
                previewWorkRecordBackfill: () => Promise.resolve(preview),
                runWorkRecordBackfill: options.run || (() => {
                    ran = true;
                    return Promise.resolve({
                        ...preview,
                        outcomes: [{
                            source: preview.eligible[0],
                            status: "generated",
                            path: "docs/work-records/feature.md",
                        }],
                    });
                }),
                confirmBackfill: () => Boolean(options.confirm),
                printCommandHelp: () => {
                    logs.push("help");
                    return true;
                },
            },
        });
    } finally {
        console.log = orig;
    }
    return { output: logs.join("\n"), ran };
}

Deno.test("wld wr backfill --dry-run previews without generation", async () => {
    const result = await captureBackfill(["backfill", "--dry-run"], { confirm: true });

    assertEquals(result.output.includes("Work Record backfill preview"), true);
    assertEquals(result.output.includes("Dry run only"), true);
    assertEquals(result.ran, false);
});

Deno.test("wld wr backfill requires confirmation by default", async () => {
    const result = await captureBackfill(["backfill"], { confirm: false });

    assertEquals(result.output.includes("Backfill canceled"), true);
    assertEquals(result.ran, false);
});

Deno.test("wld wr backfill --yes runs generation", async () => {
    const result = await captureBackfill(["backfill", "--yes"]);

    assertEquals(result.output.includes("Generated feature"), true);
    assertEquals(result.ran, true);
});

Deno.test("wld wr backfill rejects conflicting confirmation flags", async () => {
    await assertRejects(
        () => captureBackfill(["backfill", "--yes", "--dry-run"]),
        Error,
        "Cannot combine --yes with --dry-run",
    );
});

Deno.test("wld wr search prints hydrated current-only results", async () => {
    /** @type {string[]} */
    const logs = [];
    const orig = console.log;
    console.log = (msg = "") => logs.push(String(msg));
    try {
        await runWorkRecordsCommand(["search", "current", "record"], {
            __testDeps: {
                searchWorkRecords: /** @type {any} */ ((
                    /** @type {string} */ _cwd,
                    /** @type {string} */ query,
                    /** @type {any} */ options,
                ) => Promise.resolve({
                    query,
                    accessMode: options.includeAll ? "all" : "current",
                    bootstrapped: false,
                    rebuild: null,
                    staleRecordIds: [],
                    records: [{
                        recordId: current.attrs.recordId,
                        title: current.title,
                        summary: "Full Summary Text",
                        status: "approved",
                        scope: "feature",
                        origin: "internal",
                        completionMode: "verified",
                        sourcePlans: ["plan-1"],
                        path: current.relativePath,
                        notices: [],
                        record: current,
                    }],
                })),
            },
        });
    } finally {
        console.log = orig;
    }
    const output = logs.join("\n");
    assertEquals(output.includes("Full Summary Text"), true);
    assertEquals(output.includes(current.attrs.recordId), true);
});

Deno.test("wld wr search --all passes broad visibility", async () => {
    let includeAll = false;
    /** @type {string[]} */
    const logs = [];
    const orig = console.log;
    console.log = (msg = "") => logs.push(String(msg));
    try {
        await runWorkRecordsCommand(["search", "history", "--all"], {
            __testDeps: {
                searchWorkRecords: /** @type {any} */ ((
                    /** @type {string} */ _cwd,
                    /** @type {string} */ query,
                    /** @type {any} */ options,
                ) => {
                    includeAll = Boolean(options.includeAll);
                    return Promise.resolve({
                        query,
                        accessMode: "all",
                        bootstrapped: false,
                        rebuild: null,
                        staleRecordIds: [],
                        records: [],
                    });
                }),
            },
        });
    } finally {
        console.log = orig;
    }
    assertEquals(includeAll, true);
});

Deno.test("wld wr read opens canonical markdown and notices in browser read surface", async () => {
    /** @type {string[]} */
    const logs = [];
    /** @type {any} */
    let seen;
    const orig = console.log;
    console.log = (msg = "") => logs.push(String(msg));
    try {
        await runWorkRecordsCommand(["read", current.attrs.recordId], {
            __testDeps: {
                readWorkRecordById: /** @type {any} */ ((
                    /** @type {string} */ _cwd,
                    /** @type {string} */ recordId,
                    /** @type {any} */ options,
                ) => Promise.resolve({
                    accessMode: options.accessMode,
                    recordId,
                    title: current.title,
                    summary: current.summary,
                    status: "approved",
                    scope: "feature",
                    origin: "internal",
                    completionMode: "verified",
                    sourcePlans: ["plan-1"],
                    path: current.relativePath,
                    notices: ["NOTICE: canonical"],
                    body: "# Current Record\n\n## Summary\n\nCurrent body",
                    markdown: "---\nrecordId: test\n---\n# Current Record\n\n## Summary\n\nCurrent body",
                    record: current,
                })),
                startArtifactReadSurface: /** @type {any} */ ((/** @type {any} */ options) => {
                    seen = options;
                    return Promise.resolve({
                        url: "http://127.0.0.1:1234/review/plan?token=test",
                        opened: true,
                        waitForDecision: () => Promise.resolve({ exit: true }),
                        stop: () => Promise.resolve(),
                    });
                }),
            },
        });
    } finally {
        console.log = orig;
    }
    const output = logs.join("\n");
    assertEquals(output.includes("Work Record read-only view"), true);
    assertEquals(seen.artifactKind, "work-record");
    assertEquals(seen.title, current.title);
    assertEquals(seen.path, current.relativePath);
    assertEquals(seen.notices, ["NOTICE: canonical"]);
    assertEquals(seen.markdown.includes("Current body"), true);
});

Deno.test("wld wr index rebuild prints counts", async () => {
    /** @type {string[]} */
    const logs = [];
    const orig = console.log;
    console.log = (msg = "") => logs.push(String(msg));
    try {
        await runWorkRecordsCommand(["index", "rebuild"], {
            __testDeps: {
                rebuildWorkRecordIndex: () =>
                    Promise.resolve({
                        collection: "repo:work-records",
                        total: 2,
                        added: 2,
                        failed: 0,
                        failures: [],
                    }),
            },
        });
    } finally {
        console.log = orig;
    }
    const output = logs.join("\n");
    assertEquals(output.includes("repo:work-records"), true);
    assertEquals(output.includes("indexed: 2"), true);
});

Deno.test("wld wr read prints manual URL recovery when browser opening fails", async () => {
    /** @type {string[]} */
    const logs = [];
    const orig = console.log;
    console.log = (msg = "") => logs.push(String(msg));
    try {
        await runWorkRecordsCommand(["read", current.attrs.recordId], {
            __testDeps: {
                readWorkRecordById: /** @type {any} */ (() =>
                    Promise.resolve({
                        title: current.title,
                        path: current.relativePath,
                        notices: [],
                        markdown: "# Current Record",
                    })),
                startArtifactReadSurface: () =>
                    Promise.resolve({
                        url: "http://127.0.0.1:1234/review/plan?token=test",
                        opened: false,
                        waitForDecision: () => Promise.resolve({ exit: true }),
                        stop: () => Promise.resolve(),
                    }),
            },
        });
    } finally {
        console.log = orig;
    }
    assertEquals(logs.some((line) => line.includes("Could not open your browser automatically")), true);
});

Deno.test("wld wr read validates exactly one recordId", async () => {
    await assertRejects(() => capture(["read"]), Error, "Usage: wld wr read <recordId>");
    await assertRejects(() => capture(["read", "a", "b"]), Error, "Usage: wld wr read <recordId>");
});

Deno.test("wld wr read rejects unsupported --all flag", async () => {
    await assertRejects(
        () => capture(["read", current.attrs.recordId, "--all"]),
        Error,
        "Unsupported flag: --all",
    );
});

Deno.test("wld wr index rebuild rejects unsupported --all flag", async () => {
    await assertRejects(
        () =>
            runWorkRecordsCommand(["index", "rebuild", "--all"], {
                __testDeps: {
                    rebuildWorkRecordIndex: () =>
                        Promise.resolve({
                            collection: "repo:work-records",
                            total: 0,
                            added: 0,
                            failed: 0,
                            failures: [],
                        }),
                },
            }),
        Error,
        "Unsupported flag: --all",
    );
});
