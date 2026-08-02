import { assertEquals, assertStringIncludes } from "@std/assert";
import { loadPlan, savePlan } from "../../plan-store.js";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { setCustomSetting } from "../settings.js";
import { listWorkRecords } from "./store.js";
import { createWorkRecordMnemosyneFixture } from "./test-fixtures/mnemosyne-port.ts";
import { autoGenerateWorkRecordForCompletedPlan } from "./auto-generation.ts";

async function saveStandalonePlan(projectRoot: string): Promise<void> {
    await savePlan(projectRoot, "standalone", "# Standalone\n\n## Plan\n\nBuild the fixture feature.", {
        planId: "plan-standalone",
        classification: "PLANNED_CHANGE",
        complexity: "LOW",
        summary: "Built the standalone fixture feature.",
        affectedPaths: [],
        createdAt: "2026-07-14T00:00:00.000Z",
        status: "verified",
    });
}

async function saveEpicWithChild(projectRoot: string, terminal: boolean): Promise<void> {
    await savePlan(projectRoot, "epic", "# Epic\n\n## Plan\n\nCoordinate the fixture project.", {
        planId: "plan-epic",
        classification: "PROJECT",
        complexity: "MEDIUM",
        summary: terminal ? "Epic complete enough." : "Epic still active.",
        affectedPaths: [],
        createdAt: "2026-07-14T00:00:00.000Z",
        status: terminal ? "verified" : "ready_for_work",
        ...(terminal ? { epicCompletionMode: "done_enough" as const } : {}),
    });
    await savePlan(projectRoot, "epic/01-child", "# Child\n\n## Plan\n\nComplete one fixture slice.", {
        planId: "plan-child",
        classification: "PLANNED_CHANGE",
        complexity: "LOW",
        summary: "Child feature complete.",
        affectedPaths: [],
        createdAt: "2026-07-14T00:00:00.000Z",
        status: "verified",
        parentPlan: "epic",
        order: 1,
    });
}

Deno.test("automatic Work Record generation writes a canonical record and Plan backlink", async () => {
    await withRuntimeCommandFixture("work-record-auto-", async ({ projectRoot, setModelResponse }) => {
        Deno.chdir(projectRoot);
        await saveStandalonePlan(projectRoot);
        setModelResponse(JSON.stringify({
            title: "Standalone Outcome",
            summary: "Completed through the real automatic generation path.",
            futurePlanningNotes: "Reuse this fixture-backed flow.",
        }));

        const result = await autoGenerateWorkRecordForCompletedPlan({
            cwd: projectRoot,
            planName: "standalone",
            mnemosynePort: createWorkRecordMnemosyneFixture(),
        });

        assertEquals(result.status, "generated");
        const records = await listWorkRecords(projectRoot);
        assertEquals(records.length, 1);
        assertEquals(records[0].attrs.provenance?.sourcePlans, ["plan-standalone"]);
        assertStringIncludes(records[0].summary, "real automatic generation path");
        assertEquals(
            (await loadPlan(projectRoot, "standalone"))?.attrs.workRecord?.recordId,
            records[0].attrs.recordId,
        );
    });
});

Deno.test("automatic child completion generates only the terminal parent Epic record", async () => {
    await withRuntimeCommandFixture("work-record-auto-epic-", async ({ projectRoot, setModelResponse }) => {
        Deno.chdir(projectRoot);
        await saveEpicWithChild(projectRoot, true);
        setModelResponse(JSON.stringify({
            title: "Epic Outcome",
            summary: "Completed the parent Epic with its fixture child.",
        }));

        const result = await autoGenerateWorkRecordForCompletedPlan({
            cwd: projectRoot,
            planName: "epic/01-child",
            mnemosynePort: createWorkRecordMnemosyneFixture(),
        });

        assertEquals(result.status, "generated");
        assertEquals(result.targetPlanName, "epic");
        const records = await listWorkRecords(projectRoot);
        assertEquals(records.length, 1);
        assertEquals(records[0].attrs.provenance?.sourcePlans, ["plan-epic"]);
        assertEquals((await loadPlan(projectRoot, "epic/01-child"))?.attrs.workRecord, undefined);
        assertEquals((await loadPlan(projectRoot, "epic"))?.attrs.workRecord?.recordId, records[0].attrs.recordId);
    });
});

Deno.test("automatic child completion waits for its real parent Epic to become terminal", async () => {
    await withRuntimeCommandFixture("work-record-auto-wait-", async ({ projectRoot }) => {
        Deno.chdir(projectRoot);
        await saveEpicWithChild(projectRoot, false);

        const result = await autoGenerateWorkRecordForCompletedPlan({
            cwd: projectRoot,
            planName: "epic/01-child",
            mnemosynePort: createWorkRecordMnemosyneFixture(),
        });

        assertEquals(result.status, "skipped");
        assertEquals(result.reason, "parent_not_terminal");
        assertEquals(await listWorkRecords(projectRoot, { createDir: false }), []);
        assertEquals((await loadPlan(projectRoot, "epic"))?.attrs.workRecord, undefined);
    });
});

Deno.test("automatic generation honors the project Work Record setting", async () => {
    await withRuntimeCommandFixture("work-record-auto-disabled-", async ({ projectRoot }) => {
        Deno.chdir(projectRoot);
        await saveStandalonePlan(projectRoot);
        await setCustomSetting("workRecords", { autoGenerateOnPlanCompletion: false }, "project");

        const result = await autoGenerateWorkRecordForCompletedPlan({
            cwd: projectRoot,
            planName: "standalone",
            mnemosynePort: createWorkRecordMnemosyneFixture(),
        });

        assertEquals(result.status, "disabled");
        assertEquals(await listWorkRecords(projectRoot, { createDir: false }), []);
        assertEquals((await loadPlan(projectRoot, "standalone"))?.attrs.workRecord, undefined);
    });
});

Deno.test("automatic generation preserves terminal Plan state when Recorder fails", async () => {
    await withRuntimeCommandFixture("work-record-auto-failure-", async ({ projectRoot, setModelResponse }) => {
        Deno.chdir(projectRoot);
        await saveStandalonePlan(projectRoot);
        setModelResponse("Recorder returned invalid fixture output.");

        const result = await autoGenerateWorkRecordForCompletedPlan({
            cwd: projectRoot,
            planName: "standalone",
            mnemosynePort: createWorkRecordMnemosyneFixture(),
        });

        assertEquals(result.status, "failed");
        assertStringIncludes(result.message, "run wld wr backfill");
        assertEquals(await listWorkRecords(projectRoot), []);
        const plan = await loadPlan(projectRoot, "standalone");
        assertEquals(plan?.attrs.status, "verified");
        assertEquals(plan?.attrs.workRecord?.status, "failed");
    });
});
