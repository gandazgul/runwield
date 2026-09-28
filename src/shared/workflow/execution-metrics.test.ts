import { assert, assertEquals } from "@std/assert";
import { withWorkflowMetricsFixture } from "../../testing/workflow-metrics-fixture.ts";
import {
    classifyMemoryOperation,
    estimateToolSchemaTokens,
    ExecutionMetricsRecorder,
    extractCodeBatchOperations,
    normalizeBashCommand,
} from "./execution-metrics.ts";

Deno.test("normalizeBashCommand normalizes simple and subcommand structures", () => {
    assertEquals(normalizeBashCommand("git status"), ["git status"]);
    assertEquals(normalizeBashCommand("git commit -m 'Initial commit'"), ["git commit"]);
    assertEquals(normalizeBashCommand("git diff HEAD~1"), ["git diff"]);
    assertEquals(normalizeBashCommand("git checkout -b feature/test"), ["git checkout"]);
    assertEquals(normalizeBashCommand("deno task test --filter abc"), ["deno task test"]);
    assertEquals(normalizeBashCommand("deno test -A --filter foo"), ["deno test"]);
    assertEquals(normalizeBashCommand("npm run build --prod"), ["npm run build"]);
    assertEquals(normalizeBashCommand("npm test"), ["npm test"]);
    assertEquals(normalizeBashCommand("cargo test --release"), ["cargo test"]);
    assertEquals(normalizeBashCommand("cargo build"), ["cargo build"]);
    assertEquals(normalizeBashCommand("pnpm run lint"), ["pnpm run lint"]);
    assertEquals(normalizeBashCommand("yarn build"), ["yarn build"]);
    assertEquals(normalizeBashCommand("ls -la /tmp"), ["ls"]);
    assertEquals(normalizeBashCommand("cat package.json"), ["cat"]);
});

Deno.test("normalizeBashCommand handles pipelines, logical chains, and redirects", () => {
    assertEquals(
        normalizeBashCommand("git status | grep modified"),
        ["git status", "grep"],
    );
    assertEquals(
        normalizeBashCommand("mkdir -p build && cd build && cmake .. || echo failed"),
        ["mkdir", "cd", "cmake", "echo"],
    );
    assertEquals(
        normalizeBashCommand("cat input.txt > output.txt 2>&1 ; rm -f input.txt"),
        ["cat", "rm"],
    );
});

Deno.test("normalizeBashCommand classifies command substitution and unbalanced quotes as unknown", () => {
    assertEquals(normalizeBashCommand("echo $(whoami)"), ["unknown"]);
    assertEquals(normalizeBashCommand("cat `pwd`/file"), ["unknown"]);
    assertEquals(normalizeBashCommand("echo 'unterminated quote"), ["unknown"]);
    assertEquals(normalizeBashCommand('echo "unterminated double quote'), ["unknown"]);
    assertEquals(normalizeBashCommand(""), ["unknown"]);
    assertEquals(normalizeBashCommand("   "), ["unknown"]);
});

Deno.test("classifyMemoryOperation identifies action and scope", () => {
    assertEquals(
        classifyMemoryOperation("memory", { action: "recall", query: "auth secret" }),
        { action: "recall", scope: "unified" },
    );
    assertEquals(
        classifyMemoryOperation("memory", { action: "store", content: "config key", scope: "global" }),
        { action: "store", scope: "global" },
    );
    assertEquals(
        classifyMemoryOperation("memory", { action: "delete", id: "mem-123" }),
        { action: "delete", scope: "project" },
    );
    assertEquals(
        classifyMemoryOperation({ CommandLine: "mnemoteca search -g some text" }),
        { action: "recall", scope: "global" },
    );
    assertEquals(
        classifyMemoryOperation({ CommandLine: "mnemoteca add 'remember this'" }),
        { action: "store", scope: "project" },
    );
    assertEquals(
        classifyMemoryOperation({ CommandLine: "mnemoteca delete abc-1" }),
        { action: "delete", scope: "project" },
    );
});

Deno.test("extractCodeBatchOperations parses show and outline child operations", () => {
    const rawArgs = {
        operations: [
            { type: "show", symbol: "MyClass", path: "src/index.ts" },
            { type: "outline", path: "src/utils.ts" },
        ],
    };
    const rawResult = {
        results: [
            { status: "success", truncated: false },
            { status: "error", error: "file not found" },
        ],
    };
    const ops = extractCodeBatchOperations(rawArgs, rawResult);
    assertEquals(ops.length, 2);
    assertEquals(ops[0], {
        batchKind: "show",
        status: "success",
        truncated: false,
    });
    assertEquals(ops[1], {
        batchKind: "outline",
        status: "error",
        truncated: false,
    });
});

Deno.test("estimateToolSchemaTokens calculates non-zero schema and resident tokens", () => {
    const tool = {
        name: "test_tool",
        description: "A test tool for demonstration purposes",
        inputSchema: {
            type: "object",
            properties: {
                arg1: { type: "string", description: "First argument description" },
                arg2: { type: "number", description: "Second argument description" },
            },
            required: ["arg1"],
        },
    };
    const estimates = estimateToolSchemaTokens(tool);
    assert(estimates.schemaTokens > 0, "schemaTokens must be greater than zero");
    assert(estimates.residentTokens >= estimates.schemaTokens, "residentTokens must be >= schemaTokens");
});

Deno.test("ExecutionMetricsRecorder writes exposure, tool start/finish, usage, snapshots, and settlement", async () => {
    await withWorkflowMetricsFixture(async ({ projectRoot, readMetrics }) => {
        const recorder = new ExecutionMetricsRecorder({
            projectRoot,
            sessionId: "test-session-123",
            executionId: "exec-abc",
            agentName: "engineer",
            provider: "anthropic",
            model: "claude-3-7-sonnet",
            backend: "claude-cli",
            sourceSurface: "workspace",
            executionKind: "root",
            mode: "foreground",
        });

        // 1. Record Tool Exposure (verify summary and individual tool records)
        const mockTools = [
            { name: "read", description: "Read file contents" },
            { name: "write", description: "Write file contents" },
            { name: "bash", description: "Execute bash commands" },
        ];
        await recorder.recordToolExposure(mockTools);

        // 2. Latency Points
        await recorder.recordResponseLatency("turn_start");
        await recorder.recordResponseLatency("first_text");

        // 3. Tool Call Start and Finish
        const callId = "call-1";
        await recorder.recordToolStart(callId, "bash", { command: "git status | grep M" });
        await recorder.recordToolFinish(callId, "bash", {
            result: "M modified.ts",
            isError: false,
        });

        // 4. Model Usage
        await recorder.recordModelUsage({
            sourceId: "usage-entry-1",
            inputTokens: 1200,
            outputTokens: 450,
            cacheReadTokens: 300,
            cacheWriteTokens: 100,
            costAmount: 0.0125,
            costCurrency: "USD",
            model: "claude-3-7-sonnet",
            usageKind: "turn",
            measurementAvailability: "complete",
        });

        // 5. Context Snapshot
        await recorder.recordContextSnapshot({
            capacity: 200000,
            currentUsage: 25000,
            samplingPoint: "turn_end",
            usageState: "normal",
        });

        // 6. Record turn finish latency
        await recorder.recordResponseLatency("turn_finish");

        // 7. Settle execution
        await recorder.settleExecution("succeeded");

        const records = await readMetrics();
        assert(records.length >= 7, `Expected at least 7 records, got ${records.length}`);

        // Verify sequence ordering and eventId
        let previousSeq = -1;
        for (const record of records) {
            assertEquals(record.v, 2);
            assert(["execution", "tool_usage", "model_usage", "context"].includes(record.category as string));
            assert(typeof record.eventId === "string" && (record.eventId as string).length > 0);
            assert(typeof record.seq === "number");
            assert((record.seq as number) > previousSeq, `Sequences must be monotonic: ${record.seq} > ${previousSeq}`);
            previousSeq = record.seq as number;
        }

        // Verify tool exposure summary
        const summary = records.find((r) => r.event === "tool_exposure_summary");
        assert(summary, "tool_exposure_summary must exist");
        assertEquals(summary.toolCount, 3);

        // Verify individual tool exposure
        const exposureBash = records.find((r) => r.event === "tool_exposure" && r.toolName === "bash");
        assert(exposureBash, "tool_exposure for bash must exist");
        assert((exposureBash.schemaTokens as number) > 0);

        // Verify tool start & operations
        const startRecord = records.find((r) => r.event === "tool_call_started");
        assert(startRecord, "tool_call_started must exist");
        assertEquals(startRecord.callId, callId);
        assertEquals(startRecord.toolName, "bash");

        const opRecord = records.find((r) => r.event === "tool_operation");
        assert(opRecord, "tool_operation must exist for bash pipeline");
        assertEquals(opRecord.parentCallId, callId);
        assertEquals(opRecord.commandLabel, "git status");

        // Verify tool finish
        const finishRecord = records.find((r) => r.event === "tool_call_finished");
        assert(finishRecord, "tool_call_finished must exist");
        assertEquals(finishRecord.callId, callId);
        assertEquals(finishRecord.outcome, "success");
        assert((finishRecord.durationMs as number) >= 0);
        assert((finishRecord.resultBytes as number) > 0);

        // Verify model usage
        const usageRecord = records.find((r) => r.event === "model_usage");
        assert(usageRecord, "model_usage must exist");
        assertEquals(usageRecord.inputTokens, 1200);
        assertEquals(usageRecord.outputTokens, 450);
        assertEquals(usageRecord.cacheReadTokens, 300);
        assertEquals(usageRecord.cacheWriteTokens, 100);
        assertEquals(usageRecord.costAmount, 0.0125);

        // Verify execution finished
        const endRecord = records.find((r) => r.event === "execution_finished");
        assert(endRecord, "execution_finished must exist");
        assertEquals(endRecord.outcome, "succeeded");
        assertEquals(endRecord.callCount, 1);
    });
});

Deno.test("ExecutionMetricsRecorder handles >40 tools with individual exposure records", async () => {
    await withWorkflowMetricsFixture(async ({ projectRoot, readMetrics }) => {
        const recorder = new ExecutionMetricsRecorder({
            projectRoot,
            sessionId: "test-session-45",
            executionId: "exec-45-tools",
            agentName: "planner",
            provider: "anthropic",
            model: "claude-3-7-sonnet",
            backend: "claude-cli",
            sourceSurface: "cli",
            executionKind: "root",
            mode: "foreground",
        });

        // 45 tools
        const mockTools = Array.from({ length: 45 }, (_, i) => ({
            name: `tool_${i}`,
            description: `Description for tool_${i}`,
        }));

        await recorder.recordToolExposure(mockTools);
        await recorder.settleExecution("succeeded");

        const records = await readMetrics();
        const summary = records.find((r) => r.event === "tool_exposure_summary");
        assert(summary, "tool_exposure_summary must exist");
        assertEquals(summary.toolCount, 45);

        const individualExposures = records.filter((r) => r.event === "tool_exposure");
        assertEquals(individualExposures.length, 45, "All 45 tool exposures must be recorded without truncation");
    });
});
