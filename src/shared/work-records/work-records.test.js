import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import {
    archiveWorkRecord,
    autoGenerateWorkRecordForCompletedPlan,
    buildWorkRecordFileName,
    buildWorkRecordIndexDocument,
    buildWorkRecordIndexTags,
    filterWorkRecordsForList,
    findWorkRecordById,
    formatHydratedWorkRecord,
    formatWorkRecordList,
    formatWorkRecordMarkdown,
    generateRecorderSections,
    generateWorkRecordForSource,
    getWorkRecordIndexCollectionName,
    isWorkRecordIndexEmpty,
    parseRecorderSections,
    parseWorkRecordMarkdown,
    previewWorkRecordBackfill,
    readWorkRecordById,
    rebuildWorkRecordIndex,
    restoreWorkRecord,
    runWorkRecordBackfill,
    searchWorkRecords,
    supersedeWorkRecord,
    syncWorkRecordToIndex,
    writeWorkRecord,
} from "./index.js";
import { archivePlan, loadArchivedPlan, loadPlan, savePlan } from "../../plan-store.js";

/** @type {import('./schema.js').WorkRecordFrontMatter} */
const INTERNAL_ATTRS = {
    kind: "work_record",
    recordId: "11111111-1111-4111-8111-111111111111",
    status: "approved",
    scope: "feature",
    origin: "internal",
    completionMode: "verified",
    createdAt: "2026-07-14T08:32:00-04:00",
    provenance: { sourcePlans: ["22222222-2222-4222-8222-222222222222"] },
};

const BODY =
    `# Example Work\n\n## Summary\n\nBuilt the durable store.\n\n## Future Planning Notes\n\nReuse this pattern.`;

/** @param {string} stdout */
function ok(stdout) {
    return { success: true, code: 0, stdout: new TextEncoder().encode(stdout), stderr: new Uint8Array() };
}

/**
 * @param {string} cwd
 * @param {string[]} args
 */
async function git(cwd, args) {
    const result = await new Deno.Command("git", {
        args,
        cwd,
        stdout: "piped",
        stderr: "piped",
    }).output();
    if (result.code !== 0) {
        const decoder = new TextDecoder();
        throw new Error(
            `git ${args.join(" ")} failed: ${decoder.decode(result.stderr) || decoder.decode(result.stdout)}`,
        );
    }
    return new TextDecoder().decode(result.stdout).trim();
}

Deno.test("Work Record markdown parses nested provenance and body sections", () => {
    const markdown = formatWorkRecordMarkdown({
        ...INTERNAL_ATTRS,
        provenance: {
            sourcePlans: ["22222222-2222-4222-8222-222222222222"],
            evidence: [{ path: "src/example.js", note: "Shows the stable seam." }],
        },
    }, BODY);

    const record = parseWorkRecordMarkdown(markdown, { relativePath: "docs/work-records/example.md" });

    assertEquals(record.title, "Example Work");
    assertEquals(record.summary, "Built the durable store.");
    assertEquals(record.sections["Future Planning Notes"], "Reuse this pattern.");
    assertEquals(record.attrs.provenance?.evidence?.[0].path, "src/example.js");
    assertStringIncludes(markdown, "provenance:\n    sourcePlans:");
    assertStringIncludes(markdown, "    evidence:\n        - path:");
});

Deno.test("Work Record validation rejects missing required fields", () => {
    assertThrows(
        () => parseWorkRecordMarkdown(`---\nkind: work_record\n---\n# Missing\n\n## Summary\n\nNo metadata.`),
        Error,
        "recordId must be a plain UUID",
    );
    assertThrows(
        () =>
            parseWorkRecordMarkdown(
                formatWorkRecordMarkdown(/** @type {any} */ ({ ...INTERNAL_ATTRS, provenance: undefined }), BODY),
            ),
        Error,
        "provenance.sourcePlans is required",
    );
});

Deno.test("Work Record validation reports malformed provenance evidence entries", () => {
    assertThrows(
        () =>
            parseWorkRecordMarkdown(
                formatWorkRecordMarkdown(
                    /** @type {any} */ ({
                        ...INTERNAL_ATTRS,
                        provenance: {
                            sourcePlans: ["22222222-2222-4222-8222-222222222222"],
                            evidence: [{ path: "src/example.js" }],
                        },
                    }),
                    BODY,
                ),
            ),
        Error,
        "provenance.evidence entries require path and note",
    );
});

Deno.test("Work Record formatting omits empty optional provenance fields", () => {
    const markdown = formatWorkRecordMarkdown({
        ...INTERNAL_ATTRS,
        origin: "external",
        provenance: { sourcePlans: [], evidence: [] },
    }, BODY);

    assertEquals(markdown.includes("provenance:"), false);
});

Deno.test("Work Record store writes flat files and resolves by recordId", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        const written = await writeWorkRecord(cwd, INTERNAL_ATTRS, BODY, { fileName: "2026-07-14-example.md" });
        assertEquals(written.relativePath, "docs/work-records/2026-07-14-example.md");
        const found = await findWorkRecordById(cwd, INTERNAL_ATTRS.recordId);
        assertEquals(found?.title, "Example Work");
        await assertRejects(
            () => writeWorkRecord(cwd, INTERNAL_ATTRS, BODY, { fileName: "../escape.md" }),
            Error,
            "flat Markdown filename",
        );
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Work Record lifecycle helpers update final state fields only", () => {
    const archived = archiveWorkRecord(INTERNAL_ATTRS, { now: "2026-07-15T00:00:00.000Z" });
    assertEquals(archived.archivedAt, "2026-07-15T00:00:00.000Z");
    assertEquals(restoreWorkRecord(archived).archivedAt, undefined);
    assertEquals(supersedeWorkRecord(INTERNAL_ATTRS, "33333333-3333-4333-8333-333333333333").status, "superseded");
});

Deno.test("Work Record list defaults to current records and warns on all records", () => {
    const current = parseWorkRecordMarkdown(formatWorkRecordMarkdown(INTERNAL_ATTRS, BODY), {
        relativePath: "docs/work-records/current.md",
    });
    const archived = parseWorkRecordMarkdown(
        formatWorkRecordMarkdown({
            ...INTERNAL_ATTRS,
            recordId: "33333333-3333-4333-8333-333333333333",
            archivedAt: "2026-07-15T00:00:00.000Z",
        }, BODY),
        { relativePath: "docs/work-records/archived.md" },
    );
    const superseded = parseWorkRecordMarkdown(
        formatWorkRecordMarkdown({
            ...INTERNAL_ATTRS,
            recordId: "44444444-4444-4444-8444-444444444444",
            supersededBy: "55555555-5555-4555-8555-555555555555",
        }, BODY),
        { relativePath: "docs/work-records/superseded.md" },
    );

    assertEquals(filterWorkRecordsForList([archived, superseded, current]).map((record) => record.attrs.recordId), [
        INTERNAL_ATTRS.recordId,
    ]);
    const output = formatWorkRecordList([archived, superseded, current], { includeAll: true });
    assertStringIncludes(output, "completionMode: verified");
    assertStringIncludes(output, "WARNING: archived at 2026-07-15T00:00:00.000Z.");
    assertStringIncludes(output, "WARNING: superseded by 55555555-5555-4555-8555-555555555555.");
});

Deno.test("Work Record path slug uses date-prefixed flat markdown filenames", () => {
    assertEquals(
        buildWorkRecordFileName("Durable Store!", new Date("2026-07-14T08:32:00-04:00")),
        "2026-07-14-durable-store.md",
    );
});

Deno.test("Recorder structured output parses JSON and rejects empty sections", () => {
    assertEquals(parseRecorderSections('{"title":"Outcome","summary":"Completed."}'), {
        title: "Outcome",
        summary: "Completed.",
    });
    assertThrows(
        () => parseRecorderSections('{"title":"Outcome","summary":""}'),
        Error,
        "non-empty summary",
    );
});

Deno.test("default Recorder generation invokes the Recorder prompt boundary", async () => {
    /** @type {string[]} */
    const prompts = [];
    const sections = await generateRecorderSections("/tmp/project", {
        sourceKind: "active",
        name: "feature",
        relativePath: "plans/feature.md",
        path: "/tmp/project/plans/feature.md",
        planId: "plan-feature",
        attrs: /** @type {any} */ ({ classification: "FEATURE", status: "verified", summary: "Feature." }),
        body: "# Feature\n\n## Plan\n\nBody",
        markdown: "",
        scope: "feature",
        completionMode: "verified",
    }, {
        runRecorderPrompt: (prompt) => {
            prompts.push(prompt);
            return Promise.resolve('{"title":"Feature Outcome","summary":"Completed through Recorder."}');
        },
    });

    assertEquals(sections.title, "Feature Outcome");
    assertEquals(prompts.length, 1);
    assertStringIncludes(prompts[0], "Generate a concise Work Record body draft");
});

Deno.test("Work Record backfill previews eligible sources, child skips, and existing record links", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "standalone", "# Standalone\n\n## Plan\n\nBody", {
            planId: "plan-standalone",
            classification: "FEATURE",
            complexity: "LOW",
            summary: "Built standalone feature.",
            affectedPaths: [],
            createdAt: "2026-07-14T00:00:00.000Z",
            status: "verified",
        });
        await savePlan(cwd, "already-recorded", "# Already\n\n## Plan\n\nBody", {
            planId: "plan-existing",
            classification: "FEATURE",
            complexity: "LOW",
            summary: "Existing record.",
            affectedPaths: [],
            createdAt: "2026-07-14T00:00:00.000Z",
            status: "verified",
        });
        await savePlan(cwd, "epic", "# Epic\n\n## Plan\n\nBody", {
            planId: "plan-epic",
            classification: "PROJECT",
            complexity: "MEDIUM",
            summary: "Epic complete enough.",
            affectedPaths: [],
            createdAt: "2026-07-14T00:00:00.000Z",
            status: "verified",
            epicCompletionMode: "done_enough",
        });
        await savePlan(cwd, "epic/01-child", "# Child\n\n## Plan\n\nBody", {
            planId: "plan-child",
            classification: "FEATURE",
            complexity: "LOW",
            summary: "Child feature.",
            affectedPaths: [],
            createdAt: "2026-07-14T00:00:00.000Z",
            status: "verified",
            parentPlan: "epic",
            order: 1,
        });
        await writeWorkRecord(
            cwd,
            {
                ...INTERNAL_ATTRS,
                recordId: "33333333-3333-4333-8333-333333333333",
                provenance: { sourcePlans: ["plan-existing"] },
            },
            "# Already\n\n## Summary\n\nAlready generated.",
            { fileName: "2026-07-14-already.md" },
        );

        const preview = await previewWorkRecordBackfill(cwd);

        assertEquals(preview.eligible.map((source) => source.name).sort(), ["already-recorded", "epic", "standalone"]);
        assertEquals(
            preview.eligible.find((source) => source.name === "already-recorded")?.existingRecord?.attrs.recordId,
            "33333333-3333-4333-8333-333333333333",
        );
        assertEquals(preview.eligible.find((source) => source.name === "epic")?.children?.map((child) => child.name), [
            "epic/01-child",
        ]);
        assertEquals(preview.skipped.find((source) => source.name === "epic/01-child")?.skipReason, "child_feature");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Work Record generation writes a record and active Plan backlink", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "standalone", "# Standalone\n\n## Plan\n\nBody", {
            planId: "plan-standalone",
            classification: "FEATURE",
            complexity: "LOW",
            summary: "Built standalone feature.",
            affectedPaths: [],
            createdAt: "2026-07-14T00:00:00.000Z",
            status: "verified",
        });
        const preview = await previewWorkRecordBackfill(cwd);
        const outcome = await generateWorkRecordForSource(cwd, preview.eligible[0], {
            idGenerator: () => "44444444-4444-4444-8444-444444444444",
            now: () => new Date("2026-07-16T00:00:00.000Z"),
            generateSections: () => ({
                title: "Standalone Outcome",
                summary: "Completed the standalone feature.",
                futurePlanningNotes: "Reuse this seam.",
            }),
        });

        assertEquals(outcome.status, "generated");
        const record = await findWorkRecordById(cwd, "44444444-4444-4444-8444-444444444444");
        assertEquals(record?.attrs.provenance?.sourcePlans, ["plan-standalone"]);
        const plan = await loadPlan(cwd, "standalone");
        assertEquals(plan?.attrs.workRecord?.recordId, "44444444-4444-4444-8444-444444444444");
        assertEquals(plan?.attrs.status, "verified");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("targeted Work Record auto-generation writes standalone FEATURE records", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "standalone", "# Standalone\n\n## Plan\n\nBody", {
            planId: "plan-standalone",
            classification: "FEATURE",
            complexity: "LOW",
            summary: "Built standalone feature.",
            affectedPaths: [],
            createdAt: "2026-07-14T00:00:00.000Z",
            status: "verified",
        });

        const result = await autoGenerateWorkRecordForCompletedPlan({
            cwd,
            planName: "standalone",
            generationOptions: {
                idGenerator: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                now: () => new Date("2026-07-16T00:00:00.000Z"),
                generateSections: () => ({ title: "Standalone Outcome", summary: "Completed." }),
            },
        });

        assertEquals(result.status, "generated");
        assertEquals(result.path, "docs/work-records/2026-07-16-standalone-outcome.md");
        assertStringIncludes(result.message, "Work Record generated");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("targeted Work Record auto-generation resolves child FEATURE to terminal parent Epic", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "epic", "# Epic\n\n## Plan\n\nBody", {
            planId: "plan-epic",
            classification: "PROJECT",
            complexity: "MEDIUM",
            summary: "Epic complete enough.",
            affectedPaths: [],
            createdAt: "2026-07-14T00:00:00.000Z",
            status: "verified",
            epicCompletionMode: "done_enough",
        });
        await savePlan(cwd, "epic/01-child", "# Child\n\n## Plan\n\nBody", {
            planId: "plan-child",
            classification: "FEATURE",
            complexity: "LOW",
            summary: "Child feature.",
            affectedPaths: [],
            createdAt: "2026-07-14T00:00:00.000Z",
            status: "verified",
            parentPlan: "epic",
            order: 1,
        });

        const result = await autoGenerateWorkRecordForCompletedPlan({
            cwd,
            planName: "epic/01-child",
            generationOptions: {
                idGenerator: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                now: () => new Date("2026-07-16T00:00:00.000Z"),
                generateSections: (source) => ({ title: "Epic Outcome", summary: `${source.children?.length} child.` }),
            },
        });

        assertEquals(result.status, "generated");
        assertEquals(result.targetPlanName, "epic");
        assertEquals((await loadPlan(cwd, "epic/01-child"))?.attrs.workRecord, undefined);
        assertEquals((await loadPlan(cwd, "epic"))?.attrs.workRecord?.recordId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("targeted Work Record auto-generation skips non-terminal child parent and honors disabled setting", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "epic", "# Epic\n\n## Plan\n\nBody", {
            planId: "plan-epic",
            classification: "PROJECT",
            complexity: "MEDIUM",
            summary: "Epic incomplete.",
            affectedPaths: [],
            createdAt: "2026-07-14T00:00:00.000Z",
            status: "ready_for_work",
        });
        await savePlan(cwd, "epic/01-child", "# Child\n\n## Plan\n\nBody", {
            planId: "plan-child",
            classification: "FEATURE",
            complexity: "LOW",
            summary: "Child feature.",
            affectedPaths: [],
            createdAt: "2026-07-14T00:00:00.000Z",
            status: "verified",
            parentPlan: "epic",
            order: 1,
        });

        const skipped = await autoGenerateWorkRecordForCompletedPlan({ cwd, planName: "epic/01-child" });
        assertEquals(skipped.status, "skipped");
        assertEquals(skipped.reason, "parent_not_terminal");

        const disabled = await autoGenerateWorkRecordForCompletedPlan({
            cwd,
            planName: "epic",
            __deps: { shouldAutoGenerate: () => false },
        });
        assertEquals(disabled.status, "disabled");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("targeted Work Record auto-generation reports generation failures without throwing", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "standalone", "# Standalone\n\n## Plan\n\nBody", {
            planId: "plan-standalone",
            classification: "FEATURE",
            complexity: "LOW",
            summary: "Built standalone feature.",
            affectedPaths: [],
            createdAt: "2026-07-14T00:00:00.000Z",
            status: "verified",
        });

        const result = await autoGenerateWorkRecordForCompletedPlan({
            cwd,
            planName: "standalone",
            __deps: {
                generateWorkRecordForSource: (_cwd, source) =>
                    Promise.resolve({ source, status: "failed", error: "Recorder unavailable" }),
            },
        });

        assertEquals(result.status, "failed");
        assertStringIncludes(result.message, "run wld wr backfill");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Work Record generation includes the task completion report", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        const executionReport = "- Implemented the settings save action.\n- Verification passed: deno task ci.";
        await savePlan(cwd, "reported", "# Reported\n\n## Plan\n\nBody", {
            planId: "plan-reported",
            classification: "FEATURE",
            complexity: "LOW",
            summary: "Built reported feature.",
            affectedPaths: [],
            createdAt: "2026-07-14T00:00:00.000Z",
            status: "verified",
            executionReport,
        });
        const preview = await previewWorkRecordBackfill(cwd);
        const outcome = await generateWorkRecordForSource(cwd, preview.eligible[0], {
            idGenerator: () => "77777777-7777-4777-8777-777777777777",
            now: () => new Date("2026-07-16T00:00:00.000Z"),
            generateSections: (source) => ({
                title: "Reported Outcome",
                summary: `Completed with evidence: ${source.executionReport}`,
            }),
        });

        assertEquals(outcome.status, "generated");
        const record = await findWorkRecordById(cwd, "77777777-7777-4777-8777-777777777777");
        assertStringIncludes(record?.summary || "", "Completed with evidence");
        assertStringIncludes(record?.sections["Execution Report"] || "", "Implemented the settings save action.");
        assertStringIncludes(record?.sections["Execution Report"] || "", "Verification passed: deno task ci.");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Work Record recorder prompt includes the task completion report as source material", async () => {
    /** @type {import('./generation.js').WorkRecordSource} */
    const source = {
        sourceKind: "active",
        name: "reported",
        relativePath: "plans/reported.md",
        path: "/tmp/reported.md",
        planId: "plan-reported",
        scope: "feature",
        completionMode: "verified",
        executionReport: "- Implemented.\n- Verified.",
        attrs: {
            planId: "plan-reported",
            classification: "FEATURE",
            complexity: "LOW",
            summary: "Reported feature.",
            affectedPaths: [],
            createdAt: "2026-07-14T00:00:00.000Z",
            status: "verified",
            executionReport: "- Implemented.\n- Verified.",
        },
        body: "# Reported\n\n## Plan\n\nBody",
        markdown: "# Reported\n\n## Plan\n\nBody",
    };
    let prompt = "";

    const sections = await generateRecorderSections(Deno.cwd(), source, {
        runRecorderPrompt: (value) => {
            prompt = value;
            return Promise.resolve(JSON.stringify({ title: "Reported", summary: "Distilled the execution report." }));
        },
    });

    assertEquals(sections.summary, "Distilled the execution report.");
    assertStringIncludes(prompt, '"executionReport": "- Implemented.\\n- Verified."');
    assertStringIncludes(prompt, "Distill executionReport facts");
});

Deno.test("Work Record generation discloses skipped verification reason fallback", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "closed", "# Closed\n\n## Plan\n\nBody", {
            planId: "plan-closed",
            classification: "FEATURE",
            complexity: "LOW",
            summary: "Closed work.",
            affectedPaths: [],
            createdAt: "2026-07-14T00:00:00.000Z",
            status: "closed_without_verification",
        });
        const result = await runWorkRecordBackfill(cwd, {
            idGenerator: () => "55555555-5555-4555-8555-555555555555",
            now: () => new Date("2026-07-16T00:00:00.000Z"),
            generateSections: () => ({ title: "Closed", summary: "Implemented and accepted manually." }),
        });

        assertEquals(result.outcomes[0].status, "generated");
        const record = await findWorkRecordById(cwd, "55555555-5555-4555-8555-555555555555");
        assertStringIncludes(record?.summary || "", "RunWield Workflow Validation was skipped");
        assertStringIncludes(record?.summary || "", "Reason not specified.");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Work Record backfill updates archived Plan backlinks", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "archived-source", "# Archived Source\n\n## Plan\n\nBody", {
            planId: "plan-archived",
            classification: "FEATURE",
            complexity: "LOW",
            summary: "Archived completed feature.",
            affectedPaths: [],
            createdAt: "2026-07-14T00:00:00.000Z",
            status: "verified",
        });
        await archivePlan(cwd, "archived-source", { now: "2026-07-15T00:00:00.000Z" });
        const result = await runWorkRecordBackfill(cwd, {
            idGenerator: () => "66666666-6666-4666-8666-666666666666",
            now: () => new Date("2026-07-16T00:00:00.000Z"),
            generateSections: () => ({ title: "Archived Source", summary: "Archived completed feature." }),
        });

        assertEquals(result.outcomes[0].status, "generated");
        const archived = await loadArchivedPlan(cwd, "archived-source");
        assertEquals(archived?.attrs.workRecord?.recordId, "66666666-6666-4666-8666-666666666666");
        assertEquals(archived?.attrs.archivedAt, "2026-07-15T00:00:00.000Z");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Work Record backfill retries failed Plan backlinks", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "retry", "# Retry\n\n## Plan\n\nBody", {
            planId: "plan-retry",
            classification: "FEATURE",
            complexity: "LOW",
            summary: "Retry failed Work Record generation.",
            affectedPaths: [],
            createdAt: "2026-07-14T00:00:00.000Z",
            status: "verified",
            workRecord: {
                status: "failed",
                lastAttemptAt: "2026-07-15T00:00:00.000Z",
                error: "Recorder exploded",
            },
        });

        const preview = await previewWorkRecordBackfill(cwd);
        assertEquals(preview.eligible.map((source) => source.name), ["retry"]);
        const result = await runWorkRecordBackfill(cwd, {
            idGenerator: () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            now: () => new Date("2026-07-16T00:00:00.000Z"),
            generateSections: () => ({ title: "Retry Outcome", summary: "Retry succeeded." }),
        });

        assertEquals(result.outcomes[0].status, "generated");
        const plan = await loadPlan(cwd, "retry");
        assertEquals(plan?.attrs.workRecord?.status, "generated");
        assertEquals(plan?.attrs.workRecord?.recordId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
        assertEquals(plan?.attrs.workRecord?.error, undefined);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Work Record generation rejects empty structured sections and records failure backlink", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "empty", "# Empty\n\n## Plan\n\nBody", {
            planId: "plan-empty",
            classification: "FEATURE",
            complexity: "LOW",
            summary: "Empty output.",
            affectedPaths: [],
            createdAt: "2026-07-14T00:00:00.000Z",
            status: "verified",
        });
        const preview = await previewWorkRecordBackfill(cwd);
        const outcome = await generateWorkRecordForSource(cwd, preview.eligible[0], {
            idGenerator: () => "77777777-7777-4777-8777-777777777777",
            now: () => new Date("2026-07-16T00:00:00.000Z"),
            generateSections: () => ({ title: "", summary: "" }),
        });

        assertEquals(outcome.status, "failed");
        const plan = await loadPlan(cwd, "empty");
        assertEquals(plan?.attrs.status, "verified");
        assertEquals(plan?.attrs.workRecord?.status, "failed");
        assertStringIncludes(plan?.attrs.workRecord?.error || "", "non-empty title");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Work Record generation records failure backlink without changing terminal status", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "bad", "# Bad\n\n## Plan\n\nBody", {
            planId: "plan-bad",
            classification: "FEATURE",
            complexity: "LOW",
            summary: "Bad generated output.",
            affectedPaths: [],
            createdAt: "2026-07-14T00:00:00.000Z",
            status: "verified",
        });
        const preview = await previewWorkRecordBackfill(cwd);
        const outcome = await generateWorkRecordForSource(cwd, preview.eligible[0], {
            idGenerator: () => "77777777-7777-4777-8777-777777777777",
            now: () => new Date("2026-07-16T00:00:00.000Z"),
            generateSections: () => {
                throw new Error("Recorder exploded");
            },
        });

        assertEquals(outcome.status, "failed");
        const plan = await loadPlan(cwd, "bad");
        assertEquals(plan?.attrs.status, "verified");
        assertEquals(plan?.attrs.workRecord?.status, "failed");
        assertStringIncludes(plan?.attrs.workRecord?.error || "", "Recorder exploded");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Work Record backfill preview does not create docs/work-records", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "standalone", "# Standalone\n\n## Plan\n\nBody", {
            planId: "plan-dry-run",
            classification: "FEATURE",
            complexity: "LOW",
            summary: "Dry-run source.",
            affectedPaths: [],
            createdAt: "2026-07-14T00:00:00.000Z",
            status: "verified",
        });

        const preview = await previewWorkRecordBackfill(cwd);

        assertEquals(preview.eligible.length, 1);
        await assertRejects(
            () => Deno.stat(`${cwd}/docs/work-records`),
            Deno.errors.NotFound,
        );
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Work Record backfill ignores non-linkable existing records and generates approved internal record", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "standalone", "# Standalone\n\n## Plan\n\nBody", {
            planId: "plan-needs-approved",
            classification: "FEATURE",
            complexity: "LOW",
            summary: "Needs approved internal record.",
            affectedPaths: [],
            createdAt: "2026-07-14T00:00:00.000Z",
            status: "verified",
        });
        await writeWorkRecord(
            cwd,
            {
                ...INTERNAL_ATTRS,
                recordId: "99999999-9999-4999-8999-999999999999",
                status: "draft",
                origin: "external",
                provenance: { sourcePlans: ["plan-needs-approved"] },
            },
            "# Draft External\n\n## Summary\n\nNot approved internal history.",
            { fileName: "2026-07-14-draft-external.md" },
        );

        const preview = await previewWorkRecordBackfill(cwd);
        assertEquals(preview.eligible[0].existingRecord, undefined);
        const result = await runWorkRecordBackfill(cwd, {
            idGenerator: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            now: () => new Date("2026-07-16T00:00:00.000Z"),
            generateSections: () => ({ title: "Approved Internal", summary: "Generated approved internal record." }),
        });

        assertEquals(result.outcomes[0].status, "generated");
        const plan = await loadPlan(cwd, "standalone");
        assertEquals(plan?.attrs.workRecord?.recordId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
        const generated = await findWorkRecordById(cwd, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
        assertEquals(generated?.attrs.status, "approved");
        assertEquals(generated?.attrs.origin, "internal");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Work Record index document uses compact summary metadata and tags only", () => {
    const record = parseWorkRecordMarkdown(formatWorkRecordMarkdown(INTERNAL_ATTRS, BODY), {
        relativePath: "docs/work-records/example.md",
    });

    const document = buildWorkRecordIndexDocument(record);
    const tags = buildWorkRecordIndexTags(record);

    assertStringIncludes(document, "## Summary");
    assertStringIncludes(document, "Built the durable store.");
    assertEquals(document.includes("## Future Planning Notes"), false);
    assertEquals(document.includes("Reuse this pattern."), false);
    assertEquals(tags.includes(`work-record:${INTERNAL_ATTRS.recordId}`), true);
    assertEquals(tags.includes("status:approved"), true);
    assertEquals(tags.includes("scope:feature"), true);
    assertEquals(tags.includes("origin:internal"), true);
    assertEquals(tags.includes("completion:verified"), true);
    assertEquals(tags.includes("archived:false"), true);
    assertEquals(tags.includes("superseded:false"), true);
});

Deno.test("Work Record index emptiness ignores Mnemosyne plain-list footer", async () => {
    assertEquals(
        await isWorkRecordIndexEmpty("/tmp/project", {
            commandOutput: (/** @type {string} */ _command, /** @type {string[]} */ args) => {
                assertEquals(args[0], "list");
                return Promise.resolve(ok("[42] indexed\n\nShowing 1 of 90 documents. Use --limit to see more."));
            },
        }),
        false,
    );
});

Deno.test("Work Record index collection name is stable across linked git worktrees", async () => {
    const primary = await Deno.makeTempDir();
    const worktreeParent = await Deno.makeTempDir();
    const worktree = `${worktreeParent}/linked-worktree`;
    try {
        await git(primary, ["init"]);
        await git(primary, ["config", "user.email", "test@example.com"]);
        await git(primary, ["config", "user.name", "Test User"]);
        await Deno.writeTextFile(`${primary}/README.md`, "# Test\n");
        await git(primary, ["add", "README.md"]);
        await git(primary, ["commit", "-m", "init"]);
        await git(primary, ["worktree", "add", worktree, "HEAD"]);

        assertEquals(await getWorkRecordIndexCollectionName(worktree), await getWorkRecordIndexCollectionName(primary));
    } finally {
        await Deno.remove(worktreeParent, { recursive: true }).catch(() => {});
        await Deno.remove(primary, { recursive: true }).catch(() => {});
    }
});

Deno.test("Work Record index sync adds absent records and strictly updates existing records", async () => {
    const record = parseWorkRecordMarkdown(formatWorkRecordMarkdown(INTERNAL_ATTRS, BODY), {
        relativePath: "docs/work-records/example.md",
    });
    /** @type {string[][]} */
    const calls = [];
    let listCalls = 0;
    const commandOutput = (/** @type {string} */ _command, /** @type {string[]} */ args) => {
        calls.push(args);
        if (args[0] === "update" && args[1] === "--help") {
            return Promise.resolve(ok("Usage: mnemosyne update <id> [text] --replace-tags"));
        }
        if (args[0] === "init") return Promise.resolve(ok(""));
        if (args[0] === "list") {
            listCalls += 1;
            return Promise.resolve(ok(listCalls === 1 ? "" : "[42] 2026-07-19 - old"));
        }
        if (args[0] === "add" || args[0] === "update") return Promise.resolve(ok(""));
        throw new Error(`unexpected ${args.join(" ")}`);
    };

    await syncWorkRecordToIndex("/tmp/project", record, { commandOutput });
    await syncWorkRecordToIndex("/tmp/project", record, { commandOutput });

    assertEquals(
        calls.some((args) => args[0] === "add" && args.includes(`work-record:${INTERNAL_ATTRS.recordId}`)),
        true,
    );
    const updateCall = calls.find((args) => args[0] === "update" && args[1] !== "--help");
    assertEquals(updateCall?.[1], "42");
    assertEquals(updateCall?.includes("--replace-tags"), true);
    assertEquals(updateCall?.includes(`work-record:${INTERNAL_ATTRS.recordId}`), true);
});

Deno.test("Work Record index sync rejects duplicate locator matches with rebuild guidance", async () => {
    const record = parseWorkRecordMarkdown(formatWorkRecordMarkdown(INTERNAL_ATTRS, BODY), {
        relativePath: "docs/work-records/example.md",
    });
    await assertRejects(
        () =>
            syncWorkRecordToIndex("/tmp/project", record, {
                commandOutput: (/** @type {string} */ _command, /** @type {string[]} */ args) => {
                    if (args[0] === "update" && args[1] === "--help") {
                        return Promise.resolve(ok("Usage: mnemosyne update <id> [text] --replace-tags"));
                    }
                    if (args[0] === "init") return Promise.resolve(ok(""));
                    if (args[0] === "list") return Promise.resolve(ok("[1] old\n[2] duplicate"));
                    return Promise.resolve(ok(""));
                },
            }),
        Error,
        "wld wr index rebuild",
    );
});

Deno.test("Work Record search rejects duplicate indexed locator candidates", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await writeWorkRecord(cwd, INTERNAL_ATTRS, BODY, { fileName: "2026-07-14-example.md" });
        await assertRejects(
            () =>
                searchWorkRecords(cwd, "durable", {
                    commandOutput: (/** @type {string} */ _command, /** @type {string[]} */ args) => {
                        if (args[0] === "list") return Promise.resolve(ok("[1] indexed"));
                        if (args[0] === "search") {
                            return Promise.resolve(ok(JSON.stringify({
                                results: [
                                    { document_id: 1, metadata: { tags: [`work-record:${INTERNAL_ATTRS.recordId}`] } },
                                    { document_id: 2, metadata: { tags: [`work-record:${INTERNAL_ATTRS.recordId}`] } },
                                ],
                            })));
                        }
                        return Promise.resolve(ok(""));
                    },
                }),
            Error,
            "wld wr index rebuild",
        );
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Work Record search hydrates indexed candidates from a single canonical scan", async () => {
    const cwd = await Deno.makeTempDir();
    const originalReadTextFile = Deno.readTextFile;
    let workRecordFileReads = 0;
    Deno.readTextFile = (path) => {
        if (typeof path === "string" && path.includes("docs/work-records")) workRecordFileReads += 1;
        return originalReadTextFile(path);
    };
    try {
        const first = await writeWorkRecord(cwd, INTERNAL_ATTRS, BODY, { fileName: "2026-07-14-example.md" });
        const second = await writeWorkRecord(
            cwd,
            {
                ...INTERNAL_ATTRS,
                recordId: "33333333-3333-4333-8333-333333333333",
                createdAt: "2026-07-15T08:32:00-04:00",
            },
            BODY.replace("Example", "Second"),
            { fileName: "2026-07-15-second.md" },
        );
        const third = await writeWorkRecord(
            cwd,
            {
                ...INTERNAL_ATTRS,
                recordId: "44444444-4444-4444-8444-444444444444",
                createdAt: "2026-07-16T08:32:00-04:00",
            },
            BODY.replace("Example", "Third"),
            { fileName: "2026-07-16-third.md" },
        );
        workRecordFileReads = 0;

        await searchWorkRecords(cwd, "durable", {
            commandOutput: (/** @type {string} */ _command, /** @type {string[]} */ args) => {
                if (args[0] === "list") return Promise.resolve(ok("[1] indexed"));
                if (args[0] === "search") {
                    return Promise.resolve(ok(JSON.stringify({
                        results: [first, second, third].map((record, index) => ({
                            document_id: index + 1,
                            metadata: { tags: [`work-record:${record.attrs.recordId}`] },
                        })),
                    })));
                }
                return Promise.resolve(ok(""));
            },
        });

        assertEquals(workRecordFileReads, 3);
    } finally {
        Deno.readTextFile = originalReadTextFile;
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Work Record search bootstraps empty index, filters current records, and omits body from results", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        const currentRecord = await writeWorkRecord(cwd, INTERNAL_ATTRS, BODY, { fileName: "2026-07-14-example.md" });
        const draftAttrs = { ...INTERNAL_ATTRS, recordId: "33333333-3333-4333-8333-333333333333", status: "draft" };
        const draftRecord = await writeWorkRecord(
            cwd,
            /** @type {any} */ (draftAttrs),
            BODY.replace("Example", "Draft"),
            {
                fileName: "2026-07-15-draft.md",
            },
        );
        /** @type {string[][]} */
        const calls = [];
        const commandOutput = (/** @type {string} */ _command, /** @type {string[]} */ args) => {
            calls.push(args);
            if (args[0] === "update" && args[1] === "--help") {
                return Promise.resolve(ok("Usage: mnemosyne update <id> [text] --replace-tags"));
            }
            if (args[0] === "list") return Promise.resolve(ok(""));
            if (["forget", "init", "add"].includes(args[0])) return Promise.resolve(ok(""));
            if (args[0] === "search") {
                return Promise.resolve(ok(JSON.stringify({
                    results: [
                        { document_id: 1, metadata: { tags: [`work-record:${currentRecord.attrs.recordId}`] } },
                        { document_id: 2, metadata: { tags: [`work-record:${draftRecord.attrs.recordId}`] } },
                    ],
                })));
            }
            return Promise.resolve(ok(""));
        };

        const result = await searchWorkRecords(cwd, "durable", { commandOutput });

        assertEquals(result.bootstrapped, true);
        assertEquals(calls.some((args) => args[0] === "add"), true);
        assertEquals(result.records.map((record) => record.recordId), [currentRecord.attrs.recordId]);
        assertEquals(Object.hasOwn(/** @type {any} */ (result.records[0]), "record"), false);
        assertEquals(Object.hasOwn(/** @type {any} */ (formatHydratedWorkRecord(currentRecord)), "body"), false);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Work Record read current-only rejects non-current body while all mode returns it", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        const draftAttrs = { ...INTERNAL_ATTRS, recordId: "44444444-4444-4444-8444-444444444444", status: "draft" };
        const draft = await writeWorkRecord(cwd, /** @type {any} */ (draftAttrs), BODY, {
            fileName: "2026-07-15-draft.md",
        });
        await assertRejects(
            () => readWorkRecordById(cwd, draft.attrs.recordId, { accessMode: "current" }),
            Error,
            "current-only mode",
        );
        const result = await readWorkRecordById(cwd, draft.attrs.recordId, { accessMode: "all" });
        assertStringIncludes(result.body, "## Summary");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Work Record index rebuild forgets only the dedicated collection and reports partial failures", async () => {
    const record = parseWorkRecordMarkdown(formatWorkRecordMarkdown(INTERNAL_ATTRS, BODY), {
        relativePath: "docs/work-records/example.md",
    });
    /** @type {string[][]} */
    const calls = [];
    const result = await rebuildWorkRecordIndex("/tmp/project", {
        listWorkRecords: () => Promise.resolve([record]),
        commandOutput: (/** @type {string} */ _command, /** @type {string[]} */ args) => {
            calls.push(args);
            if (args[0] === "update" && args[1] === "--help") {
                return Promise.resolve(ok("Usage: mnemosyne update <id> [text] --replace-tags"));
            }
            if (args[0] === "forget" || args[0] === "init" || args[0] === "add") return Promise.resolve(ok(""));
            return Promise.resolve(ok(""));
        },
    });

    assertEquals(calls.some((args) => args[0] === "forget" && args.includes("project:work-records")), true);
    assertEquals(calls.some((args) => args[0] === "forget" && !args.includes("project:work-records")), false);
    assertEquals(result.added, 1);
    assertEquals(result.failed, 0);
});

Deno.test("Work Record index sync rejects locator listing without numeric document ID", async () => {
    const record = parseWorkRecordMarkdown(formatWorkRecordMarkdown(INTERNAL_ATTRS, BODY), {
        relativePath: "docs/work-records/example.md",
    });
    /** @type {string[][]} */
    const calls = [];
    await assertRejects(
        () =>
            syncWorkRecordToIndex("/tmp/project", record, {
                commandOutput: (/** @type {string} */ _command, /** @type {string[]} */ args) => {
                    calls.push(args);
                    if (args[0] === "update" && args[1] === "--help") {
                        return Promise.resolve(ok("Usage: mnemosyne update <id> [text] --replace-tags"));
                    }
                    if (args[0] === "init") return Promise.resolve(ok(""));
                    if (args[0] === "list") return Promise.resolve(ok("work-record row missing numeric id"));
                    if (args[0] === "add") throw new Error("must not add duplicate");
                    return Promise.resolve(ok(""));
                },
            }),
        Error,
        "parseable Mnemosyne numeric document ID",
    );
    assertEquals(calls.some((args) => args[0] === "add"), false);
});

Deno.test("Work Record markdown round-trips Ticket References and index/search surfaces include URLs", () => {
    const markdown = formatWorkRecordMarkdown({
        ...INTERNAL_ATTRS,
        tickets: [{ url: " https://example.com/tickets/ABC-123 ", label: "Primary" }],
    }, "# Ticketed\n\n## Summary\n\nDone.");
    const record = parseWorkRecordMarkdown(markdown);
    assertEquals(record.attrs.tickets, [{ url: "https://example.com/tickets/ABC-123", label: "Primary" }]);
    assertStringIncludes(markdown, 'tickets:\n    - url: "https://example.com/tickets/ABC-123"');
    assertStringIncludes(buildWorkRecordIndexDocument(record), "ticketUrls: https://example.com/tickets/ABC-123");
    assertEquals(formatHydratedWorkRecord(record).tickets, [{
        url: "https://example.com/tickets/ABC-123",
        label: "Primary",
    }]);
});

Deno.test("Work Record generation preserves child Ticket References when assigning active Epic planId", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "epic-without-plan-id", "# Epic", {
            classification: "PROJECT",
            status: "verified",
            epicCompletionMode: "done_enough",
            tickets: [{ url: "https://example.com/tickets/EPIC-NO-ID" }],
        });
        await savePlan(cwd, "epic-without-plan-id/01-child", "# Child", {
            parentPlan: "epic-without-plan-id",
            order: 1,
            status: "verified",
            tickets: [{ url: "https://example.com/tickets/CHILD-NO-ID" }],
        });
        const source = (await previewWorkRecordBackfill(cwd)).eligible.find((candidate) =>
            candidate.name === "epic-without-plan-id"
        );
        if (!source) throw new Error("Expected active Epic source");
        assertEquals(source.planId, "");
        assertEquals(source.children?.length, 1);

        const ids = [
            "11111111-1111-4111-8111-111111111114",
            "11111111-1111-4111-8111-111111111115",
        ];
        const outcome = await generateWorkRecordForSource(cwd, source, {
            idGenerator: () => ids.shift() || "11111111-1111-4111-8111-111111111116",
            generateSections: () => ({ title: "Epic Without Plan ID", summary: "Done." }),
            syncWorkRecordToIndex: () => Promise.resolve({ action: "added", recordId: "" }),
        });

        assertEquals(outcome.status, "generated");
        assertEquals((await findWorkRecordById(cwd, "11111111-1111-4111-8111-111111111115"))?.attrs.tickets, [
            { url: "https://example.com/tickets/EPIC-NO-ID" },
            { url: "https://example.com/tickets/CHILD-NO-ID" },
        ]);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});

Deno.test("Work Record generation snapshots standalone and Epic Ticket References deterministically", async () => {
    const cwd = await Deno.makeTempDir();
    try {
        await savePlan(cwd, "standalone", "# Standalone", {
            planId: "plan-standalone",
            status: "verified",
            tickets: [{ url: "https://example.com/tickets/STAND-1", label: "standalone" }],
        });
        const standalone = (await previewWorkRecordBackfill(cwd)).eligible.find((source) =>
            source.name === "standalone"
        );
        if (!standalone) throw new Error("Expected standalone source");
        const standaloneOutcome = await generateWorkRecordForSource(cwd, standalone, {
            idGenerator: () => "11111111-1111-4111-8111-111111111112",
            generateSections: () => ({ title: "Standalone", summary: "Done." }),
            syncWorkRecordToIndex: () => Promise.resolve({ action: "added", recordId: "" }),
        });
        assertEquals(standaloneOutcome.status, "generated");
        assertEquals((await findWorkRecordById(cwd, "11111111-1111-4111-8111-111111111112"))?.attrs.tickets, [
            { url: "https://example.com/tickets/STAND-1", label: "standalone" },
        ]);

        await savePlan(cwd, "epic", "# Epic", {
            classification: "PROJECT",
            planId: "plan-epic",
            status: "verified",
            epicCompletionMode: "done_enough",
            tickets: [{ url: "https://example.com/tickets/DUP", label: "epic" }],
        });
        await savePlan(cwd, "epic/02-child", "# Child 2", {
            planId: "plan-child-2",
            parentPlan: "epic",
            order: 2,
            status: "draft",
            tickets: [{ url: "https://example.com/tickets/CHILD-2" }],
        });
        await savePlan(cwd, "epic/01-child", "# Child 1", {
            planId: "plan-child-1",
            parentPlan: "epic",
            order: 1,
            status: "verified",
            tickets: [{ url: "https://example.com/tickets/DUP", label: "child" }],
        });
        const epic = (await previewWorkRecordBackfill(cwd)).eligible.find((source) => source.name === "epic");
        if (!epic) throw new Error("Expected Epic source");
        const epicOutcome = await generateWorkRecordForSource(cwd, epic, {
            idGenerator: () => "11111111-1111-4111-8111-111111111113",
            generateSections: () => ({ title: "Epic", summary: "Done." }),
            syncWorkRecordToIndex: () => Promise.resolve({ action: "added", recordId: "" }),
        });
        assertEquals(epicOutcome.status, "generated");
        assertEquals((await findWorkRecordById(cwd, "11111111-1111-4111-8111-111111111113"))?.attrs.tickets, [
            { url: "https://example.com/tickets/DUP", label: "epic" },
            { url: "https://example.com/tickets/CHILD-2" },
        ]);
        assertEquals((await loadPlan(cwd, "epic/01-child"))?.attrs.workRecord, undefined);
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});
