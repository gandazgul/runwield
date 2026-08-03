import { assertEquals, assertStringIncludes } from "@std/assert";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { savePlan } from "../../plan-store.js";
import { HostedSession } from "../session/hosted-session.js";
import { listWorkRecords } from "../work-records/store.js";
import { createWorkRecordMnemosyneFixture } from "../work-records/test-fixtures/mnemosyne-port.ts";
import { attachRecorder, makeUi } from "./validation-test-helpers.js";
import { runFeaturePostVerificationHandoffs } from "./validation-helpers.ts";

Deno.test("post-verification handoffs run real Work Record machinery through the Mnemosyne port", async () => {
    await withRuntimeCommandFixture("validation-work-record-", async ({ projectRoot, setModelResponse }) => {
        await savePlan(projectRoot, "verified-feature", "# Verified Feature\n\n## Plan\n\nShip it.", {
            planId: "verified-feature-id",
            classification: "PLANNED_CHANGE",
            complexity: "LOW",
            summary: "Verified fixture feature.",
            affectedPaths: [],
            createdAt: "2026-08-03T00:00:00.000Z",
            status: "verified",
        });
        setModelResponse(JSON.stringify({
            title: "Verified Feature Outcome",
            summary: "Generated through the real post-verification handoff.",
        }));
        const mnemosynePort = createWorkRecordMnemosyneFixture();
        const ui = makeUi();
        const hostedSession = attachRecorder(
            new HostedSession({ id: "validation-work-record-handoff", cwd: projectRoot }),
            ui,
        );

        await runFeaturePostVerificationHandoffs({
            hostedSession,
            planName: "verified-feature",
            planContent: "# Verified Feature",
            projectRoot,
            runManualQaChecklistPrompt: () => Promise.resolve([]),
            mnemosynePort,
        });

        const records = await listWorkRecords(projectRoot);
        assertEquals(records.length, 1);
        assertEquals(records[0].attrs.provenance?.sourcePlans, ["verified-feature-id"]);
        assertStringIncludes(records[0].summary, "real post-verification handoff");
        assertEquals(mnemosynePort.snapshot().length, 1);
        assertEquals(ui.messages.some((message: string) => message.includes("Work Record generated")), true);
    });
});
