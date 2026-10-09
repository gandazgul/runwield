import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { Client } from "@modelcontextprotocol/sdk/client";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio";
import {
    activateInput,
    CLI_PATH,
    DENO_CONFIG_PATH,
    EVIDENCE,
    pendingTriage,
    planWrittenInput,
    projectFixture,
    readRecordBytes,
    spawnAttachedCli,
    triageReportInput,
} from "../../shared/attached/attached-test-fixture.ts";
import type {
    AttachedJsonObject,
    AttachedOperationName,
    AttachedOperationResult,
} from "../../shared/attached/operations.ts";

import type { AttachedWorkflowRecord } from "../../shared/attached/record-store.ts";

type Carrier = (operation: AttachedOperationName, input: AttachedJsonObject) => Promise<AttachedOperationResult>;

/** Each project generates its own workflow and action IDs; compare everything else. */
function withoutGeneratedIds(results: AttachedOperationResult[], workflowId: string) {
    const actionIds = results.flatMap((result) => {
        const action = result.workflow?.nextAction;
        return action && "actionId" in action ? [action.actionId] : [];
    });
    return results.map((result) => {
        let text = JSON.stringify(result).replaceAll(workflowId, "<workflowId>");
        for (const actionId of actionIds) text = text.replaceAll(actionId, "<actionId>");
        return JSON.parse(text);
    });
}

async function runJourney(carrier: Carrier) {
    const activated = await carrier("activate", activateInput());
    const ids = pendingTriage(activated);
    const steps = [
        activated,
        await carrier("status", { workflowId: ids.workflowId }),
        await carrier("triage_report", triageReportInput({ ...ids, expectedRevision: 2, operationId: "op-stale" })),
        await carrier("triage_report", triageReportInput(ids)),
        await carrier("triage_report", triageReportInput(ids)),
        await carrier("status", { workflowId: ids.workflowId }),
    ];
    return withoutGeneratedIds(steps, ids.workflowId);
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
    const client = new Client({ name: EVIDENCE.host, version: EVIDENCE.hostVersion });
    try {
        await client.connect(transport);
        const tools = await client.listTools();
        assertEquals(tools.tools.map((tool) => tool.name), ["activate", "triage_report", "status", "plan_written"]);
        for (const tool of tools.tools) {
            assertEquals(tool.inputSchema.required?.includes("evidence"), false);
            assertEquals(Object.hasOwn(tool.inputSchema.properties ?? {}, "evidence"), false);
        }

        const viaCli = await runJourney(async (operation, input) =>
            (await spawnAttachedCli(operation, cliProject, input)).result
        );
        const viaMcp = await runJourney(async (operation, input) => {
            const { evidence: _evidence, ...withoutEvidence } = input;
            const called = await client.callTool({ name: operation, arguments: withoutEvidence });
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

Deno.test("MCP submits a Plan and records client and loaded plugin evidence without model-supplied versions", async () => {
    const projectRoot = await projectFixture.checkout({ prefix: "runwield-attached-mcp-plan-" });
    const pluginRoot = await Deno.makeTempDir({ prefix: "runwield-attached-plugin-" });
    await Deno.mkdir(join(pluginRoot, ".claude-plugin"));
    await Deno.writeTextFile(join(pluginRoot, ".claude-plugin", "plugin.json"), JSON.stringify({ version: "9.8.7" }));
    const bin = join(pluginRoot, "bin");
    await Deno.mkdir(bin);
    for (const opener of ["open", "xdg-open"]) {
        await Deno.writeTextFile(join(bin, opener), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    }
    const transport = new StdioClientTransport({
        command: Deno.execPath(),
        args: ["run", "-A", "--quiet", "--no-check", "--config", DENO_CONFIG_PATH, CLI_PATH, "attached", "mcp"],
        cwd: projectRoot,
        env: {
            ...Deno.env.toObject(),
            RUNWIELD_ATTACHED_PLUGIN_ROOT: pluginRoot,
            PATH: `${bin}:${Deno.env.get("PATH")}`,
        },
        stderr: "pipe",
    });
    const client = new Client({ name: "claude-code", version: "2.1.292" });
    async function call(name: AttachedOperationName, input: AttachedJsonObject): Promise<AttachedOperationResult> {
        const { evidence: _evidence, ...argumentsWithoutEvidence } = input;
        const result = await client.callTool({ name, arguments: argumentsWithoutEvidence });
        return JSON.parse(JSON.stringify(result.structuredContent));
    }
    try {
        await client.connect(transport);
        const ids = pendingTriage(await call("activate", activateInput()));
        const triaged = await call("triage_report", triageReportInput(ids));
        assert(triaged.ok && triaged.workflow.nextAction.kind === "plan");
        await Deno.mkdir(join(projectRoot, "docs", "plans"), { recursive: true });
        await Deno.writeTextFile(join(projectRoot, "docs", "plans", "dark-mode-toggle.md"), "# Toggle\n");
        const result = await call(
            "plan_written",
            planWrittenInput({
                workflowId: ids.workflowId,
                actionId: triaged.workflow.nextAction.actionId,
                expectedRevision: triaged.workflow.revision,
            }),
        );
        assert(result.ok);
        assertEquals(result.workflow.state, "awaiting_review");
        const record: AttachedWorkflowRecord = JSON.parse(await readRecordBytes(projectRoot, ids.workflowId));
        for (const accepted of Object.values(record.acceptedOperations)) {
            assertEquals(accepted.evidence.host, "claude-code");
            assertEquals(accepted.evidence.hostVersion, "2.1.292");
            assertEquals(accepted.evidence.adapterVersion, "9.8.7");
        }
    } finally {
        await client.close().catch(() => undefined);
        await transport.close().catch(() => undefined);
        await Deno.remove(pluginRoot, { recursive: true });
        await Deno.remove(projectRoot, { recursive: true });
    }
});
