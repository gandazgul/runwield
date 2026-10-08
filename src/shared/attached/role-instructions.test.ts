import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
    activateInput,
    pendingTriage,
    reachPlanning,
    readRecordBytes,
    runOperation,
    triageReportInput,
    withProject,
} from "./attached-test-fixture.ts";

const BUNDLED_PLANNER_TEXT = "You are the Planner — the Planned Change planning specialist";
const BUNDLED_ROUTER_TEXT = "Your ONLY job is to identify the Routing Intent and call `triage_report`.";

async function writeProjectPlanner(projectRoot: string, body: string): Promise<void> {
    await Deno.mkdir(join(projectRoot, ".wld", "agents"), { recursive: true });
    await Deno.writeTextFile(
        join(projectRoot, ".wld", "agents", "planner.md"),
        `---\npromptOverride: true\n---\n\n${body}\n`,
    );
}

Deno.test("activate returns the Router instructions with the pending Triage action", async () => {
    await withProject(async (projectRoot) => {
        const result = await runOperation("activate", projectRoot, activateInput());
        assert(result.ok && result.instructions, JSON.stringify(result));
        assertEquals(result.instructions.role, "router");
        assertEquals(result.instructions.contractVersion, "runwield.attached.triage/1");
        assertStringIncludes(result.instructions.text, BUNDLED_ROUTER_TEXT);
    });
});

Deno.test("after a PLANNED_CHANGE Triage, status returns the Planner action and Planner instructions", async () => {
    await withProject(async (projectRoot) => {
        const { planning } = await reachPlanning(projectRoot);
        const status = await runOperation("status", projectRoot, { workflowId: planning.workflowId });
        assert(status.ok && status.instructions, JSON.stringify(status));
        assertEquals(status.workflow.nextAction.kind, "plan");
        assertEquals(status.instructions.role, "planner");
        assertEquals(status.instructions.contractVersion, "runwield.attached.planner/1");
        assertStringIncludes(status.instructions.text, BUNDLED_PLANNER_TEXT);
        assertStringIncludes(status.instructions.text, "- `write`, `write_docs` -> `Write`");
        assertEquals(status.instructions.text.includes("{{"), false, "No template placeholder may reach the host.");
    });
});

Deno.test("a project planner definition replaces the bundled Planner instructions on the next response", async () => {
    await withProject(async (projectRoot) => {
        const { planning } = await reachPlanning(projectRoot);
        await writeProjectPlanner(projectRoot, "Project Planner: plan only in haiku.");
        const status = await runOperation("status", projectRoot, { workflowId: planning.workflowId });
        assert(status.ok && status.instructions, JSON.stringify(status));
        assertStringIncludes(status.instructions.text, "Project Planner: plan only in haiku.");
        assertEquals(status.instructions.text.includes(BUNDLED_PLANNER_TEXT), false);
    });
});

Deno.test("a replayed operation returns the instructions in effect now, and the record saves none", async () => {
    await withProject(async (projectRoot) => {
        const triage = pendingTriage(await runOperation("activate", projectRoot, activateInput()));
        const first = await runOperation("triage_report", projectRoot, triageReportInput(triage));
        assert(first.ok && first.instructions);
        assertStringIncludes(first.instructions.text, BUNDLED_PLANNER_TEXT);

        await writeProjectPlanner(projectRoot, "Project Planner: changed after Triage.");
        const replayed = await runOperation("triage_report", projectRoot, triageReportInput(triage));
        assert(replayed.ok && replayed.instructions);
        assertEquals(replayed.workflow, first.workflow);
        assertStringIncludes(replayed.instructions.text, "Project Planner: changed after Triage.");
        assertEquals((await readRecordBytes(projectRoot, triage.workflowId)).includes('"instructions"'), false);
    });
});

Deno.test("a closed workflow result carries no role instructions", async () => {
    await withProject(async (projectRoot) => {
        const triage = pendingTriage(await runOperation("activate", projectRoot, activateInput()));
        const outcome = { routingIntent: "INQUIRY", complexity: "LOW", summary: "question" };
        const closed = await runOperation("triage_report", projectRoot, triageReportInput({ ...triage, outcome }));
        assert(closed.ok, JSON.stringify(closed));
        assertEquals(closed.instructions, undefined);
    });
});
