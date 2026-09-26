import { assert, assertEquals } from "@std/assert";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { withRuntimeCommandFixture } from "../../cmd/testing/runtime-command-fixture.ts";
import { makeManagedSessionFixture } from "../../testing/managed-session-fixture.ts";
import { WorkspaceSessionContinuationService } from "./server/session-continuation.js";

Deno.test("Workspace retains a newly created Session until its task result is saved", async () => {
    await withRuntimeCommandFixture(
        "workspace-background-create-",
        async ({ homeDir, projectRoot, setModelResponseFactories }) => {
            const fixture = await makeManagedSessionFixture({ home: homeDir, projectRoot });
            const service = new WorkspaceSessionContinuationService({ store: fixture.openStore() });
            try {
                setModelResponseFactories([
                    () =>
                        fauxAssistantMessage(fauxToolCall("background_task", {
                            action: "start",
                            command: "sleep 0.5; printf 'created task result\\n'",
                        })),
                    () => fauxAssistantMessage(fauxText("I started a task.")),
                    () => fauxAssistantMessage(fauxText("Created task result received.")),
                ]);
                const created = await service.createSession({
                    projectId: fixture.project.projectId,
                    requestId: "new-background-session",
                    text: "Start an independent command and finish.",
                });
                let operation = service.getOperation(created.operationId);
                for (let index = 0; index < 500 && operation.status === "running"; index++) {
                    await new Promise((resolve) => setTimeout(resolve, 10));
                    operation = service.getOperation(created.operationId);
                }
                assertEquals(operation.status, "completed", JSON.stringify(operation));
                const id = operation.runwieldSessionId;
                assert(id);
                const task = JSON.stringify(operation.events).match(/"task_id"\s*:\s*"([0-9a-f-]+)"/);
                assert(task);
                const generatedId = `background:${id}:${task[1]}`;
                let automatic = service.getOperation(generatedId);
                for (let index = 0; index < 600 && automatic.status !== "completed"; index++) {
                    await new Promise((resolve) => setTimeout(resolve, 10));
                    automatic = service.getOperation(generatedId);
                }
                assertEquals(automatic.status, "completed", JSON.stringify(automatic));
                assert(JSON.stringify(automatic.events).includes("Created task result received."));
            } finally {
                await service.close();
                service.store.close();
                await fixture.cleanup();
            }
        },
    );
});
