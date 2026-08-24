import { assertEquals, assertStringIncludes } from "@std/assert";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { HostedSession } from "../shared/session/hosted-session.js";
import { createPlanWrittenTool } from "./plan-written.ts";

const EXTENSION_CONTEXT = {} as ExtensionContext;

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
