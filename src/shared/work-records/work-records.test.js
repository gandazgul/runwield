import { assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import {
    archiveWorkRecord,
    buildWorkRecordFileName,
    filterWorkRecordsForList,
    findWorkRecordById,
    formatWorkRecordList,
    formatWorkRecordMarkdown,
    parseWorkRecordMarkdown,
    restoreWorkRecord,
    supersedeWorkRecord,
    writeWorkRecord,
} from "./index.js";

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
