import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { HostedSession } from "../session/hosted-session.js";
import { runManualQaChecklistPrompt } from "./validation.ts";

Deno.test("Manual QA runs the bundled isolated Operator and persists its visible checklist", async () => {
    await withRuntimeCommandFixture(
        "validation-manual-qa-",
        async ({ projectRoot, setModelResponseFactory }) => {
            let modelContext = "";
            setModelResponseFactory((context) => {
                modelContext = JSON.stringify(context);
                return fauxAssistantMessage(fauxText(
                    "Manual verification steps for settings-panel\n- [ ] Save settings and reload.",
                ));
            });
            const sessionManager = SessionManager.inMemory(projectRoot);
            const hostedSession = new HostedSession({ id: "manual-qa-persist", cwd: projectRoot });
            // HostedSession's legacy minimal-manager JSDoc widens appendMessage beyond
            // Pi's real SessionManager signature; the concrete manager is the runtime object.
            // @ts-expect-error Real SessionManager is runtime-compatible with HostedSession.
            hostedSession.setRootSessionManager(sessionManager);

            const messages = await runManualQaChecklistPrompt({
                hostedSession,
                name: "settings-panel",
                classification: "FEATURE",
                context: "## Verification Plan\n- Manual: save settings and reload",
                cwd: projectRoot,
            });

            assertEquals(messages.at(-1)?.role, "assistant");
            assertStringIncludes(modelContext, "Name: settings-panel");
            assertStringIncludes(modelContext, "Classification: PLANNED_CHANGE");
            assertStringIncludes(modelContext, "save settings and reload");
            assertStringIncludes(modelContext, "Manual verification steps for <plan name>");
            const checklist = sessionManager.getBranch().find((entry) =>
                entry.type === "custom" && entry.customType === "runwield.manual_qa_checklist"
            );
            assert(checklist && checklist.type === "custom");
            assertEquals(checklist.customType, "runwield.manual_qa_checklist");
            assertEquals(checklist.data, {
                agentName: "Operator",
                text: "Manual verification steps for settings-panel\n- [ ] Save settings and reload.",
                name: "settings-panel",
                classification: "PLANNED_CHANGE",
            });
            hostedSession.dispose();
        },
    );
});
