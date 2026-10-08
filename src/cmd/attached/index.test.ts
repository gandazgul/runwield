import { assert, assertEquals } from "@std/assert";
import { git } from "../../shared/git-test-fixture.ts";
import type { AttachedJsonObject } from "../../shared/attached/operations.ts";
import {
    activateInput,
    pendingTriage,
    projectFixture,
    readRecordBytes,
    spawnAttachedCli,
    submitInput,
} from "../../shared/attached/attached-test-fixture.ts";

async function withProject(fn: (projectRoot: string) => Promise<void>): Promise<void> {
    const projectRoot = await projectFixture.checkout({ prefix: "runwield-attached-cli-" });
    try {
        await fn(projectRoot);
    } finally {
        await Deno.remove(projectRoot, { recursive: true }).catch(() => undefined);
    }
}

Deno.test("separate Core processes activate, accept Triage once, and replay the saved result", async () => {
    await withProject(async (projectRoot) => {
        const a = await spawnAttachedCli("activate", projectRoot, activateInput());
        assertEquals(a.code, 0, a.stderr);
        const triage = pendingTriage(a.result);

        const b = await spawnAttachedCli("submit", projectRoot, submitInput(triage));
        assertEquals(b.code, 0, b.stderr);
        assertEquals(b.result.ok && b.result.workflow.revision, 2);
        const bytesAfterB = await readRecordBytes(projectRoot, triage.workflowId);

        const c = await spawnAttachedCli("submit", projectRoot, submitInput(triage));
        assertEquals(c.result, b.result);
        assertEquals(await readRecordBytes(projectRoot, triage.workflowId), bytesAfterB);

        const d = await spawnAttachedCli("status", projectRoot, { workflowId: triage.workflowId });
        assertEquals(d.result.ok && d.result.workflow, b.result.ok && b.result.workflow);
        assertEquals(await readRecordBytes(projectRoot, triage.workflowId), bytesAfterB);
        assertEquals(await git(projectRoot, ["status", "--porcelain", "--ignored"]), "");
    });
});

Deno.test("two processes racing on one revision leave exactly one accepted outcome", async () => {
    await withProject(async (projectRoot) => {
        const triage = pendingTriage((await spawnAttachedCli("activate", projectRoot, activateInput())).result);
        const outcomes: AttachedJsonObject[] = [
            { routingIntent: "PLANNED_CHANGE", workKind: "FEATURE", complexity: "LOW", summary: "first" },
            { routingIntent: "INQUIRY", complexity: "LOW", summary: "second" },
        ];
        const runs = await Promise.all(
            outcomes.map((outcome, index) =>
                spawnAttachedCli(
                    "submit",
                    projectRoot,
                    submitInput({ ...triage, operationId: `op-race-${index}`, outcome }),
                )
            ),
        );

        const accepted = runs.filter((run) => run.result.ok);
        const conflicts = runs.filter((run) => !run.result.ok && run.result.rejection.code === "revision_conflict");
        assertEquals(accepted.length, 1, JSON.stringify(runs.map((run) => run.result)));
        assertEquals(conflicts.length, 1);
        assertEquals(conflicts[0].code, 1);

        const status = await spawnAttachedCli("status", projectRoot, { workflowId: triage.workflowId });
        assert(status.result.ok && accepted[0].result.ok);
        assertEquals(status.result.workflow.revision, 2);
        assertEquals(status.result.workflow.triageOutcome, accepted[0].result.workflow.triageOutcome);
    });
});
