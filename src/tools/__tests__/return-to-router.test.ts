import { assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import { AGENTS } from "../../constants.js";
import { HostedSession } from "../../shared/session/hosted-session.js";
import { getAgentDisplayName } from "../../shared/session/agents.js";
import { setCustomSetting } from "../../shared/settings.js";
import { getWorkflowMetricsFilePath } from "../../shared/workflow/metrics.js";
import { readLatestReturnToRouterOutcome } from "../../shared/workflow/workflow-results.js";
import { withProcessGlobalTestLock } from "../../testing/process-global-lock.js";
import { executeReturnToRouter, returnToRouterTool } from "../return-to-router.ts";

interface ReturnToRouterFixture {
    homeDir: string;
    projectRoot: string;
}

interface RoutingMetricDetails {
    targetAgent: string;
    hasReason: boolean;
}

interface RoutingMetricRecord {
    category: string;
    event: string;
    agentName: string;
    cwdHash: string;
    details: RoutingMetricDetails;
}

async function withReturnToRouterFixture(
    run: (fixture: ReturnToRouterFixture) => Promise<void>,
): Promise<void> {
    await withProcessGlobalTestLock(async () => {
        const previousHome = Deno.env.get("HOME");
        const fixtureRoot = await Deno.makeTempDir({ prefix: "runwield-return-to-router-" });
        const homeDir = join(fixtureRoot, "home");
        const projectRoot = join(fixtureRoot, "project");
        await Promise.all([
            Deno.mkdir(homeDir, { recursive: true }),
            Deno.mkdir(projectRoot, { recursive: true }),
        ]);
        try {
            Deno.env.set("HOME", homeDir);
            await run({ homeDir, projectRoot });
        } finally {
            if (previousHome === undefined) Deno.env.delete("HOME");
            else Deno.env.set("HOME", previousHome);
            await Deno.remove(fixtureRoot, { recursive: true }).catch(() => {});
        }
    });
}

Deno.test("returnToRouterTool exposes Router handoff metadata", () => {
    assertEquals(returnToRouterTool.name, "return_to_router");
    assertEquals(returnToRouterTool.label, `Return to ${getAgentDisplayName(AGENTS.ROUTER)}`);
});

Deno.test("executeReturnToRouter requires an active hosted session", async () => {
    const result = await executeReturnToRouter({ reason: "Retriage this request." }, null);
    const text = result.content.map((item) => "text" in item ? item.text : "").join("\n");
    assertMatch(text, /requires an active hosted session/i);
});

Deno.test("executeReturnToRouter returns an adapter-neutral terminal handoff", async () => {
    await withReturnToRouterFixture(async ({ projectRoot }) => {
        const hostedSession = new HostedSession({ id: "return-router", cwd: projectRoot });
        const reason = "The user wants you to review the auth architecture.";
        const result = await executeReturnToRouter({ reason }, hostedSession);

        assertEquals(result, {
            content: [],
            details: { agentName: AGENTS.ROUTER, reason },
            terminate: true,
        });
    });
});

Deno.test("executeReturnToRouter records the routing metric under the fixture home", async () => {
    await withReturnToRouterFixture(async ({ homeDir, projectRoot }) => {
        await setCustomSetting("workflowMetrics", true, "project", projectRoot);
        const hostedSession = new HostedSession({ id: "metric-session", cwd: projectRoot });

        await executeReturnToRouter({ reason: "Retriage with enough context." }, hostedSession);

        const metricPath = getWorkflowMetricsFilePath(projectRoot, homeDir);
        const metric = JSON.parse((await Deno.readTextFile(metricPath)).trim()) as RoutingMetricRecord;
        assertEquals(metric.category, "routing");
        assertEquals(metric.event, "return_to_router");
        assertEquals(metric.agentName, AGENTS.ROUTER);
        assertEquals(metric.cwdHash.length, 64);
        assertEquals(metric.details, { targetAgent: AGENTS.ROUTER, hasReason: true });
        assertEquals(metricPath.startsWith(homeDir), true);
    });
});

Deno.test("readLatestReturnToRouterOutcome reads current-turn handoffs", () => {
    const messages = [
        { role: "toolResult", toolName: "return_to_router", details: { agentName: AGENTS.ROUTER, reason: "old" } },
        { role: "assistant", content: [{ type: "text", text: "later" }] },
        { role: "toolResult", toolName: "return_to_router", details: { agentName: AGENTS.ROUTER, reason: "new" } },
    ] as import("@earendil-works/pi-agent-core").AgentMessage[];
    assertEquals(readLatestReturnToRouterOutcome(messages, 1), { agentName: AGENTS.ROUTER, reason: "new" });
    assertEquals(readLatestReturnToRouterOutcome(messages, 3), null);
});
