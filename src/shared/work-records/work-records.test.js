import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import {
    archiveWorkRecord,
    buildWorkRecordFileName,
    filterWorkRecordsForList,
    findWorkRecordById,
    formatWorkRecordList,
    formatWorkRecordMarkdown,
    generateRecorderSections,
    generateWorkRecordForSource,
    parseRecorderSections,
    parseWorkRecordMarkdown,
    previewWorkRecordBackfill,
    restoreWorkRecord,
    runWorkRecordBackfill,
    supersedeWorkRecord,
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
            type: "epic",
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
