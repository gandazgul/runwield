import { assertEquals } from "@std/assert";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio";
import {
    activateInput,
    CLI_PATH,
    DENO_CONFIG_PATH,
    pendingTriage,
    projectFixture,
    spawnAttachedCli,
    submitInput,
} from "../../shared/attached/attached-test-fixture.ts";
import type {
    AttachedJsonObject,
    AttachedOperationName,
    AttachedOperationResult,
} from "../../shared/attached/operations.ts";

type Carrier = (operation: AttachedOperationName, input: AttachedJsonObject) => Promise<AttachedOperationResult>;

/** Each project generates its own workflow and action IDs; compare everything else. */
function withoutGeneratedIds(result: AttachedOperationResult, ids: { workflowId: string; actionId: string }) {
    return JSON.parse(
        JSON.stringify(result).replaceAll(ids.workflowId, "<workflowId>").replaceAll(ids.actionId, "<actionId>"),
    );
}

async function runJourney(carrier: Carrier) {
    const activated = await carrier("activate", activateInput());
    const ids = pendingTriage(activated);
    const steps = [
        activated,
        await carrier("status", { workflowId: ids.workflowId }),
        await carrier("submit", submitInput({ ...ids, expectedRevision: 2, operationId: "op-stale" })),
        await carrier("submit", submitInput(ids)),
        await carrier("submit", submitInput(ids)),
        await carrier("status", { workflowId: ids.workflowId }),
    ];
    return steps.map((step) => withoutGeneratedIds(step, ids));
}

Deno.test("the CLI and the MCP server return equal result objects for the same inputs", async () => {
    const cliProject = await projectFixture.checkout({ prefix: "runwield-attached-parity-cli-" });
    const mcpProject = await projectFixture.checkout({ prefix: "runwield-attached-parity-mcp-" });
    const transport = new StdioClientTransport({
        command: Deno.execPath(),
        args: ["run", "-A", "--quiet", "--no-check", "--config", DENO_CONFIG_PATH, CLI_PATH, "attached", "mcp"],
        cwd: mcpProject,
        env: Deno.env.toObject(),
        stderr: "pipe",
    });
    const client = new Client({ name: "runwield-attached-parity-test", version: "1.0.0" });
    try {
        await client.connect(transport);
        const tools = await client.listTools();
        assertEquals(tools.tools.map((tool) => tool.name), ["activate", "submit", "status"]);

        const viaCli = await runJourney(async (operation, input) =>
            (await spawnAttachedCli(operation, cliProject, input)).result
        );
        const viaMcp = await runJourney(async (operation, input) => {
            const called = await client.callTool({ name: operation, arguments: input });
            const result: AttachedOperationResult = JSON.parse(JSON.stringify(called.structuredContent));
            return result;
        });
        assertEquals(viaMcp, viaCli);
    } finally {
        await client.close().catch(() => undefined);
        await transport.close().catch(() => undefined);
        await Deno.remove(cliProject, { recursive: true }).catch(() => undefined);
        await Deno.remove(mcpProject, { recursive: true }).catch(() => undefined);
    }
});
