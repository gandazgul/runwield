import { assertEquals, assertStringIncludes } from "@std/assert";
import { fauxAssistantMessage, type FauxResponseFactory, fauxText } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { savePlan } from "../../plan-store.js";
import { HostedSession } from "../session/hosted-session.js";
import { getRunWieldSessionDir } from "../session/root-session.js";
import { listWorkRecords } from "../work-records/store.js";
import { createWorkRecordMnemosyneFixture } from "../work-records/test-fixtures/mnemosyne-port.ts";
import { attachRecorder, makeUi } from "./validation-test-helpers.js";
import { runFeaturePostVerificationHandoffs } from "./validation-helpers.ts";

Deno.test("post-verification handoffs run real Work Record machinery through the Mnemosyne port", async () => {
    await withRuntimeCommandFixture(
        "validation-work-record-",
        async ({ projectRoot, setModelResponseFactories }) => {
            await savePlan(projectRoot, "verified-feature", "# Verified Feature\n\n## Plan\n\nShip it.", {
                planId: "verified-feature-id",
                classification: "PLANNED_CHANGE",
                complexity: "LOW",
                summary: "Verified fixture feature.",
                affectedPaths: [],
                createdAt: "2026-08-03T00:00:00.000Z",
                status: "verified",
            });
            const respondToHandoff: FauxResponseFactory = (context) =>
                JSON.stringify(context).includes("post-verification checklist")
                    ? fauxAssistantMessage(fauxText("Manual verification steps\n- [ ] Exercise the verified feature."))
                    : fauxAssistantMessage(fauxText(JSON.stringify({
                        title: "Verified Feature Outcome",
                        summary: "Generated through the real post-verification handoff.",
                    })));
            setModelResponseFactories([respondToHandoff, respondToHandoff]);
            const mnemosynePort = createWorkRecordMnemosyneFixture();
            const ui = makeUi();
            const sessionManager = SessionManager.create(projectRoot, getRunWieldSessionDir(projectRoot));
            const sessionManagerPort = {
                getSessionId: () => sessionManager.getSessionId(),
                getCwd: () => sessionManager.getCwd(),
                appendCustomEntry: <T>(customType: string, data: T) =>
                    sessionManager.appendCustomEntry(customType, data),
            };
            const hostedSession = attachRecorder(
                new HostedSession({
                    id: "validation-work-record-handoff",
                    cwd: projectRoot,
                    sessionManager: sessionManagerPort,
                }),
                ui,
            );

            await runFeaturePostVerificationHandoffs({
                hostedSession,
                planName: "verified-feature",
                planContent: "# Verified Feature",
                projectRoot,
                mnemosynePort,
            });

            const records = await listWorkRecords(projectRoot);
            assertEquals(records.length, 1);
            assertEquals(records[0].attrs.provenance?.sourcePlans, ["verified-feature-id"]);
            assertStringIncludes(records[0].summary, "real post-verification handoff");
            assertEquals(mnemosynePort.snapshot().length, 1);
            const checklist = sessionManager.getEntries().find((entry) =>
                entry.type === "custom" && entry.customType === "runwield.manual_qa_checklist"
            );
            assertEquals(checklist?.type, "custom");
            if (checklist?.type === "custom") {
                assertStringIncludes(JSON.stringify(checklist.data), "Exercise the verified feature");
            }
            const creationStartIndex = ui.messages.findIndex((message: string) =>
                message === "Creating work record for plan verified-feature..."
            );
            const creationDoneIndex = ui.messages.findIndex((message: string) => message === "Work record created.");
            assertEquals(creationStartIndex >= 0, true);
            assertEquals(creationDoneIndex > creationStartIndex, true);
            assertEquals(ui.messages.some((message: string) => message.includes("Work Record generated")), true);
            hostedSession.dispose();
        },
    );
});
