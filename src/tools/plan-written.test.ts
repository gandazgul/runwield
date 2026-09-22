import { assertEquals, assertStringIncludes } from "@std/assert";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { HostedSession } from "../shared/session/hosted-session.js";
import { createPlanWrittenTool } from "./plan-written.ts";
import { join } from "@std/path";
import { withRuntimeCommandFixture } from "../cmd/testing/runtime-command-fixture.ts";
import { loadPlan, savePlan } from "../plan-store.js";
import { enterProjectRuntime, resolveProjectRuntimeLayout } from "../shared/project-runtime-layout.ts";

const EXTENSION_CONTEXT = {} as ExtensionContext;

Deno.test("plan_written recovers old controller files and opens review after migration", async () => {
    await withRuntimeCommandFixture("plan-written-old-runtime-", async ({ projectRoot }) => {
        const sandboxHome = Deno.env.get("WLD_TEST_SANDBOX_HOME");
        Deno.env.delete("WLD_TEST_SANDBOX_HOME");
        const hostedSession = new HostedSession({ id: "plan-written-recovery", cwd: projectRoot });
        try {
            await savePlan(projectRoot, "demo", "# Demo\n\nKeep the implementation.", {
                planId: "demo",
                classification: "PLANNED_CHANGE",
                status: "approved",
            });
            await enterProjectRuntime(projectRoot);
            const layout = resolveProjectRuntimeLayout(projectRoot);
            const current = await Deno.readTextFile(join(layout.primary.controllerPlansDir, "demo.json"));
            const legacyDirectory = join(projectRoot, ".wld", "controller", "plans");
            await Deno.mkdir(legacyDirectory, { recursive: true });
            await Deno.writeTextFile(join(legacyDirectory, "demo.json"), current);
            await Deno.writeTextFile(join(projectRoot, ".wld", "worktrees.json"), '{"version":2,"entries":[]}');
            await Deno.mkdir(join(projectRoot, ".wld", "plan-locks"), { recursive: true });
            let reviews = 0;
            hostedSession.setInteractionAdapter({
                requestInteraction: async (request) => {
                    assertEquals(request.type, "plan_review");
                    reviews++;
                    const plan = await loadPlan(projectRoot, "demo");
                    return {
                        outcome: "accepted",
                        _meta: { approved: true, approvalAction: "later", revision: plan?.revision },
                    };
                },
            });
            const result = await createPlanWrittenTool({ hostedSession }).execute(
                "review-after-migration",
                { planName: "demo" },
                undefined,
                undefined,
                EXTENSION_CONTEXT,
            );
            assertEquals(reviews, 1, resultText(result));
            assertEquals((await loadPlan(projectRoot, "demo"))?.attrs.status, "ready_for_work", resultText(result));
            assertEquals((result.details as { outcome: string }).outcome, "saved");
        } finally {
            hostedSession.dispose();
            if (sandboxHome === undefined) Deno.env.delete("WLD_TEST_SANDBOX_HOME");
            else Deno.env.set("WLD_TEST_SANDBOX_HOME", sandboxHome);
        }
    });
});

function resultText(result: { content: Array<{ type: string; text?: string }> }): string {
    const item = result.content[0];
    return item?.type === "text" ? item.text || "" : "";
}

Deno.test("plan_written rejects the reserved Epic Artifact name before review", async () => {
    const cwd = await Deno.makeTempDir({ prefix: "plan-written-artifact-" });
    try {
        const hostedSession = new HostedSession({ id: "plan-written-artifact", cwd });
        const tool = createPlanWrittenTool({ hostedSession });

        const result = await tool.execute(
            "call",
            {
                planName: "epic/manual-qa",
            },
            undefined,
            undefined,
            EXTENSION_CONTEXT,
        );

        const details = result.details as { outcome?: string; reason?: string } | null;
        assertEquals(details?.outcome, "repair_required");
        assertEquals(details?.reason, "reserved_epic_artifact");
        assertStringIncludes(resultText(result), "reserved for an Epic Artifact");
    } finally {
        await Deno.remove(cwd, { recursive: true });
    }
});
